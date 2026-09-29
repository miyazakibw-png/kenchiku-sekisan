import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import { createProject } from "../../src/main/services/projectService";
import { saveTransferRows } from "../../src/main/services/transferRowService";
import {
  deleteAggregateManualItem,
  getAggregate,
  insertAggregateManualItem,
  runAggregation,
  saveAggregateEdits,
} from "../../src/main/services/aggregationService";
import type { TransferRowDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function draft(name: string): TransferRowDraft {
  return {
    id: null,
    part1: "1階",
    part2: "内部",
    part2Split: 1,
    formwork: "",
    part3: "事務室",
    subjectId: null,
    materialCategory: "仕上",
    partId: 10,
    partName: "床",
    detailNumber: 1.01,
    name,
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
}

describe("集計書へ手で挿入した明細行", () => {
  let db: AppDatabase;
  let projectId: number;

  beforeEach(() => {
    db = createDb();
    projectId = createProject(db, "手入力テスト").id;
    saveTransferRows(db, {
      projectId,
      rows: [draft("ビニル床シート"), draft("巾木")],
    });
  });

  it("選んだ行の直後に挿入され、集計をかけ直しても残る", () => {
    const view = runAggregation(db, projectId);
    expect(view.items).toHaveLength(2);
    const after = insertAggregateManualItem(db, {
      projectId,
      runId: view.run!.id,
      afterMasterKey: view.items[0].masterKey,
    });
    expect(after.items).toHaveLength(3);
    expect(after.items[1].manual).toBe(true);
    expect(after.items[1].name).toBe("");
    // 欄はアンカーから写す
    expect(after.items[1].part1).toBe("1階");
    expect(after.items[1].partName).toBe("床");

    // もう一度集計しても同じ位置に残る
    const again = runAggregation(db, projectId);
    expect(again.items).toHaveLength(3);
    expect(again.items[1].masterKey).toBe(after.items[1].masterKey);
    expect(getAggregate(db, projectId).items[1].manual).toBe(true);
  });

  it("手入力行を直すと手入力テーブルだけが更新され、数量も入る", () => {
    const view = insertAggregateManualItem(db, {
      projectId,
      runId: runAggregation(db, projectId).run!.id,
      afterMasterKey: runAggregation(db, projectId).items[0].masterKey,
    });
    const manual = view.items[1];
    const saved = saveAggregateEdits(db, {
      projectId,
      runId: view.run!.id,
      edits: [
        {
          masterKey: manual.masterKey,
          subjectId: manual.subjectId,
          materialCategory: manual.materialCategory,
          partNumber: manual.partNumber,
          partName: manual.partName,
          detailNumber: 1.99,
          name: "説明文",
          descriptionUpper: "",
          descriptionLower: "メーカー名 品番A 色白 形状L",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "挿入",
          quantity: 7.5,
        },
      ],
    });
    const edited = saved.items[1];
    expect(edited.name).toBe("説明文");
    expect(edited.descriptionLower).toBe("メーカー名 品番A 色白 形状L");
    expect(edited.quantity).toBe(7.5);
    expect(edited.detailNumber).toBe(1.99);
    // 直しても masterKey（manual:N）は変わらず位置も同じ
    expect(edited.masterKey).toBe(manual.masterKey);
    expect(saved.items[0].name).toBe("ビニル床シート");
  });

  it("アンカー行を直してキーが変わっても、手入力行はその直後に付いていく", () => {
    const view = runAggregation(db, projectId);
    const anchor = view.items[0];
    insertAggregateManualItem(db, {
      projectId,
      runId: view.run!.id,
      afterMasterKey: anchor.masterKey,
    });
    const saved = saveAggregateEdits(db, {
      projectId,
      runId: view.run!.id,
      edits: [
        {
          masterKey: anchor.masterKey,
          subjectId: anchor.subjectId,
          materialCategory: anchor.materialCategory,
          partNumber: anchor.partNumber,
          partName: anchor.partName,
          detailNumber: anchor.detailNumber,
          name: "改名シート",
          descriptionUpper: anchor.descriptionUpper,
          descriptionLower: anchor.descriptionLower,
          unit: anchor.unit,
          remarksUpper: anchor.remarksUpper,
          remarksLower: anchor.remarksLower,
        },
      ],
    });
    const manualIndex = saved.items.findIndex((i) => i.manual);
    expect(manualIndex).toBeGreaterThan(0);
    expect(saved.items[manualIndex - 1].name).toBe("改名シート");
  });

  it("手入力行を消すと集計からも消える（不要の印も消す）", () => {
    const view = insertAggregateManualItem(db, {
      projectId,
      runId: runAggregation(db, projectId).run!.id,
      afterMasterKey: runAggregation(db, projectId).items[0].masterKey,
    });
    const manual = view.items[1];
    const after = deleteAggregateManualItem(db, {
      projectId,
      masterKey: manual.masterKey,
    });
    expect(after.items).toHaveLength(2);
    expect(after.items.every((i) => !i.manual)).toBe(true);
  });
});
