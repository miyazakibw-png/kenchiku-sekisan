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
  listFurnitureSheets,
  pasteFurnitureSheets,
  saveFurnitureSheet,
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
