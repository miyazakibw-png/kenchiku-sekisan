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
  /** ハンガーパイプ用：形状（番号入力）の対応表（計上設定。例：1→(L型)。古い保存には無い） */
  shapeSymbols?: FurnitureSymbol[];
  /** ユニットバス用：加工手間(梁欠き)・(窓)の前後に付ける文字（古い保存には無い） */
  beamPrefix?: string;
  beamSuffix?: string;
  windowPrefix?: string;
  windowSuffix?: string;
  /** ユニットバス用：型番→床面積の計算式の換算表（symbol＝型番・text＝計算式。例：1418→1.5*1.9） */
  floorAreaTable?: FurnitureSymbol[];
  /** 行入力部の見出し文字（列のキー→出す文字。空欄ならもとの見出し。古い保存には無い） */
  columnLabels?: Record<string, string>;
  /** カーテン・ブラインド用：摘要下段「(AW1:W1720*H1000)部」の前の文字・記号と寸法の間の文字・後ろの文字（古い保存には無い） */
  fittingPrefix?: string;
  fittingSeparator?: string;
  fittingSuffix?: string;
  /** 建具明細作成表用：部位を分解して出すときアルファベットと数字以降の間に入れる文字（無いときは「-」。古い保存には無い） */
  partSeparator?: string;
  /** 建具明細作成表用：計算書（積算入力）から建具表へ転記された分を変換するか（無いときは変換する） */
  convertEstimate?: boolean;
  /** 建具明細作成表用：建具入力部に入れた分を変換するか（無いときは変換する。家具計算書からの転記分は常に変換しない） */
  convertManual?: boolean;
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
  /** ユニットバスの床面積の計算式（型番から自動、手入力があればそれ。計算式のFAになる。古い保存には無い） */
  floorFormula?: string;
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
  /** 部位Ⅰ（集計書での置き場所。建具明細作成表用。空欄なら上の行と同じ。古い保存には無い） */
  place?: string;
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
  /** ハンガーパイプの形状（番号。設定の形状の記号で文字に変える。古い保存には無い） */
  shape?: string;
  /** ユニットバスの型番（手入力。4桁の数字なら床面積の計算に使う。古い保存には無い） */
  model?: string;
  /** ユニットバスの加工手間(梁欠き)・(窓)（摘要上段に並べる。古い保存には無い） */
  beam?: string;
  window?: string;
  /** ユニットバスの床面積の計算式（手入力。空なら型番から自動。古い保存には無い） */
  floorFormula?: string;
  /** カーテン・ブラインドの建具記号（建具表からW・Hを呼び出す。古い保存には無い） */
  fittingSymbol?: string;
  /** 建具明細作成表：この行と取り合う建具表の行id（W・Hを相互に連動させる。古い保存には無い） */
  fittingId?: number;
  /** 数量 */
  quantity: string;
  unit: string;
  descriptionUpper: string;
  remarksLower: string;
  detail: FurnitureDetail;
  /** タテ方向の明細（列）ごとの数量。計算式でも入れられる */
  values: Record<string, string>;
}

/** 建具表の1行のうち、寸法の呼び出しに使う分（W・Hはm） */
export interface FittingSize {
  symbol: string;
  width: number | null;
  height: number | null;
}

export interface FurnitureSheetData {
  rows: FurnitureRow[];
  settings: FurnitureSettings;
  /** 計算書の種類（無ければ家具） */
  kind?: string;
  /** タテ方向の明細（列） */
  columns?: FurnitureColumn[];
  /** 建具表（カーテン・ブラインドの建具記号からW・Hを呼び出す） */
  fittings?: FittingSize[];
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
  { key: "shelf", label: "棚" },
  { key: "hanger", label: "ハンガーパイプ" },
  { key: "bath", label: "ユニットバス" },
  { key: "curtain", label: "カーテン・ブラインド" },
  { key: "other", label: "その他" },
];

export function furnitureKindLabel(kind: string): string {
  if (isFittingDetailSheet(kind)) return "建具明細作成表";
  return FURNITURE_KINDS.find((item) => item.key === kind)?.label ?? kind;
}

