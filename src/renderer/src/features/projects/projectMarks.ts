import type { ProjectSummary } from "@shared/types";

/** 仕分け用チェックの番号（取引先別などの表示切替に使う） */
export const MARK_NUMBERS = [1, 2, 3, 4, 5] as const;

const NAME_KEY = "project-ledger-mark-names-v1";

export function defaultMarkNames(): string[] {
  return MARK_NUMBERS.map((mark) => `チェック${mark}`);
}

/** チェックの呼び名（取引先名など）。この端末に記憶する */
export function loadMarkNames(): string[] {
  const raw = window.localStorage.getItem(NAME_KEY);
  if (raw === null) return defaultMarkNames();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultMarkNames();
    return MARK_NUMBERS.map((mark, index) => {
      const value = parsed[index];
      return typeof value === "string" && value.trim() !== ""
        ? value
        : `チェック${mark}`;
    });
  } catch {
    return defaultMarkNames();
  }
}

export function saveMarkNames(names: readonly string[]): void {
  window.localStorage.setItem(NAME_KEY, JSON.stringify([...names]));
}

/** チェックを付ける・外す */
export function toggleMark(
  marks: readonly number[],
  mark: number,
  on: boolean,
): number[] {
  const next = marks.filter((each) => each !== mark);
  if (on) next.push(mark);
  return next.sort((a, b) => a - b);
}

/**
 * 選んだチェックの物件だけを出す（複数選択のときはどれか1つでも付いていれば出す）。
 * 何も選んでいないときは全部出す（＝全表示）。
 */
export function filterProjectsByMarks(
  projects: readonly ProjectSummary[],
  selected: readonly number[],
): ProjectSummary[] {
  if (selected.length === 0) return [...projects];
  return projects.filter((project) =>
    project.marks.some((mark) => selected.includes(mark)),
  );
}
