import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { projectEstimateRows, projectGeneralSheets } from "../db/schema";
import type { GeneralSheet, SaveGeneralSheetRequest } from "../../shared/types";
import {
  lowerFromTemplate,
  parseSavedLowerTemplate,
} from "../../core/room/lowerTemplate";
import { getLowerTemplate } from "./roomSheetService";

function toSheet(row: typeof projectGeneralSheets.$inferSelect): GeneralSheet {
  return {
    id: row.id,
    projectId: row.projectId,
    estimateRowId: row.estimateRowId,
    lowerJson: row.lowerJson,
    note: row.note,
  };
}

/** 汎用計算書を開く。まだ無ければ部位別入力表の行から作る */
export function getGeneralSheet(
  db: AppDatabase,
  estimateRowId: number,
): GeneralSheet {
  const existing = db
    .select()
    .from(projectGeneralSheets)
    .where(eq(projectGeneralSheets.estimateRowId, estimateRowId))
    .get();
  if (existing) return toSheet(existing);

  const estimateRow = db
    .select()
    .from(projectEstimateRows)
    .where(eq(projectEstimateRows.id, estimateRowId))
    .get();
  if (!estimateRow)
    throw new Error(`部位別入力表の行が見つかりません: ${estimateRowId}`);

  const template = parseSavedLowerTemplate(getLowerTemplate(db, "general"));
  const created = db
    .insert(projectGeneralSheets)
    .values({
      projectId: estimateRow.projectId,
      estimateRowId,
      ...(template === null
        ? {}
        : { lowerJson: JSON.stringify(lowerFromTemplate(template)) }),
    })
    .returning()
    .get();
  return toSheet(created);
}

export function saveGeneralSheet(
  db: AppDatabase,
  request: SaveGeneralSheetRequest,
): GeneralSheet {
  const saved = db
    .update(projectGeneralSheets)
    .set({ lowerJson: request.lowerJson, note: request.note })
    .where(eq(projectGeneralSheets.id, request.id))
    .returning()
    .get();
  return toSheet(saved);
}
