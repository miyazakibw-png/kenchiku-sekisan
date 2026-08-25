/**
 * 内訳書の掃き出し。
 * BCS.CSV（Shift_JIS）と、エクセル（全明細1シート／工種科目ごとに1シート）を作る。
 */

import { writeFileSync } from "fs";
import iconv from "iconv-lite";
import { toBcsCsv } from "../../core/breakdown/bcs";
import {
  splitBySubject,
  toSpreadsheetXml,
} from "../../core/breakdown/spreadsheet";
import type { BreakdownRow } from "../../core/breakdown/breakdown";
import type {
  BreakdownExportKind,
  BreakdownRowRecord,
  BreakdownSettingsRecord,
} from "../../shared/types";

function toCoreRow(row: BreakdownRowRecord): BreakdownRow {
  return {
    rowKind:
      row.rowKind === "subject" ||
      row.rowKind === "note" ||
      row.rowKind === "blank"
        ? row.rowKind
        : "detail",
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    masterKey: row.masterKey,
    aggregateItemId: row.aggregateItemId,
    partName: row.partName,
    nameUpper: row.nameUpper,
    nameLower: row.nameLower,
    descriptionUpper: row.descriptionUpper,
    descriptionLower: row.descriptionLower,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unitPrice,
    amount: row.amount,
    remarksUpper: row.remarksUpper,
    remarksLower: row.remarksLower,
  };
}

/** 掃き出しの中身を作る（拡張子つきの既定ファイル名も返す） */
export function buildExport(
  kind: BreakdownExportKind,
  rows: BreakdownRowRecord[],
  settings: BreakdownSettingsRecord,
  projectName: string,
): { content: Buffer; defaultName: string } {
  const coreRows = rows.map(toCoreRow);
  if (kind === "bcs") {
    const csv = toBcsCsv(coreRows, {
      projectName,
      workCategory: settings.workCategory,
    });
    return {
      content: iconv.encode(csv, "cp932"),
      defaultName: `${projectName}_BCS.CSV`,
    };
  }
  const sheets =
    kind === "excelBySubject"
      ? splitBySubject(coreRows)
      : [{ name: "内訳書", rows: coreRows }];
  const xml = toSpreadsheetXml(sheets, settings.layout);
  return {
    content: Buffer.from(xml, "utf8"),
    // SpreadsheetML なので .xml で保存する（.xls だとエクセルが形式違いの警告を出す）
    defaultName: `${projectName}_内訳書.xml`,
  };
}

export function writeExport(filePath: string, content: Buffer): void {
  writeFileSync(filePath, content);
}
