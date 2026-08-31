import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIT_GAP,
  addPitCorner,
  alignPitCorners,
  setPitCorner,
  pitNotch,
  polygonArea,
  setPitKind,
  movePitCorner,
  movePitCorners,
  rectanglePit,
  removePitCorner,
  beamLength,
  beamLines,
  layoutPits,
  normalizeRects,
  pitCornerCount,
  pitPolygon,
  pitQuantities,
  pitPartVariables,
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

describe("Ｐ記号は部位で中身が変わる", () => {
  const pit: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 4,
    y: 2,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };
  const quantities = pitQuantities([pit], []);

  it("床は床面積・壁は壁面積・梁型は梁面積・天井は天井面積", () => {
    expect(pitPartVariables(quantities, "床").P1).toBeCloseTo(8, 6);
    expect(pitPartVariables(quantities, "壁").P1).toBeCloseTo(12, 6);
    expect(pitPartVariables(quantities, "梁型").P1).toBeCloseTo(0, 6);
    expect(pitPartVariables(quantities, "天井").P1).toBeCloseTo(8, 6);
  });

  it("部位が空のときは床面積", () => {
    expect(pitPartVariables(quantities, "").P1).toBeCloseTo(8, 6);
  });
});

describe("角を動かして形を作る", () => {
  const base: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 4,
    y: 2,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };

  it("右上の角を左へ動かすと台形になる（X・Yは最大寸法のまま）", () => {
    const pit = movePitCorner(base, 1, -1, 0);
    expect(pitPolygon(pit)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(pit.x).toBe(4);
    expect(pit.y).toBe(2);
    expect(pitQuantities([pit], [])[0].floorArea).toBeCloseTo(7, 6);
  });

  it("辺の近くをクリックすると角が増え、動かすとＬ型になる", () => {
    const added = addPitCorner(base, { x: 2, y: 0 });
    expect(pitPolygon(added).length).toBe(5);
    const shaped = movePitCorner(added, 1, 0, 1);
    expect(pitCornerCount([shaped])).toBe(5);
    expect(pitQuantities([shaped], [])[0].floorArea).toBeCloseTo(6, 6);
  });

  it("角は3つより減らさない・四角に戻せる", () => {
    const pit = movePitCorner(base, 1, -1, 0);
    const three = removePitCorner(pit, 0);
    expect(pitPolygon(three).length).toBe(3);
    expect(pitPolygon(removePitCorner(three, 0)).length).toBe(3);
    expect(pitPolygon(rectanglePit(pit)).length).toBe(4);
    expect(pitQuantities([rectanglePit(pit)], [])[0].floorArea).toBeCloseTo(8, 6);
  });

  it("置き方が自由のときは基準ピットからの位置で置く", () => {
    const second: PitShape = {
      ...base,
      id: "b",
      symbol: "Ｐ2",
      x: 1,
      y: 1,
      direction: "free",
      offsetX: 2,
      offsetY: 0.5,
      baseId: "a",
    };
    const rects = layoutPits([base, second]);
    expect(rects[1].left).toBe(2);
    expect(rects[1].top).toBe(0.5);
  });
});

describe("角をまとめて動かす", () => {
  const base: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 4,
    y: 2,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };

  it("上の2つの角を下へ1m動かすと外形Yが1mになる", () => {
    const pit = movePitCorners(base, [0, 1], 0, 1);
    expect(pitPolygon(pit)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(pit.y).toBe(1);
    expect(pitQuantities([pit], [])[0].floorArea).toBeCloseTo(4, 6);
  });

  it("右上と右下を左へ動かすと幅が縮む（台形にならない）", () => {
    const pit = movePitCorners(base, [1, 2], -1, 0);
    expect(pit.x).toBe(3);
    expect(pitQuantities([pit], [])[0].floorArea).toBeCloseTo(6, 6);
  });

  it("無い角番号は動かさない", () => {
    expect(movePitCorners(base, [9], 0, 1)).toBe(base);
  });
});

describe("角を動かしても動かしていない角は動かない", () => {
  const base: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 4,
    y: 2,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };

  it("上の2つの角を下へ1m動かすと、図では下の辺の位置が変わらない", () => {
    const pit = movePitCorners(base, [0, 1], 0, 1);
    const rect = layoutPits([pit])[0];
    expect(rect.top).toBeCloseTo(1, 6);
    expect(rect.top + rect.y).toBeCloseTo(2, 6);
  });

  it("次のピットのすき間は動かした外枠から測る", () => {
    const first = movePitCorners(base, [1, 2], -1, 0);
    const second: PitShape = {
      ...base,
      id: "b",
      symbol: "Ｐ2",
      x: 2,
      baseId: "a",
    };
    const rects = layoutPits([first, second]);
    expect(rects[1].left).toBeCloseTo(3 + DEFAULT_PIT_GAP, 6);
  });

  it("四角に戻すとずれも消える", () => {
    const pit = rectanglePit(movePitCorners(base, [0, 1], 0, 1));
    const rect = layoutPits([pit])[0];
    expect(rect.top).toBe(0);
  });
});

