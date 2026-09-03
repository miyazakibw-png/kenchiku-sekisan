import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  projectEstimateRows,
  projectFrameSheets,
  projectRoomSheets,
} from "../db/schema";
import type {
  FrameRoomOption,
  FrameSheet,
  SaveFrameSheetRequest,
} from "../../shared/types";

function toSheet(row: typeof projectFrameSheets.$inferSelect): FrameSheet {
  return {
    id: row.id,
    projectId: row.projectId,
    estimateRowId: row.estimateRowId,
    layoutJson: row.layoutJson,
    linesJson: row.linesJson,
    attributesJson: row.attributesJson,
    fittingsJson: row.fittingsJson,
    lowerJson: row.lowerJson,
    workHeight: row.workHeight,
    traceJson: row.traceJson,
    kindsJson: row.kindsJson,
    note: row.note,
  };
}

/** 軸組計算書を開く。まだ無ければ部位別入力表の行から作る（施工高さは天井高さを初期値にする） */
export function getFrameSheet(
  db: AppDatabase,
  estimateRowId: number,
): FrameSheet {
  const existing = db
    .select()
    .from(projectFrameSheets)
    .where(eq(projectFrameSheets.estimateRowId, estimateRowId))
    .get();
  if (existing) return toSheet(existing);

  const estimateRow = db
    .select()
    .from(projectEstimateRows)
    .where(eq(projectEstimateRows.id, estimateRowId))
    .get();
  if (!estimateRow)
    throw new Error(`部位別入力表の行が見つかりません: ${estimateRowId}`);

  const created = db
    .insert(projectFrameSheets)
    .values({
      projectId: estimateRow.projectId,
      estimateRowId,
      workHeight: estimateRow.ceilingHeight,
    })
    .returning()
    .get();
  return toSheet(created);
}

export function saveFrameSheet(
  db: AppDatabase,
  request: SaveFrameSheetRequest,
): FrameSheet {
  const saved = db
    .update(projectFrameSheets)
    .set({
      layoutJson: request.layoutJson,
      linesJson: request.linesJson,
      attributesJson: request.attributesJson,
      fittingsJson: request.fittingsJson,
      lowerJson: request.lowerJson,
      workHeight: request.workHeight,
      traceJson: request.traceJson,
      kindsJson: request.kindsJson,
      note: request.note,
    })
    .where(eq(projectFrameSheets.id, request.id))
    .returning()
    .get();
  return toSheet(saved);
}

/**
 * レイアウトに置ける部屋の一覧。
 * 部屋計算書を作った行（平面図がある行）だけを返す。部屋名は 部位Ⅱ＋半角スペース＋部位Ⅲ。
 */
export function listFrameRooms(
  db: AppDatabase,
  projectId: number,
): FrameRoomOption[] {
  const rows = db
    .select({
      estimateRowId: projectRoomSheets.estimateRowId,
      shapeJson: projectRoomSheets.shapeJson,
      ceilingHeight: projectRoomSheets.ceilingHeight,
      part2: projectEstimateRows.part2,
      part3: projectEstimateRows.part3,
      displayOrder: projectEstimateRows.displayOrder,
    })
    .from(projectRoomSheets)
    .innerJoin(
      projectEstimateRows,
      eq(projectRoomSheets.estimateRowId, projectEstimateRows.id),
    )
    .where(eq(projectRoomSheets.projectId, projectId))
    .orderBy(projectEstimateRows.displayOrder)
    .all();

  return rows.map((row) => ({
    estimateRowId: row.estimateRowId,
    roomName: `${row.part2} ${row.part3}`.trim(),
    shapeJson: row.shapeJson,
    ceilingHeight: row.ceilingHeight,
  }));
}
