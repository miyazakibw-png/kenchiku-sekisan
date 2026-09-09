/**
 * 内訳書の回どうしの比較。
 * 確定した回（右）と新しく作った回（左）を、同じ行位置どうしで見比べる。
 * 行のずれは人が行挿入・上下移動で合わせるので、ここでは位置で突き合わせるだけにする。
 */

/** 比較に必要な項目だけ（DBの行レコードもそのまま渡せるようにする） */
export interface ComparableRow {
  nameUpper: string;
  nameLower: string;
  descriptionUpper: string;
  descriptionLower: string;
  quantity: number | null;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
}

/** 比較で色を付ける項目 */
export type BreakdownField =
  "name" | "description" | "quantity" | "unit" | "remarks";

export interface BreakdownDiff<T extends ComparableRow = ComparableRow> {
  /** 行位置（0始まり） */
  index: number;
  left: T | null;
  right: T | null;
  /** 片方にしか無い行 */
  onlyLeft: boolean;
  onlyRight: boolean;
  /** 中身が違う項目 */
  changed: BreakdownField[];
}

function nameOf(row: ComparableRow): string {
  return `${row.nameUpper}\u0001${row.nameLower}`;
}

function descriptionOf(row: ComparableRow): string {
  return `${row.descriptionUpper}\u0001${row.descriptionLower}`;
}

function remarksOf(row: ComparableRow): string {
  return `${row.remarksUpper}\u0001${row.remarksLower}`;
}

function changedFields(
  left: ComparableRow,
  right: ComparableRow,
): BreakdownField[] {
  const changed: BreakdownField[] = [];
  if (nameOf(left) !== nameOf(right)) changed.push("name");
  if (descriptionOf(left) !== descriptionOf(right)) changed.push("description");
  if (left.quantity !== right.quantity) changed.push("quantity");
  if (left.unit !== right.unit) changed.push("unit");
  if (remarksOf(left) !== remarksOf(right)) changed.push("remarks");
  return changed;
}

/** 左（新しい回）と右（確定した回）を行位置で突き合わせる */
export function compareBreakdown<T extends ComparableRow>(
  left: readonly T[],
  right: readonly T[],
): BreakdownDiff<T>[] {
  const count = Math.max(left.length, right.length);
  const diffs: BreakdownDiff<T>[] = [];
  for (let index = 0; index < count; index += 1) {
    const leftRow = left[index] ?? null;
    const rightRow = right[index] ?? null;
    diffs.push({
      index,
      left: leftRow,
      right: rightRow,
      onlyLeft: leftRow !== null && rightRow === null,
      onlyRight: leftRow === null && rightRow !== null,
      changed:
        leftRow !== null && rightRow !== null
          ? changedFields(leftRow, rightRow)
          : [],
    });
  }
  return diffs;
}

/** 行を1つ上下に動かす（左右それぞれ独立して並べ替える） */
export function moveRow<T>(
  rows: readonly T[],
  index: number,
  step: number,
): T[] {
  const target = index + step;
  if (index < 0 || index >= rows.length) return [...rows];
  if (target < 0 || target >= rows.length) return [...rows];
  const next = [...rows];
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next;
}
