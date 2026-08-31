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
  commentSet,
  padLines,
  type CalcDetail,
  type CalcLine,
  type CalcSet,
} from "./calcSheet";

/** コピーした行に混ざっていた※行（at＝その※行より上にある明細の数） */
export type CopiedBanner = { at: number; text: string; color: string };

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

/**
 * 行（明細＋計算式）をコピーするときの列。
 * 明細の列をそのまま並べたあとに計算式の列を足すので、
 * 明細欄へ貼り直しても列がずれない。
 */
export const ROW_PASTE_COLUMNS = [
  ...DETAIL_PASTE_COLUMNS,
  ...LINE_PASTE_COLUMNS,
] as const;

/** 明細の列数（この列より後ろは計算式の列） */
const DETAIL_COLUMN_COUNT = DETAIL_PASTE_COLUMNS.length;

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

/**
 * 画面の列の並び（左から）。カーソルのある列から貼り付けるときに使う。
 * null の列は貼り付けても入らない（計算で出る欄・記号）。
 */
export const SHEET_PASTE_FIELDS = [
  "setPartName",
  "materialCategory",
  "subjectId",
  "partNumber",
  "detailNumber",
  "partName",
  "name",
  "descriptionLower",
  "descriptionUpper",
  "unit",
  "coefficient",
  null,
  "comment",
  "formulaA",
  "formulaB",
  null,
  null,
  null,
  "remarksLower",
  "remarksUpper",
  "estimateDisplay",
] as const;

/** 明細の部位名の列（画面の左から6列目） */
export const SHEET_PART_NAME_COLUMN = SHEET_PASTE_FIELDS.indexOf("partName");

function numberOf(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(value) ? value : null;
}

/**
 * カーソルのある列から、画面の並びどおりにエクセルの表を取り込む。
 * 部位ID・名称IDなどの左側の列に貼り付けても列がずれない。
 */
export function pasteSheet(
  details: CalcDetail[],
  lines: CalcLine[],
  startIndex: number,
  startColumn: number,
  clipboardText: string,
): { details: CalcDetail[]; lines: CalcLine[] } {
  const matrix = normalizePastedMatrix(parseTsv(clipboardText));
  const nextDetails = [...details];
  const nextLines = [...lines];
  const at = Math.min(Math.max(startIndex, 0), nextDetails.length);
  matrix.forEach((row, offset) => {
    const index = at + offset;
    const detail = { ...(nextDetails[index] ?? calcDetail()) };
    const line = { ...(nextLines[index] ?? calcLine()) };
    row.forEach((text, cell) => {
      const field = SHEET_PASTE_FIELDS[Math.max(startColumn, 0) + cell];
      if (field === undefined || field === null) return;
      switch (field) {
        case "setPartName":
          break;
        case "subjectId":
          detail.subjectId = numberOf(text);
          break;
        case "partNumber":
          detail.partNumber = numberOf(text);
          break;
        case "detailNumber":
          detail.detailNumber = numberOf(text);
          break;
        case "coefficient":
          detail.coefficient = coefficientOf(text, detail.coefficient);
          break;
        case "comment":
          line.comment = text;
          break;
        case "formulaA":
          line.formulaA = text;
          break;
        case "formulaB":
          line.formulaB = text;
          break;
        default:
          detail[field] = text;
      }
    });
    if (index < nextDetails.length) nextDetails[index] = detail;
    else nextDetails.push(detail);
    if (index < nextLines.length) nextLines[index] = line;
    else nextLines.push(line);
  });
  return { details: nextDetails, lines: fillLines(nextDetails, nextLines) };
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

/** 明細1件と計算式1行を、コピー用の1行（列はROW_PASTE_COLUMNS）にする */
function rowCells(
  detail: CalcDetail | undefined,
  line: CalcLine | undefined,
): string[] {
  return [
    detail?.partName ?? "",
    detail?.name ?? "",
    detail?.descriptionUpper ?? "",
    detail?.descriptionLower ?? "",
    detail?.unit ?? "",
    detail === undefined ? "" : String(detail.coefficient),
    detail?.remarksUpper ?? "",
    detail?.remarksLower ?? "",
    detail?.estimateDisplay ?? "",
    line?.comment ?? "",
    line?.formulaA ?? "",
    line?.formulaB ?? "",
  ];
}

/** 選んだ行（明細＋計算式）をExcelへ貼れる形にする */
export function rowsAsTsv(details: CalcDetail[], lines: CalcLine[]): string {
  const rowCount = Math.max(details.length, lines.length, 1);
  const matrix: string[][] = [];
  for (let index = 0; index < rowCount; index += 1) {
    matrix.push(rowCells(details[index], lines[index]));
  }
  return toTsv(matrix);
}

/** セット1つをExcelへ貼れる形（明細と計算式を横に並べる）にする */
export function setAsTsv(set: CalcSet): string {
  const rowCount = Math.max(set.details.length, set.lines.length, 1);
  const matrix: string[][] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const cells = rowCells(set.details[index], set.lines[index]);
    // セットの部位名は、明細に部位名が無いときだけ1行目へ入れる
    if (index === 0 && cells[0] === "") cells[0] = set.partName;
    matrix.push(cells);
  }
  return toTsv(matrix);
}

