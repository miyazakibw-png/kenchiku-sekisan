import { describe, expect, it } from "vitest";
import { calcVariables } from "../../src/core/aggregate/variables";
import {
  buildFrameLines,
  findSharedWalls,
  frameLineAttribute,
  frameQuantities,
  frameSymbols,
  isPickedUp,
  linePartVariables,
  reinforcementKind,
  reinforcementLength,
  roomLineId,
  nearMissWalls,
  snapPlacement,
  type FrameFitting,
  type FrameLineAttribute,
  type FramePlacement,
} from "../../src/core/frame/frame";
import { edge, rectangleShape, solveShape } from "../../src/core/room/shape";

/** 3m×4mの部屋（壁4面） */
function room(): ReturnType<typeof solveShape> {
  return solveShape(rectangleShape(4, 3));
}

function placement(patch: Partial<FramePlacement> = {}): FramePlacement {
  return {
    id: "p1",
    estimateRowId: 1,
    roomName: "内部 事務室",
    x: 0,
    y: 0,
    color: "#1d4ed8",
    ...patch,
  };
}

describe("開口部補強", () => {
  it("ドア類は W ＋ 施工高さ*2", () => {
    const fitting = { width: 1.8, sillHeight: null, baseboardDeduction: 1.8 };
    expect(reinforcementKind(fitting)).toBe("door");
    expect(reinforcementLength(fitting, 2.4)).toBe(6.6);
  });

  it("窓類は W*2 ＋ 施工高さ*2", () => {
    const fitting = { width: 1.65, sillHeight: 0.9, baseboardDeduction: 1.65 };
    expect(reinforcementKind(fitting)).toBe("window");
    expect(reinforcementLength(fitting, 2.4)).toBe(8.1);
  });

  it("窓＋ドア等は W*2 − 巾木差し引き ＋ 施工高さ*2 ＋ 腰高*2", () => {
    const fitting = { width: 2.6, sillHeight: 0.4, baseboardDeduction: 1.0 };
    expect(reinforcementKind(fitting)).toBe("mixed");
    expect(reinforcementLength(fitting, 2.5)).toBe(2.6 * 2 - 1 + 5 + 0.8);
  });

  it("Wが無ければ算出しない", () => {
    expect(
      reinforcementLength(
        { width: null, sillHeight: null, baseboardDeduction: null },
        2.4,
      ),
    ).toBeNull();
  });
});

describe("軸組ライン", () => {
  it("部屋の壁だけを軸組ラインにし、元の部屋・壁を追えるようにする", () => {
    const shapes = new Map([[1, room()]]);
    const lines = buildFrameLines({
      placements: [placement()],
      shapes,
      manualLines: [],
      attributes: {},
    });
    expect(lines).toHaveLength(4);
    expect(lines[0].estimateRowId).toBe(1);
    expect(lines[0].roomName).toBe("内部 事務室");
    expect(lines[0].edgeId).not.toBeNull();
    expect(lines[0].id).toBe(roomLineId("p1", lines[0].edgeId as string));
  });

  it("開口（壁なし）と柱は軸組ラインにしない", () => {
    const shape = rectangleShape(4, 3);
    const shapes = new Map([
      [
        1,
        solveShape({
          edges: [
            shape.edges[0],
            { ...shape.edges[1], kind: "opening" },
            shape.edges[2],
            { ...shape.edges[3], kind: "column" },
          ],
        }),
      ],
    ]);
    const lines = buildFrameLines({
      placements: [placement()],
      shapes,
      manualLines: [],
      attributes: {},
    });
    expect(lines).toHaveLength(2);
  });

  it("配置位置を足した座標になり、外周の線には印が付く", () => {
    const shapes = new Map([[1, room()]]);
    const lines = buildFrameLines({
      placements: [placement({ x: 2, y: 1 })],
      shapes,
      manualLines: [],
      attributes: {},
    });
    expect(lines[0].x1).toBe(2);
    expect(lines[0].y1).toBe(1);
    // 1部屋だけなら4面とも外周
    expect(lines.every((line) => line.perimeter)).toBe(true);
  });

  it("直接引いた線も同じ一覧に入り、長さを持つ", () => {
    const lines = buildFrameLines({
      placements: [],
      shapes: new Map(),
      manualLines: [{ id: "m1", x1: 0, y1: 0, x2: 3.5, y2: 0 }],
      attributes: {},
    });
    expect(lines[0].source).toBe("manual");
    expect(lines[0].length).toBe(3.5);
  });
});

