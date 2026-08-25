/**
 * 内訳書。
 * 集計書兼工事マスターの明細を、提出先の書式に合わせて変換転記する。
 * 3層目＝工種科目の見出し、4層目＝その科目の明細。
 */

/** 内訳書の書式 */
export const BREAKDOWN_LAYOUT = {
  /** 2段1行（画面・印刷の基準） */
  twoLine: 1,
  /** 1段（名称は 部位＋半角スペース＋名称） */
  oneLine: 2,
  /** エクセル転記用（2段のまま1行に掃き出す） */
  excel: 3,
  /** 2段2行（集計書のまま。上段と下段を別の行にする） */
  twoRow: 4,
} as const;

/** 名称欄の作り方 */
export const NAME_PATTERN = {
  /** そのまま */
  asIs: 1,
  /** 部位＋半角スペース＋名称 */
  withPart: 2,
} as const;

export interface TextReplacement {
  from: string;
  to: string;
}

export interface BreakdownSettings {
  layout: number;
  namePattern: number;
  /** 名称（下段）の文字幅 half:半角 full:全角 raw:そのまま */
  nameWidth: string;
  /** 数量の丸め：閾値1以上→桁数1、閾値2以上→桁数2、それ未満→桁数3 */
  roundThreshold1: number;
  roundDecimals1: number;
  roundThreshold2: number;
  roundDecimals2: number;
  roundDecimals3: number;
  /** 工種科目の並び（科目ID） */
  subjectOrder: number[];
  /** 摘要の文字置き換え */
  replacements: TextReplacement[];
  /** 単位の並び（集計書から抜き出す） */
  unitOrder: string[];
}

export const DEFAULT_BREAKDOWN_SETTINGS: BreakdownSettings = {
  layout: BREAKDOWN_LAYOUT.twoLine,
  namePattern: NAME_PATTERN.asIs,
  nameWidth: "raw",
  roundThreshold1: 100,
  roundDecimals1: 0,
  roundThreshold2: 0,
  roundDecimals2: 1,
  roundDecimals3: 2,
  subjectOrder: [],
  replacements: [],
  unitOrder: [],
};

/** 内訳書の行の種類 */
export type BreakdownRowKind = "subject" | "detail" | "note" | "blank";

/** 内訳書の1行（画面の1明細＝2段1行） */
export interface BreakdownRow {
  rowKind: BreakdownRowKind;
  subjectId: number | null;
  subjectName: string;
  /** 集計書兼工事マスターの明細（数量根拠を追うため） */
  masterKey: string;
  aggregateItemId: number | null;
  partName: string;
  nameUpper: string;
  nameLower: string;
  descriptionUpper: string;
  descriptionLower: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amount: number | null;
  remarksUpper: string;
  remarksLower: string;
}

/** 内訳書へ転記する集計書兼工事マスターの明細 */
export interface BreakdownSourceItem {
  id: number | null;
  masterKey: string;
  subjectId: number | null;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  quantity: number;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
}

export interface BreakdownSubject {
  id: number;
  name: string;
  displayOrder: number;
}

const FULL_WIDTH_OFFSET = 0xfee0;

/** 半角の英数記号を全角にする */
export function toFullWidth(value: string): string {
  return value.replace(/[!-~]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + FULL_WIDTH_OFFSET),
  );
}

/** 全角の英数記号を半角にする */
export function toHalfWidth(value: string): string {
  return value.replace(/[！-～]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_OFFSET),
  );
}

function applyWidth(value: string, nameWidth: string): string {
  if (nameWidth === "half") return toHalfWidth(value);
  if (nameWidth === "full") return toFullWidth(value);
  return value;
}

