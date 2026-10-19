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
  /** 部位＋半角「：」＋名称 */
  withPartColon: 3,
  /** 部位＋全角「：」＋名称 */
  withPartFullColon: 4,
} as const;

/**
 * 名称欄の設定どおりに部位と名称をつなぐ。
 * 「そのまま」のときは null（つなげず上下に分けて出す）。
 */
function joinPartAndName(
  partName: string,
  name: string,
  namePattern: number,
): string | null {
  const separator =
    namePattern === NAME_PATTERN.withPart
      ? " "
      : namePattern === NAME_PATTERN.withPartColon
        ? ":"
        : namePattern === NAME_PATTERN.withPartFullColon
          ? "："
          : null;
  if (separator === null) return null;
  return partName === "" ? name : `${partName}${separator}${name}`.trim();
}

export interface TextReplacement {
  from: string;
  to: string;
}

/** 基本部位のタイトル行（部位番号が「始まり」以上の範囲の前へ出す文字） */
export interface PartTitle {
  /** 範囲の始まりの部位番号（次の始まり未満までがこの範囲） */
  from: number;
  /** 出す文字（「＜床＞」のようにそのまま出る） */
  title: string;
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
  /** 単位の置き換え（変更後が空なら集計書の単位のまま） */
  unitReplacements: TextReplacement[];
  /** 基本部位のタイトル行を出すかどうか（設定の表は残したまま出し入れできる） */
  partTitlesOn: boolean;
  /** 基本部位のタイトル行（部位番号の範囲→出す文字。空なら出さない） */
  partTitles: PartTitle[];
  /** エクセル掃き出し：1ページ目の明細数（タイトル行を含む） */
  detailsPerPage: number;
  /** エクセル掃き出し：2ページ目以降の明細数（タイトル行が無い分） */
  detailsPerPageLater: number;
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
  unitReplacements: [],
  partTitlesOn: false,
  partTitles: [
    { from: 10, title: "＜床＞" },
    { from: 20, title: "＜巾木＞" },
    { from: 30, title: "＜壁＞" },
    { from: 40, title: "＜柱型＞" },
    { from: 50, title: "＜梁型＞" },
    { from: 60, title: "＜天井＞" },
    { from: 70, title: "＜その他＞" },
  ],
  detailsPerPage: 17,
  detailsPerPageLater: 16,
};

/** 内訳書の行の種類 */
export type BreakdownRowKind =
  "subject" | "title" | "detail" | "note" | "blank";

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
  /** 取り消し線（1＝この明細は無いものとして比較に出す。無い欄は0と同じ） */
  struck?: number;
  /** 科目の小計として自動で足した行（エクセル出力ではページの最後の行へ出す） */
  subtotal?: boolean;
}

