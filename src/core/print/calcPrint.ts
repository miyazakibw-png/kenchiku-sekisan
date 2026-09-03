import type { CalcSet, CalcSheetResult } from "../room/calcSheet";
import {
  displayQuantity,
  displayedValue,
  setRowCount,
} from "../room/calcSheet";

/** 計算書（下段）の印刷1行。画面の並びのまま、文字にしてから紙へ出す */
export interface CalcPrintRow {
  /** 見出し（※行）のときは色付きの1行として出す */
  banner: { text: string; color: string } | null;
  setPart: string;
  materialCategory: string;
  subjectId: string;
  partNumber: string;
  detailNumber: string;
  partName: string;
  name: string;
  descriptionLower: string;
  descriptionUpper: string;
  unit: string;
  coefficient: string;
  setTotal: string;
  comment: string;
  formulaA: string;
  formulaB: string;
  value: string;
  total: string;
  bSymbol: string;
  remarksLower: string;
  remarksUpper: string;
}

/** 計算書（下段）の列見出し。左端の部位から右から3番目の備考（上段）まで */
export const CALC_PRINT_COLUMNS: { label: string; width: number }[] = [
  { label: "部位", width: 80 },
  { label: "区分", width: 56 },
  { label: "科目", width: 42 },
  { label: "部位ID", width: 48 },
  { label: "名称ID", width: 54 },
  { label: "部位", width: 90 },
  { label: "名称", width: 190 },
  { label: "摘要（下段）", width: 170 },
  { label: "摘要（上段）", width: 140 },
  { label: "単位", width: 44 },
  { label: "掛け率", width: 48 },
  { label: "部位合計", width: 68 },
  { label: "コメント", width: 96 },
  { label: "計算式Ａ", width: 200 },
  { label: "計算式Ｂ", width: 80 },
  { label: "Ａ*Ｂ", width: 66 },
  { label: "Ａ*Ｂ累計", width: 66 },
  { label: "記号", width: 48 },
  { label: "備考（下段）", width: 90 },
  { label: "備考（上段）", width: 90 },
];

function emptyRow(): CalcPrintRow {
  return {
    banner: null,
    setPart: "",
    materialCategory: "",
    subjectId: "",
    partNumber: "",
    detailNumber: "",
    partName: "",
    name: "",
    descriptionLower: "",
    descriptionUpper: "",
    unit: "",
    coefficient: "",
    setTotal: "",
    comment: "",
    formulaA: "",
    formulaB: "",
    value: "",
    total: "",
    bSymbol: "",
    remarksLower: "",
    remarksUpper: "",
  };
}

/** 画面の計算書（セット明細）を、紙に出す1行ずつの並びに直す */
export function calcPrintRows(
  sets: CalcSet[],
  result: CalcSheetResult,
): CalcPrintRow[] {
  const rows: CalcPrintRow[] = [];
  sets.forEach((set) => {
    if (set.banner) {
      rows.push({
        ...emptyRow(),
        banner: { text: set.banner.text, color: set.banner.color },
      });
    }
    const count = setRowCount(set);
    const setTotal = result.setTotals.get(set.id) ?? null;
    const bSymbol =
      set.lines.find((line) => line.bSymbol.trim() !== "")?.bSymbol ?? "";
    for (let index = 0; index < count; index += 1) {
      const detail = set.details[index];
      const line = set.lines[index];
      const lineResult = line ? result.lines.get(line.id) : undefined;
      rows.push({
        ...emptyRow(),
        setPart: index === 0 ? set.partName : "",
        materialCategory: detail?.materialCategory ?? "",
        subjectId:
          detail?.subjectId === null ? "" : String(detail?.subjectId ?? ""),
        partNumber:
          detail?.partNumber === null ? "" : String(detail?.partNumber ?? ""),
        detailNumber: detail?.detailNumber?.toFixed(2) ?? "",
        partName: detail?.partName ?? "",
        name: detail?.name ?? "",
        descriptionLower: detail?.descriptionLower ?? "",
        descriptionUpper: detail?.descriptionUpper ?? "",
        unit: detail?.unit ?? "",
        coefficient: detail ? String(detail.coefficient) : "",
        setTotal:
          detail && setTotal !== null
            ? displayQuantity(
                displayedValue(setTotal * (detail.coefficient || 1)),
              )
            : "",
        comment: line?.comment ?? "",
        formulaA: line?.formulaA ?? "",
        formulaB: line?.formulaB ?? "",
        value: lineResult
          ? lineResult.error !== ""
            ? lineResult.error
            : lineResult.text
          : "",
        total: lineResult?.totalText ?? "",
        bSymbol: index === 0 ? bSymbol : "",
        remarksLower: detail?.remarksLower ?? "",
        remarksUpper: detail?.remarksUpper ?? "",
      });
    }
  });
  return rows;
}

/** 紙1枚分（計算式の行と、下の空白を埋める横罫線の本数） */
export interface CalcPrintPage {
  rows: CalcPrintRow[];
  /** 手書き用の横罫線だけを引く行数（紙の下の空白を埋める） */
  blankRows: number;
}

/**
 * 計算書の行を紙に割り付ける。
 * 1枚目は上段の図と入力表の分だけ入る行数が少なく、2枚目からは下段だけになる。
 * 余った下は手入力できるよう横罫線で埋める。
 */
export function paginateCalcRows(
  rows: CalcPrintRow[],
  firstCapacity: number,
  laterCapacity: number,
): CalcPrintPage[] {
  const first = Math.max(firstCapacity, 0);
  const later = Math.max(laterCapacity, 1);
  if (rows.length <= first) return [{ rows, blankRows: first - rows.length }];
  const pages: CalcPrintPage[] = [{ rows: rows.slice(0, first), blankRows: 0 }];
  let at = first;
  while (at < rows.length) {
    const slice = rows.slice(at, at + later);
    pages.push({ rows: slice, blankRows: later - slice.length });
    at += later;
  }
  return pages;
}
