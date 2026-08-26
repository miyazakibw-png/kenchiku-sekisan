import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import {
  buildItemFromDetail,
  listAssemblies,
  listAssemblyMasterOptions,
  mergeAssemblies,
  promoteAssemblyToBasic,
  saveAssembly,
  syncAssembliesFromSheets,
} from "../../src/main/services/assemblyService";
import {
  listDetailChangeLogs,
  listDetails,
  listMasterOptions,
  saveDetails,
} from "../../src/main/services/detailService";
import type { AssemblyItem, DetailDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function draft(name: string, materialCategory = "仕上"): DetailDraft {
  return {
    id: null,
    detailNumber: null,
    materialCategory,
    partName: "",
    name,
    descriptionUpper: "",
    descriptionLower: "",
    unit: "m2",
    remarksUpper: "",
    remarksLower: "",
    estimateDisplay: "",
    isActive: true,
  };
}

let db: AppDatabase;
let subjectId = 0;
let detailIds: number[];
let projectIdRef = 0;

beforeEach(() => {
  db = createDb();
  subjectId = listMasterOptions(db).subjects[0].id;
  detailIds = saveDetails(db, {
    subjectId,
    rows: [draft("軽鉄下地", "下地1"), draft("グラスウール", "下地2")],
    deletedIds: [],
  }).map((d) => d.id);
  projectIdRef = Number(
    db.insert(schema.projects).values({ name: "テスト物件" }).run()
      .lastInsertRowid,
  );
});

function itemOf(
  detailId: number,
  patch: Partial<AssemblyItem> = {},
): AssemblyItem {
  return { ...buildItemFromDetail(db, detailId), ...patch };
}

describe("仕上明細セットマスター", () => {
  it("基本セットを構成明細付きで保存・取得する", () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: "basic",
      projectId: null,
      note: "",
      items: [
        itemOf(detailIds[0], { formula: "P" }),
        itemOf(detailIds[1], { formula: "P*1.1", coefficient: 1.1 }),
      ],
    });
    expect(assembly.items.map((i) => i.name)).toEqual([
      "軽鉄下地",
      "グラスウール",
    ]);
    expect(assembly.items.map((i) => i.materialCategory)).toEqual([
      "下地1",
      "下地2",
    ]);
    expect(assembly.items[1].coefficient).toBe(1.1);
    expect(listAssemblies(db, null).length).toBe(1);
  });

  it("セット明細で直した内容は修正履歴に残る", () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: "basic",
      projectId: null,
      note: "",
      items: [itemOf(detailIds[0])],
    });
    saveAssembly(db, {
      id: assembly.id,
      scope: "basic",
      projectId: null,
      note: "",
      items: [{ ...assembly.items[0], name: "軽鉄下地（セットで修正）" }],
    });

    const logs = listDetailChangeLogs(db);
    expect(logs.map((log) => log.origin)).toEqual(["セット明細", "セット明細"]);
    expect(logs[0].changeKind).toBe("edit");
    expect(logs[0].before?.name).toBe("軽鉄下地");
    expect(logs[0].after?.name).toBe("軽鉄下地（セットで修正）");
  });

  it("明細マスターを後から直してもセットの内容は変わらない（一方通行）", () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: "basic",
      projectId: null,
      note: "",
      items: [itemOf(detailIds[0])],
    });
    const rows = listDetails(db, subjectId).map((detail) => ({
      id: detail.id,
      detailNumber: detail.detailNumber,
      materialCategory: detail.materialCategory,
      partName: detail.partName,
      name: detail.id === detailIds[0] ? "軽鉄下地（改称）" : detail.name,
      descriptionUpper: detail.descriptionUpper,
      descriptionLower: detail.descriptionLower,
      unit: detail.unit,
      remarksUpper: detail.remarksUpper,
      remarksLower: detail.remarksLower,
      estimateDisplay: detail.estimateDisplay,
      isActive: detail.isActive,
    }));
    saveDetails(db, { subjectId, rows, deletedIds: [] });

    expect(listAssemblies(db, null)[0].items[0].name).toBe("軽鉄下地");
    expect(assembly.items[0].sourceDetailId).toBe(detailIds[0]);
  });

  it("セット側の修正は明細マスターに反映されない", () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: "basic",
      projectId: null,
      note: "",
      items: [itemOf(detailIds[0])],
    });
    saveAssembly(db, {
      id: assembly.id,
      scope: "basic",
      projectId: null,
      note: "",
      items: [{ ...assembly.items[0], name: "セット内だけの名称" }],
    });
    expect(listDetails(db, subjectId).map((d) => d.name)).toEqual([
      "軽鉄下地",
      "グラスウール",
    ]);
  });

  it("行を入れ替えると一覧の表示行（1行目）も変わる", () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: "basic",
      projectId: null,
      note: "",
      items: [itemOf(detailIds[0]), itemOf(detailIds[1])],
    });
    const { assembly: swapped } = saveAssembly(db, {
      id: assembly.id,
      scope: "basic",
      projectId: null,
      note: "",
      items: [assembly.items[1], assembly.items[0]],
    });
    expect(swapped.items[0].name).toBe("グラスウール");
    expect(listAssemblies(db, null)[0].items[0].name).toBe("グラスウール");
  });

  it("同じ内容のセットができた場合は統合候補を返し、統合できる", () => {
    const first = saveAssembly(db, {
      id: null,
      scope: "basic",
      projectId: null,
      note: "",
      items: [itemOf(detailIds[0])],
    });
    expect(first.duplicateOf).toBeNull();

    const second = saveAssembly(db, {
      id: null,
      scope: "basic",
      projectId: null,
      note: "",
      items: [itemOf(detailIds[0])],
    });
    expect(second.duplicateOf?.id).toBe(first.assembly.id);

    mergeAssemblies(db, first.assembly.id, second.assembly.id);
    expect(listAssemblies(db, null).map((a) => a.id)).toEqual([
      first.assembly.id,
    ]);
  });

  it("構成明細が空の保存は拒否する（最低1明細）", () => {
    expect(() =>
      saveAssembly(db, {
        id: null,
        scope: "basic",
        projectId: null,
        note: "",
        items: [],
      }),
    ).toThrow();
  });

  it("物件セットは基本セット一覧に混ざらない", () => {
    saveAssembly(db, {
      id: null,
      scope: "project",
      projectId: projectIdRef,
      note: "",
      items: [itemOf(detailIds[0])],
    });
    expect(listAssemblies(db, null)).toEqual([]);
    expect(
      listAssemblies(db, projectIdRef).map((a) => a.items[0].name),
    ).toEqual(["軽鉄下地"]);
  });

  it("物件セットを基本セットへ昇格できる", () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: "project",
      projectId: projectIdRef,
      note: "現場で組んだセット",
      items: [itemOf(detailIds[0], { formula: "P" })],
    });
    const promoted = promoteAssemblyToBasic(db, assembly.id);
    expect(promoted.scope).toBe("basic");
    expect(promoted.projectId).toBeNull();
    expect(promoted.items.map((i) => i.name)).toEqual(["軽鉄下地"]);
    expect(listAssemblies(db, null).map((a) => a.note)).toEqual([
      "現場で組んだセット",
    ]);
  });

  it("セット編集用のマスター選択肢を返す", () => {
    const options = listAssemblyMasterOptions(db);
    expect(options.subjects.length).toBeGreaterThan(0);
    expect(options.units.length).toBeGreaterThan(0);
    expect(options.materialCategories.map((c) => c.name)).toEqual([
      "仕上",
      "軸組",
      "下地1",
      "下地2",
      "予備",
    ]);
  });
});

