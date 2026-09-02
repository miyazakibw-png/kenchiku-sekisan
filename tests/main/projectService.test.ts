import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import { saveAssembly } from "../../src/main/services/assemblyService";
import {
  copyProject,
  createProject,
  getProject,
  listProjectLedger,
  reorderProjects,
  saveProject,
  saveProjectFields,
} from "../../src/main/services/projectService";
import type { AssemblyItem } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function item(db: AppDatabase, name: string): AssemblyItem {
  const subject = listProjectSubjectId(db);
  return {
    id: null,
    sourceDetailId: null,
    subjectId: subject,
    partNumber: null,
    detailNumber: null,
    materialCategory: "仕上",
    partName: "",
    name,
    descriptionUpper: "",
    descriptionLower: "",
    unit: "m2",
    remarksUpper: "",
    remarksLower: "",
    estimateDisplay: "",
    formula: "",
    coefficient: 1,
  };
}

function listProjectSubjectId(db: AppDatabase): number {
  const row = db.select().from(schema.mSubjects).all()[0];
  return row.id;
}

let db: AppDatabase;

beforeEach(() => {
  db = createDb();
});

describe("物件管理台帳", () => {
  it("新規作成で管理番号を自動採番し、作成日を日付に入れる", () => {
    const first = createProject(db, "A工事");
    const second = createProject(db, "B工事");

    expect(first.managementNo).toBe("P-0001");
    expect(second.managementNo).toBe("P-0002");
    expect(first.projectDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("管理番号以外を更新でき、台帳と工事概要で同じ内容を返す", () => {
    const created = createProject(db, "A工事");
    const saved = saveProject(db, {
      id: created.id,
      projectDate: "2026-08-17",
      name: "A工事（改）",
      builderName: "○○建設",
      designerName: "△△設計",
      note: "メモ",
      fieldValues: {},
      marks: [],
    });

    expect(saved.managementNo).toBe(created.managementNo);
    expect(getProject(db, created.id)).toEqual(saved);
    expect(saved.name).toBe("A工事（改）");
    expect(saved.builderName).toBe("○○建設");
  });

  it("作成順と関係なく並べ替えでき、その順序で一覧を返す", () => {
    const a = createProject(db, "A工事");
    const b = createProject(db, "B工事");
    const c = createProject(db, "C工事");

    reorderProjects(db, [c.id, a.id, b.id]);

    expect(listProjectLedger(db).projects.map((p) => p.name)).toEqual([
      "C工事",
      "A工事",
      "B工事",
    ]);
  });

  it("既存物件のコピーは新しい管理番号を採番し、物件専用セットも独立して複製する", () => {
    const source = createProject(db, "A工事");
    saveAssembly(db, {
      id: null,
      scope: "project",
      projectId: source.id,
      note: "",
      items: [item(db, "ビニル床シート")],
    });

    const copied = copyProject(db, source.id, "A工事（コピー）");

    expect(copied.managementNo).not.toBe(source.managementNo);
    expect(copied.name).toBe("A工事（コピー）");

    const sourceAssemblies = db
      .select()
      .from(schema.mFinishAssemblies)
      .all()
      .filter((row) => row.projectId === source.id);
    const copiedAssemblies = db
      .select()
      .from(schema.mFinishAssemblies)
      .all()
      .filter((row) => row.projectId === copied.id);

    expect(copiedAssemblies).toHaveLength(1);
    expect(copiedAssemblies[0].id).not.toBe(sourceAssemblies[0].id);
  });

  it("ユーザー定義列を追加し、物件ごとに値を保存できる", () => {
    const fields = saveProjectFields(db, [
      { id: 0, title: "担当者", displayWidth: 30, displayOrder: 1 },
    ]);
    const project = createProject(db, "A工事");

    const saved = saveProject(db, {
      id: project.id,
      projectDate: project.projectDate,
      name: project.name,
      builderName: "",
      designerName: "",
      note: "",
      fieldValues: { [fields[0].id]: "宮崎" },
      marks: [],
    });

    expect(fields[0].displayWidth).toBe(30);
    expect(saved.fieldValues[fields[0].id]).toBe("宮崎");
    expect(listProjectLedger(db).fields).toHaveLength(1);
  });
});
