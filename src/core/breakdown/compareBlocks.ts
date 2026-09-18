/**
 * 内訳書の比較で使う「1明細＝1かたまり」の作り方。
 * 書式④（2段2行）では上の行（note）と下の行（detail）で1明細なので、
 * 画面もエクセルも、この2行を1組にして左右を突き合わせる。
 * 工種科目・部位Ⅰの見出しや空行も1組（1明細分の高さ）として扱う。
 */

import { BREAKDOWN_LAYOUT } from "./breakdown";
import {
  changedFields,
  type BreakdownDiff,
  type ComparableRow,
} from "./compare";

/** かたまりを作るのに必要な項目（画面のレコードもコアの行もそのまま渡せる） */
export interface BlockSourceRow extends ComparableRow {
  rowKind: string;
  subjectId: number | null;
  subjectName: string;
}

/** 比較の1かたまり（1明細分） */
export interface CompareBlock<T extends BlockSourceRow> {
  /** 元の行の位置（0始まり） */
  start: number;
  /** 元の行を何行使うか（2段2行の明細は2、それ以外は1） */
  span: number;
  /** 工種科目・部位Ⅰの見出しか */
  heading: boolean;
  /** 2段2行の明細の上の行（それ以外は無し） */
  upper: T | null;
  /** 明細の下の行（1行だけのかたまりはその行） */
  lower: T;
}

/** 1明細を上下2行1組で出す書式か（書式④と、画面表示が同じ書式③） */
export function twoRowPairs(layout: number): boolean {
  return (
    layout === BREAKDOWN_LAYOUT.twoRow || layout === BREAKDOWN_LAYOUT.excel
  );
}

/** 見出し行（工種科目・部位Ⅰのタイトル）の文字 */
export function headingTextOf(row: BlockSourceRow): string {
  return row.rowKind === "subject" ? row.subjectName : row.nameLower;
}

/** 行の並びを1明細ずつのかたまりに分ける */
export function toCompareBlocks<T extends BlockSourceRow>(
  rows: readonly T[],
  layout: number,
): CompareBlock<T>[] {
  const blocks: CompareBlock<T>[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    const next = rows[index + 1];
    if (
      twoRowPairs(layout) &&
      row.rowKind === "note" &&
      next !== undefined &&
      next.rowKind === "detail"
    ) {
      blocks.push({
        start: index,
        span: 2,
        heading: false,
        upper: row,
        lower: next,
      });
      index += 2;
      continue;
    }
    blocks.push({
      start: index,
      span: 1,
      heading: row.rowKind === "subject" || row.rowKind === "title",
      upper: null,
      lower: row,
    });
    index += 1;
  }
  return blocks;
}

/** かたまりを「上段・下段のある1明細」として見た中身（見比べ・掃き出しに使う） */
export function blockValue<T extends BlockSourceRow>(
  block: CompareBlock<T>,
): ComparableRow {
  const lower = block.lower;
  if (block.upper !== null) {
    const upper = block.upper;
    return {
      nameUpper: upper.nameLower,
      nameLower: lower.nameLower,
      descriptionUpper: upper.descriptionLower,
      descriptionLower: lower.descriptionLower,
      quantity: lower.quantity,
      unit: lower.unit,
      remarksUpper: upper.remarksLower,
      remarksLower: lower.remarksLower,
    };
  }
  if (block.heading) {
    return {
      nameUpper: "",
      nameLower: headingTextOf(lower),
      descriptionUpper: "",
      descriptionLower: "",
      quantity: null,
      unit: "",
      remarksUpper: "",
      remarksLower: "",
    };
  }
  return {
    nameUpper: lower.nameUpper,
    nameLower: lower.nameLower,
    descriptionUpper: lower.descriptionUpper,
    descriptionLower: lower.descriptionLower,
    quantity: lower.quantity,
    unit: lower.unit,
    remarksUpper: lower.remarksUpper,
    remarksLower: lower.remarksLower,
  };
}

/** 左右のかたまりの組（片方だけのとき片側は null） */
export interface BlockPair {
  /** 左のかたまりの位置 */
  left: number | null;
  /** 右のかたまりの位置 */
  right: number | null;
}

