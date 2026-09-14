/**
 * 耐火被覆・塗装入力表（入力管理表＋柱入力表）。
 * 入力管理表の1行＝1明細。「柱」を選んだ行は柱入力表を持ち、
 * 数量は柱入力表の必要数㎡の合計×倍率で出る。
 */

import { evaluateFormula } from "../formula/evaluate";
import {
  resolveSize,
  type FireproofFloorList,
  type SteelShape,
} from "./fireproofList";

let estimateCounter = 0;
export function estimateId(prefix: string): string {
  estimateCounter += 1;
  return `${prefix}${Date.now().toString(36)}${estimateCounter}`;
}

/** 管理表の明細（部屋計算書下段と同じ並び。計算書の先頭行にも同じものを出す） */
export interface FireproofManageDetail {
  /** 区分（材種区分名） */
  materialCategory: string;
  /** 科目（工種科目のID） */
  subjectId: number | null;
  /** 部位ID（明細用部位の番号） */
  partNumber: number | null;
  /** 名称ID（明細番号） */
  detailNumber: number | null;
  /** 部位名 */
  partName: string;
  /** 名称 */
  name: string;
  /** 摘要（下段） */
  descriptionLower: string;
  /** 摘要（上段） */
  descriptionUpper: string;
  unit: string;
  /** 備考（下段） */
  remarksLower: string;
  /** 備考（上段） */
  remarksUpper: string;
}

/** 柱入力表の1行 */
export interface FireproofColumnRow {
  id: string;
  /** 階（鉄骨リストの階名に合わせる） */
  floor: string;
  comment: string;
  /** 部材記号（C1…。鉄骨リストの柱リストから寸法を拾う） */
  symbol: string;
  /** 倍数（この階に同じ柱が何本あるか） */
  count: number | null;
  /** 取合（耐火被覆を吹く面の数 1〜4） */
  faces: number | null;
  /** 計算式（有効長）。「3.42」や「3.42*2」のように書く */
  lengthFormula: string;
  /**
   * 断面必要計算式（手で直したときだけ入る。空なら自動で作る：
   * □は「Ｗ×面数＋厚さ×(面数−1)」。Ｈ形は取合対応表ができるまで手入力）
   */
  sectionFormula: string;
}

/** 柱入力表（管理表の1行が持つ） */
export interface FireproofColumnSheet {
  /** 耐火被覆厚（mm。25 → 断面の計算では0.025m） */
  thickness: number | null;
  rows: FireproofColumnRow[];
}

/** 積算範囲（今は柱のみ。梁型はあとで足す） */
export type FireproofScope = "column" | "";

/** 入力管理表の1行 */
export interface FireproofManageRow {
  id: string;
  /** 部位1（自由入力。空欄は上の行と同じ） */
  part1: string;
  /** 積算範囲（柱／あとで梁型・部位別入力表の汎用計算書も選べるようにする） */
  scope: FireproofScope;
  /** 倍率（未入力は1） */
  multiplier: number | null;
  detail: FireproofManageDetail;
  /** 柱を選んだ行の柱入力表 */
  sheet: FireproofColumnSheet;
}

export function emptyManageDetail(): FireproofManageDetail {
  return {
    materialCategory: "",
    subjectId: null,
    partNumber: null,
    detailNumber: null,
    partName: "",
    name: "",
    descriptionLower: "",
    descriptionUpper: "",
    unit: "",
    remarksLower: "",
    remarksUpper: "",
  };
}

export function newColumnRow(floor = "", symbol = ""): FireproofColumnRow {
  return {
    id: estimateId("r"),
    floor,
    comment: "",
    symbol,
    count: null,
    faces: null,
    lengthFormula: "",
    sectionFormula: "",
  };
}

export function newManageRow(): FireproofManageRow {
  return {
    id: estimateId("m"),
    part1: "",
    scope: "column",
    multiplier: null,
    detail: emptyManageDetail(),
    sheet: { thickness: null, rows: [] },
  };
}

export function normalizeManageRows(value: unknown): FireproofManageRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    id: typeof row?.id === "string" ? row.id : estimateId("m"),
    part1: row?.part1 ?? "",
    scope: row?.scope === "column" ? "column" : "",
    multiplier:
      typeof row?.multiplier === "number" || row?.multiplier === null
        ? row.multiplier
        : null,
    detail: { ...emptyManageDetail(), ...(row?.detail ?? {}) },
    sheet: {
      thickness: row?.sheet?.thickness ?? null,
      rows: Array.isArray(row?.sheet?.rows)
        ? row.sheet.rows.map((each: Partial<FireproofColumnRow>) => ({
            id: typeof each?.id === "string" ? each.id : estimateId("r"),
            floor: each?.floor ?? "",
            comment: each?.comment ?? "",
            symbol: each?.symbol ?? "",
            count: each?.count ?? null,
            faces: each?.faces ?? null,
            lengthFormula: each?.lengthFormula ?? "",
            sectionFormula: each?.sectionFormula ?? "",
          }))
        : [],
    },
  }));
}

