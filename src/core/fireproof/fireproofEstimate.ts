/**
 * 耐火被覆・塗装入力表（入力管理表＋柱入力表）。
 * 入力管理表の1行＝1明細。「柱」を選んだ行は柱入力表を持ち、
 * 数量は柱入力表の必要数㎡の合計×倍率で出る。
 */

import type { AggregateEntry } from "../aggregate/aggregate";
import { displayedValue } from "../room/calcSheet";
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
  /** 取合（面数 1〜4 または取合記号 H1〜H4・HA3・HA4 など。文字で保存する） */
  mark: string;
  /** 計算式（有効長）。「3.42」や「3.42*2」のように書く */
  lengthFormula: string;
  /**
   * 断面必要計算式（手で直したときだけ入る。空なら自動で作る：
   * □は「Ｗ×面数＋厚さ×(面数−1)」。Ｈ形は取合対応表ができるまで手入力）
   */
  sectionFormula: string;
  /** 壁取合mをどの欄（Ａ・Ｂ・Ｃ）に入れるかの✔ */
  wallChecks: boolean[];
}

/** 壁取合mを分ける欄の数（柱＝Ａ・Ｂ・Ｃの3こ、梁型＝Ａ・Ｂ・Ｃ・Ｄの4こ） */
export const WALL_MARK_COUNT = 3;
export const BEAM_MARK_COUNT = 4;

/** 壁取合・床取合の欄の見出し（書き換えられる。数を増やせる） */
export function defaultWallLabels(count = WALL_MARK_COUNT): string[] {
  return ["Ａ", "Ｂ", "Ｃ", "Ｄ"].slice(0, count);
}

/** ✔の並びを欄の数にそろえる */
function normalizeWallChecks(value: unknown, count: number): boolean[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from(
    { length: count },
    (_unused, index) => list[index] === true,
  );
}

/** 見出しの並びを欄の数にそろえる（空欄は既定のＡ・Ｂ・Ｃ…） */
export function normalizeWallLabels(
  value: unknown,
  count = WALL_MARK_COUNT,
): string[] {
  const list = Array.isArray(value) ? value : [];
  const defaults = defaultWallLabels(count);
  return defaults.map((label, index) =>
    typeof list[index] === "string" && list[index].trim() !== ""
      ? list[index]
      : label,
  );
}

/** 柱入力表・梁型入力表（管理表の1行が持つ） */
export interface FireproofColumnSheet {
  /** 耐火被覆厚（mm。25 → 断面の計算では0.025m） */
  thickness: number | null;
  /** 壁取合mを分ける3欄の見出し（既定Ａ・Ｂ・Ｃ） */
  wallLabels: string[];
  rows: FireproofColumnRow[];
}

/** 積算範囲（自由文字。「柱」は柱入力表を持つ。梁型はあとで足す） */
export type FireproofScope = string;

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
  /** 柱入力表 */
  sheet: FireproofColumnSheet;
  /** 梁型入力表（床取合はＡ〜Ｄの4欄） */
  beamSheet: FireproofColumnSheet;
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
    mark: "",
    lengthFormula: "",
    sectionFormula: "",
    wallChecks: normalizeWallChecks([], WALL_MARK_COUNT),
  };
}

/** 梁型入力表の1行を作る（床取合の✔は4こ） */
export function newBeamRow(floor = "", symbol = ""): FireproofColumnRow {
  return {
    ...newColumnRow(floor, symbol),
    wallChecks: normalizeWallChecks([], BEAM_MARK_COUNT),
  };
}

export function newManageRow(): FireproofManageRow {
  return {
    id: estimateId("m"),
    part1: "",
    scope: "柱",
    multiplier: null,
    detail: emptyManageDetail(),
    sheet: { thickness: null, wallLabels: defaultWallLabels(), rows: [] },
    beamSheet: {
      thickness: null,
      wallLabels: defaultWallLabels(BEAM_MARK_COUNT),
      rows: [],
    },
  };
}

