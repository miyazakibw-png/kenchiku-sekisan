import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIT_GAP,
  beamLength,
  beamLines,
  layoutPits,
  normalizeRects,
  pitCornerCount,
  pitPolygon,
  pitQuantities,
  pitSymbolForPart,
  pitSymbol,
  pitVariables,
  type PitBeam,
  type PitShape,
} from "../../src/core/pit/pit";

function pit(id: string, values: Partial<PitShape> = {}): PitShape {
  return {
    id,
    symbol: values.symbol ?? id,
    x: values.x ?? 4,
    y: values.y ?? 2,
    depth: values.depth ?? 1,
    direction: values.direction ?? "right",
    gap: values.gap ?? DEFAULT_PIT_GAP,
  };
}

describe("ピットの並べ方", () => {
  it("1個目は基準、2個目からは向きとすき間で置く", () => {
    const rects = layoutPits([
      pit("a", { x: 4, y: 4 }),
      pit("b", { x: 4, y: 2, direction: "right" }),
      pit("c", { x: 4, y: 6, direction: "up" }),
    ]);
    expect(rects[0]).toMatchObject({ left: 0, top: 0 });
    expect(rects[1]).toMatchObject({ left: 4.5, top: 0 });
    expect(rects[2]).toMatchObject({ left: 4.5, top: -6.5 });
  });

  it("左上を0にそろえて図全体の大きさを出す", () => {
    const placed = normalizeRects(
      layoutPits([pit("a", { x: 4, y: 4 }), pit("b", { direction: "left" })]),
    );
    expect(placed.rects[1]).toMatchObject({ left: 0, top: 0 });
    expect(placed.rects[0]).toMatchObject({ left: 4.5, top: 0 });
    expect(placed.width).toBeCloseTo(8.5);
    expect(placed.height).toBeCloseTo(4);
  });

  it("記号はＰ1から順に付く", () => {
    expect(pitSymbol(0)).toBe("Ｐ1");
    expect(pitSymbol(2)).toBe("Ｐ3");
  });
});

describe("ピットの数量", () => {
  const shapes = [pit("a", { symbol: "Ｐ1", x: 4, y: 2, depth: 1.5 })];
  const beams: PitBeam[] = [
    { id: "g1", pitId: "a", axis: "X", width: 0.3, height: 0.6, position: 0.5 },
  ];

  it("床面積・壁面長さ・壁面積は自動、深さは手入力", () => {
    const [quantity] = pitQuantities(shapes, []);
    expect(quantity.floorArea).toBeCloseTo(8);
    expect(quantity.wallLength).toBeCloseTo(12);
    expect(quantity.depth).toBeCloseTo(1.5);
    expect(quantity.wallArea).toBeCloseTo(18);
    expect(quantity.ceilingArea).toBeCloseTo(8);
  });

  it("梁底面積は天井から引き、梁面積は梁成込みの表面", () => {
    const [quantity] = pitQuantities(shapes, beams);
    expect(quantity.beamBottomArea).toBeCloseTo(1.2);
    expect(quantity.beamArea).toBeCloseTo(6);
    expect(quantity.ceilingArea).toBeCloseTo(6.8);
  });

  it("梁の長さは当たる壁までで自動", () => {
    const rects = normalizeRects(layoutPits(shapes)).rects;
    const [line] = beamLines(shapes, rects, beams);
    expect(line.length).toBeCloseTo(4);
    expect(line.top).toBeCloseTo(1);
  });

  it("計算式にはFA・WA・GA・CAとピットごとの記号が使える", () => {
    const values = pitVariables(pitQuantities(shapes, beams));
    expect(values.FA).toBeCloseTo(8);
    expect(values.WA).toBeCloseTo(18);
    expect(values.GA).toBeCloseTo(6);
    expect(values.CA).toBeCloseTo(6.8);
    expect(values.FA1).toBeCloseTo(8);
    expect(values.DP1).toBeCloseTo(1.5);
  });
});

describe("そろえ方", () => {
  const base = {
    depth: 1,
    direction: "right" as const,
    gap: DEFAULT_PIT_GAP,
  };

  it("右に置くとき下そろえ・中央そろえで上下位置が変わる", () => {
    const rects = layoutPits([
      { id: "a", symbol: "Ｐ1", x: 4, y: 6, ...base },
      { id: "b", symbol: "Ｐ2", x: 2, y: 2, ...base, align: "end" },
    ]);
    expect(rects[1].top).toBe(4);
    expect(rects[1].left).toBe(4.5);

    const centered = layoutPits([
      { id: "a", symbol: "Ｐ1", x: 4, y: 6, ...base },
      { id: "b", symbol: "Ｐ2", x: 2, y: 2, ...base, align: "center" },
    ]);
    expect(centered[1].top).toBe(2);
  });

  it("上に置くとき右そろえで左右位置が変わる", () => {
    const rects = layoutPits([
      { id: "a", symbol: "Ｐ1", x: 6, y: 2, ...base },
      { id: "b", symbol: "Ｐ2", x: 2, y: 2, ...base, direction: "up", align: "end" },
    ]);
    expect(rects[1].left).toBe(4);
    expect(rects[1].top).toBe(-2.5);
  });
});

