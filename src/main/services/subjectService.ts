import { asc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  mDetails,
  mFinishAssemblyItems,
  mSubjects,
  projectMasters,
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

/** 科目IDを持っている表（工事側のマスターや集計結果も一緒に付け替える） */
const SUBJECT_REFERENCES = [
  "m_details",
  "m_finish_assembly_items",
  "detail_change_logs",
  "project_transfer_rows",
  "project_transfer_rules",
  "project_aggregate_details",
  "project_aggregate_items",
  "project_breakdown_rows",
] as const;

/** 工事だけの科目を付け替えるとき、工事ごとに直せる表（工事IDで絞れるもの） */
const PROJECT_SUBJECT_REFERENCES = [
  "m_details",
  "detail_change_logs",
  "project_transfer_rows",
  "project_transfer_rules",
] as const;

/** 付け替え中に番号がぶつからないよう、いったん退避させる大きさ */
const RENUMBER_OFFSET = 100000;

type ProjectOnlyMove = { projectId: number; from: number; to: number };

/**
 * 基本マスターから複製していない「この工事だけの科目」の番号を決める。
 * 付け替え後の基本マスターの番号とぶつからなければそのまま残す。
 */
function planProjectOnlyMoves(
  db: AppDatabase,
  mapping: Map<number, number>,
  basicCount: number,
): ProjectOnlyMove[] {
  const rows = db
    .select({
      projectId: projectMasters.projectId,
      number: projectMasters.number,
      sourceNumber: projectMasters.sourceNumber,
    })
    .from(projectMasters)
    .where(eq(projectMasters.kind, "subjects"))
    .orderBy(asc(projectMasters.projectId), asc(projectMasters.number))
    .all();

  const moves: ProjectOnlyMove[] = [];
  const projectIds = [...new Set(rows.map((row) => row.projectId))];
  projectIds.forEach((projectId) => {
    const owned = rows.filter((row) => row.projectId === projectId);
    // 基本マスターの番号（1〜件数）と、基本マスター由来の行が使う番号は先に押さえる
    const taken = new Set<number>();
    for (let number = 1; number <= basicCount; number += 1) taken.add(number);
    owned.forEach((row) => {
      if (row.sourceNumber === null) return;
      taken.add(mapping.get(row.sourceNumber) ?? row.sourceNumber);
    });
    let next = basicCount + 1;
    owned.forEach((row) => {
      if (row.sourceNumber !== null) return;
      if (!taken.has(row.number)) {
        taken.add(row.number);
        return;
      }
      while (taken.has(next)) next += 1;
      taken.add(next);
      moves.push({ projectId, from: row.number, to: next });
    });
  });
  return moves;
}

/**
 * 科目IDを行位置（01,02,03…）に合わせ直す。
 * 途中に科目を挿し込むと内部IDと行位置がずれ、工事側の科目マスターや
 * 計算表の科目IDが基本マスターと食い違うため、明細の紐づけごと付け替える。
 */
export function renumberSubjects(db: AppDatabase): boolean {
  const rows = db
    .select({ id: mSubjects.id })
    .from(mSubjects)
    .orderBy(asc(mSubjects.displayOrder), asc(mSubjects.id))
    .all();
  const mapping = new Map(rows.map((row, index) => [row.id, index + 1]));
  const basicMoves = [...mapping].filter(([from, to]) => from !== to);
  const projectOnlyMoves = planProjectOnlyMoves(db, mapping, rows.length);
  if (basicMoves.length === 0 && projectOnlyMoves.length === 0) return false;

  db.transaction((tx) => {
    // コミットまで外部キーの照合を待たせ、親（科目）から先に付け替える
    tx.run(sql`PRAGMA defer_foreign_keys = ON`);
    tx.run(sql`UPDATE m_subjects SET code = 'tmp-' || id`);
    tx.run(sql.raw(`UPDATE m_subjects SET id = id + ${RENUMBER_OFFSET}`));
    SUBJECT_REFERENCES.forEach((table) => {
      tx.run(
        sql.raw(
          `UPDATE ${table} SET subject_id = subject_id + ${RENUMBER_OFFSET} WHERE subject_id IS NOT NULL`,
        ),
      );
    });
    tx.run(
      sql.raw(
        `UPDATE project_masters SET number = number + ${RENUMBER_OFFSET} WHERE kind = 'subjects'`,
      ),
    );
    tx.run(
      sql.raw(
        `UPDATE project_masters SET source_number = source_number + ${RENUMBER_OFFSET} WHERE kind = 'subjects' AND source_number IS NOT NULL`,
      ),
    );

    // 工事だけの科目が指している明細などは、基本マスターの付け替えに巻き込まれないよう更に退避
    projectOnlyMoves.forEach((move) => {
      const from = move.from + RENUMBER_OFFSET;
      PROJECT_SUBJECT_REFERENCES.forEach((table) => {
        tx.run(
          sql.raw(
            `UPDATE ${table} SET subject_id = ${from + RENUMBER_OFFSET} WHERE project_id = ${move.projectId} AND subject_id = ${from}`,
          ),
        );
      });
    });

    rows.forEach((row, index) => {
      const from = row.id + RENUMBER_OFFSET;
      const to = index + 1;
      tx.run(
        sql.raw(
          `UPDATE m_subjects SET id = ${to}, code = '${subjectCode(index)}' WHERE id = ${from}`,
        ),
      );
      SUBJECT_REFERENCES.forEach((table) => {
        tx.run(
          sql.raw(
            `UPDATE ${table} SET subject_id = ${to} WHERE subject_id = ${from}`,
          ),
        );
      });
      tx.run(
        sql.raw(
          `UPDATE project_masters SET number = ${to}, source_number = ${to} WHERE kind = 'subjects' AND source_number = ${from}`,
        ),
      );
    });

    // 工事だけの科目は、基本マスターとぶつからない空き番号へ寄せる
    projectOnlyMoves.forEach((move) => {
      const from = move.from + RENUMBER_OFFSET * 2;
      tx.run(
        sql.raw(
          `UPDATE project_masters SET number = ${move.to} WHERE project_id = ${move.projectId} AND kind = 'subjects' AND number = ${move.from + RENUMBER_OFFSET}`,
        ),
      );
      PROJECT_SUBJECT_REFERENCES.forEach((table) => {
        tx.run(
          sql.raw(
            `UPDATE ${table} SET subject_id = ${move.to} WHERE project_id = ${move.projectId} AND subject_id = ${from}`,
          ),
        );
      });
    });

    // 基本マスターに無い科目を指していた行は元の番号へ戻す
    SUBJECT_REFERENCES.forEach((table) => {
      tx.run(
        sql.raw(
          `UPDATE ${table} SET subject_id = subject_id - ${RENUMBER_OFFSET * 2} WHERE subject_id >= ${RENUMBER_OFFSET * 2}`,
        ),
      );
      tx.run(
        sql.raw(
          `UPDATE ${table} SET subject_id = subject_id - ${RENUMBER_OFFSET} WHERE subject_id >= ${RENUMBER_OFFSET}`,
        ),
      );
    });
    tx.run(
      sql.raw(
        `UPDATE project_masters SET number = number - ${RENUMBER_OFFSET} WHERE kind = 'subjects' AND number >= ${RENUMBER_OFFSET}`,
      ),
    );
    tx.run(
      sql.raw(
        `UPDATE project_masters SET source_number = source_number - ${RENUMBER_OFFSET} WHERE kind = 'subjects' AND source_number >= ${RENUMBER_OFFSET}`,
      ),
    );
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
