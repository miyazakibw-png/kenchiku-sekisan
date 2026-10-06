import { describe, expect, it } from "vitest";
import {
  beamLength,
  columnKey,
  columnNumbers,
  dividedBeams,
  emptyFloor,
  enclosingRegion,
  girderKey,
  girderNumber,
  nudgeBeam,
  parseDrawing,
  parseSpanList,
  positions,
  serializeDrawing,
  spanListText,
  xGridLabel,
  yGridLabel,
  type FireproofDrawingFloor,
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

describe("区画の検出（まわりを囲む線）", () => {
  // 2×2スパンの基準形。大梁は外周＋中央十字に入れて4区画にする
  const floor: FireproofDrawingFloor = {
    ...emptyFloor(),
    xSpans: [6000, 6000],
    ySpans: [5000, 5000],
    girders: {
      "x:0,0": "G1",
      "x:1,0": "G2",
      "x:0,1": "G3",
      "x:1,1": "G4",
      "x:0,2": "G5",
      "x:1,2": "G6",
      "y:0,0": "G7",
      "y:0,1": "G8",
      "y:1,0": "G9",
      "y:1,1": "G10",
      "y:2,0": "G11",
      "y:2,1": "G12",
    },
  };

  it("大梁で囲まれた中をクリックするとその区画が返る", () => {
    expect(enclosingRegion(floor, 3000, 2500)).toEqual({
      x: 0,
      y: 0,
      width: 6000,
      height: 5000,
    });
    expect(enclosingRegion(floor, 9000, 7500)).toEqual({
      x: 6000,
      y: 5000,
      width: 6000,
      height: 5000,
    });
  });

  it("小梁で分けた小さい区画も選べる", () => {
    const withBeam: FireproofDrawingFloor = {
      ...floor,
      beams: [
        { x1: 4000, y1: 0, x2: 4000, y2: 5000, symbol: "B40" },
      ],
    };
    // 左上区画の左半分（0<x<4000）と右半分（4000<x<6000）に分かれる
    expect(enclosingRegion(withBeam, 2000, 2500)).toEqual({
      x: 0,
      y: 0,
      width: 4000,
      height: 5000,
    });
    expect(enclosingRegion(withBeam, 5000, 2500)).toEqual({
      x: 4000,
      y: 0,
      width: 2000,
      height: 5000,
    });
  });

  it("周りが揃わないところ（外側・片側しか線が無い）は区画にならない", () => {
    expect(enclosingRegion(floor, -1000, 2500)).toBeNull();
    const onlyWall: FireproofDrawingFloor = {
      ...emptyFloor(),
      xSpans: [6000],
      ySpans: [5000],
      girders: { "x:0,0": "G1" }, // 上辺だけ
    };
    expect(enclosingRegion(onlyWall, 3000, 2500)).toBeNull();
  });
});

describe("小梁の配置・調整", () => {
  const region = { x: 0, y: 0, width: 9000, height: 6000 };

  it("分割数＝でき上がる区画の数（3分割→縦に2本）", () => {
    const beams = dividedBeams(region, "v", 3, "B40");
    expect(beams).toHaveLength(2);
    expect(beams[0]).toEqual({ x1: 3000, y1: 0, x2: 3000, y2: 6000, symbol: "B40" });
    expect(beams[1]).toEqual({ x1: 6000, y1: 0, x2: 6000, y2: 6000, symbol: "B40" });
  });

  it("横方向の分割・1分割以下は置かない", () => {
    const beams = dividedBeams(region, "h", 2, "B25");
    expect(beams).toEqual([
      { x1: 0, y1: 3000, x2: 9000, y2: 3000, symbol: "B25" },
    ]);
    expect(dividedBeams(region, "v", 1, "B40")).toEqual([]);
  });

  it("長さと微調整（縦は左右・横は上下）", () => {
    const beam = { x1: 3000, y1: 0, x2: 3000, y2: 6000, symbol: "B40" };
    expect(beamLength(beam)).toBe(6000);
    expect(nudgeBeam(beam, 250)).toEqual({ ...beam, x1: 3250, x2: 3250 });
    const flat = { x1: 0, y1: 3000, x2: 9000, y2: 3000, symbol: "B25" };
    expect(nudgeBeam(flat, -100)).toEqual({ ...flat, y1: 2900, y2: 2900 });
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
