import { asc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { mDetails, mFinishAssemblyItems, mSubjects } from "../db/schema";
import type {
  SaveSubjectsResult,
  Subject,
  SubjectDraft,
} from "../../shared/types";

/** 科目IDは行位置で自動採番する（明細は内部IDで紐づくため、番号が変わっても所属は変わらない） */
export function subjectCode(index: number): string {
  return String(index + 1).padStart(2, "0");
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
  return {
    subjects: listSubjects(db),
    blockedDeletes: blocked.map((subject) => subject.name),
  };
}
