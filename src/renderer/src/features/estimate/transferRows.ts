import type {
  Detail,
  EstimateRow,
  TransferRow,
  TransferRowDraft,
} from "@shared/types";
import {
  inheritTransferRows,
  type InheritedTransfer,
} from "../../../../core/aggregate/transferInherit";

export type { InheritedTransfer };

export function toTransferDrafts(rows: TransferRow[]): TransferRowDraft[] {
  return rows.map(
    ({ id, projectId: _projectId, displayOrder: _displayOrder, ...rest }) => ({
      id,
      ...rest,
    }),
  );
}

export function emptyTransferRow(): TransferRowDraft {
  return {
    id: null,
    part1: "",
    part2: "",
    part2Split: 0,
    formwork: "",
    part3: "",
    subjectId: null,
    materialCategory: "",
    partId: null,
    partName: "",
    detailNumber: null,
    name: "",
    sourceDetailId: null,
    descriptionUpper: "",
    descriptionLower: "",
    quantity: null,
    unit: "",
    unitPrice: null,
    amount: null,
    remarks: "",
    memo: "",
  };
}

/** A〜Iは入力がない場合、入力のある上の行と同じ入力があるものとして扱う（集計と同じ規則） */
export function resolveTransferInherited(
  rows: TransferRowDraft[],
): InheritedTransfer[] {
  return inheritTransferRows(rows);
}

export function insertTransferRow(
  rows: TransferRowDraft[],
  index: number,
): TransferRowDraft[] {
  const at = Math.min(Math.max(index, 0), rows.length);
  return [...rows.slice(0, at), emptyTransferRow(), ...rows.slice(at)];
}

export function removeTransferRow(
  rows: TransferRowDraft[],
  index: number,
): TransferRowDraft[] {
  if (index < 0 || index >= rows.length) return rows;
  return rows.filter((_row, i) => i !== index);
}

export function updateTransferRow(
  rows: TransferRowDraft[],
  index: number,
  patch: Partial<TransferRowDraft>,
): TransferRowDraft[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

/** 部位別入力表に入力した部位（A〜G）を呼び出して転記する */
export function applyEstimateParts(
  row: TransferRowDraft,
  source: EstimateRow,
): TransferRowDraft {
  return {
    ...row,
    part1: source.part1,
    part2: source.part2,
    part2Split: source.part2Split,
    formwork: source.formwork,
    part3: source.part3,
  };
}

/** 基本マスター・物件専用マスターの明細を1明細として転記する（セット明細は使わない） */
export function applyDetail(
  row: TransferRowDraft,
  detail: Detail,
): TransferRowDraft {
  return {
    ...row,
    subjectId: detail.subjectId,
    materialCategory: detail.materialCategory,
    detailNumber: detail.detailNumber,
    partName: detail.partName,
    name: detail.name,
    sourceDetailId: detail.id,
    descriptionUpper: detail.descriptionUpper,
    descriptionLower: detail.descriptionLower,
    unit: detail.unit,
  };
}

export function formatQuantity(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

/** 数量は小数2桁で四捨五入して保持する */
export function parseQuantity(text: string): {
  value: number | null;
  error?: string;
} {
  const trimmed = text
    .trim()
    .replace(/[０-９．－]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    );
  if (trimmed === "") return { value: null };
  const value = Number(trimmed);
  if (Number.isNaN(value)) return { value: null, error: "数値で入力してください" };
  return { value: Math.round(value * 100) / 100 };
}
