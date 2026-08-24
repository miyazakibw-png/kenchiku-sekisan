import { and, asc, eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import {
  projectEstimateRows,
  projectFrameSheets,
  projectGeneralSheets,
  projectRoomSheets
} from '../db/schema'
import type { EstimateRow, SaveEstimateRowsRequest } from '../../shared/types'

function toRow(row: typeof projectEstimateRows.$inferSelect): EstimateRow {
  return { ...row, rowType: row.rowType === 'subtotal' ? 'subtotal' : 'room' }
}

export function listEstimateRows(db: AppDatabase, projectId: number): EstimateRow[] {
  return db
    .select()
    .from(projectEstimateRows)
    .where(eq(projectEstimateRows.projectId, projectId))
    .orderBy(asc(projectEstimateRows.displayOrder), asc(projectEstimateRows.id))
    .all()
    .map(toRow)
}

/** 部位別入力表の一括保存。画面の行順をそのまま display_order にする */
export function saveEstimateRows(
  db: AppDatabase,
  request: SaveEstimateRowsRequest
): EstimateRow[] {
  const { projectId, rows } = request
  db.transaction((tx) => {
    const keptIds = rows.map((row) => row.id).filter((id): id is number => id !== null)
    const removed = tx
      .select({ id: projectEstimateRows.id })
      .from(projectEstimateRows)
      .where(eq(projectEstimateRows.projectId, projectId))
      .all()
      .map((row) => row.id)
      .filter((id) => !keptIds.includes(id))
    if (removed.length > 0) {
      tx.delete(projectEstimateRows).where(inArray(projectEstimateRows.id, removed)).run()
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
        displayOrder: index
      }
      if (row.id === null) {
        const inserted = tx
          .insert(projectEstimateRows)
          .values(values)
          .returning({ id: projectEstimateRows.id })
          .all()
        const newId = inserted[0]?.id
        if (newId !== undefined && row.copySourceId != null) {
          copyCalcSheets(tx, projectId, row.copySourceId, newId)
        }
        return
      }
      tx.update(projectEstimateRows)
        .set(values)
        .where(
          and(eq(projectEstimateRows.id, row.id), eq(projectEstimateRows.projectId, projectId))
        )
        .run()
    })
  })
  return listEstimateRows(db, projectId)
}

/**
 * 行コピーで作った行に、コピー元の計算書（部屋別・軸組・汎用）の中身をそのまま複製する。
 * コピー元に計算書が無ければ何もしない。
 */
function copyCalcSheets(
  tx: AppDatabase,
  projectId: number,
  sourceRowId: number,
  targetRowId: number
): void {
  const room = tx
    .select()
    .from(projectRoomSheets)
    .where(eq(projectRoomSheets.estimateRowId, sourceRowId))
    .get()
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
        note: room.note
      })
      .run()
  }

  const frame = tx
    .select()
    .from(projectFrameSheets)
    .where(eq(projectFrameSheets.estimateRowId, sourceRowId))
    .get()
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
        note: frame.note
      })
      .run()
  }

  const general = tx
    .select()
    .from(projectGeneralSheets)
    .where(eq(projectGeneralSheets.estimateRowId, sourceRowId))
    .get()
  if (general) {
    tx.insert(projectGeneralSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        lowerJson: general.lowerJson,
        note: general.note
      })
      .run()
  }
}
