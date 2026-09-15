import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import {
  createProject,
  listProjectLedger,
  nextManagementNo,
} from "../../src/main/services/projectService";
import { saveEstimateRows } from "../../src/main/services/estimateRowService";
import {
  getRoomSheet,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import { runAggregation } from "../../src/main/services/aggregationService";
import {
  checkProjectFile,
  exportProjectFile,
  importProjectFile,
} from "../../src/main/services/projectFileService";
import type { EstimateRowDraft } from "../../src/shared/types";

interface Bundle {
  db: AppDatabase;
  sqlite: Database.Database;
}

function createDb(): Bundle {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return { db, sqlite };
}

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
        descriptionUpper: "",
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

describe("1物件だけの掃き出しと読み込み", () => {
  let from: Bundle;
  let dir: string;
  let filePath: string;
  let projectId: number;

  beforeEach(() => {
    from = createDb();
    dir = mkdtempSync(join(tmpdir(), "sekisan-project-file-"));
    filePath = join(dir, "project.sekisan");
    projectId = createProject(from.db, "掃き出しテスト").id;
    const rows = saveEstimateRows(from.db, {
      projectId,
      rows: [roomRow("事務室")],
    });
    const sheet = getRoomSheet(from.db, rows[0].id);
    saveRoomSheet(from.db, {
      id: sheet.id,
      shapeJson: SHAPE_JSON,
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: LOWER_JSON,
      ceilingHeight: 2.5,
      note: "",
    });
    runAggregation(from.db, projectId);
  });

  it("書き出したファイルを別のパソコン（別データ）に読み込める", () => {
    exportProjectFile(from.sqlite, projectId, filePath);
    const to = createDb();

    const info = checkProjectFile(to.sqlite, filePath);
    expect(info.ok).toBe(true);
    expect(info.name).toBe("掃き出しテスト");
    expect(info.sameManagementNo).toBe(false);

    const result = importProjectFile(to.sqlite, filePath, "add", () =>
      nextManagementNo(to.db),
    );
    expect(result.replaced).toBe(false);

    const ledger = listProjectLedger(to.db);
    expect(ledger.projects).toHaveLength(1);
    expect(ledger.projects[0].name).toBe("掃き出しテスト");

    // 計算書の数量根拠（床面積12m2）がそのまま出る
    const view = runAggregation(to.db, result.projectId);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(12);
  });

  it("同じ管理番号があるとき、置き換えると1件のまま入れ替わる", () => {
    exportProjectFile(from.sqlite, projectId, filePath);
    const info = checkProjectFile(from.sqlite, filePath);
    expect(info.sameManagementNo).toBe(true);

    const result = importProjectFile(from.sqlite, filePath, "replace", () =>
      nextManagementNo(from.db),
    );
    expect(result.replaced).toBe(true);
    const ledger = listProjectLedger(from.db);
    expect(ledger.projects).toHaveLength(1);
    expect(ledger.projects[0].managementNo).toBe(info.managementNo);
  });

  it("同じ管理番号があるとき、別の工事として足すと2件になる", () => {
    exportProjectFile(from.sqlite, projectId, filePath);
    const result = importProjectFile(from.sqlite, filePath, "add", () =>
      nextManagementNo(from.db),
    );
    expect(result.replaced).toBe(false);
    const ledger = listProjectLedger(from.db);
    expect(ledger.projects).toHaveLength(2);
    expect(ledger.projects[1].managementNo).not.toBe(
      ledger.projects[0].managementNo,
    );
    // 読み込んだ方の計算書も独立して数量が出る（元の工事は変わらない）
    expect(runAggregation(from.db, result.projectId).items[0].quantity).toBe(
      12,
    );
    expect(runAggregation(from.db, projectId).items[0].quantity).toBe(12);
  });

  it("工事が2件以上入ったファイルは1物件の読み込みでは受け付けない", () => {
    const allPath = join(dir, "all.db");
    const all = new Database(allPath);
    migrations.forEach((sql) => all.exec(sql));
    all
      .prepare("INSERT INTO projects (management_no, name) VALUES (?, ?)")
      .run("P-0001", "工事1");
    all
      .prepare("INSERT INTO projects (management_no, name) VALUES (?, ?)")
      .run("P-0002", "工事2");
    all.close();

    const info = checkProjectFile(from.sqlite, allPath);
    expect(info.ok).toBe(false);
    expect(info.message).toContain("1物件の掃き出しファイルではありません");
  });
});
