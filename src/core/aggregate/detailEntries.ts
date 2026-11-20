/**
 * 保存済みの集計詳細データ（数量根拠）を、集計し直せる形に戻す。
 * 部屋別集計・部位別集計のページと、内訳書のまとめ別転記で同じ変換を使う。
 */

import type { AggregateDetail } from "@shared/types";
import type {
  AggregateEntry,
  AggregateSourceKind,
} from "./aggregate";

const SOURCE_KINDS: AggregateSourceKind[] = [
  "room",
  "frame",
  "general",
  "pit",
  "area",
  "misc",
  "furniture",
  "fireproof",
  "transfer",
];

export function sourceKindOf(value: string): AggregateSourceKind {
  const found = SOURCE_KINDS.find((kind) => kind === value);
  return found ?? "room";
}

export function detailsToEntries(details: AggregateDetail[]): AggregateEntry[] {
  return details.map((detail) => ({
    traceId: detail.traceId,
    sourceKind: sourceKindOf(detail.sourceKind),
    estimateRowId: detail.estimateRowId,
    transferRowId: detail.transferRowId,
    part1: detail.part1,
    part2: detail.part2,
    part2Raw: detail.part2Raw,
    part2Split: detail.part2Split !== 0,
    part2Order: detail.part2Order,
    part3: detail.part3,
    formwork: detail.formwork,
    multiplier: detail.multiplier,
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
    estimateDisplay: detail.estimateDisplay,
    coefficient: detail.coefficient,
    setTotal: detail.setTotal,
    quantity: detail.quantity,
    sourceDetailId: detail.sourceDetailId,
  }));
}
