import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  mDetails,
  mFinishAssemblyItems,
  mSubjects,
  projectMasters,
} from "../db/schema";
import type {
  BasicMasterKind,
  BasicMasterRow,
} from "../../core/masters/basicMaster";
import {
  dropBlankBasicMasterRows,
  validateBasicMaster,
} from "../../core/masters/basicMaster";
import type {
  BasicMasters,
  SaveBasicMasterResult,
  SaveSubjectsResult,
  Subject,
  SubjectDraft,
} from "../../shared/types";
import { listBasicMasters } from "./basicMasterService";
import { listSubjects, subjectCode } from "./subjectService";

/** 工事ごとに持てるマスターの種類 */
export const PROJECT_MASTER_KINDS = [
  "subjects",
  "pickupParts",
  "materialCategories",
  "units",
  "aggregationParts",
  "formworkCategories",
] as const;

export type ProjectMasterKind = (typeof PROJECT_MASTER_KINDS)[number];

interface ProjectMasterRow {
  number: number;
  /** 複製元の基本マスター番号（この工事だけで作った行は null） */
  sourceNumber: number | null;
  name: string;
  note: string;
  skipPart2: number;
  aggregateOrder: number;
  displayOrder: number;
}

function rowsOf(
  db: AppDatabase,
  projectId: number,
  kind: ProjectMasterKind,
): ProjectMasterRow[] {
  return db
    .select({
      number: projectMasters.number,
      sourceNumber: projectMasters.sourceNumber,
      name: projectMasters.name,
      note: projectMasters.note,
      skipPart2: projectMasters.skipPart2,
      aggregateOrder: projectMasters.aggregateOrder,
      displayOrder: projectMasters.displayOrder,
    })
    .from(projectMasters)
    .where(
      and(
        eq(projectMasters.projectId, projectId),
        eq(projectMasters.kind, kind),
      ),
    )
    .orderBy(asc(projectMasters.displayOrder), asc(projectMasters.number))
    .all();
}

/** その工事が自前で持っている種類（1件も無い種類は基本マスターを使う） */
export function projectMasterKinds(
  db: AppDatabase,
  projectId: number,
): ProjectMasterKind[] {
  const found = new Set(
    db
      .select({ kind: projectMasters.kind })
      .from(projectMasters)
      .where(eq(projectMasters.projectId, projectId))
      .all()
      .map((row) => row.kind),
  );
  return PROJECT_MASTER_KINDS.filter((kind) => found.has(kind));
}

/** 工事の科目マスター。工事側が空なら基本マスターをそのまま返す */
export function listProjectSubjects(
  db: AppDatabase,
  projectId: number | null,
): Subject[] {
  if (projectId === null) return listSubjects(db);
  const rows = rowsOf(db, projectId, "subjects");
  if (rows.length === 0) return listSubjects(db);
  return rows.map((row, index) => ({
    id: row.number,
    code: subjectCode(row.number - 1),
    name: row.name,
    displayOrder: index,
    skipPart2: row.skipPart2,
    aggregateOrder: row.aggregateOrder,
    note: row.note,
    spare1: "",
    spare2: "",
  }));
}

/** 工事のその他マスター。種類ごとに、工事側が空なら基本マスターを使う */
export function listProjectBasicMasters(
  db: AppDatabase,
  projectId: number | null,
): BasicMasters {
  const basic = listBasicMasters(db);
  if (projectId === null) return basic;
  const pick = (kind: BasicMasterKind): BasicMasterRow[] => {
    const rows = rowsOf(db, projectId, kind);
    if (rows.length === 0) return basic[kind];
    return rows.map((row) => ({
      id: row.number,
      name: row.name,
      note: row.note,
    }));
  };
  return {
    pickupParts: pick("pickupParts"),
    materialCategories: pick("materialCategories"),
    units: pick("units"),
    aggregationParts: pick("aggregationParts"),
    formworkCategories: pick("formworkCategories"),
  };
}

function replaceRows(
  db: AppDatabase,
  projectId: number,
  kind: ProjectMasterKind,
  rows: ProjectMasterRow[],
): void {
  db.transaction((tx) => {
    tx.delete(projectMasters)
      .where(
        and(
          eq(projectMasters.projectId, projectId),
          eq(projectMasters.kind, kind),
        ),
      )
      .run();
    rows.forEach((row, index) => {
      tx.insert(projectMasters)
        .values({
          projectId,
          kind,
          number: row.number,
          sourceNumber: row.sourceNumber,
          name: row.name,
          note: row.note,
          skipPart2: row.skipPart2,
          aggregateOrder: row.aggregateOrder,
          displayOrder: index,
        })
        .run();
    });
  });
}

