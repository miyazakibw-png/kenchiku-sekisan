import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import { createProject } from "../../src/main/services/projectService";
import { saveEstimateRows } from "../../src/main/services/estimateRowService";
import {
  getRoomSheet,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import {
  listTransferRows,
  saveTransferRows,
} from "../../src/main/services/transferRowService";
import { runAggregation } from "../../src/main/services/aggregationService";
import {
  getFormworkTransfer,
  runFormworkTransfer,
  saveFormworkRules,
} from "../../src/main/services/formworkTransferService";
import type {
  EstimateRowDraft,
  FormworkTransferRule,
  TransferRowDraft,
} from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

/** 4m×3m の部屋（床面積12m2）に型枠分類を付けた行 */
const SHAPE_JSON = JSON.stringify({
  edges: [
    { id: "e1", direction: "E", length: 4, kind: "wall" },
    { id: "e2", direction: "S", length: 3, kind: "wall" },
    { id: "e3", direction: "W", length: 4, kind: "wall" },
    { id: "e4", direction: "N", length: 3, kind: "wall" },
  ],
});

const LOWER_JSON = JSON.stringify([
  {
    id: "s1",
    partNumber: 10,
    partName: "床",
    details: [
      {
        id: "d1",
        sourceDetailId: null,
        subjectId: 5,
        detailNumber: 1.01,
        materialCategory: "躯体",
        partName: "",
        name: "コンクリート",
        descriptionUpper: "",
        descriptionLower: "",
        unit: "m3",
        remarksUpper: "",
        remarksLower: "",
        estimateDisplay: "",
        coefficient: 1,
      },
    ],
    lines: [
      { id: "l1", formulaA: "FA", formulaB: "", comment: "", bSymbol: "" },
    ],
  },
]);

function roomRow(part3: string): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "建築",
    part2: "1階",
    part2Split: 1,
    formwork: "打放型枠",
    part3,
    ceilingHeight: 2.5,
    multiplier: 1,
    note: "",
    calcType: "room",
  };
}

/** 元明細（コンクリート）を選んで打放型枠を算出するルール */
function rule(sourceKeys: string[]): FormworkTransferRule {
  return {
    key: "型枠1",
    sourceKeys,
    coefficient: 1,
    subjectId: 5,
    materialCategory: "型枠",
    name: "打放型枠",
    description: "合板型枠",
    descriptionLower: "",
    unit: "m2",
    remarks: "",
  };
}

const manualRow: TransferRowDraft = {
  id: null,
  part1: "建築",
  part2: "1階",
  part2Split: 1,
  formwork: "",
  part3: "",
  subjectId: 5,
  materialCategory: "仕上",
  partId: 10,
  partName: "床",
  detailNumber: 1.01,
  name: "手入力の明細",
  sourceDetailId: null,
  descriptionUpper: "",
  descriptionLower: "",
  quantity: 3,
  unit: "m2",
  unitPrice: null,
  amount: null,
  remarks: "",
  remarksLower: "",
  memo: "",
};

describe("型枠転記", () => {
  let db: AppDatabase;
  let projectId: number;

  beforeEach(() => {
    db = createDb();
    projectId = createProject(db, "型枠転記テスト").id;
    const rows = saveEstimateRows(db, { projectId, rows: [roomRow("機械室")] });
    const sheet = getRoomSheet(db, rows[0].id);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: LOWER_JSON,
      ceilingHeight: 2.5,
      note: "",
    });
    runAggregation(db, projectId);
  });

  it("集計書兼工事マスターの明細から元明細を選べる（まだ行は作らない）", () => {
    const view = getFormworkTransfer(db, projectId);
    expect(view.sources).toHaveLength(1);
    expect(view.sources[0]).toMatchObject({
      name: "コンクリート",
      quantity: 12,
    });
    expect(view.rules).toEqual([]);
    expect(view.rows).toEqual([]);
  });

  it("選んだ元明細の数量×掛け率で、転記入力表の最後へ自動転記する", () => {
    saveTransferRows(db, { projectId, rows: [manualRow] });
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    saveFormworkRules(db, {
      projectId,
      rules: [{ ...rule([source]), coefficient: 1.5 }],
    });

    runFormworkTransfer(db, projectId);
    const rows = listTransferRows(db, projectId);
    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe("手入力の明細");
    // 型枠分類のタイトル行（部位Ⅰの代わり）
    expect(rows[1]).toMatchObject({
      name: "<打放型枠>",
      part1: "打放型枠",
      detailNumber: 1,
    });
    expect(rows[2]).toMatchObject({
      name: "打放型枠",
      unit: "m2",
      quantity: 18,
      formwork: "打放型枠",
      detailNumber: 2,
    });
  });

  it("転記し直しても二重にならず、手入力の行は残す", () => {
    saveTransferRows(db, { projectId, rows: [manualRow] });
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    saveFormworkRules(db, { projectId, rules: [rule([source])] });
    runFormworkTransfer(db, projectId);
    runFormworkTransfer(db, projectId);

    const rows = listTransferRows(db, projectId);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.formworkKey !== "")).toHaveLength(2);
    expect(rows[2].quantity).toBe(12);
  });

  it("計算書を直して集計をかけ直すと、型枠数量も作り直す", () => {
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    saveFormworkRules(db, { projectId, rules: [rule([source])] });
    runFormworkTransfer(db, projectId);
    expect(listTransferRows(db, projectId)[1].quantity).toBe(12);

    // 部屋を倍にする（数量が12→24になる）
    const rows = saveEstimateRows(db, {
      projectId,
      rows: [{ ...roomRow("機械室"), id: null, multiplier: 2 }],
    });
    const sheet = getRoomSheet(db, rows[0].id);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: LOWER_JSON,
      ceilingHeight: 2.5,
      note: "",
    });

    const view = runAggregation(db, projectId);
    expect(listTransferRows(db, projectId)[1].quantity).toBe(24);
    // 集計書兼工事マスターにも型枠明細が載る
    expect(view.items.filter((item) => item.name === "打放型枠")).toHaveLength(
      1,
    );
    expect(view.items.find((item) => item.name === "打放型枠")?.quantity).toBe(
      24,
    );
  });
});
