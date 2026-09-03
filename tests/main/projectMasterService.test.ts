import Database from "better-sqlite3";
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
} from "../../src/main/services/projectMasterService";
import {
  listBasicMasters,
  saveBasicMaster,
} from "../../src/main/services/basicMasterService";
import {
  listSubjects,
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

  it("工事の科目マスターも同じ番号に付け替わる", () => {
    const projectId = createProject(db, "科目ID工事").id;
    copyBasicMastersToProject(db, projectId, true);
    const before = listProjectSubjects(db, projectId);

    const rows: SubjectDraft[] = listSubjects(db).map((subject) => ({
      id: subject.id,
      name: subject.name,
      skipPart2: subject.skipPart2,
      aggregateOrder: subject.aggregateOrder,
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
        note: "",
        spare1: "",
        spare2: "",
      },
      ...rows,
    ]);

    const after = listProjectSubjects(db, projectId);
    const moved = after.find((subject) => subject.name === before[0].name);
    const basic = listSubjects(db).find(
      (subject) => subject.name === before[0].name,
    );
    expect(moved?.id).toBe(basic?.id);
  });
});

describe("工事だけの科目がある状態での付け替え", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("工事だけの科目は基本マスターとぶつからない番号へ寄る", () => {
    const projectId = createProject(db, "工事専用科目").id;
    copyBasicMastersToProject(db, projectId, true);
    const projectRows: SubjectDraft[] = listProjectSubjects(db, projectId).map(
      (subject) => ({
        id: subject.id,
        name: subject.name,
        skipPart2: subject.skipPart2,
        aggregateOrder: subject.aggregateOrder,
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
        note: "",
        spare1: "",
        spare2: "",
      },
    ]);

    const basicIds = new Set(listSubjects(db).map((subject) => subject.id));
    const after = listProjectSubjects(db, projectId);
    const only = after.find((subject) => subject.name === "工事だけの科目");
    expect(only).toBeDefined();
    expect(basicIds.has(only?.id ?? 0)).toBe(false);
    const numbers = after.map((subject) => subject.id);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
