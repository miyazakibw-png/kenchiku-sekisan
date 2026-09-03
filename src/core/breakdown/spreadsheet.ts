/**
 * 内訳書のエクセル掃き出し（.xlsx）。
 * 外部ライブラリを使わずに複数シート・罫線つきの表を作れるので、完全オフラインでも動く。
 */

import {
  toXlsx,
  type XlsxBorder,
  type XlsxCell,
  type XlsxSheet,
} from "../export/xlsx";
import { BREAKDOWN_LAYOUT, type BreakdownRow } from "./breakdown";

export interface SheetData {
  name: string;
  rows: BreakdownRow[];
}

/** 1ページに引く罫線の数（提出先の書式に合わせて変えられる） */
export interface PageLayout {
  /** 1ページ目の明細数（タイトル行を含む） */
  detailsPerPage: number;
  /** 2ページ目以降の明細数（タイトル行が無い分） */
  detailsPerPageLater: number;
}

export const DEFAULT_PAGE_LAYOUT: PageLayout = {
  detailsPerPage: 17,
  detailsPerPageLater: 16,
};

/** 先頭は「印」の列。文字は出さず、1列分のあき（罫線つき）だけ残す */
const HEADER = ["", "名称", "摘要", "数量", "単位", "単価", "金額", "備考"];
const COLUMN_WIDTHS = [4, 40, 30, 12, 8, 12, 14, 20];

/** 印の列（常に空欄） */
function markCell(border: RowBorder = "one"): XlsxCell {
  return { value: "", kind: "text", border };
}

/**
 * 行の罫線の種類。
 * one：上下とも罫線あり、upper：1明細の上の行（下の線なし）、lower：下の行（上の線なし）
 */
type RowBorder = XlsxBorder;

function textCell(value: string, border: RowBorder = "one"): XlsxCell {
  return { value, kind: "text", border };
}

function numberCell(value: number | null, border: RowBorder = "one"): XlsxCell {
  if (value === null) return { value: null, kind: "text", border };
  return { value, kind: "number", border };
}

/** 見出し（工種科目・タイトル）の1行。列のタテ線を残すため全列分のセルを出す */
function headingRow(name: string, border: RowBorder): XlsxCell[] {
  return HEADER.map((_title, index) => ({
    value: index === 1 ? name : "",
    kind: "header" as const,
    border,
  }));
}

function wrapCell(upper: string, lower: string): XlsxCell {
  // エクセルの Alt+Enter と同じセル内改行。片方だけのときは改行を入れない
  const value = [upper, lower].filter((text) => text !== "").join("\n");
  return { value, kind: value.includes("\n") ? "wrap" : "text", border: "one" };
}

/** 1明細が何行になるか（2段の書式は上下2行、1段・セル内改行の書式は1行） */
function rowsPerDetail(layout: number): number {
  return layout === BREAKDOWN_LAYOUT.oneLine ||
    layout === BREAKDOWN_LAYOUT.excel
    ? 1
    : 2;
}

