/**
 * 画面の表をそのままエクセル（.xlsx）へ掃き出す。
 * 入力表ごとに1シートで、式は入れず数字と文字だけの閲覧用。
 */

import { toXlsx, xlsxSheetName, type XlsxCell, type XlsxSheet } from "./xlsx";

export interface ScreenSheet {
  /** シート名（入力表の名前） */
  name: string;
  /** 1行目は見出し。セルは画面の表示文字そのまま */
  rows: string[][];
}

/** 数字だけのセルは数値として書き出す（桁区切りは外す） */
export function numberOf(value: string): number | null {
  const text = value.trim().replace(/,/g, "");
  if (text === "" || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** シート名に使えない文字を置き換える（31文字まで・重複は連番） */
export function sheetName(name: string, index: number, used: string[]): string {
  return xlsxSheetName(name, index, used);
}

function cell(value: string, heading: boolean): XlsxCell {
  if (heading) return { value, kind: "header", border: "one" };
  const numeric = numberOf(value);
  if (numeric !== null)
    return { value: numeric, kind: "number", border: "one" };
  return { value, kind: "text", border: "one" };
}

/** 入力表ごとに1シートの中身を作る */
export function toScreenSheets(sheets: readonly ScreenSheet[]): XlsxSheet[] {
  return sheets.map((sheet) => ({
    name: sheet.name,
    rows: sheet.rows.map((row, rowIndex) =>
      row.map((value) => cell(value, rowIndex === 0)),
    ),
  }));
}

/** 入力表ごとに1シートのブック（.xlsx）を作る */
export function toScreenWorkbook(sheets: readonly ScreenSheet[]): Buffer {
  return toXlsx(toScreenSheets(sheets));
}
