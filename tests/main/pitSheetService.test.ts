import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { calcSet, commentSet, type CalcSet } from "../../src/core/room/calcSheet";
import { lowerTemplateFrom } from "../../src/core/room/lowerTemplate";
import type { AppDatabase } from "../../src/main/db";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import { createProject } from "../../src/main/services/projectService";
import { saveEstimateRows } from "../../src/main/services/estimateRowService";
import {
  getLowerTemplate,
  saveLowerTemplate,
} from "../../src/main/services/roomSheetService";
import { getPitSheet } from "../../src/main/services/pitSheetService";
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
    calcType: "pit",
  };
}

describe("ピット計算書", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("初期状態が無ければ空で始まり、保存後の新しい計算書だけに適用する", () => {
    const project = createProject(db, "ピット初期状態");
    const rows = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("ピットA"), row("ピットB"), row("ピットC")],
    });

    const emptySheet = getPitSheet(db, rows[0].id);
    expect(emptySheet.lowerJson).toBe("[]");

    const part = calcSet(1);
    part.partName = "基礎";
    part.details[0].name = "旧明細";
    part.lines[0].formulaA = "5*2";
    const template = lowerTemplateFrom([
      commentSet("ピット見出し", "#dcfce7"),
      part,
    ]);
    const templateJson = JSON.stringify(template);
    saveLowerTemplate(db, "pit", templateJson);

    const sheet = getPitSheet(db, rows[1].id);
    const sets = JSON.parse(sheet.lowerJson) as CalcSet[];
    expect(sets.map((set) => set.banner?.text ?? set.partName)).toEqual([
      "ピット見出し",
      "基礎",
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
    expect(getPitSheet(db, rows[0].id).lowerJson).toBe("[]");
    expect(getLowerTemplate(db, "pit")).toBe(templateJson);

    saveLowerTemplate(db, "pit", "{invalid");
    expect(getPitSheet(db, rows[2].id).lowerJson).toBe("[]");
  });
});