/** 明細1件分をまとめた行の固まり（ページの途中で切らない単位） */
function detailBlocks(
  rows: readonly BreakdownRow[],
  layout: number,
): XlsxCell[][][] {
  const blocks: XlsxCell[][][] = [];
  const lines: XlsxCell[][] = [];
  const flush = (): void => {
    if (lines.length > 0) blocks.push(lines.splice(0, lines.length));
  };
  const twoRowHeading =
    layout === BREAKDOWN_LAYOUT.twoLine || layout === BREAKDOWN_LAYOUT.twoRow;
  /** 書式③：上段の行（画面では2段2行）を、下段の行と1行にまとめるまで持っておく */
  let pending: BreakdownRow | null = null;
  /** 下段の行が来ないまま次へ進むときは、上段だけで1行にする */
  const excelLine = (
    upper: BreakdownRow | null,
    lower: BreakdownRow | null,
  ): void => {
    const text = (
      pick: (row: BreakdownRow) => string,
      fallback: (row: BreakdownRow) => string,
    ): string => {
      if (upper !== null) return pick(upper);
      return lower === null ? "" : fallback(lower);
    };
    lines.push([
      markCell(),
      wrapCell(
        text(
          (row) => row.nameLower,
          (row) => row.nameUpper,
        ),
        lower === null ? "" : lower.nameLower,
      ),
      wrapCell(
        text(
          (row) => row.descriptionLower,
          (row) => row.descriptionUpper,
        ),
        lower === null ? "" : lower.descriptionLower,
      ),
      numberCell(lower === null ? null : lower.quantity),
      textCell(lower === null ? "" : lower.unit),
      numberCell(lower === null ? null : lower.unitPrice),
      numberCell(lower === null ? null : lower.amount),
      wrapCell(
        text(
          (row) => row.remarksLower,
          (row) => row.remarksUpper,
        ),
        lower === null ? "" : lower.remarksLower,
      ),
    ]);
    flush();
  };
  const flushPending = (): void => {
    if (pending === null) return;
    const upper = pending;
    pending = null;
    excelLine(upper, null);
  };
  rows.forEach((row) => {
    if (row.rowKind === "subject" || row.rowKind === "title") {
      flushPending();
      // 2段の書式では工種科目・タイトルの見出しも2行で、文字は下の行に出す
      const text = row.rowKind === "subject" ? row.subjectName : row.nameLower;
      if (twoRowHeading) {
        lines.push(headingRow("", "upper"));
        lines.push(headingRow(text, "lower"));
      } else {
        lines.push(headingRow(text, "one"));
      }
      flush();
      return;
    }
    if (layout === BREAKDOWN_LAYOUT.excel) {
      // 書式③：画面の2段2行を1行にまとめ、上段と下段はセルの中で改行する（上：部位／下：名称）
      if (row.rowKind === "note") {
        pending = row;
        return;
      }
      const upper = pending;
      pending = null;
      excelLine(upper, row);
      return;
    }
    if (
      layout === BREAKDOWN_LAYOUT.oneLine ||
      layout === BREAKDOWN_LAYOUT.twoRow
    ) {
      // 書式②④：1行に1段だけ書く（書式④は上段（note）と下段（detail）で2行1明細）
      const border: RowBorder =
        layout === BREAKDOWN_LAYOUT.oneLine
          ? "one"
          : row.rowKind === "note"
            ? "upper"
            : row.rowKind === "detail"
              ? "lower"
              : "one";
      lines.push([
        markCell(border),
        textCell(row.nameLower, border),
        textCell(row.descriptionLower, border),
        numberCell(row.quantity, border),
        textCell(row.unit, border),
        numberCell(row.unitPrice, border),
        numberCell(row.amount, border),
        textCell(row.remarksLower, border),
      ]);
      if (layout === BREAKDOWN_LAYOUT.oneLine || row.rowKind !== "note")
        flush();
      return;
    }
    lines.push([
      markCell("upper"),
      textCell(row.nameUpper, "upper"),
      textCell(row.descriptionUpper, "upper"),
      textCell("", "upper"),
      textCell("", "upper"),
      textCell("", "upper"),
      textCell("", "upper"),
      textCell(row.remarksUpper, "upper"),
    ]);
    lines.push([
      markCell("lower"),
      textCell(row.nameLower, "lower"),
      textCell(row.descriptionLower, "lower"),
      numberCell(row.quantity, "lower"),
      textCell(row.unit, "lower"),
      numberCell(row.unitPrice, "lower"),
      numberCell(row.amount, "lower"),
      textCell(row.remarksLower, "lower"),
    ]);
    flush();
  });
  flushPending();
  flush();
  return blocks;
}

