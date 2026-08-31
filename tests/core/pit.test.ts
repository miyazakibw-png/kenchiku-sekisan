import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIT_GAP,
  beamLines,
  layoutPits,
  normalizeRects,
  pitQuantities,
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
