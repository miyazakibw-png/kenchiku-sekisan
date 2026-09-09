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
  listFilledCalcSheets,
  saveEstimateRows,
} from "../../src/main/services/estimateRowService";
import {
  getDeductionLimit,
  getRoomLowerTemplate,
  getRoomSheet,
  registerRoomFitting,
  saveDeductionLimit,
  saveRoomLowerTemplate,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import {
  commentSet,
  calcSet,
  isCommentSet,
  type CalcSet,
} from "../../src/core/room/calcSheet";
import {
  listFittings,
  listFittingSources,
  saveFittings,
} from "../../src/main/services/fittingService";
import type { EstimateRowDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function roomRow(
  part3: string,
  ceilingHeight: number | null,
): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "1階",
    part2: "内部",
    part2Split: 0,
    formwork: "",
    part3,
    ceilingHeight,
    multiplier: 1,
    note: "",
    calcType: "room",
  };
}

describe("部屋計算書（上段）", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("部位別入力表の行から計算書を作り、天井高さを引き継ぐ", () => {
    const project = createProject(db, "計算書テスト");
    const [row] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [roomRow("玄関ホール", 2.7)],
    });

    const sheet = getRoomSheet(db, row.id);
    expect(sheet.estimateRowId).toBe(row.id);
    expect(sheet.ceilingHeight).toBe(2.7);
    expect(sheet.shapeJson).toBe('{"edges":[]}');

    // 2回目は同じ計算書を返す（部屋ごとに1つ）
    expect(getRoomSheet(db, row.id).id).toBe(sheet.id);
  });

  it("保存すると天井高さが部位別入力表にも反映される（相互連動）", () => {
    const project = createProject(db, "連動テスト");
    const [row] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [roomRow("事務室", 2.5)],
    });
    const sheet = getRoomSheet(db, row.id);

    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson:
        '{"edges":[{"id":"a","direction":"E","length":3,"kind":"wall"}]}',
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: "[]",
      ceilingHeight: 3.05,
      note: "",
    });

    expect(listEstimateRows(db, project.id)[0].ceilingHeight).toBe(3.05);
    expect(getRoomSheet(db, row.id).shapeJson).toContain('"direction":"E"');
  });

  it("物件をコピーすると計算書も独立して複製される", () => {
    const project = createProject(db, "コピー元");
    const [row] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [roomRow("会議室", 2.4)],
    });
    const sheet = getRoomSheet(db, row.id);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson:
        '{"edges":[{"id":"a","direction":"E","length":4,"kind":"wall"}]}',
      fittingsJson: '[{"id":"f1","symbol":"AW1","multiplier":2,"edgeId":"a"}]',
      ceilingJson:
        '[{"id":"c1","kind":"wallBeam","edgeId":"a","length":null,"width":0.4,"offset":0,"ceilingHeight":2.2,"area":null,"note":""}]',
      lowerJson:
        '[{"id":"s1","partNumber":10,"partName":"床","details":[],"lines":[{"id":"l1","formulaA":"FA","formulaB":"","comment":"","bSymbol":"B1"}]}]',
      ceilingHeight: 2.4,
      note: "",
    });

    const copied = copyProject(db, project.id, "コピー先");
    const copiedRow = listEstimateRows(db, copied.id)[0];
    const copiedSheet = getRoomSheet(db, copiedRow.id);

    expect(copiedSheet.id).not.toBe(sheet.id);
    expect(copiedSheet.shapeJson).toContain('"length":4');
    expect(copiedSheet.fittingsJson).toContain('"AW1"');
    expect(copiedSheet.ceilingJson).toContain('"wallBeam"');
    expect(copiedSheet.lowerJson).toContain('"B1"');

    // コピー先を直してもコピー元は変わらない
    saveRoomSheet(db, {
      ...copiedSheet,
      shapeJson: '{"edges":[]}',
      ceilingHeight: 2.9,
    });
    expect(getRoomSheet(db, row.id).shapeJson).toContain('"length":4');
    expect(listEstimateRows(db, project.id)[0].ceilingHeight).toBe(2.4);
  });

  it("計算書で使った記号が建具表に無ければ末尾へ登録する（既存は変えない）", () => {
    const project = createProject(db, "建具登録");
    saveFittings(db, {
      projectId: project.id,
      rows: [
        {
          id: null,
          symbol: "AW1",
          name: "",
          width: 1.8,
          height: 2,
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

    const afterKnown = registerRoomFitting(db, project.id, {
      symbol: "AW1",
      width: 9,
      height: 9,
      sillHeight: null,
    });
    expect(afterKnown).toHaveLength(1);
    expect(afterKnown[0].width).toBe(1.8);

    registerRoomFitting(db, project.id, {
      symbol: "SD9",
      width: 0.9,
      height: 2.1,
      sillHeight: null,
    });
    const rows = listFittings(db, project.id);
    expect(rows).toHaveLength(2);
    expect(rows[1].symbol).toBe("SD9");
    expect(rows[1].fromEstimate).toBe(1);
  });

  it("計算書で寸法を直接打ち替えたときは建具表の寸法も書き替える", () => {
    const project = createProject(db, "建具寸法直接入力");
    registerRoomFitting(db, project.id, {
      symbol: "AW1",
      width: 1.8,
      height: 2,
      sillHeight: null,
    });

    const rows = registerRoomFitting(
      db,
      project.id,
      { symbol: "AW1", width: 1.6, height: 2.2, sillHeight: 0.8 },
      true,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].width).toBe(1.6);
    expect(rows[0].height).toBe(2.2);
    expect(rows[0].sillHeight).toBe(0.8);
  });

  it("計算書から登録した建具は元の部屋計算書をたどれる（登録元が無ければ記号を使う部屋）", () => {
    const project = createProject(db, "建具の出所");
    const [hall, living] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [roomRow("玄関ホール", 2.4), roomRow("居間", 2.4)],
    });
    const livingSheet = getRoomSheet(db, living.id);
    saveRoomSheet(db, {
      id: livingSheet.id,
      shapeJson:
        '{"edges":[{"id":"a","direction":"E","length":4,"kind":"wall"}]}',
      fittingsJson: '[{"id":"f1","symbol":"SD9","multiplier":1,"edgeId":"a"}]',
      ceilingJson: "[]",
      lowerJson: "[]",
      ceilingHeight: 2.4,
      note: "",
    });

    // 登録元の行を渡して登録（玄関ホール）
    registerRoomFitting(
      db,
      project.id,
      { symbol: "AW1", width: 1.8, height: 2, sillHeight: null },
      false,
      hall.id,
    );
    // 古い登録（登録元の行が無い）→記号を使っている居間を探す
    registerRoomFitting(db, project.id, {
      symbol: "SD9",
      width: 0.9,
      height: 2.1,
      sillHeight: null,
    });
    // 計算書から登録されたが、今はどの計算書にも無い記号（記号を直した後に残ったもの）
    registerRoomFitting(db, project.id, {
      symbol: "aw8",
      width: 3.29,
      height: 0.71,
      sillHeight: 2.25,
    });
    // 手で入れた建具は出所なし
    saveFittings(db, {
      projectId: project.id,
      rows: [
        ...listFittings(db, project.id),
        {
          id: null,
          symbol: "WD1",
          name: "",
          width: 0.8,
          height: 2,
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

    const fittings = listFittings(db, project.id);
    expect(fittings.map((row) => row.symbol)).toEqual([
      "WD1",
      "AW1",
      "SD9",
      "aw8",
    ]);
    expect(fittings[1].sourceEstimateRowId).toBe(hall.id);
    expect(fittings[2].sourceEstimateRowId).toBeNull();

    const sources = listFittingSources(db, project.id);
    expect(sources).toEqual([
      {
        fittingId: fittings[1].id,
        kind: "room",
        estimateRowId: hall.id,
        furnitureSheetId: null,
        name: "内部 玄関ホール",
      },
      {
        fittingId: fittings[2].id,
        kind: "room",
        estimateRowId: living.id,
        furnitureSheetId: null,
        name: "内部 居間",
      },
      {
        fittingId: fittings[3].id,
        kind: "none",
        estimateRowId: null,
        furnitureSheetId: null,
        name: "",
      },
    ]);
  });

  it("新しい計算書の下段は初期状態（見出し行＋部位）で始まり、中身のある計算書とは見なさない", () => {
    const project = createProject(db, "初期状態テスト");
    const [row] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [roomRow("事務室", 2.6)],
    });
    expect(getRoomLowerTemplate(db)).toBeNull();

    const sets = JSON.parse(getRoomSheet(db, row.id).lowerJson) as CalcSet[];
    const parts = sets.filter((set) => !isCommentSet(set));
    expect(parts.map((set) => set.partName)).toEqual([
      "床",
      "巾木",
      "壁",
      "柱型",
      "梁型",
      "天井",
      "その他",
      "その他",
    ]);
    expect(sets.filter(isCommentSet)).toHaveLength(8);
    // 見出し行は部位のセットの直前に並ぶ
    expect(isCommentSet(sets[0])).toBe(true);
    expect(sets[1].partName).toBe("床");
    expect(sets[1].details).toHaveLength(1);
    expect(sets[1].details[0].name).toBe("");
    expect(sets[1].lines[0].formulaA).toBe("");
    // ID は全部別
    const ids = sets.flatMap((set) => [
      set.id,
      ...set.details.map((d) => d.id),
      ...set.lines.map((l) => l.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);

    // 初期状態のままは「中身のある計算書」には数えない（種類を変えるときの確認が出ない）
    expect(listFilledCalcSheets(db, project.id)[row.id]).toBeUndefined();
  });

  it("初期状態を保存すると、次に作る計算書からその並びになる（今ある計算書は変わらない）", () => {
    const project = createProject(db, "初期状態保存テスト");
    const [before, after] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [roomRow("先に開く部屋", 2.6), roomRow("後で開く部屋", 2.6)],
    });
    const beforeSheet = getRoomSheet(db, before.id);

    const wall = calcSet(1);
    wall.partName = "壁";
    saveRoomLowerTemplate(
      db,
      JSON.stringify([commentSet("仕上", "#dbeafe"), wall]),
    );

    const sets = JSON.parse(getRoomSheet(db, after.id).lowerJson) as CalcSet[];
    expect(sets).toHaveLength(2);
    expect(sets[0].banner).toEqual({ text: "仕上", color: "#dbeafe" });
    expect(sets[1].partName).toBe("壁");
    expect(sets[1].id).not.toBe(wall.id);
    expect(getRoomSheet(db, before.id).lowerJson).toBe(beforeSheet.lowerJson);

    // 空の初期状態も保存できる（何も入っていない下段で始まる）
    saveRoomLowerTemplate(db, "[]");
    const [third] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [roomRow("空で始める部屋", 2.6)],
    }).filter((r) => r.part3 === "空で始める部屋");
    expect(getRoomSheet(db, third.id).lowerJson).toBe("[]");
  });

  it("取り合いの欠除は設定として保存する（既定0.5m2）", () => {
    expect(getDeductionLimit(db)).toBe(0.5);
    saveDeductionLimit(db, 0.3);
    expect(getDeductionLimit(db)).toBe(0.3);
  });

  it("部位別入力表の行を消すと計算書も消える", () => {
    const project = createProject(db, "削除テスト");
    const [row] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [roomRow("倉庫", 2.4)],
    });
    getRoomSheet(db, row.id);

    saveEstimateRows(db, { projectId: project.id, rows: [] });
    expect(() => getRoomSheet(db, row.id)).toThrowError();
  });
});