/** 内訳書へ転記する集計書兼工事マスターの明細 */
export interface BreakdownSourceItem {
  id: number | null;
  masterKey: string;
  subjectId: number | null;
  /** 部位Ⅰ（集計書ではタイトル行になる） */
  part1: string;
  /** 部位Ⅱ（集計書では＜＞の見出し行になる） */
  part2?: string;
  /** 明細用部位の番号（基本部位のタイトル行を出す範囲の判断に使う） */
  partNumber: number | null;
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

/** 半角カタカナ→全角カタカナ（濁点・半濁点は1文字にまとめる） */
const KANA_TO_FULL: Record<string, string> = {
  ｶﾞ: "ガ",
  ｷﾞ: "ギ",
  ｸﾞ: "グ",
  ｹﾞ: "ゲ",
  ｺﾞ: "ゴ",
  ｻﾞ: "ザ",
  ｼﾞ: "ジ",
  ｽﾞ: "ズ",
  ｾﾞ: "ゼ",
  ｿﾞ: "ゾ",
  ﾀﾞ: "ダ",
  ﾁﾞ: "ヂ",
  ﾂﾞ: "ヅ",
  ﾃﾞ: "デ",
  ﾄﾞ: "ド",
  ﾊﾞ: "バ",
  ﾋﾞ: "ビ",
  ﾌﾞ: "ブ",
  ﾍﾞ: "ベ",
  ﾎﾞ: "ボ",
  ﾊﾟ: "パ",
  ﾋﾟ: "ピ",
  ﾌﾟ: "プ",
  ﾍﾟ: "ペ",
  ﾎﾟ: "ポ",
  ｳﾞ: "ヴ",
  ｱ: "ア",
  ｲ: "イ",
  ｳ: "ウ",
  ｴ: "エ",
  ｵ: "オ",
  ｶ: "カ",
  ｷ: "キ",
  ｸ: "ク",
  ｹ: "ケ",
  ｺ: "コ",
  ｻ: "サ",
  ｼ: "シ",
  ｽ: "ス",
  ｾ: "セ",
  ｿ: "ソ",
  ﾀ: "タ",
  ﾁ: "チ",
  ﾂ: "ツ",
  ﾃ: "テ",
  ﾄ: "ト",
  ﾅ: "ナ",
  ﾆ: "ニ",
  ﾇ: "ヌ",
  ﾈ: "ネ",
  ﾉ: "ノ",
  ﾊ: "ハ",
  ﾋ: "ヒ",
  ﾌ: "フ",
  ﾍ: "ヘ",
  ﾎ: "ホ",
  ﾏ: "マ",
  ﾐ: "ミ",
  ﾑ: "ム",
  ﾒ: "メ",
  ﾓ: "モ",
  ﾔ: "ヤ",
  ﾕ: "ユ",
  ﾖ: "ヨ",
  ﾗ: "ラ",
  ﾘ: "リ",
  ﾙ: "ル",
  ﾚ: "レ",
  ﾛ: "ロ",
  ﾜ: "ワ",
  ｦ: "ヲ",
  ﾝ: "ン",
  ｧ: "ァ",
  ｨ: "ィ",
  ｩ: "ゥ",
  ｪ: "ェ",
  ｫ: "ォ",
  ｬ: "ャ",
  ｭ: "ュ",
  ｮ: "ョ",
  ｯ: "ッ",
  ｰ: "ー",
  "｡": "。",
  "､": "、",
  "｢": "「",
  "｣": "」",
  "･": "・",
  ﾞ: "゛",
  ﾟ: "゜",
};

const KANA_TO_HALF: Record<string, string> = Object.fromEntries(
  Object.entries(KANA_TO_FULL).map(([half, full]) => [full, half]),
);

/** 半角の英数記号・カタカナを全角にする */
export function toFullWidth(value: string): string {
  const kana = value.replace(
    /[ｦ-ﾟ][ﾞﾟ]?/g,
    (char) => KANA_TO_FULL[char] ?? KANA_TO_FULL[char[0]] ?? char,
  );
  return kana.replace(/[!-~]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + FULL_WIDTH_OFFSET),
  );
}

