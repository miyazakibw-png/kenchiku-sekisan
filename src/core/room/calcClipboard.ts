/**
 * セット明細計算表（下段）のコピー・貼り付け。
 * ・Excelの表をそのまま貼り付ける（明細欄／計算式欄）
 * ・セット単位・明細単位のコピー貼り付け（Excelへも貼れるようTSVにする）
 */

import { normalizePastedMatrix, parseTsv, toTsv } from "../../shared/tsv";
import {
  calcDetail,
  calcLine,
  calcSet,
  type CalcDetail,
  type CalcLine,
  type CalcSet,
} from "./calcSheet";

/** 明細欄へ貼り付けるときの列（画面の並びと同じ） */
export const DETAIL_PASTE_COLUMNS = [
  "部位名",
  "名称",
  "摘要（上）",
  "摘要（下）",
  "単位",
  "掛け率",
  "備考（上）",
  "備考（下）",
  "積算用表示",
] as const;

/** 計算式欄へ貼り付けるときの列（1列だけのときは計算式Ａとして扱う） */
export const LINE_PASTE_COLUMNS = ["コメント", "計算式Ａ", "計算式Ｂ"] as const;

function coefficientOf(text: string, fallback: number): number {
  if (text.trim() === "") return fallback;
  const value = Number(text);
  return Number.isFinite(value) && value !== 0 ? value : fallback;
}

/** Excelの表を明細（1行＝1明細）として取り込む */
export function pasteDetails(
  details: CalcDetail[],
  startIndex: number,
  clipboardText: string,
): CalcDetail[] {
  const matrix = normalizePastedMatrix(parseTsv(clipboardText));
  const next = [...details];
  const at = Math.min(Math.max(startIndex, 0), next.length);
  matrix.forEach((row, offset) => {
    const index = at + offset;
    const base = next[index] ?? calcDetail();
    const [
      partName,
      name,
      descriptionUpper,
      descriptionLower,
      unit,
      coefficient,
      remarksUpper,
      remarksLower,
      estimateDisplay,
    ] = row;
    const merged: CalcDetail = {
      ...base,
      partName: partName ?? base.partName,
      name: name ?? base.name,
      descriptionUpper: descriptionUpper ?? base.descriptionUpper,
      descriptionLower: descriptionLower ?? base.descriptionLower,
      unit: unit ?? base.unit,
      coefficient: coefficientOf(coefficient ?? "", base.coefficient),
      remarksUpper: remarksUpper ?? base.remarksUpper,
      remarksLower: remarksLower ?? base.remarksLower,
      estimateDisplay: estimateDisplay ?? base.estimateDisplay,
    };
    if (index < next.length) next[index] = merged;
    else next.push(merged);
  });
  return next;
}

/** Excelの数量表を計算式（1行＝1計算行）として取り込む */
export function pasteLines(
  lines: CalcLine[],
  startIndex: number,
  clipboardText: string,
): CalcLine[] {
  const matrix = normalizePastedMatrix(parseTsv(clipboardText));
  const next = [...lines];
  const at = Math.min(Math.max(startIndex, 0), next.length);
  matrix.forEach((row, offset) => {
    const index = at + offset;
    const base = next[index] ?? calcLine();
    // 1列だけのときは計算式Ａ。2列以上はコメント／計算式Ａ／計算式Ｂ
    const [comment, formulaA, formulaB] =
      row.length === 1 ? ["", row[0], ""] : row;
    const merged: CalcLine = {
      ...base,
      comment: comment ?? base.comment,
      formulaA: formulaA ?? base.formulaA,
      formulaB: formulaB ?? base.formulaB,
      // 記号はセットに1つなので貼り付けでは動かさない
      bSymbol: base.bSymbol,
    };
    if (index < next.length) next[index] = merged;
    else next.push(merged);
  });
  return next;
}

/** 明細1件につき計算式1行になるよう、足りない計算式行を足す */
export function fillLines(
  details: CalcDetail[],
  lines: CalcLine[],
): CalcLine[] {
  const next = [...lines];
  while (next.length < Math.max(details.length, 1)) next.push(calcLine());
  return next;
}

/** 明細1件をExcelへ貼れる形（1行）にする */
export function detailAsTsv(detail: CalcDetail): string {
  return toTsv([
    [
      detail.partName,
      detail.name,
      detail.descriptionUpper,
      detail.descriptionLower,
      detail.unit,
      String(detail.coefficient),
      detail.remarksUpper,
      detail.remarksLower,
      detail.estimateDisplay,
    ],
  ]);
}

/** 選んだ行（明細＋計算式）をExcelへ貼れる形にする */
export function rowsAsTsv(details: CalcDetail[], lines: CalcLine[]): string {
  const rowCount = Math.max(details.length, lines.length, 1);
  const matrix: string[][] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const detail = details[index];
    const line = lines[index];
    matrix.push([
      detail?.partName ?? "",
      detail?.name ?? "",
      detail?.descriptionUpper ?? "",
      detail?.descriptionLower ?? "",
      detail?.unit ?? "",
      detail === undefined ? "" : String(detail.coefficient),
      line?.comment ?? "",
      line?.formulaA ?? "",
      line?.formulaB ?? "",
    ]);
  }
  return toTsv(matrix);
}

/** セット1つをExcelへ貼れる形（明細と計算式を横に並べる）にする */
export function setAsTsv(set: CalcSet): string {
  const rowCount = Math.max(set.details.length, set.lines.length, 1);
  const matrix: string[][] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const detail = set.details[index];
    const line = set.lines[index];
    matrix.push([
      index === 0 ? set.partName : "",
      detail?.partName ?? "",
      detail?.name ?? "",
      detail?.descriptionLower ?? "",
      detail?.unit ?? "",
      detail === undefined ? "" : String(detail.coefficient),
      line?.comment ?? "",
      line?.formulaA ?? "",
      line?.formulaB ?? "",
    ]);
  }
  return toTsv(matrix);
}

/** 明細を写す（IDは新しくする。写し元の明細IDは根拠として残す） */
export function duplicateDetail(detail: CalcDetail): CalcDetail {
  const { id: _id, ...rest } = detail;
  return calcDetail(rest);
}

/** 計算式行を写す（IDは新しくし、記号Ｂは重複しないよう外す） */
export function duplicateLine(line: CalcLine): CalcLine {
  const { id: _id, ...rest } = line;
  return calcLine({ ...rest, bSymbol: "" });
}

/** セットを写す（セットIDと行IDを新しくし、記号Ｂは重複しないよう外す） */
export function duplicateSet(set: CalcSet): CalcSet {
  const created = calcSet(0);
  return {
    ...created,
    partNumber: set.partNumber,
    partName: set.partName,
    banner: set.banner ? { ...set.banner } : null,
    details: set.details.map(duplicateDetail),
    lines: set.lines.map((line) => {
      const { id: _id, ...rest } = line;
      return calcLine({ ...rest, bSymbol: "" });
    }),
  };
}
