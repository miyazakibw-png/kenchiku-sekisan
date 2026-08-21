import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  appSettings,
  projectEstimateRows,
  projectFittings,
  projectRoomSheets,
} from "../db/schema";
import type {
  Fitting,
  RoomSheet,
  SaveRoomSheetRequest,
} from "../../shared/types";
import { DEFAULT_DEDUCTION_LIMIT } from "../../core/room/shape";
import { listFittings } from "./fittingService";

const EMPTY_SHAPE = '{"edges":[]}';

function toSheet(row: typeof projectRoomSheets.$inferSelect): RoomSheet {
  return {
    id: row.id,
    projectId: row.projectId,
    estimateRowId: row.estimateRowId,
    shapeJson: row.shapeJson,
    fittingsJson: row.fittingsJson,
    ceilingJson: row.ceilingJson,
    lowerJson: row.lowerJson,
    ceilingHeight: row.ceilingHeight,
    note: row.note,
  };
}

/** 部屋計算書を開く。まだ無ければ部位別入力表の行から作る（天井高さも引き継ぐ） */
export function getRoomSheet(
  db: AppDatabase,
  estimateRowId: number,
): RoomSheet {
  const existing = db
    .select()
    .from(projectRoomSheets)
    .where(eq(projectRoomSheets.estimateRowId, estimateRowId))
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
    .insert(projectRoomSheets)
    .values({
      projectId: estimateRow.projectId,
      estimateRowId,
      shapeJson: EMPTY_SHAPE,
      ceilingHeight: estimateRow.ceilingHeight,
    })
    .returning()
    .get();
  return toSheet(created);
}

/** 保存。天井高さは部位別入力表と相互連動させる */
export function saveRoomSheet(
  db: AppDatabase,
  request: SaveRoomSheetRequest,
): RoomSheet {
  const saved = db.transaction((tx) => {
    const row = tx
      .update(projectRoomSheets)
      .set({
        shapeJson: request.shapeJson,
        fittingsJson: request.fittingsJson,
        ceilingJson: request.ceilingJson,
        lowerJson: request.lowerJson,
        ceilingHeight: request.ceilingHeight,
        note: request.note,
      })
      .where(eq(projectRoomSheets.id, request.id))
      .returning()
      .get();

    tx.update(projectEstimateRows)
      .set({ ceilingHeight: request.ceilingHeight })
      .where(eq(projectEstimateRows.id, row.estimateRowId))
      .run();

    return row;
  });
  return toSheet(saved);
}

/**
 * 計算書で使った記号が建具表に無ければ登録する（積算入力からの登録なので建具表の末尾へ入る）。
 * 既にある記号は建具表側を正として上書きしない。
 */
export function registerRoomFitting(
  db: AppDatabase,
  projectId: number,
  fitting: {
    symbol: string;
    width: number | null;
    height: number | null;
    sillHeight: number | null;
  },
): Fitting[] {
  const symbol = fitting.symbol.trim();
  if (symbol === "") throw new Error("建具記号を入力してください");
  const existing = db
    .select()
    .from(projectFittings)
    .where(
      and(
        eq(projectFittings.projectId, projectId),
        eq(projectFittings.symbol, symbol),
      ),
    )
    .get();
  if (!existing) {
    const last = db
      .select({ displayOrder: projectFittings.displayOrder })
      .from(projectFittings)
      .where(eq(projectFittings.projectId, projectId))
      .orderBy(desc(projectFittings.displayOrder))
      .get();
    db.insert(projectFittings)
      .values({
        projectId,
        symbol,
        width: fitting.width,
        height: fitting.height,
        sillHeight: fitting.sillHeight,
        fromEstimate: 1,
        displayOrder: (last?.displayOrder ?? -1) + 1,
      })
      .run();
  }
  return listFittings(db, projectId);
}

/** 取り合いの欠除：この面積以下は差し引かない */
export function getDeductionLimit(db: AppDatabase): number {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "deductionLimit"))
    .get();
  const value = row ? Number(row.valueJson) : Number.NaN;
  return Number.isFinite(value) ? value : DEFAULT_DEDUCTION_LIMIT;
}

export function saveDeductionLimit(db: AppDatabase, limit: number): number {
  db.insert(appSettings)
    .values({ key: "deductionLimit", valueJson: String(limit) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueJson: String(limit) },
    })
    .run();
  return limit;
}
