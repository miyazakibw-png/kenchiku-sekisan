import { asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { projectMiscSheets } from "../db/schema";
import {
  copyMiscSheetData,
  type MiscColumn,
  type MiscRow,
} from "../../core/misc/miscSheet";
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

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
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

/**
 * 写した表を貼り付ける（中の明細・部屋・数量ごと写す）。
 * insertAt は貼り付け先の行（管理表の並びの何番目の上に入れるか。最後尾は行数）。
 */
export function pasteMiscSheets(
  db: AppDatabase,
  projectId: number,
  sourceIds: number[],
  insertAt: number,
): MiscSheetSummary[] {
  const rows = sheetRows(db, projectId);
  const sources = sourceIds.flatMap((sourceId) => {
    const source = rows.find((row) => row.id === sourceId);
    return source === undefined ? [] : [source];
  });
  return insertMiscCopies(
    db,
    projectId,
    sources,
    insertAt,
    (name) => `${name} の写し`,
    (data) => data,
  );
}

/**
 * 他の物件の表をこの物件の一覧の末尾に写す（名前はそのまま）。
 * 部位別入力表から転記されていた行はこの物件の部屋とは結び付かないので、
 * 数量を残したまま手で足した行（順につなぐ）にして持ち込む。
 */
export function copyMiscSheetsFromProject(
  db: AppDatabase,
  projectId: number,
  sourceIds: number[],
): MiscSheetSummary[] {
  if (sourceIds.length === 0) return listMiscSheets(db, projectId);
  const found = db
    .select()
    .from(projectMiscSheets)
    .where(inArray(projectMiscSheets.id, sourceIds))
    .all();
  const sources = sourceIds.flatMap((sourceId) => {
    const source = found.find((row) => row.id === sourceId);
    return source === undefined || source.projectId === projectId
      ? []
      : [source];
  });
  return insertMiscCopies(
    db,
    projectId,
    sources,
    Number.MAX_SAFE_INTEGER,
    (name) => name,
    (data) => ({
      columns: data.columns,
      rows: data.rows.map((row, index) => ({
        ...row,
        estimateRowId: null,
        anchorRowId: index === 0 ? null : data.rows[index - 1].id,
      })),
    }),
  );
}

function insertMiscCopies(
  db: AppDatabase,
  projectId: number,
  sources: (typeof projectMiscSheets.$inferSelect)[],
  insertAt: number,
  rename: (name: string) => string,
  adjust: (data: { columns: MiscColumn[]; rows: MiscRow[] }) => {
    columns: MiscColumn[];
    rows: MiscRow[];
  },
): MiscSheetSummary[] {
  const rows = sheetRows(db, projectId);
  const copied = sources.map((source) => {
    const data = adjust(
      copyMiscSheetData({
        columns: parseJson<MiscColumn[]>(source.columnsJson, []),
        rows: parseJson<MiscRow[]>(source.rowsJson, []),
      }),
    );
    return db
      .insert(projectMiscSheets)
      .values({
        projectId,
        name: rename(source.name),
        displayOrder: rows.length,
        columnsJson: JSON.stringify(data.columns),
        rowsJson: JSON.stringify(data.rows),
        note: source.note,
      })
      .returning()
      .get();
  });
  const at = Math.min(Math.max(insertAt, 0), rows.length);
  const ordered = [...rows.slice(0, at), ...copied, ...rows.slice(at)];
  ordered.forEach((row, index) => {
    db.update(projectMiscSheets)
      .set({ displayOrder: index })
      .where(eq(projectMiscSheets.id, row.id))
      .run();
  });
  return listMiscSheets(db, projectId);
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
  if (existing === undefined)
    throw new Error("部位別雑・金物入力表が有りません");
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