/** 柱入力表または梁型入力表を保存した中身から整える */
function normalizeSheet(
  value: unknown,
  markCount: number,
): FireproofColumnSheet {
  const sheet = (value ?? {}) as Partial<FireproofColumnSheet>;
  return {
    thickness: sheet?.thickness ?? null,
    wallLabels: normalizeWallLabels(sheet?.wallLabels, markCount),
    rows: Array.isArray(sheet?.rows)
      ? sheet.rows.map(
          (each: Partial<FireproofColumnRow> & { faces?: number }) => ({
            id: typeof each?.id === "string" ? each.id : estimateId("r"),
            floor: each?.floor ?? "",
            comment: each?.comment ?? "",
            symbol: each?.symbol ?? "",
            count: each?.count ?? null,
            mark:
              typeof each?.mark === "string"
                ? each.mark
                : typeof each?.faces === "number"
                  ? String(each.faces)
                  : "",
            lengthFormula: each?.lengthFormula ?? "",
            sectionFormula: each?.sectionFormula ?? "",
            wallChecks: normalizeWallChecks(each?.wallChecks, markCount),
          }),
        )
      : [],
  };
}

export function normalizeManageRows(value: unknown): FireproofManageRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    id: typeof row?.id === "string" ? row.id : estimateId("m"),
    part1: row?.part1 ?? "",
    scope:
      row?.scope === "column"
        ? "柱"
        : typeof row?.scope === "string"
          ? row.scope
          : "",
    multiplier:
      typeof row?.multiplier === "number" || row?.multiplier === null
        ? row.multiplier
        : null,
    detail: { ...emptyManageDetail(), ...(row?.detail ?? {}) },
    sheet: normalizeSheet(row?.sheet, WALL_MARK_COUNT),
    beamSheet: normalizeSheet(row?.beamSheet, BEAM_MARK_COUNT),
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

/** 記号と階名から鉄骨リスト（梁）の寸法を探す。階名が合わないときは空を返す */
export function findBeamSize(
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
  return resolveSize(member, list.floors, index, "beam");
}

/** mmをmの文字にする（寸法は余りの0を消し、厚みは小数点3桁まで出す：25→0.025） */
function meterText(mm: number): string {
  return String(mm / 1000);
}

function thicknessText(mm: number): string {
  return (mm / 1000).toFixed(3);
}

/**
 * 取合の文字を面数（1〜4）に読み替える。
 * 柱は「1」〜「4」とＨ鋼の「H1」〜「H4」がそのままの面数。
 * 「HA3」「A3」は梁型側の取合記号（梁型計算書で使う。壁付き梁型）。
 * （あとの「取合対応表設定画面」で増やせるように表にしている）。
 */
const MARK_FACES: Record<string, number> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  H1: 1,
  H2: 2,
  H3: 3,
  H4: 4,
};

/** 柱の取合の文字を面数（1〜4）に読み替える（A3など梁型の記号は対象外） */
export function markFaces(mark: string): number | null {
  const key = mark.trim().toUpperCase();
  return MARK_FACES[key] ?? null;
}

/** 梁型の取合記号を面数に読み替える（HA3・A3は壁付き梁型で3面と同じ計算） */
export function beamMarkFaces(mark: string): number | null {
  const key = mark.trim().toUpperCase();
  const beamMarks: Record<string, number> = { HA3: 3, A3: 3 };
  return beamMarks[key] ?? markFaces(key);
}

/**
 * 断面必要計算式を自動で作る（mm→mに直して書く）。式は資料の図のとおり。
 * □（コラム・箱型）：4面 W*2+D*2+厚み*4、3面 W*2+D+厚み*2、2面 W+D+厚み、1面 D。
 * Ｈ鉄：4面 W*2+D*4+厚み*4、3面 W*2+D*3+厚み*2、2面 W+D+D/2*2+厚み、1面 D。
 * 厚みが未入力（または0以下）のときは自動で出さない。
 */
