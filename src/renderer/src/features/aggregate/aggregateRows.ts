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
  "area",
  "misc",
  "furniture",
  "fireproof",
  "transfer",
];

export const SOURCE_LABEL: Record<AggregateSourceKind, string> = {
  room: "部屋計算書",
  frame: "軸組計算書",
  general: "汎用計算書",
  pit: "ピット計算書",
  area: "面積計算書",
  misc: "部位別雑・金物入力表",
  furniture: "家具・設備入力表",
  fireproof: "耐火被覆・塗装入力表",
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

/** 数量根拠の1件から開く出所（計算書・入力表） */
export type SourceJump =
  | { kind: "calcSheet"; estimateRowId: number }
  | { kind: "misc"; rowId: string }
  | { kind: "furniture"; sheetId: number }
  | { kind: "fireproof"; rowId: string }
  | { kind: "transfer" }
  | null;

/**
 * 数量根拠の1件が、どの表のどこから来たかを返す。
 * 計算書（部屋・軸組・汎用・ピット）は部位別入力表の行、
 * 家具・設備入力表は表のid、部位別雑・金物入力表は行のid（表は呼び出し側で探す）。
 */
export function sourceJumpOf(detail: {
  sourceKind: string;
  estimateRowId: number | null;
  traceId: string;
}): SourceJump {
  const parts = detail.traceId.split(":");
  switch (sourceKindOf(detail.sourceKind)) {
    case "misc":
      return parts[1] ? { kind: "misc", rowId: parts[1] } : null;
    case "furniture": {
      const sheetId = Number(parts[1]);
      return Number.isFinite(sheetId) && sheetId > 0
        ? { kind: "furniture", sheetId }
        : null;
    }
    case "fireproof":
      return parts[1] ? { kind: "fireproof", rowId: parts[1] } : null;
    case "transfer":
      return { kind: "transfer" };
    default:
      return detail.estimateRowId === null
        ? null
        : { kind: "calcSheet", estimateRowId: detail.estimateRowId };
  }
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