describe("壁の共有", () => {
  it("別の部屋どうしで重なっている壁を見つける", () => {
    const shapes = new Map([[1, room()]]);
    const lines = buildFrameLines({
      placements: [
        placement({ id: "p1", x: 0 }),
        placement({ id: "p2", x: 4 }),
      ],
      shapes,
      manualLines: [],
      attributes: {},
    });
    const pairs = findSharedWalls(lines);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].length).toBe(3);
  });

  it("共有した側は拾わない", () => {
    const shapes = new Map([[1, room()]]);
    const base = buildFrameLines({
      placements: [
        placement({ id: "p1", x: 0 }),
        placement({ id: "p2", x: 4 }),
      ],
      shapes,
      manualLines: [],
      attributes: {},
    });
    const pair = findSharedWalls(base)[0];
    const attributes: Record<string, FrameLineAttribute> = {
      [pair.dropId]: frameLineAttribute({ sharedWithId: pair.keepId }),
    };
    const lines = buildFrameLines({
      placements: [
        placement({ id: "p1", x: 0 }),
        placement({ id: "p2", x: 4 }),
      ],
      shapes,
      manualLines: [],
      attributes,
    });
    const dropped = lines.find((line) => line.id === pair.dropId);
    expect(dropped && isPickedUp(dropped)).toBe(false);
    // 2部屋（14＋14）から共有した1面（3.00）を引く
    expect(frameQuantities(lines, [], 2.4).length).toBe(28 - 3);
  });
});

describe("吸着", () => {
  it("近くの壁の座標に寄せる", () => {
    const shapes = new Map([[1, room()]]);
    const others = buildFrameLines({
      placements: [placement({ id: "p1" })],
      shapes,
      manualLines: [],
      attributes: {},
    });
    const snapped = snapPlacement({ x: 4.12, y: 0.05, solved: room() }, others);
    expect(snapped).toEqual({ x: 4, y: 0 });
  });

  it("角どうしが近ければ、その点がぴったり重なるように寄せる", () => {
    const others = buildFrameLines({
      placements: [placement({ id: "p1" })],
      shapes: new Map([[1, room()]]),
      manualLines: [],
      attributes: {},
    });
    // 右下の角（4,3）に、動かす部屋の左上の角を近づける
    expect(snapPlacement({ x: 4.08, y: 3.06, solved: room() }, others)).toEqual(
      { x: 4, y: 3 },
    );
  });

  it("離れていれば動かさない", () => {
    const others = buildFrameLines({
      placements: [placement({ id: "p1" })],
      shapes: new Map([[1, room()]]),
      manualLines: [],
      attributes: {},
    });
    expect(snapPlacement({ x: 9, y: 9, solved: room() }, others)).toEqual({
      x: 9,
      y: 9,
    });
  });
});

describe("壁のずれ", () => {
  it("同じ壁のはずなのに少しずれている組を拾う", () => {
    const lines = buildFrameLines({
      placements: [
        placement({ id: "p1", estimateRowId: 1 }),
        placement({ id: "p2", estimateRowId: 1, x: 4.05, y: 0 }),
      ],
      shapes: new Map([[1, room()]]),
      manualLines: [],
      attributes: {},
    });
    const gaps = nearMissWalls(
      lines,
      0.3,
      // 面積が大きいほうを基準にする
      new Map([
        ["p1", 12],
        ["p2", 6],
      ]),
    );
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((gap) => gap.gap === 0.05)).toBe(true);
    expect(gaps.every((gap) => gap.aId.startsWith("p1"))).toBe(true);
    // ぴったり合っていればずれは出ない
    const aligned = buildFrameLines({
      placements: [
        placement({ id: "p1", estimateRowId: 1 }),
        placement({ id: "p2", estimateRowId: 1, x: 4, y: 0 }),
      ],
      shapes: new Map([[1, room()]]),
      manualLines: [],
      attributes: {},
    });
    expect(nearMissWalls(aligned, 0.3)).toEqual([]);
  });
});

