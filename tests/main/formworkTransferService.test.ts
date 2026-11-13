import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
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
  deleteFormworkRun,
  getFormworkTransfer,
  reorderFormworkTransfer,
  runFormworkTransfer,
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
    expect(view).toMatchObject({
      groups: [],
      runs: [],
      lastSearch: "",
    });
    expect(view).not.toHaveProperty("rules");
    expect(view).not.toHaveProperty("rows");
  });

  it("選んだ元明細の数量×掛け率で、転記入力表の最後へ自動転記する", () => {
    saveTransferRows(db, { projectId, rows: [manualRow] });
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    const result = runFormworkTransfer(db, {
      projectId,
      rules: [{ ...rule([source]), coefficient: 1.5 }],
      search: "打放補修",
    });

    const rows = listTransferRows(db, projectId);
    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe("手入力の明細");
    // 型枠分類のタイトル行（転記分は部位Ⅰ「仕上転記数量」ひとつにまとめる）
    expect(rows[1]).toMatchObject({
      name: "<打放型枠>",
      part1: "仕上転記数量",
      detailNumber: 1,
    });
    expect(rows[2]).toMatchObject({
      name: "打放型枠",
      unit: "m2",
      quantity: 18,
      formwork: "打放型枠",
      detailNumber: 2,
    });
    expect(result.created).toBe(true);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      search: "打放補修",
      current: true,
      rows: expect.any(Array),
    });
    expect(result.lastSearch).toBe("打放補修");
  });

  it("転記行ができない算出では結果を追加せず転記入力表も変えない", () => {
    saveTransferRows(db, { projectId, rows: [manualRow] });
    const before = listTransferRows(db, projectId);
    const result = runFormworkTransfer(db, {
      projectId,
      rules: [rule([])],
      search: "見つからない名称",
    });

    expect(result.created).toBe(false);
    expect(result.runs).toEqual([]);
    expect(listTransferRows(db, projectId)).toEqual(before);
  });

  it("2回算出すると結果を2回分残し、最新だけを転記入力表に入れる", () => {
    saveTransferRows(db, { projectId, rows: [manualRow] });
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    runFormworkTransfer(db, {
      projectId,
      rules: [rule([source])],
      search: "1回目",
    });
    const second = runFormworkTransfer(db, {
      projectId,
      rules: [rule([source])],
      search: "2回目",
    });

    const rows = listTransferRows(db, projectId);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.formworkKey !== "")).toHaveLength(2);
    expect(rows[2].quantity).toBe(12);
    expect(second.runs).toHaveLength(2);
    expect(second.runs.map((run) => run.search)).toEqual(["2回目", "1回目"]);
    expect(second.runs.map((run) => run.current)).toEqual([true, false]);
  });

  it("通常の再集計では転記行を作り直さず、算出し直すと新しい数量になる", () => {
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    const rules = [rule([source])];
    runFormworkTransfer(db, { projectId, rules, search: "" });
    expect(
      listTransferRows(db, projectId).find(
        (row) => row.formworkKey !== "" && row.name === "打放型枠",
      )?.quantity,
    ).toBe(12);

    const estimateRowId = db
      .select({ id: schema.projectEstimateRows.id })
      .from(schema.projectEstimateRows)
      .where(eq(schema.projectEstimateRows.projectId, projectId))
      .get()!.id;
    const rows = saveEstimateRows(db, {
      projectId,
      rows: [{ ...roomRow("機械室"), id: estimateRowId, multiplier: 2 }],
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
    expect(
      listTransferRows(db, projectId).find(
        (row) => row.formworkKey !== "" && row.name === "打放型枠",
      )?.quantity,
    ).toBe(12);
    expect(view.items.find((item) => item.name === "打放型枠")?.quantity).toBe(
      12,
    );

    runFormworkTransfer(db, { projectId, rules, search: "" });
    expect(
      listTransferRows(db, projectId).find(
        (row) => row.formworkKey !== "" && row.name === "打放型枠",
      )?.quantity,
    ).toBe(24);
    const aggregated = runAggregation(db, projectId);
    expect(
      aggregated.items.filter((item) => item.name === "打放型枠"),
    ).toHaveLength(1);
    expect(
      aggregated.items.find((item) => item.name === "打放型枠")?.quantity,
    ).toBe(24);
  });

  it("算出し直すと部位別入力表で直した型枠分類が反映される", () => {
    const freshProjectId = createProject(db, "型枠分類修正テスト").id;
    const rows = saveEstimateRows(db, {
      projectId: freshProjectId,
      rows: [{ ...roomRow("機械室"), formwork: "地下階" }],
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
    runAggregation(db, freshProjectId);

    const source = getFormworkTransfer(db, freshProjectId).sources[0].masterKey;
    const rules = [rule([source])];
    runFormworkTransfer(db, {
      projectId: freshProjectId,
      rules,
      search: "",
    });

    const originalRows = getFormworkTransfer(db, freshProjectId).runs[0].rows;
    expect(originalRows.map((row) => [row.formwork, row.name])).toEqual([
      ["地下階", "<地下階>"],
      ["地下階", "打放型枠"],
    ]);
    expect(originalRows[1].quantity).toBe(12);

    saveEstimateRows(db, {
      projectId: freshProjectId,
      rows: [{ ...roomRow("機械室"), id: rows[0].id, formwork: "基礎階" }],
    });
    const corrected = runFormworkTransfer(db, {
      projectId: freshProjectId,
      rules,
      search: "",
    });
    const correctedRows = corrected.runs[0].rows;
    expect(correctedRows.map((row) => [row.formwork, row.name])).toEqual([
      ["基礎階", "<基礎階>"],
      ["基礎階", "打放型枠"],
    ]);
    expect(correctedRows[1].quantity).toBe(12);
    expect(
      listTransferRows(db, freshProjectId).some(
        (row) => row.formwork === "地下階",
      ),
    ).toBe(false);
    expect(
      getFormworkTransfer(db, freshProjectId).runs[0].rows.some(
        (row) => row.formwork === "地下階",
      ),
    ).toBe(false);
  });

  it("③の決まりを保存せず、算出で型枠の決まりを project_transfer_rules に書かない", () => {
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    db.insert(schema.projectTransferRules)
      .values({ projectId, masterKey: "既存の決まり" })
      .run();
    const before = db
      .select()
      .from(schema.projectTransferRules)
      .where(eq(schema.projectTransferRules.ruleKind, "formwork"))
      .all();
    expect(before).toHaveLength(1);

    const result = runFormworkTransfer(db, {
      projectId,
      rules: [rule([source])],
      search: "",
    });

    expect(
      db
        .select()
        .from(schema.projectTransferRules)
        .where(eq(schema.projectTransferRules.ruleKind, "formwork"))
        .all(),
    ).toEqual(before);
    expect(result).not.toHaveProperty("rules");
  });

  it("④で並び替えると転記入力表と現行の結果が変わり、次の算出でも順を保つ", () => {
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    const rules = [
      rule([source]),
      { ...rule([source]), key: "型枠2", name: "あとの型枠" },
    ];
    runFormworkTransfer(db, { projectId, rules, search: "" });

    const view = getFormworkTransfer(db, projectId);
    // [タイトル, 打放型枠, あとの型枠] → あとの型枠を上へ
    const moved = [
      view.runs[0].rows[0],
      view.runs[0].rows[2],
      view.runs[0].rows[1],
    ].map((row, index) => ({ ...row, detailNumber: index + 1 }));
    reorderFormworkTransfer(db, projectId, moved);

    const rows = listTransferRows(db, projectId);
    expect(rows.map((row) => row.name)).toEqual([
      "<打放型枠>",
      "あとの型枠",
      "打放型枠",
    ]);
    expect(
      getFormworkTransfer(db, projectId).runs[0].rows.map((row) => row.name),
    ).toEqual(["<打放型枠>", "あとの型枠", "打放型枠"]);

    runFormworkTransfer(db, { projectId, rules, search: "" });
    expect(listTransferRows(db, projectId).map((row) => row.name)).toEqual([
      "<打放型枠>",
      "あとの型枠",
      "打放型枠",
    ]);
    expect(
      getFormworkTransfer(db, projectId).runs[0].rows.map((row) => row.name),
    ).toEqual(["<打放型枠>", "あとの型枠", "打放型枠"]);
  });

  it("算出結果だけを消し、転記入力表の行は残して最新検索文字を返す", () => {
    const source = getFormworkTransfer(db, projectId).sources[0].masterKey;
    runFormworkTransfer(db, {
      projectId,
      rules: [rule([source])],
      search: "前の検索",
    });
    const firstId = getFormworkTransfer(db, projectId).runs[0].id;
    runFormworkTransfer(db, {
      projectId,
      rules: [rule([source])],
      search: "最新の検索",
    });
    const secondView = getFormworkTransfer(db, projectId);
    const secondId = secondView.runs[0].id;
    const transferRows = listTransferRows(db, projectId);

    const afterDeleteCurrent = deleteFormworkRun(db, {
      projectId,
      runId: secondId,
    });
    expect(afterDeleteCurrent.runs).toHaveLength(1);
    expect(afterDeleteCurrent.runs[0].current).toBe(false);
    expect(afterDeleteCurrent.lastSearch).toBe("前の検索");
    expect(listTransferRows(db, projectId)).toEqual(transferRows);

    const afterDeleteOld = deleteFormworkRun(db, {
      projectId,
      runId: firstId,
    });
    expect(afterDeleteOld.runs).toEqual([]);
    expect(afterDeleteOld.lastSearch).toBe("");
    expect(listTransferRows(db, projectId)).toEqual(transferRows);
  });
});
