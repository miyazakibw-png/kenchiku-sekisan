import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  appSettings,
  projectEstimateRows,
  projectFittings,
  projectFurnitureSheets,
  projectRoomSheets,
} from "../db/schema";
import type {
  Fitting,
  FittingSource,
  SaveFittingsRequest,
} from "../../shared/types";
import type { RoomFitting } from "../../core/room/shape";
import {
  DEFAULT_FITTING_PART_VALUES,
  parseFittingPartValues,
  type FittingPartValue,
} from "../../core/fittings/partValue";

const PART_VALUE_KEY = "fittingPartValues";

/** 建具記号を計算式へ入れるときの、部位ごとの採用値 */
export function getFittingPartValues(db: AppDatabase): FittingPartValue[] {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, PART_VALUE_KEY))
    .get();
  return row
    ? parseFittingPartValues(row.valueJson)
    : DEFAULT_FITTING_PART_VALUES;
}

export function saveFittingPartValues(
  db: AppDatabase,
  values: FittingPartValue[],
): FittingPartValue[] {
  const json = JSON.stringify(values);
  db.insert(appSettings)
    .values({ key: PART_VALUE_KEY, valueJson: json })
    .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: json } })
    .run();
  return getFittingPartValues(db);
}

export function listFittings(db: AppDatabase, projectId: number): Fitting[] {
  return db
    .select()
    .from(projectFittings)
    .where(eq(projectFittings.projectId, projectId))
    .orderBy(
      asc(projectFittings.fromFurniture),
      asc(projectFittings.fromEstimate),
      asc(projectFittings.displayOrder),
      asc(projectFittings.id),
    )
    .all();
}

function parseRoomFittings(json: string): RoomFitting[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RoomFitting[]) : [];
  } catch {
    return [];
  }
}

/**
 * 計算書から追加された建具の出所。
 * 部屋計算書から登録した行は登録元の行（無ければその記号を使っている最初の部屋）、
 * 家具計算書から転記した行はその表を返す。
 */
export function listFittingSources(
  db: AppDatabase,
  projectId: number,
): FittingSource[] {
  const fittings = db
    .select({
      id: projectFittings.id,
      symbol: projectFittings.symbol,
      fromEstimate: projectFittings.fromEstimate,
      fromFurniture: projectFittings.fromFurniture,
      furnitureKey: projectFittings.furnitureKey,
      sourceEstimateRowId: projectFittings.sourceEstimateRowId,
    })
    .from(projectFittings)
    .where(eq(projectFittings.projectId, projectId))
    .all();
  if (fittings.every((row) => row.fromEstimate !== 1 && row.fromFurniture !== 1))
    return [];

  const rooms = db
    .select({
      estimateRowId: projectEstimateRows.id,
      fittingsJson: projectRoomSheets.fittingsJson,
      part2: projectEstimateRows.part2,
      part3: projectEstimateRows.part3,
    })
    .from(projectEstimateRows)
    .leftJoin(
      projectRoomSheets,
      eq(projectRoomSheets.estimateRowId, projectEstimateRows.id),
    )
    .where(eq(projectEstimateRows.projectId, projectId))
    .orderBy(asc(projectEstimateRows.displayOrder), asc(projectEstimateRows.id))
    .all()
    .map((row) => ({
      estimateRowId: row.estimateRowId,
      name: `${row.part2} ${row.part3}`.trim(),
      symbols: new Set(
        parseRoomFittings(row.fittingsJson ?? "[]").map((fitting) =>
          fitting.symbol.trim(),
        ),
      ),
    }));
  const roomById = new Map(rooms.map((room) => [room.estimateRowId, room]));
  const sheets = new Map(
    db
      .select({
        id: projectFurnitureSheets.id,
        name: projectFurnitureSheets.name,
      })
      .from(projectFurnitureSheets)
      .where(eq(projectFurnitureSheets.projectId, projectId))
      .all()
      .map((sheet) => [sheet.id, sheet.name]),
  );

  const sources: FittingSource[] = [];
  const none = (fittingId: number): FittingSource => ({
    fittingId,
    kind: "none",
    estimateRowId: null,
    furnitureSheetId: null,
    name: "",
  });
  for (const fitting of fittings) {
    if (fitting.fromFurniture === 1) {
      const sheetId = Number(fitting.furnitureKey.split(":")[0]);
      const name = sheets.get(sheetId);
      if (name === undefined) {
        sources.push(none(fitting.id));
        continue;
      }
      sources.push({
        fittingId: fitting.id,
        kind: "furniture",
        estimateRowId: null,
        furnitureSheetId: sheetId,
        name,
      });
      continue;
    }
    if (fitting.fromEstimate !== 1) continue;
    const symbol = fitting.symbol.trim();
    const room =
      (fitting.sourceEstimateRowId === null
        ? undefined
        : roomById.get(fitting.sourceEstimateRowId)) ??
      rooms.find((each) => each.symbols.has(symbol));
    if (room === undefined) {
      sources.push(none(fitting.id));
      continue;
    }
    sources.push({
      fittingId: fitting.id,
      kind: "room",
      estimateRowId: room.estimateRowId,
      furnitureSheetId: null,
      name: room.name,
    });
  }
  return sources;
}

/**
 * 建具表の一括保存。画面の行順をそのまま display_order にする。
 * 積算入力から登録された行（fromEstimate=1）は建具表入力の後ろへまとめて並べる。
 */
export function saveFittings(
  db: AppDatabase,
  request: SaveFittingsRequest,
): Fitting[] {
  const { projectId, rows } = request;
  db.transaction((tx) => {
    const keptIds = rows
      .map((row) => row.id)
      .filter((id): id is number => id !== null);
    const existing = tx
      .select({ id: projectFittings.id })
      .from(projectFittings)
      .where(eq(projectFittings.projectId, projectId))
      .all()
      .map((row) => row.id);
    const removed = existing.filter((id) => !keptIds.includes(id));
    if (removed.length > 0) {
      tx.delete(projectFittings)
        .where(inArray(projectFittings.id, removed))
        .run();
    }

    rows.forEach((row, index) => {
      const values = {
        projectId,
        symbol: row.symbol.trim(),
        name: row.name,
        width: row.width,
        height: row.height,
        sillHeight: row.sillHeight,
        widthFormula: row.widthFormula,
        heightFormula: row.heightFormula,
        sillHeightFormula: row.sillHeightFormula,
        areaFormula: row.areaFormula,
        baseboardFormula: row.baseboardFormula,
        note: row.note,
        fromEstimate: row.fromEstimate,
        fromFurniture: row.fromFurniture ?? 0,
        furnitureKey: row.furnitureKey ?? "",
        displayOrder: index,
      };
      if (row.id === null) {
        tx.insert(projectFittings).values(values).run();
        return;
      }
      tx.update(projectFittings)
        .set(values)
        .where(
          and(
            eq(projectFittings.id, row.id),
            eq(projectFittings.projectId, projectId),
          ),
        )
        .run();
    });
  });
  return listFittings(db, projectId);
}
