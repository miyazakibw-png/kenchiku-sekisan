/**
 * 集計処理。
 * 計算書（部屋別・軸組・汎用）の下段セット明細と転記入力表を1件ずつ「集計詳細データ」にし、
 * 同じ明細どうしをまとめて「集計書兼工事マスター」の行を作る。
 * 詳細データは数量根拠（部屋→計算書→セット→明細）を残すため合算前の姿で保持する。
 */

import {
  displayedValue,
  type CalcSet,
  type CalcSheetResult,
} from "../room/calcSheet";

/** 計算書の種類。transfer は転記入力表（根拠集計には出さない） */
export type AggregateSourceKind =
  | "room"
  | "frame"
  | "general"
  | "pit"
  | "transfer";

/** 合算前の1件（集計詳細データの1行） */
export interface AggregateEntry {
  /** 数量根拠を追うためのID（計算書のセットID・明細ID／転記行ID） */
  traceId: string;
  sourceKind: AggregateSourceKind;
  estimateRowId: number | null;
  transferRowId: number | null;
  part1: string;
  /** 仕分け✔のときだけ集計キーに使う部位Ⅱ */
  part2: string;
  /** 表示・根拠用の部位Ⅱ（仕分けの有無に関わらず持つ） */
  part2Raw: string;
  part2Split: boolean;
  /** 部位Ⅱの入力順（並べ替えに使う） */
  part2Order: number;
  part3: string;
  formwork: string;
  multiplier: number;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  coefficient: number;
  /** セットの累計（掛け率・倍率をかける前） */
  setTotal: number;
  /** 計上数量＝セット累計×掛け率×倍率 */
  quantity: number;
  sourceDetailId: number | null;
}

/** 集計後の1明細（集計書兼工事マスターの1行＝画面では上下2行） */
export interface AggregatedItem {
  /** 同じ明細をまとめるキー（マスターID。集計をかけ直しても変わらない） */
  masterKey: string;
  part1: string;
  part2: string;
  part2Raw: string;
  part2Order: number;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  formwork: string;
  /** 不要明細（人が印を付けた明細。内訳書へは飛ばさず工種科目の最後にまとめる） */
  unused: boolean;
  quantity: number;
  /** 根拠（部屋別の内訳）。転記入力表の分は入れない */
  rooms: { roomName: string; quantity: number }[];
  /** この行を作った詳細データのID */
  traceIds: string[];
}

export interface EstimateRowContext {
  estimateRowId: number | null;
  part1: string;
  part2: string;
  part2Split: boolean;
  part2Order: number;
  part3: string;
  formwork: string;
  multiplier: number;
  sourceKind: AggregateSourceKind;
}

/** 計算書1枚分（下段のセット明細）から集計詳細データを作る */
export function entriesFromCalcSheet(
  context: EstimateRowContext,
  sets: CalcSet[],
  result: CalcSheetResult,
): AggregateEntry[] {
  const entries: AggregateEntry[] = [];
  const multiplier = context.multiplier === 0 ? 1 : context.multiplier;
  sets.forEach((set) => {
    const total = result.setTotals.get(set.id) ?? 0;
    set.details.forEach((detail) => {
      if (detail.name.trim() === "" && detail.partName.trim() === "") return;
      const coefficient = detail.coefficient || 1;
      // 明細に入れた部位をそのまま使う。どちらも空欄のときだけセットの部位を使う
      const noPart =
        (detail.partNumber ?? null) === null && detail.partName.trim() === "";
      entries.push({
        traceId: `${context.estimateRowId ?? 0}:${set.id}:${detail.id}`,
        sourceKind: context.sourceKind,
        estimateRowId: context.estimateRowId,
        transferRowId: null,
        part1: context.part1,
        part2: context.part2Split ? context.part2 : "",
        part2Raw: context.part2,
        part2Split: context.part2Split,
        part2Order: context.part2Order,
        part3: context.part3,
        formwork: context.formwork,
        multiplier,
        subjectId: detail.subjectId,
        materialCategory: detail.materialCategory,
        partNumber: noPart ? set.partNumber : detail.partNumber,
        partName: noPart ? set.partName : detail.partName,
        detailNumber: detail.detailNumber,
        name: detail.name,
        descriptionUpper: detail.descriptionUpper,
        descriptionLower: detail.descriptionLower,
        unit: detail.unit,
        remarksUpper: detail.remarksUpper,
        remarksLower: detail.remarksLower,
        estimateDisplay: detail.estimateDisplay,
        coefficient,
        setTotal: total,
        quantity: displayedValue(total * coefficient * multiplier),
        sourceDetailId: detail.sourceDetailId,
      });
    });
  });
  return entries;
}

