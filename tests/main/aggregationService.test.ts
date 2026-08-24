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
import { saveTransferRows } from "../../src/main/services/transferRowService";
import {
  collectEstimateRowChecks,
  getAggregate,
  listAggregateRuns,
  runAggregation,
  saveAggregateEdits,
} from "../../src/main/services/aggregationService";
import { listTransferRows } from "../../src/main/services/transferRowService";
import {
  listDetailChangeLogs,
  listDetails,
  saveDetails,
} from "../../src/main/services/detailService";
import type {
  EstimateRowDraft,
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

function roomRow(part3: string, multiplier: number): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "建築",
    part2: "1階",
    part2Split: 1,
    formwork: "",
    part3,
    ceilingHeight: 2.5,
    multiplier,
    note: "",
    calcType: "room",
  };
}

/** 4m×3m の部屋（床面積12m2）と、床仕上1明細のセット */
const SHAPE_JSON = JSON.stringify({
  edges: [
    { id: "e1", direction: "E", length: 4, kind: "wall" },
    { id: "e2", direction: "S", length: 3, kind: "wall" },
    { id: "e3", direction: "W", length: 4, kind: "wall" },
    { id: "e4", direction: "N", length: 3, kind: "wall" },
  ],
});

function lowerJson(coefficient: number): string {
  return JSON.stringify([
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
          materialCategory: "仕上",
          partName: "",
          name: "ビニル床シート",
          descriptionUpper: "",
          descriptionLower: "t=2.0",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
          estimateDisplay: "",
          coefficient,
        },
      ],
      lines: [
        { id: "l1", formulaA: "FA", formulaB: "", comment: "", bSymbol: "" },
      ],
    },
  ]);
}

function transferDraft(quantity: number): TransferRowDraft {
  return {
    id: null,
    part1: "建築",
    part2: "1階",
    part2Split: 1,
    formwork: "",
    part3: "事務室",
    subjectId: 5,
    materialCategory: "仕上",
    partId: 10,
    partName: "床",
    detailNumber: 1.01,
    name: "ビニル床シート",
    sourceDetailId: null,
    descriptionUpper: "",
    descriptionLower: "t=2.0",
    quantity,
    unit: "m2",
    unitPrice: null,
    amount: null,
    remarks: "",
    memo: "",
  };
}

