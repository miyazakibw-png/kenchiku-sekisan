/**
 * 内訳書の比較（前回と見比べた状態）のエクセル掃き出し。
 * 画面と同じ並びのまま、左に新しい回・右に前の回を並べて出す。
 * 違うところは左（新しい回）だけ、背景を黄色・文字を赤にする。
 */

import type { XlsxBorder, XlsxCell, XlsxSheet } from "../export/xlsx";
import { toXlsx } from "../export/xlsx";
import { amountOf, BREAKDOWN_LAYOUT, type BreakdownRow } from "./breakdown";
import { DEFAULT_PAGE_LAYOUT, type PageLayout } from "./spreadsheet";
import type { BreakdownField } from "./compare";
import {
  compareBlocksBySubject,
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
      amountOf(row),
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

/** 1ページの明細数。空欄や壊れた値のときは既定の数に戻す（内訳書と同じ） */
function pageDetails(value: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

/** 罫線だけの行（左右どちらも空欄） */
function blankSide(border: XlsxBorder): XlsxCell[] {
  return HEADER.map(() => ({ value: "", kind: "text" as const, border }));
}

export interface CompareSheetInput {
  /** 左（新しい回）の行。画面で開けた空行もそのまま渡す */
  left: readonly BreakdownRow[];
  /** 右（比べる元の回）の行 */
  right: readonly BreakdownRow[];
  layout: number;
  leftTitle: string;
  rightTitle: string;
  /** 1ページに引く罫線の数。内訳書単体の掃き出しと同じ設定を使う */
  page?: PageLayout;
}

/** 小計の行（比較では明細どうしの突き合わせに入れず、科目が終わるページの最後の行へ出す） */
function subtotalTotals(rows: readonly BreakdownRow[]): {
  clean: BreakdownRow[];
  totals: Map<number, number>;
} {
  const totals = new Map<number, number>();
  const clean: BreakdownRow[] = [];
  rows.forEach((row) => {
    if (row.subtotal === true) {
      if (row.subjectId !== null) totals.set(row.subjectId, row.amount ?? 0);
      return;
    }
    clean.push(row);
  });
  return { clean, totals };
}

/** 小計の1行（左・右それぞれの金額欄へ科目の合計を出す） */
function subtotalLine(
  leftTotal: number | null,
  rightTotal: number | null,
): XlsxCell[] {
  const side = (total: number | null): XlsxCell[] =>
    HEADER.map((_title, index) => {
      const value =
        index === 0
          ? total === null
            ? ""
            : "小計"
          : index === 5
            ? (total ?? "")
            : "";
      return {
        value,
        kind:
          typeof value === "number" ? ("number" as const) : ("text" as const),
        border: "one" as const,
      };
    });
  return [...side(leftTotal), gapCell(), ...side(rightTotal)];
}

/** 比較のシート（1枚）を作る */
export function toCompareSheet(input: CompareSheetInput): XlsxSheet {
  const leftSub = subtotalTotals(input.left);
  const rightSub = subtotalTotals(input.right);
  const leftBlocks = toCompareBlocks(leftSub.clean, input.layout);
  const rightBlocks = toCompareBlocks(rightSub.clean, input.layout);
  // 工種科目どうしで並びを合わせてから、明細どうしを突き合わせる（画面と同じ）
  const diffs = compareBlocksBySubject(leftBlocks, rightBlocks);
  const rows: XlsxCell[][] = [
    headerRow(input.leftTitle, input.rightTitle),
    titleRow(),
  ];
  // 内訳書単体と同じ行数指定：1ページ目は見出し行を含めて detailsPerPage 明細分、
  // 2ページ目以降は detailsPerPageLater 明細分の罫線を引き、
  // 工種科目が変わるところでは残りを空行で埋めて次のページから書き出す。
  const page = input.page ?? DEFAULT_PAGE_LAYOUT;
  const unit = twoRowPairs(input.layout) ? 2 : 1;
  const firstPage =
    pageDetails(page.detailsPerPage, DEFAULT_PAGE_LAYOUT.detailsPerPage) * unit;
  const laterPage =
    pageDetails(
      page.detailsPerPageLater,
      DEFAULT_PAGE_LAYOUT.detailsPerPageLater,
    ) * unit;
  let remaining = firstPage - rows.length;
  const fillPage = (): void => {
    for (let count = 0; count < remaining; count += 1) {
      const border: XlsxBorder =
        unit === 1 ? "one" : count % 2 === 0 ? "upper" : "lower";
      rows.push([...blankSide(border), gapCell(), ...blankSide(border)]);
    }
    remaining = laterPage;
  };
  // 工種科目ごとのかたまりに分ける（科目が変わるところでページを改める）
  const groups: (typeof diffs)[number][][] = [];
  diffs.forEach((diff) => {
    const isSubject =
      (diff.leftIndex !== null &&
        leftBlocks[diff.leftIndex].lower.rowKind === "subject") ||
      (diff.rightIndex !== null &&
        rightBlocks[diff.rightIndex].lower.rowKind === "subject");
    if (isSubject || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(diff);
  });
  groups.forEach((group, index) => {
    if (index > 0) fillPage();
    // このかたまりの工種科目（先頭の見出しが無い固まりは null）
    const subjectId =
      group
        .map((diff) => {
          const left =
            diff.leftIndex === null ? null : leftBlocks[diff.leftIndex].lower;
          const right =
            diff.rightIndex === null
              ? null
              : rightBlocks[diff.rightIndex].lower;
          return left?.subjectId ?? null ?? right?.subjectId ?? null;
        })
        .find((id): id is number => id !== null) ?? null;
    group.forEach((diff) => {
      // 左（新しい回）だけ色を付ける
      const left = sideLines(
        diff.leftIndex === null ? null : leftBlocks[diff.leftIndex],
        input.layout,
        diff.changed,
        diff.onlyLeft,
      );
      const right = sideLines(
        diff.rightIndex === null ? null : rightBlocks[diff.rightIndex],
        input.layout,
        null,
        false,
      );
      const count = Math.max(left.length, right.length);
      if (count > remaining) fillPage();
      for (let line = 0; line < count; line += 1) {
        rows.push([
          ...(left[line] ?? sideLines(null, input.layout, null, false)[line]),
          gapCell(),
          ...(right[line] ?? sideLines(null, input.layout, null, false)[line]),
        ]);
        remaining -= 1;
      }
    });
    // 金額が入った科目は、かたまりが終わるページの最後の行に小計を出す
    const leftTotal =
      subjectId === null ? null : (leftSub.totals.get(subjectId) ?? null);
    const rightTotal =
      subjectId === null ? null : (rightSub.totals.get(subjectId) ?? null);
    if (leftTotal !== null || rightTotal !== null) {
      if (remaining < 1) fillPage();
      for (let count = 0; count < remaining - 1; count += 1) {
        const border: XlsxBorder =
          unit === 1 ? "one" : count % 2 === 0 ? "upper" : "lower";
        rows.push([...blankSide(border), gapCell(), ...blankSide(border)]);
      }
      rows.push(subtotalLine(leftTotal, rightTotal));
      remaining = 0;
    }
  });
  fillPage();
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