/**
 * 左右のかたまりを工種科目どうしで合わせる。
 * 同じ科目のかたまりを並べ、片方に無い科目は空欄で合わせる。
 * 科目の並びはかたまりが多いほうを基準に、片方にだけある科目は
 * その側の並びで直前に来る科目の直後へ入れる。
 * 科目の中は明細の位置どうしで合わせる（増減分の調整だけで済む）。
 */
export function pairBlocksBySubject<T extends BlockSourceRow>(
  left: readonly CompareBlock<T>[],
  right: readonly CompareBlock<T>[],
): BlockPair[] {
  const groupsOf = (
    blocks: readonly CompareBlock<T>[],
  ): { keys: string[]; groups: Map<string, number[]> } => {
    const keys: string[] = [];
    const groups = new Map<string, number[]>();
    // 見出しの前の行（先頭の空行など）は「先頭」として1つのかたまりにする
    let current = "lead";
    blocks.forEach((block, index) => {
      if (block.lower.rowKind === "subject")
        current = `s:${block.lower.subjectId ?? ""}`;
      if (!groups.has(current)) {
        groups.set(current, []);
        keys.push(current);
      }
      groups.get(current)?.push(index);
    });
    return { keys, groups };
  };
  const leftSide = groupsOf(left);
  const rightSide = groupsOf(right);
  // 片方に工種科目の見出しがまったく無いときは合わせる目印が無いので並びどうしで見る
  if (
    leftSide.keys.every((key) => key === "lead") ||
    rightSide.keys.every((key) => key === "lead")
  ) {
    const count = Math.max(left.length, right.length);
    const pairs: BlockPair[] = [];
    for (let index = 0; index < count; index++) {
      pairs.push({
        left: index < left.length ? index : null,
        right: index < right.length ? index : null,
      });
    }
    return pairs;
  }
  const anchor = left.length >= right.length ? leftSide : rightSide;
  const other = left.length >= right.length ? rightSide : leftSide;
  const order = [...anchor.keys];
  other.keys.forEach((key) => {
    if (order.includes(key)) return;
    const at = other.keys.indexOf(key);
    let insertAt = 0;
    for (let index = at - 1; index >= 0; index--) {
      const found = order.indexOf(other.keys[index]);
      if (found >= 0) {
        insertAt = found + 1;
        break;
      }
    }
    order.splice(insertAt, 0, key);
  });
  const pairs: BlockPair[] = [];
  order.forEach((key) => {
    const leftIndexes = leftSide.groups.get(key) ?? [];
    const rightIndexes = rightSide.groups.get(key) ?? [];
    const count = Math.max(leftIndexes.length, rightIndexes.length);
    for (let index = 0; index < count; index++) {
      pairs.push({
        left: leftIndexes[index] ?? null,
        right: rightIndexes[index] ?? null,
      });
    }
  });
  return pairs;
}

/** 工種科目どうしで合わせた比較結果（左右それぞれのかたまりの位置つき） */
export interface SubjectBlockDiff extends BreakdownDiff<ComparableRow> {
  leftIndex: number | null;
  rightIndex: number | null;
}

/** 工種科目どうしで合わせてから、明細どうしを突き合わせる */
export function compareBlocksBySubject<T extends BlockSourceRow>(
  left: readonly CompareBlock<T>[],
  right: readonly CompareBlock<T>[],
): SubjectBlockDiff[] {
  return pairBlocksBySubject(left, right).map((pair, index) => {
    const leftValue = pair.left === null ? null : blockValue(left[pair.left]);
    const rightValue =
      pair.right === null ? null : blockValue(right[pair.right]);
    return {
      index,
      left: leftValue,
      right: rightValue,
      onlyLeft: leftValue !== null && rightValue === null,
      onlyRight: leftValue === null && rightValue !== null,
      changed:
        leftValue !== null && rightValue !== null
          ? changedFields(leftValue, rightValue)
          : [],
      leftIndex: pair.left,
      rightIndex: pair.right,
    };
  });
}
