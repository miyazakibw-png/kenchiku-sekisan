import { describe, expect, it } from "vitest";
import { sourceJumpOf } from "../../src/renderer/src/features/aggregate/aggregateRows";

describe("数量根拠から出所の計算書へ飛ぶ", () => {
  it("部屋・軸組・汎用・ピットは部位別入力表の行を開く", () => {
    expect(
      sourceJumpOf({ sourceKind: "room", estimateRowId: 12, traceId: "12:3:4" }),
    ).toEqual({ kind: "calcSheet", estimateRowId: 12 });
    expect(
      sourceJumpOf({
        sourceKind: "frame",
        estimateRowId: 7,
        traceId: "7:1:2",
      }),
    ).toEqual({ kind: "calcSheet", estimateRowId: 7 });
  });

  it("家具・設備入力表は表のid、部位別雑・金物入力表は行のidを返す", () => {
    expect(
      sourceJumpOf({
        sourceKind: "furniture",
        estimateRowId: null,
        traceId: "furniture:5:r1",
      }),
    ).toEqual({ kind: "furniture", sheetId: 5 });
    expect(
      sourceJumpOf({
        sourceKind: "furniture",
        estimateRowId: null,
        traceId: "furniturecol:5:r1:c1",
      }),
    ).toEqual({ kind: "furniture", sheetId: 5 });
    expect(
      sourceJumpOf({
        sourceKind: "misc",
        estimateRowId: 3,
        traceId: "misc:row-9:col-1",
      }),
    ).toEqual({ kind: "misc", rowId: "row-9" });
  });

  it("転記入力表は転記入力表を開く", () => {
    expect(
      sourceJumpOf({
        sourceKind: "transfer",
        estimateRowId: null,
        traceId: "transfer:4",
      }),
    ).toEqual({ kind: "transfer" });
  });

  it("元の行が分からないときは飛ばさない", () => {
    expect(
      sourceJumpOf({ sourceKind: "room", estimateRowId: null, traceId: "0:1:2" }),
    ).toBeNull();
  });
});
