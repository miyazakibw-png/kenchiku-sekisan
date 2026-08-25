/**
 * 部屋計算書の下段（セット明細計算表）。
 * 「部位」を持つ行がセットの先頭で、部位が空の行は上のセットに属する。
 * 明細欄と計算式欄はセットの中で別々に増減し、行数は多い方に合わせる。
 */

import { evaluateFormula, normalizeFormula } from "../formula/evaluate";

/** セット明細の1明細（基本／工事マスターの明細を写し取ったもの） */
export interface CalcDetail {
  id: string;
  /** 写し取り元の明細（数量根拠の追跡用。連動はしない） */
  sourceDetailId: number | null;
  subjectId: number | null;
  detailNumber: number | null;
  materialCategory: string;
  /** 明細用部位マスターの番号（番号があれば表示名はマスターに合わせる） */
  partNumber: number | null;
  /** 上段に出す部位名（明細マスターと同じ上下2段の構成） */
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  coefficient: number;
}

/** セット明細の計算式1行（A・Bの2欄。両方あれば A×B） */
export interface CalcLine {
  id: string;
  formulaA: string;
  formulaB: string;
  comment: string;
  /** 他のセットから参照するための記号（B1〜B100。重複不可） */
  bSymbol: string;
}

/** セットの上に出す見出し行（目印。色を付けて部位のまとまりを見やすくする） */
export interface CalcBanner {
  text: string;
  /** CSS の色（画面で選んだ登録色） */
  color: string;
}

/** 部位で始まる1セット */
export interface CalcSet {
  id: string;
  /** 部位マスターの番号（番号入力で名称に変換する） */
  partNumber: number | null;
  partName: string;
  details: CalcDetail[];
  lines: CalcLine[];
  /** セットの上に置く見出し行（無ければ付けない） */
  banner?: CalcBanner | null;
  /** 自動登録された仕上明細セットマスターのID（マスター修正の連動先） */
  assemblyId?: number | null;
}

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export function calcDetail(patch: Partial<CalcDetail> = {}): CalcDetail {
  return {
    id: newId("d"),
    sourceDetailId: null,
    subjectId: null,
    detailNumber: null,
    materialCategory: "",
    partNumber: null,
    partName: "",
    name: "",
    descriptionUpper: "",
    descriptionLower: "",
    unit: "",
    remarksUpper: "",
    remarksLower: "",
    estimateDisplay: "",
    coefficient: 1,
    ...patch,
  };
}

export function calcLine(patch: Partial<CalcLine> = {}): CalcLine {
  return {
    id: newId("l"),
    formulaA: "",
    formulaB: "",
    comment: "",
    bSymbol: "",
    ...patch,
  };
}

/** コメント行（明細を持たない、色付きの1行だけのセット） */
export function commentSet(text: string, color: string): CalcSet {
  return {
    id: newId("s"),
    partNumber: null,
    partName: "",
    details: [],
    lines: [],
    banner: { text, color },
    assemblyId: null,
  };
}

/** コメント行か（明細も計算式も持たない見出しだけの行） */
export function isCommentSet(set: CalcSet): boolean {
  return (
    set.banner != null && set.details.length === 0 && set.lines.length === 0
  );
}

/** 空のセット明細（1明細＝1行） */
export function calcSet(detailCount = 1): CalcSet {
  return {
    id: newId("s"),
    partNumber: null,
    partName: "",
    details: Array.from({ length: detailCount }, () => calcDetail()),
    lines: Array.from({ length: Math.max(detailCount, 1) }, () => calcLine()),
    banner: null,
    assemblyId: null,
  };
}

/**
 * 保存済みの計算表を読み込むときに、足りない項目を埋める。
 * 古い工事のデータには無い項目があり、そのままだと集計で落ちるため。
 */
export function normalizeSets(sets: CalcSet[]): CalcSet[] {
  return sets.map((set) => ({
    ...set,
    id: set.id ?? newId("s"),
    partNumber: set.partNumber ?? null,
    partName: set.partName ?? "",
    banner: set.banner ?? null,
    assemblyId: set.assemblyId ?? null,
    details: (set.details ?? []).map((detail) => calcDetail(detail)),
    lines: (set.lines ?? []).map((line) => calcLine(line)),
  }));
}

/** 計算式行に何か入っているか（詰めてよい空行かの判定） */
function isEmptyLine(line: CalcLine): boolean {
  return (
    line.formulaA.trim() === "" &&
    line.formulaB.trim() === "" &&
    line.comment.trim() === "" &&
    line.bSymbol.trim() === ""
  );
}

