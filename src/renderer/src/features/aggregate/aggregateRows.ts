import type { AggregateDetail } from "@shared/types";
import type {
  AggregateEntry,
  AggregateSourceKind,
} from "../../../../core/aggregate/aggregate";

const SOURCE_KINDS: AggregateSourceKind[] = [
  "room",
  "frame",
  "general",
  "pit",
  "misc",
  "transfer",
];

export const SOURCE_LABEL: Record<AggregateSourceKind, string> = {
  room: "部屋計算書",
  frame: "軸組計算書",
  general: "汎用計算書",
  pit: "ピット計算書",
  misc: "部位別雑・金物入力表",
  transfer: "転記入力表",
};

function sourceKindOf(value: string): AggregateSourceKind {
  const found = SOURCE_KINDS.find((kind) => kind === value);
  return found ?? "room";
}

/** 数量根拠の出所（部屋計算書・軸組計算書・汎用計算書・転記入力表） */
export function sourceLabelOf(value: string): string {
  return SOURCE_LABEL[sourceKindOf(value)];
}

/** 保存済みの集計詳細データ（数量根拠）を、集計し直せる形に戻す */
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