/** 全角の英数記号・カタカナを半角にする */
export function toHalfWidth(value: string): string {
  const ascii = value.replace(/[！-～]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_OFFSET),
  );
  return ascii.replace(
    /[ァ-ヶー。、「」・゛゜]/g,
    (char) => KANA_TO_HALF[char] ?? char,
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

/** 単位を提出先の表記へ置き換える（設定が無ければそのまま） */
export function replaceUnit(
  unit: string,
  replacements: readonly TextReplacement[],
): string {
  const rule = replacements.find(
    (row) => row.from === unit && row.to.trim() !== "",
  );
  return rule ? rule.to : unit;
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
 * 金額欄に出す金額。
 * 直接入力があればそれを使い、無ければ数量×単価を出す。
 */
export function amountOf(row: {
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
}): number | null {
  if (row.amount !== null) return row.amount;
  if (row.quantity !== null && row.unitPrice !== null) {
    return row.quantity * row.unitPrice;
  }
  return null;
}

/**
 * 金額が入った科目の終わりに「小計」行を足す。
 * 画面では直接入力した金額か数量×単価を使い、科目ごとの合計金額を次の科目の前へ出す。
 */
export function withSubjectSubtotals(
  rows: readonly BreakdownRow[],
): BreakdownRow[] {
  const next: BreakdownRow[] = [];
  let total = 0;
  let has = false;
  let inGroup = false;
  let subjectId: number | null = null;
  const flush = (): void => {
    if (inGroup && has) {
      const subtotal = emptyRow("detail");
      subtotal.nameLower = "小計";
      subtotal.amount = total;
      subtotal.subtotal = true;
      subtotal.subjectId = subjectId;
      next.push(subtotal);
    }
    total = 0;
    has = false;
  };
  rows.forEach((row) => {
    if (row.rowKind === "subject") {
      flush();
      // 科目の見出しだけでなく、部屋別・部位別のまとめの見出しでも小計を出す
      inGroup = true;
      subjectId = row.subjectId;
      next.push(row);
      return;
    }
    if (inGroup && amountOf(row) !== null) {
      total += amountOf(row) ?? 0;
      has = true;
    }
    next.push(row);
  });
  flush();
  return next;
}

/**
 * 部位番号がどの範囲に入るか調べ、出すタイトル文字を返す。
 * 範囲は「始まり以上・次の始まり未満」。部位番号が無い・どの範囲にも入らないときは null。
 */
export function partTitleOf(
  partNumber: number | null,
  partTitles: readonly PartTitle[],
): string | null {
  if (partNumber === null || !Number.isFinite(partNumber)) return null;
  const whole = Math.floor(partNumber);
  let title: string | null = null;
  let best = Number.NEGATIVE_INFINITY;
  partTitles.forEach((entry) => {
    if (entry.from <= whole && entry.from > best && entry.title !== "") {
      best = entry.from;
      title = entry.title;
    }
  });
  return title;
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

    appendGroupRows(
      rows,
      groups.get(subjectId) ?? [],
      () => subjectId,
      heading.subjectName,
      settings,
      true,
    );
  });
  return rows;
}

/** 部屋別・部位別のまとめから作る内訳書の元（1まとめ分） */
export interface BreakdownGroupSource {
  /** まとめの名前（部屋名・部位Ⅱ名）。見出しに「＜名前＞」と出る */
  name: string;
  items: BreakdownSourceItem[];
}

/**
 * 部屋別・部位別のまとめから内訳書の行を作る。
 * 工種科目の見出しの代わりにまとめの名前（＜部屋名＞など）を見出しにし、
 * 明細はそのまとめの中の並び（集計書と同じく科目・部位順）で出す。
 */
export function buildGroupedBreakdownRows(
  groups: readonly BreakdownGroupSource[],
  settings: BreakdownSettings,
): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  groups.forEach((group) => {
    const heading = emptyRow("subject");
    heading.subjectName = `＜${group.name}＞`;
    heading.nameUpper = heading.subjectName;
    rows.push(heading);
    appendGroupRows(
      rows,
      group.items,
      (item) => item.subjectId,
      heading.subjectName,
      settings,
      false,
    );
  });
  return rows;
}

