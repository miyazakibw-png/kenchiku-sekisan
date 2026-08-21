import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import {
  listDetails,
  listMasterOptions,
  saveDetails,
} from "../../src/main/services/detailService";
import type { DetailDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function draft(
  name: string,
  overrides: Partial<DetailDraft> = {},
): DetailDraft {
  return {
    id: null,
    detailNumber: null,
    materialCategory: "",
    partName: "",
    name,
    descriptionUpper: "",
    descriptionLower: "",
    unit: "㎡",
    remarksUpper: "",
    remarksLower: "",
    estimateDisplay: "",
    isActive: true,
    ...overrides,
  };
}

let db: AppDatabase;
let subjectId: number;

beforeEach(() => {
  db = createDb();
  subjectId = listMasterOptions(db).subjects[0].id;
});

describe("基本マスター群のシード", () => {
  it("型枠分類・部位・カッコ書式が投入される", () => {
    expect(
      db
        .select()
        .from(schema.mFormworkCategories)
        .all()
        .map((c) => c.name),
    ).toEqual(["基礎階", "地下階", "地上階"]);
    expect(db.select().from(schema.mPickupParts).all().length).toBeGreaterThan(
      0,
    );
    const parts = db.select().from(schema.mAggregationParts).all();
    expect(parts.length).toBe(20);
    expect(parts.every((p) => p.textColor !== null)).toBe(true);
    const brackets = db.select().from(schema.mPartBracketFormats).all();
    expect(
      brackets.map((b) => [b.level, b.leftBracket, b.rightBracket]),
    ).toEqual([
      [1, "（", "）"],
      [2, "＜", "＞"],
    ]);
  });
});

describe("明細マスターの保存", () => {
  it("初期マスター（科目・材種・単位）が投入される", () => {
    const options = listMasterOptions(db);
    expect(options.subjects.length).toBeGreaterThan(0);
    expect(options.materialCategories.map((c) => c.name)).toEqual([
      "仕上",
      "軸組",
      "下地1",
      "下地2",
      "予備",
    ]);
    expect(options.units.map((u) => u.name)).toContain("m2");
  });

  it("新規行を採番順に登録する", () => {
    const saved = saveDetails(db, {
      subjectId,
      rows: [draft("コンクリート"), draft("型枠")],
      deletedIds: [],
    });
    expect(saved.map((d) => d.name)).toEqual(["コンクリート", "型枠"]);
    expect(saved.map((d) => d.displayOrder)).toEqual([0, 1]);
  });

  it("並び替えた順序が display_order に反映される", () => {
    const saved = saveDetails(db, {
      subjectId,
      rows: [draft("A"), draft("B")],
      deletedIds: [],
    });
    const reordered = saveDetails(db, {
      subjectId,
      rows: [
        { ...draft("B"), id: saved[1].id },
        { ...draft("A"), id: saved[0].id },
      ],
      deletedIds: [],
    });
    expect(reordered.map((d) => d.name)).toEqual(["B", "A"]);
  });

  it("削除指定した行を除去する", () => {
    const saved = saveDetails(db, {
      subjectId,
      rows: [draft("A"), draft("B")],
      deletedIds: [],
    });
    const after = saveDetails(db, {
      subjectId,
      rows: [{ ...draft("A"), id: saved[0].id }],
      deletedIds: [saved[1].id],
    });
    expect(after.map((d) => d.name)).toEqual(["A"]);
  });

  it("上下2段の各項目を保存・復元する", () => {
    const [saved] = saveDetails(db, {
      subjectId,
      rows: [
        draft("フリーアクセスフロア", {
          partName: "同上切欠合せボーダー",
          descriptionUpper: "H100 ○○下",
          descriptionLower: "端部専用支持脚及び補強用金物共",
          remarksUpper: "備考上",
          remarksLower: "備考下",
          estimateDisplay: "フリーアクセスフロア",
        }),
      ],
      deletedIds: [],
    });
    expect(saved.partName).toBe("同上切欠合せボーダー");
    expect(saved.descriptionLower).toBe("端部専用支持脚及び補強用金物共");
    expect(saved.remarksLower).toBe("備考下");
    expect(saved.estimateDisplay).toBe("フリーアクセスフロア");
  });

  it("明細番号を小数2桁の数値として保持する", () => {
    const saved = saveDetails(db, {
      subjectId,
      rows: [
        draft("A", { detailNumber: 302 }),
        draft("B", { detailNumber: 12.3456 }),
      ],
      deletedIds: [],
    });
    expect(saved[0].detailNumber).toBe(302);
    expect(saved[1].detailNumber).toBe(12.35);
  });

  it("科目ごとに明細を分離して取得する", () => {
    const options = listMasterOptions(db);
    saveDetails(db, {
      subjectId: options.subjects[0].id,
      rows: [draft("A")],
      deletedIds: [],
    });
    saveDetails(db, {
      subjectId: options.subjects[1].id,
      rows: [draft("B")],
      deletedIds: [],
    });
    expect(listDetails(db, options.subjects[1].id).map((d) => d.name)).toEqual([
      "B",
    ]);
  });
});

describe("Undoで復活した行の保存", () => {
  it("削除保存済みの行を同じIDで再作成する", () => {
    const saved = saveDetails(db, {
      subjectId,
      rows: [draft("残す"), draft("消す")],
      deletedIds: [],
    });
    const removed = saved[1];
    saveDetails(db, { subjectId, rows: [saved[0]], deletedIds: [removed.id] });
    expect(listDetails(db, subjectId).length).toBe(1);

    const restored = saveDetails(db, {
      subjectId,
      rows: [saved[0], removed],
      deletedIds: [],
    });
    expect(restored.map((d) => [d.id, d.name])).toEqual([
      [saved[0].id, "残す"],
      [removed.id, "消す"],
    ]);
  });
});