/** 明細1件＝計算式1行になるよう、足りない計算式行を足す（明細を増やしても式が入れられるように） */
export function padLines(details: CalcDetail[], lines: CalcLine[]): CalcLine[] {
  const need = Math.max(details.length, 1);
  const next = [...lines];
  while (next.length < need) next.push(calcLine());
  return next;
}

/**
 * 明細の数に計算式行を合わせる（明細1件＝計算式1行）。
 * 余った末尾の空行は詰め、足りなければ足す（入力済みの行は残す）。
 */
export function syncLines(
  details: CalcDetail[],
  lines: CalcLine[],
): CalcLine[] {
  const need = Math.max(details.length, 1);
  const next = [...lines];
  while (next.length > need && isEmptyLine(next[next.length - 1])) next.pop();
  return padLines(details, next);
}

/**
 * セットに1行足す（明細と計算式を必ず同じ位置に1組ずつ）。
 * position を省くと末尾へ足す。入力も削除もできない行ができないよう、
 * どちらの欄から足しても明細と計算式行の数はそろえる。
 */
export function addSetRow(set: CalcSet, position?: number): CalcSet {
  const details = [...set.details];
  const lines = [...set.lines];
  const at = position ?? Math.max(details.length, lines.length);
  details.splice(Math.min(Math.max(at, 0), details.length), 0, calcDetail());
  lines.splice(Math.min(Math.max(at, 0), lines.length), 0, calcLine());
  return { ...set, details, lines: padLines(details, lines) };
}

/** 明細の無い行に空の明細を用意して、名称や摘要を入れられるようにする */
export function openSetDetail(set: CalcSet, index: number): CalcSet {
  const details = [...set.details];
  while (details.length <= index) details.push(calcDetail());
  return { ...set, details, lines: padLines(details, set.lines) };
}

/** 明細の無い計算式だけの行を消す */
export function removeSetLine(set: CalcSet, index: number): CalcSet {
  const lines = set.lines.filter((_, rowIndex) => rowIndex !== index);
  return { ...set, lines: syncLines(set.details, lines) };
}

/** 明細に何か入力されているか（入力の無い明細は保存時に取り除く） */
export function isEmptyDetail(detail: CalcDetail): boolean {
  return (
    detail.subjectId === null &&
    detail.detailNumber === null &&
    (detail.partNumber ?? null) === null &&
    detail.materialCategory.trim() === "" &&
    detail.partName.trim() === "" &&
    detail.name.trim() === "" &&
    detail.descriptionUpper.trim() === "" &&
    detail.descriptionLower.trim() === "" &&
    detail.unit.trim() === "" &&
    detail.remarksUpper.trim() === "" &&
    detail.remarksLower.trim() === "" &&
    detail.estimateDisplay.trim() === ""
  );
}

/**
 * 入力の無い明細・セットを取り除く（保存・読み込みのときに使う）。
 * 明細1件＝計算式1行の対応を崩さないよう、末尾の空明細だけを詰める。
 */
export function trimEmptySets(sets: CalcSet[]): CalcSet[] {
  const trimmed: CalcSet[] = [];
  for (const set of sets) {
    if (isCommentSet(set)) {
      trimmed.push(set);
      continue;
    }
    const details = [...set.details];
    while (
      details.length > 0 &&
      isEmptyDetail(details[details.length - 1]) &&
      isEmptyLine(set.lines[details.length - 1] ?? calcLine())
    )
      details.pop();
    const lines = [...set.lines];
    while (
      lines.length > Math.max(details.length, 1) &&
      isEmptyLine(lines[lines.length - 1])
    )
      lines.pop();
    const empty =
      details.length === 0 &&
      lines.every(isEmptyLine) &&
      set.partNumber === null &&
      set.partName.trim() === "" &&
      (set.banner?.text ?? "") === "";
    if (!empty) trimmed.push({ ...set, details, lines });
  }
  return trimmed;
}

/**
 * セットの途中の行に部位を入れたとき、その行から下を別のセットに分ける。
 * 4明細のセットを2明細ずつに分ける、といった直しができる。
 */
export function splitSetAt(
  sets: CalcSet[],
  setId: string,
  index: number,
  part: { partNumber: number | null; partName: string },
): CalcSet[] {
  const at = sets.findIndex((set) => set.id === setId);
  if (at < 0) return sets;
  const target = sets[at];
  if (index <= 0 || index >= target.details.length) return sets;
  const head: CalcSet = {
    ...target,
    details: target.details.slice(0, index),
    lines: target.lines.slice(0, index),
  };
  const tail: CalcSet = {
    ...calcSet(0),
    partNumber: part.partNumber,
    partName: part.partName,
    details: target.details.slice(index),
    lines: target.lines.slice(index),
  };
  const next = [...sets];
  next.splice(at, 1, head, {
    ...tail,
    lines: padLines(tail.details, tail.lines),
  });
  return next;
}

