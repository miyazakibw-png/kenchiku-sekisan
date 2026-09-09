/**
 * 内訳書の掃き出し。
 * BCS.CSV（Shift_JIS）と、エクセル（全明細1シート／工種科目ごとに1シート）を作る。
 */

import { writeFileSync } from "fs";
import iconv from "iconv-lite";
import { toBcsCsv } from "../../core/breakdown/bcs";
import {
  splitBySubject,
  toSpreadsheetWorkbook,
} from "../../core/breakdown/spreadsheet";
import { toCompareWorkbook } from "../../core/breakdown/compareSheet";
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
      row.rowKind === "title" ||
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

/** 比較の掃き出しに必要な、比べる元（右側）の中身 */
export interface CompareExportInput {
  rows: BreakdownRowRecord[];
  leftTitle: string;
  rightTitle: string;
}

/** 掃き出しの中身を作る（拡張子つきの既定ファイル名も返す） */
export function buildExport(
  kind: BreakdownExportKind,
  rows: BreakdownRowRecord[],
  settings: BreakdownSettingsRecord,
  projectName: string,
  compare?: CompareExportInput,
): { content: Buffer; defaultName: string } {
  const coreRows = rows.map(toCoreRow);
  if (kind === "excelCompare") {
    return {
      content: toCompareWorkbook({
        left: coreRows,
        right: (compare?.rows ?? []).map(toCoreRow),
        layout: settings.layout,
        leftTitle: compare?.leftTitle ?? "新しい内訳書",
        rightTitle: compare?.rightTitle ?? "前の内訳書",
      }),
      defaultName: `${projectName}_内訳書_比較.xlsx`,
    };
  }
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
  return {
    content: toSpreadsheetWorkbook(sheets, settings.layout, {
      detailsPerPage: settings.detailsPerPage,
      detailsPerPageLater: settings.detailsPerPageLater,
    }),
    defaultName: `${projectName}_内訳書.xlsx`,
  };
}

export function writeExport(filePath: string, content: Buffer): void {
  writeFileSync(filePath, content);
}