/**
 * 明細と計算式を横に並べた表（ROW_PASTE_COLUMNS）を取り込む。
 * 計算式の列が無い表（明細だけ）でも貼り付けできる。
 */
export function pasteRows(
  details: CalcDetail[],
  lines: CalcLine[],
  startIndex: number,
  clipboardText: string,
): { details: CalcDetail[]; lines: CalcLine[] } {
  const matrix = normalizePastedMatrix(parseTsv(clipboardText));
  const nextDetails = pasteDetails(details, startIndex, clipboardText);
  const nextLines = [...lines];
  const at = Math.min(Math.max(startIndex, 0), nextDetails.length);
  matrix.forEach((row, offset) => {
    if (row.length <= DETAIL_COLUMN_COUNT) return;
    const index = at + offset;
    const base = nextLines[index] ?? calcLine();
    const merged: CalcLine = {
      ...base,
      comment: row[DETAIL_COLUMN_COUNT] ?? base.comment,
      formulaA: row[DETAIL_COLUMN_COUNT + 1] ?? base.formulaA,
      formulaB: row[DETAIL_COLUMN_COUNT + 2] ?? base.formulaB,
      // 記号はセットに1つなので貼り付けでは動かさない
      bSymbol: base.bSymbol,
    };
    if (index < nextLines.length) nextLines[index] = merged;
    else nextLines.push(merged);
  });
  return { details: nextDetails, lines: fillLines(nextDetails, nextLines) };
}

/**
 * コピーした行（※行を含む）をセットの並びに戻す。
 * ※行の位置でセットを区切るので、貼り付けても※行と明細の並びが変わらない。
 */
export function rowsToSets(
  details: CalcDetail[],
  lines: CalcLine[],
  banners: CopiedBanner[],
  part: { partNumber: number | null; partName: string },
): CalcSet[] {
  const created: CalcSet[] = [];
  let from = 0;
  let firstChunk = true;
  const pushRows = (to: number): void => {
    if (to <= from) return;
    const chunk = details.slice(from, to);
    created.push({
      ...calcSet(0),
      partNumber: firstChunk ? part.partNumber : null,
      partName: firstChunk ? part.partName : "",
      details: chunk,
      lines: padLines(chunk, lines.slice(from, to)),
    });
    from = to;
    firstChunk = false;
  };
  [...banners]
    .sort((a, b) => a.at - b.at)
    .forEach((banner) => {
      pushRows(Math.min(Math.max(banner.at, 0), details.length));
      created.push(commentSet(banner.text, banner.color));
    });
  pushRows(details.length);
  return created;
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