/**
 * セットを1つ消す。見出し（コメント行）が付いていたら、コメント行だけ残す。
 * コメント行は明細とは別のものなので、明細を消しても消えないようにする。
 */
export function removeSet(sets: CalcSet[], setId: string): CalcSet[] {
  const next: CalcSet[] = [];
  sets.forEach((set) => {
    if (set.id !== setId) {
      next.push(set);
      return;
    }
    if (isCommentSet(set)) return;
    if (set.banner != null)
      next.push(commentSet(set.banner.text, set.banner.color));
  });
  return next;
}

/** 部位を消したとき、そのセットを一つ上のセットにつなげる（記号は先頭のものを残す） */
export function mergeWithPreviousSet(
  sets: CalcSet[],
  setId: string,
): CalcSet[] {
  const at = sets.findIndex((set) => set.id === setId);
  if (at <= 0) return sets;
  // コメント行はセットではないので飛ばして、その上の明細セットにつなげる
  let previousAt = at - 1;
  while (previousAt >= 0 && isCommentSet(sets[previousAt])) previousAt -= 1;
  if (previousAt < 0) return sets;
  const previous = sets[previousAt];
  const target = sets[at];
  const merged: CalcSet = {
    ...previous,
    details: [...previous.details, ...target.details],
    lines: [...previous.lines, ...target.lines],
  };
  const next = [...sets];
  // つなげたセットに見出しが付いていたら、コメント行として残す
  next.splice(
    at,
    1,
    ...(target.banner != null
      ? [commentSet(target.banner.text, target.banner.color)]
      : []),
  );
  next[previousAt] = merged;
  return next;
}

/** セット内で表示する行数（明細1件＝1行。明細と計算式の多い方に合わせる） */
export function setRowCount(set: CalcSet): number {
  if (isCommentSet(set)) return 0;
  return Math.max(set.details.length, set.lines.length, 1);
}

/**
 * 計算結果の表示。小数点以下2桁まで。2桁では0になる場合は数字が出る桁まで伸ばす。
 * 見えない部分は四捨五入する（9.985→9.99、0.00035→0.0004）。
 */
export function displayQuantity(value: number): string {
  if (!Number.isFinite(value)) return "";
  for (let digits = 2; digits <= 10; digits += 1) {
    const rounded = roundTo(value, digits);
    if (rounded !== 0 || value === 0) return rounded.toFixed(digits);
  }
  return value.toFixed(10);
}

/** 表示されている数字を正とするため、表示桁で丸めた数値を返す */
export function displayedValue(value: number): number {
  const text = displayQuantity(value);
  return text === "" ? 0 : Number(text);
}

function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  const shifted = value * scale;
  // 0.5 は絶対値の大きい側へ（四捨五入）
  const rounded =
    shifted >= 0 ? Math.round(shifted + 1e-9) : -Math.round(-shifted + 1e-9);
  return rounded / scale;
}

export interface LineResult {
  /** 表示に使う数量（表示桁で丸めた値） */
  value: number | null;
  text: string;
  /** そのセットの累計（表示値の合計） */
  total: number | null;
  totalText: string;
  /** 式が誤っているときの理由（紫文字で表示する） */
  error: string;
}

export interface CalcSheetResult {
  lines: Map<string, LineResult>;
  /** セットごとの合計（表示値の合計） */
  setTotals: Map<string, number>;
  /** 誤りのある計算式（画面を閉じるときの注意喚起に使う） */
  errors: { setId: string; lineId: string; message: string }[];
}

const SYMBOL_PATTERN = /<[^<>]+>|[A-Za-z][A-Za-z0-9]*/g;

/** 式の中で値が分からない記号を探す */
function unknownSymbols(
  formula: string,
  variables: Record<string, number>,
): string[] {
  const text = normalizeFormula(formula);
  const found = text.match(SYMBOL_PATTERN) ?? [];
  return found.filter((name) => !(name in variables));
}

/**
 * 下段の計算式をすべて評価する。
 * B1〜B100 は他のセットの累計を指すので、解けるものから順に繰り返し評価する。
 */
