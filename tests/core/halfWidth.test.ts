import { describe, expect, it } from "vitest";
import { needsHalfWidth, toHalfWidth } from "../../src/core/text/halfWidth";

describe("toHalfWidth", () => {
  it("全角の数字・記号・空白を半角へ直す", () => {
    expect(toHalfWidth("１２３．４５")).toBe("123.45");
    expect(toHalfWidth("ＦＡ＊２")).toBe("FA*2");
    expect(toHalfWidth("＜ＡＷ１＞")).toBe("<AW1>");
    expect(toHalfWidth("１　＋　２")).toBe("1 + 2");
    expect(toHalfWidth("１ー２")).toBe("1-2");
  });

  it("日本語はそのまま残す", () => {
    expect(toHalfWidth("ビニル床タイル")).toBe("ビニル床タイル");
  });

  it("半角だけの文字は直す必要がない", () => {
    expect(needsHalfWidth("FA*2")).toBe(false);
    expect(needsHalfWidth("ＦＡ")).toBe(true);
  });
});
