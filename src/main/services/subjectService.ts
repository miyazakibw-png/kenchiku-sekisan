import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  mDetails,
  mFinishAssemblyItems,
  mSubjects,
  projectMasters,
  projects,
} from "../db/schema";
import type {
  SaveSubjectsResult,
  Subject,
  SubjectDraft,
} from "../../shared/types";

/** 科目IDは行位置で自動採番する（明細は内部IDで紐づくため、番号が変わっても所属は変わらない） */
export function subjectCode(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** 付け替え中に番号がぶつからないよう、いったん退避させる大きさ */
const RENUMBER_OFFSET = 100000;

const PROJECT_JSON_COLUMNS = [
  {
    table: "project_room_sheets",
    columns: [
      "shape_json",
      "fittings_json",
      "ceiling_json",
      "ceiling_codes_json",
      "lower_json",
      "trace_json",
    ],
  },
  {
    table: "project_frame_sheets",
    columns: [
      "layout_json",
      "lines_json",
      "attributes_json",
      "fittings_json",
      "lower_json",
      "trace_json",
      "kinds_json",
    ],
  },
  { table: "project_general_sheets", columns: ["lower_json"] },
  {
    table: "project_pit_sheets",
    columns: [
      "pits_json",
      "beams_json",
      "walls_json",
      "sleeves_json",
      "sleeve_kinds_json",
      "lower_json",
      "trace_json",
    ],
  },
  { table: "project_misc_sheets", columns: ["columns_json", "rows_json"] },
  {
    table: "project_furniture_sheets",
    columns: ["rows_json", "columns_json", "settings_json"],
  },
  {
    table: "project_fireproof_sheets",
    columns: [
      "columns_json",
      "beams_json",
      "common_json",
      "estimate_json",
      "drawing_json",
    ],
  },
  { table: "project_formwork_runs", columns: ["rows_json"] },
  { table: "calc_sheet_entries", columns: ["data_json"] },
] as const;

interface ProjectSubjectRow {
  id: number;
  projectId: number;
  number: number;
  sourceNumber: number | null;
}

function identifier(name: string): SQL {
  return sql.raw(`"${name.replaceAll('"', '""')}"`);
}

function remapReferenceRows(
  tx: AppDatabase,
  query: SQL,
  table: string,
  column: string,
  mapping: Map<number, number>,
): void {
  const rows = tx.all(query) as unknown as {
    rowid: number;
    subjectId: number | null;
  }[];
  rows.forEach((row) => {
    if (row.subjectId === null) return;
    const next = mapping.get(row.subjectId);
    if (next === undefined || next === row.subjectId) return;
    tx.run(
      sql`UPDATE ${identifier(table)} SET ${identifier(column)} = ${next} WHERE rowid = ${row.rowid}`,
    );
  });
}

function remapJsonValue(
  value: unknown,
  mapping: Map<number, number>,
): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const remapped = remapJsonValue(item, mapping);
      changed ||= remapped.changed;
      return remapped.value;
    });
    return changed ? { value: next, changed } : { value, changed };
  }
  if (value === null || typeof value !== "object")
    return { value, changed: false };

  let changed = false;
  const next: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, item]) => {
    if (key === "subjectId" && typeof item === "number") {
      const mapped = mapping.get(item);
      if (mapped !== undefined && mapped !== item) {
        next[key] = mapped;
        changed = true;
        return;
      }
    }
    const remapped = remapJsonValue(item, mapping);
    next[key] = remapped.value;
    changed ||= remapped.changed;
  });
  return changed ? { value: next, changed } : { value, changed };
}

function remapJsonColumn(
  tx: AppDatabase,
  mapping: Map<number, number>,
  query: SQL,
  table: string,
  column: string,
): void {
  const rows = tx.all(query) as unknown as {
    rowid: number;
    value: string | null;
  }[];
  rows.forEach((row) => {
    if (typeof row.value !== "string") return;
    try {
      const remapped = remapJsonValue(
        JSON.parse(row.value) as unknown,
        mapping,
      );
      if (!remapped.changed) return;
      tx.run(
        sql`UPDATE ${identifier(table)} SET ${identifier(column)} = ${JSON.stringify(remapped.value)} WHERE rowid = ${row.rowid}`,
      );
    } catch {
      return;
    }
  });
}

