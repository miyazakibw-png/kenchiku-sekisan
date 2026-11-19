import Database from "better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import {
  createProject,
  copyProject,
} from "../../src/main/services/projectService";
import {
  copyBasicMastersToProject,
  listProjectBasicMasters,
  listProjectSubjects,
  projectMasterKinds,
  saveProjectBasicMaster,
  saveProjectSubjects,
  syncProjectBasicMasterToBasic,
} from "../../src/main/services/projectMasterService";
import {
  listBasicMasters,
  saveBasicMaster,
} from "../../src/main/services/basicMasterService";
import {
  listSubjects,
  renumberSubjects,
  saveSubjects,
} from "../../src/main/services/subjectService";
import { listMasterOptions } from "../../src/main/services/detailService";
import type { SubjectDraft } from "../../src/shared/types";
import {
  nextBasicMasterId,
  type BasicMasterKind,
  type BasicMasterRow,
} from "../../src/core/masters/basicMaster";

/** 基本マスターの末尾に1行足した並び（番号は空いている一番小さい番号） */
function withExtraRow(
  rows: BasicMasterRow[],
  kind: BasicMasterKind,
  name: string,
): BasicMasterRow[] {
  return [...rows, { id: nextBasicMasterId(kind, rows), name, note: "" }];
}

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function subjectDrafts(db: AppDatabase, projectId: number): SubjectDraft[] {
  return listProjectSubjects(db, projectId).map((subject) => ({
    id: subject.id,
    name: subject.name,
    skipPart2: subject.skipPart2,
    aggregateOrder: subject.aggregateOrder,
    detailFirst: subject.detailFirst,
    note: subject.note,
    spare1: subject.spare1,
    spare2: subject.spare2,
  }));
}