/** 記号と階名から鉄骨リスト（柱）の寸法を探す。階名が合わないときは空を返す */
export function findColumnSize(
  list: FireproofFloorList,
  floor: string,
  symbol: string,
): {
  shape: SteelShape | "";
  first: number | null;
  second: number | null;
} | null {
  const member = list.members.find(
    (each) => each.symbol.trim() !== "" && each.symbol.trim() === symbol.trim(),
  );
  if (!member) return null;
  const index = list.floors.findIndex(
    (each) => each.label.trim() === floor.trim(),
  );
  if (index < 0) return null;
  return resolveSize(member, list.floors, index, "column");
}

/**
 * 断面必要計算式を自動で作る（mm→mに直して書く）。
 * □型：「Ｗ×面数＋厚さ×(面数−1)」（例 0.25*3+0.025*2）。
 * 面数1のときは厚さ分を足さない（例 0.25）。Ｈ形は取合対応表ができるまで自動では作らない。
 */
export function autoSectionFormula(
  shape: SteelShape | "",
  width: number | null,
  faces: number | null,
  thicknessMm: number | null,
): string {
  if (shape !== "box" || width === null || faces === null) return "";
  if (faces < 1 || faces > 4) return "";
  const w = width / 1000;
  const t = (thicknessMm ?? 0) / 1000;
  const parts = [`${w}*${faces}`];
  if (t > 0 && faces > 1)
    parts.push(faces - 1 === 1 ? `${t}` : `${t}*${faces - 1}`);
  return parts.join("+");
}

/** 柱入力表1行の計算結果 */
export interface FireproofColumnCalc {
  /** 断面必要計算式（手入力があればそれ、無ければ自動） */
  sectionText: string;
  /** 断面の計算結果（㎡あたりの係数。式が読めないときはnull） */
  section: number | null;
  /** 有効長の計算結果（m） */
  length: number | null;
  /** 必要数㎡ ＝ 断面×有効長×倍数 */
  needed: number | null;
  /** 壁取合m ＝ 有効長×取合の係数（4面は0、3・2・1面は2） */
  wall: number | null;
}

/** 取合（面数）ごとの壁取合の本数（4:0、3:2、2:2、1:2） */
export function wallFactor(faces: number | null): number {
  if (faces === null) return 0;
  return faces >= 4 ? 0 : 2;
}

export function calcColumnRow(
  row: FireproofColumnRow,
  list: FireproofFloorList,
  thicknessMm: number | null,
): FireproofColumnCalc {
  const size = findColumnSize(list, row.floor, row.symbol);
  const auto = autoSectionFormula(
    size?.shape ?? "",
    size?.first ?? null,
    row.faces,
    thicknessMm,
  );
  const sectionText =
    row.sectionFormula.trim() !== "" ? row.sectionFormula : auto;
  const section = evaluateFormula(sectionText);
  const length = evaluateFormula(row.lengthFormula);
  const count = row.count ?? 1;
  return {
    sectionText,
    section,
    length,
    needed:
      section !== null && length !== null ? section * length * count : null,
    wall: length !== null ? length * wallFactor(row.faces) : null,
  };
}

/** 柱入力表の合計（必要数㎡・壁取合m） */
export function columnSheetTotals(
  sheet: FireproofColumnSheet,
  list: FireproofFloorList,
): { needed: number | null; wall: number | null } {
  let needed = 0;
  let wall = 0;
  let hasNeeded = false;
  let hasWall = false;
  for (const row of sheet.rows) {
    const calc = calcColumnRow(row, list, sheet.thickness);
    if (calc.needed !== null) {
      needed += calc.needed;
      hasNeeded = true;
    }
    if (calc.wall !== null) {
      wall += calc.wall;
      hasWall = true;
    }
  }
  return { needed: hasNeeded ? needed : null, wall: hasWall ? wall : null };
}

/** 管理表の行の数量（柱入力表の必要数合計×倍率。計算書が無ければnull） */
export function manageRowQuantity(
  row: FireproofManageRow,
  list: FireproofFloorList,
): number | null {
  if (row.scope !== "column") return null;
  const totals = columnSheetTotals(row.sheet, list);
  if (totals.needed === null) return null;
  return totals.needed * (row.multiplier ?? 1);
}
