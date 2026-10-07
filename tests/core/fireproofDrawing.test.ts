import { describe, expect, it } from "vitest";
import {
  axisHeightAt,
  beamImportItems,
  beamLength,
  beamSlopeLength,
  clipBeamAtDiagEdges,
  columnImportItems,
  columnKey,
  columnNumbers,
  COLUMN_IMPORT_HEAD_COMMENT,
  dividedBeams,
  emptyFloor,
  enclosingRegion,
  girderKey,
  girderNumber,
  girderOffset,
  joinDiagGirders,
  missingJointKeys,
  nudgeBeam,
  parseDrawing,
  parseSpanList,
  refitBeams,
  positions,
  serializeDrawing,
  spanListText,
  unconnectedDiagEnds,
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
    expect(xGridLabel(0)).toBe("1");
    expect(xGridLabel(9)).toBe("10");
    expect(xGridLabel(20)).toBe("21");
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
      insetLeft: 75,
      insetRight: 75,
      insetTop: 75,
      insetBottom: 75,
      pinX: 3000,
      pinY: 2500,
    });
    expect(enclosingRegion(floor, 9000, 7500)).toEqual({
      x: 6000,
      y: 5000,
      width: 6000,
      height: 5000,
      insetLeft: 75,
      insetRight: 75,
      insetTop: 75,
      insetBottom: 75,
      pinX: 9000,
      pinY: 7500,
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
      insetLeft: 75,
      insetRight: 60,
      insetTop: 75,
      insetBottom: 75,
      pinX: 2000,
      pinY: 2500,
    });
    expect(enclosingRegion(withBeam, 5000, 2500)).toEqual({
      x: 4000,
      y: 0,
      width: 2000,
      height: 5000,
      insetLeft: 60,
      insetRight: 75,
      insetTop: 75,
      insetBottom: 75,
      pinX: 5000,
      pinY: 2500,
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

  it("境界の半幅がある区画では小梁の端を線の内側（内内寸法）に寄せる", () => {
    const inset = {
      ...region,
      insetLeft: 75,
      insetRight: 75,
      insetTop: 75,
      insetBottom: 60,
    };
    const v = dividedBeams(inset, "v", 2, "B40");
    expect(v).toEqual([
      { x1: 4500, y1: 75, x2: 4500, y2: 5940, symbol: "B40" },
    ]);
    const h = dividedBeams(inset, "h", 2, "B25");
    expect(h).toEqual([
      { x1: 75, y1: 3000, x2: 8925, y2: 3000, symbol: "B25" },
    ]);
  });

  it("部材幅の半分を渡すと内内寸法がその幅で出る（リストの後ろの数字の半分）", () => {
    // G1 は 500*300 → 幅300 → 半分150。囲む線の内側（内内）に小梁の端が止まる
    const inset = {
      ...region,
      insetLeft: 150,
      insetRight: 150,
      insetTop: 150,
      insetBottom: 150,
    };
    const v = dividedBeams(inset, "v", 2, "B40");
    expect(v).toEqual([
      { x1: 4500, y1: 150, x2: 4500, y2: 5850, symbol: "B40" },
    ]);
    const h = dividedBeams(inset, "h", 2, "B25");
    expect(h).toEqual([
      { x1: 150, y1: 3000, x2: 8850, y2: 3000, symbol: "B25" },
    ]);
  });

  it("enclosingRegionに部材幅を渡すと境界の半幅がその部材幅になる", () => {
    const floor = {
      ...emptyFloor(),
      xSpans: [6000],
      ySpans: [6000],
      girders: {
        "x:0,0": "G1",
        "x:0,1": "G1",
        "y:0,0": "G2",
        "y:1,0": "G2",
      },
    };
    const widthOf = (symbol: string) =>
      symbol === "G1" ? 150 : symbol === "G2" ? 125 : null;
    const found = enclosingRegion(floor, 3000, 3000, widthOf);
    expect(found).toMatchObject({
      x: 0,
      y: 0,
      width: 6000,
      height: 6000,
      insetLeft: 125,
      insetRight: 125,
      insetTop: 150,
      insetBottom: 150,
    });
    // 渡さないときは描き幅の半分（75）のまま
    const plain = enclosingRegion(floor, 3000, 3000);
    expect(plain).toMatchObject({ insetLeft: 75, insetTop: 75 });
  });

  it("長さと微調整（縦は左右・横は上下）", () => {
    const beam = { x1: 3000, y1: 0, x2: 3000, y2: 6000, symbol: "B40" };
    expect(beamLength(beam)).toBe(6000);
    expect(nudgeBeam(beam, 250)).toEqual({ ...beam, x1: 3250, x2: 3250 });
    const flat = { x1: 0, y1: 3000, x2: 9000, y2: 3000, symbol: "B25" };
    expect(nudgeBeam(flat, -100)).toEqual({ ...flat, y1: 2900, y2: 2900 });
  });

  it("refitBeams：芯まで伸びた小梁を、その区画の内内寸法に入れ直す", () => {
    const floor: FireproofDrawingFloor = {
      ...emptyFloor(),
      xSpans: [6000],
      ySpans: [6000],
      girders: {
        "x:0,0": "G1",
        "x:0,1": "G1",
        "y:0,0": "G1",
        "y:1,0": "G1",
      },
      // 芯から芯まで伸びた縦の小梁（古い置き方）
      beams: [{ x1: 3000, y1: 0, x2: 3000, y2: 6000, symbol: "B40" }],
    };
    const refit = refitBeams(floor, () => 150);
    expect(refit).toEqual([
      { x1: 3000, y1: 150, x2: 3000, y2: 5850, symbol: "B40" },
    ]);
    // いったん内内なら二回目は変わらない（連動のあと動かない）
    const again = refitBeams({ ...floor, beams: refit }, () => 150);
    expect(again).toEqual(refit);
  });
});