/** 見出しの下の明細：部位Ⅰのタイトル行・基本部位のタイトル行を挟んで明細を並べる */
function appendGroupRows(
  rows: BreakdownRow[],
  items: readonly BreakdownSourceItem[],
  subjectIdOf: (item: BreakdownSourceItem) => number | null,
  subjectName: string,
  settings: BreakdownSettings,
  withPart2: boolean,
): void {
  // 集計書兼工事マスターと同じく、部位Ⅰが変わるところへタイトル行を置く
  let part1: string | undefined;
  let part2: string | undefined;
  // 基本部位のタイトル行は部位Ⅰごとに出し直す
  let lastPartTitle: string | null = null;
  items.forEach((item) => {
    const subjectId = subjectIdOf(item);
    if (part1 !== item.part1) {
      part1 = item.part1;
      part2 = undefined;
      lastPartTitle = null;
      if (part1 !== "") {
        const title = emptyRow("title");
        title.subjectId = subjectId;
        title.subjectName = subjectName;
        title.partName = part1;
        title.nameLower = `（${part1}）`;
        rows.push(title);
      }
    }
    if (withPart2) {
      const nextPart2 = item.part2 ?? "";
      if (nextPart2 !== part2) {
        part2 = nextPart2;
        lastPartTitle = null;
        if (part2 !== "") {
          const title = emptyRow("title");
          title.subjectId = subjectId;
          title.subjectName = subjectName;
          title.partName = part2;
          title.nameLower = `＜${part2}＞`;
          rows.push(title);
        }
      }
    }
    const partTitle = settings.partTitlesOn
      ? partTitleOf(item.partNumber, settings.partTitles)
      : null;
    if (partTitle !== null && partTitle !== lastPartTitle) {
      lastPartTitle = partTitle;
      const title = emptyRow("title");
      title.subjectId = subjectId;
      title.subjectName = subjectName;
      title.partName = partTitle;
      title.nameLower = partTitle;
      rows.push(title);
    }
    rows.push(...detailRows(item, subjectId, subjectName, settings));
  });
}

interface BreakdownDetailUnit {
  hasQuantity?: boolean;
  subjectId: number | null;
  subjectName: string;
  masterKey: string;
  aggregateItemId: number | null;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  remarksUpper: string;
  remarksLower: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amount: number | null;
  struck?: number;
}

function detailRows(
  item: BreakdownSourceItem,
  subjectId: number | null,
  subjectName: string,
  settings: BreakdownSettings,
): BreakdownRow[] {
  const hasQuantity = item.unit !== "";
  return emitDetailUnit(
    {
      subjectId,
      subjectName,
      hasQuantity,
      masterKey: item.masterKey,
      aggregateItemId: item.id,
      partName: item.partName,
      name: applyWidth(item.name, settings.nameWidth),
      descriptionUpper: applyReplacements(
        item.descriptionUpper,
        settings.replacements,
      ),
      descriptionLower: applyReplacements(
        item.descriptionLower,
        settings.replacements,
      ),
      remarksUpper: item.remarksUpper,
      remarksLower: item.remarksLower,
      quantity: hasQuantity ? roundQuantity(item.quantity, settings) : null,
      unit: replaceUnit(item.unit, settings.unitReplacements),
      unitPrice: null,
      amount: null,
    },
    settings.layout,
    settings.namePattern,
  );
}

function emitDetailUnit(
  unit: BreakdownDetailUnit,
  layout: number,
  namePattern: number,
): BreakdownRow[] {
  const line = (kind: BreakdownRowKind): BreakdownRow => {
    const row = emptyRow(kind);
    row.subjectId = unit.subjectId;
    row.subjectName = unit.subjectName;
    row.masterKey = unit.masterKey;
    row.aggregateItemId = unit.aggregateItemId;
    row.partName = unit.partName;
    if (unit.struck !== undefined) row.struck = unit.struck;
    return row;
  };
  const joined = joinPartAndName(unit.partName, unit.name, namePattern);

  if (layout === BREAKDOWN_LAYOUT.twoRow || layout === BREAKDOWN_LAYOUT.excel) {
    const upper = line("note");
    upper.descriptionLower = unit.descriptionUpper;
    upper.remarksLower = unit.remarksUpper;

    const lower = line("detail");
    if (joined !== null) lower.nameLower = joined;
    else {
      upper.nameLower = unit.partName;
      lower.nameLower = unit.name;
    }
    lower.descriptionLower = unit.descriptionLower;
    lower.remarksLower = unit.remarksLower;
    lower.quantity = unit.quantity;
    lower.unit = unit.unit;
    lower.unitPrice = unit.unitPrice;
    lower.amount = unit.amount;
    return [upper, lower];
  }

  const hasQuantity = unit.hasQuantity ?? unit.unit !== "";
  const description = splitTwoLines(
    unit.descriptionUpper,
    unit.descriptionLower,
    hasQuantity,
  );
  const remarks = splitTwoLines(
    unit.remarksUpper,
    unit.remarksLower,
    hasQuantity,
  );
  const row = line("detail");
  if (layout === BREAKDOWN_LAYOUT.oneLine || joined !== null) {
    row.nameLower =
      joined ??
      (unit.partName === ""
        ? unit.name
        : `${unit.partName} ${unit.name}`.trim());
  } else {
    row.nameUpper = unit.partName;
    row.nameLower = unit.name;
  }
  row.descriptionLower = description.primary;
  row.remarksLower = remarks.primary;
  row.quantity = unit.quantity;
  row.unit = unit.unit;
  row.unitPrice = unit.unitPrice;
  row.amount = unit.amount;

  const rows = [row];
  if (description.overflow !== "" || remarks.overflow !== "") {
    const extra = line("note");
    extra.partName = "";
    extra.descriptionLower = description.overflow;
    extra.remarksLower = remarks.overflow;
    rows.push(extra);
  }
  return rows;
}

