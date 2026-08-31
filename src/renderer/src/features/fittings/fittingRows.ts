import type { Fitting, FittingDraft } from "@shared/types";
import { compareSymbols } from "../../../../core/fittings/fitting";
import {
  evaluateFormula,
  normalizeFormula,
} from "../../../../core/formula/evaluate";
import type { GridColumn } from "../grid/gridClipboard";

export function toDrafts(rows: Fitting[]): FittingDraft[] {
  return rows.map(
    ({ id, projectId: _projectId, displayOrder: _displayOrder, ...rest }) => ({
      id,
      ...rest,
    }),
  );
}

export function emptyRow(): FittingDraft {
  return {
    id: null,
    symbol: "",
    name: "",
    width: null,
    height: null,
    sillHeight: null,
    widthFormula: "",
    heightFormula: "",
    sillHeightFormula: "",
    areaFormula: "",
    baseboardFormula: "",
    note: "",
    fromEstimate: 0,
  };
}

/** 寸法欄の表示（未入力は空欄、入力済みは小数2桁） */
export function formatNumber(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

export function parseNumber(text: string): {
  value: number | null;
  error?: string;
} {
  const trimmed = text
    .trim()
    .replace(/[０-９．]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
  if (trimmed === "") return { value: null };
  const value = Number(trimmed);
  if (Number.isNaN(value))
    return { value: null, error: "数値で入力してください" };
  return { value: Math.round(value * 100) / 100 };
}

/**
 * W・H・腰高の欄の入力を読み取る。
 * 数字だけならそのまま、`900+150` のような計算式なら計算結果を値にし、式も残す。
 */
export function parseSize(text: string): {
  value: number | null;
  formula: string;
  error?: string;
} {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null, formula: "" };
  const plain = parseNumber(trimmed);
  if (!plain.error) return { value: plain.value, formula: "" };
  const value = evaluateFormula(trimmed);
  if (value === null || !Number.isFinite(value)) {
    return {
      value: null,
      formula: "",
      error: "数値か計算式（例 900+150）で入力してください",
    };
  }
  return {
    value: Math.round(value * 100) / 100,
    formula: normalizeFormula(trimmed),
  };
}

export function insertRow(rows: FittingDraft[], index: number): FittingDraft[] {
  const at = Math.min(Math.max(index, 0), rows.length);
  return [...rows.slice(0, at), emptyRow(), ...rows.slice(at)];
}

export function removeRow(rows: FittingDraft[], index: number): FittingDraft[] {
  if (index < 0 || index >= rows.length) return rows;
  return rows.filter((_row, i) => i !== index);
}

export function updateRow(
  rows: FittingDraft[],
  index: number,
  patch: Partial<FittingDraft>,
): FittingDraft[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

/**
 * 建具記号の昇順に並べ替える。
 * 積算入力から登録された行は建具表入力の後ろへまとめる。
 */
export function sortBySymbol(rows: FittingDraft[]): FittingDraft[] {
  return [...rows].sort((a, b) => {
    if (a.fromEstimate !== b.fromEstimate)
      return a.fromEstimate - b.fromEstimate;
    return compareSymbols(a.symbol, b.symbol);
  });
}

/** 自動計算列。貼り付け位置を画面と合わせるために列は持つが、値は取り込まない */
function calculatedColumn(
  key: string,
  label: string,
): GridColumn<FittingDraft> {
  return {
    key,
    label,
    get: () => "",
    set: (row, value) =>
      value.trim() === ""
        ? { row }
        : { row, warning: `${label}は自動計算のため取り込みません` },
  };
}

/** Excelからの貼り付け・コピーで扱う列（画面の列順と同じ） */
export function buildFittingColumns(): GridColumn<FittingDraft>[] {
  const numberColumn = (
    key: string,
    label: string,
    get: (row: FittingDraft) => number | null,
    set: (
      row: FittingDraft,
      value: number | null,
      formula: string,
    ) => FittingDraft,
  ): GridColumn<FittingDraft> => ({
    key,
    label,
    get: (row) => formatNumber(get(row)),
    set: (row, text) => {
      const parsed = parseSize(text);
      return parsed.error
        ? { row, error: parsed.error }
        : { row: set(row, parsed.value, parsed.formula) };
    },
  });

  return [
    {
      key: "symbol",
      label: "建具記号",
      get: (row) => row.symbol,
      set: (row, value) => ({ row: { ...row, symbol: value.trim() } }),
    },
    numberColumn(
      "width",
      "W",
      (row) => row.width,
      (row, value, formula) => ({
        ...row,
        width: value,
        widthFormula: formula,
      }),
    ),
    numberColumn(
      "height",
      "H",
      (row) => row.height,
      (row, value, formula) => ({
        ...row,
        height: value,
        heightFormula: formula,
      }),
    ),
    numberColumn(
      "sillHeight",
      "腰高",
      (row) => row.sillHeight,
      (row, value, formula) => ({
        ...row,
        sillHeight: value,
        sillHeightFormula: formula,
      }),
    ),
    // 面積・巾木減・軸組横補強は自動計算。Excelの表をそのまま貼れるよう列は用意し、値は取り込まない
    calculatedColumn("area", "面積"),
    calculatedColumn("baseboardDeduction", "巾木減"),
    calculatedColumn("reinforcement", "軸組横補強"),
    {
      key: "areaFormula",
      label: "面積計算（自動計算修正用）",
      get: (row) => row.areaFormula,
      set: (row, value) => ({ row: { ...row, areaFormula: value.trim() } }),
    },
    {
      key: "baseboardFormula",
      label: "巾木長さ（自動計算修正用）",
      get: (row) => row.baseboardFormula,
      set: (row, value) => ({
        row: { ...row, baseboardFormula: value.trim() },
      }),
    },
    {
      key: "note",
      label: "その他（備考）",
      get: (row) => row.note,
      set: (row, value) => ({ row: { ...row, note: value } }),
    },
  ];
}
