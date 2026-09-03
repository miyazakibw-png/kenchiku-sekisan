import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  projectEstimateRows,
  projectFrameSheets,
  projectGeneralSheets,
  projectPitSheets,
  projectRoomSheets,
} from "../db/schema";
import type {
  CalcType,
  EstimateRow,
  SaveEstimateRowsRequest,
} from "../../shared/types";

function toRow(row: typeof projectEstimateRows.$inferSelect): EstimateRow {
  return { ...row, rowType: row.rowType === "subtotal" ? "subtotal" : "room" };
}

export function listEstimateRows(
  db: AppDatabase,
  projectId: number,
): EstimateRow[] {
  return db
    .select()
    .from(projectEstimateRows)
    .where(eq(projectEstimateRows.projectId, projectId))
    .orderBy(asc(projectEstimateRows.displayOrder), asc(projectEstimateRows.id))
    .all()
    .map(toRow);
}

/** 部位別入力表の一括保存。画面の行順をそのまま display_order にする */
export function saveEstimateRows(
  db: AppDatabase,
  request: SaveEstimateRowsRequest,
): EstimateRow[] {
  const { projectId, rows } = request;
  db.transaction((tx) => {
    const keptIds = rows
      .map((row) => row.id)
      .filter((id): id is number => id !== null);
    const removed = tx
      .select({ id: projectEstimateRows.id })
      .from(projectEstimateRows)
      .where(eq(projectEstimateRows.projectId, projectId))
      .all()
      .map((row) => row.id)
      .filter((id) => !keptIds.includes(id));
    if (removed.length > 0) {
      tx.delete(projectEstimateRows)
        .where(inArray(projectEstimateRows.id, removed))
        .run();
    }

    rows.forEach((row, index) => {
      const values = {
        projectId,
        rowType: row.rowType,
        part1: row.part1,
        part2: row.part2,
        part2Split: row.part2Split,
        formwork: row.formwork,
        part3: row.part3,
        ceilingHeight: row.ceilingHeight,
        multiplier: row.multiplier,
        note: row.note,
        calcType: row.calcType,
        displayOrder: index,
      };
      if (row.id === null) {
        const inserted = tx
          .insert(projectEstimateRows)
          .values(values)
          .returning({ id: projectEstimateRows.id })
          .all();
        const newId = inserted[0]?.id;
        if (newId !== undefined && row.copySourceId != null) {
          copyCalcSheets(tx, projectId, row.copySourceId, newId);
        }
        return;
      }
      tx.update(projectEstimateRows)
        .set(values)
        .where(
          and(
            eq(projectEstimateRows.id, row.id),
            eq(projectEstimateRows.projectId, projectId),
          ),
        )
        .run();
    });
  });
  return listEstimateRows(db, projectId);
}

/** 空の計算書（初期値だけ）かどうかを見る。配列は要素数、部屋形状は辺の数で判断する */
function hasContent(...jsons: string[]): boolean {
  return jsons.some((json) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return false;
    }
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed !== null && typeof parsed === "object") {
      const edges = (parsed as { edges?: unknown }).edges;
      if (Array.isArray(edges)) return edges.length > 0;
      return Object.keys(parsed).length > 0;
    }
    return false;
  });
}

/**
 * 行ごとに、中身の入っている計算書の種類を返す。
 * 種類を変えると集計から外れるので、画面で確認メッセージを出すために使う。
 */
export function listFilledCalcSheets(
  db: AppDatabase,
  projectId: number,
): Record<number, CalcType[]> {
  const filled: Record<number, CalcType[]> = {};
  const add = (rowId: number, calcType: CalcType): void => {
    const list = filled[rowId] ?? [];
    if (!list.includes(calcType)) filled[rowId] = [...list, calcType];
  };

  db.select()
    .from(projectRoomSheets)
    .where(eq(projectRoomSheets.projectId, projectId))
    .all()
    .forEach((sheet) => {
      if (
        hasContent(
          sheet.shapeJson,
          sheet.lowerJson,
          sheet.ceilingJson,
          sheet.fittingsJson,
        )
      ) {
        add(sheet.estimateRowId, "room");
      }
    });

  db.select()
    .from(projectFrameSheets)
    .where(eq(projectFrameSheets.projectId, projectId))
    .all()
    .forEach((sheet) => {
      if (
        hasContent(
          sheet.layoutJson,
          sheet.linesJson,
          sheet.lowerJson,
          sheet.fittingsJson,
        )
      ) {
        add(sheet.estimateRowId, "frame");
      }
    });

  db.select()
    .from(projectGeneralSheets)
    .where(eq(projectGeneralSheets.projectId, projectId))
    .all()
    .forEach((sheet) => {
      if (hasContent(sheet.lowerJson)) add(sheet.estimateRowId, "general");
    });

  db.select()
    .from(projectPitSheets)
    .where(eq(projectPitSheets.projectId, projectId))
    .all()
    .forEach((sheet) => {
      if (hasContent(sheet.pitsJson, sheet.beamsJson, sheet.lowerJson)) {
        add(sheet.estimateRowId, "pit");
      }
    });

  return filled;
}

/**
 * 行コピーで作った行に、コピー元の計算書（部屋別・軸組・汎用）の中身をそのまま複製する。
 * コピー元に計算書が無ければ何もしない。
 */
function copyCalcSheets(
  tx: AppDatabase,
  projectId: number,
  sourceRowId: number,
  targetRowId: number,
): void {
  const room = tx
    .select()
    .from(projectRoomSheets)
    .where(eq(projectRoomSheets.estimateRowId, sourceRowId))
    .get();
  if (room) {
    tx.insert(projectRoomSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        shapeJson: room.shapeJson,
        fittingsJson: room.fittingsJson,
        ceilingJson: room.ceilingJson,
        lowerJson: room.lowerJson,
        ceilingHeight: room.ceilingHeight,
        note: room.note,
      })
      .run();
  }

  const frame = tx
    .select()
    .from(projectFrameSheets)
    .where(eq(projectFrameSheets.estimateRowId, sourceRowId))
    .get();
  if (frame) {
    tx.insert(projectFrameSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        layoutJson: frame.layoutJson,
        linesJson: frame.linesJson,
        attributesJson: frame.attributesJson,
        fittingsJson: frame.fittingsJson,
        lowerJson: frame.lowerJson,
        workHeight: frame.workHeight,
        traceJson: frame.traceJson,
        kindsJson: frame.kindsJson,
        note: frame.note,
      })
      .run();
  }

  const general = tx
    .select()
    .from(projectGeneralSheets)
    .where(eq(projectGeneralSheets.estimateRowId, sourceRowId))
    .get();
  if (general) {
    tx.insert(projectGeneralSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        lowerJson: general.lowerJson,
        note: general.note,
      })
      .run();
  }

  const pit = tx
    .select()
    .from(projectPitSheets)
    .where(eq(projectPitSheets.estimateRowId, sourceRowId))
    .get();
  if (pit) {
    tx.insert(projectPitSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        pitsJson: pit.pitsJson,
        beamsJson: pit.beamsJson,
        wallsJson: pit.wallsJson,
        sleevesJson: pit.sleevesJson,
        sleeveKindsJson: pit.sleeveKindsJson,
        wallStep: pit.wallStep,
        lowerJson: pit.lowerJson,
        note: pit.note,
      })
      .run();
  }
}
