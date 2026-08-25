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
import { runAggregation } from "../../src/main/services/aggregationService";
import {
  confirmBreakdownVersion,
  getBreakdown,
  listBreakdownVersions,
  saveBreakdownRows,
  saveBreakdownSettings,
  transferBreakdown,
} from "../../src/main/services/breakdownService";
import { buildExport } from "../../src/main/services/breakdownExportService";
import type { EstimateRowDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function roomRow(part3: string): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "建築",
    part2: "1階",
    part2Split: 1,
    formwork: "",
    part3,
    ceilingHeight: 2.5,
    multiplier: 1,
    note: "",
    calcType: "room",
  };
}

/** 4m×3m の部屋（床面積12m2） */
const SHAPE_JSON = JSON.stringify({
  edges: [
    { id: "e1", direction: "E", length: 4, kind: "wall" },
    { id: "e2", direction: "S", length: 3, kind: "wall" },
    { id: "e3", direction: "W", length: 4, kind: "wall" },
    { id: "e4", direction: "N", length: 3, kind: "wall" },
  ],
});

const LOWER_JSON = JSON.stringify([
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
        descriptionUpper: "上段摘要",
        descriptionLower: "t=2.0",
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
]);

describe("内訳書", () => {
  let db: AppDatabase;
  let projectId: number;

  beforeEach(() => {
    db = createDb();
    projectId = createProject(db, "内訳書テスト").id;
    const rows = saveEstimateRows(db, {
      projectId,
      rows: [roomRow("事務室")],
    });
    const sheet = getRoomSheet(db, rows[0].id);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: LOWER_JSON,
      ceilingHeight: 2.5,
      note: "",
    });
    runAggregation(db, projectId);
  });

  it("集計書から転記して科目見出しと明細を作る", () => {
    const view = transferBreakdown(db, projectId);
    expect(view.version?.round).toBe(1);
    expect(view.rows[0].rowKind).toBe("subject");
    const detail = view.rows.find((row) => row.rowKind === "detail");
    expect(detail?.nameLower).toBe("ビニル床シート");
    expect(detail?.quantity).toBe(12);
    expect(detail?.unit).toBe("m2");
    // 集計書で使っている科目・単位を設定へ自動で用意する
    expect(view.settings.subjectOrder).toContain(5);
    expect(view.settings.unitOrder).toEqual(["m2"]);
  });

  it("確定するまでは何度転記しても同じ回、確定後は次の回になる", () => {
    const first = transferBreakdown(db, projectId);
    const again = transferBreakdown(db, projectId);
    expect(again.version?.id).toBe(first.version?.id);
    expect(again.version?.round).toBe(1);

    confirmBreakdownVersion(db, first.version?.id ?? 0);
    const second = transferBreakdown(db, projectId);
    expect(second.version?.round).toBe(2);
    // 過去の回は消さない
    expect(listBreakdownVersions(db, projectId)).toHaveLength(2);
    expect(getBreakdown(db, projectId, first.version?.id).rows.length).toBe(
      first.rows.length,
    );
  });

  it("工種科目の並べ替えは2回目以降も持ち越す", () => {
    const first = transferBreakdown(db, projectId);
    saveBreakdownSettings(db, {
      ...first.settings,
      subjectOrder: [9, 5, 1],
    });
    confirmBreakdownVersion(db, first.version?.id ?? 0);

    const second = transferBreakdown(db, projectId);
    expect(second.version?.round).toBe(2);
    expect(second.settings.subjectOrder).toEqual([9, 5, 1]);
  });

  it("画面で並べ替えた行位置を保存する", () => {
    const view = transferBreakdown(db, projectId);
    const reversed = [...view.rows].reverse();
    const saved = saveBreakdownRows(db, view.version?.id ?? 0, reversed);
    expect(saved.map((row) => row.rowKind)).toEqual(
      reversed.map((row) => row.rowKind),
    );
  });

  it("摘要の置き換えと名称の全角設定を反映する", () => {
    saveBreakdownSettings(db, {
      ...getBreakdown(db, projectId).settings,
      nameWidth: "full",
      replacements: [{ from: "t=", to: "厚" }],
    });
    const view = transferBreakdown(db, projectId);
    const detail = view.rows.find((row) => row.rowKind === "detail");
    expect(detail?.descriptionLower).toBe("厚2.0");
  });

  it("BCS.CSVはShift_JISで、エクセルは科目ごとのシートで掃き出す", () => {
    const view = transferBreakdown(db, projectId);
    const bcs = buildExport("bcs", view.rows, view.settings, "港区計画");
    expect(bcs.defaultName).toBe("港区計画_BCS.CSV");
    // CP932 なので UTF-8 とはバイト列が変わる
    expect(bcs.content.includes(Buffer.from("港区計画", "utf8"))).toBe(false);

    const excel = buildExport(
      "excelBySubject",
      view.rows,
      view.settings,
      "港区計画",
    );
    expect(excel.defaultName).toBe("港区計画_内訳書.xls");
    expect(excel.content.toString("utf8")).toContain("<Worksheet");
  });
});