export function evaluateCalcSheet(
  sets: CalcSet[],
  variables: Record<string, number>,
  /** セットの部位によって値が変わる記号（建具記号の採用値など） */
  setVariables?: (set: CalcSet) => Record<string, number>,
): CalcSheetResult {
  const bValues: Record<string, number> = {};
  const pending = new Set(sets.map((set) => set.id));
  const setTotals = new Map<string, number>();

  const evaluateSet = (
    set: CalcSet,
  ): { results: LineResult[]; resolved: boolean } => {
    let total = 0;
    let resolved = true;
    const perSet = setVariables ? setVariables(set) : {};
    const results = set.lines.map((line) => {
      const all = { ...variables, ...perSet, ...bValues };
      const a = line.formulaA.trim();
      const b = line.formulaB.trim();
      if (a === "") {
        return { value: null, text: "", total: null, totalText: "", error: "" };
      }
      const missing = [
        ...unknownSymbols(a, all),
        ...(b === "" ? [] : unknownSymbols(b, all)),
      ];
      if (missing.length > 0) {
        if (missing.some((name) => /^B([1-9]|[1-9][0-9])$/.test(name))) {
          resolved = false;
        }
        return {
          value: null,
          text: "",
          total: null,
          totalText: "",
          error: `記号 ${missing[0]} の数量が分かりません`,
        };
      }
      const valueA = evaluateFormula(a, all);
      const valueB = b === "" ? null : evaluateFormula(b, all);
      if (valueA === null || (b !== "" && valueB === null)) {
        return {
          value: null,
          text: "",
          total: null,
          totalText: "",
          error: "計算式が正しくありません",
        };
      }
      const value = displayedValue(valueB === null ? valueA : valueA * valueB);
      total = displayedValue(total + value);
      return {
        value,
        text: displayQuantity(value),
        total,
        totalText: displayQuantity(total),
        error: "",
      };
    });
    return { results, resolved };
  };

  const lastResults = new Map<string, LineResult[]>();
  for (let pass = 0; pass <= sets.length; pass += 1) {
    let changed = false;
    for (const set of sets) {
      const { results, resolved } = evaluateSet(set);
      lastResults.set(set.id, results);
      if (!resolved) continue;
      const total = results.reduce(
        (sum, result) => displayedValue(sum + (result.value ?? 0)),
        0,
      );
      setTotals.set(set.id, total);
      set.lines.forEach((line) => {
        const symbol = line.bSymbol.trim().toUpperCase();
        if (symbol !== "" && bValues[symbol] !== total) {
          bValues[symbol] = total;
          changed = true;
        }
      });
      if (pending.delete(set.id)) changed = true;
    }
    if (!changed) break;
  }

  const lines = new Map<string, LineResult>();
  const errors: CalcSheetResult["errors"] = [];
  sets.forEach((set) => {
    const results = lastResults.get(set.id) ?? [];
    set.lines.forEach((line, index) => {
      const result = results[index] ?? {
        value: null,
        text: "",
        total: null,
        totalText: "",
        error: "",
      };
      lines.set(line.id, result);
      if (result.error !== "")
        errors.push({ setId: set.id, lineId: line.id, message: result.error });
    });
  });
  return { lines, setTotals, errors };
}

/** 既に使われている B1〜B100 を集める（重複入力を防ぐ） */
export function usedBSymbols(sets: CalcSet[]): Set<string> {
  const used = new Set<string>();
  sets.forEach((set) =>
    set.lines.forEach((line) => {
      const symbol = line.bSymbol.trim().toUpperCase();
      if (symbol !== "") used.add(symbol);
    }),
  );
  return used;
}

/** まだ使っていない B 記号のうち、いちばん小さい番号 */
export function nextBSymbol(sets: CalcSet[]): string {
  const used = usedBSymbols(sets);
  for (let number = 1; number <= 100; number += 1) {
    const symbol = `B${number}`;
    if (!used.has(symbol)) return symbol;
  }
  return "";
}

/**
 * 部位・材種区分ごとの合計（部位別入力表のチェック表に使う）。
 * 明細が複数あるセットは、各明細に同じ数量が付く（セット明細の考え方）。
 */
export function quantityByPart(
  sets: CalcSet[],
  result: CalcSheetResult,
): { partName: string; materialCategory: string; quantity: number }[] {
  const totals = new Map<string, number>();
  sets.forEach((set) => {
    const total = result.setTotals.get(set.id) ?? 0;
    if (total === 0) return;
    set.details.forEach((detail) => {
      if (detail.name.trim() === "") return;
      const key = `${set.partName}\u0000${detail.materialCategory}`;
      const quantity = displayedValue(total * (detail.coefficient || 1));
      totals.set(key, displayedValue((totals.get(key) ?? 0) + quantity));
    });
  });
  return [...totals.entries()].map(([key, quantity]) => {
    const [partName, materialCategory] = key.split("\u0000");
    return { partName, materialCategory, quantity };
  });
}