function detailUnitKey(row: BreakdownRow): string | null {
  if (
    row.subtotal === true ||
    (row.rowKind !== "detail" && row.rowKind !== "note") ||
    (row.masterKey === "" && row.aggregateItemId === null)
  )
    return null;
  return JSON.stringify([row.masterKey, row.aggregateItemId]);
}

function stripPartName(text: string, partName: string): string {
  if (partName === "") return text;
  const prefix = [" ", ":", "："]
    .map((separator) => `${partName}${separator}`)
    .find((candidate) => text.startsWith(candidate));
  return prefix === undefined ? text : text.slice(prefix.length);
}

/**
 * 保存済みの明細行を、現在の書式と名称欄の設定に合わせて並べ直す。
 * 集計から作り直さず、確定した回の行データだけを組み替える。
 */
export function relayoutBreakdownRows<T extends BreakdownRow>(
  rows: readonly T[],
  settings: { layout: number; namePattern: number },
): T[];
export function relayoutBreakdownRows<
  T extends Omit<BreakdownRow, "rowKind"> & { rowKind: string },
>(rows: readonly T[], settings: { layout: number; namePattern: number }): T[];
export function relayoutBreakdownRows<
  T extends Omit<BreakdownRow, "rowKind"> & { rowKind: string },
>(rows: readonly T[], settings: { layout: number; namePattern: number }): T[] {
  const output: T[] = [];
  const rowAt = (index: number): BreakdownRow => rows[index] as BreakdownRow;
  let index = 0;
  while (index < rows.length) {
    const row = rowAt(index);
    const key = detailUnitKey(row);
    const next = rows[index + 1] as BreakdownRow | undefined;
    const nextKey = next ? detailUnitKey(next) : null;

    if (
      row.rowKind === "note" &&
      key !== null &&
      next?.rowKind === "detail" &&
      nextKey === key
    ) {
      const unitRows = [row, next];
      output.push(
        ...emitRelayoutUnit(unitRows, next, row, undefined, settings).map(
          (emitted) =>
            ({ ...(emitted.rowKind === "note" ? row : next), ...emitted }) as T,
        ),
      );
      index += 2;
      continue;
    }

    if (row.rowKind === "detail" && key !== null) {
      const afterNext = rows[index + 2] as BreakdownRow | undefined;
      const noteIsPair =
        next?.rowKind === "note" &&
        nextKey === key &&
        afterNext?.rowKind === "detail" &&
        detailUnitKey(afterNext) === key;
      const overflow =
        next?.rowKind === "note" && nextKey === key && !noteIsPair
          ? next
          : undefined;
      const unitRows = overflow ? [row, overflow] : [row];
      output.push(
        ...emitRelayoutUnit(unitRows, row, undefined, overflow, settings).map(
          (emitted) =>
            ({
              ...(emitted.rowKind === "note" ? (overflow ?? row) : row),
              ...emitted,
            }) as T,
        ),
      );
      index += overflow ? 2 : 1;
      continue;
    }

    output.push(rows[index]);
    index += 1;
  }
  return output;
}

