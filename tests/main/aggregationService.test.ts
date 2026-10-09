import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import { createProject } from "../../src/main/services/projectService";
import { saveEstimateRows } from "../../src/main/services/estimateRowService";
import {
  getRoomSheet,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import { saveTransferRows } from "../../src/main/services/transferRowService";
import { saveFittings } from "../../src/main/services/fittingService";
import {
  buildProjectMasters,
  collectEstimateRowChecks,
  getAggregate,
  listAggregateRuns,
  listCalcErrors,
  runAggregation,
  saveAggregateEdits,
  setDetailUnused,
} from "../../src/main/services/aggregationService";
import { listAssemblies } from "../../src/main/services/assemblyService";
import { listProjectDetailsInUse } from "../../src/main/services/detailService";
import {
  getPitSheet,
  savePitSheet,
} from "../../src/main/services/pitSheetService";
import { transferBreakdown } from "../../src/main/services/breakdownService";
import {
  getMiscSheet,
  listMiscSheets,
  saveMiscSheet,
} from "../../src/main/services/miscSheetService";
import {
  miscColumn,
  miscRow,
  type MiscColumn,
} from "../../src/core/misc/miscSheet";
import { listTransferRows } from "../../src/main/services/transferRowService";
import {
  listDetailChangeLogs,
  listDetails,
  saveDetails,
} from "../../src/main/services/detailService";
import type {
  EstimateRowDraft,
  TransferRowDraft,
} from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function roomRow(part3: string, multiplier: number): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "建築",
    part2: "1階",
    part2Split: 1,
    formwork: "",
    part3,
    ceilingHeight: 2.5,
    multiplier,
    note: "",
    calcType: "room",
  };
}

/** 4m×3m の部屋（床面積12m2）と、床仕上1明細のセット */
const SHAPE_JSON = JSON.stringify({
  edges: [
    { id: "e1", direction: "E", length: 4, kind: "wall" },
    { id: "e2", direction: "S", length: 3, kind: "wall" },
    { id: "e3", direction: "W", length: 4, kind: "wall" },
    { id: "e4", direction: "N", length: 3, kind: "wall" },
  ],
});

function lowerJson(coefficient: number): string {
  return JSON.stringify([
    {
      id: "s1",
      partNumber: 10,
      partName: "床",
      details: [
        {
          id: "d1",
          sourceDetailId: null,
          subjectId: 5,
          detailNumber: 1.01,
          materialCategory: "仕上",
          partName: "",
          name: "ビニル床シート",
          descriptionUpper: "",
          descriptionLower: "t=2.0",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
          estimateDisplay: "",
          coefficient,
        },
      ],
      lines: [
        { id: "l1", formulaA: "FA", formulaB: "", comment: "", bSymbol: "" },
      ],
    },
  ]);
}

function transferDraft(quantity: number): TransferRowDraft {
  return {
    id: null,
    part1: "建築",
    part2: "1階",
    part2Split: 1,
    formwork: "",
    part3: "事務室",
    subjectId: 5,
    materialCategory: "仕上",
    partId: 10,
    partName: "床",
    detailNumber: 1.01,
    name: "ビニル床シート",
    sourceDetailId: null,
    descriptionUpper: "",
    descriptionLower: "t=2.0",
    quantity,
    unit: "m2",
    unitPrice: null,
    amount: null,
    remarks: "",
    remarksLower: "",
    memo: "",
  };
}

