import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { projectFittings, projectFurnitureSheets } from "../db/schema";
import {
  copyFurnitureSheetRows,
  fittingsFromFurniture,
  furnitureSettings,
  type FurnitureColumn,
  type FurnitureRow,
  type FurnitureSettings,
} from "../../core/furniture/furnitureSheet";
import type {
  FurnitureSheet,
  FurnitureSheetSummary,
  SaveFurnitureSheetRequest,
} from "../../shared/types";

/** 一覧に足す表の名前 */
const DEFAULT_NAME = "家具計算書";

function toSheet(
  row: typeof projectFurnitureSheets.$inferSelect,
): FurnitureSheet {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    part1: row.part1,
    part2: row.part2,
    part2Split: row.part2Split,
    multiplier: row.multiplier,
    kind: row.kind,
    displayOrder: row.displayOrder,
    rowsJson: row.rowsJson,
    columnsJson: row.columnsJson,
    settingsJson: row.settingsJson,
    note: row.note,
  };
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function countOf(json: string): number {
  const rows = parseJson<unknown[]>(json, []);
  return Array.isArray(rows) ? rows.length : 0;
}

function toSummary(
  row: typeof projectFurnitureSheets.$inferSelect,
): FurnitureSheetSummary {
  return {
    id: row.id,
    name: row.name,
    part1: row.part1,
    part2: row.part2,
    part2Split: row.part2Split,
    multiplier: row.multiplier,
    kind: row.kind,
    note: row.note,
    displayOrder: row.displayOrder,
    rowCount: countOf(row.rowsJson),
    updatedAt: row.updatedAt,
  };
}

function sheetRows(
  db: AppDatabase,
  projectId: number,
): (typeof projectFurnitureSheets.$inferSelect)[] {
  return db
    .select()
    .from(projectFurnitureSheets)
    .where(eq(projectFurnitureSheets.projectId, projectId))
    .orderBy(
      asc(projectFurnitureSheets.displayOrder),
      asc(projectFurnitureSheets.id),
    )
    .all();
}

/** 家具・設備入力表（一覧） */
export function listFurnitureSheets(
  db: AppDatabase,
  projectId: number,
): FurnitureSheetSummary[] {
  return sheetRows(db, projectId).map(toSummary);
}

/** 一覧に新しい表を1枚足す */
export function createFurnitureSheet(
  db: AppDatabase,
  projectId: number,
  name: string,
  kind = "furniture",
): FurnitureSheetSummary {
  const rows = sheetRows(db, projectId);
  const order = rows.reduce((max, row) => Math.max(max, row.displayOrder), -1);
  const created = db
    .insert(projectFurnitureSheets)
    .values({
      projectId,
      name: name.trim() === "" ? DEFAULT_NAME : name,
      kind,
      displayOrder: order + 1,
      settingsJson: JSON.stringify(furnitureSettings()),
    })
    .returning()
    .get();
  return toSummary(created);
}

/** 写した表を貼り付ける（中の入力ごと写す） */
export function pasteFurnitureSheets(
  db: AppDatabase,
  projectId: number,
  sourceIds: number[],
  insertAt: number,
): FurnitureSheetSummary[] {
  const rows = sheetRows(db, projectId);
  const copied = sourceIds.flatMap((sourceId) => {
    const source = rows.find((row) => row.id === sourceId);
    if (source === undefined) return [];
    const data = copyFurnitureSheetRows(
      parseJson<FurnitureRow[]>(source.rowsJson, []),
      parseJson<FurnitureColumn[]>(source.columnsJson, []),
    );
    return [
      db
        .insert(projectFurnitureSheets)
        .values({
          projectId,
          name: `${source.name} の写し`,
          part1: source.part1,
          part2: source.part2,
          part2Split: source.part2Split,
          multiplier: source.multiplier,
          kind: source.kind,
          displayOrder: rows.length,
          rowsJson: JSON.stringify(data.rows),
          columnsJson: JSON.stringify(data.columns),
          settingsJson: source.settingsJson,
          note: source.note,
        })
        .returning()
        .get(),
    ];
  });
  const at = Math.min(Math.max(insertAt, 0), rows.length);
  const ordered = [...rows.slice(0, at), ...copied, ...rows.slice(at)];
  ordered.forEach((row, index) => {
    db.update(projectFurnitureSheets)
      .set({ displayOrder: index })
      .where(eq(projectFurnitureSheets.id, row.id))
      .run();
  });
  return listFurnitureSheets(db, projectId);
}

/** 一覧の1枚を消す（建具表へ転記した行も消す） */
export function deleteFurnitureSheet(db: AppDatabase, sheetId: number): void {
  const sheet = db
    .select()
    .from(projectFurnitureSheets)
    .where(eq(projectFurnitureSheets.id, sheetId))
    .get();
  if (sheet !== undefined) {
    const ids = furnitureFittings(db, sheet.projectId, sheetId).map(
      (row) => row.id,
    );
    if (ids.length > 0) {
      db.delete(projectFittings)
        .where(inArray(projectFittings.id, ids))
        .run();
    }
  }
  db.delete(projectFurnitureSheets)
    .where(eq(projectFurnitureSheets.id, sheetId))
    .run();
}