describe("集計処理", () => {
  let db: AppDatabase;
  let projectId: number;
  /** 部位別入力表は画面の全行を保存するので、既存行に足して保存する */
  let drafts: EstimateRowDraft[] = [];

  beforeEach(() => {
    db = createDb();
    projectId = createProject(db, "集計テスト").id;
    drafts = [];
  });

  function addRoom(
    part3: string,
    multiplier: number,
    coefficient: number,
  ): void {
    drafts = [...drafts, roomRow(part3, multiplier)];
    const rows = saveEstimateRows(db, { projectId, rows: drafts });
    drafts = rows.map((row) => ({
      ...roomRow(row.part3, row.multiplier),
      id: row.id,
    }));
    const row = rows[rows.length - 1];
    const sheet = getRoomSheet(db, row.id);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: lowerJson(coefficient),
      ceilingHeight: 2.5,
      note: "",
    });
  }

  it("計算書の累計×掛け率×倍率を集計書兼工事マスターに計上する", () => {
    addRoom("事務室", 2, 1.05);

    const view = runAggregation(db, projectId);
    expect(view.items).toHaveLength(1);
    // 床面積12m2 × 掛け率1.05 × 倍率2
    expect(view.items[0].quantity).toBe(25.2);
    expect(view.items[0].partName).toBe("床");
    expect(view.items[0].name).toBe("ビニル床シート");
    expect(view.items[0].rooms).toEqual([
      { roomName: "1階：事務室 × 2", quantity: 25.2 },
    ]);
  });

  it("部位別入力表のチェック列は行ごとに部位別の名称と数量を返す", () => {
    addRoom("事務室", 2, 1.05);
    const rowId = drafts[drafts.length - 1].id;

    const checks = collectEstimateRowChecks(db, projectId, "仕上");
    expect(checks).toHaveLength(1);
    expect(checks[0].estimateRowId).toBe(rowId);
    expect(checks[0].cells).toEqual([
      { partName: "床", name: "ビニル床シート", quantity: 25.2 },
    ]);

    // 材種区分が違うときは拾わない
    expect(collectEstimateRowChecks(db, projectId, "下地")).toEqual([]);
  });

  it("同じ明細は部屋をまたいで合算し、根拠は1件ずつ残す", () => {
    addRoom("事務室", 1, 1);
    addRoom("会議室", 1, 1);

    const view = runAggregation(db, projectId);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(24);
    expect(view.details).toHaveLength(2);
    expect(
      view.details.every((d) => d.masterKey === view.items[0].masterKey),
    ).toBe(true);
    expect(view.details.map((detail) => detail.part3)).toEqual([
      "事務室",
      "会議室",
    ]);
  });

  it("転記入力表は集計書に計上するが根拠（部屋別）には出さない", () => {
    addRoom("事務室", 1, 1);
    saveTransferRows(db, { projectId, rows: [transferDraft(3)] });

    const view = runAggregation(db, projectId);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(15);
    expect(view.items[0].rooms).toEqual([
      { roomName: "1階：事務室", quantity: 12 },
    ]);
    expect(
      view.details.filter((detail) => detail.sourceKind === "transfer"),
    ).toHaveLength(1);
  });

  it("集計をかけ直しても過去の回は消さず、版として残す", () => {
    addRoom("事務室", 1, 1);
    const first = runAggregation(db, projectId);
    addRoom("会議室", 1, 1);
    const second = runAggregation(db, projectId);

    expect(second.run?.id).not.toBe(first.run?.id);
    expect(listAggregateRuns(db, projectId)).toHaveLength(2);
    // 既定は最新の回
    expect(getAggregate(db, projectId).run?.id).toBe(second.run?.id);
    // 過去の回もそのまま読める
    const old = getAggregate(db, projectId, first.run?.id);
    expect(old.items[0].quantity).toBe(12);
    expect(second.items[0].quantity).toBe(24);
  });

  it("計算書を直したあとは、集計書を開いたときに自動でかけ直す", () => {
    addRoom("事務室", 1, 1);
    const first = runAggregation(db, projectId);
    expect(first.items[0].quantity).toBe(12);

    // 集計をかけずに計算書だけ足した状態
    addRoom("会議室", 1, 1);

    const view = getAggregate(db, projectId);
    expect(view.run?.id).not.toBe(first.run?.id);
    expect(view.items[0].quantity).toBe(24);
    // 変わっていなければ版は増やさない
    expect(getAggregate(db, projectId).run?.id).toBe(view.run?.id);
    // 過去の回はそのまま読める
    expect(getAggregate(db, projectId, first.run?.id).items[0].quantity).toBe(
      12,
    );
  });

  it("集計書で直した内容を計算書へ書き戻し、集計し直す", () => {
    addRoom("事務室", 1, 1);
    const before = runAggregation(db, projectId);

    const after = saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 7,
          materialCategory: "仕上",
          partNumber: 10,
          partName: "床",
          detailNumber: 1.02,
          name: "長尺塩ビシート",
          descriptionUpper: "",
          descriptionLower: "t=2.5",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    expect(after.items).toHaveLength(1);
    expect(after.items[0].subjectId).toBe(7);
    expect(after.items[0].name).toBe("長尺塩ビシート");
    expect(after.items[0].detailNumber).toBe(1.02);
    expect(after.items[0].quantity).toBe(12);
    // 集計をかけ直しても直した内容のまま（計算書に入っている）
    expect(runAggregation(db, projectId).items[0].name).toBe("長尺塩ビシート");
  });

  it("集計書で直した内容を転記入力表へ書き戻す", () => {
    saveTransferRows(db, { projectId, rows: [transferDraft(3)] });
    const before = runAggregation(db, projectId);

    saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 5,
          materialCategory: "仕上",
          partNumber: 10,
          partName: "床",
          detailNumber: 1.01,
          name: "タイルカーペット",
          descriptionUpper: "",
          descriptionLower: "t=6.5",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    const rows = listTransferRows(db, projectId);
    expect(rows[0].name).toBe("タイルカーペット");
    expect(rows[0].descriptionLower).toBe("t=6.5");
  });

  it("同じ明細マスターから拾った行は、まとめて直せる", () => {
    const saved = saveDetails(db, {
      subjectId: 5,
      projectId,
      rows: [
        {
          id: null,
          detailNumber: 1.01,
          materialCategory: "仕上",
          partName: "床",
          name: "ビニル床タイル",
          descriptionUpper: "",
          descriptionLower: "3.0 コンクリート面",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
          estimateDisplay: "",
          isActive: true,
        },
      ],
      deletedIds: [],
    });
    const detailId = saved[0].id;
    saveTransferRows(db, {
      projectId,
      rows: [
        {
          ...transferDraft(14.57),
          name: "ビニル床タイル",
          sourceDetailId: detailId,
        },
        {
          ...transferDraft(32.63),
          name: "ビニル床タイル",
          descriptionUpper: "東リ:ロイヤルウッド 同等",
          sourceDetailId: detailId,
        },
      ],
    });
    const before = runAggregation(db, projectId);
    // 摘要（上）が違うので、同じ明細でも集計書では2行に分かれる
    expect(before.items).toHaveLength(2);

    const after = saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      applyToSameDetail: true,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 5,
          materialCategory: "仕上",
          partNumber: 10,
          partName: "床",
          detailNumber: 1.01,
          name: "ビニル床タイル",
          descriptionUpper: "東リ:ロイヤルウッド 同等",
          descriptionLower: "3.0 コンクリート面",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    expect(after.items).toHaveLength(1);
    expect(after.items[0].descriptionUpper).toBe("東リ:ロイヤルウッド 同等");
    expect(after.items[0].quantity).toBe(47.2);
  });

  it("集計書で直しても物件専用の明細マスターは変わらない", () => {
    const saved = saveDetails(db, {
      subjectId: 5,
      projectId,
      rows: [
        {
          id: null,
          detailNumber: 1.01,
          materialCategory: "仕上",
          partName: "床",
          name: "ビニル床シート",
          descriptionUpper: "",
          descriptionLower: "t=2.0",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
          estimateDisplay: "",
          isActive: true,
        },
      ],
      deletedIds: [],
    });
    saveTransferRows(db, {
      projectId,
      rows: [{ ...transferDraft(3), sourceDetailId: saved[0].id }],
    });
    const before = runAggregation(db, projectId);

    saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 5,
          materialCategory: "仕上",
          partNumber: 10,
          partName: "床",
          detailNumber: 1.01,
          name: "タイルカーペット",
          descriptionUpper: "",
          descriptionLower: "t=6.5",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    expect(listDetails(db, 5, projectId)[0].name).toBe("ビニル床シート");
    expect(
      listDetailChangeLogs(db, projectId).filter(
        (log) => log.changeKind === "edit",
      ),
    ).toHaveLength(0);
  });

  it("小計行は集計しない", () => {
    addRoom("事務室", 1, 1);
    const rows = saveEstimateRows(db, {
      projectId,
      rows: [...drafts, { ...roomRow("小計", 0), rowType: "subtotal" }],
    });
    expect(rows).toHaveLength(2);

    const view = runAggregation(db, projectId);
    expect(view.details).toHaveLength(1);
  });
});
