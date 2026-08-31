import { describe, expect, it } from "vitest";
import {
  hasKana,
  kanaToRomaji,
  romajiToKana,
  typedToKana,
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

describe("typedToKana", () => {
  it("大文字でも全部ひらがなに直せるときは直す", () => {
    expect(typedToKana("TE")).toBe("て");
    expect(typedToKana("KABE")).toBe("かべ");
    expect(typedToKana("Kabe")).toBe("かべ");
    expect(typedToKana("ビニール床タイル TE")).toBe("ビニール床タイル て");
  });

  it("記号・寸法はそのまま残す", () => {
    expect(typedToKana("W900")).toBe("W900");
    expect(typedToKana("ROOM-A")).toBe("ROOM-A");
    expect(typedToKana("SD1")).toBe("SD1");
    expect(typedToKana("t12.5")).toBe("t12.5");
  });

  it("小文字はこれまでどおり直す", () => {
    expect(typedToKana("kabe")).toBe("かべ");
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