/** その家具計算書から建具表へ転記した行 */
function furnitureFittings(
  db: AppDatabase,
  projectId: number,
  sheetId: number,
): (typeof projectFittings.$inferSelect)[] {
  return db
    .select()
    .from(projectFittings)
    .where(
      and(
        eq(projectFittings.projectId, projectId),
        eq(projectFittings.fromFurniture, 1),
      ),
    )
    .all()
    .filter((row) => row.furnitureKey.startsWith(`${sheetId}:`));
}

/** 一覧の部位Ⅰ〜Ⅲ・倍率・種類・メモ・並び順を保存する */
export function saveFurnitureSheetList(
  db: AppDatabase,
  projectId: number,
  sheets: FurnitureSheetSummary[],
): FurnitureSheetSummary[] {
  sheets.forEach((sheet, index) => {
    db.update(projectFurnitureSheets)
      .set({
        name: sheet.name,
        part1: sheet.part1,
        part2: sheet.part2,
        part2Split: sheet.part2Split,
        multiplier: sheet.multiplier,
        kind: sheet.kind,
        note: sheet.note,
        displayOrder: index,
      })
      .where(eq(projectFurnitureSheets.id, sheet.id))
      .run();
  });
  return listFurnitureSheets(db, projectId);
}

export function getFurnitureSheet(
  db: AppDatabase,
  sheetId: number,
): FurnitureSheet {
  const existing = db
    .select()
    .from(projectFurnitureSheets)
    .where(eq(projectFurnitureSheets.id, sheetId))
    .get();
  if (existing === undefined) throw new Error("家具計算書が有りません");
  return toSheet(existing);
}

export function saveFurnitureSheet(
  db: AppDatabase,
  request: SaveFurnitureSheetRequest,
): FurnitureSheet {
  const saved = db
    .update(projectFurnitureSheets)
    .set({
      name: request.name,
      part1: request.part1,
      part2: request.part2,
      part2Split: request.part2Split,
      multiplier: request.multiplier,
      kind: request.kind,
      rowsJson: request.rowsJson,
      columnsJson: request.columnsJson,
      settingsJson: request.settingsJson,
      note: request.note,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projectFurnitureSheets.id, request.id))
    .returning()
    .get();
  transferFurnitureFittings(db, saved.projectId, saved.id);
  return toSheet(saved);
}

/**
 * 家具計算書の内容を建具表へ自動転記する。
 * 建具表入力・積算入力からの登録の後ろへ、家具の入力順で並べる（並べ替えの対象にしない）。
 */
export function transferFurnitureFittings(
  db: AppDatabase,
  projectId: number,
  sheetId: number,
): void {
  const sheet = db
    .select()
    .from(projectFurnitureSheets)
    .where(eq(projectFurnitureSheets.id, sheetId))
    .get();
  if (sheet === undefined) return;
  const rows = parseJson<FurnitureRow[]>(sheet.rowsJson, []);
  const settings = parseJson<FurnitureSettings>(
    sheet.settingsJson,
    furnitureSettings(),
  );
  const wanted = fittingsFromFurniture({
    rows,
    settings: { ...furnitureSettings(), ...settings },
  });

  const existing = furnitureFittings(db, projectId, sheetId);

  // 建具表入力・積算入力からの登録の後ろに並べる
  const base = db
    .select({
      order: projectFittings.displayOrder,
      fromFurniture: projectFittings.fromFurniture,
    })
    .from(projectFittings)
    .where(eq(projectFittings.projectId, projectId))
    .all()
    .reduce(
      (max, row) => (row.fromFurniture === 1 ? max : Math.max(max, row.order)),
      -1,
    );

  const keys = new Set(wanted.map((item) => `${sheetId}:${item.rowId}`));
  const removed = existing
    .filter((row) => !keys.has(row.furnitureKey))
    .map((row) => row.id);
  if (removed.length > 0) {
    db.delete(projectFittings).where(inArray(projectFittings.id, removed)).run();
  }

  wanted.forEach((item, index) => {
    const key = `${sheetId}:${item.rowId}`;
    const current = existing.find((row) => row.furnitureKey === key);
    const values = {
      projectId,
      symbol: item.symbol,
      name: item.name,
      width: item.width,
      height: item.height,
      sillHeight: null,
      fromEstimate: 0,
      fromFurniture: 1,
      furnitureKey: key,
    };
    const displayOrder = base + 1 + index;
    if (current === undefined) {
      db.insert(projectFittings)
        .values({ ...values, displayOrder })
        .run();
      return;
    }
    db.update(projectFittings)
      .set({ ...values, displayOrder })
      .where(eq(projectFittings.id, current.id))
      .run();
  });
}
