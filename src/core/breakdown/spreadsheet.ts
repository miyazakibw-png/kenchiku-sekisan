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

const HEADER = ["名称", "摘要", "数量", "単位", "単価", "金額", "備考"];
const COLUMN_WIDTHS = [40, 30, 12, 8, 12, 14, 20];

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
    value: index === 0 ? name : "",
    kind: "header" as const,
    border,
  }));
}

function bodyRows(rows: readonly BreakdownRow[], layout: number): XlsxCell[][] {
  const lines: XlsxCell[][] = [];
  const twoRowHeading =
    layout === BREAKDOWN_LAYOUT.twoLine || layout === BREAKDOWN_LAYOUT.twoRow;
  rows.forEach((row) => {
    if (row.rowKind === "subject" || row.rowKind === "title") {
      // 2段の書式では工種科目・タイトルの見出しも2行で、文字は下の行に出す
      const text = row.rowKind === "subject" ? row.subjectName : row.nameLower;
      if (twoRowHeading) {
        lines.push(headingRow("", "upper"));
        lines.push(headingRow(text, "lower"));
      } else {
        lines.push(headingRow(text, "one"));
      }
      return;
    }
    if (layout === BREAKDOWN_LAYOUT.excel) {
      // 書式③：2段を1行にまとめて掃き出す
      const name = [row.nameUpper, row.nameLower]
        .filter((v) => v !== "")
        .join(" ");
      const description = [row.descriptionUpper, row.descriptionLower]
        .filter((v) => v !== "")
        .join(" ");
      const remarks = [row.remarksUpper, row.remarksLower]
        .filter((v) => v !== "")
        .join(" ");
      lines.push([
        textCell(name),
        textCell(description),
        numberCell(row.quantity),
        textCell(row.unit),
        numberCell(row.unitPrice),
        numberCell(row.amount),
        textCell(remarks),
      ]);
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
        textCell(row.nameLower, border),
        textCell(row.descriptionLower, border),
        numberCell(row.quantity, border),
        textCell(row.unit, border),
        numberCell(row.unitPrice, border),
        numberCell(row.amount, border),
        textCell(row.remarksLower, border),
      ]);
      return;
    }
    lines.push([
      textCell(row.nameUpper, "upper"),
      textCell(row.descriptionUpper, "upper"),
      textCell("", "upper"),
      textCell("", "upper"),
      textCell("", "upper"),
      textCell("", "upper"),
      textCell(row.remarksUpper, "upper"),
    ]);
    lines.push([
      textCell(row.nameLower, "lower"),
      textCell(row.descriptionLower, "lower"),
      numberCell(row.quantity, "lower"),
      textCell(row.unit, "lower"),
      numberCell(row.unitPrice, "lower"),
      numberCell(row.amount, "lower"),
      textCell(row.remarksLower, "lower"),
    ]);
  });
  return lines;
}

function worksheet(sheet: SheetData, layout: number): XlsxSheet {
  const header = HEADER.map((title) => ({
    value: title,
    kind: "header" as const,
    border: "one" as const,
  }));
  return {
    name: sheet.name,
    columnWidths: COLUMN_WIDTHS,
    rows: [header, ...bodyRows(sheet.rows, layout)],
  };
}

/** シートの中身（見出し＋明細）を作る */
export function toSpreadsheetSheets(
  sheets: readonly SheetData[],
  layout: number,
): XlsxSheet[] {
  return sheets.map((sheet) => worksheet(sheet, layout));
}

/** 複数シートのブック（.xlsx）を作る */
export function toSpreadsheetWorkbook(
  sheets: readonly SheetData[],
  layout: number,
): Buffer {
  return toXlsx(toSpreadsheetSheets(sheets, layout));
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
