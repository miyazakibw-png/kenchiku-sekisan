import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { projectMiscSheets } from "../db/schema";
import type { MiscSheet, SaveMiscSheetRequest } from "../../shared/types";

function toSheet(row: typeof projectMiscSheets.$inferSelect): MiscSheet {
  return {
    id: row.id,
    projectId: row.projectId,
    columnsJson: row.columnsJson,
    rowsJson: row.rowsJson,
    note: row.note,
  };
}

/** 部位別雑・金物入力表を開く。まだ無ければ空の表を作る（1工事に1枚） */
export function getMiscSheet(db: AppDatabase, projectId: number): MiscSheet {
  const existing = db
    .select()
    .from(projectMiscSheets)
    .where(eq(projectMiscSheets.projectId, projectId))
    .get();
  if (existing) return toSheet(existing);

  const created = db
    .insert(projectMiscSheets)
    .values({ projectId })
    .returning()
    .get();
  return toSheet(created);
}

export function saveMiscSheet(
  db: AppDatabase,
  request: SaveMiscSheetRequest,
): MiscSheet {
  const saved = db
    .update(projectMiscSheets)
    .set({
      columnsJson: request.columnsJson,
      rowsJson: request.rowsJson,
      note: request.note,
    })
    .where(eq(projectMiscSheets.id, request.id))
    .returning()
    .get();
  return toSheet(saved);
}
