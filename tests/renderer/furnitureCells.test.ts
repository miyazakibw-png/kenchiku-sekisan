import { describe, expect, it } from "vitest";
import { pasteFurnitureCells } from "../../src/renderer/src/features/estimate/furnitureCells";
import { furnitureRow } from "../../src/core/furniture/furnitureSheet";

const PARTS = [
  { id: 1, name: "壁" },
  { id: 2, name: "天井" },
];
const UNITS = [
  { id: 1, name: "m²" },
  { id: 2, name: "m" },
];
const MASTERS = { parts: PARTS, units: UNITS };
// 行入力部の並び（INPUT_COLUMNS と同じ順）
const KEYS = [
  "subjectId",
  "partNumber",
  "detailNumber",
  "part",
  "partAdd",
  "partSymbol",
  "nameSymbol",
  "width",
  "height",
  "depth",
  "quantity",
  "unit",
  "descriptionUpper",
  "remarksLower",
];

describe("pasteFurnitureCells", () => {
  it("エクセルの表をカーソルのマスから取り込む", () => {
    const rows = [furnitureRow({ nameSymbol: "食器棚" })];
    const result = pasteFurnitureCells(
      rows,
      { row: 0, col: 6 }, // nameSymbol から
      [["吊戸棚", "1.80", "0.90", "0.35", "2", "m²"]],
      KEYS,
      MASTERS,
    );
    const row = result.rows[0];
    expect(row.nameSymbol).toBe("吊戸棚");
    expect(row.width).toBe("1.80");
    expect(row.height).toBe("0.90");
    expect(row.depth).toBe("0.35");
    expect(row.quantity).toBe("2");
    expect(row.unit).toBe("m²");
    expect(result.addedRows).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it("行が足りないときは末尾へ足す", () => {
    const result = pasteFurnitureCells(
      [furnitureRow()],
      { row: 0, col: 6 },
      [
        ["棚A", "", "", "", "1", "m"],
        ["棚B", "", "", "", "2", "m"],
      ],
      KEYS,
      MASTERS,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.addedRows).toBe(1);
    expect(result.rows[0].nameSymbol).toBe("棚A");
    expect(result.rows[1].nameSymbol).toBe("棚B");
  });

  it("部位IDは部位番号マスターの番号・名前から引く（無ければ空欄）", () => {
    const rows = [furnitureRow(), furnitureRow(), furnitureRow()];
    const result = pasteFurnitureCells(
      rows,
      { row: 0, col: 1 }, // partNumber から
      [["1"], ["壁"], ["99"]],
      KEYS,
      MASTERS,
    );
    expect(result.rows[0].partNumber).toBe(1);
    expect(result.rows[1].partNumber).toBe(1);
    expect(result.rows[2].partNumber).toBe(null);
  });

  it("科目・名称IDは数字。数字以外はエラーとして数える", () => {
    const rows = [furnitureRow(), furnitureRow()];
    const result = pasteFurnitureCells(
      rows,
      { row: 0, col: 0 }, // subjectId・partNumber・detailNumber から
      [
        ["3", "", "1.25"],
        ["あいう", "", "2"],
      ],
      KEYS,
      MASTERS,
    );
    expect(result.rows[0].subjectId).toBe(3);
    expect(result.rows[0].detailNumber).toBe(1.25);
    expect(result.rows[1].subjectId).toBe(null);
    expect(result.rows[1].detailNumber).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.firstError).toBe("科目は数字で入れてください");
  });

  it("単位は単位マスターの番号・名前から名前を引く", () => {
    const rows = [furnitureRow(), furnitureRow()];
    const result = pasteFurnitureCells(
      rows,
      { row: 0, col: 11 }, // unit
      [["1"], ["m"]],
      KEYS,
      MASTERS,
    );
    expect(result.rows[0].unit).toBe("m²");
    expect(result.rows[1].unit).toBe("m");
  });
});
