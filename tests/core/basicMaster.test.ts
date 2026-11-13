import { describe, expect, it } from "vitest";
import {
  BASIC_MASTER_LIMITS,
  nextBasicMasterId,
  sortBasicMasterRowsById,
  validateBasicMaster,
  type BasicMasterRow,
} from "../../src/core/masters/basicMaster";

describe("基本マスターの番号順", () => {
  it("番号の昇順に並べる", () => {
    const rows: BasicMasterRow[] = [
      { id: 10, name: "十", note: "" },
      { id: 1, name: "一", note: "" },
      { id: 5, name: "五", note: "" },
    ];

    expect(sortBasicMasterRowsById(rows).map((row) => row.id)).toEqual([
      1, 5, 10,
    ]);
  });

  it("番号空欄の行を最後にする", () => {
    const rows: BasicMasterRow[] = [
      { id: 0, name: "番号なし", note: "" },
      { id: 2, name: "二", note: "" },
      { id: 0, name: "備考だけ", note: "確認" },
      { id: 1, name: "一", note: "" },
    ];

    expect(sortBasicMasterRowsById(rows).map((row) => row.id)).toEqual([
      1, 2, 0, 0,
    ]);
  });

  it("同じ番号の行は元の順序を保つ", () => {
    const first = { id: 2, name: "先", note: "" };
    const middle = { id: 1, name: "中", note: "" };
    const second = { id: 2, name: "後", note: "" };

    expect(sortBasicMasterRowsById([first, middle, second])).toEqual([
      middle,
      first,
      second,
    ]);
  });

  it("入力配列を変更せず新しい配列を返す", () => {
    const rows: BasicMasterRow[] = [
      { id: 3, name: "三", note: "" },
      { id: 1, name: "一", note: "" },
    ];
    const original = [...rows];

    const sorted = sortBasicMasterRowsById(rows);

    expect(sorted).not.toBe(rows);
    expect(rows).toEqual(original);
    expect(rows[0]).toBe(original[0]);
  });

  it("明細用部位は番号1〜999、最大999件まで登録できる", () => {
    const rows = Array.from({ length: 999 }, (_, index) => ({
      id: index + 1,
      name: `部位${index + 1}`,
      note: "",
    }));

    expect(BASIC_MASTER_LIMITS.pickupParts).toMatchObject({
      maxId: 999,
      maxRows: 999,
    });
    expect(
      validateBasicMaster("pickupParts", [
        { id: 999, name: "部位", note: "" },
      ]),
    ).toEqual([]);
    expect(
      validateBasicMaster("pickupParts", [
        { id: 1000, name: "部位", note: "" },
      ]),
    ).toContain("番号は1〜999で入力してください（1000）");
    expect(validateBasicMaster("pickupParts", rows)).toEqual([]);
    expect(
      validateBasicMaster("pickupParts", [
        ...rows,
        { id: 1000, name: "追加", note: "" },
      ]),
    ).toContain("明細用部位は999件までです（1000件）");
  });

  it("明細用部位の追加番号は空きの最小値を使う", () => {
    expect(
      nextBasicMasterId("pickupParts", [
        { id: 1, name: "一", note: "" },
        { id: 3, name: "三", note: "" },
      ]),
    ).toBe(2);
  });
});
