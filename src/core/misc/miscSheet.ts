/**
 * 部位別雑・金物入力表。
 * 明細を1列ずつタテに書き、部屋（部位別入力表の行）をヨコに並べて数量を拾う表。
 * 集計では「その部屋の計算書に1明細だけ入れた」のと同じ扱いにする
 * （消火器などの雑・金物を、集計表と計算書が一体の形で拾って入力漏れを防ぐ）。
 */

import { evaluateFormula } from "../formula/evaluate";
import { displayedValue } from "../room/calcSheet";
import type { AggregateEntry } from "../aggregate/aggregate";

/** タテ1列＝1明細 */
export interface MiscColumn {
  id: string;
  /** 科目ID */
  subjectId: number | null;
  /** 仕上（材種）区分 */
  materialCategory: string;
  /** 部位ID */
  partNumber: number | null;
  /** 名称ID（明細ID） */
  detailNumber: number | null;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  /** 呼び出し元の明細レコードID（名称を直しても元をたどれるようにする） */
  sourceDetailId: number | null;
}

/** ヨコ1行＝1部屋（部位別入力表の行から転記する） */
export interface MiscRow {
  id: string;
  /** 部位別入力表の行ID（転記した行。手で足した行は null） */
  estimateRowId: number | null;
  /** 手で足した行の置き場所（すぐ上の行のid）。転記し直してもここに残す */
  anchorRowId: string | null;
  part1: string;
  part2: string;
  part2Split: boolean;
  formwork: string;
  part3: string;
  multiplier: number;
  /** 明細（列）ごとの数量。計算式でも入れられる */
  values: Record<string, string>;
}

export interface MiscSheetData {
  columns: MiscColumn[];
  rows: MiscRow[];
}

let sequence = 0;

function newId(prefix: string): string {
  sequence += 1;
  return `${prefix}${Date.now().toString(36)}${sequence.toString(36)}`;
}

export function miscColumn(patch: Partial<MiscColumn> = {}): MiscColumn {
  return {
    id: newId("mc"),
    subjectId: null,
    materialCategory: "",
    partNumber: null,
    detailNumber: null,
    partName: "",
    name: "",
    descriptionUpper: "",
    descriptionLower: "",
    unit: "",
    remarksUpper: "",
    remarksLower: "",
    sourceDetailId: null,
    ...patch,
  };
}

export function miscRow(patch: Partial<MiscRow> = {}): MiscRow {
  return {
    id: newId("mr"),
    estimateRowId: null,
    anchorRowId: null,
    part1: "",
    part2: "",
    part2Split: false,
    formwork: "",
    part3: "",
    multiplier: 1,
    values: {},
    ...patch,
  };
}

/** 明細（列）が空か（何も入れていない列は集計しない） */
export function isEmptyColumn(column: MiscColumn): boolean {
  return (
    column.name.trim() === "" &&
    column.partName.trim() === "" &&
    column.detailNumber === null
  );
}

/** 数量欄1つ分の値。計算式で入れたときは結果だけを使う */
export function cellValue(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const direct = Number(trimmed);
  if (!Number.isNaN(direct)) return displayedValue(direct);
  const computed = evaluateFormula(trimmed);
  return computed === null ? null : displayedValue(computed);
}

/** 明細（列）ごとの合計。倍率をかけた計上数量で足す */
export function columnTotal(data: MiscSheetData, columnId: string): number {
  return data.rows.reduce((sum, row) => {
    const value = cellValue(row.values[columnId] ?? "");
    if (value === null) return sum;
    const multiplier = row.multiplier === 0 ? 1 : row.multiplier;
    return displayedValue(sum + displayedValue(value * multiplier));
  }, 0);
}

/** 部位別入力表の行 */
export interface MiscEstimateRow {
  id: number;
  rowType: string;
  part1: string;
  part2: string;
  part2Split: number;
  formwork: string;
  part3: string;
  multiplier: number;
}

/**
 * 部位別入力表の行を取り込む。
 * すでに入っている行は数量を残したまま部位だけそろえ、
 * 新しい部屋は下へ足す（部位別入力表の並びに合わせる）。
 * 手で足した行（追加行）は消さず、すぐ上の行の下に付いたまま残す。
 * 上の行が部位別入力表から消えたときは、いちばん下へ回す。
 */
