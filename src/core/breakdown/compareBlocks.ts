/**
 * 内訳書の比較で使う「1明細＝1かたまり」の作り方。
 * 書式④（2段2行）では上の行（note）と下の行（detail）で1明細なので、
 * 画面もエクセルも、この2行を1組にして左右を突き合わせる。
 * 工種科目・部位Ⅰの見出しや空行も1組（1明細分の高さ）として扱う。
 */

import { BREAKDOWN_LAYOUT } from "./breakdown";
import type { ComparableRow } from "./compare";

/** かたまりを作るのに必要な項目（画面のレコードもコアの行もそのまま渡せる） */
export interface BlockSourceRow extends ComparableRow {
  rowKind: string;
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
