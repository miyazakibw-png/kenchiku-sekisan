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
  getAggregate,
  listAggregateRuns,
  runAggregation,
} from "../../src/main/services/aggregationService";
import type { EstimateRowDraft, TransferRowDraft } from "../../src/shared/types";

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

  function addRoom(part3: string, multiplier: number, coefficient: number): void {
    drafts = [...drafts, roomRow(part3, multiplier)];
    const rows = saveEstimateRows(db, { projectId, rows: drafts });
    drafts = rows.map((row) => ({ ...roomRow(row.part3, row.multiplier), id: row.id }));
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

  it("同じ明細は部屋をまたいで合算し、根拠は1件ずつ残す", () => {
    addRoom("事務室", 1, 1);
    addRoom("会議室", 1, 1);

    const view = runAggregation(db, projectId);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(24);
    expect(view.details).toHaveLength(2);
    expect(view.details.every((d) => d.masterKey === view.items[0].masterKey)).toBe(
      true,
    );
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
