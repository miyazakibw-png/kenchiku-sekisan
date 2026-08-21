import { describe, expect, it } from "vitest";
import {
  applyDetail,
  applyEstimateParts,
  emptyTransferRow,
  insertTransferRow,
  parseQuantity,
  removeTransferRow,
  resolveTransferInherited,
  updateTransferRow,
} from "../../src/renderer/src/features/estimate/transferRows";
import type { Detail, EstimateRow } from "../../src/shared/types";

describe("転記入力表の行操作", () => {
  it("Ａ〜Ｉは入力が無ければ入力のある上の行を引き継ぐ", () => {
    const rows = [
      {
        ...emptyTransferRow(),
        part1: "1階",
        part2: "内部",
        part2Split: 1,
        part3: "事務室",
        subjectId: 5,
        materialCategory: "仕上",
      },
      emptyTransferRow(),
      { ...emptyTransferRow(), part3: "廊下" },
    ];

    const inherited = resolveTransferInherited(rows);
    expect(inherited[1]).toEqual({
      part1: "1階",
      part2: "内部",
      part2Split: 1,
      formwork: "",
      part3: "事務室",
      subjectId: 5,
      materialCategory: "仕上",
    });
    expect(inherited[2].part3).toBe("廊下");
    expect(inherited[2].part1).toBe("1階");
  });

  it("行挿入・行削除・行更新ができる", () => {
    const rows = [
      { ...emptyTransferRow(), name: "床" },
      { ...emptyTransferRow(), name: "壁" },
    ];
    const inserted = insertTransferRow(rows, 1);
    expect(inserted.map((row) => row.name)).toEqual(["床", "", "壁"]);
    expect(removeTransferRow(inserted, 0).map((row) => row.name)).toEqual([
      "",
      "壁",
    ]);
    expect(updateTransferRow(rows, 1, { quantity: 2 })[1].quantity).toBe(2);
  });

  it("部位別入力表の部位を転記する", () => {
    const source: EstimateRow = {
      id: 1,
      projectId: 1,
      rowType: "room",
      part1: "1階",
      part2: "内部",
      part2Split: 1,
      formwork: "地上階",
      part3: "風除室",
      ceilingHeight: 2.4,
      multiplier: 1,
      note: "",
      calcType: "room",
      displayOrder: 0,
    };
    const row = applyEstimateParts(emptyTransferRow(), source);
    expect(row.part1).toBe("1階");
    expect(row.part3).toBe("風除室");
    expect(row.formwork).toBe("地上階");
    expect(row.part2Split).toBe(1);
  });

  it("明細マスターを1明細として転記する（呼出元の明細IDを持つ）", () => {
    const detail: Detail = {
      id: 42,
      subjectId: 7,
      detailNumber: 3.02,
      materialCategory: "仕上",
      partName: "床",
      name: "ビニル床シート",
      descriptionUpper: "",
      descriptionLower: "t=2.0",
      unit: "m2",
      remarksUpper: "",
      remarksLower: "",
      estimateDisplay: "",
      displayOrder: 0,
      isActive: true,
    };
    const row = applyDetail(emptyTransferRow(), detail);
    expect(row.sourceDetailId).toBe(42);
    expect(row.subjectId).toBe(7);
    expect(row.detailNumber).toBe(3.02);
    expect(row.name).toBe("ビニル床シート");
    expect(row.unit).toBe("m2");
  });

  it("数量は全角も受け付けて小数2桁で保持する", () => {
    expect(parseQuantity("１２．３４５").value).toBe(12.35);
    expect(parseQuantity("").value).toBeNull();
    expect(parseQuantity("あ").error).toBeTruthy();
  });
});
