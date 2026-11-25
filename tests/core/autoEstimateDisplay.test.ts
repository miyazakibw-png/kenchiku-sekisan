import { describe, expect, it } from "vitest";
import {
  autoEstimateDisplayForChanged,
  calcDetail,
  withAutoEstimateDisplay,
  type CalcDetail,
  type CalcSet,
} from "../../src/core/room/calcSheet";

function setWithDetails(...details: CalcDetail[]): CalcSet {
  return {
    id: "set",
    partNumber: null,
    partName: "",
    details,
    lines: [],
  };
}

describe("仕上・下地摘要の自動入力", () => {
  it("名称を半角にして仕上・下地摘要へ入れる", () => {
    const detail = calcDetail({ id: "d1", name: "コンクリート金ゴテ" });

    expect(withAutoEstimateDisplay(detail).estimateDisplay).toBe("ｺﾝｸﾘｰﾄ金ｺﾞﾃ");
  });

  it("入力済みの仕上・下地摘要は変えない", () => {
    const detail = calcDetail({
      id: "d1",
      name: "コンクリート金ゴテ",
      estimateDisplay: "手入力の摘要",
    });

    expect(withAutoEstimateDisplay(detail)).toBe(detail);
  });

  it("説明行は自動入力しない", () => {
    const detail = calcDetail({
      id: "d1",
      name: "コンクリート金ゴテ",
      note: true,
    });

    expect(withAutoEstimateDisplay(detail)).toBe(detail);
  });

  it("名称が空の行は自動入力しない", () => {
    const detail = calcDetail({ id: "d1", name: "  " });

    expect(withAutoEstimateDisplay(detail)).toBe(detail);
  });

  it("名称が変わった行と新しい行だけを埋める", () => {
    const unchanged = calcDetail({ id: "unchanged", name: "そのまま" });
    const renamed = calcDetail({ id: "renamed", name: "新しい名称" });
    const added = calcDetail({ id: "added", name: "木部" });
    const cleared = calcDetail({ id: "cleared", name: "" });
    const note = calcDetail({ id: "note", name: "説明文", note: true });
    const before = [
      setWithDetails(
        calcDetail({ id: unchanged.id, name: unchanged.name }),
        calcDetail({ id: renamed.id, name: "古い名称" }),
        calcDetail({ id: cleared.id, name: "削除前" }),
        calcDetail({ id: note.id, name: "説明文", note: true }),
      ),
    ];
    const after = [setWithDetails(unchanged, renamed, added, cleared, note)];

    const result = autoEstimateDisplayForChanged(before, after);

    expect(result[0].details[0]).toBe(unchanged);
    expect(result[0].details[0].estimateDisplay).toBe("");
    expect(result[0].details[1].estimateDisplay).toBe("新しい名称");
    expect(result[0].details[2].estimateDisplay).toBe("木部");
    expect(result[0].details[3].estimateDisplay).toBe("");
    expect(result[0].details[4].estimateDisplay).toBe("");
  });

  it("何も入力しない場合は配列と明細の参照を保つ", () => {
    const detail = calcDetail({ id: "d1", name: "同じ名称" });
    const before = [setWithDetails(detail)];
    const after = [setWithDetails(calcDetail({ id: "d1", name: "同じ名称" }))];

    const result = autoEstimateDisplayForChanged(before, after);

    expect(result).toBe(after);
    expect(result[0]).toBe(after[0]);
    expect(result[0].details[0]).toBe(after[0].details[0]);
  });
});