describe("集計処理", () => {
  let db: AppDatabase;
  let projectId: number;
  /** 部位別入力表は画面の全行を保存するので、既存行に足して保存する */
  let drafts: EstimateRowDraft[] = [];

  beforeEach(() => {
    db = createDb();
    projectId = createProject(db, "集計テスト").id;
    drafts = [];
  });

  function addRoom(
    part3: string,
    multiplier: number,
    coefficient: number,
  ): void {
    drafts = [...drafts, roomRow(part3, multiplier)];
    const rows = saveEstimateRows(db, { projectId, rows: drafts });
    drafts = rows.map((row) => ({
      ...roomRow(row.part3, row.multiplier),
      id: row.id,
    }));
    const row = rows[rows.length - 1];
    const sheet = getRoomSheet(db, row.id);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: lowerJson(coefficient),
      ceilingHeight: 2.5,
      note: "",
    });
  }

  it("計算書の累計×掛け率×倍率を集計書兼工事マスターに計上する", () => {
    addRoom("事務室", 2, 1.05);

    const view = runAggregation(db, projectId);
    expect(view.items).toHaveLength(1);
    // 床面積12m2 × 掛け率1.05 × 倍率2
    expect(view.items[0].quantity).toBe(25.2);
    expect(view.items[0].partName).toBe("床");
    expect(view.items[0].name).toBe("ビニル床シート");
    expect(view.items[0].rooms).toEqual([
      { roomName: "1階：事務室 × 2", quantity: 25.2 },
    ]);
  });

  it("天井高さは部位別入力表の値で集計する（計算書のコピーで残った古い高さは使わない）", () => {
    addRoom("事務室", 1, 1);
    const row = drafts[drafts.length - 1];
    const sheet = getRoomSheet(db, row.id as number);
    // 計算書側にコピー元の古い天井高さ5.10が残っている状態にする
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: JSON.stringify(
        JSON.parse(lowerJson(1)).map(
          (set: { lines: { formulaA: string }[] }) => ({
            ...set,
            lines: [{ ...set.lines[0], formulaA: "CH" }],
          }),
        ),
      ),
      ceilingHeight: 5.1,
      note: "",
    });
    // 部位別入力表では3.82に直してある
    saveEstimateRows(db, {
      projectId,
      rows: drafts.map((each) => ({ ...each, ceilingHeight: 3.82 })),
    });

    const view = runAggregation(db, projectId);
    expect(view.items[0].quantity).toBe(3.82);
  });

  it("補強のセットで <記号> だけ書いた計算式は軸組横補強を採る（画面と同じ）", () => {
    // 建具 SD1（W0.85・H2.10・腰高なし）：面積1.79・軸組横補強0.85
    saveFittings(db, {
      projectId,
      rows: [
        {
          id: null,
          symbol: "SD1",
          name: "",
          width: 0.85,
          height: 2.1,
          sillHeight: null,
          widthFormula: "",
          heightFormula: "",
          sillHeightFormula: "",
          areaFormula: "",
          baseboardFormula: "",
          reinforcementFormula: "",
          note: "",
          fromEstimate: 0,
        },
      ],
    });
    addRoom("事務室", 1, 1);
    const row = drafts[drafts.length - 1];
    const sheet = getRoomSheet(db, row.id as number);
    const lower = JSON.parse(lowerJson(1)) as {
      partName: string;
      lines: unknown[];
    }[];
    lower[0].partName = "補強";
    lower[0].lines = [
      { id: "l1", formulaA: "<SD1>", formulaB: "", comment: "", bSymbol: "" },
    ];
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: JSON.stringify(lower),
      ceilingHeight: 2.5,
      note: "",
    });

    const view = runAggregation(db, projectId);
    // 部位が「補強」なので <SD1> は面積1.79ではなく軸組横補強0.85を採る
    expect(view.items[0].quantity).toBe(0.85);
  });

  it("部位別入力表のチェック列は行ごとに部位別の名称と数量を返す", () => {
    addRoom("事務室", 2, 1.05);
    const rowId = drafts[drafts.length - 1].id;

    const checks = collectEstimateRowChecks(db, projectId, "仕上");
    expect(checks).toHaveLength(1);
    expect(checks[0].estimateRowId).toBe(rowId);
    expect(checks[0].cells).toEqual([
      // 倍率2・掛け率1.05。倍率なしの数量は倍率をかける前の値
      {
        partName: "床",
        name: "ビニル床シート",
        quantity: 25.2,
        baseQuantity: 12.6,
      },
    ]);

    // 材種区分が違うときは拾わない
    expect(collectEstimateRowChecks(db, projectId, "下地")).toEqual([]);
  });

  it("同じ明細は部屋をまたいで合算し、根拠は1件ずつ残す", () => {
    addRoom("事務室", 1, 1);
    addRoom("会議室", 1, 1);

    const view = runAggregation(db, projectId);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(24);
    expect(view.details).toHaveLength(2);
    expect(
      view.details.every((d) => d.masterKey === view.items[0].masterKey),
    ).toBe(true);
    expect(view.details.map((detail) => detail.part3)).toEqual([
      "事務室",
      "会議室",
    ]);
  });

  it("計算式の誤りがある行と、形が決まらない部屋の行は計算エラーになる", () => {
    addRoom("事務室", 1, 1);
    const rowId = drafts[drafts.length - 1].id as number;
    // 正常な計算書はエラーにならない
    expect(listCalcErrors(db, projectId).has(rowId)).toBe(false);

    const sheet = getRoomSheet(db, rowId);
    // 計算式が誤っている（演算子が欠けている）行はエラー
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: JSON.stringify(
        JSON.parse(lowerJson(1)).map(
          (set: { lines: { formulaA: string }[] }) => ({
            ...set,
            lines: [{ ...set.lines[0], formulaA: "FA*" }],
          }),
        ),
      ),
      ceilingHeight: 2.5,
      note: "",
    });
    expect(listCalcErrors(db, projectId).has(rowId)).toBe(true);

    // 式を直し、部屋の形が閉じていない（横方向に足りない）状態もエラー
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: JSON.stringify({
        edges: [
          { id: "e1", direction: "E", length: 4, kind: "wall" },
          { id: "e2", direction: "S", length: 3, kind: "wall" },
          { id: "e3", direction: "W", length: 3, kind: "wall" },
          { id: "e4", direction: "N", length: 3, kind: "wall" },
        ],
      }),
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: lowerJson(1),
      ceilingHeight: 2.5,
      note: "",
    });
    const errored = listCalcErrors(db, projectId);
    expect(errored.has(rowId)).toBe(true);
    // 備考欄の説明に形の誤りを出せるよう、理由の文も返す
    expect(errored.get(rowId)).toContain("閉じていません");
  });

  it("転記入力表は集計書に計上するが根拠（部屋別）には出さない", () => {
    addRoom("事務室", 1, 1);
    saveTransferRows(db, { projectId, rows: [transferDraft(3)] });

    const view = runAggregation(db, projectId);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(15);
    expect(view.items[0].rooms).toEqual([
      { roomName: "1階：事務室", quantity: 12 },
    ]);
    expect(
      view.details.filter((detail) => detail.sourceKind === "transfer"),
    ).toHaveLength(1);
  });

  it("転記入力表は部位名・名称が無い行も計上し、部位ID・明細IDを引き継ぐ", () => {
    saveTransferRows(db, {
      projectId,
      rows: [
        transferDraft(3),
        {
          ...transferDraft(0),
          partId: null,
          partName: "",
          detailNumber: null,
          name: "",
          descriptionLower: "仕様のつづき",
          unit: "",
        },
      ],
    });

    const view = runAggregation(db, projectId);
    const items = view.items.filter((item) => item.name === "");
    expect(items).toHaveLength(1);
    expect(items[0].partNumber).toBe(10);
    expect(items[0].detailNumber).toBe(1.02);
    expect(items[0].descriptionLower).toBe("仕様のつづき");
  });

  it("集計をかけ直しても過去の回は消さず、版として残す", () => {
    addRoom("事務室", 1, 1);
    const first = runAggregation(db, projectId);
    addRoom("会議室", 1, 1);
    const second = runAggregation(db, projectId);

    expect(second.run?.id).not.toBe(first.run?.id);
    expect(listAggregateRuns(db, projectId)).toHaveLength(2);
    // 既定は最新の回
    expect(getAggregate(db, projectId).run?.id).toBe(second.run?.id);
    // 過去の回もそのまま読める
    const old = getAggregate(db, projectId, first.run?.id);
    expect(old.items[0].quantity).toBe(12);
    expect(second.items[0].quantity).toBe(24);
  });

  it("計算書を直したあとは、集計書を開いたときに自動でかけ直す", () => {
    addRoom("事務室", 1, 1);
    const first = runAggregation(db, projectId);
    expect(first.items[0].quantity).toBe(12);

    // 集計をかけずに計算書だけ足した状態
    addRoom("会議室", 1, 1);

    const view = getAggregate(db, projectId);
    expect(view.run?.id).not.toBe(first.run?.id);
    expect(view.items[0].quantity).toBe(24);
    // 変わっていなければ版は増やさない
    expect(getAggregate(db, projectId).run?.id).toBe(view.run?.id);
    // 過去の回はそのまま読める
    expect(getAggregate(db, projectId, first.run?.id).items[0].quantity).toBe(
      12,
    );
  });

  it("集計書で直した内容を計算書へ書き戻し、集計し直す", () => {
    addRoom("事務室", 1, 1);
    const before = runAggregation(db, projectId);

    const after = saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 7,
          materialCategory: "仕上",
          partNumber: 10,
          partName: "床",
          detailNumber: 1.02,
          name: "長尺塩ビシート",
          descriptionUpper: "",
          descriptionLower: "t=2.5",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    expect(after.items).toHaveLength(1);
    expect(after.items[0].subjectId).toBe(7);
    expect(after.items[0].name).toBe("長尺塩ビシート");
    expect(after.items[0].detailNumber).toBe(1.02);
    expect(after.items[0].quantity).toBe(12);
    // 集計をかけ直しても直した内容のまま（計算書に入っている）
    expect(runAggregation(db, projectId).items[0].name).toBe("長尺塩ビシート");
  });

  it("集計書で直した積算用表示を計算書へ書き戻す", () => {
    addRoom("事務室", 1, 1);
    const before = runAggregation(db, projectId);
    const item = before.items[0];

    const after = saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: item.masterKey,
          subjectId: item.subjectId,
          materialCategory: item.materialCategory,
          partNumber: item.partNumber,
          partName: item.partName,
          detailNumber: item.detailNumber,
          name: item.name,
          descriptionUpper: item.descriptionUpper,
          descriptionLower: item.descriptionLower,
          unit: item.unit,
          remarksUpper: item.remarksUpper,
          remarksLower: item.remarksLower,
          estimateDisplay: "床面積",
        },
      ],
    });

    expect(after.items).toHaveLength(1);
    expect(after.items[0].estimateDisplay).toBe("床面積");
    expect(after.items[0].quantity).toBe(12);
    expect(runAggregation(db, projectId).items[0].estimateDisplay).toBe(
      "床面積",
    );
    const logs = listDetailChangeLogs(db, projectId).filter(
      (log) => log.origin === "集計書兼工事マスター",
    );
    expect(logs[0].changedFields).toContain("estimateDisplay");
  });

  it("集計書で直した内容は明細マスター変更履歴に残る", () => {
    addRoom("事務室", 1, 1);
    const before = runAggregation(db, projectId);

    saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 7,
          materialCategory: "仕上",
          partNumber: 10,
          partName: "床",
          detailNumber: 1.01,
          name: "長尺塩ビシート",
          descriptionUpper: "",
          descriptionLower: "t=2.5",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    const logs = listDetailChangeLogs(db, projectId).filter(
      (log) => log.origin === "集計書兼工事マスター",
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].after?.name).toBe("長尺塩ビシート");
    expect(logs[0].changedFields).toContain("name");
  });

  it("集計書で直した内容を転記入力表へ書き戻す", () => {
    saveTransferRows(db, { projectId, rows: [transferDraft(3)] });
    const before = runAggregation(db, projectId);

    saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 5,
          materialCategory: "仕上",
          partNumber: 10,
          partName: "床",
          detailNumber: 1.01,
          name: "タイルカーペット",
          descriptionUpper: "",
          descriptionLower: "t=6.5",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    const rows = listTransferRows(db, projectId);
    expect(rows[0].name).toBe("タイルカーペット");
    expect(rows[0].descriptionLower).toBe("t=6.5");
  });

  it("集計書で直した内容を部位別雑・金物入力表へ書き戻す", () => {
    const sheet = getMiscSheet(db, listMiscSheets(db, projectId)[0].id);
    const column = miscColumn({
      subjectId: 5,
      materialCategory: "仕上",
      partNumber: 40,
      partName: "雑",
      detailNumber: 35.0,
      name: "点字鋲",
      unit: "個",
    });
    const row = miscRow({ part1: "建築", part2: "1階", part3: "廊下" });
    saveMiscSheet(db, {
      id: sheet.id,
      name: sheet.name,
      columnsJson: JSON.stringify([column]),
      rowsJson: JSON.stringify([{ ...row, values: { [column.id]: "4" } }]),
      note: "",
    });
    const before = runAggregation(db, projectId);

    saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 5,
          materialCategory: "仕上",
          partNumber: 41,
          partName: "金物",
          detailNumber: 36.0,
          name: "点字鋲 ステンレス",
          descriptionUpper: "",
          descriptionLower: "",
          unit: "個",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    const saved = JSON.parse(
      getMiscSheet(db, sheet.id).columnsJson,
    ) as MiscColumn[];
    expect(saved[0].partNumber).toBe(41);
    expect(saved[0].partName).toBe("金物");
    expect(saved[0].detailNumber).toBe(36.0);
    expect(saved[0].name).toBe("点字鋲 ステンレス");
    // かけ直しても直した内容のまま（表に入っている）
    const again = runAggregation(db, projectId);
    expect(again.items[0].partNumber).toBe(41);
    expect(again.items[0].quantity).toBe(4);
  });

  it("集計書で直しても物件専用の明細マスターは変わらない", () => {
    const saved = saveDetails(db, {
      subjectId: 5,
      projectId,
      rows: [
        {
          id: null,
          detailNumber: 1.01,
          materialCategory: "仕上",
          partName: "床",
          name: "ビニル床シート",
          descriptionUpper: "",
          descriptionLower: "t=2.0",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
          estimateDisplay: "",
          isActive: true,
        },
      ],
      deletedIds: [],
    });
    saveTransferRows(db, {
      projectId,
      rows: [{ ...transferDraft(3), sourceDetailId: saved[0].id }],
    });
    const before = runAggregation(db, projectId);

    saveAggregateEdits(db, {
      projectId,
      runId: before.run?.id ?? 0,
      edits: [
        {
          masterKey: before.items[0].masterKey,
          subjectId: 5,
          materialCategory: "仕上",
          partNumber: 10,
          partName: "床",
          detailNumber: 1.01,
          name: "タイルカーペット",
          descriptionUpper: "",
          descriptionLower: "t=6.5",
          unit: "m2",
          remarksUpper: "",
          remarksLower: "",
        },
      ],
    });

    // マスターの行は書き換えないが、直したことは修正履歴に残す
    expect(listDetails(db, 5, projectId)[0].name).toBe("ビニル床シート");
    expect(
      listDetailChangeLogs(db, projectId)
        .filter((log) => log.origin === "集計書兼工事マスター")
        .map((log) => log.after?.name),
    ).toEqual(["タイルカーペット"]);
  });

  it("不要明細にした明細は内訳書へ飛ばさない（計算書はそのまま残る）", () => {
    addRoom("事務室", 1, 1);
    const before = runAggregation(db, projectId);
    expect(before.items[0].unused).toBe(false);
    expect(transferBreakdown(db, projectId).rows.length).toBeGreaterThan(0);

    const view = setDetailUnused(db, {
      projectId,
      masterKey: before.items[0].masterKey,
      unused: true,
      note: "設計事務所より不要の指示",
    });

    // 集計書には数量ごと残る（計算書も消さない）
    expect(view.items).toHaveLength(1);
    expect(view.items[0].unused).toBe(true);
    expect(view.items[0].quantity).toBe(before.items[0].quantity);
    // 内訳書へは出さない
    expect(transferBreakdown(db, projectId).rows).toEqual([]);

    // 印を外せば元どおり内訳書へ出る
    const back = setDetailUnused(db, {
      projectId,
      masterKey: before.items[0].masterKey,
      unused: false,
    });
    expect(back.items[0].unused).toBe(false);
    expect(transferBreakdown(db, projectId).rows.length).toBeGreaterThan(0);
  });

  it("小計行は集計しない", () => {
    addRoom("事務室", 1, 1);
    const rows = saveEstimateRows(db, {
      projectId,
      rows: [...drafts, { ...roomRow("小計", 0), rowType: "subtotal" }],
    });
    expect(rows).toHaveLength(2);

    const view = runAggregation(db, projectId);
    expect(view.details).toHaveLength(1);
  });

  it("マスター作成は集計実行と同じく工事マスターとセット明細マスターを最新にする", () => {
    addRoom("事務室", 1, 1);

    const built = buildProjectMasters(db, projectId);
    expect(built.aggregateCount).toBe(1);
    expect(built.assembliesAdded).toBe(1);

    // マスター呼出の工事マスター（明細）は最新の集計から出る
    expect(
      listProjectDetailsInUse(db, 5, projectId).map((detail) => detail.name),
    ).toEqual(["ビニル床シート"]);
    // セット明細マスターに計算書のセットが登録されている
    expect(listAssemblies(db, projectId)).toHaveLength(1);
    expect(listAssemblies(db, projectId)[0].items[0].partName).toBe("床");

    // 計算書を直してから再度マスター作成すると、呼出もその内容に変わる
    const row = drafts[0];
    const sheet = getRoomSheet(db, row.id as number);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: JSON.stringify([
        {
          id: "s1",
          partNumber: 10,
          partName: "床",
          details: [
            {
              id: "d1",
              sourceDetailId: null,
              subjectId: 5,
              detailNumber: 1.01,
              materialCategory: "仕上",
              partName: "",
              name: "長尺シート",
              descriptionUpper: "",
              descriptionLower: "t=2.5",
              unit: "m2",
              remarksUpper: "",
              remarksLower: "",
              estimateDisplay: "",
              coefficient: 1,
            },
          ],
          lines: [
            { id: "l1", formulaA: "FA", formulaB: "", comment: "", bSymbol: "" },
          ],
        },
      ]),
      ceilingHeight: 2.5,
      note: "",
    });

    buildProjectMasters(db, projectId);
    expect(
      listProjectDetailsInUse(db, 5, projectId).map((detail) => detail.name),
    ).toEqual(["長尺シート"]);
  });

  it("ピット計算書のセットもセット明細マスターに登録する", () => {
    const rows = saveEstimateRows(db, {
      projectId,
      rows: [{ ...roomRow("基礎階ピット", 1), calcType: "pit" }],
    });
    const sheet = getPitSheet(db, rows[0].id);
    savePitSheet(db, {
      id: sheet.id,
      pitsJson: sheet.pitsJson,
      beamsJson: sheet.beamsJson,
      wallsJson: sheet.wallsJson,
      sleevesJson: sheet.sleevesJson,
      sleeveKindsJson: sheet.sleeveKindsJson,
      wallStep: sheet.wallStep,
      lowerJson: lowerJson(1),
      note: "",
    });

    const built = buildProjectMasters(db, projectId);
    expect(built.assembliesAdded).toBe(1);
    expect(listAssemblies(db, projectId)).toHaveLength(1);
    expect(listAssemblies(db, projectId)[0].items[0].name).toBe(
      "ビニル床シート",
    );
  });
});
