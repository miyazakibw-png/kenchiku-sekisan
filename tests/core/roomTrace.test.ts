import { describe, expect, it } from "vitest";
import {
  longestEdgePixels,
  metersPerPixel,
  pointsToShape,
  snapToAxis,
  toMeters,
  traceArea,
  parseTrace,
  parseUnderlay,
  parseTracedShapes,
  rectFromCorners,
  traceFromUnderlay,
  underlayForTrace,
  traceAfterUnderlay,
  EMPTY_TRACE,
  scaleUnderlay,
  EMPTY_UNDERLAY,
} from "../../src/core/room/trace";
import { solveShape } from "../../src/core/room/shape";

describe("図面をなぞる", () => {
  it("2点と実寸から縮尺を出す", () => {
    const perPixel = metersPerPixel({ x: 0, y: 0 }, { x: 100, y: 0 }, 3.64);
    expect(perPixel).toBeCloseTo(0.0364, 6);
    expect(metersPerPixel({ x: 0, y: 0 }, { x: 0, y: 0 }, 3.64)).toBe(0);
  });

  it("ほぼ水平・ほぼ垂直な点はそろえる", () => {
    expect(snapToAxis({ x: 0, y: 0 }, { x: 100, y: 3 })).toEqual({
      x: 100,
      y: 0,
    });
    expect(snapToAxis({ x: 0, y: 0 }, { x: 3, y: 100 })).toEqual({
      x: 0,
      y: 100,
    });
    expect(snapToAxis({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("なぞった四角を部屋形状にする", () => {
    const meters = toMeters(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ],
      0.04,
    );
    const shape = pointsToShape(meters);
    expect(shape.edges.map((row) => row.direction)).toEqual([
      "E",
      "S",
      "W",
      "N",
    ]);
    expect(shape.edges.map((row) => row.length)).toEqual([4, 2, 4, 2]);
    const solved = solveShape(shape);
    expect(solved.error).toBeNull();
    expect(traceArea(meters)).toBe(8);
  });

  it("斜めの辺は横移動・縦移動を持つ", () => {
    const shape = pointsToShape([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
      { x: 0, y: 3 },
    ]);
    const diagonal = shape.edges[1];
    expect(diagonal.direction).toBe("D");
    expect(diagonal.dx).toBe(-2);
    expect(diagonal.dy).toBe(3);
    expect(solveShape(shape).error).toBeNull();
  });

  it("一番長い辺の画素数から縮尺を出せる", () => {
    const points = [
      { x: 10, y: 10 },
      { x: 210, y: 10 },
      { x: 210, y: 110 },
      { x: 10, y: 110 },
    ];
    expect(longestEdgePixels(points)).toBe(200);
    expect(longestEdgePixels([{ x: 0, y: 0 }])).toBe(0);
    const perPixel = 7.28 / longestEdgePixels(points);
    const shape = pointsToShape(toMeters(points, perPixel));
    expect(shape.edges.map((row) => row.length)).toEqual([
      7.28, 3.64, 7.28, 3.64,
    ]);
    expect(solveShape(shape).points).toHaveLength(4);
  });

  it("壊れたJSONは空のなぞりにする", () => {
    expect(parseTrace("{")).toEqual({
      image: "",
      metersPerPixel: 0,
      scalePoints: [],
      scaleLength: 0,
      points: [],
    });
  });
});

describe("下敷きの図面（ピット計算書の traceJson に一緒に保存）", () => {
  it("underlay が無い・壊れている JSON は空の下敷きにする", () => {
    expect(parseUnderlay("")).toEqual(EMPTY_UNDERLAY);
    expect(parseUnderlay("{}")).toEqual(EMPTY_UNDERLAY);
    expect(parseUnderlay(JSON.stringify({ underlay: "x" }))).toEqual(
      EMPTY_UNDERLAY,
    );
  });

  it("trace と一緒に入っている underlay を読み、不正な値は初期値に戻す", () => {
    const json = JSON.stringify({
      image: "",
      metersPerPixel: 0,
      scalePoints: [],
      scaleLength: 0,
      points: [],
      underlay: {
        image: "data:image/png;base64,AAAA",
        metersPerPixel: 0.02,
        x: 1.5,
        y: "bad",
        opacity: 5,
      },
    });
    expect(parseUnderlay(json)).toEqual({
      image: "data:image/png;base64,AAAA",
      metersPerPixel: 0.02,
      x: 1.5,
      y: 0,
      opacity: 1,
    });
    // 部屋のなぞりの読み込みは underlay があっても影響を受けない
    expect(parseTrace(json).points).toEqual([]);
  });

  it("縮尺合わせは1点目を動かさずに画像を伸び縮みさせる", () => {
    const underlay = {
      ...EMPTY_UNDERLAY,
      image: "data:image/png;base64,AAAA",
      metersPerPixel: 0.01,
      x: 1,
      y: 2,
    };
    // 図の上で 2m に見えている長さが実は 4m → 2倍
    const scaled = scaleUnderlay(underlay, { x: 3, y: 2 }, { x: 5, y: 2 }, 4);
    expect(scaled).not.toBeNull();
    expect(scaled?.metersPerPixel).toBeCloseTo(0.02);
    // 1点目 (3,2) から見た画像の左上 (-2,0) が2倍になる → (3-4, 2+0)
    expect(scaled?.x).toBeCloseTo(-1);
    expect(scaled?.y).toBeCloseTo(2);
  });

  it("2点が同じ・実寸が0以下のときは合わせない", () => {
    const underlay = { ...EMPTY_UNDERLAY, metersPerPixel: 0.01 };
    expect(
      scaleUnderlay(underlay, { x: 1, y: 1 }, { x: 1, y: 1 }, 3),
    ).toBeNull();
    expect(
      scaleUnderlay(underlay, { x: 0, y: 0 }, { x: 1, y: 0 }, 0),
    ).toBeNull();
  });
});

describe("parseTracedShapes（なぞり済みの形）", () => {
  it("traceJson の traced を読み、壊れた点は捨てる", () => {
    const json = JSON.stringify({
      image: "",
      metersPerPixel: 0.01,
      scalePoints: [],
      scaleLength: 0,
      points: [],
      traced: [
        { id: "pit-1", points: [{ x: 1, y: 2 }, { x: "a", y: 3 }, null] },
        { id: 5, points: [] },
        "junk",
      ],
    });
    expect(parseTracedShapes(json)).toEqual([
      { id: "pit-1", points: [{ x: 1, y: 2 }] },
    ]);
  });

  it("traced が無い・JSONでない・空なら空配列", () => {
    expect(parseTracedShapes(JSON.stringify({ image: "" }))).toEqual([]);
    expect(parseTracedShapes("")).toEqual([]);
    expect(parseTracedShapes("{bad")).toEqual([]);
  });
});

describe("rectFromCorners（□なぞり：対角の2点から四角）", () => {
  it("どちらの向きに2点を取っても、左上から時計回りの4点になる", () => {
    const expected = [
      { x: 10, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 60 },
      { x: 10, y: 60 },
    ];
    expect(rectFromCorners({ x: 10, y: 20 }, { x: 50, y: 60 })).toEqual(expected);
    expect(rectFromCorners({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual(expected);
    expect(rectFromCorners({ x: 50, y: 20 }, { x: 10, y: 60 })).toEqual(expected);
  });

  it("同じ横位置・縦位置なら四角にならないので null", () => {
    expect(rectFromCorners({ x: 10, y: 20 }, { x: 10, y: 60 })).toBeNull();
    expect(rectFromCorners({ x: 10, y: 20 }, { x: 50, y: 20 })).toBeNull();
  });

  it("四角の4点は部屋形状（E/S/W/N）にもピットの形にもそのまま使える", () => {
    const rect = rectFromCorners({ x: 0, y: 0 }, { x: 400, y: 300 });
    expect(rect).not.toBeNull();
    const meters = toMeters(rect ?? [], 0.01);
    expect(traceArea(meters)).toBeCloseTo(12);
    expect(pointsToShape(meters).edges.map((edge) => edge.direction)).toEqual([
      "E",
      "S",
      "W",
      "N",
    ]);
  });
});

describe("traceFromUnderlay（図形欄に貼った図面をなぞり画面でそのまま使う）", () => {
  const underlay = {
    image: "data:image/png;base64,AAA",
    metersPerPixel: 0.01,
    x: 1,
    y: 2,
    opacity: 0.5,
  };

  it("なぞり用の図面が無ければ下敷きの図面を使い、縮尺合わせ済みならその縮尺も引き継ぐ", () => {
    const got = traceFromUnderlay(EMPTY_TRACE, { ...underlay, scaled: true });
    expect(got.image).toBe(underlay.image);
    expect(got.metersPerPixel).toBe(0.01);
    expect(got.points).toEqual([]);
  });

  it("貼っただけ（縮尺合わせ前）の下敷きは図面だけ引き継ぎ、縮尺は未設定にする", () => {
    const got = traceFromUnderlay(EMPTY_TRACE, underlay);
    expect(got.image).toBe(underlay.image);
    expect(got.metersPerPixel).toBe(0);
  });

  it("なぞり用の図面がすでにあればそのまま。下敷きも無ければ何もしない", () => {
    const own = { ...EMPTY_TRACE, image: "data:mine", metersPerPixel: 0.02 };
    expect(traceFromUnderlay(own, { ...underlay, scaled: true })).toBe(own);
    expect(traceFromUnderlay(EMPTY_TRACE, EMPTY_UNDERLAY)).toBe(EMPTY_TRACE);
  });

  it("縮尺合わせ（scaleUnderlay）をすると済みの印が付き、保存→読込でも残る", () => {
    const scaled = scaleUnderlay(underlay, { x: 0, y: 0 }, { x: 1, y: 0 }, 2);
    expect(scaled?.scaled).toBe(true);
    expect(parseUnderlay(JSON.stringify({ underlay: scaled })).scaled).toBe(true);
    expect(parseUnderlay(JSON.stringify({ underlay })).scaled).toBeUndefined();
  });
});

describe("underlayForTrace（下敷きをなぞりに使った図面・縮尺にそろえる）", () => {
  const trace = { ...EMPTY_TRACE, image: "data:plan", metersPerPixel: 0.02 };

  it("古い縮尺のままの下敷きは、なぞりの図面・縮尺・左上0にそろえて濃さは残す", () => {
    const got = underlayForTrace(trace, {
      image: "data:plan",
      metersPerPixel: 0.05,
      x: 3,
      y: 4,
      opacity: 0.4,
      scaled: false,
    });
    expect(got).toEqual({
      image: "data:plan",
      metersPerPixel: 0.02,
      x: 0,
      y: 0,
      opacity: 0.4,
      scaled: true,
    });
  });

  it("下敷きが無ければなぞりの図面を下敷きにする（濃さは既定）", () => {
    expect(underlayForTrace(trace, EMPTY_UNDERLAY)?.opacity).toBe(
      EMPTY_UNDERLAY.opacity,
    );
  });

  it("すでにそろっていれば null。なぞりの図面・縮尺が無いときも null", () => {
    const same = {
      image: "data:plan",
      metersPerPixel: 0.02,
      x: 0,
      y: 0,
      opacity: 0.75,
      scaled: true,
    };
    expect(underlayForTrace(trace, same)).toBeNull();
    expect(underlayForTrace(EMPTY_TRACE, same)).toBeNull();
    expect(
      underlayForTrace({ ...trace, metersPerPixel: 0 }, EMPTY_UNDERLAY),
    ).toBeNull();
  });
});

describe("underlayForTrace（図面を動かした下敷きは戻さない）", () => {
  const trace = { ...EMPTY_TRACE, image: "data:plan", metersPerPixel: 0.02 };

  it("同じ図面・同じ縮尺で縮尺合わせ済みなら、左上が0でなくても null（動かした位置を保つ）", () => {
    expect(
      underlayForTrace(trace, {
        image: "data:plan",
        metersPerPixel: 0.02,
        x: -3,
        y: 2,
        opacity: 0.5,
        scaled: true,
      }),
    ).toBeNull();
  });
});

describe("traceAfterUnderlay（下敷きを置き替えたら、なぞりに使う図面・縮尺もそろえる）", () => {
  const trace = {
    ...EMPTY_TRACE,
    image: "data:plan",
    metersPerPixel: 0.02,
    points: [{ x: 1, y: 1 }],
  };

  it("同じ図面の縮尺合わせなら縮尺だけ変える（なぞり中の点は残す）", () => {
    const got = traceAfterUnderlay(trace, {
      image: "data:plan",
      metersPerPixel: 0.05,
      x: 0,
      y: 0,
      opacity: 0.75,
      scaled: true,
    });
    expect(got.metersPerPixel).toBe(0.05);
    expect(got.points).toEqual(trace.points);
  });

  it("同じ図面で縮尺が同じ・縮尺合わせ前なら何も変えない（同じものを返す）", () => {
    const same = { image: "data:plan", x: 0, y: 0, opacity: 0.75 };
    expect(
      traceAfterUnderlay(trace, { ...same, metersPerPixel: 0.02, scaled: true }),
    ).toBe(trace);
    expect(
      traceAfterUnderlay(trace, { ...same, metersPerPixel: 0.09, scaled: false }),
    ).toBe(trace);
  });

  it("別の図面を貼ったら、その図面で白紙から（縮尺合わせ前は縮尺0）", () => {
    const got = traceAfterUnderlay(trace, {
      image: "data:other",
      metersPerPixel: 0.01,
      x: 0,
      y: 0,
      opacity: 0.75,
      scaled: false,
    });
    expect(got).toEqual({ ...EMPTY_TRACE, image: "data:other" });
  });

  it("下敷きを外したら、なぞりの図面も外す。元から無ければそのまま", () => {
    expect(traceAfterUnderlay(trace, EMPTY_UNDERLAY)).toEqual(EMPTY_TRACE);
    expect(traceAfterUnderlay(EMPTY_TRACE, EMPTY_UNDERLAY)).toBe(EMPTY_TRACE);
  });
});
