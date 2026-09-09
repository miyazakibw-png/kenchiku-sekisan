/**
 * 転記入力表のマス（エクセルの1セル）単位のコピー・貼り付け。
 * 1明細は画面で上下2段なので、上段・下段をそれぞれエクセルの1行として数える。
 */
import type { MasterEntry, TransferRowDraft } from "@shared/types";
import { resolveMasterName } from "@shared/masters";
import { emptyTransferRow, formatQuantity, parseQuantity } from "./transferRows";

/** マスの位置（行番号・上段/下段・列） */
export interface TransferCellPos {
  row: number;
  /** 0＝上段、1＝下段 */
  line: number;
  col: number;
}

export interface TransferCellRange {
  start: TransferCellPos;
  end: TransferCellPos;
}

interface CellAccessor {
  get: (row: TransferRowDraft) => string;
  set: (
    row: TransferRowDraft,
    value: string,
    masters: TransferMasters,
  ) => { row: TransferRowDraft; error?: string };
}

export interface TransferMasters {
  units: readonly MasterEntry[];
  parts: readonly MasterEntry[];
}

/** 文字の欄 */
function textCell(
  key:
    | "partName"
    | "name"
    | "descriptionUpper"
    | "descriptionLower"
    | "remarks"
    | "remarksLower",
  entries?: (masters: TransferMasters) => readonly MasterEntry[],
): CellAccessor {
  return {
    get: (row) => row[key],
    set: (row, value, masters) => ({
      row: {
        ...row,
        [key]: entries
          ? resolveMasterName([...entries(masters)], value)
          : value,
      },
    }),
  };
}

const partIdCell: CellAccessor = {
  get: (row) => (row.partId === null ? "" : String(row.partId)),
  set: (row, value, masters) => {
    const trimmed = value.trim();
    if (trimmed === "") return { row: { ...row, partId: null } };
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed))
      return { row, error: "部位IDは数字で入れてください" };
    const part = masters.parts.find((item) => item.id === parsed);
    return {
      row: {
        ...row,
        partId: parsed,
        partName: part ? part.name : row.partName,
      },
    };
  },
};

const detailNumberCell: CellAccessor = {
  get: (row) => (row.detailNumber === null ? "" : row.detailNumber.toFixed(2)),
  set: (row, value) => {
    const trimmed = value.trim();
    if (trimmed === "") return { row: { ...row, detailNumber: null } };
    const parsed = Number.parseFloat(trimmed);
    if (Number.isNaN(parsed))
      return { row, error: "明細IDは数字で入れてください" };
    return { row: { ...row, detailNumber: parsed } };
  },
};

const quantityCell: CellAccessor = {
  get: (row) => formatQuantity(row.quantity),
  set: (row, value) => {
    const parsed = parseQuantity(value);
    if (parsed.error) return { row, error: parsed.error };
    return { row: { ...row, quantity: parsed.value } };
  },
};

const unitCell: CellAccessor = {
  get: (row) => row.unit,
  set: (row, value, masters) => ({
    row: { ...row, unit: resolveMasterName([...masters.units], value) },
  }),
};

/** コピー・貼り付けできる列（部位ID／明細IDから備考まで。科目IDは対象外） */
export const TRANSFER_CELL_COLUMNS: {
  label: string;
  upper: CellAccessor | null;
  lower: CellAccessor | null;
}[] = [
  { label: "部位ID／明細ID", upper: partIdCell, lower: detailNumberCell },
  { label: "部位名／名称", upper: textCell("partName"), lower: textCell("name") },
  {
    label: "摘要",
    upper: textCell("descriptionUpper"),
    lower: textCell("descriptionLower"),
  },
  { label: "数量", upper: null, lower: quantityCell },
  { label: "単位", upper: null, lower: unitCell },
  {
    label: "備考",
    upper: textCell("remarks"),
    lower: textCell("remarksLower"),
  },
];

function accessorAt(line: number, col: number): CellAccessor | null {
  const column = TRANSFER_CELL_COLUMNS[col];
  if (!column) return null;
  return line === 0 ? column.upper : column.lower;
}

/** 画面の並び順（上段→下段）での通し番号 */
function lineNumber(pos: TransferCellPos): number {
  return pos.row * 2 + pos.line;
}

export function normalizeCellRange(range: TransferCellRange): {
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
} {
  const a = lineNumber(range.start);
  const b = lineNumber(range.end);
  return {
    startLine: Math.min(a, b),
    endLine: Math.max(a, b),
    startCol: Math.min(range.start.col, range.end.col),
    endCol: Math.max(range.start.col, range.end.col),
  };
}

export function isCellInRange(
  range: TransferCellRange | null,
  pos: TransferCellPos,
): boolean {
  if (!range) return false;
  const r = normalizeCellRange(range);
  const line = lineNumber(pos);
  return (
    line >= r.startLine &&
    line <= r.endLine &&
    pos.col >= r.startCol &&
    pos.col <= r.endCol
  );
}

/** 選んだマスをエクセルへ貼れるTSVにする（無いマスは空欄） */
export function copyTransferCells(
  rows: TransferRowDraft[],
  range: TransferCellRange,
): string {
  const r = normalizeCellRange(range);
  const lines: string[] = [];
  for (let line = r.startLine; line <= r.endLine; line += 1) {
    const row = rows[Math.floor(line / 2)];
    if (!row) break;
    const cells: string[] = [];
    for (let col = r.startCol; col <= r.endCol; col += 1) {
      const accessor = accessorAt(line % 2, col);
      cells.push(accessor ? accessor.get(row) : "");
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

export interface TransferPasteResult {
  rows: TransferRowDraft[];
  addedRows: number;
  errorCount: number;
  firstError: string;
}

/** エクセルの表を、選んでいるマスを左上にして貼り付ける（足りない行は足す） */
export function pasteTransferCells(
  rows: TransferRowDraft[],
  at: TransferCellPos,
  matrix: string[][],
  masters: TransferMasters,
): TransferPasteResult {
  const next = [...rows];
  const startLine = lineNumber(at);
  let addedRows = 0;
  let errorCount = 0;
  let firstError = "";

  matrix.forEach((cells, offset) => {
    const line = startLine + offset;
    const index = Math.floor(line / 2);
    while (index >= next.length) {
      next.push(emptyTransferRow());
      addedRows += 1;
    }
    cells.forEach((value, colOffset) => {
      const accessor = accessorAt(line % 2, at.col + colOffset);
      // 数量・単位の上段のような入力欄の無いマスは飛ばす
      if (!accessor) return;
      const result = accessor.set(next[index], value, masters);
      next[index] = result.row;
      if (result.error) {
        errorCount += 1;
        if (firstError === "") firstError = result.error;
      }
    });
  });

  return { rows: next, addedRows, errorCount, firstError };
}
