import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import {
  applyMigrations,
  closeDatabase,
  initDatabase,
  type AppDatabase,
} from "../../src/main/db";
import { calcDetail, calcSet } from "../../src/core/room/calcSheet";
import { createProject } from "../../src/main/services/projectService";
import {
  listProjectSubjects,
  saveProjectSubjects,
} from "../../src/main/services/projectMasterService";
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

function projectDrafts(db: AppDatabase, projectId: number): SubjectDraft[] {
  return listProjectSubjects(db, projectId).map((subject) => ({
    id: subject.id,
    name: subject.name,
    skipPart2: subject.skipPart2,
    aggregateOrder: subject.aggregateOrder,
    note: subject.note,
    spare1: subject.spare1,
    spare2: subject.spare2,
  }));
}

function addProjectDetail(
  db: AppDatabase,
  projectId: number,
  subjectId: number,
  name: string,
): void {
  db.insert(schema.mDetails)
    .values({ projectId, scope: "project", subjectId, name })
    .run();
}

function addProjectCalcSheet(
  db: AppDatabase,
  projectId: number,
  subjectIds: number[],
): number {
  const estimateRowId = Number(
    db.run(
      sql`INSERT INTO project_estimate_rows (project_id, calc_type) VALUES (${projectId}, 'general')`,
    ).lastInsertRowid,
  );
  const set = calcSet(subjectIds.length);
  set.details = subjectIds.map((subjectId) =>
    calcDetail({ subjectId, name: `科目${subjectId}の明細` }),
  );
  db.run(
    sql`INSERT INTO project_general_sheets (project_id, estimate_row_id, lower_json) VALUES (${projectId}, ${estimateRowId}, ${JSON.stringify([set])})`,
  );
  return estimateRowId;
}

function addAggregateRun(db: AppDatabase, projectId: number): number {
  return Number(
    db.run(
      sql`INSERT INTO project_aggregate_runs (project_id) VALUES (${projectId})`,
    ).lastInsertRowid,
  );
}

