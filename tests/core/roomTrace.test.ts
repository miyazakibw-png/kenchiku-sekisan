import { describe, expect, it } from "vitest";
import {
  longestEdgePixels,
  metersPerPixel,
  pointsToShape,
  snapToAxis,
  toMeters,
  traceArea,
  parseTrace,
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
