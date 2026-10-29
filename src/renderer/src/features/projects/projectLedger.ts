import type { ProjectSummary } from "@shared/types";

/** 台帳で並べ替えできる列（管理番号は自動採番なので並べ替えのみ・編集不可） */
export type LedgerSortKey =
  | "projectDate"
  | "managementNo"
  | "name"
  | "builderName"
  | "designerName"
  | "note";

const collator = new Intl.Collator("ja");

/** 「上に固定」の工事を並びの先頭に集める（固定同士の順はそのまま保つ） */
export function pinnedOnTop(projects: ProjectSummary[]): ProjectSummary[] {
  return [
    ...projects.filter((project) => project.pinned),
    ...projects.filter((project) => !project.pinned),
  ];
}

/** 作成順と関係なく、行を任意の位置へ移動する（固定の段は崩れない） */
export function moveProject(
  projects: ProjectSummary[],
  from: number,
  to: number,
): ProjectSummary[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= projects.length ||
    to >= projects.length
  ) {
    return projects;
  }
  const next = [...projects];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return pinnedOnTop(next);
}

/** 列を指定して並べ替える（結果はそのまま台帳の並び順として保存する。固定の行は対象外で先頭のまま） */
export function sortProjects(
  projects: ProjectSummary[],
  key: LedgerSortKey,
  descending = false,
): ProjectSummary[] {
  const pinned = projects.filter((project) => project.pinned);
  const sorted = projects
    .filter((project) => !project.pinned)
    .sort((a, b) => collator.compare(a[key], b[key]));
  return [...pinned, ...(descending ? sorted.reverse() : sorted)];
}

/** 日付は桁ずれしないよう YYYY-MM-DD の固定形式に整える */
export function normalizeDate(input: string): string | null {
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.trim());
  if (!matched) return null;
  const [, year, month, day] = matched;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day))
    return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** コピー作成時の初期名称 */
export function copyName(name: string): string {
  return `${name}（コピー）`;
}