/** 摘要などの文字を置き換える（* → ✕ など） */
export function applyReplacements(
  value: string,
  replacements: readonly TextReplacement[],
): string {
  return replacements.reduce(
    (text, rule) =>
      rule.from === "" ? text : text.split(rule.from).join(rule.to),
    value,
  );
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * 数量の表示丸め。
 * 100以上は整数、100未満は小数1桁。ただしその桁で0になる場合は数字が出る桁まで下げる。
 */
export function roundQuantity(
  value: number,
  settings: BreakdownSettings,
): number {
  const absolute = Math.abs(value);
  let decimals = settings.roundDecimals3;
  if (absolute >= settings.roundThreshold1) decimals = settings.roundDecimals1;
  else if (absolute >= settings.roundThreshold2)
    decimals = settings.roundDecimals2;

  let rounded = roundTo(value, decimals);
  while (rounded === 0 && value !== 0 && decimals < 6) {
    decimals += 1;
    rounded = roundTo(value, decimals);
  }
  return rounded;
}

function emptyRow(kind: BreakdownRowKind): BreakdownRow {
  return {
    rowKind: kind,
    subjectId: null,
    subjectName: "",
    masterKey: "",
    aggregateItemId: null,
    partName: "",
    nameUpper: "",
    nameLower: "",
    descriptionUpper: "",
    descriptionLower: "",
    quantity: null,
    unit: "",
    unitPrice: null,
    amount: null,
    remarksUpper: "",
    remarksLower: "",
  };
}

/**
 * 2段のうち内訳書に載せる方（主）と、次の明細へ送る方（従）に分ける。
 * 数量・単位がある明細は下段が主、無い明細は上段が主。
 */
function splitTwoLines(
  upper: string,
  lower: string,
  hasQuantity: boolean,
): { primary: string; overflow: string } {
  if (hasQuantity) return { primary: lower, overflow: upper };
  return { primary: upper, overflow: lower };
}

function subjectSortKey(
  subject: BreakdownSubject | undefined,
  subjectId: number | null,
  order: readonly number[],
): number {
  if (subjectId === null) return Number.MAX_SAFE_INTEGER;
  const index = order.indexOf(subjectId);
  if (index >= 0) return index;
  return order.length + (subject?.displayOrder ?? subjectId);
}

/**
 * 集計書兼工事マスターの明細を内訳書の行に変換する。
 * 工種科目ごとに見出し行を置き、明細を並べる。
 */
export function buildBreakdownRows(
  items: readonly BreakdownSourceItem[],
  subjects: readonly BreakdownSubject[],
  settings: BreakdownSettings,
): BreakdownRow[] {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const groups = new Map<number | null, BreakdownSourceItem[]>();
  items.forEach((item) => {
    const found = groups.get(item.subjectId);
    if (found) found.push(item);
    else groups.set(item.subjectId, [item]);
  });

  const sortedSubjects = [...groups.keys()].sort(
    (a, b) =>
      subjectSortKey(
        a === null ? undefined : subjectById.get(a),
        a,
        settings.subjectOrder,
      ) -
      subjectSortKey(
        b === null ? undefined : subjectById.get(b),
        b,
        settings.subjectOrder,
      ),
  );

  const rows: BreakdownRow[] = [];
  sortedSubjects.forEach((subjectId) => {
    const subject = subjectId === null ? undefined : subjectById.get(subjectId);
    const heading = emptyRow("subject");
    heading.subjectId = subjectId;
    heading.subjectName = subject?.name ?? "（科目なし）";
    heading.nameUpper = heading.subjectName;
    rows.push(heading);

    (groups.get(subjectId) ?? []).forEach((item) => {
      rows.push(...detailRows(item, subjectId, heading.subjectName, settings));
    });
  });
  return rows;
}

function detailRows(
  item: BreakdownSourceItem,
  subjectId: number | null,
  subjectName: string,
  settings: BreakdownSettings,
): BreakdownRow[] {
  const hasQuantity = item.unit !== "";
  const description = splitTwoLines(
    applyReplacements(item.descriptionUpper, settings.replacements),
    applyReplacements(item.descriptionLower, settings.replacements),
    hasQuantity,
  );
  const remarks = splitTwoLines(
    item.remarksUpper,
    item.remarksLower,
    hasQuantity,
  );
  const name = applyWidth(item.name, settings.nameWidth);

  if (settings.layout === BREAKDOWN_LAYOUT.twoRow) {
    return twoRowDetail(item, subjectId, subjectName, name, settings);
  }

  const row = emptyRow("detail");
  row.subjectId = subjectId;
  row.subjectName = subjectName;
  row.masterKey = item.masterKey;
  row.aggregateItemId = item.id;
  row.partName = item.partName;
  if (settings.layout === BREAKDOWN_LAYOUT.oneLine) {
    row.nameUpper = "";
    row.nameLower =
      item.partName === "" ? name : `${item.partName} ${name}`.trim();
  } else if (settings.namePattern === NAME_PATTERN.withPart) {
    row.nameUpper = "";
    row.nameLower =
      item.partName === "" ? name : `${item.partName} ${name}`.trim();
  } else {
    row.nameUpper = item.partName;
    row.nameLower = name;
  }
  row.descriptionLower = description.primary;
  row.remarksLower = remarks.primary;
  row.quantity = hasQuantity ? roundQuantity(item.quantity, settings) : null;
  row.unit = item.unit;

  const rows = [row];
  if (description.overflow !== "" || remarks.overflow !== "") {
    const extra = emptyRow("note");
    extra.subjectId = subjectId;
    extra.subjectName = subjectName;
    extra.masterKey = item.masterKey;
    extra.aggregateItemId = item.id;
    extra.descriptionLower = description.overflow;
    extra.remarksLower = remarks.overflow;
    rows.push(extra);
  }
  return rows;
}

/**
 * 書式④＝集計書のまま2段2行。
 * 上段（部位名・摘要上段・備考上段）と下段（名称・摘要下段・数量・単位・備考下段）を別の行にする。
 */
function twoRowDetail(
  item: BreakdownSourceItem,
  subjectId: number | null,
  subjectName: string,
  name: string,
  settings: BreakdownSettings,
): BreakdownRow[] {
  const hasQuantity = item.unit !== "";
  const line = (kind: BreakdownRowKind): BreakdownRow => {
    const row = emptyRow(kind);
    row.subjectId = subjectId;
    row.subjectName = subjectName;
    row.masterKey = item.masterKey;
    row.aggregateItemId = item.id;
    row.partName = item.partName;
    return row;
  };

  const upper = line("note");
  upper.nameLower = item.partName;
  upper.descriptionLower = applyReplacements(
    item.descriptionUpper,
    settings.replacements,
  );
  upper.remarksLower = item.remarksUpper;

  const lower = line("detail");
  lower.nameLower = name;
  lower.descriptionLower = applyReplacements(
    item.descriptionLower,
    settings.replacements,
  );
  lower.remarksLower = item.remarksLower;
  lower.quantity = hasQuantity ? roundQuantity(item.quantity, settings) : null;
  lower.unit = item.unit;

  const rows: BreakdownRow[] = [];
  const emptyUpper =
    upper.nameLower === "" &&
    upper.descriptionLower === "" &&
    upper.remarksLower === "";
  if (!emptyUpper) rows.push(upper);
  rows.push(lower);
  return rows;
}

/** 集計書から使っている単位を並び順つきで抜き出す */
export function collectUnits(
  items: readonly BreakdownSourceItem[],
): string[] {
  const units: string[] = [];
  items.forEach((item) => {
    if (item.unit !== "" && !units.includes(item.unit)) units.push(item.unit);
  });
  return units;
}

/** 集計書から使っている工種科目を並び順つきで抜き出す */
export function collectSubjectOrder(
  items: readonly BreakdownSourceItem[],
  subjects: readonly BreakdownSubject[],
): number[] {
  const used = new Set<number>();
  items.forEach((item) => {
    if (item.subjectId !== null) used.add(item.subjectId);
  });
  return subjects
    .filter((subject) => used.has(subject.id))
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((subject) => subject.id);
}
