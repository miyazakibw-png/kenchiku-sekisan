import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { mDetails, mFinishAssemblyItems, mSubjects } from "../db/schema";
import type {
  SaveSubjectsResult,
  Subject,
  SubjectDraft,
} from "../../shared/types";
import { ensureProjectsOwnMasters } from "./projectMasterCopyService";

/** 科目IDは行位置で自動採番する（明細は内部IDで紐づくため、番号が変わっても所属は変わらない） */
export function subjectCode(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** 付け替え中に番号がぶつからないよう、いったん退避させる大きさ */
const RENUMBER_OFFSET = 100000;

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

/** 基本科目と基本スコープの参照だけを行位置へ揃える。 */
export function renumberSubjects(db: AppDatabase): boolean {
  const rows = db
    .select({ id: mSubjects.id })
    .from(mSubjects)
    .orderBy(asc(mSubjects.displayOrder), asc(mSubjects.id))
    .all();
  const mapping = new Map(rows.map((row, index) => [row.id, index + 1]));
  const basicMoves = [...mapping].some(([from, to]) => from !== to);
  if (!basicMoves) return false;

  db.transaction((tx) => {
    tx.run(sql`PRAGMA defer_foreign_keys = ON`);
    const transactionDb = tx as AppDatabase;
    tx.run(sql`UPDATE m_subjects SET code = 'tmp-' || id`);
    tx.run(sql`UPDATE m_subjects SET id = id + ${RENUMBER_OFFSET}`);
    rows.forEach((row, index) => {
      tx.run(
        sql`UPDATE m_subjects SET id = ${index + 1}, code = ${subjectCode(index)} WHERE id = ${row.id + RENUMBER_OFFSET}`,
      );
    });
    remapBasicReferences(transactionDb, mapping);
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
  ensureProjectsOwnMasters(db);
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
