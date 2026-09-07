/**
 * 家具・設備入力表（家具計算書）。
 * 左の入力欄（科目〜備考下段）に1行ずつ書くと、右の明細欄（部位別雑・金物入力表と同じ形）を自動で作る。
 * 右の明細欄は手で直せる（集計書兼工事マスターの直しは右の明細欄だけに連動し、左の入力欄には戻さない）。
 */

import { evaluateFormula } from "../formula/evaluate";
import { displayedValue } from "../room/calcSheet";
import type { AggregateEntry } from "../aggregate/aggregate";

/** 記号と表示文字の対応（+部位・名称の呼び出し用） */
export interface FurnitureSymbol {
  symbol: string;
  text: string;
}

/** 家具計算書の設定（工事ごとに変えられる） */
export interface FurnitureSettings {
  /** 部位に付け加える文字（例：前＝空・後ろ＝ﾀｲﾌﾟ） */
  partPrefix: string;
  partSuffix: string;
  /** +部位に付け加える文字（例：前＝(・後ろ＝F)） */
  addPrefix: string;
  addSuffix: string;
  /** W・H・Dに付ける文字（摘要下段に出す） */
  widthLabel: string;
  heightLabel: string;
  depthLabel: string;
  /** +部位（記号入力）の対応表 */
  partSymbols: FurnitureSymbol[];
  /** 名称（記号入力）の対応表 */
  nameSymbols: FurnitureSymbol[];
}

/** 右の明細欄（自動で作り、手で直せる） */
export interface FurnitureDetail {
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  detailNumber: number | null;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  /** 数量の計算式（W・H・Dが使える。mに換算して計算する） */
  formula: string;
  sourceDetailId: number | null;
  /** 手で直した欄（自動作成で上書きしない） */
  edited: string[];
}

/** 左の入力欄（1行＝1明細） */
export interface FurnitureRow {
  id: string;
  /** 科目 */
  subjectId: number | null;
  /** 部位ID */
  partNumber: number | null;
  /** 名称ID */
  detailNumber: number | null;
  /** 部位（英数字） */
  part: string;
  /** +部位（英数字） */
  partAdd: string;
  /** +部位（記号→文字） */
  partSymbol: string;
  /** 名称（記号→文字） */
  nameSymbol: string;
  /** W・H・D（mm） */
  width: string;
  height: string;
  depth: string;
  /** 数量 */
  quantity: string;
  unit: string;
  descriptionUpper: string;
  remarksLower: string;
  detail: FurnitureDetail;
}

export interface FurnitureSheetData {
  rows: FurnitureRow[];
  settings: FurnitureSettings;
}

let sequence = 0;

function newId(prefix: string): string {
  sequence += 1;
  return `${prefix}${Date.now().toString(36)}${sequence.toString(36)}`;
}

/** 部位（部屋名）の記号の初めの並び */
export const defaultPartSymbols: FurnitureSymbol[] = [
  { symbol: "G", text: "玄関" },
  { symbol: "R", text: "廊下" },
  { symbol: "S", text: "洗面脱衣室" },
  { symbol: "T", text: "トイレ" },
  { symbol: "LD", text: "LD" },
  { symbol: "Y", text: "洋間" },
  { symbol: "Y1", text: "洋間1" },
  { symbol: "Y2", text: "洋間2" },
  { symbol: "Y3", text: "洋間3" },
  { symbol: "Y4", text: "洋間4" },
  { symbol: "N", text: "納戸" },
  { symbol: "SR", text: "サービスルーム" },
  { symbol: "SR1", text: "サービスルーム1" },
  { symbol: "SR2", text: "サービスルーム2" },
];

/** 名称の記号の初めの並び */
export const defaultNameSymbols: FurnitureSymbol[] = [
  { symbol: "M", text: "物入" },
  { symbol: "M1", text: "物入1" },
  { symbol: "M2", text: "物入2" },
  { symbol: "CL+M", text: "クローゼット+物入" },
  { symbol: "CL", text: "クローゼット" },
  { symbol: "CL1", text: "クローゼット1" },
  { symbol: "CL2", text: "クローゼット2" },
  { symbol: "R", text: "リネン庫" },
  { symbol: "P", text: "パントリー" },
  { symbol: "T", text: "吊戸棚" },
  { symbol: "G", text: "下足入" },
];