export function autoSectionFormula(
  shape: SteelShape | "",
  width: number | null,
  depth: number | null,
  faces: number | null,
  thicknessMm: number | null,
): string {
  if (width === null || depth === null || faces === null) return "";
  if (faces < 1 || faces > 4) return "";
  const w = meterText(width);
  const d = meterText(depth);
  // 壁囲い1面は厚みを使わない（Dのみ）
  if (faces === 1) return d;
  if (thicknessMm === null || thicknessMm <= 0) return "";
  const t = thicknessText(thicknessMm);
  if (shape === "h") {
    if (faces === 4) return `${w}*2+${d}*4+${t}*4`;
    if (faces === 3) return `${w}*2+${d}*3+${t}*2`;
    return `${w}+${d}+${d}/2*2+${t}`;
  }
  if (faces === 4) return `${w}*2+${d}*2+${t}*4`;
  if (faces === 3) return `${w}*2+${d}+${t}*2`;
  return `${w}+${d}+${t}`;
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

/** 入力表の種類（柱＝壁取合／梁型＝床取合） */
export type FireproofSheetKind = "column" | "beam";

/** 取合（面数）ごとの壁取合の本数（柱。4:0、3:2、2:2、1:2。記号は面数に読み替える） */
export function wallFactor(mark: string): number {
  const faces = markFaces(mark);
  if (faces === null) return 0;
  return faces >= 4 ? 0 : 2;
}

/** 取合ごとの床取合の本数（梁型。床につかない A3・HA3 と4面（H4）は0、それ以外は2） */
export function slabFactor(mark: string): number {
  const key = mark.trim().toUpperCase();
  if (key === "A3" || key === "HA3") return 0;
  const faces = beamMarkFaces(mark);
  if (faces === null) return 0;
  return faces >= 4 ? 0 : 2;
}

/** 入力表の1行を計算する（柱・梁型で共通。寸法・取合・取合の係数だけ種類で変わる） */
function calcSheetRow(
  row: FireproofColumnRow,
  list: FireproofFloorList,
  thicknessMm: number | null,
  kind: FireproofSheetKind,
): FireproofColumnCalc {
  const size =
    kind === "beam"
      ? findBeamSize(list, row.floor, row.symbol)
      : findColumnSize(list, row.floor, row.symbol);
  const faces = kind === "beam" ? beamMarkFaces(row.mark) : markFaces(row.mark);
  const auto = autoSectionFormula(
    size?.shape ?? "",
    size?.first ?? null,
    size?.second ?? size?.first ?? null,
    faces,
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
    wall:
      length !== null
        ? length * (kind === "beam" ? slabFactor : wallFactor)(row.mark)
        : null,
  };
}

export function calcColumnRow(
  row: FireproofColumnRow,
  list: FireproofFloorList,
  thicknessMm: number | null,
): FireproofColumnCalc {
  return calcSheetRow(row, list, thicknessMm, "column");
}

/** 梁型入力表の1行を計算する */
export function calcBeamRow(
  row: FireproofColumnRow,
  list: FireproofFloorList,
  thicknessMm: number | null,
): FireproofColumnCalc {
  return calcSheetRow(row, list, thicknessMm, "beam");
}

/** 階が空欄の行は上の行と同じ階として扱う。行ごとの階を返す */
export function inheritedFloors(rows: FireproofColumnRow[]): string[] {
  let floor = "";
  return rows.map((row) => {
    if (row.floor.trim() !== "") floor = row.floor;
    return floor;
  });
}

/** 入力表の合計（必要数㎡・取合m・✔欄ごとの取合m）。✔欄の数は見出しの数だけ */
export function sheetTotals(
  sheet: FireproofColumnSheet,
  list: FireproofFloorList,
  kind: FireproofSheetKind,
): {
  needed: number | null;
  wall: number | null;
  wallMarks: (number | null)[];
} {
  const count = kind === "beam" ? BEAM_MARK_COUNT : WALL_MARK_COUNT;
  const markCount = Math.max(
    count,
    normalizeWallLabels(sheet.wallLabels, count).length,
  );
  let needed = 0;
  let wall = 0;
  let hasNeeded = false;
  let hasWall = false;
  const marks = Array.from({ length: markCount }, () => 0);
  const hasMark = Array.from({ length: markCount }, () => false);
  const floors = inheritedFloors(sheet.rows);
  for (const [index, row] of sheet.rows.entries()) {
    const calc = calcSheetRow(
      { ...row, floor: floors[index] },
      list,
      sheet.thickness,
      kind,
    );
    if (calc.needed !== null) {
      needed += calc.needed;
      hasNeeded = true;
    }
    if (calc.wall !== null) {
      wall += calc.wall;
      hasWall = true;
      row.wallChecks.forEach((checked, mark) => {
        if (!checked || mark >= markCount) return;
        marks[mark] += calc.wall ?? 0;
        hasMark[mark] = true;
      });
    }
  }
  return {
    needed: hasNeeded ? needed : null,
    wall: hasWall ? wall : null,
    wallMarks: marks.map((total, mark) => (hasMark[mark] ? total : null)),
  };
}

/** 柱入力表の合計（必要数㎡・壁取合m） */
export function columnSheetTotals(
  sheet: FireproofColumnSheet,
  list: FireproofFloorList,
): {
  needed: number | null;
  wall: number | null;
  wallMarks: (number | null)[];
} {
  return sheetTotals(sheet, list, "column");
}

/** 梁型入力表の合計（必要数㎡・床取合m） */
export function beamSheetTotals(
  sheet: FireproofColumnSheet,
  list: FireproofFloorList,
): {
  needed: number | null;
  wall: number | null;
  wallMarks: (number | null)[];
} {
  return sheetTotals(sheet, list, "beam");
}

/**
 * 集計詳細データ（合算前）を作る。1行＝1明細で、数量は必要数㎡の合計×倍率。
 * 部位1は空欄なら上の行を引き継ぐ（部位Ⅱ別仕訳・部位Ⅲは無し）。
 */
export function entriesFromFireproofSheet(
  rows: FireproofManageRow[],
  list: FireproofFloorList,
  part2Order: Map<string, number>,
  beamsList: FireproofFloorList = { floors: [], members: [] },
): AggregateEntry[] {
  const entries: AggregateEntry[] = [];
  let part1 = "";
  rows.forEach((row) => {
    if (row.part1.trim() !== "") part1 = row.part1;
    const detail = row.detail;
    if (detail.name.trim() === "" && detail.partName.trim() === "") return;
    const quantity = manageRowQuantity(row, list, beamsList) ?? 0;
    if (!part2Order.has("")) part2Order.set("", part2Order.size);
    entries.push({
      traceId: `fireproof:${row.id}`,
      sourceKind: "fireproof",
      estimateRowId: null,
      transferRowId: null,
      part1,
      part2: "",
      part2Raw: "",
      part2Split: false,
      part2Order: part2Order.get("") ?? 0,
      part3: "",
      formwork: "",
      multiplier: 1,
      subjectId: detail.subjectId,
      materialCategory: detail.materialCategory,
      partNumber: detail.partNumber,
      partName: detail.partName,
      detailNumber: detail.detailNumber,
      name: detail.name,
      descriptionUpper: detail.descriptionUpper,
      descriptionLower: detail.descriptionLower,
      unit: detail.unit,
      remarksUpper: detail.remarksUpper,
      remarksLower: detail.remarksLower,
      estimateDisplay: "",
      coefficient: 1,
      setTotal: quantity,
      quantity: displayedValue(quantity),
      sourceDetailId: null,
    });
  });
  return entries;
}

/** 管理表の行の数量（柱入力表＋梁型入力表の必要数合計×倍率。計算書が無ければnull） */
export function manageRowQuantity(
  row: FireproofManageRow,
  columnsList: FireproofFloorList,
  beamsList: FireproofFloorList = { floors: [], members: [] },
): number | null {
  // 計算書の計算がある行だけ数量を出す（積算範囲の文字には依存しない）
  const column = columnSheetTotals(row.sheet, columnsList).needed;
  const beam = beamSheetTotals(row.beamSheet, beamsList).needed;
  if (column === null && beam === null) return null;
  return ((column ?? 0) + (beam ?? 0)) * (row.multiplier ?? 1);
}