function emitRelayoutUnit(
  sourceRows: readonly BreakdownRow[],
  detail: BreakdownRow,
  pairedUpper: BreakdownRow | undefined,
  overflow: BreakdownRow | undefined,
  settings: { layout: number; namePattern: number },
): BreakdownRow[] {
  const partName =
    pairedUpper !== undefined
      ? pairedUpper.nameLower !== ""
        ? pairedUpper.nameLower
        : detail.partName
      : detail.nameUpper !== ""
        ? detail.nameUpper
        : detail.partName;
  const name =
    pairedUpper !== undefined
      ? pairedUpper.nameLower !== ""
        ? detail.nameLower
        : stripPartName(detail.nameLower, detail.partName)
      : detail.nameUpper !== ""
        ? detail.nameLower
        : stripPartName(detail.nameLower, detail.partName);
  const hasQuantity = detail.unit !== "";
  const struck = sourceRows.some((row) => row.struck === 1)
    ? 1
    : sourceRows.some((row) => row.struck !== undefined)
      ? 0
      : undefined;

  return emitDetailUnit(
    {
      subjectId: detail.subjectId,
      subjectName: detail.subjectName,
      hasQuantity,
      masterKey: detail.masterKey,
      aggregateItemId: detail.aggregateItemId,
      partName,
      name,
      descriptionUpper:
        pairedUpper !== undefined
          ? pairedUpper.descriptionLower
          : hasQuantity
            ? (overflow?.descriptionLower ?? "")
            : detail.descriptionLower,
      descriptionLower:
        pairedUpper !== undefined
          ? detail.descriptionLower
          : hasQuantity
            ? detail.descriptionLower
            : (overflow?.descriptionLower ?? ""),
      remarksUpper:
        pairedUpper !== undefined
          ? pairedUpper.remarksLower
          : hasQuantity
            ? (overflow?.remarksLower ?? "")
            : detail.remarksLower,
      remarksLower:
        pairedUpper !== undefined
          ? detail.remarksLower
          : hasQuantity
            ? detail.remarksLower
            : (overflow?.remarksLower ?? ""),
      quantity: detail.quantity,
      unit: detail.unit,
      unitPrice: detail.unitPrice,
      amount: detail.amount,
      struck,
    },
    settings.layout,
    settings.namePattern,
  );
}

/** 集計書から使っている単位を並び順つきで抜き出す */
export function collectUnits(items: readonly BreakdownSourceItem[]): string[] {
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

/**
 * 工種科目の並びに新しい科目を入れる。
 * 今までの並び（動かした分も含めて覚えたもの）を基準に、新しい科目は
 * 科目マスターの並びで直前に来る科目の直後へ入れる（前後の科目から位置を決める。
 * どの既存科目より前なら先頭）。
 */
export function mergeSubjectOrder(
  storedOrder: readonly number[],
  usedIds: readonly number[],
  subjects: readonly BreakdownSubject[],
): number[] {
  const orderById = new Map(
    subjects.map((subject) => [subject.id, subject.displayOrder]),
  );
  const order = [...storedOrder];
  usedIds
    .filter((id) => !order.includes(id))
    .forEach((id) => {
      const key = orderById.get(id) ?? Number.MAX_SAFE_INTEGER;
      let insertAt = 0;
      order.forEach((existing, index) => {
        const existingKey = orderById.get(existing) ?? Number.MAX_SAFE_INTEGER;
        if (existingKey < key) insertAt = index + 1;
      });
      order.splice(insertAt, 0, id);
    });
  return order;
}
