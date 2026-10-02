/**
 * チェック表（材種区分別）。
 * 集計書兼工事マスターの明細を、部位Ⅰ・部位Ⅱごとに管理用部位（床・巾木・壁・天井…）の
 * 列へ振り分けて名称と数量をまとめる。
 * 明細用部位の番号は 10番台＝管理用部位1、20番台＝2 … と対応するので、
 * 部位番号から管理用部位を決める（番号が無い明細は名称の一致で探す）。
 */

export interface CheckSheetSourceItem {
  part1: string;
  part2: string;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  name: string;
  quantity: number;
}

export interface CheckSheetPart {
  id: number;
  name: string;
}

export interface CheckSheetCell {
  name: string;
  quantity: number;
}

export interface CheckSheetBlock {
  part1: string;
  part2: string;
  /** 列（管理用部位）ごとの明細。行数は列ごとに異なる */
  columns: CheckSheetCell[][];
}

export interface CheckSheet {
  materialCategory: string;
  /** 表示する管理用部位の列 */
  parts: CheckSheetPart[];
  blocks: CheckSheetBlock[];
}

/** 明細用部位の番号から管理用部位の番号を求める（105→10、10→1） */
export function aggregationPartIdOf(partNumber: number | null): number | null {
  if (partNumber === null || !Number.isFinite(partNumber)) return null;
  const id = Math.floor(partNumber / 10);
  return id >= 1 ? id : null;
}

/**
 * チェック表の列ごとに「計上する部位番号」を決める設定。
 * 管理用部位の番号 → "10-19" "10,12-15" のような並び文字。
 * 設定が無い列は従来どおり（番号÷10）で決める。
 */
export type CheckSheetPartMap = Record<string, string>;

/** "10,12-15" のような並び文字を番号の集まりにする（空なら null） */
export function parseNumberRanges(text: string): Set<number> | null {
  const numbers = new Set<number>();
  text
    .split(/[,、\s]+/)
    .filter((part) => part.trim() !== "")
    .forEach((part) => {
      const range = /^(\d+)\s*[-〜~ー]\s*(\d+)$/.exec(part.trim());
      if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) {
          numbers.add(n);
        }
        return;
      }
      const single = Number(part.trim());
      if (Number.isFinite(single)) numbers.add(single);
    });
  return numbers.size === 0 ? null : numbers;
}

/** 今の設定で、その部位番号が入る列（管理用部位の番号）を探す */
function partIdFromMap(
  partNumber: number | null,
  partMap: CheckSheetPartMap,
): number | null {
  if (partNumber === null || !Number.isFinite(partNumber)) return null;
  const whole = Math.floor(partNumber);
  for (const [key, text] of Object.entries(partMap)) {
    const numbers = parseNumberRanges(text);
    if (numbers && numbers.has(whole)) {
      const id = Number(key);
      if (Number.isFinite(id)) return id;
    }
  }
  return null;
}

function partIdOf(
  item: CheckSheetSourceItem,
  parts: readonly CheckSheetPart[],
  partMap: CheckSheetPartMap,
): number | null {
  const byMap = partIdFromMap(item.partNumber, partMap);
  if (byMap !== null && parts.some((part) => part.id === byMap)) return byMap;
  const byNumber = aggregationPartIdOf(item.partNumber);
  if (byNumber !== null && parts.some((part) => part.id === byNumber))
    return byNumber;
  const byName = parts.find((part) => item.partName.includes(part.name));
  return byName ? byName.id : null;
}

/**
 * 今どの部位番号がどの列に入るかの一覧（画面の下に出す説明用）。
 * 設定があればその並び文字、無ければ「番号÷10」の決まりでできる範囲を出す。
 */
export function describePartMap(
  parts: readonly CheckSheetPart[],
  partMap: CheckSheetPartMap,
): { id: number; name: string; numbers: string; custom: boolean }[] {
  return parts.map((part) => {
    const text = partMap[String(part.id)];
    if (text !== undefined && text.trim() !== "") {
      return { id: part.id, name: part.name, numbers: text, custom: true };
    }
    return {
      id: part.id,
      name: part.name,
      numbers: `${part.id * 10}-${part.id * 10 + 9}`,
      custom: false,
    };
  });
}

/**
 * チェック表を組み立てる。
 * 数量は 部位Ⅰ・部位Ⅱ・管理用部位・明細名称 が同じものを合算する。
 */
export function buildCheckSheet(
  items: readonly CheckSheetSourceItem[],
  aggregationParts: readonly CheckSheetPart[],
  materialCategory: string,
  partMap: CheckSheetPartMap = {},
  /** 出す列（管理用部位の番号）。渡した列は明細0件でも空欄で出す。省略時は使われた列だけ出す */
  onlyPartIds?: readonly number[],
): CheckSheet {
  const targets = items.filter(
    (item) => item.materialCategory === materialCategory,
  );
  const usedPartIds = new Set<number>();
  /** 部位Ⅰ|部位Ⅱ → 管理用部位ID → 名称 → 数量 */
  const blocks = new Map<string, Map<number, Map<string, number>>>();

  targets.forEach((item) => {
    const partId = partIdOf(item, aggregationParts, partMap);
    if (partId === null) return;
    usedPartIds.add(partId);
    const blockKey = `${item.part1}|${item.part2}`;
    const block =
      blocks.get(blockKey) ?? new Map<number, Map<string, number>>();
    blocks.set(blockKey, block);
    const column = block.get(partId) ?? new Map<string, number>();
    block.set(partId, column);
    column.set(item.name, (column.get(item.name) ?? 0) + item.quantity);
  });

  const parts =
    onlyPartIds === undefined
      ? aggregationParts.filter((part) => usedPartIds.has(part.id))
      : aggregationParts.filter((part) => onlyPartIds.includes(part.id));

  return {
    materialCategory,
    parts,
    blocks: [...blocks.entries()].map(([key, block]) => {
      const [part1, part2] = key.split("|");
      return {
        part1,
        part2,
        columns: parts.map((part) =>
          [...(block.get(part.id) ?? new Map<string, number>()).entries()].map(
            ([name, quantity]) => ({ name, quantity }),
          ),
        ),
      };
    }),
  };
}

/**
 * Excelへ貼り付けるためのTSV。
 * 既存のExcel書式に合わせて、部位Ⅰ・部位Ⅱの後ろと各列の間に空欄を残し、
 * 部位のかたまりごとに空行を1行入れる。
 */
export function toCheckSheetTsv(sheet: CheckSheet): string {
  const lines: string[] = [];
  const header1 = ["部位", "", ""];
  const header2 = ["部位Ⅰ", "部位Ⅱ", ""];
  sheet.parts.forEach((part) => {
    header1.push(part.name, "", "", "");
    header2.push("名称", "", "数量", "");
  });
  lines.push(header1.join("\t"), header2.join("\t"));

  sheet.blocks.forEach((block, index) => {
    if (index > 0) lines.push("");
    const rowCount = Math.max(
      1,
      ...block.columns.map((column) => column.length),
    );
    for (let row = 0; row < rowCount; row += 1) {
      const cells = [
        row === 0 ? block.part1 : "",
        row === 0 ? block.part2 : "",
        "",
      ];
      block.columns.forEach((column) => {
        const cell = column[row];
        cells.push(
          cell ? cell.name : "",
          "",
          cell ? cell.quantity.toFixed(2) : "",
          "",
        );
      });
      lines.push(cells.join("\t"));
    }
  });

  return lines.join("\n");
}
