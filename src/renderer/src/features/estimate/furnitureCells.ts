/**
 * 家具・設備入力表の行入力部のマス（エクセルの1セル）単位の貼り付け。
 * 1行＝エクセルの1行、画面に出ている入力欄の並び順で列を当てる。
 */
import type { MasterEntry } from "@shared/types";
import {
  furnitureRow,
  type FurnitureRow,
} from "../../../../core/furniture/furnitureSheet";

/** マスの位置（行番号・入力欄の左からの番号） */
export interface FurnitureCellPos {
  row: number;
  col: number;
}

export interface FurnitureMasters {
  parts: readonly MasterEntry[];
  units: readonly MasterEntry[];
}

interface CellAccessor {
  set: (
    row: FurnitureRow,
    value: string,
    masters: FurnitureMasters,
  ) => { row: FurnitureRow; error?: string };
}

/** 文字の欄 */
function textCell(
  key:
    | "place"
    | "part"
    | "partAdd"
    | "partSymbol"
    | "nameSymbol"
    | "fittingSymbol"
    | "width"
    | "width2"
    | "width3"
    | "height"
    | "depth"
    | "shape"
    | "model"
    | "beam"
    | "window"
    | "floorFormula"
    | "quantity"
    | "descriptionUpper"
    | "remarksLower",
): CellAccessor {
  return {
    set: (row, value) => ({ row: { ...row, [key]: value } }),
  };
}

/** 科目（数字。入力欄と同じく数字以外はエラー） */
const subjectCell: CellAccessor = {
  set: (row, value) => {
    const trimmed = value.trim();
    if (trimmed === "") return { row: { ...row, subjectId: null } };
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed))
      return { row, error: "科目は数字で入れてください" };
    return { row: { ...row, subjectId: parsed } };
  },
};

/** 部位ID（入力欄と同じく、部位番号マスターの番号・名前から引く。無ければ空欄） */
const partNumberCell: CellAccessor = {
  set: (row, value, masters) => {
    const trimmed = value.trim();
    if (trimmed === "") return { row: { ...row, partNumber: null } };
    const byId = masters.parts.find((entry) => String(entry.id) === trimmed);
    if (byId) return { row: { ...row, partNumber: byId.id } };
    const byName = masters.parts.find((entry) => entry.name === trimmed);
    if (byName) return { row: { ...row, partNumber: byName.id } };
    return { row: { ...row, partNumber: null } };
  },
};

/** 名称ID（数字。入力欄と同じく数字以外はエラー） */
const detailNumberCell: CellAccessor = {
  set: (row, value) => {
    const trimmed = value.trim();
    if (trimmed === "") return { row: { ...row, detailNumber: null } };
    const parsed = Number.parseFloat(trimmed);
    if (Number.isNaN(parsed))
      return { row, error: "名称IDは数字で入れてください" };
    return { row: { ...row, detailNumber: parsed } };
  },
};

/** 単位（入力欄と同じく、単位マスターの番号・名前から名前を引く） */
const unitCell: CellAccessor = {
  set: (row, value, masters) => {
    const trimmed = value.trim();
    const found =
      masters.units.find((entry) => String(entry.id) === trimmed) ??
      masters.units.find((entry) => entry.name === trimmed);
    return { row: { ...row, unit: found?.name ?? trimmed } };
  },
};

/** 行入力部の欄ごとの書き込み（画面に出ている欄の並び順で当てる） */
const ACCESSORS: Record<string, CellAccessor> = {
  place: textCell("place"),
  subjectId: subjectCell,
  partNumber: partNumberCell,
  detailNumber: detailNumberCell,
  part: textCell("part"),
  partAdd: textCell("partAdd"),
  partSymbol: textCell("partSymbol"),
  nameSymbol: textCell("nameSymbol"),
  fittingSymbol: textCell("fittingSymbol"),
  width: textCell("width"),
  width2: textCell("width2"),
  width3: textCell("width3"),
  height: textCell("height"),
  depth: textCell("depth"),
  shape: textCell("shape"),
  model: textCell("model"),
  beam: textCell("beam"),
  window: textCell("window"),
  floorFormula: textCell("floorFormula"),
  quantity: textCell("quantity"),
  unit: unitCell,
  descriptionUpper: textCell("descriptionUpper"),
  remarksLower: textCell("remarksLower"),
};

export interface FurniturePasteResult {
  rows: FurnitureRow[];
  addedRows: number;
  errorCount: number;
  firstError: string;
}

/** エクセルの表を、選んでいるマスを左上にして貼り付ける（足りない行は足す） */
export function pasteFurnitureCells(
  rows: FurnitureRow[],
  at: FurnitureCellPos,
  matrix: string[][],
  columnKeys: string[],
  masters: FurnitureMasters,
): FurniturePasteResult {
  const next = [...rows];
  let addedRows = 0;
  let errorCount = 0;
  let firstError = "";

  matrix.forEach((cells, offset) => {
    const index = at.row + offset;
    while (index >= next.length) {
      next.push(furnitureRow());
      addedRows += 1;
    }
    cells.forEach((value, colOffset) => {
      const accessor = ACCESSORS[columnKeys[at.col + colOffset] ?? ""];
      // 画面に出ていない欄・入力欄ではない欄は飛ばす
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