/** 家具（システム収納）・建具明細作成表・ユニットバス・カーテン以外（システムキッチン・洗面化粧台・棚・ハンガーパイプ・その他）はW欄がW1・W2・W3の3つ */
export function hasTripleWidth(kind: string): boolean {
  return (
    kind !== "furniture" &&
    kind !== "bath" &&
    !isFittingDetailSheet(kind) &&
    !hasFittingSymbol(kind)
  );
}

/** カーテン・ブラインドはW・H・Dの代わりに建具記号を入れ、W・Hは建具表から呼び出す。部材名称は上の行を引き継ぐ */
export function hasFittingSymbol(kind: string): boolean {
  return kind === "curtain";
}

/** ユニットバスはW・Dの代わりに型番、摘要上段は加工手間(梁欠き)・(窓)の2欄、床面積計算（FA）を持つ */
export function hasModel(kind: string): boolean {
  return kind === "bath";
}

/** ハンガーパイプはDの欄の代わりに形状（番号）を入れる */
export function hasShape(kind: string): boolean {
  return kind === "hanger";
}

/** 建具表へ転記するのは家具（システム収納）の表だけ */
export function transfersToFittings(kind: string): boolean {
  return kind === "furniture";
}

/** 建具明細作成表の種類（建具表から作る1工事1枚の表。家具・設備入力表の一覧には出さない） */
export const FITTING_DETAIL_KIND = "fittingDetail";

/** 建具明細作成表か（1工事に1枚。建具表の行と取り合う） */
export function isFittingDetailSheet(kind: string): boolean {
  return kind === FITTING_DETAIL_KIND;
}

/** 建具明細作成表の名称（記号入力。組み合わせて使える）の初めの並び */
export const defaultFittingDetailNameSymbols: FurnitureSymbol[] = [
  { symbol: "D", text: "ドア" },
  { symbol: "M", text: "窓" },
  { symbol: "S", text: "シャッター" },
  { symbol: "KB", text: "片開き" },
  { symbol: "OB", text: "親子開き" },
  { symbol: "RB", text: "両開き" },
  { symbol: "HI", text: "引き違い" },
  { symbol: "SD", text: "外倒し" },
  { symbol: "SDR", text: "外倒し連" },
];

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

/** 棚の部位（部屋名）の記号の初めの並び */
export const defaultShelfPartSymbols: FurnitureSymbol[] = [
  { symbol: "K", text: "キッチン" },
  { symbol: "S", text: "洗面脱衣室" },
  { symbol: "T", text: "トイレ" },
];

/** 棚の名称の記号の初めの並び */
export const defaultShelfNameSymbols: FurnitureSymbol[] = [
  { symbol: "T", text: "棚" },
  { symbol: "K", text: "可動棚" },
  { symbol: "H", text: "枕棚" },
];

/** ハンガーパイプの形状の記号の初めの並び（計上設定） */
export const defaultHangerShapeSymbols: FurnitureSymbol[] = [
  { symbol: "1", text: "(L型)" },
  { symbol: "2", text: "(十型)" },
  { symbol: "3", text: "(キ型)" },
  { symbol: "4", text: "(T型)" },
  { symbol: "5", text: "(TT型)" },
];

/** ハンガーパイプの名称の記号の初めの並び */
export const defaultHangerNameSymbols: FurnitureSymbol[] = [
  { symbol: "H", text: "ハンガーパイプ" },
];

/** ユニットバスの部位の記号の初めの並び */
export const defaultBathPartSymbols: FurnitureSymbol[] = [
  { symbol: "B", text: "浴室" },
];

/** ユニットバスの名称の記号の初めの並び */
export const defaultBathNameSymbols: FurnitureSymbol[] = [
  { symbol: "UB", text: "ユニットバス" },
];

/** ユニットバスの型番→床面積の計算式の初めの並び（表に無い型番は上2桁・下2桁を/10して+0.1） */
export const defaultFloorAreaTable: FurnitureSymbol[] = [
  { symbol: "1418", text: "1.5*1.9" },
];

/** その他の名称の記号の初めの並び */
export const defaultOtherNameSymbols: FurnitureSymbol[] = [
  { symbol: "S", text: "設備" },
];

