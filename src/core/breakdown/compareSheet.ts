/**
 * 内訳書の比較（前回と見比べた状態）のエクセル掃き出し。
 * 画面と同じ並びのまま、左に新しい回・右に前の回を並べて出す。
 * 違うところは左（新しい回）だけ、背景を黄色・文字を赤にする。
 */

import type { XlsxBorder, XlsxCell, XlsxSheet } from "../export/xlsx";
import { toXlsx } from "../export/xlsx";
import { BREAKDOWN_LAYOUT, type BreakdownRow } from "./breakdown";
import { compareBreakdown, type BreakdownField } from "./compare";
import {
  blockValue,
  headingTextOf,
  toCompareBlocks,
  twoRowPairs,
  type CompareBlock,
} from "./compareBlocks";

/** 左右それぞれの列（印の列は付けない） */
const HEADER = ["名称", "摘要", "数量", "単位", "単価", "金額", "備考"];
const WIDTHS = [40, 30, 12, 8, 12, 14, 20];
/** 左右の表の間のあき */
const GAP_WIDTH = 4;

function join(upper: string, lower: string): string {
  return [upper, lower].filter((text) => text !== "").join(" ");
}

function newline(upper: string, lower: string): string {
  return [upper, lower].filter((text) => text !== "").join("\n");
}

function textOf(
  layout: number,
  upper: string,
  lower: string,
): { value: string; wrap: boolean } {
  if (layout === BREAKDOWN_LAYOUT.twoLine) {
    const value = newline(upper, lower);
    return { value, wrap: value.includes("\n") };
  }
  if (layout === BREAKDOWN_LAYOUT.oneLine || twoRowPairs(layout)) {
    return { value: lower, wrap: false };
  }
  return { value: join(upper, lower), wrap: false };
}

/**
 * 片側の1明細（かたまり）を作る。
 * 書式④（2段2行）では上下2行、それ以外は1行を返す。
 * 見出し・空きのかたまりも同じ行数にして、左右がずれないようにする。
 * 色を付けるのは changed が渡されたときだけ。
 */
function sideLines(
  block: CompareBlock<BreakdownRow> | null,
  layout: number,
  changed: readonly BreakdownField[] | null,
  onlySide: boolean,
): XlsxCell[][] {
  const mark = (field: BreakdownField): "plain" | "diff" => {
    if (changed === null) return "plain";
    if (onlySide) return "diff";
    return changed.includes(field) ? "diff" : "plain";
  };
  const heading = block !== null && block.heading;
  const line = (
    border: XlsxBorder,
    name: { value: string; wrap: boolean },
    description: { value: string; wrap: boolean },
    quantity: number | null,
    unit: string,
    unitPrice: number | null,
    amount: number | null,
    remarks: { value: string; wrap: boolean },
  ): XlsxCell[] => {
    const text = (
      part: { value: string; wrap: boolean },
      field: BreakdownField,
    ): XlsxCell => ({
      value: part.value,
      kind: heading ? "header" : part.wrap ? "wrap" : "text",
      border,
      mark: heading ? "plain" : mark(field),
    });
    const number = (
      value: number | null,
      field: BreakdownField | null,
    ): XlsxCell => ({
      value,
      kind: value === null ? "text" : "number",
      border,
      mark: field === null ? "plain" : mark(field),
    });
    return [
      text(name, "name"),
      text(description, "description"),
      number(quantity, "quantity"),
      { value: unit, kind: "text", border, mark: mark("unit") },
      number(unitPrice, null),
      number(amount, null),
      text(remarks, "remarks"),
    ];
  };
  const blank = (border: XlsxBorder): XlsxCell[] =>
    line(
      border,
      { value: "", wrap: false },
      { value: "", wrap: false },
      null,
      "",
      null,
      null,
      { value: "", wrap: false },
    );

  if (twoRowPairs(layout)) {
    if (block === null) return [blank("upper"), blank("lower")];
    const upper = block.upper;
    const lower = block.lower;
    const upperLine =
      upper === null
        ? blank("upper")
        : line(
            "upper",
            { value: upper.nameLower, wrap: false },
            { value: upper.descriptionLower, wrap: false },
            null,
            "",
            null,
            null,
            { value: upper.remarksLower, wrap: false },
          );
    const lowerLine = line(
      "lower",
      {
        value: block.heading ? headingTextOf(lower) : lower.nameLower,
        wrap: false,
      },
      {
        value: block.heading ? "" : lower.descriptionLower,
        wrap: false,
      },
      block.heading ? null : lower.quantity,
      block.heading ? "" : lower.unit,
      block.heading ? null : lower.unitPrice,
      block.heading ? null : lower.amount,
      { value: block.heading ? "" : lower.remarksLower, wrap: false },
    );
    return [upperLine, lowerLine];
  }

  if (block === null) return [blank("one")];
  const row = block.lower;
  if (block.heading) {
    return [
      line(
        "one",
        { value: headingTextOf(row), wrap: false },
        { value: "", wrap: false },
        null,
        "",
        null,
        null,
        { value: "", wrap: false },
      ),
    ];
  }
  return [
    line(
      "one",
      textOf(layout, row.nameUpper, row.nameLower),
      textOf(layout, row.descriptionUpper, row.descriptionLower),
      row.quantity,
      row.unit,
      row.unitPrice,
      row.amount,
      textOf(layout, row.remarksUpper, row.remarksLower),
    ),
  ];
}

