import { describe, expect, it } from "vitest";
import type { MaterialCategory, Unit } from "../../src/shared/types";
import {
  foldTwoRowPaste,
  screenColToLogicalCol,
  toTsvText,
} from "../../src/renderer/src/features/grid/twoRowPaste";
import { buildPastePreview } from "../../src/renderer/src/features/grid/gridClipboard";
import {
  DETAIL_SCREEN_COLUMNS,
  buildDetailColumns,
} from "../../src/renderer/src/features/details/detailColumns";
import { createEmptyRow } from "../../src/renderer/src/features/details/rowOperations";

const materialCategories: MaterialCategory[] = [
  { id: 1, code: "1", name: "仕上", displayOrder: 1 },
];
const units: Unit[] = [{ id: 2, name: "m2", displayOrder: 2 }];
const columns = buildDetailColumns(materialCategories, units);

describe("1明細＝上下2行のExcel貼り付け", () => {
  it("画面の列並びどおりの論理列になっている", () => {
    expect(columns.map((c) => c.key)).toEqual([
      "part",
      "detailNumber",
      "materialCategory",
      "partName",
      "name",
      "descriptionUpper",
      "descriptionLower",
      "unit",
      "remarksUpper",
      "remarksLower",
      "estimateDisplay",
    ]);
  });

  it("画面の列番号を論理列の先頭番号へ直す", () => {
    expect(screenColToLogicalCol(DETAIL_SCREEN_COLUMNS, 0)).toBe(0);
    expect(screenColToLogicalCol(DETAIL_SCREEN_COLUMNS, 1)).toBe(2);
    expect(screenColToLogicalCol(DETAIL_SCREEN_COLUMNS, 2)).toBe(3);
    expect(screenColToLogicalCol(DETAIL_SCREEN_COLUMNS, 4)).toBe(7);
  });

  it("上下2行を1明細の1行に畳む（上段だけ・下段だけの列も拾う）", () => {
    const matrix = [
      ["10", "仕上", "床", "摘要上", "", "備考上", "積算"],
      ["302.5", "", "ビニル床シート", "摘要下", "m2", "備考下", ""],
    ];
    const folded = foldTwoRowPaste(matrix, DETAIL_SCREEN_COLUMNS, 0);
    expect(folded.startCol).toBe(0);
    expect(folded.matrix).toEqual([
      [
        "10",
        "302.5",
        "仕上",
        "床",
        "ビニル床シート",
        "摘要上",
        "摘要下",
        "m2",
        "備考上",
        "備考下",
        "積算",
      ],
    ]);
  });

  it("部位・部位名は貼り付けても変えず、他の欄だけ取り込む", () => {
    const matrix = [
      ["10", "仕上", "床", "", "", "", ""],
      ["302.5", "", "ビニル床シート", "", "m2", "", ""],
    ];
    const folded = foldTwoRowPaste(matrix, DETAIL_SCREEN_COLUMNS, 0);
    const base = { ...createEmptyRow(), partName: "床（元）" };
    const preview = buildPastePreview(
      [base],
      columns,
      toTsvText(folded.matrix),
      0,
      folded.startCol,
      createEmptyRow,
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0].detailNumberInput).toBe("302.50");
    expect(preview.rows[0].name).toBe("ビニル床シート");
    expect(preview.rows[0].materialCategory).toBe("仕上");
    expect(preview.rows[0].unit).toBe("m2");
    expect(preview.rows[0].partName).toBe("床（元）");
  });

  it("複数明細を続けて畳む", () => {
    const matrix = [
      ["10", "", "床", "", "", "", ""],
      ["1", "", "名称A", "", "m2", "", ""],
      ["20", "", "壁", "", "", "", ""],
      ["2", "", "名称B", "", "m2", "", ""],
    ];
    const folded = foldTwoRowPaste(matrix, DETAIL_SCREEN_COLUMNS, 0);
    expect(folded.matrix).toHaveLength(2);
    expect(folded.matrix[1][1]).toBe("2");
    expect(folded.matrix[1][4]).toBe("名称B");
  });
});
