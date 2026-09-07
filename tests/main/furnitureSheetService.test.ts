import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import { createProject } from "../../src/main/services/projectService";
import {
  listFittings,
  saveFittings,
} from "../../src/main/services/fittingService";
import {
  createFurnitureSheet,
  deleteFurnitureSheet,
  getFurnitureBaseSettings,
  getFurnitureSheet,
  listFurnitureSheets,
  pasteFurnitureSheets,
  saveFurnitureBaseSettings,
  saveFurnitureSheet,
  saveFurnitureSheetList,
} from "../../src/main/services/furnitureSheetService";
import {
  furnitureRow,
  furnitureSettings,
} from "../../src/core/furniture/furnitureSheet";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function rowsJson(): string {
  return JSON.stringify([
    furnitureRow({
      id: "r1",
      subjectId: 42,
      partNumber: 300,
      detailNumber: 100,
      part: "A",
      partAdd: "2",
      nameSymbol: "G",
      width: "1200",
      height: "1100",
      depth: "400",
      quantity: "1",
      unit: "ヶ所",
    }),
    furnitureRow({
      id: "r2",
      nameSymbol: "IS",
      width: "400",
      height: "2170",
      quantity: "2",
      unit: "ヶ所",
    }),
  ]);
}

function saveRows(db: AppDatabase, sheetId: number): void {
  saveFurnitureSheet(db, {
    id: sheetId,
    name: "家具計算書1",
    part1: "建築",
    part2: "2階",
    part2Split: 0,
    multiplier: 1,
    kind: "furniture",
    rowsJson: rowsJson(),
    columnsJson: "[]",
    settingsJson: JSON.stringify(furnitureSettings()),
    note: "",
  });
}

let db: AppDatabase;
let projectId: number;

beforeEach(() => {
  db = createDb();
  projectId = createProject(db, "テスト物件").id;
});

describe("家具・設備入力表", () => {
  it("表を足す・写す・消せる", () => {
    const sheet = createFurnitureSheet(db, projectId, "家具計算書1");
    saveRows(db, sheet.id);

    const pasted = pasteFurnitureSheets(db, projectId, [sheet.id], 1);
    expect(pasted).toHaveLength(2);
    expect(pasted[1].rowCount).toBe(2);

    deleteFurnitureSheet(db, pasted[1].id);
    expect(listFurnitureSheets(db, projectId)).toHaveLength(1);
  });

  it("種類ごとの基準設定：新しい表は基準から始まり、既存の表と別の種類は変わらない", () => {
    const settingsOf = (sheetId: number) =>
      JSON.parse(getFurnitureSheet(db, sheetId).settingsJson) as ReturnType<
        typeof furnitureSettings
      >;
    expect(getFurnitureBaseSettings(db, "furniture")).toEqual(
      furnitureSettings(),
    );

    const first = createFurnitureSheet(db, projectId, "家具計算書1");
    expect(settingsOf(first.id).partSuffix).toBe("ﾀｲﾌﾟ");

    const base = furnitureSettings({
      partSuffix: "型",
      nameSymbols: [{ symbol: "IS", text: "インフィル収納" }],
    });
    expect(saveFurnitureBaseSettings(db, "furniture", base)).toEqual(base);
    expect(saveFurnitureBaseSettings(db, "furniture", base)).toEqual(base);

    // 既存の表はそのまま
    expect(settingsOf(first.id).partSuffix).toBe("ﾀｲﾌﾟ");

    // 同じ種類の新しい表（別の物件でも）は基準から始まる
    const second = createFurnitureSheet(db, projectId, "家具計算書2");
    const other = createProject(db, "別の物件").id;
    const third = createFurnitureSheet(db, other, "家具計算書");
    expect(settingsOf(second.id)).toEqual(base);
    expect(settingsOf(third.id)).toEqual(base);

    // 別の種類は初めの設定のまま
    const kitchen = createFurnitureSheet(db, projectId, "キッチン", "kitchen");
    expect(settingsOf(kitchen.id)).toEqual(furnitureSettings());

    // 表コピーは元の表の設定を写す
    const pasted = pasteFurnitureSheets(db, projectId, [first.id], 9);
    expect(settingsOf(pasted[pasted.length - 1].id).partSuffix).toBe("ﾀｲﾌﾟ");

    // 一覧で種類を変えた空の表（設定が元の種類の基準のまま）は新しい種類の基準に切り替わる
    const kitchenBase = furnitureSettings({ partSuffix: "KT" });
    saveFurnitureBaseSettings(db, "kitchen", kitchenBase);
    const list = listFurnitureSheets(db, projectId);
    saveFurnitureSheetList(
      db,
      projectId,
      list.map((s) => (s.id === second.id ? { ...s, kind: "kitchen" } : s)),
    );
    expect(settingsOf(second.id)).toEqual(kitchenBase);

    // 行が入っている表は種類を変えても設定はそのまま
    saveRows(db, first.id);
    saveFurnitureSheetList(
      db,
      projectId,
      listFurnitureSheets(db, projectId).map((s) =>
        s.id === first.id ? { ...s, kind: "kitchen" } : s,
      ),
    );
    expect(settingsOf(first.id).partSuffix).toBe("ﾀｲﾌﾟ");
  });

  it("建具表へ入力順で転記し、建具の後ろに並べる", () => {
    saveFittings(db, {
      projectId,
      rows: [
        {
          id: null,
          symbol: "W1",
          name: "窓",
          width: 1.8,
          height: 1.2,
          sillHeight: 0.8,
          widthFormula: "",
          heightFormula: "",
          sillHeightFormula: "",
          areaFormula: "",
          baseboardFormula: "",
          note: "",
          fromEstimate: 0,
        },
      ],
    });
    const sheet = createFurnitureSheet(db, projectId, "家具計算書1");
    saveRows(db, sheet.id);

    const fittings = listFittings(db, projectId);
    expect(fittings.map((row) => row.symbol)).toEqual(["W1", "A2G", "AIS"]);
    expect(fittings[1]).toMatchObject({
      fromFurniture: 1,
      width: 1.2,
      height: 1.1,
      sillHeight: null,
    });

    deleteFurnitureSheet(db, sheet.id);
    expect(listFittings(db, projectId).map((row) => row.symbol)).toEqual(["W1"]);
  });
});