function gapCell(): XlsxCell {
  return { value: "", kind: "text", border: "one" };
}

function headerRow(leftTitle: string, rightTitle: string): XlsxCell[] {
  const head = (title: string): XlsxCell => ({
    value: title,
    kind: "header",
    border: "one",
  });
  return [
    head(leftTitle),
    ...HEADER.slice(1).map(() => head("")),
    gapCell(),
    head(rightTitle),
    ...HEADER.slice(1).map(() => head("")),
  ];
}

function titleRow(): XlsxCell[] {
  const head = (title: string): XlsxCell => ({
    value: title,
    kind: "header",
    border: "one",
  });
  return [...HEADER.map(head), gapCell(), ...HEADER.map(head)];
}

export interface CompareSheetInput {
  /** 左（新しい回）の行。画面で開けた空行もそのまま渡す */
  left: readonly BreakdownRow[];
  /** 右（比べる元の回）の行 */
  right: readonly BreakdownRow[];
  layout: number;
  leftTitle: string;
  rightTitle: string;
}

/** 比較のシート（1枚）を作る */
export function toCompareSheet(input: CompareSheetInput): XlsxSheet {
  const leftBlocks = toCompareBlocks(input.left, input.layout);
  const rightBlocks = toCompareBlocks(input.right, input.layout);
  const diffs = compareBreakdown(
    leftBlocks.map(blockValue),
    rightBlocks.map(blockValue),
  );
  const rows: XlsxCell[][] = [
    headerRow(input.leftTitle, input.rightTitle),
    titleRow(),
  ];
  diffs.forEach((diff, index) => {
    // 左（新しい回）だけ色を付ける
    const left = sideLines(
      leftBlocks[index] ?? null,
      input.layout,
      diff.changed,
      diff.onlyLeft,
    );
    const right = sideLines(
      rightBlocks[index] ?? null,
      input.layout,
      null,
      false,
    );
    const count = Math.max(left.length, right.length);
    for (let line = 0; line < count; line += 1) {
      rows.push([
        ...(left[line] ?? sideLines(null, input.layout, null, false)[line]),
        gapCell(),
        ...(right[line] ?? sideLines(null, input.layout, null, false)[line]),
      ]);
    }
  });
  return {
    name: "比較",
    columnWidths: [...WIDTHS, GAP_WIDTH, ...WIDTHS],
    rows,
  };
}

/** 比較のブック（.xlsx）を作る */
export function toCompareWorkbook(input: CompareSheetInput): Buffer {
  return toXlsx([toCompareSheet(input)]);
}