/** 工事のその他マスターを保存する（工事側にだけ書き、基本マスターは変えない） */
export function saveProjectBasicMaster(
  db: AppDatabase,
  projectId: number,
  kind: BasicMasterKind,
  rows: BasicMasterRow[],
): SaveBasicMasterResult {
  const errors = validateBasicMaster(kind, rows);
  if (errors.length > 0)
    return { masters: listProjectBasicMasters(db, projectId), errors };
  const trimmed = dropBlankBasicMasterRows(rows).map((row) => ({
    number: row.id,
    sourceNumber: null,
    name: row.name.trim(),
    note: row.note,
    skipPart2: 0,
    aggregateOrder: 1,
    displayOrder: 0,
  }));
  replaceRows(db, projectId, kind, trimmed);
  return { masters: listProjectBasicMasters(db, projectId), errors: [] };
}

/** その工事の明細・セット明細で使われている科目ID */
function usedSubjectNumbers(
  db: AppDatabase,
  projectId: number,
  numbers: number[],
): Set<number> {
  if (numbers.length === 0) return new Set();
  const used = new Set<number>();
  db.select({ id: mDetails.subjectId })
    .from(mDetails)
    .where(
      and(
        eq(mDetails.projectId, projectId),
        inArray(mDetails.subjectId, numbers),
      ),
    )
    .all()
    .forEach((row) => used.add(row.id));
  db.select({ id: mFinishAssemblyItems.subjectId })
    .from(mFinishAssemblyItems)
    .where(inArray(mFinishAssemblyItems.subjectId, numbers))
    .all()
    .forEach((row) => used.add(row.id));
  return used;
}

/**
 * 工事の科目マスターを保存する。科目IDは既存行はそのまま、
 * 新しい行は空いている一番小さい番号を割り当てる（明細は科目IDで紐づくため番号は変えない）。
 */
export function saveProjectSubjects(
  db: AppDatabase,
  projectId: number,
  rows: SubjectDraft[],
): SaveSubjectsResult {
  const current = listProjectSubjects(db, projectId);
  const keptIds = new Set(
    rows.map((row) => row.id).filter((id): id is number => id !== null),
  );
  const removed = current.filter((subject) => !keptIds.has(subject.id));
  const used = usedSubjectNumbers(
    db,
    projectId,
    removed.map((subject) => subject.id),
  );
  const blocked = removed.filter((subject) => used.has(subject.id));

  const usedNumbers = new Set<number>(keptIds);
  blocked.forEach((subject) => usedNumbers.add(subject.id));
  let next = 1;
  const numberFor = (id: number | null): number => {
    if (id !== null) return id;
    while (usedNumbers.has(next)) next += 1;
    usedNumbers.add(next);
    return next;
  };

  const sourceNumbers = new Map(
    rowsOf(db, projectId, "subjects").map((row) => [
      row.number,
      row.sourceNumber,
    ]),
  );
  const saved: ProjectMasterRow[] = rows.map((row) => ({
    number: numberFor(row.id),
    sourceNumber: row.id === null ? null : (sourceNumbers.get(row.id) ?? null),
    name: row.name,
    note: row.note,
    skipPart2: row.skipPart2,
    aggregateOrder: row.aggregateOrder,
    displayOrder: 0,
  }));
  // 明細が残っていて消せない科目は末尾へ回す
  blocked.forEach((subject) => {
    saved.push({
      number: subject.id,
      sourceNumber: sourceNumbers.get(subject.id) ?? null,
      name: subject.name,
      note: subject.note,
      skipPart2: subject.skipPart2,
      aggregateOrder: subject.aggregateOrder,
      displayOrder: 0,
    });
  });
  replaceRows(db, projectId, "subjects", saved);
  return {
    subjects: listProjectSubjects(db, projectId),
    blockedDeletes: blocked.map((subject) => subject.name),
  };
}

/**
 * 基準（基本）マスターを工事へ複製する。
 * すでに工事側にある種類は、上書き指定がなければそのまま残す。
 */
export function copyBasicMastersToProject(
  db: AppDatabase,
  projectId: number,
  overwrite = false,
): ProjectMasterKind[] {
  const owned = new Set(projectMasterKinds(db, projectId));
  const copied: ProjectMasterKind[] = [];
  const basic = listBasicMasters(db);

  PROJECT_MASTER_KINDS.forEach((kind) => {
    if (owned.has(kind) && !overwrite) return;
    if (kind === "subjects") {
      const subjects = db
        .select()
        .from(mSubjects)
        .orderBy(asc(mSubjects.displayOrder), asc(mSubjects.id))
        .all();
      if (subjects.length === 0) return;
      replaceRows(
        db,
        projectId,
        kind,
        subjects.map((subject) => ({
          number: subject.id,
          sourceNumber: subject.id,
          name: subject.name,
          note: subject.note,
          skipPart2: subject.skipPart2,
          aggregateOrder: subject.aggregateOrder,
          displayOrder: 0,
        })),
      );
      copied.push(kind);
      return;
    }
    const rows = basic[kind];
    if (rows.length === 0) return;
    replaceRows(
      db,
      projectId,
      kind,
      rows.map((row) => ({
        number: row.id,
        sourceNumber: row.id,
        name: row.name,
        note: row.note,
        skipPart2: 0,
        aggregateOrder: 1,
        displayOrder: 0,
      })),
    );
    copied.push(kind);
  });
  return copied;
}
