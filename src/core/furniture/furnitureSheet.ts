/**
 * 家具・設備入力表（家具計算書）。
 * 左の入力欄（科目〜備考下段）に1行ずつ書くと、右の明細欄（部位別雑・金物入力表と同じ形）を自動で作る。
 * 右の明細欄は手で直せる（集計書兼工事マスターの直しは右の明細欄だけに連動し、左の入力欄には戻さない）。
 */

import { evaluateFormula } from "../formula/evaluate";
import { displayedValue } from "../room/calcSheet";
import { toHalfWidth } from "../text/halfWidth";
import {
  cellValue,
  isEmptyColumn,
  miscColumn,
  type MiscColumn,
} from "../misc/miscSheet";
import type { AggregateEntry } from "../aggregate/aggregate";

/**
 * タテ方向の明細（部位別雑・金物入力表と同じ形）。
 * ヨコ1行＝家具1件の自動明細とは別に、家具に付く関連明細をタテに拾う。
 */
export type FurnitureColumn = MiscColumn;

export function furnitureColumn(
  patch: Partial<FurnitureColumn> = {},
): FurnitureColumn {
  return miscColumn(patch);
}

export { isEmptyColumn as isEmptyFurnitureColumn };

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
  /** システムキッチン・洗面化粧台用：W2・W3の前に付ける文字（例：+） */
  width2Label: string;
  width3Label: string;
  /** システムキッチン・洗面化粧台用：W2あり・W3無しのときWの後ろに付ける文字（例：(L型)） */
  lShapeLabel: string;
  /** システムキッチン・洗面化粧台用：W3ありのときWの後ろに付ける文字（例：(コ型)） */
  uShapeLabel: string;
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
  /** システムキッチン・洗面化粧台のW2・W3（mm。古い保存には無い） */
  width2?: string;
  width3?: string;
  height: string;
  depth: string;
  /** 数量 */
  quantity: string;
  unit: string;
  descriptionUpper: string;
  remarksLower: string;
  detail: FurnitureDetail;
  /** タテ方向の明細（列）ごとの数量。計算式でも入れられる */
  values: Record<string, string>;
}

export interface FurnitureSheetData {
  rows: FurnitureRow[];
  settings: FurnitureSettings;
  /** タテ方向の明細（列） */
  columns?: FurnitureColumn[];
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

/** 計算書（表）の種類。設定の基準（全物件共通）はこの種類ごとに持つ */
export const FURNITURE_KINDS: { key: string; label: string }[] = [
  { key: "furniture", label: "家具（システム収納）" },
  { key: "kitchen", label: "システムキッチン" },
  { key: "washstand", label: "洗面化粧台" },
  { key: "other", label: "その他の設備" },
];

export function furnitureKindLabel(kind: string): string {
  return FURNITURE_KINDS.find((item) => item.key === kind)?.label ?? kind;
}

/** システムキッチン・洗面化粧台はW欄がW1・W2・W3の3つ */
export function hasTripleWidth(kind: string): boolean {
  return kind === "kitchen" || kind === "washstand";
}

/** 建具表へ転記するのは家具（システム収納）の表だけ */
export function transfersToFittings(kind: string): boolean {
  return kind === "furniture";
}

/** システムキッチンの部位（部屋名）の記号の初めの並び */
export const defaultKitchenPartSymbols: FurnitureSymbol[] = [
  { symbol: "K", text: "キッチン" },
  { symbol: "LDK", text: "LDK" },
];

/** システムキッチンの名称の記号の初めの並び */
export const defaultKitchenNameSymbols: FurnitureSymbol[] = [
  { symbol: "S", text: "システムキッチン" },
  { symbol: "M", text: "ミニキッチン" },
  { symbol: "K", text: "キッチンセット" },
];

/** 洗面化粧台の部位（部屋名）の記号の初めの並び */
export const defaultWashstandPartSymbols: FurnitureSymbol[] = [
  { symbol: "S", text: "洗面脱衣室" },
  { symbol: "T", text: "トイレ" },
];

/** 洗面化粧台の名称の記号の初めの並び */
export const defaultWashstandNameSymbols: FurnitureSymbol[] = [
  { symbol: "S", text: "洗面化粧台" },
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
    width2Label: "+",
    width3Label: "+",
    lShapeLabel: "(L型)",
    uShapeLabel: "(コ型)",
    partSymbols: defaultPartSymbols.map((item) => ({ ...item })),
    nameSymbols: defaultNameSymbols.map((item) => ({ ...item })),
    ...patch,
  };
}

