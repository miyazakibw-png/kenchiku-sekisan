import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { projectMiscSheets } from "../db/schema";
import type {
  MiscSheet,
  MiscSheetSummary,
  SaveMiscSheetRequest,
} from "../../shared/types";

/** 管理表の1行目に出す、はじめからある表の名前 */
const DEFAULT_NAME = "部位別雑・金物入力表";

function toSheet(row: typeof projectMiscSheets.$inferSelect): MiscSheet {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    displayOrder: row.displayOrder,
    columnsJson: row.columnsJson,
    rowsJson: row.rowsJson,
    note: row.note,
  };
}

/** JSONの配列の数（壊れていたら0） */
function countOf(json: string): number {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function toSummary(
  row: typeof projectMiscSheets.$inferSelect,
): MiscSheetSummary {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    displayOrder: row.displayOrder,
    columnCount: countOf(row.columnsJson),
    rowCount: countOf(row.rowsJson),
    updatedAt: row.updatedAt,
  };
}

function sheetRows(
  db: AppDatabase,
  projectId: number,
): (typeof projectMiscSheets.$inferSelect)[] {
  return db
    .select()
    .from(projectMiscSheets)
    .where(eq(projectMiscSheets.projectId, projectId))
    .orderBy(asc(projectMiscSheets.displayOrder), asc(projectMiscSheets.id))
    .all();
}

/**
 * 管理表（この工事の部位別雑・金物入力表の一覧）。
 * 1枚も無いときは1枚目を作る（前からある入力はそのまま1行目に出る）。
 */
export function listMiscSheets(
  db: AppDatabase,
  projectId: number,
): MiscSheetSummary[] {
  const rows = sheetRows(db, projectId);
  if (rows.length > 0) return rows.map(toSummary);
  const created = db
    .insert(projectMiscSheets)
    .values({ projectId, name: DEFAULT_NAME, displayOrder: 0 })
    .returning()
    .get();
  return [toSummary(created)];
}

/** 管理表に新しい表を1枚足す */
export function createMiscSheet(
  db: AppDatabase,
  projectId: number,
  name: string,
): MiscSheetSummary {
  const rows = sheetRows(db, projectId);
  const order = rows.reduce((max, row) => Math.max(max, row.displayOrder), -1);
  const created = db
    .insert(projectMiscSheets)
    .values({
      projectId,
      name: name.trim() === "" ? DEFAULT_NAME : name,
      displayOrder: order + 1,
    })
    .returning()
    .get();
  return toSummary(created);
}

/** 管理表の1枚を消す */
export function deleteMiscSheet(db: AppDatabase, sheetId: number): void {
  db.delete(projectMiscSheets).where(eq(projectMiscSheets.id, sheetId)).run();
}

/** 管理表の名前・メモ・並び順を保存する */
export function saveMiscSheetList(
  db: AppDatabase,
  projectId: number,
  sheets: MiscSheetSummary[],
): MiscSheetSummary[] {
  sheets.forEach((sheet, index) => {
    db.update(projectMiscSheets)
      .set({ name: sheet.name, note: sheet.note, displayOrder: index })
      .where(eq(projectMiscSheets.id, sheet.id))
      .run();
  });
  return listMiscSheets(db, projectId);
}

/** 部位別雑・金物入力表を1枚開く */
export function getMiscSheet(db: AppDatabase, sheetId: number): MiscSheet {
  const existing = db
    .select()
    .from(projectMiscSheets)
    .where(eq(projectMiscSheets.id, sheetId))
    .get();
  if (existing === undefined) throw new Error("部位別雑・金物入力表が有りません");
  return toSheet(existing);
}

export function saveMiscSheet(
  db: AppDatabase,
  request: SaveMiscSheetRequest,
): MiscSheet {
  const saved = db
    .update(projectMiscSheets)
    .set({
      name: request.name,
      columnsJson: request.columnsJson,
      rowsJson: request.rowsJson,
      note: request.note,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projectMiscSheets.id, request.id))
    .returning()
    .get();
  return toSheet(saved);
}
