import { describe, expect, it } from "vitest";
import {
  columnKey,
  columnNumbers,
  emptyFloor,
  girderKey,
  girderNumber,
  parseDrawing,
  parseSpanList,
  positions,
  serializeDrawing,
  spanListText,
  xGridLabel,
  yGridLabel,
} from "../../src/core/fireproof/fireproofDrawing";

describe("parseSpanList", () => {
  it("カンマ・読点・空白区切りを寸法の並びにする", () => {
    expect(parseSpanList("7300,7650,7300")).toEqual([7300, 7650, 7300]);
    expect(parseSpanList("7350、6650")).toEqual([7350, 6650]);
    expect(parseSpanList("7350 6650　 3000")).toEqual([7350, 6650, 3000]);
  });
  it("0以下・数に直せないものは捨てる", () => {
    expect(parseSpanList("7300,-5,abc,0,1000")).toEqual([7300, 1000]);
    expect(parseSpanList("")).toEqual([]);
  });
  it("spanListText で入力欄へ戻せる", () => {
    expect(spanListText([7300, 7650])).toBe("7300,7650");
  });
});

describe("positions", () => {
  it("累積の座標を返す（先頭は0）", () => {
    expect(positions([7300, 7650, 7300])).toEqual([0, 7300, 14950, 22250]);
    expect(positions([])).toEqual([0]);
  });
});

describe("交点・区間の番号付け", () => {
  const floor = { ...emptyFloor(), xSpans: [7300, 7650], ySpans: [7350, 6650] };

  it("交点は左上から右へ・上から下へ1から振る", () => {
    expect(columnNumbers(floor)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
  });

  it("大梁はX方向の区間を先に、つづいてY方向を振る", () => {
    // X区間：3行×2列 = 6本 → 1〜6
    expect(girderNumber("x", 0, 0, floor)).toBe(1);
    expect(girderNumber("x", 1, 2, floor)).toBe(6);
    // Y区間：3列×2行 = 6本 → 7〜12
    expect(girderNumber("y", 0, 0, floor)).toBe(7);
    expect(girderNumber("y", 2, 1, floor)).toBe(12);
  });

  it("キーは座標の行・列で決まる（寸法を変えても位置が同じなら記号が残る）", () => {
    expect(columnKey(2, 1)).toBe("2,1");
    expect(girderKey("x", 0, 2)).toBe("x:0,2");
    expect(girderKey("y", 1, 0)).toBe("y:1,0");
  });
});

describe("通し芯ラベル", () => {
  it("X軸は丸数字、Y軸はアルファベット", () => {
    expect(xGridLabel(0)).toBe("①");
    expect(xGridLabel(9)).toBe("⑩");
    expect(xGridLabel(20)).toBe("(21)");
    expect(yGridLabel(0)).toBe("A");
    expect(yGridLabel(25)).toBe("Z");
    expect(yGridLabel(26)).toBe("AA");
    expect(yGridLabel(27)).toBe("AB");
  });
});

describe("parseDrawing / serializeDrawing", () => {
  it("往復で内容が戻る", () => {
    const drawing = {
      floors: {
        "2": {
          ...emptyFloor(),
          xSpans: [7300],
          ySpans: [7350, 6650],
          columns: { "0,0": "C1" },
          girders: { "x:0,0": "G1", "y:0,0": "G11" },
          image: "data:image/png;base64,xxx",
          pixelsPerMm: 0.12,
          imageWidth: 1000,
          imageHeight: 800,
        },
      },
    };
    expect(parseDrawing(serializeDrawing(drawing))).toEqual(drawing);
  });

  it("壊れたJSON・型の違う値は空として読む", () => {
    expect(parseDrawing("not json")).toEqual({ floors: {} });
    expect(parseDrawing("{}")).toEqual({ floors: {} });
    const parsed = parseDrawing(
      JSON.stringify({
        floors: {
          "1": { xSpans: ["7300", -1], columns: { "0,0": 12, "1,1": "C9" } },
        },
      }),
    );
    expect(parsed.floors["1"].xSpans).toEqual([7300]);
    expect(parsed.floors["1"].columns).toEqual({ "1,1": "C9" });
  });
});