export function furnitureSettings(
  patch: Partial<FurnitureSettings> = {},
): FurnitureSettings {
  return {
    partPrefix: "",
    partSuffix: "ﾀｲﾌﾟ",
    addPrefix: "(",
    addSuffix: "F)",
    widthLabel: "W",
    heightLabel: "*H",
    depthLabel: "*D",
    partSymbols: defaultPartSymbols.map((item) => ({ ...item })),
    nameSymbols: defaultNameSymbols.map((item) => ({ ...item })),
    ...patch,
  };
}

export function furnitureDetail(
  patch: Partial<FurnitureDetail> = {},
): FurnitureDetail {
  return {
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
    formula: "",
    sourceDetailId: null,
    edited: [],
    ...patch,
  };
}

export function furnitureRow(patch: Partial<FurnitureRow> = {}): FurnitureRow {
  return {
    id: newId("fr"),
    subjectId: null,
    partNumber: null,
    detailNumber: null,
    part: "",
    partAdd: "",
    partSymbol: "",
    nameSymbol: "",
    width: "",
    height: "",
    depth: "",
    quantity: "",
    unit: "",
    descriptionUpper: "",
    remarksLower: "",
    detail: furnitureDetail(),
    ...patch,
  };
}

/** 表を丸ごと写す（一覧のコピー・貼り付け用。行のidは付け直す） */
export function copyFurnitureRows(rows: FurnitureRow[]): FurnitureRow[] {
  return rows.map((row) => ({
    ...row,
    id: newId("fr"),
    detail: { ...row.detail, edited: [...row.detail.edited] },
  }));
}

/** 記号を表示文字に置き換える（対応表に無いときは入れた文字のまま） */
export function symbolText(symbols: FurnitureSymbol[], text: string): string {
  const value = text.trim();
  if (value === "") return "";
  const found = symbols.find((item) => item.symbol.trim() === value);
  return found ? found.text : text;
}