describe("角の位置を数字で決める・そろえる", () => {
  const base: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 4,
    y: 2,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };

  it("足した角の位置を数字で決められる", () => {
    const added = addPitCorner(base, { x: 2.3, y: 0 });
    const fixed = setPitCorner(added, 1, { x: 2, y: 0 });
    expect(pitPolygon(fixed)[1]).toEqual({ x: 2, y: 0 });
  });

  it("選んだ角をたて（x）にそろえられる", () => {
    const added = addPitCorner(base, { x: 2.3, y: 0 });
    const shaped = movePitCorners(added, [1], 0, 1);
    const aligned = alignPitCorners(shaped, [1, 2], "x", 3);
    const points = pitPolygon(aligned);
    expect(points[1].x).toBeCloseTo(3, 6);
    expect(points[2].x).toBeCloseTo(3, 6);
  });

  it("よこ（y）にそろえると同じ高さになる", () => {
    const added = addPitCorner(base, { x: 2, y: 0 });
    const shaped = movePitCorners(added, [1], 0, 1);
    const aligned = alignPitCorners(shaped, [1, 2], "y", 1);
    const points = pitPolygon(aligned);
    expect(points[1].y).toBeCloseTo(1, 6);
    expect(points[2].y).toBeCloseTo(1, 6);
  });
});

describe("形を選んで寸法で作る（Ｌ型・コ型）", () => {
  const base: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 6,
    y: 4,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };

  it("Ｌ型は右下を欠いた6角になる", () => {
    const shaped = { ...setPitKind(base, "L"), cutW: 2, cutD: 1 };
    const points = pitPolygon(shaped);
    expect(points).toHaveLength(6);
    expect(polygonArea(points)).toBeCloseTo(6 * 4 - 2 * 1, 6);
  });

  it("Ｌ型の欠く角を左上に変えられる", () => {
    const shaped = {
      ...setPitKind(base, "L"),
      cutW: 2,
      cutD: 1,
      cutCorner: "tl" as const,
    };
    expect(pitPolygon(shaped)[0]).toEqual({ x: 2, y: 0 });
    expect(polygonArea(pitPolygon(shaped))).toBeCloseTo(22, 6);
  });

  it("コ型は下の辺の真ん中を欠いた8角になる", () => {
    const shaped = { ...setPitKind(base, "U"), cutW: 2, cutD: 1 };
    const points = pitPolygon(shaped);
    expect(points).toHaveLength(8);
    expect(polygonArea(points)).toBeCloseTo(22, 6);
    expect(points[4]).toEqual({ x: 4, y: 3 });
  });

  it("コ型の欠く辺と位置を決められる", () => {
    const shaped = {
      ...setPitKind(base, "U"),
      cutW: 1,
      cutD: 2,
      cutSide: "left" as const,
      cutAt: 1,
    };
    const points = pitPolygon(shaped);
    expect(points).toHaveLength(8);
    expect(polygonArea(points)).toBeCloseTo(6 * 4 - 1 * 2, 6);
  });

  it("四角に戻すと欠きも消える", () => {
    const shaped = { ...setPitKind(base, "L"), cutW: 2, cutD: 1 };
    const back = setPitKind(shaped, "rect");
    expect(pitPolygon(back)).toHaveLength(4);
    expect(back.cutW).toBeUndefined();
  });

  it("角を動かすと自由な形になる", () => {
    const shaped = { ...setPitKind(base, "L"), cutW: 2, cutD: 1 };
    const moved = movePitCorners(shaped, [0], 1, 0);
    expect(moved.kind).toBeUndefined();
    expect(moved.points).toHaveLength(6);
  });
});

describe("欠いた所に入る□", () => {
  const base: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 6,
    y: 4,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };

  it("Ｌ型（右下）は右下に□が入る", () => {
    const shaped = { ...setPitKind(base, "L"), cutW: 2, cutD: 1 };
    expect(pitNotch(shaped)).toEqual({ x: 2, y: 1, offsetX: 4, offsetY: 3 });
  });

  it("Ｌ型（左上）は左上に□が入る", () => {
    const shaped = {
      ...setPitKind(base, "L"),
      cutW: 2,
      cutD: 1,
      cutCorner: "tl" as const,
    };
    expect(pitNotch(shaped)).toEqual({ x: 2, y: 1, offsetX: 0, offsetY: 0 });
  });

  it("コ型（下の辺）は欠きの位置に□が入る", () => {
    const shaped = { ...setPitKind(base, "U"), cutW: 2, cutD: 1, cutAt: 1 };
    expect(pitNotch(shaped)).toEqual({ x: 2, y: 1, offsetX: 1, offsetY: 3 });
  });

  it("四角や自由な形では□を作らない", () => {
    expect(pitNotch(base)).toBeNull();
    const free = movePitCorners(base, [0], 1, 0);
    expect(pitNotch(free)).toBeNull();
  });
});

describe("欠いた所の□とすき間", () => {
  const base: PitShape = {
    id: "a",
    symbol: "Ｐ1",
    x: 6,
    y: 4,
    depth: 1,
    direction: "right",
    gap: DEFAULT_PIT_GAP,
  };

  it("Ｌ型は2方にすき間を空ける（外側の2辺はそろう）", () => {
    const shaped = { ...setPitKind(base, "L"), cutW: 2, cutD: 1 };
    expect(pitNotch(shaped, 0.2)).toEqual({
      x: 1.8,
      y: 0.8,
      offsetX: 4.2,
      offsetY: 3.2,
    });
  });

  it("コ型は3方にすき間を空ける（開いた側はそろう）", () => {
    const shaped = { ...setPitKind(base, "U"), cutW: 2, cutD: 1, cutAt: 1 };
    expect(pitNotch(shaped, 0.2)).toEqual({
      x: 1.6,
      y: 0.8,
      offsetX: 1.2,
      offsetY: 3.2,
    });
  });

  it("すき間が大きすぎても□がつぶれない", () => {
    const shaped = { ...setPitKind(base, "L"), cutW: 2, cutD: 1 };
    const notch = pitNotch(shaped, 9);
    expect(notch?.x).toBeGreaterThan(0);
    expect(notch?.y).toBeGreaterThan(0);
  });
});
