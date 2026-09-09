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
  listEstimateRows,
  saveEstimateRows,
} from "../../src/main/services/estimateRowService";
import {
  getGeneralSheet,
  saveGeneralSheet,
} from "../../src/main/services/generalSheetService";
import type { EstimateRowDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function row(part3: string): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "1階",
    part2: "内部",
    part2Split: 0,
    formwork: "",
    part3,
    ceilingHeight: null,
    multiplier: 1,
    note: "",
    calcType: "general",
  };
}

describe("汎用計算書", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("部位別入力表の行から作り、計算表を保存して読み直せる", () => {
    const project = createProject(db, "汎用テスト");
    const [target] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("雑計算")],
    });

    const sheet = getGeneralSheet(db, target.id);
    expect(sheet.projectId).toBe(project.id);
    expect(sheet.lowerJson).toBe("[]");

    saveGeneralSheet(db, {
      id: sheet.id,
      lowerJson: '[{"id":"s1"}]',
      note: "手拾い",
    });

    const reloaded = getGeneralSheet(db, target.id);
    expect(reloaded.id).toBe(sheet.id);
    expect(reloaded.lowerJson).toBe('[{"id":"s1"}]');
    expect(reloaded.note).toBe("手拾い");
  });

  it("物件コピーで汎用計算書も複製する", () => {
    const project = createProject(db, "汎用テスト");
    const [target] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("雑計算")],
    });
    const sheet = getGeneralSheet(db, target.id);
    saveGeneralSheet(db, {
      id: sheet.id,
      lowerJson: '[{"id":"s1"}]',
      note: "手拾い",
    });

    const copied = copyProject(db, project.id, "汎用テスト（コピー）");
    const copiedRow = listEstimateRows(db, copied.id)[0];
    const copiedSheet = getGeneralSheet(db, copiedRow.id);

    expect(copiedSheet.id).not.toBe(sheet.id);
    expect(copiedSheet.projectId).toBe(copied.id);
    expect(copiedSheet.lowerJson).toBe('[{"id":"s1"}]');
    expect(copiedSheet.note).toBe("手拾い");
  });
});