describe("大梁の端寄せ（柱の面に合わせる）", () => {
  // 2列の柱（左550×550・右400×400）のあいだの大梁。小さいほうの柱の面に合わせる
  const colHalf = (symbol: string) =>
    symbol === "C1"
      ? { hw: 275, hd: 275 }
      : symbol === "C2"
        ? { hw: 200, hd: 200 }
        : null;
  const floor: FireproofDrawingFloor = {
    ...emptyFloor(),
    xSpans: [6000],
    ySpans: [6000],
    columns: { "0,0": "C1", "1,0": "C2", "0,1": "C1", "1,1": "C2" },
    girders: {
      "x:0,0": "G1",
      "x:0,1": "G1",
      "y:0,0": "G1",
      "y:1,0": "G1",
    },
  };
  const girderHalf = () => 150; // G1：300幅→半分150

  it("中央（寄せ無し）はずらし量0", () => {
    expect(
      girderOffset(floor, "x:0,0", girderHalf, colHalf),
    ).toBe(0);
  });

  it("上・左へ寄せ（min）：梁の外側の面が小さい柱の面（-200）に付く", () => {
    const f: FireproofDrawingFloor = {
      ...floor,
      girderAlign: { "x:0,0": "min" },
    };
    // 梁の上面が -200 の面に付く → 芯から 150-200 = -50（上へ50）
    expect(girderOffset(f, "x:0,0", girderHalf, colHalf)).toBe(-50);
    // 縦の梁（y:0,0）は左端寄せ：C1 の面 -275 に付く → 150-275 = -125
    const f2: FireproofDrawingFloor = {
      ...floor,
      girderAlign: { "y:0,0": "min" },
    };
    expect(girderOffset(f2, "y:0,0", girderHalf, colHalf)).toBe(-125);
  });

  it("下・右へ寄せ（max）：反対側の面に付く", () => {
    const f: FireproofDrawingFloor = {
      ...floor,
      girderAlign: { "x:0,1": "max", "y:1,0": "max" },
    };
    expect(girderOffset(f, "x:0,1", girderHalf, colHalf)).toBe(50);
    // 縦の梁は右端の面＝ C2の面 +200 → 200-150 = +50
    expect(girderOffset(f, "y:1,0", girderHalf, colHalf)).toBe(50);
  });

  it("寸法が分からない柱は、図に描かれる面（半幅120）に合わせる", () => {
    const f: FireproofDrawingFloor = {
      ...floor,
      girderAlign: { "x:0,0": "max" },
    };
    const unknown = () => null;
    // 両端とも寸法不明 → 面は ±120 → 芯から 120-150 = -30
    expect(girderOffset(f, "x:0,0", girderHalf, unknown)).toBe(-30);
    // 柱がまったく無い端だけは芯（0）
    const noCol: FireproofDrawingFloor = {
      ...emptyFloor(),
      xSpans: [6000],
      ySpans: [6000],
      girders: { "x:0,0": "G1" },
      girderAlign: { "x:0,0": "max" },
    };
    expect(girderOffset(noCol, "x:0,0", girderHalf, unknown)).toBe(-150);
    // 片端にだけ柱があるときは、その柱の面に合わせる
    const oneCol: FireproofDrawingFloor = {
      ...noCol,
      columns: { "0,0": "C1" },
    };
    const c1 = (s: string) =>
      s === "C1" ? { hw: 200, hd: 200 } : null;
    expect(girderOffset(oneCol, "x:0,0", girderHalf, c1)).toBe(50);
  });

  it("端寄せした大梁は区画の境界もその位置になる（小梁の内内も連動）", () => {
    const f: FireproofDrawingFloor = {
      ...floor,
      girderAlign: { "x:0,0": "max" }, // 上辺の梁が下へ50
      beams: [{ x1: 3000, y1: 0, x2: 3000, y2: 6000, symbol: "B40" }],
    };
    const region = enclosingRegion(f, 3000, 3000, girderHalf, true, colHalf);
    expect(region).toMatchObject({ y: 50, height: 5950 });
    const refit = refitBeams(f, girderHalf, colHalf);
    expect(refit[0]).toEqual({
      x1: 3000,
      y1: 200, // 上辺の梁（芯50・半幅150）の内側の面に止まる
      x2: 3000,
      y2: 5850,
      symbol: "B40",
    });
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

describe("勾配（通りごとの柱高さ）", () => {
  const slopeFloor: FireproofDrawingFloor = {
    ...emptyFloor(),
    xSpans: [6000],
    ySpans: [6000, 6000],
  };

  it("空欄の通りはその階の階高を使う", () => {
    expect(axisHeightAt(slopeFloor, 1, 4000)).toBe(4000);
    const withAxis = { ...slopeFloor, axisHeights: { "1": 4500 } };
    expect(axisHeightAt(withAxis, 1, 4000)).toBe(4500);
    expect(axisHeightAt(withAxis, 0, 4000)).toBe(4000);
  });

  it("縦の梁は両端の通りの高さ差ぶん長くなる", () => {
    // 通り0↔1の縦の梁（平面6000）。高さ 4000↔4500 → dh=500
    const f = { ...slopeFloor, axisHeights: { "0": 4000, "1": 4500, "2": 4500 } };
    const beam = { x1: 3000, y1: 500, x2: 3000, y2: 6500, symbol: "B1" };
    expect(Math.round(beamSlopeLength(beam, f, 4000))).toBe(
      Math.round(Math.hypot(6000, 500)),
    );
  });

  it("横の梁は横通り同士の高さ差ぶん長くなる", () => {
    // 横通り0↔1の横の梁（平面5000）。高さ 3000↔4000 → dh=1000
    const f = { ...slopeFloor, axisHeightsX: { "0": 3000 } };
    const beam = { x1: 500, y1: 3000, x2: 5500, y2: 3000, symbol: "B1" };
    expect(Math.round(beamSlopeLength(beam, f, 4000))).toBe(
      Math.round(Math.hypot(5000, 1000)),
    );
    // axisHeightsXが無いときは平図の長さのまま
    expect(beamSlopeLength(beam, slopeFloor, 4000)).toBe(5000);
  });

  it("高さ差が無いときは平図の長さのまま", () => {
    const beam = { x1: 3000, y1: 500, x2: 3000, y2: 6500, symbol: "B1" };
    expect(beamSlopeLength(beam, slopeFloor, 4000)).toBe(6000);
  });
});

describe("取合記号・通り高さの保存", () => {
  it("jointSymbols・axisHeights・小梁idも往復で残る", () => {
    const floor: FireproofDrawingFloor = {
      ...emptyFloor(),
      xSpans: [6000],
      ySpans: [6000],
      beams: [{ x1: 100, y1: 100, x2: 100, y2: 5900, symbol: "B1", id: "b12ab" }],
      jointSymbols: { "g:x:0,0": "3", "b:b12ab": "2", "c:0,0": "4" },
      axisHeights: { "0": 4500 },
      axisHeightsX: { "1": 4200 },
    };
    const back = parseDrawing(serializeDrawing({ floors: { "1": floor } }));
    expect(back.floors["1"]).toEqual(floor);
  });

  it("古い端ごとの取合記号キーは部材ごとのキーに読み替える", () => {
    const drawing = parseDrawing(
      `{
        "floors": {
          "1": {
            "xSpans": [6000], "ySpans": [6000],
            "jointSymbols": {
              "g:x:0,0:0": "3", "g:x:0,0:1": "2",
              "b:b12ab:1": "4", "c:0,0": "3"
            }
          }
        }
      }`,
    );
    expect(drawing.floors["1"]?.jointSymbols).toEqual({
      "g:x:0,0": "3",
      "b:b12ab": "4",
      "c:0,0": "3",
    });
  });
});

describe("columnImportItems", () => {
  const floor: FireproofDrawingFloor = {
    ...emptyFloor(),
    xSpans: [6000, 6000],
    ySpans: [6000],
    columns: { "0,0": "C1", "1,0": "C2", "0,1": "C1", "2,1": "C3" },
    jointSymbols: { "c:0,0": "3", "c:2,1": "2" },
  };

  it("上の通りから順に、位置・記号・取合番号・高さを入れた行を作る（縦通りの記号は図の下がA）", () => {
    const items = columnImportItems(floor, 4000);
    // コメントは各行に柱位置だけ（案内文の先頭行は画面側で足す・階数は階欄が持つ）
    expect(items).toEqual([
      { comment: "1-B", symbol: "C1", mark: "3", lengthFormula: "4" },
      { comment: "2-B", symbol: "C2", mark: "", lengthFormula: "4" },
      { comment: "1-A", symbol: "C1", mark: "", lengthFormula: "4" },
      { comment: "3-A", symbol: "C3", mark: "2", lengthFormula: "4" },
    ]);
    expect(COLUMN_IMPORT_HEAD_COMMENT).toBe(
      "柱位置表示（縦軸左より1から順に2,3と表記する・横軸下よりAから順にB,Cと表記する）",
    );
  });

  it("通りごとの高さが入っているときはその値を使う（縦通りが先、横通りはその次）", () => {
    const slope: FireproofDrawingFloor = {
      ...floor,
      axisHeights: { "0": 5000 },
      axisHeightsX: { "1": 4500 },
    };
    const items = columnImportItems(slope, 4000);
    // yi=0 の2本は縦通り"0"の5000、yi=1 の2本は階高4000（横通りの値は縦通りが無い交点だけ）
    expect(items.map((each) => each.lengthFormula)).toEqual([
      "5", "5", "4", "4",
    ]);
  });

  it("縦通りが無い交点は横通りの高さを使う", () => {
    const slope: FireproofDrawingFloor = {
      ...floor,
      axisHeightsX: { "1": 4500 },
    };
    const items = columnImportItems(slope, 4000);
    expect(items[1]?.lengthFormula).toBe("4.5");
  });

  it("記号の無い交点・階高不明は行を作らない・式は空欄", () => {
    const sparse: FireproofDrawingFloor = {
      ...floor,
      columns: { "0,0": "C1", "1,0": "" },
    };
    expect(columnImportItems(sparse, 4000)).toHaveLength(1);
    expect(columnImportItems(sparse, null)[0]?.lengthFormula).toBe("");
  });
});

describe("beamImportItems", () => {
  const floor: FireproofDrawingFloor = {
    ...emptyFloor(),
    xSpans: [6000, 6000],
    ySpans: [6000],
    columns: { "0,0": "C1", "1,0": "C1", "2,0": "C1", "0,1": "C1", "1,1": "C1" },
    girders: {
      "x:0,0": "G1",
      "x:1,0": "G2",
      "y:0,0": "G3",
      "y:1,0": "G4",
    },
    beams: [{ x1: 3000, y1: 100, x2: 3000, y2: 5900, symbol: "B1", id: "b12ab" }],
    jointSymbols: { "g:x:0,0": "3", "b:b12ab": "2" },
  };

  it("大梁は通し番号どおり・小梁はそのあとに並ぶ（柱の面どうしの長さ）", () => {
    const items = beamImportItems(floor, 4000);
    // 柱の半幅120を両端から引いた 5760mm（柱の寸法を渡さないときは描き幅の半分で計算）
    expect(items).toEqual([
      { comment: "B-1〜2", symbol: "G1", mark: "3", lengthFormula: "5.76" },
      { comment: "B-2〜3", symbol: "G2", mark: "", lengthFormula: "5.76" },
      { comment: "1-A〜B", symbol: "G3", mark: "", lengthFormula: "5.76" },
      { comment: "2-A〜B", symbol: "G4", mark: "", lengthFormula: "5.76" },
      { comment: "1〜2-A〜B", symbol: "B1", mark: "2", lengthFormula: "5.8" },
    ]);
  });

  it("柱の大きさを渡すとその面どうしの長さになる", () => {
    const items = beamImportItems(floor, 4000, () => ({
      hw: 250,
      hd: 250,
    }));
    expect(items[0]?.lengthFormula).toBe("5.5");
  });

  it("横通りの高さ差は勾配ぶん長くなる", () => {
    const slope: FireproofDrawingFloor = {
      ...floor,
      axisHeightsX: { "0": 3000 },
    };
    const items = beamImportItems(slope, 4000);
    // 左端の大梁は両端の高さが 3000↔4000 → hypot(5760, 1000)
    expect(items[0]?.lengthFormula).toBe(
      String(Math.round(Math.hypot(5760, 1000)) / 1000),
    );
    // そのとなりの大梁は両端とも階高のまま
    expect(items[1]?.lengthFormula).toBe("5.76");
  });

  it("記号の無い区間は行を作らない・階高不明は勾配を入れない", () => {
    const sparse: FireproofDrawingFloor = {
      ...floor,
      girders: { "x:0,0": "G1", "x:1,0": "" },
      beams: [],
    };
    expect(beamImportItems(sparse, 4000)).toHaveLength(1);
    expect(beamImportItems(sparse, null)[0]?.lengthFormula).toBe("5.76");
  });
});

describe("「無し」チェック（柱・大梁）", () => {
  const cross: FireproofDrawingFloor = {
    ...emptyFloor(),
    xSpans: [6000, 6000],
    ySpans: [5000, 5000],
    columns: {
      "0,0": "C1", "1,0": "C1", "2,0": "C1",
      "0,1": "C1", "1,1": "C1", "2,1": "C1",
      "0,2": "C1", "1,2": "C1", "2,2": "C1",
    },
    noColumns: { "1,1": true },
    girders: {
      "x:0,1": "G1",
      "x:1,1": "G1",
      "y:1,0": "G2",
      "y:1,1": "G2",
    },
  };

  it("「無し」の柱は描かず・取り込まない", () => {
    const items = columnImportItems(cross, 4000);
    // 9交点のうち中央(1,1)は「無し」→8本
    expect(items).toHaveLength(8);
    expect(items.some((item) => item.comment === "2-B")).toBe(false);
  });

  it("「無し」の交点をまたぐ同じ記号の大梁は1部材につなぐ（端は両端の柱の面）", () => {
    const items = beamImportItems(cross, 4000);
    // X方向の大梁は十字で負けたので…先に入れたX方向が優先かは入力順
    // girdersの先頭はx区間 → X優先：Xは 1〜3 まるごと1本、Yは切れて2本
    const xs = items.filter((item) => item.symbol === "G1");
    const ys = items.filter((item) => item.symbol === "G2");
    expect(xs).toHaveLength(1);
    expect(xs[0]?.comment).toBe("B-1〜3");
    expect(ys).toHaveLength(2);
  });

  it("十字のとき先に入力した向きが優先（負けた側はその大梁の面まで）", () => {
    // Yのキーを先に書いた並び → Y優先
    const yFirst: FireproofDrawingFloor = {
      ...cross,
      girders: {
        "y:1,0": "G2",
        "y:1,1": "G2",
        "x:0,1": "G1",
        "x:1,1": "G1",
      },
    };
    const items = beamImportItems(yFirst, 4000);
    const xs = items.filter((item) => item.symbol === "G1");
    const ys = items.filter((item) => item.symbol === "G2");
    // Yが通し：1本。Xは交点で切れて2本、それぞれ中央までは柱面からYの面まで
    expect(ys).toHaveLength(1);
    expect(xs).toHaveLength(2);
    // memberHalfOf を渡したときは負け側の端が優先側の面ぶん短くなる
    const withHalf = beamImportItems(yFirst, 4000, undefined, () => 250);
    const xs2 = withHalf.filter((item) => item.symbol === "G1");
    // 6000-120(柱面)-250(優先G2の面) = 5630
    expect(xs2.map((item) => item.lengthFormula)).toEqual(["5.63", "5.63"]);
  });

  it("「無し」の大梁区間は部材ではない（図・取り込み・取合の未入力から外れる）", () => {
    const floor: FireproofDrawingFloor = {
      ...cross,
      noGirders: { "x:0,1": true },
    };
    const items = beamImportItems(floor, 4000);
    expect(items.some((item) => item.comment === "B-1〜2")).toBe(false);
    expect(missingJointKeys(floor).some((key) => key === "g:x:0,1")).toBe(
      false,
    );
  });

  it("「無し」の柱をまたぐ通しの大梁は、どれか1区間に取合があれば未入力にならない", () => {
    const floor: FireproofDrawingFloor = {
      ...cross,
      jointSymbols: { "g:x:0,1": "3", "c:0,0": "3" },
      girders: { "x:0,1": "G1", "x:1,1": "G1" }, // Y側を消して十字にならない形
    };
    expect(
      missingJointKeys(floor).filter((key) => key.startsWith("g:")),
    ).toEqual([]);
  });

  it("柱を入れていない交点（「無し」のチェックなし）も大梁はつなぐ", () => {
    // 中央(1,1)は記号も「無し」も無い＝柱が無い場所 → そこもつなぐ
    const floor: FireproofDrawingFloor = {
      ...cross,
      columns: { ...cross.columns, "1,1": "" },
      noColumns: {},
      girders: { "x:0,1": "G1", "x:1,1": "G1" },
    };
    const items = beamImportItems(floor, 4000).filter(
      (item) => item.symbol === "G1",
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.comment).toBe("B-1〜3");
  });
});

describe("斜梁（2交点どうしの大梁）", () => {
  const floor: FireproofDrawingFloor = {
    ...emptyFloor(),
    xSpans: [6000, 6000],
    ySpans: [6000],
    columns: {
      "0,0": "C1", "1,0": "C1", "2,0": "C1",
      "0,1": "C1", "1,1": "C1", "2,1": "C1",
    },
    diagGirders: [
      { fx: 1, fy: 0, tx: 2, ty: 1, symbol: "G1", id: "d1" },
    ],
    jointSymbols: { "d:d1": "4" },
  };

  it("保存に残る（parseDrawingの往復）", () => {
    const round = parseDrawing(serializeDrawing({ floors: { "1": floor } }));
    expect(round.floors["1"]?.diagGirders).toEqual([
      { fx: 1, fy: 0, tx: 2, ty: 1, symbol: "G1", id: "d1" },
    ]);
  });

  it("取り込みは斜めの真の長さ（両端の柱の面ぶん引く）で1行", () => {
    const items = beamImportItems(floor, 4000);
    const diag = items.find((item) => item.symbol === "G1");
    // (1,0)-(2,1)：plan = hypot(6000,6000)。柱の面は hw*|ux|+hd*|uy| = 120*(√2/2)*2 ≈ 169.7 → 両端で約339.4
    const expectMm = Math.hypot(6000, 6000) - 2 * (120 * Math.SQRT1_2 + 120 * Math.SQRT1_2);
    expect(diag?.comment).toBe("2-B〜3-A");
    expect(diag?.mark).toBe("4");
    expect(diag?.lengthFormula).toBe(String(Math.round(expectMm) / 1000));
  });

  it("記号が無い斜梁は行を作らない・取合の未入力にも入らない", () => {
    const empty: FireproofDrawingFloor = {
      ...floor,
      diagGirders: [{ fx: 0, fy: 0, tx: 2, ty: 1, symbol: "" }],
      jointSymbols: {},
    };
    expect(beamImportItems(empty, 4000)).toHaveLength(0);
    expect(missingJointKeys(empty).some((k) => k.startsWith("d:"))).toBe(false);
    expect(
      missingJointKeys(floor).some((k) => k.startsWith("d:")),
    ).toBe(false);
    const unmarked: FireproofDrawingFloor = { ...floor, jointSymbols: {} };
    expect(missingJointKeys(unmarked)).toContain("d:d1");
  });

  it("寄せ（offset）は保存に残る", () => {
    const withOff: FireproofDrawingFloor = {
      ...floor,
      diagGirders: [
        { fx: 1, fy: 0, tx: 2, ty: 1, symbol: "G1", id: "d1", offset: 120 },
      ],
    };
    const round = parseDrawing(
      serializeDrawing({ floors: { "1": withOff } }),
    );
    expect(round.floors["1"]?.diagGirders).toEqual([
      { fx: 1, fy: 0, tx: 2, ty: 1, symbol: "G1", id: "d1", offset: 120 },
    ]);
  });

  it("斜めの線で囲まれた区画も選べて、置く小梁は斜め線で切られる", () => {
    // 三角形の区画：左の縦大梁 (0,0)-(0,1)、下の横大梁 (0,1)-(2,1)、斜め (0,0)-(2,1)
    const tri: FireproofDrawingFloor = {
      ...emptyFloor(),
      xSpans: [6000, 6000],
      ySpans: [6000],
      columns: {},
      girders: { "y:0,0": "G1", "x:0,1": "G1", "x:1,1": "G1" },
      diagGirders: [{ fx: 0, fy: 0, tx: 2, ty: 1, symbol: "G1", id: "d1" }],
    };
    // 三角形の内側（斜め線の下）をクリック
    const region = enclosingRegion(tri, 3000, 4500);
    expect(region).not.toBeNull();
    expect(region?.diagEdges?.map((e) => e.side).sort()).toEqual([
      "right",
      "top",
    ]);
    expect(region?.y).toBe(1500); // 斜め線が上の境界（x=3000 で y=1500）
    expect(region?.x + region!.width).toBe(9000); // 右の境界は y=4500 で x=9000
    // 縦に4分割 → 右のほうの小梁は上端が斜め線ではみ出るので切られる
    const beams = dividedBeams(region!, "v", 4, "B40");
    expect(beams).toHaveLength(3);
    const sin = 12000 / Math.hypot(12000, 6000); // 縦梁と斜め線のなす角
    const inset = 75 / sin;
    // x=2250 の梁：斜め線の下に全部入るので切られない（上端は区画の上端）
    expect(beams[0]?.x1).toBe(2250);
    expect(beams[0]?.y1).toBe(1500);
    // x=6750 の梁：斜め線（その x では y=3375）より上は外 → 上端を交点+内内ぶんへ
    expect(beams[2]?.x1).toBe(6750);
    expect(beams[2]?.y1).toBeCloseTo(3375 + inset, 1);
    expect(beams[2]?.y2).toBe(region!.y + region!.height - 75);
  });

  it("区画の角だけ切る斜め梁でも、置く小梁はその線よりはみ出ない", () => {
    // 正方形の区画。右上の角だけを斜めに切る引き梁（クリック点の縦横軸とは交わらない）
    const f: FireproofDrawingFloor = {
      ...emptyFloor(),
      xSpans: [6000],
      ySpans: [6000],
      columns: {},
      girders: {
        "x:0,0": "G1",
        "x:0,1": "G1",
        "y:0,0": "G1",
        "y:1,0": "G1",
      },
      diagGirders: [
        {
          fx: 0,
          fy: 0,
          tx: 1,
          ty: 0,
          symbol: "G1",
          id: "d1",
          fromMm: { x: 4000, y: 0 },
          toMm: { x: 6000, y: 2000 },
        },
      ],
    };
    // 左下寄りをクリック（斜め線はクリックの縦横を通らないが、右上の角を切っている）
    const region = enclosingRegion(f, 3000, 4500);
    expect(region).not.toBeNull();
    expect(region?.diagEdges?.map((e) => e.side)).toEqual(["diag"]);
    // 縦に5分割 → いちばん右の小梁は斜め線の外（角側）にはみ出るので上端を切られる
    const beams = dividedBeams(region!, "v", 5, "B40");
    expect(beams).toHaveLength(4);
    const sin = 2000 / Math.hypot(2000, 2000); // 縦梁と斜め線（45度）のなす角
    const inset = 75 / sin;
    expect(beams[3]?.x1).toBe(4800);
    expect(beams[3]?.y1).toBeCloseTo(800 + inset, 1); // x=4800 で斜め線は y=800
    expect(beams[3]?.y2).toBe(6000 - 75);
    // すでに置いてある小梁も refitBeams で同じく切られる（ここでは半幅150で計算）
    const laid: FireproofDrawingFloor = {
      ...f,
      beams: [{ x1: 4800, y1: 75, x2: 4800, y2: 5925, symbol: "B40" }],
    };
    const refit = refitBeams(laid, () => 150);
    expect(refit[0]?.y1).toBeCloseTo(800 + 150 / sin, 1);
    expect(refit[0]?.y2).toBe(6000 - 150);
  });

  it("縦・横に引いた線は普通の境界線として区画を囲む", () => {
    // 横の引き梁 (0,0)-(2,0) と縦の引き梁 (0,0)-(0,1)＋通常の大梁で区画
    const f: FireproofDrawingFloor = {
      ...emptyFloor(),
      xSpans: [6000, 6000],
      ySpans: [6000],
      columns: {},
      girders: { "x:0,1": "G1", "x:1,1": "G1", "y:2,0": "G1" },
      diagGirders: [
        { fx: 0, fy: 0, tx: 2, ty: 0, symbol: "G1", id: "d1" },
        { fx: 0, fy: 0, tx: 0, ty: 1, symbol: "G1", id: "d2" },
      ],
    };
    const region = enclosingRegion(f, 3000, 3000);
    expect(region).toEqual({
      x: 0,
      y: 0,
      width: 12000,
      height: 6000,
      insetLeft: 75,
      insetRight: 75,
      insetTop: 75,
      insetBottom: 75,
      pinX: 3000,
      pinY: 3000,
    });
  });
});

describe("missingJointKeys", () => {
  it("記号の入った柱・大梁・小梁で記号未入力のものだけのキーを返す", () => {
    const floor: FireproofDrawingFloor = {
      ...emptyFloor(),
      xSpans: [6000, 6000],
      ySpans: [6000],
      columns: { "0,0": "C1", "1,0": "C2", "2,0": "" },
      girders: { "x:0,0": "G1", "x:1,0": "" },
      beams: [
        { x1: 0, y1: 0, x2: 0, y2: 100, symbol: "B1", id: "b1" },
        { x1: 0, y1: 0, x2: 100, y2: 0, symbol: "B2" },
      ],
      jointSymbols: { "c:0,0": "3", "b:b1": "2" },
    };
    expect(missingJointKeys(floor)).toEqual([
      "c:1,0",
      "g:x:0,0",
      "b:#1",
    ]);
  });

  it("全部入っていれば空・jointSymbols自体が無くても動く", () => {
    const floor: FireproofDrawingFloor = {
      ...emptyFloor(),
      columns: { "0,0": "C1" },
      jointSymbols: { "c:0,0": "3" },
    };
    expect(missingJointKeys(floor)).toEqual([]);
    const bare: FireproofDrawingFloor = {
      ...emptyFloor(),
      columns: { "0,0": "C1" },
    };
    expect(missingJointKeys(bare)).toEqual(["c:0,0"]);
  });
});

describe("斜め梁で小梁を切る（延長線上は切らない）", () => {
  const region = (
    diagEdges: { x1: number; y1: number; x2: number; y2: number; half: number; side: "diag" }[],
    pinX: number,
    pinY: number,
  ) => ({ x: 0, y: 0, width: 6000, height: 6000, diagEdges, pinX, pinY });

  it("斜め梁が実際に通っている部分と交わる梁は切る", () => {
    // 斜め梁は (0,6000)→(6000,0) の対角線。pinは右下側（区画内）
    const edge = { x1: 0, y1: 6000, x2: 6000, y2: 0, half: 75, side: "diag" as const };
    // 対角線と交わる縦梁 x=3000, y=0〜6000：交点は (3000,3000)（線分上）
    const out = clipBeamAtDiagEdges(
      { x1: 3000, y1: 0, x2: 3000, y2: 6000, symbol: "B1" },
      region([edge], 4500, 4500),
    );
    // pin側（右下＝直交距離が負になる側）だけ残る → 上側端が交点まで下がる
    expect(out).not.toBeNull();
    expect(out!.y2).toBe(6000);
    expect(out!.y1).toBeGreaterThan(0);
    expect(out!.y1).toBeLessThan(4000);
  });

  it("延長線上でしか交わらない梁は切らない（関係ない梁を切らない）", () => {
    // 斜め梁は (0,6000)→(3000,3000) で途中で終わっている。延長すると (6000,0) 方向
    const edge = { x1: 0, y1: 6000, x2: 3000, y2: 3000, half: 75, side: "diag" as const };
    // x=5000 の縦梁：延長線とは (5000,1000) で交わるが、線分上ではない → 切らない
    const out = clipBeamAtDiagEdges(
      { x1: 5000, y1: 0, x2: 5000, y2: 6000, symbol: "B1" },
      region([edge], 4500, 4500),
    );
    expect(out).not.toBeNull();
    expect(out!.x1).toBe(5000);
    expect(out!.y1).toBe(0);
    expect(out!.x2).toBe(5000);
    expect(out!.y2).toBe(6000);
  });
});

describe("梁をつなぐ", () => {
  const floor: FireproofDrawingFloor = {
    ...emptyFloor(),
    xSpans: [6000, 6000],
    ySpans: [6000, 6000],
  };

  it("端が近いが付いていない端に印が出る", () => {
    const f: FireproofDrawingFloor = {
      ...floor,
      diagGirders: [
        { fx: 1, fy: 0, tx: 0, ty: 0, symbol: "G1", toMm: { x: 1600, y: 250 } },
        { fx: 0, fy: 0, tx: 0, ty: 1, symbol: "G1", fromMm: { x: 1500, y: 0 } },
      ],
    };
    const pts = unconnectedDiagEnds(f);
    expect(pts).toContainEqual({ x: 1600, y: 250 });
    expect(pts).toContainEqual({ x: 1500, y: 0 });
  });

  it("端が重なっていれば印は出ない", () => {
    const f: FireproofDrawingFloor = {
      ...floor,
      diagGirders: [
        { fx: 1, fy: 0, tx: 0, ty: 0, symbol: "G1", toMm: { x: 1500, y: 0 } },
        { fx: 0, fy: 0, tx: 0, ty: 1, symbol: "G1", fromMm: { x: 1500, y: 0 } },
      ],
    };
    expect(unconnectedDiagEnds(f)).toEqual([]);
  });

  it("2本が交わる点でつながる（優先側は延びる・もう一本は端が合う）", () => {
    const f: FireproofDrawingFloor = {
      ...floor,
      diagGirders: [
        // 横方向 (7300→1600, 0→250)。交点は縦線 x=1500 上の (1500,254) 付近＝端の少し先
        { fx: 1, fy: 0, tx: 0, ty: 0, symbol: "G1", id: "a", fromMm: { x: 7300, y: 0 }, toMm: { x: 1600, y: 250 } },
        // 縦方向 x=1500, y=0〜3997
        { fx: 0, fy: 0, tx: 0, ty: 1, symbol: "G1", id: "b", fromMm: { x: 1500, y: 0 }, toMm: { x: 1500, y: 3997 } },
      ],
    };
    const out = joinDiagGirders(f, 0, 1);
    expect("error" in out).toBe(false);
    if (!("error" in out)) {
      const a = out.diagGirders[0];
      const b = out.diagGirders[1];
      // 優先の梁は端の延長先（(1500, 約254)）
      expect(a.toMm).not.toBeUndefined();
      expect(Math.abs(a.toMm!.x - 1500)).toBeLessThan(2);
      // もう一本は近いほうの端（上端）が交点へ
      expect(b.fromMm).not.toBeUndefined();
      expect(b.fromMm).toEqual(a.toMm);
      // 遠いほうの端は動かない
      expect(b.toMm).toEqual({ x: 1500, y: 3997 });
      expect(a.fromMm).toEqual({ x: 7300, y: 0 });
    }
  });

  it("平行な2本はつなげない", () => {
    const f: FireproofDrawingFloor = {
      ...floor,
      diagGirders: [
        { fx: 0, fy: 0, tx: 1, ty: 0, symbol: "G1" },
        { fx: 0, fy: 1, tx: 1, ty: 1, symbol: "G1" },
      ],
    };
    const out = joinDiagGirders(f, 0, 1);
    expect(out).toEqual({ error: "parallel" });
  });
});
