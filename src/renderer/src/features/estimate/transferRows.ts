import type {
  Detail,
  MasterEntry,
  EstimateRow,
  TransferRow,
  TransferRowDraft,
} from "@shared/types";
import { resolveMasterName } from "@shared/masters";
import type { GridColumn } from "../grid/gridClipboard";
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
    remarksLower: "",
    memo: "",
    formworkKey: "",
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
  // マスター側が空欄の項目は、先に入れてある部位・区分・単位を消さない
  return {
    ...row,
    subjectId: detail.subjectId,
    materialCategory: detail.materialCategory || row.materialCategory,
    detailNumber: detail.detailNumber,
    partName: detail.partName || row.partName,
    name: detail.name,
    sourceDetailId: detail.id,
    descriptionUpper: detail.descriptionUpper,
    descriptionLower: detail.descriptionLower,
    unit: detail.unit || row.unit,
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
  if (Number.isNaN(value))
    return { value: null, error: "数値で入力してください" };
  return { value: Math.round(value * 100) / 100 };
}

/** 転記入力表でエクセルから貼り付けられる列（科目IDから右） */
export function buildTransferColumns(
  materials: readonly MasterEntry[],
  units: readonly MasterEntry[],
  parts: readonly MasterEntry[],
): GridColumn<TransferRowDraft>[] {
  const text = (
    key:
      | "materialCategory"
      | "partName"
      | "name"
      | "descriptionUpper"
      | "descriptionLower"
      | "unit"
      | "remarks"
      | "remarksLower",
    label: string,
    entries?: readonly MasterEntry[],
  ): GridColumn<TransferRowDraft> => ({
    key,
    label,
    get: (row) => row[key],
    set: (row, value) => ({
      row: {
        ...row,
        [key]: entries ? resolveMasterName([...entries], value) : value,
      },
    }),
  });

  return [
    {
      key: "subjectId",
      label: "科目ID",
      get: (row) => (row.subjectId === null ? "" : String(row.subjectId)),
      set: (row, value) => {
        const trimmed = value.trim();
        if (trimmed === "") return { row: { ...row, subjectId: null } };
        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isNaN(parsed))
          return { row, error: "科目IDは数字で入れてください" };
        return { row: { ...row, subjectId: parsed } };
      },
    },
    text("materialCategory", "仕上区分", materials),
    {
      key: "partId",
      label: "部位ID",
      get: (row) => (row.partId === null ? "" : String(row.partId)),
      set: (row, value) => {
        const trimmed = value.trim();
        if (trimmed === "") return { row: { ...row, partId: null } };
        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isNaN(parsed))
          return { row, error: "部位IDは数字で入れてください" };
        const part = parts.find((item) => item.id === parsed);
        return {
          row: {
            ...row,
            partId: parsed,
            partName: part ? part.name : row.partName,
          },
        };
      },
    },
    {
      key: "detailNumber",
      label: "明細ID",
      get: (row) =>
        row.detailNumber === null ? "" : row.detailNumber.toFixed(2),
      set: (row, value) => {
        const trimmed = value.trim();
        if (trimmed === "") return { row: { ...row, detailNumber: null } };
        const parsed = Number.parseFloat(trimmed);
        if (Number.isNaN(parsed))
          return { row, error: "明細IDは数字で入れてください" };
        return { row: { ...row, detailNumber: parsed } };
      },
    },
    {
      key: "partName",
      label: "部位名",
      get: (row) => row.partName,
      // 空欄のときは部位IDから入れた部位名を消さない
      set: (row, value) => ({
        row: value.trim() === "" ? row : { ...row, partName: value },
      }),
    },
    text("name", "名称"),
    text("descriptionUpper", "摘要（上段）"),
    text("descriptionLower", "摘要（下段）"),
    {
      key: "quantity",
      label: "数量",
      get: (row) => formatQuantity(row.quantity),
      set: (row, value) => {
        const parsed = parseQuantity(value);
        if (parsed.error) return { row, error: parsed.error };
        return { row: { ...row, quantity: parsed.value } };
      },
    },
    text("unit", "単位", units),
    text("remarks", "備考（上段）"),
    text("remarksLower", "備考（下段）"),
  ];
}
