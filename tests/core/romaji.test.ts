import { describe, expect, it } from "vitest";
import {
  hasKana,
  kanaToRomaji,
  romajiToKana,
} from "../../src/core/text/romaji";

describe("romajiToKana", () => {
  it("小文字のローマ字をひらがなにする", () => {
    expect(romajiToKana("yuka")).toBe("ゆか");
    expect(romajiToKana("habaki")).toBe("はばき");
    expect(romajiToKana("tenjou")).toBe("てんじょう");
  });

  it("っ・ん を打ち分ける", () => {
    expect(romajiToKana("kokka")).toBe("こっか");
    expect(romajiToKana("kannsou")).toBe("かんそう");
  });

  it("大文字・数字・記号はそのまま残す", () => {
    expect(romajiToKana("ROOM-A")).toBe("ROOM-A");
    expect(romajiToKana("m2")).toBe("m2");
  });

  it("打ちかけの子音は残す", () => {
    expect(romajiToKana("yuk")).toBe("ゆk");
  });
});

describe("kanaToRomaji", () => {
  it("かなを半角のローマ字にする", () => {
    expect(kanaToRomaji("あい")).toBe("ai");
    expect(kanaToRomaji("ゆか")).toBe("yuka");
    expect(kanaToRomaji("ケイ")).toBe("kei");
  });

  it("かなが無ければそのまま", () => {
    expect(kanaToRomaji("P*3")).toBe("P*3");
    expect(hasKana("P*3")).toBe(false);
    expect(hasKana("ゆか")).toBe(true);
  });
});
