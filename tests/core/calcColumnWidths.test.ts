import { describe, expect, it } from "vitest";
import {
  calcPrintColumnWidths,
  migrateCalcColumnWidthsV2ToV3,
} from "../../src/core/room/calcColumnWidths";

describe("計算書の列幅", () => {
  it("v2の画面順をv3の画面順へ並べ替える", () => {
    expect(migrateCalcColumnWidthsV2ToV3([80, 56, 42, 48, 54, 90])).toEqual([
      80, 48, 56, 42, 54, 90,
    ]);
  });

  it("v3の画面幅を印刷列の順番へ戻す", () => {
    expect(
      calcPrintColumnWidths(
        [80, 48, 56, 42, 54, 90],
        null,
        [80, 56, 42, 48, 54, 90],
      ),
    ).toEqual([80, 56, 42, 48, 54, 90]);
  });

  it("v3が無いときはv2を印刷列の位置で読む", () => {
    expect(
      calcPrintColumnWidths(
        null,
        [81, 57, 43, 49, 55, 91],
        [80, 56, 42, 48, 54, 90],
      ),
    ).toEqual([81, 57, 43, 49, 55, 91]);
  });
});
