import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { projectEstimateRows, projectPitSheets } from "../db/schema";
import type { PitSheet, SavePitSheetRequest } from "../../shared/types";

function toSheet(row: typeof projectPitSheets.$inferSelect): PitSheet {
  return {
    id: row.id,
    projectId: row.projectId,
    estimateRowId: row.estimateRowId,
    pitsJson: row.pitsJson,
    beamsJson: row.beamsJson,
    lowerJson: row.lowerJson,
    note: row.note,
  };
}

/** ピット計算書を開く。まだ無ければ部位別入力表の行から作る */
export function getPitSheet(
  db: AppDatabase,
  estimateRowId: number,
): PitSheet {
  const existing = db
    .select()
    .from(projectPitSheets)
    .where(eq(projectPitSheets.estimateRowId, estimateRowId))
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
    .insert(projectPitSheets)
    .values({ projectId: estimateRow.projectId, estimateRowId })
    .returning()
    .get();
  return toSheet(created);
}

export function savePitSheet(
  db: AppDatabase,
  request: SavePitSheetRequest,
): PitSheet {
  const saved = db
    .update(projectPitSheets)
    .set({
      pitsJson: request.pitsJson,
      beamsJson: request.beamsJson,
      lowerJson: request.lowerJson,
      note: request.note,
    })
    .where(eq(projectPitSheets.id, request.id))
    .returning()
    .get();
  return toSheet(saved);
}
