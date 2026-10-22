import { describe, expect, it } from "vitest";
import {
  DEFAULT_FITTING_PART_VALUES,
  fittingKindForPart,
  fittingPartVariables,
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
    ).toEqual([{ partId: null, partName: "壁", kind: "baseboard" }]);
  });

  it("同じ名前の部位が複数あっても部位番号で取り違えない", () => {
    const values = [
      { partId: 3, partName: "壁", kind: "area" as const },
      { partId: 13, partName: "壁", kind: "baseboard" as const },
    ];
    expect(fittingSymbolForPart("AW1", "壁", values, 3)).toBe("<AW1>");
    expect(fittingSymbolForPart("AW1", "壁", values, 13)).toBe("<AW1:HL>");
  });

  it("番号が設定に無いときは名前で当てはめる", () => {
    expect(fittingKindForPart("補強", DEFAULT_FITTING_PART_VALUES, 999)).toBe(
      "reinforcement",
    );
  });
});

describe("式に <記号> だけ書いたときの採用値（画面と集計で共通）", () => {
  const variables = {
    "<SD1>": 1.79,
    "<SD1:HL>": 0.85,
    "<SD1:RF>": 5.05,
    "<SD1:W>": 0.85,
  };
  const symbols = ["SD1"];

  it("補強のセットでは <記号> が軸組横補強を指す", () => {
    expect(
      fittingPartVariables(
        { partName: "補強", partNumber: null },
        symbols,
        variables,
        DEFAULT_FITTING_PART_VALUES,
      ),
    ).toEqual({ "<SD1>": 5.05 });
  });

  it("巾木のセットでは <記号> が巾木減を指す", () => {
    expect(
      fittingPartVariables(
        { partName: "巾木", partNumber: null },
        symbols,
        variables,
        DEFAULT_FITTING_PART_VALUES,
      ),
    ).toEqual({ "<SD1>": 0.85 });
  });

  it("面積を採る部位では上書きしない（<記号> は面積のまま）", () => {
    expect(
      fittingPartVariables(
        { partName: "壁", partNumber: null },
        symbols,
        variables,
        DEFAULT_FITTING_PART_VALUES,
      ),
    ).toEqual({});
  });
});
