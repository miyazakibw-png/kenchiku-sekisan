import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import {
  listSubjects,
  renumberSubjects,
  saveSubjects,
} from "../../src/main/services/subjectService";
import { saveDetails } from "../../src/main/services/detailService";
import type { SubjectDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function drafts(db: AppDatabase): SubjectDraft[] {
  return listSubjects(db).map((subject) => ({
    id: subject.id,
    name: subject.name,
    skipPart2: subject.skipPart2,
    aggregateOrder: subject.aggregateOrder,
    note: subject.note,
    spare1: subject.spare1,
    spare2: subject.spare2,
  }));
}

function addDetail(db: AppDatabase, subjectId: number): void {
  saveDetails(db, {
    subjectId,
    rows: [
      {
        id: null,
        detailNumber: 1,
        materialCategory: "仕上",
        partName: "",
        name: "テスト明細",
        descriptionUpper: "",
        descriptionLower: "",
        unit: "m2",
        remarksUpper: "",
        remarksLower: "",
        estimateDisplay: "",
        isActive: true,
      },
    ],
    deletedIds: [],
  });
}

function eqSubject(subjectId: number): ReturnType<typeof eq> {
  return eq(schema.mDetails.subjectId, subjectId);
}

let db: AppDatabase;

beforeEach(() => {
  db = createDb();
});

describe("工種科目マスター", () => {
  it("部位Ⅱ仕分け不要・備考を保存する（集計順は列のみ用意して未使用）", () => {
    const rows = drafts(db);
    rows[0] = { ...rows[0], skipPart2: 1, note: "軽鉄は仕分け不要" };
    const saved = saveSubjects(db, rows);
    expect(saved.subjects[0].skipPart2).toBe(1);
    expect(saved.subjects[0].note).toBe("軽鉄は仕分け不要");
    expect(saved.subjects[0].aggregateOrder).toBe(1);
  });

  it("行を挿入すると以降の科目IDが繰り下がっても既存明細は同じ科目に残る", () => {
    const before = listSubjects(db);
    const third = before[2];
    addDetail(db, third.id);

    const rows = drafts(db);
    rows.splice(2, 0, {
      id: null,
      name: "挿入した科目",
      skipPart2: 0,
      aggregateOrder: 1,
      note: "",
      spare1: "",
      spare2: "",
    });
    const saved = saveSubjects(db, rows);

    const moved = saved.subjects.find((subject) => subject.name === third.name);
    expect(moved?.code).toBe("04");
    expect(moved?.id).toBe(4);
    const details = db
      .select()
      .from(schema.mDetails)
      .where(eqSubject(moved?.id ?? -1))
      .all();
    expect(details).toHaveLength(1);
  });

  it("科目名を変えても明細は改名した科目に付いたまま、新規作成した同名科目は空になる", () => {
    const before = listSubjects(db);
    const target = before[2];
    addDetail(db, target.id);

    const rows = drafts(db);
    rows[2] = { ...rows[2], name: `${target.name}-2` };
    rows.splice(3, 0, {
      id: null,
      name: target.name,
      skipPart2: 0,
      aggregateOrder: 1,
      note: "",
      spare1: "",
      spare2: "",
    });
    const saved = saveSubjects(db, rows);

    const renamed = saved.subjects.find(
      (subject) => subject.name === `${target.name}-2`,
    );
    const created = saved.subjects.find(
      (subject) => subject.name === target.name,
    );
    expect(renamed).toBeDefined();
    expect(created).toBeDefined();
    expect(
      db
        .select()
        .from(schema.mDetails)
        .where(eqSubject(renamed?.id ?? -1))
        .all(),
    ).toHaveLength(1);
    expect(
      db
        .select()
        .from(schema.mDetails)
        .where(eqSubject(created?.id ?? -1))
        .all(),
    ).toHaveLength(0);
  });

  it("明細が登録済みの科目は削除できず末尾へ回る", () => {
    const before = listSubjects(db);
    const target = before[1];
    addDetail(db, target.id);

    const rows = drafts(db).filter((row) => row.id !== target.id);
    const saved = saveSubjects(db, rows);

    expect(saved.blockedDeletes).toContain(target.name);
    const kept = saved.subjects.find((subject) => subject.name === target.name);
    expect(kept).toBeDefined();
    expect(saved.subjects[saved.subjects.length - 1].name).toBe(target.name);
  });

  it("明細の無い科目は削除できる", () => {
    const before = listSubjects(db);
    const rows = drafts(db).filter((row) => row.id !== before[0].id);
    const saved = saveSubjects(db, rows);
    expect(saved.blockedDeletes).toHaveLength(0);
    expect(
      saved.subjects.some((subject) => subject.name === before[0].name),
    ).toBe(false);
    expect(saved.subjects[0].code).toBe("01");
  });
});

describe("科目IDの行位置合わせ", () => {
  it("途中に科目を挿し込んでも科目IDが行位置どおりになる", () => {
    const rows = drafts(db);
    const inserted: SubjectDraft[] = [
      rows[0],
      {
        id: null,
        name: "追加工事",
        skipPart2: 0,
        aggregateOrder: 1,
        note: "",
        spare1: "",
        spare2: "",
      },
      ...rows.slice(1),
    ];
    const saved = saveSubjects(db, inserted);

    expect(saved.subjects.map((subject) => subject.id)).toEqual(
      saved.subjects.map((_, index) => index + 1),
    );
    expect(saved.subjects[1].name).toBe("追加工事");
    expect(saved.subjects[1].code).toBe("02");
  });

  it("科目IDを付け替えても明細の所属は変わらない", () => {
    const rows = drafts(db);
    const target = rows[2];
    addDetail(db, target.id as number);
    saveSubjects(db, [
      {
        id: null,
        name: "先頭追加",
        skipPart2: 0,
        aggregateOrder: 1,
        note: "",
        spare1: "",
        spare2: "",
      },
      ...rows,
    ]);

    const moved = listSubjects(db).find(
      (subject) => subject.name === target.name,
    );
    expect(moved?.id).toBe(4);
    expect(
      db
        .select()
        .from(schema.mDetails)
        .where(eq(schema.mDetails.subjectId, 4))
        .all(),
    ).toHaveLength(1);
  });

  it("並びどおりに揃っていれば付け替えない", () => {
    expect(renumberSubjects(db)).toBe(false);
  });
});
