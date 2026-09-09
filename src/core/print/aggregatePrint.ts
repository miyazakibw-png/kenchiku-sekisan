import { displayQuantity } from "../room/calcSheet";

/** 集計書の印刷に使う明細（画面の集計書兼工事マスターの1明細） */
export interface AggregatePrintItem {
  masterKey: string;
  subjectId: number | null;
  part1: string;
  part2: string;
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
  unused: boolean;
  quantity: number;
  /** 数量根拠（部屋＝部位Ⅱ：部位Ⅲ ごとの拾い） */
  rooms: { roomName: string; quantity: number }[];
}

/** 紙に出す1行（見出し・明細・数量根拠の部屋） */
export type AggregatePrintRow =
  | { kind: "heading"; text: string }
  | {
      kind: "item";
      subjectId: string;
      materialCategory: string;
      number: string;
      name: string;
      description: string;
      quantity: string;
      unit: string;
      remarks: string;
    }
  | {
      kind: "room";
      roomName: string;
      quantity: string;
      /** 前のページから続いている根拠（続きの部屋から印刷する） */
      continued: boolean;
      /** 続きのときに添える明細の名称 */
      itemName: string;
    };

export const AGGREGATE_PRINT_COLUMNS: { label: string; width: number }[] = [
  { label: "科目ID", width: 54 },
  { label: "材種区分", width: 78 },
  { label: "部位番号／明細番号", width: 110 },
  { label: "部位名／名称・数量根拠（部屋）", width: 260 },
  { label: "摘要", width: 220 },
  { label: "数量", width: 80 },
  { label: "単位", width: 46 },
  { label: "備考", width: 120 },
];

function numberText(value: number | null): string {
  return value === null ? "" : String(value);
}

/** 明細番号は小数2桁（画面と同じ） */
function detailNumberText(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

/**
 * 集計書の明細を、紙に出す行の並びに直す。
 * 明細の下に、その明細を拾った根拠（部屋ごとの数量）を並べる。
 */
export function aggregatePrintRows(
  items: AggregatePrintItem[],
  subjectName: (subjectId: number | null) => string,
): AggregatePrintRow[] {
  const rows: AggregatePrintRow[] = [];
  let subjectId: number | null | undefined;
  let part1: string | undefined;
  let part2: string | undefined;
  let unused: boolean | undefined;
  items.forEach((item) => {
    if (subjectId !== item.subjectId) {
      subjectId = item.subjectId;
      part1 = undefined;
      part2 = undefined;
      unused = undefined;
      rows.push({ kind: "heading", text: subjectName(item.subjectId) });
    }
    if (unused !== item.unused && item.unused) {
      unused = item.unused;
      part1 = undefined;
      part2 = undefined;
      rows.push({ kind: "heading", text: "【不要明細】" });
    }
    if (part1 !== item.part1) {
      part1 = item.part1;
      part2 = undefined;
      if (item.part1 !== "")
        rows.push({ kind: "heading", text: `（${item.part1}）` });
    }
    if (part2 !== item.part2) {
      part2 = item.part2;
      if (item.part2 !== "")
        rows.push({ kind: "heading", text: `＜${item.part2}＞` });
    }
    const description = [item.descriptionUpper, item.descriptionLower]
      .filter((text) => text.trim() !== "")
      .join(" / ");
    const remarks = [item.remarksUpper, item.remarksLower]
      .filter((text) => text.trim() !== "")
      .join(" / ");
    rows.push({
      kind: "item",
      subjectId: numberText(item.subjectId),
      materialCategory: item.materialCategory,
      number: [numberText(item.partNumber), detailNumberText(item.detailNumber)]
        .filter((text) => text !== "")
        .join(" / "),
      name: [item.partName, item.name]
        .filter((text) => text.trim() !== "")
        .join(" / "),
      description,
      quantity: displayQuantity(item.quantity),
      unit: item.unit,
      remarks,
    });
    item.rooms.forEach((room) => {
      rows.push({
        kind: "room",
        roomName: room.roomName,
        quantity: displayQuantity(room.quantity),
        continued: false,
        itemName: item.name,
      });
    });
  });
  return rows;
}

/**
 * 集計書の行を紙に割り付ける（どのページにもタイトル行を付ける前提の行数）。
 * 見出しと明細、明細と最初の根拠は同じ紙に置く。
 * 根拠の部屋が途中で切れたときは、続きの部屋から次の紙に出す。
 */
export function paginateAggregateRows(
  rows: AggregatePrintRow[],
  capacity: number,
): AggregatePrintRow[][] {
  const limit = Math.max(capacity, 1);
  const pages: AggregatePrintRow[][] = [];
  let page: AggregatePrintRow[] = [];
  let at = 0;
  /** 途中で切ってはいけないひとかたまり（見出し＋明細＋最初の根拠） */
  const chunkLength = (start: number): number => {
    let end = start;
    while (rows[end]?.kind === "heading") end += 1;
    if (rows[end]?.kind === "item") {
      end += 1;
      if (rows[end]?.kind === "room") end += 1;
    } else if (end === start) end += 1;
    return end - start;
  };
  while (at < rows.length) {
    const length = chunkLength(at);
    if (page.length > 0 && page.length + length > limit) {
      pages.push(page);
      page = [];
    }
    const chunk = rows.slice(at, at + length).map((row) =>
      // ページの頭に来た根拠は「続き」として明細名を添える
      page.length === 0 && row.kind === "room" && pages.length > 0
        ? { ...row, continued: true }
        : row,
    );
    page.push(...chunk);
    at += length;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