describe("工事別の基準マスター", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("新規工事に基準マスターを複製する", () => {
    const project = createProject(db, "テスト工事");
    expect(projectMasterKinds(db, project.id)).toEqual([
      "subjects",
      "pickupParts",
      "materialCategories",
      "units",
      "aggregationParts",
      "formworkCategories",
    ]);
    expect(listProjectSubjects(db, project.id)).toEqual(listSubjects(db));
    expect(listProjectBasicMasters(db, project.id)).toEqual(
      listBasicMasters(db),
    );
  });

  it("工事側の修正は基本マスターに影響しない", () => {
    const project = createProject(db, "テスト工事");
    const before = listBasicMasters(db);
    const rows = before.aggregationParts.map((row, index) =>
      index === 0 ? { ...row, name: "工事だけの部位" } : row,
    );
    const saved = saveProjectBasicMaster(
      db,
      project.id,
      "aggregationParts",
      rows,
    );
    expect(saved.errors).toEqual([]);
    expect(saved.masters.aggregationParts[0]?.name).toBe("工事だけの部位");
    expect(listBasicMasters(db).aggregationParts).toEqual(
      before.aggregationParts,
    );
  });

  it("基本マスターの修正は工事側を上書きしない", () => {
    const project = createProject(db, "テスト工事");
    const basic = listBasicMasters(db);
    const renamed = basic.units.map((row, index) =>
      index === 0 ? { ...row, name: "基本だけ変更" } : row,
    );
    expect(saveBasicMaster(db, "units", renamed).errors).toEqual([]);
    expect(listProjectBasicMasters(db, project.id).units[0]?.name).toBe(
      basic.units[0]?.name,
    );
  });

  it("明細順を基本科目から工事へ複製し、工事コピーにも引き継ぐ", () => {
    const project = createProject(db, "明細順複製元");
    const basicRows = listSubjects(db).map((subject, index) => ({
      id: subject.id,
      name: subject.name,
      skipPart2: subject.skipPart2,
      aggregateOrder: subject.aggregateOrder,
      detailFirst: index === 0 ? 1 : subject.detailFirst,
      note: subject.note,
      spare1: subject.spare1,
      spare2: subject.spare2,
    }));
    saveSubjects(db, basicRows);

    copyBasicMastersToProject(db, project.id, true);

    expect(listProjectSubjects(db, project.id)[0].detailFirst).toBe(1);
    const copied = copyProject(db, project.id, "明細順複製先");
    expect(listProjectSubjects(db, copied.id)[0].detailFirst).toBe(1);
  });

  it("開いている種類だけ工事から基本マスターへ同期する", () => {
    const project = createProject(db, "同期元工事");
    const otherProject = createProject(db, "別工事");
    const before = listBasicMasters(db);
    const projectRows = [
      { id: 3, name: "工事側の床", note: "工事側の備考" },
      { id: 88, name: "工事側の追加", note: "追加の備考" },
    ];
    const otherProjectRows = [
      { id: 2, name: "別工事の床", note: "別工事の備考" },
      { id: 77, name: "別工事専用", note: "" },
    ];
    saveProjectBasicMaster(db, project.id, "pickupParts", projectRows);
    saveProjectBasicMaster(
      db,
      otherProject.id,
      "pickupParts",
      otherProjectRows,
    );

    const result = syncProjectBasicMasterToBasic(db, project.id, "pickupParts");

    expect(result.errors).toEqual([]);
    expect(result.masters.pickupParts).toEqual(projectRows);
    expect(listBasicMasters(db).pickupParts).toEqual(projectRows);
    expect(listBasicMasters(db).materialCategories).toEqual(
      before.materialCategories,
    );
    expect(listBasicMasters(db).units).toEqual(before.units);
    expect(listProjectBasicMasters(db, otherProject.id).pickupParts).toEqual(
      otherProjectRows,
    );
  });

  it("工事の科目を追加でき、明細呼出の候補も工事側になる", () => {
    const project = createProject(db, "テスト工事");
    const drafts = subjectDrafts(db, project.id);
    const result = saveProjectSubjects(db, project.id, [
      ...drafts,
      {
        id: null,
        name: "工事専用科目",
        skipPart2: 0,
        aggregateOrder: 1,
        detailFirst: 0,
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);
    expect(result.blockedDeletes).toEqual([]);
    const added = result.subjects.find((s) => s.name === "工事専用科目");
    expect(added).toBeDefined();
    expect(listSubjects(db).some((s) => s.name === "工事専用科目")).toBe(false);
    const options = listMasterOptions(db, project.id);
    expect(options.subjects.some((s) => s.name === "工事専用科目")).toBe(true);
    expect(
      listMasterOptions(db).subjects.some((s) => s.name === "工事専用科目"),
    ).toBe(false);
  });

  it("既存の科目IDは並べ替えても変わらない", () => {
    const project = createProject(db, "テスト工事");
    const drafts = subjectDrafts(db, project.id);
    const first = drafts[0];
    const reversed = [...drafts].reverse();
    saveProjectSubjects(db, project.id, reversed);
    const saved = listProjectSubjects(db, project.id);
    expect(saved.at(-1)?.id).toBe(first?.id);
    expect(saved.at(-1)?.name).toBe(first?.name);
    expect(saved.find((s) => s.id === first?.id)?.name).toBe(first?.name);
  });

  it("工事側が空の種類は基本マスターを使う", () => {
    const project = createProject(db, "テスト工事");
    saveProjectBasicMaster(db, project.id, "units", []);
    expect(projectMasterKinds(db, project.id)).not.toContain("units");
    expect(listProjectBasicMasters(db, project.id).units).toEqual(
      listBasicMasters(db).units,
    );
  });

  it("工事科目の明細順を保存して一覧へ返す", () => {
    const project = createProject(db, "明細順保存工事");
    const drafts = subjectDrafts(db, project.id);
    drafts[0] = { ...drafts[0], detailFirst: 1 };

    const result = saveProjectSubjects(db, project.id, drafts);

    expect(result.subjects[0].detailFirst).toBe(1);
    expect(listProjectSubjects(db, project.id)[0].detailFirst).toBe(1);
  });

  it("基準マスターからの複製は既存の工事マスターを上書きしない", () => {
    const project = createProject(db, "テスト工事");
    const rows = withExtraRow(
      listBasicMasters(db).pickupParts,
      "pickupParts",
      "追加部位",
    );
    saveProjectBasicMaster(db, project.id, "pickupParts", rows);
    copyBasicMastersToProject(db, project.id);
    expect(
      listProjectBasicMasters(db, project.id).pickupParts.some(
        (row) => row.name === "追加部位",
      ),
    ).toBe(true);
    copyBasicMastersToProject(db, project.id, true);
    expect(
      listProjectBasicMasters(db, project.id).pickupParts.some(
        (row) => row.name === "追加部位",
      ),
    ).toBe(false);
  });

  it("工事コピーで工事マスターも引き継ぐ", () => {
    const project = createProject(db, "元の工事");
    saveProjectBasicMaster(
      db,
      project.id,
      "pickupParts",
      withExtraRow(listBasicMasters(db).pickupParts, "pickupParts", "引継部位"),
    );
    const copied = copyProject(db, project.id, "コピー工事");
    expect(
      listProjectBasicMasters(db, copied.id).pickupParts.some(
        (row) => row.name === "引継部位",
      ),
    ).toBe(true);
  });

  it("基本マスターの科目保存は今までどおり動く", () => {
    const before = listSubjects(db);
    const result = saveSubjects(
      db,
      before.map((subject) => ({
        id: subject.id,
        name: subject.name,
        skipPart2: subject.skipPart2,
        aggregateOrder: subject.aggregateOrder,
        detailFirst: subject.detailFirst,
        note: subject.note,
        spare1: subject.spare1,
        spare2: subject.spare2,
      })),
    );
    expect(result.subjects.map((s) => s.name)).toEqual(
      before.map((s) => s.name),
    );
  });
});

describe("基本マスターの科目IDを付け替えたときの工事側", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("基本マスターの行追加後も工事側の科目番号と名称は変わらない", () => {
    const projectId = createProject(db, "科目ID工事").id;
    copyBasicMastersToProject(db, projectId, true);
    const before = listProjectSubjects(db, projectId);

    const rows: SubjectDraft[] = listSubjects(db).map((subject) => ({
      id: subject.id,
      name: subject.name,
      skipPart2: subject.skipPart2,
      aggregateOrder: subject.aggregateOrder,
      detailFirst: subject.detailFirst,
      note: subject.note,
      spare1: subject.spare1,
      spare2: subject.spare2,
    }));
    saveSubjects(db, [
      {
        id: null,
        name: "先頭追加",
        skipPart2: 0,
        aggregateOrder: 1,
        detailFirst: 0,
        note: "",
        spare1: "",
        spare2: "",
      },
      ...rows,
    ]);

    const after = listProjectSubjects(db, projectId);
    expect(after.map(({ id, name }) => ({ id, name }))).toEqual(
      before.map(({ id, name }) => ({ id, name })),
    );
    expect(
      listSubjects(db).find((subject) => subject.name === before[0].name)?.id,
    ).toBe(before[0].id + 1);
  });
});

