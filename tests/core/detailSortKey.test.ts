import { describe, expect, it } from "vitest";
import {
  sortDetails,
  type SortableDetail,
} from "../../src/core/sort/detailSortKey";

function detail(overrides: Partial<SortableDetail>): SortableDetail {
  return {
    subjectOrder: null,
    part1: "",
    part2SortOrder: null,
    part2Name: "",
    partNumber: null,
    detailNumber: null,
    partName: "",
    name: "",
    unitOrder: null,
    descriptionLower: "",
    descriptionUpper: "",
    remarksLower: "",
    remarksUpper: "",
    materialCategoryOrder: null,
    ...overrides,
  };
}

function order(rows: SortableDetail[]): SortableDetail[] {
  return sortDetails(rows, (row) => row);
}

describe("共通ソートキー", () => {
  it("科目→部位Ⅰ→部位番号→明細番号の優先順で並ぶ", () => {
    const rows = [
      detail({ subjectOrder: 2, part1: "壁", partNumber: 1, detailNumber: 1 }),
      detail({ subjectOrder: 1, part1: "床", partNumber: 2, detailNumber: 1 }),
      detail({ subjectOrder: 1, part1: "床", partNumber: 1, detailNumber: 10 }),
      detail({ subjectOrder: 1, part1: "床", partNumber: 1, detailNumber: 2 }),
    ];
    expect(
      order(rows).map((r) => [r.subjectOrder, r.partNumber, r.detailNumber]),
    ).toEqual([
      [1, 1, 2],
      [1, 1, 10],
      [1, 2, 1],
      [2, 1, 1],
    ]);
  });

  it("部位Ⅱは仕分けがある場合のみ判定に使う（無い行が先）", () => {
    const rows = [
      detail({ part2SortOrder: 2, part2Name: "B", detailNumber: 1 }),
      detail({ detailNumber: 9 }),
      detail({ part2SortOrder: 1, part2Name: "A", detailNumber: 1 }),
    ];
    expect(order(rows).map((r) => [r.part2Name, r.detailNumber])).toEqual([
      ["", 9],
      ["A", 1],
      ["B", 1],
    ]);
  });

  it("明細番号が同じ場合は部位文字・名称文字の日本語順（あいうえお順）で並ぶ", () => {
    const rows = [
      detail({ detailNumber: 1, partName: "かべ", name: "い" }),
      detail({ detailNumber: 1, partName: "かべ", name: "あ" }),
      detail({ detailNumber: 1, partName: "あなぐら", name: "う" }),
    ];
    expect(order(rows).map((r) => [r.partName, r.name])).toEqual([
      ["あなぐら", "う"],
      ["かべ", "あ"],
      ["かべ", "い"],
    ]);
  });

  it("単位は単位マスターの番号順、材種区分は最後の判定に使う", () => {
    const rows = [
      detail({ detailNumber: 1, unitOrder: 9, materialCategoryOrder: 1 }),
      detail({ detailNumber: 1, unitOrder: 2, materialCategoryOrder: 2 }),
      detail({ detailNumber: 1, unitOrder: 2, materialCategoryOrder: 1 }),
    ];
    expect(
      order(rows).map((r) => [r.unitOrder, r.materialCategoryOrder]),
    ).toEqual([
      [2, 1],
      [2, 2],
      [9, 1],
    ]);
  });

  it("摘要下→摘要上→備考下→備考上の順で判定する", () => {
    const rows = [
      detail({
        descriptionLower: "あ",
        descriptionUpper: "い",
        remarksLower: "あ",
      }),
      detail({
        descriptionLower: "あ",
        descriptionUpper: "あ",
        remarksLower: "い",
      }),
      detail({
        descriptionLower: "あ",
        descriptionUpper: "あ",
        remarksLower: "あ",
        remarksUpper: "い",
      }),
      detail({
        descriptionLower: "あ",
        descriptionUpper: "あ",
        remarksLower: "あ",
      }),
    ];
    expect(
      order(rows).map((r) => [
        r.descriptionUpper,
        r.remarksLower,
        r.remarksUpper,
      ]),
    ).toEqual([
      ["あ", "あ", ""],
      ["あ", "あ", "い"],
      ["あ", "い", ""],
      ["い", "あ", ""],
    ]);
  });

  it("未設定の番号は末尾に置き、キーが同じ行は元の順序を保つ（安定ソート）", () => {
    const rows = [
      detail({ detailNumber: null, name: "後" }),
      detail({ detailNumber: 5, name: "X" }),
      detail({ detailNumber: null, name: "後" }),
    ];
    expect(order(rows).map((r) => r.detailNumber)).toEqual([5, null, null]);
  });
});
