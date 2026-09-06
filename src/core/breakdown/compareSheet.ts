/**
 * 内訳書の比較（前回と見比べた状態）のエクセル掃き出し。
 * 画面と同じ並びのまま、左に新しい回・右に前の回を並べて出す。
 * 違うところは左（新しい回）だけ、背景を黄色・文字を赤にする。
 */

import type { XlsxBorder, XlsxCell, XlsxSheet } from "../export/xlsx";
import { toXlsx } from "../export/xlsx";
import { BREAKDOWN_LAYOUT, type BreakdownRow } from "./breakdown";
import { compareBreakdown, type BreakdownField } from "./compare";

/** 左右それぞれの列（印の列は付けない） */
const HEADER = ["名称", "摘要", "数量", "単位", "単価", "金額", "備考"];
const WIDTHS = [40, 30, 12, 8, 12, 14, 20];
/** 左右の表の間のあき */
const GAP_WIDTH = 4;

function headingText(row: BreakdownRow): string {
  return row.rowKind === "subject" ? row.subjectName : row.nameLower;
}

function join(upper: string, lower: string): string {
  return [upper, lower].filter((text) => text !== "").join(" ");
}

function newline(upper: string, lower: string): string {
  return [upper, lower].filter((text) => text !== "").join("\n");
}

/** 1明細を上下2行1組で出す書式か（画面の表示と合わせる） */
function twoRowPairs(layout: number): boolean {
  return (
    layout === BREAKDOWN_LAYOUT.twoRow || layout === BREAKDOWN_LAYOUT.excel
  );
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
 * 上下2行1明細の書式で、この行が明細の上の行か下の行かを見る。
 * 上下の間に罫線を引かないことで、画面と同じ「2段1行」に見せる。
 */
function rowBorder(
  rows: readonly BreakdownRow[],
  index: number,
  layout: number,
): XlsxBorder {
  if (!twoRowPairs(layout)) return "one";
  const row = rows[index];
  if (row === undefined) return "one";
  if (row.rowKind === "note" && rows[index + 1]?.rowKind === "detail")
    return "upper";
  if (row.rowKind === "detail" && rows[index - 1]?.rowKind === "note")
    return "lower";
  return "one";
}

/** 片側1行分（7列）を作る。色を付けるのは changed が渡されたときだけ */
function sideCells(
  row: BreakdownRow | null,
  layout: number,
  changed: readonly BreakdownField[] | null,
  onlySide: boolean,
  border: XlsxBorder,
): XlsxCell[] {
  const mark = (field: BreakdownField): "plain" | "diff" => {
    if (changed === null) return "plain";
    if (onlySide) return "diff";
    return changed.includes(field) ? "diff" : "plain";
  };
  if (row === null) {
    return HEADER.map(() => ({
      value: "",
      kind: "text" as const,
      border,
      mark: changed === null ? ("plain" as const) : ("diff" as const),
    }));
  }
  const heading = row.rowKind === "subject" || row.rowKind === "title";
  const name = heading
    ? { value: headingText(row), wrap: false }
    : textOf(layout, row.nameUpper, row.nameLower);
  const description = heading
    ? { value: "", wrap: false }
    : textOf(layout, row.descriptionUpper, row.descriptionLower);
  const remarks = heading
    ? { value: "", wrap: false }
    : textOf(layout, row.remarksUpper, row.remarksLower);
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
    number(row.quantity, "quantity"),
    {
      value: row.unit,
      kind: "text",
      border,
      mark: mark("unit"),
    },
    number(row.unitPrice, null),
    number(row.amount, null),
    text(remarks, "remarks"),
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
  const diffs = compareBreakdown(
    input.left as BreakdownRow[],
    input.right as BreakdownRow[],
  );
  const rows: XlsxCell[][] = [
    headerRow(input.leftTitle, input.rightTitle),
    titleRow(),
  ];
  diffs.forEach((diff) => {
    rows.push([
      // 左（新しい回）だけ色を付ける
      ...sideCells(
        diff.left,
        input.layout,
        diff.changed,
        diff.onlyLeft,
        rowBorder(input.left, diff.index, input.layout),
      ),
      gapCell(),
      ...sideCells(
        diff.right,
        input.layout,
        null,
        false,
        rowBorder(input.right, diff.index, input.layout),
      ),
    ]);
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