/** 集計キー（同じ明細としてまとめる単位）。部位Ⅱは仕分け✔のときだけ含める */
export function masterKeyOf(entry: {
  part1: string;
  part2: string;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
}): string {
  return [
    entry.part1,
    entry.part2,
    entry.subjectId ?? "",
    entry.materialCategory,
    entry.partNumber ?? "",
    entry.partName,
    entry.detailNumber ?? "",
    entry.name,
    entry.descriptionUpper,
    entry.descriptionLower,
    entry.unit,
    entry.remarksUpper,
    entry.remarksLower,
    entry.estimateDisplay,
  ].join("|");
}

/** 根拠に出す部屋名（部位Ⅱ：部位Ⅲ。倍率が1でなければ「× 2」を付ける） */
export function traceRoomName(entry: AggregateEntry): string {
  const base =
    entry.part3 === "" || entry.part3 === entry.part2Raw
      ? entry.part2Raw
      : `${entry.part2Raw}：${entry.part3}`;
  return entry.multiplier === 1 ? base : `${base} × ${entry.multiplier}`;
}

function numberOrder(value: number | null): string {
  const number = value ?? 99999999;
  return number.toFixed(3).padStart(12, "0");
}

/**
 * 集計詳細データをまとめて集計書兼工事マスターの行にする。
 * 並びは 科目ID→部位Ⅰ→部位Ⅱ（入力順）→部位ID→明細ID→部位名→名称→摘要（下）→摘要（上）。
 */
export function aggregateItems(
  entries: AggregateEntry[],
  skipPart2SubjectIds: ReadonlySet<number> = new Set(),
  unusedMasterKeys: ReadonlySet<string> = new Set(),
): AggregatedItem[] {
  const map = new Map<string, AggregatedItem>();
  entries.forEach((entry) => {
    const part2 =
      entry.subjectId !== null && skipPart2SubjectIds.has(entry.subjectId)
        ? ""
        : entry.part2;
    const keySource = { ...entry, part2 };
    const masterKey = masterKeyOf(keySource);
    const found = map.get(masterKey);
    const item: AggregatedItem = found ?? {
      masterKey,
      part1: entry.part1,
      part2,
      part2Raw: entry.part2Raw,
      part2Order: entry.part2Order,
      subjectId: entry.subjectId,
      materialCategory: entry.materialCategory,
      partNumber: entry.partNumber,
      partName: entry.partName,
      detailNumber: entry.detailNumber,
      name: entry.name,
      descriptionUpper: entry.descriptionUpper,
      descriptionLower: entry.descriptionLower,
      unit: entry.unit,
      remarksUpper: entry.remarksUpper,
      remarksLower: entry.remarksLower,
      estimateDisplay: entry.estimateDisplay,
      formwork: entry.formwork,
      unused: unusedMasterKeys.has(masterKey),
      quantity: 0,
      rooms: [],
      traceIds: [],
    };
    item.quantity = displayedValue(item.quantity + entry.quantity);
    item.part2Order = Math.min(item.part2Order, entry.part2Order);
    item.traceIds.push(entry.traceId);
    // 転記入力表の分は根拠集計には出さない
    if (entry.sourceKind !== "transfer" && entry.quantity !== 0) {
      const roomName = traceRoomName(entry);
      const room = item.rooms.find((current) => current.roomName === roomName);
      if (room) room.quantity = displayedValue(room.quantity + entry.quantity);
      else item.rooms.push({ roomName, quantity: entry.quantity });
    }
    map.set(masterKey, item);
  });

  return [...map.values()].sort((a, b) => {
    const keyOf = (item: AggregatedItem): string =>
      [
        String(item.subjectId ?? 99999).padStart(5, "0"),
        // 不要明細は工種科目の最後にまとめる
        item.unused ? "9" : "0",
        item.part1,
        item.part2 === "" ? " " : String(item.part2Order).padStart(5, "0"),
        item.part2,
        numberOrder(item.partNumber),
        numberOrder(item.detailNumber),
        item.partName,
        item.name,
        item.descriptionLower,
        item.descriptionUpper,
      ].join("|");
    return keyOf(a).localeCompare(keyOf(b), "ja");
  });
}

