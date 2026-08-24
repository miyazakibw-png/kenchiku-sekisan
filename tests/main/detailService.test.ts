import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import {
  listDetailChangeLogs,
  listDetails,
  listMasterOptions,
  saveDetails,
  syncProjectDetailsToBasic,
  copyBasicDetailsToProject,
} from "../../src/main/services/detailService";
import { createProject } from "../../src/main/services/projectService";
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

  it("上下2段の各項目を保存・復元する（部位は明細マスターに持たない）", () => {
    const projectId = createProject(db, "部位テスト").id;
    const [saved] = saveDetails(db, {
      subjectId,
      projectId,
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
    expect(saved.partName).toBe("");
    expect(saved.descriptionLower).toBe("端部専用支持脚及び補強用金物共");
    expect(saved.remarksLower).toBe("備考下");
    expect(saved.estimateDisplay).toBe("フリーアクセスフロア");
  });

  it("基本マスターには部位名を保存しない", () => {
    const [saved] = saveDetails(db, {
      subjectId,
      rows: [draft("石膏ボード", { partName: "柱型" })],
      deletedIds: [],
    });
    expect(saved.partName).toBe("");
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

describe("物件専用マスター（工事マスター）", () => {
  function createProjectRow(): number {
    return createProject(db, "テスト工事").id;
  }

  it("工事を作ると基本マスターの明細を物件専用へ複製する", () => {
    saveDetails(db, {
      subjectId,
      rows: [draft("床シート"), draft("巾木")],
      deletedIds: [],
    });
    const projectId = createProjectRow();
    const copied = listDetails(db, subjectId, projectId);
    expect(copied.map((row) => row.name)).toEqual(["床シート", "巾木"]);
    expect(copied.every((row) => row.scope === "project")).toBe(true);
    expect(copied.map((row) => row.sourceDetailId)).toEqual(
      listDetails(db, subjectId).map((row) => row.id),
    );
  });

  it("物件専用の修正は基本マスターに影響しない", () => {
    saveDetails(db, { subjectId, rows: [draft("床シート")], deletedIds: [] });
    const projectId = createProjectRow();
    const [row] = listDetails(db, subjectId, projectId);
    saveDetails(db, {
      subjectId,
      projectId,
      rows: [{ ...row, name: "床シート（変更）" }],
      deletedIds: [],
    });
    expect(listDetails(db, subjectId, projectId)[0].name).toBe(
      "床シート（変更）",
    );
    expect(listDetails(db, subjectId)[0].name).toBe("床シート");
  });

  it("大元へ同期すると既存明細を上書きし、物件で追加した明細は基本マスターへ追加する", () => {
    saveDetails(db, { subjectId, rows: [draft("床シート")], deletedIds: [] });
    const projectId = createProjectRow();
    const [row] = listDetails(db, subjectId, projectId);
    saveDetails(db, {
      subjectId,
      projectId,
      rows: [{ ...row, name: "床シート（変更）" }, draft("新規明細")],
      deletedIds: [],
    });

    const result = syncProjectDetailsToBasic(db, projectId, subjectId);
    expect(result).toEqual({ updated: 1, added: 1 });
    expect(listDetails(db, subjectId).map((d) => d.name)).toEqual([
      "床シート（変更）",
      "新規明細",
    ]);
  });
});

describe("修正履歴一覧", () => {
  it("明細マスター画面の追加・修正・削除は履歴に残さない", () => {
    const [added] = saveDetails(db, {
      subjectId,
      rows: [draft("床シート")],
      deletedIds: [],
    });
    saveDetails(db, {
      subjectId,
      rows: [{ ...added, name: "床シート（変更）", unit: "m2" }],
      deletedIds: [],
    });
    saveDetails(db, { subjectId, rows: [], deletedIds: [added.id] });

    expect(listDetailChangeLogs(db)).toEqual([]);
  });

  it("集計書兼工事マスター・セット明細で直した分だけ残す", () => {
    const [added] = saveDetails(db, {
      subjectId,
      rows: [draft("床シート")],
      deletedIds: [],
    });
    saveDetails(db, {
      subjectId,
      origin: "集計書兼工事マスター",
      rows: [{ ...added, name: "床シート（集計書で修正）" }],
      deletedIds: [],
    });

    const logs = listDetailChangeLogs(db);
    expect(logs.map((log) => log.origin)).toEqual(["集計書兼工事マスター"]);
    expect(logs[0].before?.name).toBe("床シート");
    expect(logs[0].after?.name).toBe("床シート（集計書で修正）");
    expect(logs[0].changedFields).toEqual(["name"]);
  });

  it("物件専用マスターの履歴は工事ごとに分かれる", () => {
    saveDetails(db, { subjectId, rows: [draft("床シート")], deletedIds: [] });
    const projectId = createProject(db, "履歴テスト工事").id;
    const [row] = listDetails(db, subjectId, projectId);
    saveDetails(db, {
      subjectId,
      projectId,
      origin: "集計書兼工事マスター",
      rows: [{ ...row, name: "床シート（工事）" }],
      deletedIds: [],
    });

    expect(
      listDetailChangeLogs(db, projectId).map((log) => log.after?.name),
    ).toEqual(["床シート（工事）"]);
    expect(listDetailChangeLogs(db)).toEqual([]);
  });
});

describe("基本マスターから工事への複製", () => {
  it("2度複製しても明細は二重にならない", () => {
    saveDetails(db, { subjectId, rows: [draft("床シート")], deletedIds: [] });
    const projectId = createProject(db, "複製テスト工事").id;
    const before = listDetails(db, subjectId, projectId).length;

    const again = copyBasicDetailsToProject(db, projectId);

    expect(again.copied).toBe(0);
    expect(listDetails(db, subjectId, projectId).length).toBe(before);
  });

  it("基本マスターに増えた明細だけを取り込む", () => {
    saveDetails(db, { subjectId, rows: [draft("床シート")], deletedIds: [] });
    const projectId = createProject(db, "追加テスト工事").id;
    const rows = listDetails(db, subjectId, null);
    saveDetails(db, {
      subjectId,
      rows: [...rows, draft("巾木")],
      deletedIds: [],
    });

    const result = copyBasicDetailsToProject(db, projectId);

    expect(result.copied).toBe(1);
    expect(
      listDetails(db, subjectId, projectId).map((row) => row.name),
    ).toEqual(["床シート", "巾木"]);
  });
});