describe("計算書からの自動登録と連動", () => {
  function makeRoomSheet(sets: unknown[]): number {
    const rowId = Number(
      db
        .insert(schema.projectEstimateRows)
        .values({
          projectId: projectIdRef,
          rowType: "room",
          part1: "1階",
          part2: "内部",
          part3: "事務室",
          calcType: "room",
          displayOrder: 0,
        })
        .run().lastInsertRowid,
    );
    return Number(
      db
        .insert(schema.projectRoomSheets)
        .values({
          projectId: projectIdRef,
          estimateRowId: rowId,
          lowerJson: JSON.stringify(sets),
        })
        .run().lastInsertRowid,
    );
  }

  function calcSetJson(names: string[]): unknown {
    return {
      id: "s1",
      partNumber: null,
      partName: "壁",
      banner: null,
      assemblyId: null,
      details: names.map((name, index) => ({
        id: `d${index}`,
        sourceDetailId: detailIds[index] ?? null,
        subjectId,
        detailNumber: null,
        materialCategory: "仕上",
        partNumber: null,
        partName: "",
        name,
        descriptionUpper: "",
        descriptionLower: "",
        unit: "m2",
        remarksUpper: "",
        remarksLower: "",
        estimateDisplay: "",
        coefficient: 1,
      })),
      lines: [
        { id: "l1", formulaA: "10", formulaB: "", comment: "", bSymbol: "" },
      ],
    };
  }

  function lowerJsonOf(sheetId: number): string {
    return (
      db
        .select()
        .from(schema.projectRoomSheets)
        .where(eq(schema.projectRoomSheets.id, sheetId))
        .get()?.lowerJson ?? ""
    );
  }

  it("計算書で組んだセットを集計時に自動登録する", () => {
    const sheetId = makeRoomSheet([calcSetJson(["軽鉄下地", "グラスウール"])]);
    expect(listAssemblies(db, projectIdRef)).toEqual([]);

    expect(syncAssembliesFromSheets(db, projectIdRef)).toBe(1);

    const [assembly] = listAssemblies(db, projectIdRef);
    expect(assembly.items.map((i) => i.name)).toEqual([
      "軽鉄下地",
      "グラスウール",
    ]);
    // 計算書側にマスターのIDを控える（連動の目印）
    expect(lowerJsonOf(sheetId)).toContain(`"assemblyId":${assembly.id}`);

    // 同じ構成は1件にまとめるので2回目は増えない
    expect(syncAssembliesFromSheets(db, projectIdRef)).toBe(0);
    expect(listAssemblies(db, projectIdRef).length).toBe(1);
  });

  it("計算書で直しても他室の計算書とマスターの中身は変わらない（計算書は部屋独立）", () => {
    const sheetA = makeRoomSheet([calcSetJson(["軽鉄下地"])]);
    const sheetB = makeRoomSheet([calcSetJson(["軽鉄下地"])]);
    syncAssembliesFromSheets(db, projectIdRef);
    const [shared] = listAssemblies(db, projectIdRef);
    expect(lowerJsonOf(sheetB)).toContain(`"assemblyId":${shared.id}`);

    // A室の計算書だけ明細を直す
    const sets = JSON.parse(lowerJsonOf(sheetA)) as {
      details: { name: string }[];
    }[];
    sets[0].details[0].name = "軽鉄下地（65形）";
    db.update(schema.projectRoomSheets)
      .set({ lowerJson: JSON.stringify(sets) })
      .where(eq(schema.projectRoomSheets.id, sheetA))
      .run();

    syncAssembliesFromSheets(db, projectIdRef);

    // B室はそのまま。もとのセットの中身も変わらない
    expect(lowerJsonOf(sheetB)).toContain("軽鉄下地");
    expect(lowerJsonOf(sheetB)).not.toContain("軽鉄下地（65形）");
    const after = listAssemblies(db, projectIdRef);
    expect(
      after.find((a) => a.id === shared.id)?.items.map((i) => i.name),
    ).toEqual(["軽鉄下地"]);
    // 直したA室は別のセットへつなぎ直す
    expect(after.map((a) => a.items[0].name).sort()).toEqual(
      ["軽鉄下地", "軽鉄下地（65形）"].sort(),
    );
    expect(lowerJsonOf(sheetA)).not.toContain(`"assemblyId":${shared.id}`);
  });

  it("使わなくなった自動登録のセットは集計時に片付ける", () => {
    const sheetId = makeRoomSheet([calcSetJson(["軽鉄下地"])]);
    syncAssembliesFromSheets(db, projectIdRef);
    expect(listAssemblies(db, projectIdRef).length).toBe(1);

    // 計算書からセットを消す（別のセットに入れ替える）
    db.update(schema.projectRoomSheets)
      .set({ lowerJson: JSON.stringify([calcSetJson(["グラスウール"])]) })
      .where(eq(schema.projectRoomSheets.id, sheetId))
      .run();
    syncAssembliesFromSheets(db, projectIdRef);

    expect(
      listAssemblies(db, projectIdRef).map((a) => a.items[0].name),
    ).toEqual(["グラスウール"]);
  });

  it("中身が同じ物件セットが増えていたら集計時に1件へまとめる", () => {
    const sheetId = makeRoomSheet([calcSetJson(["軽鉄下地"])]);
    syncAssembliesFromSheets(db, projectIdRef);
    const [assembly] = listAssemblies(db, projectIdRef);
    // 以前の版で増えてしまった同内容のセットを再現し、計算書をそちらへ向ける
    const { assembly: duplicate } = saveAssembly(db, {
      id: null,
      scope: "project",
      projectId: projectIdRef,
      note: "",
      items: assembly.items.map((item) => ({ ...item, id: null })),
    });
    db.update(schema.mFinishAssemblies)
      .set({ autoRegistered: 1 })
      .where(eq(schema.mFinishAssemblies.id, duplicate.id))
      .run();
    const sets = JSON.parse(lowerJsonOf(sheetId)) as {
      assemblyId: number | null;
    }[];
    sets[0].assemblyId = duplicate.id;
    db.update(schema.projectRoomSheets)
      .set({ lowerJson: JSON.stringify(sets) })
      .where(eq(schema.projectRoomSheets.id, sheetId))
      .run();

    syncAssembliesFromSheets(db, projectIdRef);

    expect(listAssemblies(db, projectIdRef).map((a) => a.id)).toEqual([
      assembly.id,
    ]);
    expect(lowerJsonOf(sheetId)).toContain(`"assemblyId":${assembly.id}`);
  });

  it("セット明細マスターで直すと計算書も連動して直る", () => {
    const sheetId = makeRoomSheet([calcSetJson(["軽鉄下地"])]);
    syncAssembliesFromSheets(db, projectIdRef);
    const [assembly] = listAssemblies(db, projectIdRef);

    const result = saveAssembly(db, {
      id: assembly.id,
      scope: "project",
      projectId: projectIdRef,
      note: "",
      items: [{ ...assembly.items[0], name: "軽鉄下地（65形）" }],
      propagate: true,
    });

    expect(result.syncedSets).toBe(1);
    expect(lowerJsonOf(sheetId)).toContain("軽鉄下地（65形）");
    // 計算式はそのまま残す
    expect(lowerJsonOf(sheetId)).toContain('"formulaA":"10"');
  });

  it("計算式だけの空行があってもマスター連動で明細の位置がずれない", () => {
    const set = calcSetJson(["軽鉄下地", "グラスウール"]) as {
      details: Record<string, unknown>[];
      lines: Record<string, unknown>[];
    };
    // 明細の無い行（計算式だけの行）を1行目と2行目の間に挟む
    set.details.splice(1, 0, {
      id: "dblank",
      sourceDetailId: null,
      subjectId: null,
      detailNumber: null,
      materialCategory: "",
      partNumber: null,
      partName: "",
      name: "",
      descriptionUpper: "",
      descriptionLower: "",
      unit: "",
      remarksUpper: "",
      remarksLower: "",
      estimateDisplay: "",
      coefficient: 1,
    });
    set.lines = ["10", "20", "30"].map((formulaA, index) => ({
      id: `l${index}`,
      formulaA,
      formulaB: "",
      comment: "",
      bSymbol: "",
    }));
    const sheetId = makeRoomSheet([set]);
    syncAssembliesFromSheets(db, projectIdRef);
    const [assembly] = listAssemblies(db, projectIdRef);
    expect(assembly.items.map((i) => i.name)).toEqual([
      "軽鉄下地",
      "グラスウール",
    ]);

    saveAssembly(db, {
      id: assembly.id,
      scope: "project",
      projectId: projectIdRef,
      note: "",
      items: assembly.items.map((item) => ({
        ...item,
        name: `${item.name}（改）`,
      })),
      propagate: true,
    });

    const after = JSON.parse(lowerJsonOf(sheetId)) as {
      details: { name: string }[];
      lines: { formulaA: string }[];
    }[];
    // 空行はその位置のまま、明細と計算式の組み合わせも変わらない
    expect(after[0].details.map((d) => d.name)).toEqual([
      "軽鉄下地（改）",
      "",
      "グラスウール（改）",
    ]);
    expect(after[0].lines.map((l) => l.formulaA)).toEqual(["10", "20", "30"]);
  });

  it("同じ明細を使う他のセットも一緒に直せる", () => {
    makeRoomSheet([calcSetJson(["軽鉄下地"])]);
    syncAssembliesFromSheets(db, projectIdRef);
    const [first] = listAssemblies(db, projectIdRef);
    const { assembly: second } = saveAssembly(db, {
      id: null,
      scope: "project",
      projectId: projectIdRef,
      note: "",
      items: [{ ...first.items[0], id: null }, itemOf(detailIds[1])],
    });

    saveAssembly(db, {
      id: first.id,
      scope: "project",
      projectId: projectIdRef,
      note: "",
      items: [{ ...first.items[0], name: "軽鉄下地（50形）" }],
      propagate: true,
      applyToAllSets: true,
    });

    expect(
      listAssemblies(db, projectIdRef)
        .find((a) => a.id === second.id)
        ?.items.map((i) => i.name),
    ).toEqual(["軽鉄下地（50形）", "グラスウール"]);
  });
});
