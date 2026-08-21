import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import {
  copyProject,
  createProject,
} from "../../src/main/services/projectService";
import {
  listTransferRows,
  saveTransferRows,
} from "../../src/main/services/transferRowService";
import type { TransferRowDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function draft(name: string, quantity: number | null): TransferRowDraft {
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
    descriptionLower: "t=12",
    quantity,
    unit: "m2",
    unitPrice: null,
    amount: null,
    remarks: "備考",
    memo: "メモ",
  };
}

describe("転記入力表", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("保存して読み直せる（行順は表示順で保持する）", () => {
    const project = createProject(db, "転記テスト");
    const saved = saveTransferRows(db, {
      projectId: project.id,
      rows: [draft("ビニル床シート", 12.5), draft("巾木", 20)],
    });

    expect(saved).toHaveLength(2);
    expect(saved.map((row) => row.displayOrder)).toEqual([0, 1]);
    const [first] = listTransferRows(db, project.id);
    expect(first.name).toBe("ビニル床シート");
    expect(first.quantity).toBe(12.5);
    expect(first.memo).toBe("メモ");
    expect(first.unitPrice).toBeNull();
    expect(first.amount).toBeNull();
  });

  it("画面から消えた行だけを削除し、残した行は更新する", () => {
    const project = createProject(db, "転記テスト");
    const saved = saveTransferRows(db, {
      projectId: project.id,
      rows: [draft("床", 1), draft("壁", 2)],
    });

    const kept = saveTransferRows(db, {
      projectId: project.id,
      rows: [{ ...saved[1], id: saved[1].id, quantity: 3 }],
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(saved[1].id);
    expect(kept[0].quantity).toBe(3);
  });

  it("物件コピーで転記入力表も複製し、コピー元と切り離す", () => {
    const project = createProject(db, "コピー元");
    saveTransferRows(db, {
      projectId: project.id,
      rows: [draft("床", 5)],
    });

    const copied = copyProject(db, project.id, "コピー先");
    const copiedRows = listTransferRows(db, copied.id);
    expect(copiedRows).toHaveLength(1);
    expect(copiedRows[0].name).toBe("床");

    saveTransferRows(db, {
      projectId: copied.id,
      rows: [{ ...copiedRows[0], id: copiedRows[0].id, name: "変更後" }],
    });
    expect(listTransferRows(db, project.id)[0].name).toBe("床");
  });
});
