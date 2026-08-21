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

/** 部位で始まる1セット */
export interface CalcSet {
  id: string;
  /** 部位マスターの番号（番号入力で名称に変換する） */
  partNumber: number | null;
  partName: string;
  details: CalcDetail[];
  lines: CalcLine[];
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

/** 空のセット明細（初期は2明細分＝表示は4行） */
export function calcSet(detailCount = 2): CalcSet {
  return {
    id: newId("s"),
    partNumber: null,
    partName: "",
    details: Array.from({ length: detailCount }, () => calcDetail()),
    lines: Array.from({ length: detailCount * 2 }, () => calcLine()),
  };
}

/** セット内で表示する行数（明細は1件2行。明細と計算式の多い方に合わせる） */
export function setRowCount(set: CalcSet): number {
  return Math.max(set.details.length * 2, set.lines.length, 1);
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
): CalcSheetResult {
  const bValues: Record<string, number> = {};
  const pending = new Set(sets.map((set) => set.id));
  const setTotals = new Map<string, number>();

  const evaluateSet = (
    set: CalcSet,
  ): { results: LineResult[]; resolved: boolean } => {
    let total = 0;
    let resolved = true;
    const results = set.lines.map((line) => {
      const all = { ...variables, ...bValues };
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
