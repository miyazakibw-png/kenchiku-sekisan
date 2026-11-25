import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
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
  ensureFittingDetailSheet,
  getFurnitureSheet,
  saveFurnitureSheet,
} from "../../src/main/services/furnitureSheetService";
import {
  furnitureSettingsFor,
  isFittingDetailSheet,
  type FurnitureRow,
} from "../../src/core/furniture/furnitureSheet";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

let db: AppDatabase;
let projectId: number;

beforeEach(() => {
  db = createDb();
  projectId = createProject(db, "テスト物件").id;
});

function fittingRow(
  patch: Partial<Parameters<typeof saveFittings>[1]["rows"][number]> & {
    symbol: string;
  },
): Parameters<typeof saveFittings>[1]["rows"][number] {
  return {
    id: null,
    name: "",
    width: null,
    height: null,
    sillHeight: null,
    widthFormula: "",
    heightFormula: "",
    sillHeightFormula: "",
    areaFormula: "",
    baseboardFormula: "",
    reinforcementFormula: "",
    note: "",
    fromEstimate: 0,
    ...patch,
  };
}

function sheetRows(sheetId: number): FurnitureRow[] {
  const sheet = getFurnitureSheet(db, sheetId);
  return JSON.parse(sheet.rowsJson) as FurnitureRow[];
}

describe("建具明細作成表", () => {
  it("建具表から1枚だけ作り、家具転記分以外を行として足す", () => {
    saveFittings(db, {
      projectId,
      rows: [
        fittingRow({ symbol: "W-1", name: "窓", width: 1.15225, height: 2 }),
        fittingRow({
          symbol: "D1",
          name: "ドア",
          width: 0.8,
          height: 2,
          fromEstimate: 1,
        }),
        fittingRow({ symbol: "A2G", name: "", width: 1.2, height: 1.1 }),
      ],
    });
    // 家具計算書からの転記分（A2G。建具表の並びは fromFurniture, fromEstimate 順なので記号で探す）
    const furniture = listFittings(db, projectId);
    const transferred = furniture.find((row) => row.symbol === "A2G");
    expect(transferred).toBeDefined();
    db.update(schema.projectFittings)
      .set({ fromFurniture: 1 })
      .where(eq(schema.projectFittings.id, transferred!.id))
      .run();

    const sheet = ensureFittingDetailSheet(db, projectId);
    expect(isFittingDetailSheet(sheet.kind)).toBe(true);
    const rows = sheetRows(sheet.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      part: "W-1",
      nameSymbol: "窓",
      width: "1152.25",
      height: "2000",
    });
    expect(rows[1]).toMatchObject({ part: "D1", width: "800" });
    // 同じ表が返る（1工事1枚）
    expect(ensureFittingDetailSheet(db, projectId).id).toBe(sheet.id);
  });

  it("開くたびに建具表と取り合う（W・Hの変更・増えた分・消えた分）", () => {
    saveFittings(db, {
      projectId,
      rows: [fittingRow({ symbol: "W-1", width: 1, height: 2 })],
    });
    const sheet = ensureFittingDetailSheet(db, projectId);
    const fittingId = listFittings(db, projectId)[0].id;

    saveFittings(db, {
      projectId,
      rows: [
        fittingRow({ id: fittingId, symbol: "W-2", width: 1.5, height: 2.1 }),
        fittingRow({ symbol: "M1", width: 1.8, height: 0.9 }),
      ],
    });
    const rows = sheetRows(sheet.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      part: "W-2",
      width: "1500",
      height: "2100",
    });
    expect(rows[1]).toMatchObject({ part: "M1" });
  });

  it("W・Hを直して保存すると建具表へmm÷1000で返る（式欄は消す）", () => {
    saveFittings(db, {
      projectId,
      rows: [
        fittingRow({
          symbol: "W-1",
          width: 1,
          height: 2,
          widthFormula: "1+0",
        }),
      ],
    });
    const sheet = ensureFittingDetailSheet(db, projectId);
    const rows = sheetRows(sheet.id);
    const edited = [{ ...rows[0], width: "1152.25", height: "1800" }];
    saveFurnitureSheet(db, {
      id: sheet.id,
      name: sheet.name,
      part1: sheet.part1,
      part2: sheet.part2,
      part2Split: sheet.part2Split,
      multiplier: sheet.multiplier,
      kind: sheet.kind,
      rowsJson: JSON.stringify(edited),
      columnsJson: "[]",
      settingsJson: sheet.settingsJson,
      note: sheet.note,
    });
    const fittings = listFittings(db, projectId);
    expect(fittings[0].width).toBeCloseTo(1.15225);
    expect(fittings[0].height).toBeCloseTo(1.8);
    expect(fittings[0].widthFormula).toBe("");
  });

  it("変換する行の設定で計算書転記分・建具入力部を外せる", () => {
    saveFittings(db, {
      projectId,
      rows: [
        fittingRow({ symbol: "W-1" }),
        fittingRow({ symbol: "D1", fromEstimate: 1 }),
      ],
    });
    const sheet = ensureFittingDetailSheet(db, projectId);
    const settings = JSON.parse(sheet.settingsJson) as {
      convertEstimate?: boolean;
      convertManual?: boolean;
    };
    saveFurnitureSheet(db, {
      id: sheet.id,
      name: sheet.name,
      part1: sheet.part1,
      part2: sheet.part2,
      part2Split: sheet.part2Split,
      multiplier: sheet.multiplier,
      kind: sheet.kind,
      rowsJson: sheet.rowsJson,
      columnsJson: "[]",
      settingsJson: JSON.stringify({
        ...settings,
        convertEstimate: false,
      }),
      note: sheet.note,
    });
    // 計算書転記分は新たに足されず連動もしない（行は取り合いを保ったまま残る）。
    // 建具入力部だけ連動し、重複して足されない
    const rows = sheetRows(sheet.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.part)).toEqual(["W-1", "D1"]);
    // D1 は対象外なので連動しない（行・取り合いは保つ）。W-9 と新しい M2 は連動
    const d1Id = listFittings(db, projectId).find(
      (row) => row.symbol === "D1",
    )!.id;
    saveFittings(db, {
      projectId,
      rows: [
        fittingRow({
          id: listFittings(db, projectId)[0].id,
          symbol: "W-9",
          width: 1.5,
          height: 2,
        }),
        fittingRow({
          id: d1Id,
          symbol: "D1",
          width: 0.9,
          height: 2,
          fromEstimate: 1,
        }),
        fittingRow({ symbol: "M2", width: 1, height: 1 }),
      ],
    });
    const next = sheetRows(sheet.id);
    expect(next.map((row) => row.part)).toEqual(["W-9", "D1", "M2"]);
    expect(next[1].fittingId).toBeDefined();
    expect(next[1].width).not.toBe("900");
    expect(next[0].width).toBe("1500");
  });

  it("家具計算書と同じ設定画面の基準（部位記号はアルファベット+[]+数字の初期値）", () => {
    const settings = furnitureSettingsFor("fittingDetail");
    expect(settings.widthLabel).toBe("W");
    expect(settings.heightLabel).toBe("*H");
    expect(settings.depthLabel).toBe("*見込");
    // 部位の記号表は無い（記号は分解してそのまま出す：AW3A→AW-3A）
    expect(settings.partSymbols).toEqual([]);
    expect(settings.nameSymbols?.some((item) => item.symbol === "KBD")).toBe(
      false,
    );
    expect(settings.nameSymbols?.some((item) => item.symbol === "KB")).toBe(
      true,
    );
  });
});