function addBreakdownVersion(
  db: AppDatabase,
  projectId: number,
  newSubjects: number[],
): number {
  return Number(
    db.run(
      sql`INSERT INTO project_breakdown_versions (project_id, new_subjects_json) VALUES (${projectId}, ${JSON.stringify(newSubjects)})`,
    ).lastInsertRowid,
  );
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

describe("工事ごとの科目番号の付け替え", () => {
  it("低い番号の工事専用科目とその参照は、起動時の再採番で変わらない", () => {
    const projectId = createProject(db, "低い番号の工事専用科目").id;
    const rows = projectDrafts(db, projectId).filter((row) => row.id !== 2);
    const saved = saveProjectSubjects(db, projectId, [
      ...rows,
      {
        id: null,
        name: "工事専用2",
        skipPart2: 0,
        aggregateOrder: 1,
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);
    expect(
      saved.subjects.find((subject) => subject.name === "工事専用2")?.id,
    ).toBe(2);

    addProjectDetail(db, projectId, 2, "工事専用明細");
    const runId = addAggregateRun(db, projectId);
    db.insert(schema.projectAggregateItems)
      .values({ runId, masterKey: "manual:low", subjectId: 2 })
      .run();
    const versionId = addBreakdownVersion(db, projectId, [2]);
    db.insert(schema.projectBreakdownSettings)
      .values({ projectId, subjectOrderJson: "[2]" })
      .run();
    db.insert(schema.projectBreakdownRows)
      .values({
        versionId,
        rowKind: "subject",
        subjectId: 2,
        subjectName: "工事専用2",
      })
      .run();
    const estimateRowId = addProjectCalcSheet(db, projectId, [2]);

    expect(renumberSubjects(db)).toBe(false);
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "工事専用明細"))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.projectAggregateItems.subjectId })
        .from(schema.projectAggregateItems)
        .where(eq(schema.projectAggregateItems.masterKey, "manual:low"))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.projectBreakdownRows.subjectId })
        .from(schema.projectBreakdownRows)
        .where(eq(schema.projectBreakdownRows.versionId, versionId))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({
          subjectOrderJson: schema.projectBreakdownSettings.subjectOrderJson,
        })
        .from(schema.projectBreakdownSettings)
        .where(eq(schema.projectBreakdownSettings.projectId, projectId))
        .get()?.subjectOrderJson,
    ).toBe("[2]");
    const calcSheet = db
      .select({ lowerJson: schema.projectGeneralSheets.lowerJson })
      .from(schema.projectGeneralSheets)
      .where(eq(schema.projectGeneralSheets.estimateRowId, estimateRowId))
      .get();
    expect(
      JSON.parse(calcSheet?.lowerJson ?? "[]")[0].details[0].subjectId,
    ).toBe(2);
  });

  it("基本科目を再採番しても工事マスターと参照は変えない", () => {
    const projectId = createProject(db, "衝突する工事").id;
    const rows = projectDrafts(db, projectId).filter((row) => row.id !== 2);
    saveProjectSubjects(db, projectId, [
      ...rows,
      {
        id: null,
        name: "工事専用2",
        skipPart2: 0,
        aggregateOrder: 1,
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);
    addProjectDetail(db, projectId, 2, "工事専用明細");
    addProjectDetail(db, projectId, 1, "基本由来明細");
    db.insert(schema.detailChangeLogs)
      .values({
        projectId,
        scope: "project",
        subjectId: 2,
        beforeJson: '{"subjectId":2,"nested":{"subjectId":1}}',
        afterJson: '[{"subjectId":2}]',
      })
      .run();
    db.insert(schema.detailChangeLogs)
      .values({ projectId, scope: "project", subjectId: 1 })
      .run();
    db.insert(schema.projectTransferRows)
      .values({ projectId, subjectId: 2 })
      .run();
    db.insert(schema.projectTransferRules)
      .values({ projectId, masterKey: "transfer:2", subjectId: 2 })
      .run();
    db.insert(schema.projectManualAggregateItems)
      .values({ projectId, subjectId: 2, name: "手入力" })
      .run();
    const runId = addAggregateRun(db, projectId);
    db.insert(schema.projectAggregateDetails)
      .values({ runId, traceId: "detail-2", subjectId: 2 })
      .run();
    db.insert(schema.projectAggregateDetails)
      .values({ runId, traceId: "detail-1", subjectId: 1 })
      .run();
    db.insert(schema.projectAggregateItems)
      .values({
        runId,
        masterKey: "aggregate:2",
        subjectId: 2,
        roomsJson: '[{"subjectId":2,"nested":{"subjectId":1}}]',
      })
      .run();
    const assemblyId = Number(
      db.run(
        sql`INSERT INTO m_finish_assemblies (assembly_name, scope, project_id) VALUES ('工事セット', 'project', ${projectId})`,
      ).lastInsertRowid,
    );
    db.insert(schema.mFinishAssemblyItems)
      .values({ assemblyId, subjectId: 2, name: "セット明細" })
      .run();
    const versionId = addBreakdownVersion(db, projectId, [2, 1]);
    db.run(
      sql`UPDATE project_breakdown_versions SET confirmed = 1 WHERE id = ${versionId}`,
    );
    db.insert(schema.projectBreakdownSettings)
      .values({ projectId, subjectOrderJson: "[2,1]" })
      .run();
    db.insert(schema.projectBreakdownRows)
      .values({
        versionId,
        rowKind: "subject",
        subjectId: 2,
        wrapUpperSource: '{"subjectId":2}',
      })
      .run();
    db.insert(schema.projectBreakdownRows)
      .values({ versionId, rowKind: "subject", subjectId: 1 })
      .run();
    const estimateRowId = addProjectCalcSheet(db, projectId, [2, 1]);
    const lowerJson =
      db
        .select({ lowerJson: schema.projectGeneralSheets.lowerJson })
        .from(schema.projectGeneralSheets)
        .where(eq(schema.projectGeneralSheets.estimateRowId, estimateRowId))
        .get()?.lowerJson ?? "[]";
    db.run(
      sql`INSERT INTO project_room_sheets (project_id, estimate_row_id, lower_json) VALUES (${projectId}, ${estimateRowId}, ${lowerJson})`,
    );
    db.run(
      sql`INSERT INTO project_frame_sheets (project_id, estimate_row_id, lower_json) VALUES (${projectId}, ${estimateRowId}, ${lowerJson})`,
    );
    db.run(
      sql`INSERT INTO project_pit_sheets (project_id, estimate_row_id, lower_json) VALUES (${projectId}, ${estimateRowId}, ${lowerJson})`,
    );
    db.insert(schema.projectMiscSheets)
      .values({ projectId, columnsJson: '[{"subjectId":2}]' })
      .run();
    db.insert(schema.projectFurnitureSheets)
      .values({
        projectId,
        rowsJson: '[{"subjectId":2}]',
        columnsJson: '[{"subjectId":1}]',
      })
      .run();
    db.insert(schema.projectFireproofSheets)
      .values({ projectId, estimateJson: '[{"detail":{"subjectId":2}}]' })
      .run();
    db.insert(schema.projectFormworkRuns)
      .values({
        projectId,
        createdAt: "2024-01-01T00:00:00.000Z",
        rowsJson: '[{"subjectId":2}]',
      })
      .run();
    const definitionId = db
      .select({ id: schema.calcSheetDefinitions.id })
      .from(schema.calcSheetDefinitions)
      .get()?.id;
    if (definitionId !== undefined) {
      db.insert(schema.calcSheetEntries)
        .values({
          projectId,
          definitionId,
          dataJson: '{"details":[{"subjectId":2}]}',
        })
        .run();
    }
    db.insert(schema.mDetails)
      .values({ subjectId: 1, name: "基本スコープ明細", scope: "basic" })
      .run();
    const projectSubjectsBefore = db
      .select({
        number: schema.projectMasters.number,
        name: schema.projectMasters.name,
        sourceNumber: schema.projectMasters.sourceNumber,
      })
      .from(schema.projectMasters)
      .where(
        and(
          eq(schema.projectMasters.projectId, projectId),
          eq(schema.projectMasters.kind, "subjects"),
        ),
      )
      .orderBy(asc(schema.projectMasters.number))
      .all();

    const untouchedProjectId = createProject(
      db,
      "工事専用番号が重なる別工事",
    ).id;
    db.delete(schema.projectMasters)
      .where(
        and(
          eq(schema.projectMasters.projectId, untouchedProjectId),
          eq(schema.projectMasters.kind, "subjects"),
        ),
      )
      .run();
    db.insert(schema.projectMasters)
      .values({
        projectId: untouchedProjectId,
        kind: "subjects",
        number: 1,
        sourceNumber: null,
        name: "別工事専用1",
      })
      .run();
    addProjectDetail(db, untouchedProjectId, 1, "別工事専用明細");

    const basicRows = drafts(db);
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
      ...basicRows,
    ]);

    expect(
      db
        .select({
          number: schema.projectMasters.number,
          name: schema.projectMasters.name,
          sourceNumber: schema.projectMasters.sourceNumber,
        })
        .from(schema.projectMasters)
        .where(
          and(
            eq(schema.projectMasters.projectId, projectId),
            eq(schema.projectMasters.kind, "subjects"),
          ),
        )
        .orderBy(asc(schema.projectMasters.number))
        .all(),
    ).toEqual(projectSubjectsBefore);
    expect(
      listSubjects(db).find((subject) => subject.name === basicRows[0].name)
        ?.id,
    ).toBe(2);

    const movedSubjectId = listProjectSubjects(db, projectId).find(
      (subject) => subject.name === "工事専用2",
    )?.id;
    expect(movedSubjectId).toBe(2);
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "工事専用明細"))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "基本由来明細"))
        .get()?.subjectId,
    ).toBe(1);
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "基本スコープ明細"))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "別工事専用明細"))
        .get()?.subjectId,
    ).toBe(1);
    expect(
      db
        .select({ subjectId: schema.projectTransferRows.subjectId })
        .from(schema.projectTransferRows)
        .where(eq(schema.projectTransferRows.projectId, projectId))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.projectTransferRules.subjectId })
        .from(schema.projectTransferRules)
        .where(eq(schema.projectTransferRules.projectId, projectId))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.detailChangeLogs.subjectId })
        .from(schema.detailChangeLogs)
        .where(eq(schema.detailChangeLogs.projectId, projectId))
        .all()
        .map((row) => row.subjectId)
        .sort((left, right) => left - right),
    ).toEqual([1, 2]);
    const changedLog = db
      .select({
        beforeJson: schema.detailChangeLogs.beforeJson,
        afterJson: schema.detailChangeLogs.afterJson,
      })
      .from(schema.detailChangeLogs)
      .where(eq(schema.detailChangeLogs.subjectId, 2))
      .get();
    expect(JSON.parse(changedLog?.beforeJson ?? "{}")).toEqual({
      subjectId: 2,
      nested: { subjectId: 1 },
    });
    expect(JSON.parse(changedLog?.afterJson ?? "[]")).toEqual([
      { subjectId: 2 },
    ]);
    expect(
      db
        .select({ subjectId: schema.projectManualAggregateItems.subjectId })
        .from(schema.projectManualAggregateItems)
        .where(eq(schema.projectManualAggregateItems.projectId, projectId))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.projectAggregateDetails.subjectId })
        .from(schema.projectAggregateDetails)
        .where(eq(schema.projectAggregateDetails.traceId, "detail-2"))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.projectAggregateDetails.subjectId })
        .from(schema.projectAggregateDetails)
        .where(eq(schema.projectAggregateDetails.traceId, "detail-1"))
        .get()?.subjectId,
    ).toBe(1);
    const aggregate = db
      .select({
        subjectId: schema.projectAggregateItems.subjectId,
        roomsJson: schema.projectAggregateItems.roomsJson,
      })
      .from(schema.projectAggregateItems)
      .where(eq(schema.projectAggregateItems.masterKey, "aggregate:2"))
      .get();
    expect(aggregate?.subjectId).toBe(2);
    expect(JSON.parse(aggregate?.roomsJson ?? "[]")).toEqual([
      { subjectId: 2, nested: { subjectId: 1 } },
    ]);
    expect(
      db
        .select({ subjectId: schema.mFinishAssemblyItems.subjectId })
        .from(schema.mFinishAssemblyItems)
        .where(eq(schema.mFinishAssemblyItems.assemblyId, assemblyId))
        .get()?.subjectId,
    ).toBe(2);
    expect(
      db
        .select({
          subjectOrderJson: schema.projectBreakdownSettings.subjectOrderJson,
        })
        .from(schema.projectBreakdownSettings)
        .where(eq(schema.projectBreakdownSettings.projectId, projectId))
        .get()?.subjectOrderJson,
    ).toBe("[2,1]");
    expect(
      db
        .select({
          newSubjectsJson: schema.projectBreakdownVersions.newSubjectsJson,
        })
        .from(schema.projectBreakdownVersions)
        .where(eq(schema.projectBreakdownVersions.id, versionId))
        .get()?.newSubjectsJson,
    ).toBe("[2,1]");
    const breakdown = db
      .select({
        subjectId: schema.projectBreakdownRows.subjectId,
        wrapUpperSource: schema.projectBreakdownRows.wrapUpperSource,
      })
      .from(schema.projectBreakdownRows)
      .where(eq(schema.projectBreakdownRows.versionId, versionId))
      .all();
    expect(breakdown.map((row) => row.subjectId)).toEqual([2, 1]);
    expect(JSON.parse(breakdown[0].wrapUpperSource)).toEqual({
      subjectId: 2,
    });
    const calcJson = db
      .select({ lowerJson: schema.projectGeneralSheets.lowerJson })
      .from(schema.projectGeneralSheets)
      .where(eq(schema.projectGeneralSheets.estimateRowId, estimateRowId))
      .get()?.lowerJson;
    expect(
      JSON.parse(calcJson ?? "[]")[0].details.map(
        (detail: { subjectId: number }) => detail.subjectId,
      ),
    ).toEqual([2, 1]);
    const roomJson = db
      .select({ lowerJson: schema.projectRoomSheets.lowerJson })
      .from(schema.projectRoomSheets)
      .where(eq(schema.projectRoomSheets.estimateRowId, estimateRowId))
      .get()?.lowerJson;
    expect(JSON.parse(roomJson ?? "[]")[0].details[0].subjectId).toBe(2);
    const frameJson = db
      .select({ lowerJson: schema.projectFrameSheets.lowerJson })
      .from(schema.projectFrameSheets)
      .where(eq(schema.projectFrameSheets.estimateRowId, estimateRowId))
      .get()?.lowerJson;
    expect(JSON.parse(frameJson ?? "[]")[0].details[0].subjectId).toBe(2);
    const pitJson = db
      .select({ lowerJson: schema.projectPitSheets.lowerJson })
      .from(schema.projectPitSheets)
      .where(eq(schema.projectPitSheets.estimateRowId, estimateRowId))
      .get()?.lowerJson;
    expect(JSON.parse(pitJson ?? "[]")[0].details[0].subjectId).toBe(2);
    expect(
      db
        .select({ columnsJson: schema.projectMiscSheets.columnsJson })
        .from(schema.projectMiscSheets)
        .where(eq(schema.projectMiscSheets.projectId, projectId))
        .get()?.columnsJson,
    ).toBe('[{"subjectId":2}]');
    const furniture = db
      .select({
        rowsJson: schema.projectFurnitureSheets.rowsJson,
        columnsJson: schema.projectFurnitureSheets.columnsJson,
      })
      .from(schema.projectFurnitureSheets)
      .where(eq(schema.projectFurnitureSheets.projectId, projectId))
      .get();
    expect(JSON.parse(furniture?.rowsJson ?? "[]")[0].subjectId).toBe(2);
    expect(JSON.parse(furniture?.columnsJson ?? "[]")[0].subjectId).toBe(1);
    expect(
      db
        .select({ estimateJson: schema.projectFireproofSheets.estimateJson })
        .from(schema.projectFireproofSheets)
        .where(eq(schema.projectFireproofSheets.projectId, projectId))
        .get()?.estimateJson,
    ).toBe('[{"detail":{"subjectId":2}}]');
    expect(
      db
        .select({ rowsJson: schema.projectFormworkRuns.rowsJson })
        .from(schema.projectFormworkRuns)
        .where(eq(schema.projectFormworkRuns.projectId, projectId))
        .get()?.rowsJson,
    ).toBe('[{"subjectId":2}]');
    if (definitionId !== undefined) {
      const dataJson = db
        .select({ dataJson: schema.calcSheetEntries.dataJson })
        .from(schema.calcSheetEntries)
        .where(eq(schema.calcSheetEntries.projectId, projectId))
        .get()?.dataJson;
      expect(JSON.parse(dataJson ?? "{}").details[0].subjectId).toBe(2);
    }
  });

  it("工事科目マスターがない物件は基本科目保存前に写し、既存参照を保つ", () => {
    const projectId = createProject(db, "基本科目を使う工事").id;
    db.delete(schema.projectMasters)
      .where(
        and(
          eq(schema.projectMasters.projectId, projectId),
          eq(schema.projectMasters.kind, "subjects"),
        ),
      )
      .run();
    const originalSubjects = listSubjects(db).map(({ id, name }) => ({
      id,
      name,
    }));
    const estimateRowId = addProjectCalcSheet(db, projectId, [1]);
    const versionId = addBreakdownVersion(db, projectId, [1]);
    db.insert(schema.projectBreakdownSettings)
      .values({ projectId, subjectOrderJson: "[1]" })
      .run();
    db.insert(schema.projectBreakdownRows)
      .values({ versionId, rowKind: "subject", subjectId: 1 })
      .run();
    addProjectDetail(db, projectId, 1, "基本番号の明細");
    const runId = addAggregateRun(db, projectId);
    db.insert(schema.projectAggregateItems)
      .values({ runId, masterKey: "snapshot:basic", subjectId: 1 })
      .run();

    const basicRows = drafts(db);
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
      ...basicRows,
    ]);

    expect(
      db
        .select({
          number: schema.projectMasters.number,
          name: schema.projectMasters.name,
        })
        .from(schema.projectMasters)
        .where(
          and(
            eq(schema.projectMasters.projectId, projectId),
            eq(schema.projectMasters.kind, "subjects"),
          ),
        )
        .orderBy(asc(schema.projectMasters.number))
        .all(),
    ).toEqual(originalSubjects.map(({ id, name }) => ({ number: id, name })));
    expect(
      listProjectSubjects(db, projectId).map(({ id, name }) => ({ id, name })),
    ).toEqual(originalSubjects);
    expect(
      listSubjects(db).find((subject) => subject.name === basicRows[0].name)
        ?.id,
    ).toBe(2);
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "基本番号の明細"))
        .get()?.subjectId,
    ).toBe(1);
    const calcJson = db
      .select({ lowerJson: schema.projectGeneralSheets.lowerJson })
      .from(schema.projectGeneralSheets)
      .where(eq(schema.projectGeneralSheets.estimateRowId, estimateRowId))
      .get()?.lowerJson;
    expect(JSON.parse(calcJson ?? "[]")[0].details[0].subjectId).toBe(1);
    expect(
      db
        .select({ subjectId: schema.projectBreakdownRows.subjectId })
        .from(schema.projectBreakdownRows)
        .where(eq(schema.projectBreakdownRows.versionId, versionId))
        .get()?.subjectId,
    ).toBe(1);
    expect(
      db
        .select({
          subjectOrderJson: schema.projectBreakdownSettings.subjectOrderJson,
        })
        .from(schema.projectBreakdownSettings)
        .where(eq(schema.projectBreakdownSettings.projectId, projectId))
        .get()?.subjectOrderJson,
    ).toBe("[1]");
    expect(
      db
        .select({
          newSubjectsJson: schema.projectBreakdownVersions.newSubjectsJson,
        })
        .from(schema.projectBreakdownVersions)
        .where(eq(schema.projectBreakdownVersions.id, versionId))
        .get()?.newSubjectsJson,
    ).toBe("[1]");
    expect(
      db
        .select({ subjectId: schema.projectAggregateItems.subjectId })
        .from(schema.projectAggregateItems)
        .where(eq(schema.projectAggregateItems.masterKey, "snapshot:basic"))
        .get()?.subjectId,
    ).toBe(1);
  });

  it("起動時に工事マスターを写しても基本科目の再採番で工事側は変わらない", () => {
    const directory = mkdtempSync(join(tmpdir(), "sekisan-startup-masters-"));
    const filePath = join(directory, "sekisan.db");
    const sqlite = new Database(filePath);
    let sqliteClosed = false;
    try {
      sqlite.pragma("foreign_keys = ON");
      applyMigrations(sqlite);
      const existingDb = drizzle(sqlite, { schema }) as AppDatabase;
      seedInitialData(existingDb);
      const projectId = createProject(existingDb, "古い工事").id;
      existingDb
        .delete(schema.projectMasters)
        .where(eq(schema.projectMasters.projectId, projectId))
        .run();
      existingDb.run(
        sql`UPDATE m_subjects SET display_order = CASE id WHEN 1 THEN 1 WHEN 2 THEN 0 ELSE display_order END`,
      );
      const originalSubjects = existingDb
        .select({ id: schema.mSubjects.id, name: schema.mSubjects.name })
        .from(schema.mSubjects)
        .orderBy(asc(schema.mSubjects.displayOrder), asc(schema.mSubjects.id))
        .all();
      sqlite.close();
      sqliteClosed = true;

      const initializedDb = initDatabase(filePath);
      const projectSubjects = initializedDb
        .select({
          number: schema.projectMasters.number,
          sourceNumber: schema.projectMasters.sourceNumber,
          name: schema.projectMasters.name,
        })
        .from(schema.projectMasters)
        .where(
          and(
            eq(schema.projectMasters.projectId, projectId),
            eq(schema.projectMasters.kind, "subjects"),
          ),
        )
        .orderBy(asc(schema.projectMasters.displayOrder))
        .all();
      expect(projectSubjects).toEqual(
        originalSubjects.map((subject) => ({
          number: subject.id,
          sourceNumber: subject.id,
          name: subject.name,
        })),
      );
      expect(
        [
          ...new Set(
            initializedDb
              .select({ kind: schema.projectMasters.kind })
              .from(schema.projectMasters)
              .where(eq(schema.projectMasters.projectId, projectId))
              .all()
              .map((row) => row.kind),
          ),
        ].sort(),
      ).toEqual([
        "aggregationParts",
        "formworkCategories",
        "materialCategories",
        "pickupParts",
        "subjects",
        "units",
      ]);
      expect(
        listSubjects(initializedDb).find(
          (subject) => subject.name === originalSubjects[0].name,
        )?.id,
      ).toBe(1);
      expect(renumberSubjects(initializedDb)).toBe(false);
      expect(
        initializedDb
          .select({
            number: schema.projectMasters.number,
            sourceNumber: schema.projectMasters.sourceNumber,
            name: schema.projectMasters.name,
          })
          .from(schema.projectMasters)
          .where(
            and(
              eq(schema.projectMasters.projectId, projectId),
              eq(schema.projectMasters.kind, "subjects"),
            ),
          )
          .orderBy(asc(schema.projectMasters.displayOrder))
          .all(),
      ).toEqual(projectSubjects);
    } finally {
      if (!sqliteClosed) sqlite.close();
      closeDatabase();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