export function syncRowsFromEstimate(
  rows: MiscRow[],
  estimateRows: MiscEstimateRow[],
): MiscRow[] {
  const inherited = { part1: "", part2: "", part2Split: 0 };
  const known = new Map(
    rows
      .filter((row) => row.estimateRowId !== null)
      .map((row) => [row.estimateRowId, row]),
  );
  const synced: MiscRow[] = [];
  estimateRows.forEach((row) => {
    if (row.part1.trim() !== "") inherited.part1 = row.part1;
    if (row.part2.trim() !== "") {
      inherited.part2 = row.part2;
      inherited.part2Split = row.part2Split;
    }
    if (row.rowType === "subtotal") return;
    const current = known.get(row.id);
    synced.push({
      ...(current ?? miscRow()),
      estimateRowId: row.id,
      part1: inherited.part1,
      part2: inherited.part2,
      part2Split: inherited.part2Split === 1,
      formwork: row.formwork,
      part3: row.part3,
      multiplier: row.multiplier,
    });
  });
  // 手で足した行（転記した部屋で部位別入力表から消えたものは、行も消す）
  const extras = rows.filter((row) => row.estimateRowId === null);
  const byAnchor = new Map<string, MiscRow[]>();
  extras.forEach((row) => {
    const anchor = row.anchorRowId;
    if (anchor === null || anchor === undefined) return;
    const list = byAnchor.get(anchor);
    if (list === undefined) byAnchor.set(anchor, [row]);
    else list.push(row);
  });
  const used = new Set<string>();
  const withExtras = (row: MiscRow): MiscRow[] => {
    const result = [row];
    (byAnchor.get(row.id) ?? []).forEach((extra) => {
      if (used.has(extra.id)) return;
      used.add(extra.id);
      result.push(...withExtras(extra));
    });
    return result;
  };
  const result = synced.flatMap(withExtras);
  // すぐ上の部屋が部位別入力表から消えた追加行は、消さずにいちばん下へ回す
  extras.forEach((row) => {
    if (used.has(row.id)) return;
    used.add(row.id);
    const above = result[result.length - 1];
    // 次に転記し直したときも同じ場所に残るよう、置き場所を覚え直す
    result.push(
      { ...row, anchorRowId: above === undefined ? null : above.id },
      ...withExtras(row).slice(1),
    );
  });
  return result;
}

/** 集計詳細データ（合算前）を作る。1つの数量欄＝1件 */
export function entriesFromMiscSheet(
  data: MiscSheetData,
  part2Order: Map<string, number>,
): AggregateEntry[] {
  const entries: AggregateEntry[] = [];
  data.rows.forEach((row) => {
    const multiplier = row.multiplier === 0 ? 1 : row.multiplier;
    data.columns.forEach((column) => {
      if (isEmptyColumn(column)) return;
      const value = cellValue(row.values[column.id] ?? "");
      if (value === null) return;
      entries.push({
        traceId: `misc:${row.id}:${column.id}`,
        sourceKind: "misc",
        estimateRowId: row.estimateRowId,
        transferRowId: null,
        part1: row.part1,
        part2: row.part2Split ? row.part2 : "",
        part2Raw: row.part2,
        part2Split: row.part2Split,
        part2Order: part2Order.get(row.part2) ?? 0,
        part3: row.part3,
        formwork: row.formwork,
        multiplier,
        subjectId: column.subjectId,
        materialCategory: column.materialCategory,
        partNumber: column.partNumber,
        partName: column.partName,
        detailNumber: column.detailNumber,
        name: column.name,
        descriptionUpper: column.descriptionUpper,
        descriptionLower: column.descriptionLower,
        unit: column.unit,
        remarksUpper: column.remarksUpper,
        remarksLower: column.remarksLower,
        estimateDisplay: "",
        coefficient: 1,
        setTotal: value,
        quantity: displayedValue(value * multiplier),
        sourceDetailId: column.sourceDetailId,
      });
    });
  });
  return entries;
}
