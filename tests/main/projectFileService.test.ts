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
import { listProjectSubjects } from "../../src/main/services/projectMasterService";
import { saveEstimateRows } from "../../src/main/services/estimateRowService";
import {
  getRoomSheet,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import {
  insertAggregateManualItem,
  runAggregation,
  setDetailUnused,
} from "../../src/main/services/aggregationService";
import { checkBackupFile } from "../../src/main/db";
import {
  checkProjectFile,
  deleteProjectFully,
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

  it("detail_first列のない旧形式ファイルは0で読み込む", () => {
    const legacyPath = join(dir, "legacy.sekisan");
    const legacy = new Database(legacyPath);
    migrations.slice(0, -1).forEach((sql) => legacy.exec(sql));
    legacy.pragma(`user_version = ${migrations.length - 1}`);
    const legacyProjectId = Number(
      legacy
        .prepare("INSERT INTO projects (management_no, name) VALUES (?, ?)")
        .run("P-LEGACY", "旧形式工事").lastInsertRowid,
    );
    legacy
      .prepare(
        "INSERT INTO project_masters (project_id, kind, number, name, aggregate_order) VALUES (?, ?, ?, ?, ?)",
      )
      .run(legacyProjectId, "subjects", 12, "旧形式科目", 2);
    const masterColumns = legacy
      .prepare("PRAGMA table_info(project_masters)")
      .all() as { name: string }[];
    expect(masterColumns.some((column) => column.name === "detail_first")).toBe(
      false,
    );
    legacy.close();

    const imported = importProjectFile(from.sqlite, legacyPath, "add", () =>
      nextManagementNo(from.db),
    );

    expect(
      listProjectSubjects(from.db, imported.projectId).find(
        (subject) => subject.id === 12,
      )?.detailFirst,
    ).toBe(0);
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

  it("工事を消すと計算書・集計もいっしょに消え、他の工事は残る", () => {
    const other = createProject(from.db, "残す工事").id;
    deleteProjectFully(from.sqlite, projectId);

    const ledger = listProjectLedger(from.db);
    expect(ledger.projects).toHaveLength(1);
    expect(ledger.projects[0].id).toBe(other);
    // 消した工事の行が残っていない（計算書・集計・工事専用マスター）
    const orphans = [
      "project_estimate_rows",
      "project_room_sheets",
      "project_aggregate_runs",
      "m_details",
      "project_masters",
      "detail_change_logs",
    ].map((table) => {
      const row = from.sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`)
        .get(projectId) as { n: number };
      return row.n;
    });
    expect(orphans).toEqual([0, 0, 0, 0, 0, 0]);
    // 工事専用仕上明細セットの中の明細も残っていない
    const items = from.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM m_finish_assembly_items WHERE assembly_id NOT IN (SELECT id FROM m_finish_assemblies)",
      )
      .get() as { n: number };
    expect(items.n).toBe(0);
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

  it("集計書へ手で入れた行も移り、付き先・不要の印が付け直した番号に合う", () => {
    const first = runAggregation(from.db, projectId);
    const runId = first.run!.id;
    const afterDetail = insertAggregateManualItem(from.db, {
      projectId,
      runId,
      afterMasterKey: first.items[0].masterKey,
    });
    const manual1 = afterDetail.items[1].masterKey;
    const afterManual = insertAggregateManualItem(from.db, {
      projectId,
      runId: afterDetail.run!.id,
      afterMasterKey: manual1,
    });
    setDetailUnused(from.db, {
      projectId,
      masterKey: manual1,
      unused: true,
      note: "指示で不要",
    });
    const before = runAggregation(from.db, projectId);
    expect(afterManual.items).toHaveLength(3);

    exportProjectFile(from.sqlite, projectId, filePath);
    const to = createDb();
    // 読み込み先には先に別の工事の手入力行があり、番号がずれる
    const other = createProject(to.db, "別の工事").id;
    for (let i = 0; i < 5; i++) {
      to.sqlite
        .prepare(
          "INSERT INTO project_manual_aggregate_items (project_id) VALUES (?)",
        )
        .run(other);
    }
    const result = importProjectFile(to.sqlite, filePath, "add", () =>
      nextManagementNo(to.db),
    );
    const view = runAggregation(to.db, result.projectId);
    expect(view.items).toHaveLength(3);
    expect(view.items[0].masterKey).toBe(before.items[0].masterKey);
    expect(view.items[1].masterKey).not.toBe(before.items[1].masterKey);
    expect(view.items.map((item) => item.unused)).toEqual(
      before.items.map((item) => item.unused),
    );
    const keys = to.sqlite
      .prepare(
        "SELECT id, after_master_key FROM project_manual_aggregate_items WHERE project_id = ? ORDER BY id",
      )
      .all(result.projectId) as { id: number; after_master_key: string }[];
    expect(keys[1].after_master_key).toBe(`manual:${keys[0].id}`);
    const unused = to.sqlite
      .prepare(
        "SELECT master_key, note FROM project_unused_details WHERE project_id = ?",
      )
      .all(result.projectId);
    expect(unused).toEqual([
      { master_key: `manual:${keys[0].id}`, note: "指示で不要" },
    ]);
  });

  it("エクセル積算移行ソフトのデータは全体の復元で受け付けない", () => {
    const plainPath = join(dir, "plain.db");
    const plain = new Database(plainPath);
    migrations.forEach((sql) => plain.exec(sql));
    plain.close();
    expect(checkBackupFile(plainPath).ok).toBe(true);

    const migratorPath = join(dir, "migrator.db");
    const migrator = new Database(migratorPath);
    migrations.slice(0, 62).forEach((sql) => migrator.exec(sql));
    migrator.exec(
      "CREATE TABLE project_excel_notes (id INTEGER PRIMARY KEY, project_id INTEGER)",
    );
    migrator.pragma("user_version = 64");
    migrator.close();
    const checked = checkBackupFile(migratorPath);
    expect(checked.ok).toBe(false);
    expect(checked.message).toContain("1物件の掃き出し");
  });
});
