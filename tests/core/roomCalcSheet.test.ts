import { describe, expect, it } from "vitest";
import {
  calcDetail,
  calcLine,
  calcSet,
  displayQuantity,
  evaluateCalcSheet,
  mergeWithPreviousSet,
  nextBSymbol,
  padLines,
  quantityByPart,
  splitSetAt,
  syncLines,
  syncPartNames,
  setRowCount,
  trimEmptySets,
  type CalcSet,
} from "../../src/core/room/calcSheet";

function sheet(lines: string[][], partName = "床"): CalcSet {
  const set = calcSet(1);
  set.partName = partName;
  set.lines = lines.map(([a, b = ""]) =>
    calcLine({ formulaA: a, formulaB: b }),
  );
  return set;
}

describe("下段セット明細計算表", () => {
  it("小数点以下2桁で表示し、2桁で0になる場合は数字が出る桁まで伸ばす", () => {
    expect(displayQuantity(9.985)).toBe("9.99");
    expect(displayQuantity(9.994)).toBe("9.99");
    expect(displayQuantity(0.00035)).toBe("0.0004");
    expect(displayQuantity(0)).toBe("0.00");
  });

  it("A・B両方あれば A×B、Aだけなら A のみ計算する", () => {
    const set = sheet([
      ["2.5*4", "2"],
      ["1.2+0.8", ""],
    ]);
    const result = evaluateCalcSheet([set], {});
    expect(result.lines.get(set.lines[0].id)?.text).toBe("20.00");
    expect(result.lines.get(set.lines[1].id)?.text).toBe("2.00");
    expect(result.lines.get(set.lines[1].id)?.totalText).toBe("22.00");
  });

  it("Bだけの入力は計算しない", () => {
    const set = sheet([["", "3"]]);
    const result = evaluateCalcSheet([set], {});
    expect(result.lines.get(set.lines[0].id)?.value).toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it("累計は表示されている数字を合計する", () => {
    const set = sheet([
      ["0.005", ""],
      ["0.005", ""],
    ]);
    const result = evaluateCalcSheet([set], {});
    expect(result.lines.get(set.lines[0].id)?.totalText).toBe("0.01");
    expect(result.lines.get(set.lines[1].id)?.totalText).toBe("0.02");
  });

  it("上段の記号と建具記号を使える", () => {
    const set = sheet([["WA-<AW1>", ""]]);
    const result = evaluateCalcSheet([set], { WA: 34.2, "<AW1>": 3.6 });
    expect(result.lines.get(set.lines[0].id)?.text).toBe("30.60");
  });

  it("部位に合わせた数値を建具記号に使える（補強＝軸組横補強）", () => {
    const wall = sheet([["<AW1>", ""]], "壁");
    const brace = sheet([["<AW1>", ""]], "補強");
    const variables = { "<AW1>": 3.6, "<AW1:RF>": 5.4 };
    const result = evaluateCalcSheet([wall, brace], variables, (set) =>
      set.partName === "補強" ? { "<AW1>": variables["<AW1:RF>"] } : {},
    );
    expect(result.lines.get(wall.lines[0].id)?.text).toBe("3.60");
    expect(result.lines.get(brace.lines[0].id)?.text).toBe("5.40");
  });

  it("分からない記号・誤った式は理由を返す", () => {
    const set = sheet([
      ["XX*2", ""],
      ["1*", ""],
    ]);
    const result = evaluateCalcSheet([set], {});
    expect(result.lines.get(set.lines[0].id)?.error).toContain("XX");
    expect(result.lines.get(set.lines[1].id)?.error).toBe(
      "計算式が正しくありません",
    );
    expect(result.errors).toHaveLength(2);
  });

  it("B記号は他のセットの累計として使える", () => {
    const first = sheet([["2*3", ""]]);
    first.lines[0].bSymbol = "B1";
    const second = sheet([["B1*2", ""]], "壁");
    const result = evaluateCalcSheet([second, first], {});
    expect(result.lines.get(second.lines[0].id)?.text).toBe("12.00");
    expect(nextBSymbol([first, second])).toBe("B2");
  });

  it("B記号が循環している場合はエラーにする", () => {
    const first = sheet([["B2", ""]]);
    first.lines[0].bSymbol = "B1";
    const second = sheet([["B1", ""]], "壁");
    second.lines[0].bSymbol = "B2";
    const result = evaluateCalcSheet([first, second], {});
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("部位・材種区分ごとに数量を集計する（チェック表用）", () => {
    const set = sheet([["2*3", ""]]);
    set.details[0].name = "ビニル床シート";
    set.details[0].materialCategory = "仕上";
    const result = evaluateCalcSheet([set], {});
    expect(quantityByPart([set], result)).toEqual([
      { partName: "床", materialCategory: "仕上", quantity: 6 },
    ]);
  });

  it("明細1件は1行で表示する（計算式が多ければその行数に合わせる）", () => {
    const set = calcSet(2);
    expect(set.details).toHaveLength(2);
    expect(setRowCount(set)).toBe(2);
    set.lines = [...set.lines, calcLine(), calcLine()];
    expect(setRowCount(set)).toBe(4);
  });

  it("明細を増やすと計算式行も明細1件＝1行に足りるまで足す", () => {
    const set = calcSet(2);
    set.details = [...set.details, calcDetail()];
    const lines = padLines(set.details, set.lines);
    expect(lines).toHaveLength(3);
    expect(setRowCount({ ...set, lines })).toBe(3);
  });

  it("明細を減らすと末尾の空いた計算式行は詰める（入力済みは残す）", () => {
    const set = calcSet(3);
    set.details = [set.details[0]];
    expect(syncLines(set.details, set.lines)).toHaveLength(1);
    const kept = [...set.lines];
    kept[2] = calcLine({ formulaA: "1+1" });
    expect(syncLines(set.details, kept)).toHaveLength(3);
  });

  it("入力の無い明細・セットは取り除く（入力済みは残す）", () => {
    const empty = calcSet(2);
    const used = calcSet(2);
    used.partName = "床";
    used.details[0] = calcDetail({ name: "ビニル床タイル" });
    const trimmed = trimEmptySets([empty, used]);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].details).toHaveLength(1);
    expect(trimmed[0].lines).toHaveLength(1);
  });

  it("計算式だけ入っている明細は残す", () => {
    const set = calcSet(2);
    set.lines[1] = calcLine({ formulaA: "2*3" });
    const trimmed = trimEmptySets([set]);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].details).toHaveLength(2);
  });

  it("途中の行に部位を入れると、その行から別のセットに分かれる", () => {
    const set = calcSet(3);
    set.partName = "床";
    set.details[2] = calcDetail({ name: "巾木" });
    set.lines[2] = calcLine({ formulaA: "2*3" });
    const split = splitSetAt([set], set.id, 2, {
      partNumber: 2,
      partName: "巾木",
    });
    expect(split).toHaveLength(2);
    expect(split[0].partName).toBe("床");
    expect(split[0].details).toHaveLength(2);
    expect(split[1].partName).toBe("巾木");
    expect(split[1].details[0].name).toBe("巾木");
    expect(split[1].lines[0].formulaA).toBe("2*3");
  });

  it("部位を消すと一つ上のセットにつながる", () => {
    const first = calcSet(1);
    first.partName = "床";
    const second = calcSet(1);
    second.partName = "巾木";
    second.details[0] = calcDetail({ name: "木巾木" });
    const merged = mergeWithPreviousSet([first, second], second.id);
    expect(merged).toHaveLength(1);
    expect(merged[0].partName).toBe("床");
    expect(merged[0].details).toHaveLength(2);
    expect(merged[0].details[1].name).toBe("木巾木");
  });
});

describe("部位マスターとの連動", () => {
  it("部位マスターで名前を直すと明細の部位表示も変わる", () => {
    const set = calcSet(1);
    set.partNumber = 10;
    set.partName = "その他";
    set.details = [
      calcDetail({ partNumber: 3, partName: "旧かべ", name: "クロス" }),
    ];
    const [synced] = syncPartNames(
      [set],
      [{ id: 10, name: "補強" }],
      [{ id: 3, name: "壁" }],
    );
    expect(synced.partName).toBe("補強");
    expect(synced.details[0].partName).toBe("壁");
  });

  it("番号が無い行はそのままにする", () => {
    const set = calcSet(1);
    set.partName = "手入力部位";
    const sets = [set];
    expect(syncPartNames(sets, [{ id: 10, name: "補強" }], [])).toBe(sets);
  });
});