/** タイトル行。2段にして文字は下の行へ入れる */
function titleRows(): XlsxCell[][] {
  const upper = HEADER.map(() => ({
    value: "",
    kind: "header" as const,
    border: "upper" as const,
  }));
  const lower = HEADER.map((title) => ({
    value: title,
    kind: "header" as const,
    border: "lower" as const,
  }));
  return [upper, lower];
}

/** 1ページの明細数。空欄や壊れた値のときは既定の数に戻す */
function pageDetails(value: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function blankRow(border: RowBorder): XlsxCell[] {
  return HEADER.map(() => textCell("", border));
}

/**
 * 明細の固まりをページへ並べる。
 * 1ページ目はタイトル行を含めて detailsPerPage 明細分、
 * 2ページ目以降はタイトルが無いので detailsPerPageLater 明細分の罫線を引く。
 * 工種科目が変わるところでは、残りを空行で埋めて次のページから書き出す。
 */
function paginate(
  subjects: readonly XlsxCell[][][][],
  layout: number,
  page: PageLayout,
): XlsxCell[][] {
  const unit = rowsPerDetail(layout);
  const firstPage =
    pageDetails(page.detailsPerPage, DEFAULT_PAGE_LAYOUT.detailsPerPage) * unit;
  const laterPage =
    pageDetails(
      page.detailsPerPageLater,
      DEFAULT_PAGE_LAYOUT.detailsPerPageLater,
    ) * unit;

  const rows: XlsxCell[][] = [];
  const title = titleRows();
  title.forEach((row) => rows.push(row));
  let remaining = firstPage - title.length;

  const fillPage = (): void => {
    // 2段の書式では、空欄も1明細2行として上下段の間に線を入れない
    for (let count = 0; count < remaining; count += 1) {
      const border: RowBorder =
        unit === 1 ? "one" : count % 2 === 0 ? "upper" : "lower";
      rows.push(blankRow(border));
    }
    remaining = laterPage;
  };

  subjects.forEach((blocks, index) => {
    if (index > 0) fillPage();
    blocks.forEach((block) => {
      if (block.length > remaining) fillPage();
      block.forEach((row) => rows.push(row));
      remaining -= block.length;
    });
  });
  fillPage();
  return rows;
}

/** 工種科目ごとに固まりを分ける（1シート出力で科目ごとにページを分けるため） */
function bySubject(rows: readonly BreakdownRow[]): BreakdownRow[][] {
  const groups: BreakdownRow[][] = [];
  rows.forEach((row) => {
    if (row.rowKind === "subject" || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(row);
  });
  return groups;
}

function worksheet(
  sheet: SheetData,
  layout: number,
  page: PageLayout,
): XlsxSheet {
  const subjects = bySubject(sheet.rows).map((rows) =>
    detailBlocks(rows, layout),
  );

  return {
    name: sheet.name,
    columnWidths: COLUMN_WIDTHS,
    rows: paginate(subjects, layout, page),
  };
}

/** シートの中身（見出し＋明細）を作る */
export function toSpreadsheetSheets(
  sheets: readonly SheetData[],
  layout: number,
  page: PageLayout = DEFAULT_PAGE_LAYOUT,
): XlsxSheet[] {
  return sheets.map((sheet) => worksheet(sheet, layout, page));
}

/** 複数シートのブック（.xlsx）を作る */
export function toSpreadsheetWorkbook(
  sheets: readonly SheetData[],
  layout: number,
  page: PageLayout = DEFAULT_PAGE_LAYOUT,
): Buffer {
  return toXlsx(toSpreadsheetSheets(sheets, layout, page));
}

/** 工種科目ごとにシートを分ける */
export function splitBySubject(rows: readonly BreakdownRow[]): SheetData[] {
  const sheets: SheetData[] = [];
  rows.forEach((row) => {
    if (row.rowKind === "subject" || sheets.length === 0) {
      sheets.push({ name: row.subjectName, rows: [] });
    }
    sheets[sheets.length - 1].rows.push(row);
  });
  return sheets;
}