/** 数字欄を読む（全角も受ける） */
export function numberOf(text: string): number | null {
  const trimmed = text
    .trim()
    .replace(/[０-９．＋－＊／]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
  if (trimmed === "") return null;
  const direct = Number(trimmed);
  if (!Number.isNaN(direct)) return direct;
  return evaluateFormula(trimmed);
}

/** 上の行から引き継いだ値 */
export interface FurnitureResolved {
  subjectId: number | null;
  partNumber: number | null;
  detailNumber: number | null;
  part: string;
  quantity: string;
  formula: string;
}

/**
 * 上の行からの引き継ぎ。
 * 科目・部位ID・部位・数量・計算式は未入力なら上の行と同じ、
 * 名称IDは未入力なら上の行＋0.01。
 */
export function resolveFurnitureRows(
  rows: FurnitureRow[],
): FurnitureResolved[] {
  const carried: FurnitureResolved = {
    subjectId: null,
    partNumber: null,
    detailNumber: null,
    part: "",
    quantity: "",
    formula: "",
  };
  return rows.map((row) => {
    if (row.subjectId !== null) carried.subjectId = row.subjectId;
    if (row.partNumber !== null) carried.partNumber = row.partNumber;
    if (row.detailNumber !== null) carried.detailNumber = row.detailNumber;
    else if (carried.detailNumber !== null)
      carried.detailNumber = Math.round((carried.detailNumber + 0.01) * 100) / 100;
    if (row.part.trim() !== "") carried.part = row.part;
    if (row.quantity.trim() !== "") carried.quantity = row.quantity;
    if (row.detail.formula.trim() !== "") carried.formula = row.detail.formula;
    return { ...carried };
  });
}

/** W・H・Dを摘要下段の文字にする（例：W1200*H1100*D400） */
export function sizeText(
  row: FurnitureRow,
  settings: FurnitureSettings,
): string {
  const parts: string[] = [];
  if (row.width.trim() !== "")
    parts.push(`${settings.widthLabel}${row.width.trim()}`);
  if (row.height.trim() !== "")
    parts.push(`${settings.heightLabel}${row.height.trim()}`);
  if (row.depth.trim() !== "")
    parts.push(`${settings.depthLabel}${row.depth.trim()}`);
  return parts.join("");
}

/** 部位欄の文字（部位＋設定文字／+部位＋設定文字／+部位の記号） */
export function partText(
  row: FurnitureRow,
  resolved: FurnitureResolved,
  settings: FurnitureSettings,
): string {
  const parts: string[] = [];
  const part = resolved.part.trim();
  if (part !== "")
    parts.push(`${settings.partPrefix}${part}${settings.partSuffix}`);
  const add = row.partAdd.trim();
  if (add !== "") parts.push(`${settings.addPrefix}${add}${settings.addSuffix}`);
  const symbol = symbolText(settings.partSymbols, row.partSymbol);
  if (symbol !== "") parts.push(symbol);
  return parts.join("");
}

/** 明細欄を自動で作る（手で直した欄はそのまま残す） */
export function buildDetail(
  row: FurnitureRow,
  resolved: FurnitureResolved,
  settings: FurnitureSettings,
): FurnitureDetail {
  const auto: FurnitureDetail = {
    ...row.detail,
    subjectId: resolved.subjectId,
    partNumber: resolved.partNumber,
    detailNumber: resolved.detailNumber,
    partName: partText(row, resolved, settings),
    name: symbolText(settings.nameSymbols, row.nameSymbol),
    descriptionUpper: row.descriptionUpper,
    descriptionLower: sizeText(row, settings),
    unit: row.unit,
    remarksUpper: "",
    remarksLower: row.remarksLower,
  };
  const kept = row.detail;
  const result = { ...auto };
  kept.edited.forEach((key) => {
    switch (key) {
      case "subjectId":
        result.subjectId = kept.subjectId;
        break;
      case "partNumber":
        result.partNumber = kept.partNumber;
        break;
      case "detailNumber":
        result.detailNumber = kept.detailNumber;
        break;
      case "partName":
        result.partName = kept.partName;
        break;
      case "name":
        result.name = kept.name;
        break;
      case "descriptionUpper":
        result.descriptionUpper = kept.descriptionUpper;
        break;
      case "descriptionLower":
        result.descriptionLower = kept.descriptionLower;
        break;
      case "unit":
        result.unit = kept.unit;
        break;
      case "remarksUpper":
        result.remarksUpper = kept.remarksUpper;
        break;
      case "remarksLower":
        result.remarksLower = kept.remarksLower;
        break;
      default:
        break;
    }
  });
  return result;
}

/** 入力欄から明細欄を作り直す */
export function applyFurnitureDetails(
  rows: FurnitureRow[],
  settings: FurnitureSettings,
): FurnitureRow[] {
  const resolved = resolveFurnitureRows(rows);
  return rows.map((row, index) => ({
    ...row,
    detail: buildDetail(row, resolved[index], settings),
  }));
}

/** 計算式に使えるW・H・D（mに換算する） */
export function sizeVariables(row: FurnitureRow): Record<string, number> {
  const width = numberOf(row.width);
  const height = numberOf(row.height);
  const depth = numberOf(row.depth);
  return {
    W: width === null ? 0 : width / 1000,
    H: height === null ? 0 : height / 1000,
    D: depth === null ? 0 : depth / 1000,
  };
}

/**
 * 1行の計上数量。
 * 計算式（W・H・Dが使える）があればその結果、無ければ数量欄（未入力は上の行と同じ）。
 * 0はタイトル行なので数量として扱わない。
 */
export function rowQuantity(
  row: FurnitureRow,
  resolved: FurnitureResolved,
): number | null {
  const formula = resolved.formula.trim();
  if (formula !== "") {
    const value = evaluateFormula(formula, sizeVariables(row));
    if (value === null) return null;
    return displayedValue(value) === 0 ? null : displayedValue(value);
  }
  const value = numberOf(resolved.quantity);
  if (value === null || value === 0) return null;
  return displayedValue(value);
}

/** 明細が空か（名称も部位も名称IDも無い行は集計しない） */
export function isEmptyDetail(detail: FurnitureDetail): boolean {
  return (
    detail.name.trim() === "" &&
    detail.partName.trim() === "" &&
    detail.detailNumber === null
  );
}

/** 家具計算書の置き場所（一覧の1行＝部位Ⅰ〜Ⅲ・倍率） */
export interface FurnitureSheetPlace {
  sheetId: number;
  part1: string;
  part2: string;
  part2Split: boolean;
  part3: string;
  multiplier: number;
}

/** 集計詳細データ（合算前）を作る。1行＝1件 */
export function entriesFromFurnitureSheet(
  place: FurnitureSheetPlace,
  data: FurnitureSheetData,
  part2Order: Map<string, number>,
): AggregateEntry[] {
  const rows = applyFurnitureDetails(data.rows, data.settings);
  const resolved = resolveFurnitureRows(rows);
  const multiplier = place.multiplier === 0 ? 1 : place.multiplier;
  const entries: AggregateEntry[] = [];
  rows.forEach((row, index) => {
    if (isEmptyDetail(row.detail)) return;
    const value = rowQuantity(row, resolved[index]);
    if (value === null) return;
    entries.push({
      traceId: `furniture:${place.sheetId}:${row.id}`,
      sourceKind: "furniture",
      estimateRowId: null,
      transferRowId: null,
      part1: place.part1,
      part2: place.part2Split ? place.part2 : "",
      part2Raw: place.part2,
      part2Split: place.part2Split,
      part2Order: part2Order.get(place.part2) ?? 0,
      part3: place.part3,
      formwork: "",
      multiplier,
      subjectId: row.detail.subjectId,
      materialCategory: row.detail.materialCategory,
      partNumber: row.detail.partNumber,
      partName: row.detail.partName,
      detailNumber: row.detail.detailNumber,
      name: row.detail.name,
      descriptionUpper: row.detail.descriptionUpper,
      descriptionLower: row.detail.descriptionLower,
      unit: row.detail.unit,
      remarksUpper: row.detail.remarksUpper,
      remarksLower: row.detail.remarksLower,
      estimateDisplay: "",
      coefficient: 1,
      setTotal: value,
      quantity: displayedValue(value * multiplier),
      sourceDetailId: row.detail.sourceDetailId,
    });
  });
  return entries;
}

/** 建具表へ転記する1件 */
export interface FurnitureFitting {
  /** 入力欄の行（転記し直しの目印） */
  rowId: string;
  /** 建具記号（部位・+部位・+部位・名称の入力をそのままつなげたもの） */
  symbol: string;
  name: string;
  /** m換算した寸法 */
  width: number | null;
  height: number | null;
}

/** 建具記号（②〜⑥の英数字入力をまとめたもの） */
export function fittingSymbolOf(
  row: FurnitureRow,
  resolved: FurnitureResolved,
): string {
  return [
    resolved.part.trim(),
    row.partAdd.trim(),
    row.partSymbol.trim(),
    row.nameSymbol.trim(),
  ]
    .filter((part) => part !== "")
    .join("");
}

/**
 * 建具表へ転記する行を作る。
 * W・Hはmに換算し、腰高は無し（建具面積＝W*H・巾木差し引き＝W・補強＝Wは建具表側で自動計算）。
 */
export function fittingsFromFurniture(
  data: FurnitureSheetData,
): FurnitureFitting[] {
  const rows = applyFurnitureDetails(data.rows, data.settings);
  const resolved = resolveFurnitureRows(rows);
  const result: FurnitureFitting[] = [];
  rows.forEach((row, index) => {
    const symbol = fittingSymbolOf(row, resolved[index]);
    if (symbol === "") return;
    const width = numberOf(row.width);
    const height = numberOf(row.height);
    if (width === null && height === null) return;
    result.push({
      rowId: row.id,
      symbol,
      name: row.detail.name,
      width: width === null ? null : Math.round((width / 1000) * 100) / 100,
      height: height === null ? null : Math.round((height / 1000) * 100) / 100,
    });
  });
  return result;
}