describe("軸組数量", () => {
  const shapes = new Map([[1, room()]]);
  const lines = (attributes: Record<string, FrameLineAttribute> = {}) =>
    buildFrameLines({
      placements: [placement()],
      shapes,
      manualLines: [],
      attributes,
    });

  it("施工高さから面積を出し、拾わない線は合計に入れない", () => {
    const all = lines();
    const skipped = lines({
      [all[0].id]: frameLineAttribute({ pickup: false }),
    });
    const quantities = frameQuantities(skipped, [], 2.5);
    expect(quantities.length).toBe(14 - 4);
    expect(quantities.area).toBe(25);
  });

  it("線に付けた建具の面積を差し引き、補強を拾う", () => {
    const all = lines();
    const fittings: FrameFitting[] = [
      {
        id: "f1",
        symbol: "SD-2",
        multiplier: 1,
        lineId: all[0].id,
        area: 3.6,
        width: 1.8,
        sillHeight: null,
        baseboardDeduction: 1.8,
      },
    ];
    const quantities = frameQuantities(all, fittings, 2.5);
    expect(quantities.fittingArea).toBe(3.6);
    expect(quantities.area).toBe(14 * 2.5 - 3.6);
    expect(quantities.reinforcement).toBe(1.8 + 2.5 * 2);
  });

  it("線ごとの施工高さが優先される", () => {
    const all = lines();
    const custom = lines({
      [all[0].id]: frameLineAttribute({ workHeight: 3 }),
    });
    const quantities = frameQuantities(custom, [], 2.5);
    expect(quantities.area).toBe(4 * 3 + 10 * 2.5);
  });

  it("壁種ごとにまとめる", () => {
    const all = lines();
    const kinds = lines({
      [all[0].id]: frameLineAttribute({ wallKind: "LGS65" }),
      [all[1].id]: frameLineAttribute({ wallKind: "LGS65" }),
    });
    const quantities = frameQuantities(kinds, [], 2.5);
    expect(quantities.byWallKind).toEqual([
      { wallKind: "LGS65", length: 7, area: 17.5 },
    ]);
  });

  it("記号表に合計と線ごとの数量が並ぶ", () => {
    const quantities = frameQuantities(lines(), [], 2.5);
    const symbols = frameSymbols(quantities, 2.5);
    expect(symbols.slice(0, 5).map((item) => item.symbol)).toEqual([
      "AH",
      "AL",
      "AA",
      "DA",
      "RF",
    ]);
    expect(symbols.find((item) => item.symbol === "AL1")?.value).toBe(4);
    expect(symbols.find((item) => item.symbol === "AA1")?.value).toBe(10);
  });

  it("自分で引いた線はたてY1・よこX1と呼び、部位が補強なら記号で補強長さを採る", () => {
    const built = buildFrameLines({
      placements: [],
      shapes: new Map(),
      manualLines: [
        { id: "m1", x1: 0, y1: 0, x2: 0, y2: 3 },
        { id: "m2", x1: 0, y1: 0, x2: 4, y2: 0 },
      ],
      attributes: {},
    });
    expect(built.map((line) => line.label)).toEqual(["Y1", "X1"]);

    const fitting: FrameFitting = {
      symbol: "SD1",
      multiplier: 1,
      lineId: "m1",
      area: 1.8,
      width: 0.9,
      sillHeight: null,
      baseboardDeduction: 0.9,
    };
    const quantities = frameQuantities(
      built.map((line) => ({ ...line, perimeter: false })),
      [fitting],
      2.5,
    );
    const symbols = frameSymbols(quantities, 2.5);
    expect(symbols.find((item) => item.symbol === "<Y1:AL>")?.value).toBe(3);
    expect(symbols.find((item) => item.symbol === "<Y1:RF>")?.value).toBe(5.9);
    expect(symbols.find((item) => item.symbol === "<Y1>")?.value).toBe(5.7);
    expect(linePartVariables(symbols, "壁")).toEqual({});
    expect(linePartVariables(symbols, "壁補強")["<Y1>"]).toBe(5.9);
    expect(linePartVariables(symbols, "壁補強")["Y1"]).toBe(5.9);

    // 計算式には かっこ無しの Y1・X1 でも書ける
    const variables = calcVariables(symbols, [], 2.5);
    expect(variables["Y1"]).toBe(5.7);
    expect(variables["X1"]).toBe(variables["<X1>"]);
  });

  it("辺の寸法が無い部屋は線にしない", () => {
    const shape = solveShape({ edges: [edge("E", null), edge("S", null)] });
    const built = buildFrameLines({
      placements: [placement()],
      shapes: new Map([[1, shape]]),
      manualLines: [],
      attributes: {},
    });
    expect(built).toHaveLength(0);
  });
});
