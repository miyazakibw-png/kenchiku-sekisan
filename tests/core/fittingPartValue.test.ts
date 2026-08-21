import { describe, expect, it } from "vitest";
import {
  DEFAULT_FITTING_PART_VALUES,
  fittingKindForPart,
  fittingSuffix,
  fittingSymbolForPart,
  parseFittingPartValues,
} from "../../src/core/fittings/partValue";

describe("建具記号の部位ごとの採用値", () => {
  it("初期の決まりは 壁＝面積・巾木＝巾木減・補強＝軸組横補強", () => {
    const values = DEFAULT_FITTING_PART_VALUES;
    expect(fittingSymbolForPart("AW1", "壁", values)).toBe("<AW1>");
    expect(fittingSymbolForPart("AW1", "巾木", values)).toBe("<AW1:HL>");
    expect(fittingSymbolForPart("AW1", "補強", values)).toBe("<AW1:RF>");
  });

  it("部位名を含む名前でも当てはめる", () => {
    expect(fittingKindForPart("内部壁", DEFAULT_FITTING_PART_VALUES)).toBe(
      "area",
    );
    expect(fittingKindForPart("横補強", DEFAULT_FITTING_PART_VALUES)).toBe(
      "reinforcement",
    );
  });

  it("設定に無い部位・空欄は面積を採る", () => {
    expect(
      fittingSymbolForPart("SD2", "天井", DEFAULT_FITTING_PART_VALUES),
    ).toBe("<SD2>");
    expect(fittingSymbolForPart("SD2", "", DEFAULT_FITTING_PART_VALUES)).toBe(
      "<SD2>",
    );
  });

  it("W・Hも選べる", () => {
    const values = [{ partName: "建具巾", kind: "width" as const }];
    expect(fittingSymbolForPart("SD2", "建具巾", values)).toBe("<SD2:W>");
    expect(fittingSuffix("height")).toBe(":H");
  });

  it("保存値が壊れていても初期の決まりに戻す", () => {
    expect(parseFittingPartValues("こわれた")).toEqual(
      DEFAULT_FITTING_PART_VALUES,
    );
    expect(parseFittingPartValues('[{"partName":"壁","kind":"nope"}]')).toEqual(
      [],
    );
    expect(
      parseFittingPartValues('[{"partName":"壁","kind":"baseboard"}]'),
    ).toEqual([{ partName: "壁", kind: "baseboard" }]);
  });
});