/** カーテン・ブラインドの部材名称の記号の初めの並び */
export const defaultCurtainNameSymbols: FurnitureSymbol[] = [
  { symbol: "B", text: "ブラインド" },
  { symbol: "C", text: "カーテン" },
  { symbol: "R", text: "ロールスクリーン" },
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
  if (kind === "shelf")
    return furnitureSettings({
      partSymbols: defaultShelfPartSymbols.map((item) => ({ ...item })),
      nameSymbols: defaultShelfNameSymbols.map((item) => ({ ...item })),
      ...patch,
    });
  if (kind === "other")
    return furnitureSettings({
      partSymbols: defaultShelfPartSymbols.map((item) => ({ ...item })),
      nameSymbols: defaultOtherNameSymbols.map((item) => ({ ...item })),
      ...patch,
    });
  if (kind === "bath")
    return furnitureSettings({
      partSymbols: defaultBathPartSymbols.map((item) => ({ ...item })),
      nameSymbols: defaultBathNameSymbols.map((item) => ({ ...item })),
      beamPrefix: "",
      beamSuffix: "",
      windowPrefix: "(",
      windowSuffix: ")",
      floorAreaTable: defaultFloorAreaTable.map((item) => ({ ...item })),
      ...patch,
    });
  if (kind === "hanger")
    return furnitureSettings({
      partSymbols: defaultShelfPartSymbols.map((item) => ({ ...item })),
      nameSymbols: defaultHangerNameSymbols.map((item) => ({ ...item })),
      shapeSymbols: defaultHangerShapeSymbols.map((item) => ({ ...item })),
      ...patch,
    });
  if (isFittingDetailSheet(kind))
    return furnitureSettings({
      partSuffix: "",
      addPrefix: "",
      addSuffix: "",
      widthLabel: "W",
      heightLabel: "*H",
      depthLabel: "*見込",
      partSymbols: [],
      nameSymbols: defaultFittingDetailNameSymbols.map((item) => ({
        ...item,
      })),
      partSeparator: "-",
      ...patch,
    });
  if (hasFittingSymbol(kind))
    return furnitureSettings({
      partSuffix: "F",
      addPrefix: "",
      addSuffix: "",
      widthLabel: "W",
      heightLabel: "*H",
      partSymbols: [],
      nameSymbols: defaultCurtainNameSymbols.map((item) => ({ ...item })),
      fittingPrefix: "(",
      fittingSeparator: ":",
      fittingSuffix: ")部",
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
    place: "",
    part: "",
    partAdd: "",
    partSymbol: "",
    nameSymbol: "",
    width: "",
    width2: "",
    width3: "",
    height: "",
    depth: "",
    shape: "",
    model: "",
    beam: "",
    window: "",
    floorFormula: "",
    fittingSymbol: "",
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

/** 計算式の中のＷ・Ｈ・Ｄ・ＦＡ（全角・小文字も）を変数名の W・H・D・FA にそろえる */
export function sizeFormula(text: string): string {
  return text
    .replace(/[FfＦｆ][AaＡａ]/g, "FA")
    .replace(/[Ｗｗw]/g, "W")
    .replace(/[Ｈｈh]/g, "H")
    .replace(/[Ｄｄd]/g, "D");
}

/**
 * タテ方向の明細のマス1つ分の値。
 * 数字そのままでも計算式でもよく、計算式では行のW・H・D（mmをmに直したもの）が使える。
 */
/** 「-」だけの欄は「計算なし」（半角の - ・全角の ー ― − － など） */
export const NO_CALC_CELL = /^[-−－ー―‐‑‒–—]+$/u;

export function furnitureCellValue(
  row: FurnitureRow,
  text: string,
): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  // 計算なし：何も計算しない。建具明細作成表では「-」が式の引き継ぎ元にもなる
  if (NO_CALC_CELL.test(trimmed)) return null;
  if (!/[ＷｗwＨｈhＤｄdWHD]|[FfＦｆ][AaＡａ]/.test(trimmed))
    return cellValue(trimmed);
  const computed = evaluateFormula(sizeFormula(trimmed), sizeVariables(row));
  return computed === null ? null : displayedValue(computed);
}

/**
 * タテ方向の明細のマス1つ分の計上数量＝マスの値 × その行の数量（家具の個数。未入力は1）。
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

/**
 * タテ方向の明細（列）のマス1行分の式（上から順に）。
 * 建具明細作成表は空欄の行を上の行と同じ式とみなす（未入力可）。
 */
export function columnCellTexts(
  rows: FurnitureRow[],
  columnId: string,
  kind = "furniture",
): string[] {
  if (!isFittingDetailSheet(kind))
    return rows.map((row) => row.values?.[columnId] ?? "");
  let carried = "";
  return rows.map((row) => {
    const text = row.values?.[columnId] ?? "";
    if (text.trim() === "") return carried;
    carried = text;
    return text;
  });
}

/** タテ方向の明細（列）1本の合計（各行の値 × 数量を足したもの） */
export function furnitureColumnTotal(
  rows: FurnitureRow[],
  columnId: string,
  kind = "furniture",
): number {
  const resolved = resolveFurnitureRows(rows, kind);
  const texts = columnCellTexts(rows, columnId, kind);
  return rows.reduce((sum, row, index) => {
    const value = furnitureCellQuantity(row, resolved[index], texts[index]);
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

/**
 * 名称の記号の置き換え（建具明細作成表）。
 * 登録した記号そのままならその文字。記号を並べて入れたときは、頭からいちばん長い記号で
 * 切って文字をつなげる（例：KB→片開き・D→ドアのとき、KBD→片開きドア）。
 * 組み合わせと同じ並びの登録記号があるときは、登録記号が優先（完全一致だけ見る）。
 */
export function composedSymbolText(
  symbols: FurnitureSymbol[],
  text: string,
): string {
  const key = symbolKey(text);
  if (key === "") return "";
  const exact = symbols.find((item) => symbolKey(item.symbol) === key);
  if (exact !== undefined) return exact.text;
  const table = symbols
    .map((item) => ({ key: symbolKey(item.symbol), text: item.text }))
    .filter((item) => item.key !== "")
    .sort((a, b) => b.key.length - a.key.length);
  let rest = key;
  let result = "";
  while (rest.length > 0) {
    const hit = table.find((item) => rest.startsWith(item.key));
    if (hit === undefined) {
      result += rest[0];
      rest = rest.slice(1);
      continue;
    }
    result += hit.text;
    rest = rest.slice(hit.key.length);
  }
  return result;
}

/**
 * 部位の記号の置き換え（建具明細作成表）。
 * 登録は「アルファベット+[]+数字」（例：Y[]→洋間[]）。入力はアルファベットと数字の間に
 * 「-」等を入れても同じ変換（Y-1・Y1どちらも→洋間1）。[]に数字が入る。
 * 対応表に無いときは入れた文字のまま。
 */
export function patternSymbolText(
  symbols: FurnitureSymbol[],
  text: string,
  separator = "-",
): string {
  const key = symbolKey(text);
  if (key === "") return "";
  const exact = symbols.find((item) => symbolKey(item.symbol) === key);
  if (exact !== undefined) return exact.text;
  // 部位の記号は「最初のアルファベット＋数字以降の残り全部」に分ける（間の「-」等は無視。AW3A→AW+3A）
  const matched = /^([A-Z]+)[^A-Z0-9]*([0-9].*)$/.exec(key);
  if (matched === null) return text;
  const [, prefix, rest] = matched;
  const found = symbols.find(
    (item) => symbolKey(item.symbol) === `${prefix}[]`,
  );
  if (found !== undefined)
    return found.text.includes("[]")
      ? found.text.replace("[]", rest)
      : `${found.text}${rest}`;
  // 表に無いときは分解した記号をそのまま部位にする（AW3A→AW-3A。間の文字は設定で変えられる）
  return `${prefix}${separator}${rest}`;
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
  /** 部位Ⅰ（集計書での置き場所。建具明細作成表用。空欄なら上の行と同じ） */
  place: string;
  part: string;
  /** 名称（部材名称）。カーテン・ブラインドだけ未入力なら上の行と同じ */
  nameSymbol: string;
  quantity: string;
  unit: string;
  formula: string;
}

/**
 * 上の行からの引き継ぎ。
 * 科目・部位ID・部位Ⅰ・計算式は未入力なら上の行と同じ、
 * 名称IDは未入力なら上の行＋0.01。
 * 名称（部材名称）は kind がカーテン・ブラインドのときだけ上の行と同じ。
 * 部位・数量・単位は引き継がない（空欄のまま残せる。見出しだけの行にも使える）。
 */
export function resolveFurnitureRows(
  rows: FurnitureRow[],
  kind = "furniture",
): FurnitureResolved[] {
  const carriesName = hasFittingSymbol(kind);
  const carried: FurnitureResolved = {
    subjectId: null,
    partNumber: null,
    detailNumber: null,
    place: "",
    part: "",
    nameSymbol: "",
    quantity: "",
    unit: "",
    formula: "",
  };
  // 名称IDの自動増え方。建具明細作成表は+1、家具（システム収納）ほかは+0.01
  const step = isFittingDetailSheet(kind) ? 1 : 0.01;
  const bump = (value: number): number =>
    step === 1 ? value + 1 : Math.round((value + step) * 100) / 100;
  return rows.map((row) => {
    if (row.subjectId !== null) carried.subjectId = row.subjectId;
    if (row.partNumber !== null) carried.partNumber = row.partNumber;
    if (row.detailNumber !== null) carried.detailNumber = row.detailNumber;
    else if (carried.detailNumber !== null)
      carried.detailNumber = bump(carried.detailNumber);
    // 部位Ⅰ（置き場所）は空欄なら上の行と同じ
    if ((row.place ?? "").trim() !== "") carried.place = row.place ?? "";
    // 部位・数量・単位は引き継がない（空欄のまま残せる＝名称だけの見出し行にも使える）
    carried.part = row.part;
    if (!carriesName || row.nameSymbol.trim() !== "")
      carried.nameSymbol = row.nameSymbol;
    carried.quantity = row.quantity;
    carried.unit = row.unit;
    if (row.detail.formula.trim() !== "") carried.formula = row.detail.formula;
    return { ...carried };
  });
}

/** 建具記号で建具表を探す（全角・半角・大文字・小文字の違いは同じ記号とみなす） */
export function findFitting(
  fittings: FittingSize[],
  symbol: string,
): FittingSize | null {
  const key = symbolKey(symbol);
  if (key === "") return null;
  return fittings.find((item) => symbolKey(item.symbol) === key) ?? null;
}

/** m→mmの文字（建具表のW・Hを摘要に出す用。無ければ空） */
function mmText(value: number | null): string {
  return value === null ? "" : String(Math.round(value * 1000));
}

/**
 * カーテン・ブラインドの摘要下段：設定[(]＋建具記号＋設定[:]＋設定[W]＋建具W(mm)＋設定[*H]＋建具H(mm)＋設定[)部]。
 * 建具表に無い記号は記号だけ出す。
 */
export function fittingSizeText(
  row: FurnitureRow,
  settings: FurnitureSettings,
  fittings: FittingSize[],
): string {
  const symbol = (row.fittingSymbol ?? "").trim();
  if (symbol === "") return "";
  const found = findFitting(fittings, symbol);
  const size: string[] = [];
  if (found?.width !== null && found?.width !== undefined)
    size.push(`${settings.widthLabel}${mmText(found.width)}`);
  if (found?.height !== null && found?.height !== undefined)
    size.push(`${settings.heightLabel}${mmText(found.height)}`);
  return `${settings.fittingPrefix ?? ""}${symbol}${
    size.length === 0
      ? ""
      : `${settings.fittingSeparator ?? ""}${size.join("")}`
  }${settings.fittingSuffix ?? ""}`;
}

/** 形状（番号入力）を設定の文字にする（ハンガーパイプ。表に無い番号はそのまま。設定に表が無ければ初めの並び） */
export function shapeText(
  row: FurnitureRow,
  settings: FurnitureSettings,
): string {
  return symbolText(
    settings.shapeSymbols ?? defaultHangerShapeSymbols,
    row.shape ?? "",
  );
}

/** 型番→床面積の計算式（型番の中の4桁の数字で換算表を探し、無ければ上2桁・下2桁を/10して+0.1。例：UB1418→1.5*1.9） */
export function floorFormulaOfModel(
  model: string,
  settings: FurnitureSettings,
): string {
  const key = toHalfWidth(model).trim();
  if (key === "") return "";
  const table = settings.floorAreaTable ?? defaultFloorAreaTable;
  const lookup = (text: string): string | null => {
    const found = table.find(
      (item) => toHalfWidth(item.symbol).trim() === text,
    );
    return found ? found.text.trim() : null;
  };
  const exact = lookup(key);
  if (exact !== null) return exact;
  const digits = /\d{4}/.exec(key)?.[0];
  if (digits === undefined) return "";
  const byDigits = lookup(digits);
  if (byDigits !== null) return byDigits;
  const side = (text: string): string => (Number(text) / 10 + 0.1).toFixed(1);
  return `${side(digits.slice(0, 2))}*${side(digits.slice(2))}`;
}

/** 1行の床面積の計算式（手入力があればそれ、無ければ型番から） */
export function floorFormulaOf(
  row: FurnitureRow,
  settings: FurnitureSettings,
): string {
  const manual = (row.floorFormula ?? "").trim();
  if (manual !== "") return manual;
  return floorFormulaOfModel(row.model ?? "", settings);
}

/** 床面積（m²。式が無い・計算できないときはnull） */
export function floorAreaOf(formula: string): number | null {
  const trimmed = formula.trim();
  if (trimmed === "") return null;
  const value = evaluateFormula(trimmed);
  return value === null ? null : displayedValue(value);
}

/** ユニットバスの摘要上段（加工手間(梁欠き)・(窓)に設定の前後文字を付けて並べる） */
export function bathUpperText(
  row: FurnitureRow,
  settings: FurnitureSettings,
): string {
  const parts: string[] = [];
  const beam = (row.beam ?? "").trim();
  if (beam !== "")
    parts.push(
      `${settings.beamPrefix ?? ""}${beam}${settings.beamSuffix ?? ""}`,
    );
  const win = (row.window ?? "").trim();
  if (win !== "")
    parts.push(
      `${settings.windowPrefix ?? ""}${win}${settings.windowSuffix ?? ""}`,
    );
  return parts.join("");
}

/** W・H・Dを摘要下段の文字にする（例：W1200*H1100*D400）。ユニットバスは型番をそのまま出す。
 * ハンガーパイプはDを出さず、W2/W3の(L型)(コ型)も付けず、末尾に形状の文字を付ける */
export function sizeText(
  row: FurnitureRow,
  settings: FurnitureSettings,
  kind = "furniture",
  fittings: FittingSize[] = [],
): string {
  if (hasModel(kind)) return (row.model ?? "").trim();
  if (hasFittingSymbol(kind)) return fittingSizeText(row, settings, fittings);
  const withShape = hasShape(kind);
  const parts: string[] = [];
  const width1 = row.width.trim();
  const width2 = (row.width2 ?? "").trim();
  const width3 = (row.width3 ?? "").trim();
  const shapeLabel = withShape ? shapeText(row, settings) : "";
  if (width1 !== "" || width2 !== "" || width3 !== "") {
    const shape = withShape
      ? ""
      : width3 !== ""
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
  if (!withShape && row.depth.trim() !== "")
    parts.push(`${settings.depthLabel}${row.depth.trim()}`);
  if (shapeLabel !== "") parts.push(shapeLabel);
  return parts.join("");
}

/** 部位欄の文字（部位＋設定文字／+部位＋設定文字／+部位の記号）。建具明細作成表は部位欄が1つ（アルファベット+[]+数字で変換） */
export function partText(
  row: FurnitureRow,
  resolved: FurnitureResolved,
  settings: FurnitureSettings,
  kind = "furniture",
): string {
  const parts: string[] = [];
  const part = resolved.part.trim();
  if (part !== "")
    parts.push(
      `${settings.partPrefix}${isFittingDetailSheet(kind) ? patternSymbolText(settings.partSymbols, part, settings.partSeparator ?? "-") : part}${settings.partSuffix}`,
    );
  // 建具明細作成表の部位欄は1つだけ（+部位・+部位の記号は無い）
  if (!isFittingDetailSheet(kind)) {
    const add = row.partAdd.trim();
    if (add !== "")
      parts.push(`${settings.addPrefix}${add}${settings.addSuffix}`);
    const symbol = symbolText(settings.partSymbols, row.partSymbol);
    if (symbol !== "") parts.push(symbol);
  }
  return parts.join("");
}

/** 明細欄を自動で作る（手で直した欄はそのまま残す） */
export function buildDetail(
  row: FurnitureRow,
  resolved: FurnitureResolved,
  settings: FurnitureSettings,
  kind = "furniture",
  fittings: FittingSize[] = [],
): FurnitureDetail {
  const auto: FurnitureDetail = {
    ...row.detail,
    subjectId: resolved.subjectId,
    partNumber: resolved.partNumber,
    detailNumber: resolved.detailNumber,
    partName: partText(row, resolved, settings, kind),
    name: isFittingDetailSheet(kind)
      ? composedSymbolText(settings.nameSymbols, resolved.nameSymbol)
      : symbolText(settings.nameSymbols, resolved.nameSymbol),
    descriptionUpper: hasModel(kind)
      ? bathUpperText(row, settings)
      : row.descriptionUpper,
    descriptionLower: sizeText(row, settings, kind, fittings),
    floorFormula: hasModel(kind) ? floorFormulaOf(row, settings) : undefined,
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

/**
 * 入力欄から明細欄を作り直す。
 * カーテン・ブラインドは建具記号で建具表から呼び出したW・H（mm）を行のW・Hにも写す（計算式・タテ明細で使えるように）。
 */
export function applyFurnitureDetails(
  rows: FurnitureRow[],
  settings: FurnitureSettings,
  kind = "furniture",
  fittings: FittingSize[] = [],
): FurnitureRow[] {
  const resolved = resolveFurnitureRows(rows, kind);
  const withFitting = hasFittingSymbol(kind);
  return rows.map((row, index) => {
    const found = withFitting
      ? findFitting(fittings, row.fittingSymbol ?? "")
      : null;
    const sized = withFitting
      ? {
          ...row,
          width: mmText(found?.width ?? null),
          width2: "",
          width3: "",
          height: mmText(found?.height ?? null),
        }
      : row;
    return {
      ...sized,
      detail: buildDetail(sized, resolved[index], settings, kind, fittings),
    };
  });
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
  const floorArea = floorAreaOf(row.detail.floorFormula ?? "");
  return {
    FA: floorArea === null ? 0 : floorArea,
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
 * 計算式（W・H・Dが使える）があればその結果、無ければ数量欄。
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
  const rows = applyFurnitureDetails(
    data.rows,
    data.settings,
    data.kind,
    data.fittings ?? [],
  );
  const resolved = resolveFurnitureRows(rows, data.kind);
  const multiplier = place.multiplier === 0 ? 1 : place.multiplier;
  // 建具明細作成表：部位Ⅰ（置き場所）は行ごとの入力、根拠の部屋は行の記号（部位欄）
  const fittingDetail = isFittingDetailSheet(data.kind ?? "furniture");
  const entries: AggregateEntry[] = [];
  rows.forEach((row, index) => {
    const quantity = rowQuantity(row, resolved[index]);
    if (quantity === null) {
      // 科目・部位ID・名称ID・部材名称のどれかを入れた行は、見出し用に数量0で計上する
      // （上行から引き継いだだけの行は数えない。手で直した明細欄のある行は数える）
      const heading =
        row.subjectId !== null ||
        row.partNumber !== null ||
        row.detailNumber !== null ||
        row.nameSymbol.trim() !== "" ||
        row.detail.edited.length > 0;
      if (!heading) return;
    } else if (isEmptyDetail(row.detail)) {
      return;
    }
    const value = quantity ?? 0;
    entries.push({
      traceId: `furniture:${place.sheetId}:${row.id}`,
      sourceKind: "furniture",
      estimateRowId: null,
      transferRowId: null,
      part1: fittingDetail ? resolved[index].place : place.part1,
      part2: place.part2Split ? place.part2 : "",
      part2Raw: place.part2,
      part2Split: place.part2Split,
      part2Order: part2Order.get(place.part2) ?? 0,
      part3: fittingDetail ? resolved[index].part : place.part3,
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
      includeInRooms: fittingDetail ? true : undefined,
      roomCount: fittingDetail
        ? (numberOf(resolved[index].quantity) ?? 1)
        : undefined,
    });
  });
  // タテ方向の明細（部位別雑・金物入力表と同じ形。ヨコの自動明細とは別に拾う）
  const columnTexts = new Map<string, string[]>();
  (data.columns ?? []).forEach((column) => {
    columnTexts.set(column.id, columnCellTexts(rows, column.id, data.kind));
  });
  rows.forEach((row, index) => {
    (data.columns ?? []).forEach((column) => {
      if (isEmptyColumn(column)) return;
      const value = furnitureCellQuantity(
        row,
        resolved[index],
        columnTexts.get(column.id)?.[index] ?? "",
      );
      if (value === null) return;
      entries.push({
        traceId: `furniturecol:${place.sheetId}:${row.id}:${column.id}`,
        sourceKind: "furniture",
        estimateRowId: null,
        transferRowId: null,
        part1: fittingDetail ? resolved[index].place : place.part1,
        part2: place.part2Split ? place.part2 : "",
        part2Raw: place.part2,
        part2Split: place.part2Split,
        part2Order: part2Order.get(place.part2) ?? 0,
        part3: fittingDetail ? resolved[index].part : place.part3,
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
        includeInRooms: fittingDetail ? true : undefined,
        roomCount: fittingDetail
          ? (numberOf(resolved[index].quantity) ?? 1)
          : undefined,
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

/** 建具明細作成表の行が取り合う建具表の1行（W・Hはm。idで結び付ける） */
export interface FittingLink {
  id: number;
  symbol: string;
  name: string;
  width: number | null;
  height: number | null;
  /** 1: 積算入力（計算書）から登録した行 */
  fromEstimate: number;
  /** 1: 家具計算書から自動転記した行（建具明細作成表の変換対象にしない） */
  fromFurniture: number;
}

/** 建具明細作成表で変換する建具表の行（家具転記分は対象外。計算書転記分・建具入力部は設定で選ぶ） */
export interface FittingConvertInclude {
  estimate: boolean;
  manual: boolean;
}

/** その建具表の行を建具明細作成表へ変換するか */
export function isConvertibleFitting(
  fitting: FittingLink,
  include: FittingConvertInclude,
): boolean {
  if (fitting.fromFurniture !== 0) return false;
  return fitting.fromEstimate !== 0 ? include.estimate : include.manual;
}

/** m→mmの文字（小数点以下は自由。例：1.15225m→1152.25mm） */
export function mmPreciseText(value: number | null): string {
  return value === null ? "" : String(Math.round(value * 1000 * 1000) / 1000);
}

/**
 * 建具明細作成表の行を建具表と取り合う。
 * ・変換対象（計算書転記分・建具入力部。家具転記分は対象外）に結び付いた行は、
 *   建具表の記号・W・Hで更新（W・Hはmm表示＝建具のm×1000、小数点以下自由）。
 * ・対象外になった行は取り合いを保ったままそのまま（再度対象にすると連動が戻る）。
 * ・建具表に増えた分は新しい行として下へ足す（部位＝記号・名称＝名称欄・W・Hを転記）。
 * ・建具表で消えた行は取り合いだけ外す（行は消さない）。
 */
export function syncFittingDetailRows(
  rows: FurnitureRow[],
  fittings: FittingLink[],
  include: FittingConvertInclude = { estimate: true, manual: true },
): FurnitureRow[] {
  const allById = new Map(fittings.map((fitting) => [fitting.id, fitting]));
  const byId = new Map(
    fittings
      .filter((fitting) => isConvertibleFitting(fitting, include))
      .map((fitting) => [fitting.id, fitting]),
  );
  const linked = new Set(
    rows
      .map((row) => row.fittingId)
      .filter((id): id is number => id !== undefined),
  );
  const next = rows.map((row) => {
    if (row.fittingId === undefined) return row;
    const fitting = byId.get(row.fittingId);
    if (fitting !== undefined)
      return {
        ...row,
        part: fitting.symbol,
        width: mmPreciseText(fitting.width),
        height: mmPreciseText(fitting.height),
      };
    if (allById.has(row.fittingId)) return row;
    const { fittingId: _fittingId, ...rest } = row;
    return rest as FurnitureRow;
  });
  const appended = [...byId.values()]
    .filter((fitting) => !linked.has(fitting.id))
    .map((fitting) =>
      furnitureRow({
        fittingId: fitting.id,
        part: fitting.symbol,
        nameSymbol: fitting.name,
        width: mmPreciseText(fitting.width),
        height: mmPreciseText(fitting.height),
      }),
    );
  return [...next, ...appended];
}