/** 計算書の種類ごとの初めの設定（基準が無いときに使う） */
export function furnitureSettingsFor(
  kind: string,
  patch: Partial<FurnitureSettings> = {},
): FurnitureSettings {
  if (kind === "kitchen")
    return furnitureSettings({
      partSymbols: defaultKitchenPartSymbols.map((item) => ({ ...item })),
      nameSymbols: defaultKitchenNameSymbols.map((item) => ({ ...item })),
      ...patch,
    });
  if (kind === "washstand")
    return furnitureSettings({
      partSymbols: defaultWashstandPartSymbols.map((item) => ({ ...item })),
      nameSymbols: defaultWashstandNameSymbols.map((item) => ({ ...item })),
      ...patch,
    });
  return furnitureSettings(patch);
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
    width2: "",
    width3: "",
    height: "",
    depth: "",
    quantity: "",
    unit: "",
    descriptionUpper: "",
    remarksLower: "",
    detail: furnitureDetail(),
    values: {},
    ...patch,
  };
}

/** 表を丸ごと写す（一覧のコピー・貼り付け用。行のidは付け直す） */
export function copyFurnitureRows(rows: FurnitureRow[]): FurnitureRow[] {
  return rows.map((row) => ({
    ...row,
    id: newId("fr"),
    detail: { ...row.detail, edited: [...row.detail.edited] },
    values: { ...(row.values ?? {}) },
  }));
}

export type FurniturePasteMode = "over" | "insert" | "append";

/**
 * コピーした行を貼り付ける（行のidは付け直す）。
 * over：at の行から順に上書き（足りない分は末尾へ足す）
 * insert：at の行の上へ挿入
 * append：最終行の下へ追加
 */
export function pasteFurnitureRows(
  rows: FurnitureRow[],
  at: number,
  copied: FurnitureRow[],
  mode: FurniturePasteMode,
): FurnitureRow[] {
  const pasted = copyFurnitureRows(copied);
  if (pasted.length === 0) return rows;
  const next = [...rows];
  if (mode === "append") return [...next, ...pasted];
  const start = Math.max(0, Math.min(at, next.length));
  next.splice(start, mode === "over" ? pasted.length : 0, ...pasted);
  return next;
}

/**
 * タテ方向の明細ごと写す（列のidも付け直し、数量の結び付きを写し先へ移す）。
 */
export function copyFurnitureSheetRows(
  rows: FurnitureRow[],
  columns: FurnitureColumn[],
): { rows: FurnitureRow[]; columns: FurnitureColumn[] } {
  const nextColumns = columns.map((column) => ({
    ...column,
    id: miscColumn().id,
  }));
  const columnIds = new Map(
    columns.map((column, index) => [column.id, nextColumns[index].id] as const),
  );
  return {
    columns: nextColumns,
    rows: copyFurnitureRows(rows).map((row) => ({
      ...row,
      values: Object.fromEntries(
        Object.entries(row.values ?? {}).flatMap(([columnId, value]) => {
          const moved = columnIds.get(columnId);
          return moved === undefined ? [] : [[moved, value] as const];
        }),
      ),
    })),
  };
}

/** 計算式の中のＷ・Ｈ・Ｄ（全角・小文字も）を変数名の W・H・D にそろえる */
export function sizeFormula(text: string): string {
  return text
    .replace(/[Ｗｗw]/g, "W")
    .replace(/[Ｈｈh]/g, "H")
    .replace(/[Ｄｄd]/g, "D");
}

/**
 * タテ方向の明細のマス1つ分の値。
 * 数字そのままでも計算式でもよく、計算式では行のW・H・D（mmをmに直したもの）が使える。
 */
export function furnitureCellValue(
  row: FurnitureRow,
  text: string,
): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/[ＷｗwＨｈhＤｄdWHD]/.test(trimmed)) return cellValue(trimmed);
  const computed = evaluateFormula(sizeFormula(trimmed), sizeVariables(row));
  return computed === null ? null : displayedValue(computed);
}

/**
 * タテ方向の明細のマス1つ分の計上数量＝マスの値 × その行の数量（家具の個数。未入力は上の行と同じ、無ければ1）。
 */