function remapNumberArrayColumn(
  tx: AppDatabase,
  mapping: Map<number, number>,
  query: SQL,
  table: string,
  column: string,
): void {
  const rows = tx.all(query) as unknown as {
    rowid: number;
    value: string | null;
  }[];
  rows.forEach((row) => {
    if (typeof row.value !== "string") return;
    try {
      const value: unknown = JSON.parse(row.value);
      if (!Array.isArray(value)) return;
      let changed = false;
      const next = value.map((item) => {
        if (typeof item !== "number") return item;
        const mapped = mapping.get(item);
        if (mapped === undefined || mapped === item) return item;
        changed = true;
        return mapped;
      });
      if (!changed) return;
      tx.run(
        sql`UPDATE ${identifier(table)} SET ${identifier(column)} = ${JSON.stringify(next)} WHERE rowid = ${row.rowid}`,
      );
    } catch {
      return;
    }
  });
}

function remapProjectReferences(
  tx: AppDatabase,
  projectId: number,
  mapping: Map<number, number>,
): void {
  if (mapping.size === 0) return;
  const references = [
    {
      table: "m_details",
      column: "subject_id",
      query: sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM m_details WHERE project_id = ${projectId}`,
    },
    {
      table: "detail_change_logs",
      column: "subject_id",
      query: sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM detail_change_logs WHERE project_id = ${projectId}`,
    },
    {
      table: "project_transfer_rows",
      column: "subject_id",
      query: sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM project_transfer_rows WHERE project_id = ${projectId}`,
    },
    {
      table: "project_transfer_rules",
      column: "subject_id",
      query: sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM project_transfer_rules WHERE project_id = ${projectId}`,
    },
    {
      table: "project_manual_aggregate_items",
      column: "subject_id",
      query: sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM project_manual_aggregate_items WHERE project_id = ${projectId}`,
    },
    {
      table: "project_aggregate_details",
      column: "subject_id",
      query: sql`SELECT d.id AS "rowid", d.subject_id AS "subjectId" FROM project_aggregate_details d JOIN project_aggregate_runs r ON r.id = d.run_id WHERE r.project_id = ${projectId}`,
    },
    {
      table: "project_aggregate_items",
      column: "subject_id",
      query: sql`SELECT i.id AS "rowid", i.subject_id AS "subjectId" FROM project_aggregate_items i JOIN project_aggregate_runs r ON r.id = i.run_id WHERE r.project_id = ${projectId}`,
    },
    {
      table: "project_breakdown_rows",
      column: "subject_id",
      query: sql`SELECT b.id AS "rowid", b.subject_id AS "subjectId" FROM project_breakdown_rows b JOIN project_breakdown_versions v ON v.id = b.version_id WHERE v.project_id = ${projectId}`,
    },
    {
      table: "m_finish_assembly_items",
      column: "subject_id",
      query: sql`SELECT i.id AS "rowid", i.subject_id AS "subjectId" FROM m_finish_assembly_items i JOIN m_finish_assemblies a ON a.id = i.assembly_id WHERE a.scope = 'project' AND a.project_id = ${projectId}`,
    },
  ];
  references.forEach((reference) =>
    remapReferenceRows(
      tx,
      reference.query,
      reference.table,
      reference.column,
      mapping,
    ),
  );

  remapNumberArrayColumn(
    tx,
    mapping,
    sql`SELECT id AS "rowid", new_subjects_json AS value FROM project_breakdown_versions WHERE project_id = ${projectId}`,
    "project_breakdown_versions",
    "new_subjects_json",
  );
  remapNumberArrayColumn(
    tx,
    mapping,
    sql`SELECT project_id AS "rowid", subject_order_json AS value FROM project_breakdown_settings WHERE project_id = ${projectId}`,
    "project_breakdown_settings",
    "subject_order_json",
  );
  for (const column of ["before_json", "after_json"]) {
    remapJsonColumn(
      tx,
      mapping,
      sql`SELECT id AS "rowid", ${identifier(column)} AS value FROM detail_change_logs WHERE project_id = ${projectId}`,
      "detail_change_logs",
      column,
    );
  }

  PROJECT_JSON_COLUMNS.forEach(({ table, columns }) => {
    columns.forEach((column) =>
      remapJsonColumn(
        tx,
        mapping,
        sql`SELECT id AS "rowid", ${identifier(column)} AS value FROM ${identifier(table)} WHERE project_id = ${projectId}`,
        table,
        column,
      ),
    );
  });
  remapJsonColumn(
    tx,
    mapping,
    sql`SELECT i.id AS "rowid", i.rooms_json AS value FROM project_aggregate_items i JOIN project_aggregate_runs r ON r.id = i.run_id WHERE r.project_id = ${projectId}`,
    "project_aggregate_items",
    "rooms_json",
  );
  remapJsonColumn(
    tx,
    mapping,
    sql`SELECT b.id AS "rowid", b.wrap_upper_source AS value FROM project_breakdown_rows b JOIN project_breakdown_versions v ON v.id = b.version_id WHERE v.project_id = ${projectId}`,
    "project_breakdown_rows",
    "wrap_upper_source",
  );
}

function remapBasicReferences(
  tx: AppDatabase,
  mapping: Map<number, number>,
): void {
  if (mapping.size === 0) return;
  remapReferenceRows(
    tx,
    sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM m_details WHERE project_id IS NULL`,
    "m_details",
    "subject_id",
    mapping,
  );
  remapReferenceRows(
    tx,
    sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM detail_change_logs WHERE project_id IS NULL AND scope = 'basic'`,
    "detail_change_logs",
    "subject_id",
    mapping,
  );
  remapReferenceRows(
    tx,
    sql`SELECT i.id AS "rowid", i.subject_id AS "subjectId" FROM m_finish_assembly_items i JOIN m_finish_assemblies a ON a.id = i.assembly_id WHERE a.scope = 'basic' AND a.project_id IS NULL`,
    "m_finish_assembly_items",
    "subject_id",
    mapping,
  );
  for (const column of ["before_json", "after_json"]) {
    remapJsonColumn(
      tx,
      mapping,
      sql`SELECT id AS "rowid", ${identifier(column)} AS value FROM detail_change_logs WHERE project_id IS NULL AND scope = 'basic'`,
      "detail_change_logs",
      column,
    );
  }
}

function planProjectMappings(
  db: AppDatabase,
  mapping: Map<number, number>,
  basicCount: number,
): { rows: ProjectSubjectRow[]; mappings: Map<number, Map<number, number>> } {
  const rows = db
    .select({
      id: projectMasters.id,
      projectId: projectMasters.projectId,
      number: projectMasters.number,
      sourceNumber: projectMasters.sourceNumber,
    })
    .from(projectMasters)
    .where(eq(projectMasters.kind, "subjects"))
    .orderBy(asc(projectMasters.projectId), asc(projectMasters.number))
    .all();
  const mappings = new Map<number, Map<number, number>>();
  const projectIds = [...new Set(rows.map((row) => row.projectId))];
  projectIds.forEach((projectId) => {
    const owned = rows.filter((row) => row.projectId === projectId);
    const derivedTargets = new Set(
      owned.flatMap((row) =>
        row.sourceNumber !== null && mapping.has(row.sourceNumber)
          ? [mapping.get(row.sourceNumber) as number]
          : [],
      ),
    );
    const taken = new Set(owned.map((row) => row.number));
    derivedTargets.forEach((number) => taken.add(number));
    const projectOnlyMoves = new Map<number, number>();
    let next = basicCount + 1;
    owned.forEach((row) => {
      if (row.sourceNumber !== null || !derivedTargets.has(row.number)) return;
      while (taken.has(next)) next += 1;
      projectOnlyMoves.set(row.number, next);
      taken.add(next);
      next += 1;
    });

    const projectMapping = new Map<number, number>();
    owned.forEach((row) => {
      const nextNumber =
        row.sourceNumber !== null && mapping.has(row.sourceNumber)
          ? (mapping.get(row.sourceNumber) as number)
          : (projectOnlyMoves.get(row.number) ?? row.number);
      if (nextNumber !== row.number) projectMapping.set(row.number, nextNumber);
    });
    mappings.set(projectId, projectMapping);
  });
  return { rows, mappings };
}

/**
 * 工事内の明細・計算書・集計書・内訳書が持つ科目番号を同時に付け替える。
 * project_masters は呼び出し側で更新する。
 */
export function remapProjectSubjectNumbers(
  tx: AppDatabase,
  projectId: number,
  mapping: Map<number, number>,
): void {
  remapProjectReferences(tx, projectId, mapping);
}

/** 工事内の明細マスター・転記の決まり・仕上明細セットが持つ科目番号だけを付け替える。 */
export function remapProjectSubjectMasterNumbers(
  tx: AppDatabase,
  projectId: number,
  mapping: Map<number, number>,
): void {
  if (mapping.size === 0) return;
  remapReferenceRows(
    tx,
    sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM m_details WHERE project_id = ${projectId}`,
    "m_details",
    "subject_id",
    mapping,
  );
  remapReferenceRows(
    tx,
    sql`SELECT id AS "rowid", subject_id AS "subjectId" FROM project_transfer_rules WHERE project_id = ${projectId}`,
    "project_transfer_rules",
    "subject_id",
    mapping,
  );
  remapReferenceRows(
    tx,
    sql`SELECT i.id AS "rowid", i.subject_id AS "subjectId" FROM m_finish_assembly_items i JOIN m_finish_assemblies a ON a.id = i.assembly_id WHERE a.scope = 'project' AND a.project_id = ${projectId}`,
    "m_finish_assembly_items",
    "subject_id",
    mapping,
  );
}

/**
 * 基本科目を行位置へ揃え、工事では実際に番号が重なる行だけを移す。
 */
export function renumberSubjects(db: AppDatabase): boolean {
  const rows = db
    .select({ id: mSubjects.id })
    .from(mSubjects)
    .orderBy(asc(mSubjects.displayOrder), asc(mSubjects.id))
    .all();
  const mapping = new Map(rows.map((row, index) => [row.id, index + 1]));
  const { rows: projectRows, mappings: projectMappings } = planProjectMappings(
    db,
    mapping,
    rows.length,
  );
  const basicMoves = [...mapping].some(([from, to]) => from !== to);
  const projectMoves = [...projectMappings.values()].some(
    (projectMapping) => projectMapping.size > 0,
  );
  if (!basicMoves && !projectMoves) return false;

  db.transaction((tx) => {
    tx.run(sql`PRAGMA defer_foreign_keys = ON`);
    const transactionDb = tx as AppDatabase;
    if (basicMoves) {
      tx.run(sql`UPDATE m_subjects SET code = 'tmp-' || id`);
      tx.run(sql`UPDATE m_subjects SET id = id + ${RENUMBER_OFFSET}`);
    }

    if (projectRows.length > 0) {
      tx.run(
        sql`UPDATE project_masters SET number = number + ${RENUMBER_OFFSET} WHERE kind = 'subjects'`,
      );
    }

    if (basicMoves) {
      rows.forEach((row, index) => {
        tx.run(
          sql`UPDATE m_subjects SET id = ${index + 1}, code = ${subjectCode(index)} WHERE id = ${row.id + RENUMBER_OFFSET}`,
        );
      });
      remapBasicReferences(transactionDb, mapping);
    }

    const projectIds = tx.select({ id: projects.id }).from(projects).all();
    projectRows.forEach((row) => {
      const projectMapping = projectMappings.get(row.projectId);
      const number = projectMapping?.get(row.number) ?? row.number;
      const sourceNumber =
        row.sourceNumber === null
          ? null
          : (mapping.get(row.sourceNumber) ?? row.sourceNumber);
      tx.run(
        sql`UPDATE project_masters SET number = ${number}, source_number = ${sourceNumber} WHERE id = ${row.id}`,
      );
    });
    projectIds.forEach(({ id: projectId }) => {
      const hasProjectRows = projectMappings.has(projectId);
      const projectMapping = hasProjectRows
        ? (projectMappings.get(projectId) ?? new Map())
        : mapping;
      if (projectMapping.size === 0) return;
      remapProjectSubjectNumbers(transactionDb, projectId, projectMapping);
    });
  });
  return true;
}

export function listSubjects(db: AppDatabase): Subject[] {
  return db
    .select()
    .from(mSubjects)
    .orderBy(asc(mSubjects.displayOrder), asc(mSubjects.id))
    .all();
}

function usedSubjectIds(db: AppDatabase, ids: number[]): Set<number> {
  if (ids.length === 0) return new Set();
  const used = new Set<number>();
  db.select({ id: mDetails.subjectId })
    .from(mDetails)
    .where(inArray(mDetails.subjectId, ids))
    .all()
    .forEach((row) => used.add(row.id));
  db.select({ id: mFinishAssemblyItems.subjectId })
    .from(mFinishAssemblyItems)
    .where(inArray(mFinishAssemblyItems.subjectId, ids))
    .all()
    .forEach((row) => used.add(row.id));
  return used;
}

/**
 * 工種科目マスターの一括保存。
 * 画面の行順どおりに科目IDを振り直し、行挿入・並び替え・改名を行っても
 * 既存の明細は科目の内部IDに付いたまま移動する。
 * 明細やセット明細が登録済みの科目は削除しない。
 */
export function saveSubjects(
  db: AppDatabase,
  rows: SubjectDraft[],
): SaveSubjectsResult {
  const blocked: { id: number; name: string }[] = [];
  db.transaction((tx) => {
    const existing = tx.select().from(mSubjects).all();
    const keptIds = new Set(
      rows.map((row) => row.id).filter((id): id is number => id !== null),
    );
    const removed = existing.filter((subject) => !keptIds.has(subject.id));
    const used = usedSubjectIds(
      tx as AppDatabase,
      removed.map((subject) => subject.id),
    );

    removed.forEach((subject) => {
      if (used.has(subject.id)) {
        blocked.push({ id: subject.id, name: subject.name || subject.code });
        return;
      }
      tx.delete(mSubjects).where(eq(mSubjects.id, subject.id)).run();
    });

    // code は UNIQUE のため、採番し直す前に一度衝突しない値へ退避する
    tx.run(sql`UPDATE m_subjects SET code = 'tmp-' || id`);

    rows.forEach((row, index) => {
      const values = {
        code: subjectCode(index),
        name: row.name,
        displayOrder: index,
        skipPart2: row.skipPart2,
        aggregateOrder: row.aggregateOrder,
        note: row.note,
        spare1: row.spare1,
        spare2: row.spare2,
      };
      if (row.id === null) {
        tx.insert(mSubjects).values(values).run();
        return;
      }
      tx.update(mSubjects).set(values).where(eq(mSubjects.id, row.id)).run();
    });

    // 明細が残っていて削除できなかった科目は末尾へ回す
    blocked.forEach((subject, offset) => {
      tx.update(mSubjects)
        .set({
          code: subjectCode(rows.length + offset),
          displayOrder: rows.length + offset,
        })
        .where(eq(mSubjects.id, subject.id))
        .run();
    });
  });
  renumberSubjects(db);
  return {
    subjects: listSubjects(db),
    blockedDeletes: blocked.map((subject) => subject.name),
  };
}
