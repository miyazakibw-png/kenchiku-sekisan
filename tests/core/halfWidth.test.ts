import { describe, expect, it } from "vitest";
import {
  needsHalfWidth,
  toHalfWidth,
  toHalfWidthName,
} from "../../src/core/text/halfWidth";

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

  it("名前用に英数字・空白・カタカナを半角へ直す", () => {
    expect(toHalfWidthName("ロビー")).toBe("ﾛﾋﾞｰ");
    expect(toHalfWidthName("コミュニケーション・ラウンジ")).toBe(
      "ｺﾐｭﾆｹｰｼｮﾝ･ﾗｳﾝｼﾞ",
    );
    expect(toHalfWidthName("１Ｆ　事務室")).toBe("1F 事務室");
    expect(toHalfWidthName("パーティー")).toBe("ﾊﾟｰﾃｨｰ");
    expect(toHalfWidthName("ガパ")).toBe("ｶﾞﾊﾟ");
    expect(toHalfWidthName("ヴ")).toBe("ｳﾞ");
    expect(toHalfWidthName("カ\u3099ハ\u309a")).toBe("ｶﾞﾊﾟ");
    expect(toHalfWidthName("か\u3099")).toBe("か\u3099");
    expect(toHalfWidthName("「ロビー」・、。")).toBe("｢ﾛﾋﾞｰ｣･､｡");
    expect(toHalfWidthName("ヶ所")).toBe("ヶ所");
    expect(toHalfWidthName("ヵ ヮ ヰ ヱ")).toBe("ヵ ヮ ヰ ヱ");
    expect(toHalfWidthName("ﾛﾋﾞｰ 1F")).toBe("ﾛﾋﾞｰ 1F");
  });
});