export function furnitureCellQuantity(
  row: FurnitureRow,
  resolved: FurnitureResolved,
  text: string,
): number | null {
  const value = furnitureCellValue(row, text);
  if (value === null) return null;
  const count = numberOf(resolved.quantity) ?? 1;
  return displayedValue(value * count);
}

/** タテ方向の明細（列）1本の合計（各行の値 × 数量を足したもの） */
export function furnitureColumnTotal(
  rows: FurnitureRow[],
  columnId: string,
): number {
  const resolved = resolveFurnitureRows(rows);
  return rows.reduce((sum, row, index) => {
    const value = furnitureCellQuantity(
      row,
      resolved[index],
      row.values?.[columnId] ?? "",
    );
    return value === null ? sum : displayedValue(sum + value);
  }, 0);
}

/** 記号の照合用（全角・半角・大文字・小文字・空白の違いは同じ記号とみなす） */
function symbolKey(text: string): string {
  return toHalfWidth(text).replace(/\s+/g, "").toUpperCase();
}

/** 記号を表示文字に置き換える（対応表に無いときは入れた文字のまま） */
export function symbolText(symbols: FurnitureSymbol[], text: string): string {
  const value = symbolKey(text);
  if (value === "") return "";
  const found = symbols.find((item) => symbolKey(item.symbol) === value);
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
  unit: string;
  formula: string;
}

/**
 * 上の行からの引き継ぎ。
 * 科目・部位ID・部位・数量・単位・計算式は未入力なら上の行と同じ、
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
    unit: "",
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
    if (row.unit.trim() !== "") carried.unit = row.unit;
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
  const width1 = row.width.trim();
  const width2 = (row.width2 ?? "").trim();
  const width3 = (row.width3 ?? "").trim();
  if (width1 !== "" || width2 !== "" || width3 !== "") {
    const shape =
      width3 !== ""
        ? settings.uShapeLabel
        : width2 !== ""
          ? settings.lShapeLabel
          : "";
    parts.push(
      `${settings.widthLabel}${width1}${
        width2 === "" ? "" : `${settings.width2Label}${width2}`
      }${width3 === "" ? "" : `${settings.width3Label}${width3}`}${shape}`,
    );
  }
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
    unit: resolved.unit,
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

/**
 * 手で直した明細欄を自動作成に戻す（keys を省くと行の全部の欄）。
 * 戻した欄は次の applyFurnitureDetails で入力欄と記号表から作り直される。
 */
export function revertFurnitureDetail(
  row: FurnitureRow,
  keys?: string[],
): FurnitureRow {
  const edited =
    keys === undefined
      ? []
      : row.detail.edited.filter((key) => !keys.includes(key));
  return { ...row, detail: { ...row.detail, edited } };
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

/** W1・W2・W3を合わせた幅（mm。どこにも無ければnull） */
export function totalWidth(row: FurnitureRow): number | null {
  const widths = [row.width, row.width2 ?? "", row.width3 ?? ""]
    .map((text) => numberOf(text))
    .filter((value): value is number => value !== null);
  if (widths.length === 0) return null;
  return widths.reduce((sum, value) => sum + value, 0);
}

/**
 * 計算式に使えるW・H・D（mに換算する）。
 * WはW1・W2・W3の合計で、W1・W2・W3もそれぞれ使える。
 */
export function sizeVariables(row: FurnitureRow): Record<string, number> {
  const width = totalWidth(row);
  const width1 = numberOf(row.width);
  const width2 = numberOf(row.width2 ?? "");
  const width3 = numberOf(row.width3 ?? "");
  const height = numberOf(row.height);
  const depth = numberOf(row.depth);
  return {
    W: width === null ? 0 : width / 1000,
    W1: width1 === null ? 0 : width1 / 1000,
    W2: width2 === null ? 0 : width2 / 1000,
    W3: width3 === null ? 0 : width3 / 1000,
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
    const value = evaluateFormula(sizeFormula(formula), sizeVariables(row));
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
  // タテ方向の明細（部位別雑・金物入力表と同じ形。ヨコの自動明細とは別に拾う）
  rows.forEach((row, index) => {
    (data.columns ?? []).forEach((column) => {
      if (isEmptyColumn(column)) return;
      const value = furnitureCellQuantity(
        row,
        resolved[index],
        row.values?.[column.id] ?? "",
      );
      if (value === null) return;
      entries.push({
        traceId: `furniturecol:${place.sheetId}:${row.id}:${column.id}`,
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
    const width = totalWidth(row);
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
