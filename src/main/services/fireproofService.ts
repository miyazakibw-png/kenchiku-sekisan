import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { projectFireproofSheets } from "../db/schema";
import type {
  FireproofSheetRecord,
  SaveFireproofSheetRequest,
} from "../../shared/types";

function toRecord(
  row: typeof projectFireproofSheets.$inferSelect,
): FireproofSheetRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    floorCount: row.floorCount,
    columnsJson: row.columnsJson,
    beamsJson: row.beamsJson,
    commonJson: row.commonJson,
    note: row.note,
  };
}

/** 耐火被覆・塗装積算入力のリストを開く。まだ無ければ空で作る */
export function getFireproofSheet(
  db: AppDatabase,
  projectId: number,
): FireproofSheetRecord {
  const existing = db
    .select()
    .from(projectFireproofSheets)
    .where(eq(projectFireproofSheets.projectId, projectId))
    .get();
  if (existing) return toRecord(existing);
  const created = db
    .insert(projectFireproofSheets)
    .values({ projectId })
    .returning()
    .get();
  return toRecord(created);
}

export function saveFireproofSheet(
  db: AppDatabase,
  request: SaveFireproofSheetRequest,
): FireproofSheetRecord {
  const saved = db
    .update(projectFireproofSheets)
    .set({
      floorCount: request.floorCount,
      columnsJson: request.columnsJson,
      beamsJson: request.beamsJson,
      commonJson: request.commonJson,
      note: request.note,
    })
    .where(eq(projectFireproofSheets.id, request.id))
    .returning()
    .get();
  return toRecord(saved);
}
