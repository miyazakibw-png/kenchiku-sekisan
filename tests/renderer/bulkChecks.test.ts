import { describe, expect, it } from "vitest";
import { toggleBulkCheck } from "../../src/renderer/src/features/aggregate/bulkChecks";

const order = Array.from({ length: 12 }, (_, index) => String(index));

describe("科目一括変更のチェック行", () => {
  it("1行のチェックを付ける", () => {
    expect(toggleBulkCheck(order, new Set(), "3", null, false)).toEqual(
      new Set(["3"]),
    );
  });

  it("1行のチェックを外す", () => {
    expect(
      toggleBulkCheck(order, new Set(["2", "3"]), "3", null, false),
    ).toEqual(new Set(["2"]));
  });

  it("先頭から10行目までShiftでチェックする", () => {
    expect(toggleBulkCheck(order, new Set(), "10", "1", true)).toEqual(
      new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]),
    );
  });

  it("後ろから前へのShiftでも範囲をチェックする", () => {
    expect(toggleBulkCheck(order, new Set(), "1", "10", true)).toEqual(
      new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]),
    );
  });

  it("Shiftで範囲のチェックを外し、外側は残す", () => {
    expect(toggleBulkCheck(order, new Set(order), "4", "8", true)).toEqual(
      new Set(["0", "1", "2", "3", "9", "10", "11"]),
    );
  });

  it("アンカーが並び順にないときは選んだ行だけを切り替える", () => {
    expect(
      toggleBulkCheck(order, new Set(["2"]), "3", "missing", true),
    ).toEqual(new Set(["2", "3"]));
  });

  it("Shiftでもアンカーがないときは選んだ行だけを切り替える", () => {
    expect(toggleBulkCheck(order, new Set(["2"]), "3", null, true)).toEqual(
      new Set(["2", "3"]),
    );
  });
});
