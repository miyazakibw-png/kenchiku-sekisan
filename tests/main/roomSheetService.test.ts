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
  getDeductionLimit,
  getRoomSheet,
  registerRoomFitting,
  saveDeductionLimit,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import {
  listFittings,
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
          areaFormula: "",
          baseboardFormula: "",
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