/** 部屋別集計の1グループ（部位Ⅲごと） */
export interface RoomAggregateGroup {
  roomName: string;
  /** 部位別入力表に出てくる順番 */
  order: number;
  items: AggregatedItem[];
  quantityTotal: number;
}

/**
 * 部屋別集計。部位Ⅲ（部屋名）を工種科目の代わりに使ってまとめる。
 * 並びは 部屋（部位別入力表の入力順）→科目ID→部位番号→明細番号→部位名。
 * 転記入力表の分は根拠に出さないので入れない。
 */
export function aggregateByRoom(
  entries: AggregateEntry[],
  roomOrder: readonly string[] = [],
): RoomAggregateGroup[] {
  const orderOf = (roomName: string): number => {
    const index = roomOrder.indexOf(roomName);
    return index < 0 ? 9999 : index;
  };
  const byRoom = new Map<string, AggregateEntry[]>();
  entries.forEach((entry) => {
    if (entry.sourceKind === "transfer") return;
    const roomName = entry.part3.trim();
    if (roomName === "") return;
    const found = byRoom.get(roomName);
    if (found) found.push(entry);
    else byRoom.set(roomName, [entry]);
  });

  return [...byRoom.entries()]
    .map(([roomName, roomEntries]) => {
      const items = aggregateItems(roomEntries).map((item) => ({
        ...item,
        rooms: [],
      }));
      return {
        roomName,
        order: orderOf(roomName),
        items,
        quantityTotal: displayedValue(
          items.reduce((total, item) => total + item.quantity, 0),
        ),
      };
    })
    .sort((a, b) =>
      a.order === b.order
        ? a.roomName.localeCompare(b.roomName, "ja")
        : a.order - b.order,
    );
}

/** 数量・単位チェックの結果。error＝赤、warn＝黄 */
export type QuantityCheck = "" | "error" | "warn";

/** 整数でしか拾わない単位 */
const INTEGER_UNITS = ["か所", "ヶ所", "箇所", "本", "台", "枚", "組", "基"];

/**
 * 数量と単位の整合チェック。
 * 単位ありで数量なし／0以下は赤、ヶ所・本等で小数は赤、式で1以外は赤、
 * 数量ありで単位なしは黄。
 */
export function checkQuantityUnit(
  quantity: number | null,
  unit: string,
): QuantityCheck {
  const trimmed = unit.trim();
  if (trimmed !== "") {
    if (quantity === null || !Number.isFinite(quantity)) return "error";
    if (quantity <= 0) return "error";
    if (INTEGER_UNITS.includes(trimmed) && !Number.isInteger(quantity))
      return "error";
    if (trimmed === "式" && quantity !== 1) return "error";
    return "";
  }
  if (quantity !== null && quantity !== 0) return "warn";
  return "";
}
