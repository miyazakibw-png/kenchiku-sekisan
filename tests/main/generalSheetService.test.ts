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
import {
  getLowerTemplate,
  saveLowerTemplate,
} from "../../src/main/services/roomSheetService";
import type { EstimateRowDraft } from "../../src/shared/types";
import {
  calcSet,
  commentSet,
  type CalcSet,
} from "../../src/core/room/calcSheet";
import { lowerTemplateFrom } from "../../src/core/room/lowerTemplate";

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

  it("新しい汎用計算書は汎用用の初期状態を使い、明細とIDを作り直す", () => {
    const project = createProject(db, "汎用初期状態");
    const [target] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("汎用A")],
    });

    const part = calcSet(1);
    part.partName = "床";
    part.details[0].name = "旧明細";
    part.lines[0].formulaA = "2*4";
    const template = lowerTemplateFrom([
      commentSet("汎用見出し", "#fef9c3"),
      part,
    ]);
    const templateJson = JSON.stringify(template);
    saveLowerTemplate(db, "general", templateJson);

    const sheet = getGeneralSheet(db, target.id);
    const sets = JSON.parse(sheet.lowerJson) as CalcSet[];
    expect(sets.map((set) => set.banner?.text ?? set.partName)).toEqual([
      "汎用見出し",
      "床",
    ]);
    expect(sets[1].details[0].name).toBe("");
    expect(sets[1].lines[0].formulaA).toBe("");
    const templateIds = new Set(
      template.flatMap((set) => [
        set.id,
        ...set.details.map((detail) => detail.id),
        ...set.lines.map((line) => line.id),
      ]),
    );
    const createdIds = sets.flatMap((set) => [
      set.id,
      ...set.details.map((detail) => detail.id),
      ...set.lines.map((line) => line.id),
    ]);
    expect(new Set(createdIds).size).toBe(createdIds.length);
    expect(createdIds.some((id) => templateIds.has(id))).toBe(false);
    expect(getLowerTemplate(db, "general")).toBe(templateJson);
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