describe("基準のピット", () => {
  it("すぐ前でないピットを基準に置ける", () => {
    const base = { depth: 1, gap: DEFAULT_PIT_GAP, direction: "right" as const };
    const rects = layoutPits([
      { id: "a", symbol: "Ｐ1", x: 4, y: 4, ...base },
      { id: "b", symbol: "Ｐ2", x: 2, y: 2, ...base },
      { id: "c", symbol: "Ｐ3", x: 2, y: 2, ...base, direction: "down", baseId: "a" },
    ]);
    expect(rects[2].left).toBe(0);
    expect(rects[2].top).toBe(4.5);
  });
});

describe("梁Hの高い方が優先", () => {
  const pit: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 4,
    y: 4,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };
  const big: PitBeam = {
    id: "big",
    pitId: "a",
    axis: "Y",
    width: 0.4,
    height: 0.8,
    position: 0.5,
  };
  const small: PitBeam = {
    id: "small",
    pitId: "a",
    axis: "X",
    width: 0.3,
    height: 0.5,
    position: 0.5,
  };

  it("低い梁は高い梁の分を抜いた本数に分かれる", () => {
    expect(beamLength(pit, small, [big, small])).toBeCloseTo(3.6, 6);
    expect(beamLength(pit, big, [big, small])).toBeCloseTo(4, 6);
  });

  it("止まった分は梁底面積・梁面積にも効く", () => {
    const [quantity] = pitQuantities([pit], [big, small]);
    expect(quantity.beamBottomArea).toBeCloseTo(0.4 * 4 + 0.3 * 3.6, 6);
  });

  it("図の梁は高い梁のところで分かれる", () => {
    const rects = normalizeRects(layoutPits([pit])).rects;
    const lines = beamLines([pit], rects, [big, small]);
    const line = lines.find((each) => each.id === "small");
    expect(line?.segments).toEqual([
      { index: 0, from: 0, to: 1.8 },
      { index: 1, from: 2.2, to: 4 },
    ]);
  });

  it("消した本は長さにも図にも出ない", () => {
    const cut = { ...small, removed: [1] };
    expect(beamLength(pit, cut, [big, cut])).toBeCloseTo(1.8, 6);
  });
});

describe("角を斜めにする", () => {
  const base = {
    depth: 1,
    gap: DEFAULT_PIT_GAP,
    direction: "right" as const,
  };

  it("角を切らないうちは4角", () => {
    const pit: PitShape = { id: "a", symbol: "Ｐ1", x: 4, y: 2, ...base };
    expect(pitCornerCount([pit])).toBe(4);
    expect(pitQuantities([pit], [])[0].floorArea).toBeCloseTo(8, 6);
  });

  it("1か所斜めにすると5角になり床面積が減る", () => {
    const pit: PitShape = {
      id: "a",
      symbol: "Ｐ1",
      x: 4,
      y: 2,
      corners: ["tr"],
      cutX: 1,
      cutY: 1,
      ...base,
    };
    expect(pitCornerCount([pit])).toBe(5);
    expect(pitQuantities([pit], [])[0].floorArea).toBeCloseTo(7.5, 6);
  });

  it("斜めをY一杯にすると台形（4角）になる", () => {
    const pit: PitShape = {
      id: "a",
      symbol: "Ｐ1",
      x: 4,
      y: 2,
      corners: ["tr"],
      cutX: 1,
      cutY: 2,
      ...base,
    };
    expect(pitCornerCount([pit])).toBe(4);
    expect(pitQuantities([pit], [])[0].floorArea).toBeCloseTo(7, 6);
  });

  it("隣り合う2か所を斜めにできる", () => {
    const pit: PitShape = {
      id: "a",
      symbol: "Ｐ1",
      x: 4,
      y: 2,
      corners: ["tr", "br"],
      cutX: 1,
      cutY: 1,
      ...base,
    };
    expect(pitPolygon(pit)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 1 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(pitQuantities([pit], [])[0].floorArea).toBeCloseTo(7, 6);
  });

  it("X・Yは最大寸法のまま（壁面長さに斜め分が入る）", () => {
    const pit: PitShape = {
      id: "a",
      symbol: "Ｐ1",
      x: 4,
      y: 2,
      corners: ["tr"],
      cutX: 1,
      cutY: 1,
      ...base,
    };
    const [quantity] = pitQuantities([pit], []);
    expect(quantity.wallLength).toBeCloseTo(3 + Math.hypot(1, 1) + 1 + 4 + 2, 6);
  });
});

describe("部位に合わせた記号", () => {
  it("床はFA・壁はWA・梁型はGA・天井はCA", () => {
    expect(pitSymbolForPart(0, "床")).toBe("FA1");
    expect(pitSymbolForPart(1, "壁")).toBe("WA2");
    expect(pitSymbolForPart(2, "梁型")).toBe("GA3");
    expect(pitSymbolForPart(3, "天井")).toBe("CA4");
  });
});