describe("工事だけの科目がある状態での付け替え", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("工事だけの科目は基本マスターに科目を足しても番号が変わらない", () => {
    const projectId = createProject(db, "工事専用科目").id;
    copyBasicMastersToProject(db, projectId, true);
    const projectRows: SubjectDraft[] = listProjectSubjects(db, projectId).map(
      (subject) => ({
        id: subject.id,
        name: subject.name,
        skipPart2: subject.skipPart2,
        aggregateOrder: subject.aggregateOrder,
        detailFirst: subject.detailFirst,
        note: subject.note,
        spare1: subject.spare1,
        spare2: subject.spare2,
      }),
    );
    saveProjectSubjects(db, projectId, [
      ...projectRows,
      {
        id: null,
        name: "工事だけの科目",
        skipPart2: 0,
        aggregateOrder: 1,
        detailFirst: 0,
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);
    const onlyBefore = listProjectSubjects(db, projectId).find(
      (subject) => subject.name === "工事だけの科目",
    );
    expect(onlyBefore).toBeDefined();

    const basicRows: SubjectDraft[] = listSubjects(db).map((subject) => ({
      id: subject.id,
      name: subject.name,
      skipPart2: subject.skipPart2,
      aggregateOrder: subject.aggregateOrder,
      detailFirst: subject.detailFirst,
      note: subject.note,
      spare1: subject.spare1,
      spare2: subject.spare2,
    }));
    saveSubjects(db, [
      ...basicRows,
      {
        id: null,
        name: "末尾追加",
        skipPart2: 0,
        aggregateOrder: 1,
        detailFirst: 0,
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);

    const after = listProjectSubjects(db, projectId);
    const only = after.find((subject) => subject.name === "工事だけの科目");
    expect(only).toBeDefined();
    expect(only?.id).toBe(onlyBefore?.id);
    const numbers = after.map((subject) => subject.id);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("工事の科目IDを変えると明細マスターの番号を変え、次回の再採番でも戻さない", () => {
    const projectId = createProject(db, "科目ID変更工事").id;
    const initial = saveProjectSubjects(db, projectId, [
      ...subjectDrafts(db, projectId),
      {
        id: null,
        name: "工事専用46",
        skipPart2: 0,
        aggregateOrder: 1,
        detailFirst: 0,
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);
    const added = initial.subjects.find(
      (subject) => subject.name === "工事専用46",
    );
    expect(added?.id).toBe(20);
    db.update(schema.projectMasters)
      .set({ number: 46, sourceNumber: 19 })
      .where(
        and(
          eq(schema.projectMasters.projectId, projectId),
          eq(schema.projectMasters.kind, "subjects"),
          eq(schema.projectMasters.number, 20),
        ),
      )
      .run();
    db.insert(schema.mDetails)
      .values({
        projectId,
        scope: "project",
        subjectId: 46,
        name: "移動する明細",
      })
      .run();
    db.insert(schema.mDetails)
      .values({
        projectId,
        scope: "project",
        subjectId: 20,
        name: "元からあった明細",
      })
      .run();

    const result = saveProjectSubjects(
      db,
      projectId,
      subjectDrafts(db, projectId).map((row) =>
        row.id === 46 ? { ...row, newId: 20 } : row,
      ),
    );

    expect(result.idErrors).toBeUndefined();
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "移動する明細"))
        .get()?.subjectId,
    ).toBe(20);
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "元からあった明細"))
        .get()?.subjectId,
    ).toBe(20);
    expect(
      db
        .select({ sourceNumber: schema.projectMasters.sourceNumber })
        .from(schema.projectMasters)
        .where(
          and(
            eq(schema.projectMasters.projectId, projectId),
            eq(schema.projectMasters.kind, "subjects"),
            eq(schema.projectMasters.number, 20),
          ),
        )
        .get()?.sourceNumber,
    ).toBeNull();
    expect(renumberSubjects(db)).toBe(false);
    expect(
      listProjectSubjects(db, projectId).find(
        (subject) => subject.name === "工事専用46",
      )?.id,
    ).toBe(20);
  });

  it("工事の科目ID変更ではマスター側だけを付け替え、それ以外の保存済み番号は動かさない", () => {
    const projectId = createProject(db, "科目IDのマスター側参照だけ変更").id;
    db.delete(schema.projectMasters)
      .where(
        and(
          eq(schema.projectMasters.projectId, projectId),
          eq(schema.projectMasters.kind, "subjects"),
        ),
      )
      .run();
    db.insert(schema.projectMasters)
      .values([
        {
          projectId,
          kind: "subjects",
          number: 47,
          sourceNumber: null,
          name: "左官工事",
          displayOrder: 0,
        },
        {
          projectId,
          kind: "subjects",
          number: 65,
          sourceNumber: null,
          name: "その他雑工事の部",
          displayOrder: 1,
        },
      ])
      .run();

    db.insert(schema.mDetails)
      .values([
        {
          projectId,
          scope: "project",
          subjectId: 47,
          name: "明細47",
        },
        {
          projectId,
          scope: "project",
          subjectId: 65,
          name: "明細65",
        },
      ])
      .run();
    db.insert(schema.projectTransferRules)
      .values([
        { projectId, masterKey: "rule:47", subjectId: 47 },
        { projectId, masterKey: "rule:65", subjectId: 65 },
      ])
      .run();
    const assemblyId = Number(
      db.run(
        sql`INSERT INTO m_finish_assemblies (assembly_name, scope, project_id) VALUES ('番号変更セット', 'project', ${projectId})`,
      ).lastInsertRowid,
    );
    db.insert(schema.mFinishAssemblyItems)
      .values([
        { assemblyId, subjectId: 47, name: "セット明細47" },
        { assemblyId, subjectId: 65, name: "セット明細65" },
      ])
      .run();

    const estimateRowId = Number(
      db.run(
        sql`INSERT INTO project_estimate_rows (project_id, calc_type) VALUES (${projectId}, 'general')`,
      ).lastInsertRowid,
    );
    db.run(
      sql`INSERT INTO project_general_sheets (project_id, estimate_row_id, lower_json) VALUES (${projectId}, ${estimateRowId}, '[{"details":[{"subjectId":47}]}]')`,
    );
    db.insert(schema.projectTransferRows)
      .values({ projectId, subjectId: 47, name: "転記入力表47" })
      .run();
    db.insert(schema.projectManualAggregateItems)
      .values({ projectId, subjectId: 47, name: "集計手入力47" })
      .run();

    const runId = Number(
      db.run(
        sql`INSERT INTO project_aggregate_runs (project_id) VALUES (${projectId})`,
      ).lastInsertRowid,
    );
    db.insert(schema.projectAggregateDetails)
      .values({ runId, traceId: "aggregate-detail-47", subjectId: 47 })
      .run();
    db.insert(schema.projectAggregateItems)
      .values({
        runId,
        masterKey: "aggregate:47",
        subjectId: 47,
        roomsJson: '[{"subjectId":47}]',
      })
      .run();

    const confirmedVersionId = Number(
      db.run(
        sql`INSERT INTO project_breakdown_versions (project_id, round, confirmed, new_subjects_json) VALUES (${projectId}, 1, 1, '[47]')`,
      ).lastInsertRowid,
    );
    const openVersionId = Number(
      db.run(
        sql`INSERT INTO project_breakdown_versions (project_id, round, confirmed, new_subjects_json) VALUES (${projectId}, 2, 0, '[47]')`,
      ).lastInsertRowid,
    );
    db.insert(schema.projectBreakdownSettings)
      .values({ projectId, subjectOrderJson: "[47]" })
      .run();
    db.insert(schema.projectBreakdownRows)
      .values([
        {
          versionId: confirmedVersionId,
          rowKind: "subject",
          subjectId: 47,
          subjectName: "左官工事",
          wrapUpperSource: '{"subjectId":47}',
        },
        {
          versionId: openVersionId,
          rowKind: "subject",
          subjectId: 47,
          subjectName: "左官工事",
          wrapUpperSource: '{"subjectId":47}',
        },
      ])
      .run();
    db.insert(schema.detailChangeLogs)
      .values({
        projectId,
        scope: "project",
        subjectId: 47,
        beforeJson: '{"subjectId":47}',
        afterJson: '{"nested":{"subjectId":47}}',
      })
      .run();

    const result = saveProjectSubjects(
      db,
      projectId,
      subjectDrafts(db, projectId).map((row) =>
        row.id === 47
          ? { ...row, newId: 26 }
          : row.id === 65
            ? { ...row, newId: 47 }
            : row,
      ),
    );

    expect(result.idErrors).toBeUndefined();
    expect(
      result.subjects.map((subject) => [subject.id, subject.name]),
    ).toEqual([
      [26, "左官工事"],
      [47, "その他雑工事の部"],
    ]);
    expect(
      db
        .all(
          sql`SELECT name, subject_id AS subjectId FROM m_details WHERE project_id = ${projectId} ORDER BY name`,
        )
        .map((row) => row as { name: string; subjectId: number }),
    ).toEqual([
      { name: "明細47", subjectId: 26 },
      { name: "明細65", subjectId: 47 },
    ]);
    expect(
      db
        .select({
          masterKey: schema.projectTransferRules.masterKey,
          subjectId: schema.projectTransferRules.subjectId,
        })
        .from(schema.projectTransferRules)
        .where(eq(schema.projectTransferRules.projectId, projectId))
        .all(),
    ).toEqual([
      { masterKey: "rule:47", subjectId: 26 },
      { masterKey: "rule:65", subjectId: 47 },
    ]);
    expect(
      db
        .select({
          name: schema.mFinishAssemblyItems.name,
          subjectId: schema.mFinishAssemblyItems.subjectId,
        })
        .from(schema.mFinishAssemblyItems)
        .where(eq(schema.mFinishAssemblyItems.assemblyId, assemblyId))
        .all(),
    ).toEqual([
      { name: "セット明細47", subjectId: 26 },
      { name: "セット明細65", subjectId: 47 },
    ]);

    const calcJson = db
      .select({ lowerJson: schema.projectGeneralSheets.lowerJson })
      .from(schema.projectGeneralSheets)
      .where(eq(schema.projectGeneralSheets.estimateRowId, estimateRowId))
      .get()?.lowerJson;
    expect(JSON.parse(calcJson ?? "[]")[0].details[0].subjectId).toBe(47);
    expect(
      db
        .select({ subjectId: schema.projectTransferRows.subjectId })
        .from(schema.projectTransferRows)
        .where(eq(schema.projectTransferRows.projectId, projectId))
        .get()?.subjectId,
    ).toBe(47);
    expect(
      db
        .select({ subjectId: schema.projectManualAggregateItems.subjectId })
        .from(schema.projectManualAggregateItems)
        .where(eq(schema.projectManualAggregateItems.projectId, projectId))
        .get()?.subjectId,
    ).toBe(47);
    expect(
      db
        .select({ subjectId: schema.projectAggregateDetails.subjectId })
        .from(schema.projectAggregateDetails)
        .where(eq(schema.projectAggregateDetails.runId, runId))
        .get()?.subjectId,
    ).toBe(47);
    const aggregate = db
      .select({
        subjectId: schema.projectAggregateItems.subjectId,
        roomsJson: schema.projectAggregateItems.roomsJson,
      })
      .from(schema.projectAggregateItems)
      .where(eq(schema.projectAggregateItems.masterKey, "aggregate:47"))
      .get();
    expect(aggregate?.subjectId).toBe(47);
    expect(JSON.parse(aggregate?.roomsJson ?? "[]")[0].subjectId).toBe(47);
    expect(
      db
        .select({
          versionId: schema.projectBreakdownRows.versionId,
          subjectId: schema.projectBreakdownRows.subjectId,
          wrapUpperSource: schema.projectBreakdownRows.wrapUpperSource,
        })
        .from(schema.projectBreakdownRows)
        .all(),
    ).toEqual([
      {
        versionId: confirmedVersionId,
        subjectId: 47,
        wrapUpperSource: '{"subjectId":47}',
      },
      {
        versionId: openVersionId,
        subjectId: 47,
        wrapUpperSource: '{"subjectId":47}',
      },
    ]);
    expect(
      db
        .select({
          id: schema.projectBreakdownVersions.id,
          newSubjectsJson: schema.projectBreakdownVersions.newSubjectsJson,
        })
        .from(schema.projectBreakdownVersions)
        .where(eq(schema.projectBreakdownVersions.projectId, projectId))
        .orderBy(schema.projectBreakdownVersions.round)
        .all(),
    ).toEqual([
      { id: confirmedVersionId, newSubjectsJson: "[47]" },
      { id: openVersionId, newSubjectsJson: "[47]" },
    ]);
    expect(
      db
        .select({
          subjectOrderJson: schema.projectBreakdownSettings.subjectOrderJson,
        })
        .from(schema.projectBreakdownSettings)
        .where(eq(schema.projectBreakdownSettings.projectId, projectId))
        .get()?.subjectOrderJson,
    ).toBe("[47]");
    const log = db
      .select({
        subjectId: schema.detailChangeLogs.subjectId,
        beforeJson: schema.detailChangeLogs.beforeJson,
        afterJson: schema.detailChangeLogs.afterJson,
      })
      .from(schema.detailChangeLogs)
      .where(eq(schema.detailChangeLogs.projectId, projectId))
      .get();
    expect(log).toEqual({
      subjectId: 47,
      beforeJson: '{"subjectId":47}',
      afterJson: '{"nested":{"subjectId":47}}',
    });
  });

  it("工事の科目IDの入れ替えは参照も同時に入れ替える", () => {
    const projectId = createProject(db, "科目ID入替工事").id;
    db.insert(schema.mDetails)
      .values({
        projectId,
        scope: "project",
        subjectId: 5,
        name: "科目5の明細",
      })
      .run();
    db.insert(schema.mDetails)
      .values({
        projectId,
        scope: "project",
        subjectId: 6,
        name: "科目6の明細",
      })
      .run();

    const result = saveProjectSubjects(
      db,
      projectId,
      subjectDrafts(db, projectId).map((row) =>
        row.id === 5
          ? { ...row, newId: 6 }
          : row.id === 6
            ? { ...row, newId: 5 }
            : row,
      ),
    );

    expect(result.idErrors).toBeUndefined();
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "科目5の明細"))
        .get()?.subjectId,
    ).toBe(6);
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "科目6の明細"))
        .get()?.subjectId,
    ).toBe(5);
  });

  it("科目IDの重複・不正時は保存せず現在の行を返す", () => {
    const projectId = createProject(db, "科目ID重複工事").id;
    const before = subjectDrafts(db, projectId);
    const first = before[0];
    const second = before[1];
    const masterRows = db
      .select()
      .from(schema.projectMasters)
      .where(
        and(
          eq(schema.projectMasters.projectId, projectId),
          eq(schema.projectMasters.kind, "subjects"),
        ),
      )
      .all();
    const duplicated = saveProjectSubjects(
      db,
      projectId,
      before.map((row, index) =>
        index === 0 ? { ...row, newId: second.id as number } : row,
      ),
    );

    expect(duplicated.idErrors).toContain(
      `科目ID ${second.id} が2つあります（${first.name}・${second.name}）`,
    );
    expect(duplicated.subjects).toEqual(listProjectSubjects(db, projectId));
    expect(
      db
        .select()
        .from(schema.projectMasters)
        .where(
          and(
            eq(schema.projectMasters.projectId, projectId),
            eq(schema.projectMasters.kind, "subjects"),
          ),
        )
        .all(),
    ).toEqual(masterRows);

    const invalid = saveProjectSubjects(
      db,
      projectId,
      before.map((row, index) => (index === 0 ? { ...row, newId: 0 } : row)),
    );
    expect(invalid.idErrors?.[0]).toContain("正の整数");
    expect(
      db
        .select()
        .from(schema.projectMasters)
        .where(
          and(
            eq(schema.projectMasters.projectId, projectId),
            eq(schema.projectMasters.kind, "subjects"),
          ),
        )
        .all(),
    ).toEqual(masterRows);
  });

  it("参照の更新に失敗したら科目と参照の保存をまとめて取り消す", () => {
    const projectId = createProject(db, "科目ID保存失敗工事").id;
    const initial = saveProjectSubjects(db, projectId, [
      ...subjectDrafts(db, projectId),
      {
        id: null,
        name: "工事専用20",
        skipPart2: 0,
        aggregateOrder: 1,
        detailFirst: 0,
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);
    expect(
      initial.subjects.find((subject) => subject.name === "工事専用20")?.id,
    ).toBe(20);
    db.insert(schema.mDetails)
      .values({
        projectId,
        scope: "project",
        subjectId: 20,
        name: "更新失敗を起こす明細",
      })
      .run();
    db.run(
      sql.raw(
        "CREATE TRIGGER fail_subject_remap BEFORE UPDATE ON m_details WHEN OLD.name = '更新失敗を起こす明細' BEGIN SELECT RAISE(ABORT, 'forced subject remap failure'); END",
      ),
    );
    const before = subjectDrafts(db, projectId);

    let thrown: unknown;
    try {
      saveProjectSubjects(
        db,
        projectId,
        before.map((row) => (row.id === 20 ? { ...row, newId: 21 } : row)),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error & { cause?: Error }).cause?.message).toBe(
      "forced subject remap failure",
    );
    expect(listProjectSubjects(db, projectId)).toEqual(
      initial.subjects.map((subject) => ({ ...subject })),
    );
    expect(
      db
        .select({ subjectId: schema.mDetails.subjectId })
        .from(schema.mDetails)
        .where(eq(schema.mDetails.name, "更新失敗を起こす明細"))
        .get()?.subjectId,
    ).toBe(20);
  });

  it("新規科目の自動番号は指定された科目IDを避ける", () => {
    const projectId = createProject(db, "科目ID自動採番工事").id;
    db.delete(schema.projectMasters)
      .where(
        and(
          eq(schema.projectMasters.projectId, projectId),
          eq(schema.projectMasters.kind, "subjects"),
        ),
      )
      .run();
    db.insert(schema.projectMasters)
      .values({
        projectId,
        kind: "subjects",
        number: 2,
        sourceNumber: null,
        name: "指定1",
      })
      .run();
    db.insert(schema.projectMasters)
      .values({
        projectId,
        kind: "subjects",
        number: 3,
        sourceNumber: null,
        name: "指定2",
        displayOrder: 1,
      })
      .run();
    const [first, second] = subjectDrafts(db, projectId);

    const result = saveProjectSubjects(db, projectId, [
      { ...first, newId: 1 },
      { ...second, newId: 2 },
      {
        id: null,
        name: "追加科目",
        skipPart2: 0,
        aggregateOrder: 1,
        detailFirst: 0,
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);

    expect(result.idErrors).toBeUndefined();
    expect(result.subjects.map((subject) => subject.id)).toEqual([1, 2, 3]);
  });
});
