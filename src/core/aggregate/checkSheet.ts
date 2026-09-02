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

function partIdOf(
  item: CheckSheetSourceItem,
  parts: readonly CheckSheetPart[],
): number | null {
  const byNumber = aggregationPartIdOf(item.partNumber);
  if (byNumber !== null && parts.some((part) => part.id === byNumber))
    return byNumber;
  const byName = parts.find((part) => item.partName.includes(part.name));
  return byName ? byName.id : null;
}

/**
 * チェック表を組み立てる。
 * 数量は 部位Ⅰ・部位Ⅱ・管理用部位・明細名称 が同じものを合算する。
 */
export function buildCheckSheet(
  items: readonly CheckSheetSourceItem[],
  aggregationParts: readonly CheckSheetPart[],
  materialCategory: string,
): CheckSheet {
  const targets = items.filter(
    (item) => item.materialCategory === materialCategory,
  );
  const usedPartIds = new Set<number>();
  /** 部位Ⅰ|部位Ⅱ → 管理用部位ID → 名称 → 数量 */
  const blocks = new Map<string, Map<number, Map<string, number>>>();

  targets.forEach((item) => {
    const partId = partIdOf(item, aggregationParts);
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

  const parts = aggregationParts.filter((part) => usedPartIds.has(part.id));

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
