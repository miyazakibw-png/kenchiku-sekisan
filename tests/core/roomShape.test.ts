import { describe, expect, it } from "vitest";
import {
  arcLength,
  closeShape,
  closeShapeAtEdge,
  columnNotches,
  cutCorner,
  deducts,
  edge,
  floorArea,
  lShape,
  mirrorShape,
  moveCorner,
  nextEdgeDirection,
  notchEdge,
  rectangleShape,
  roomQuantities,
  roomSymbols,
  shapeExtents,
  solveShape,
  splitEdge,
  updateEdge,
  uShape,
} from "../../src/core/room/shape";

/** 形の向きを見るために、左上を原点にそろえた頂点の並び */
function cornerSet(shape: ReturnType<typeof rectangleShape>): string[] {
  const points = solveShape(shape).points;
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  return points
    .map((point) => `${(point.x - left).toFixed(2)},${(point.y - top).toFixed(2)}`)
    .sort();
}

describe("部屋形状（単線図）", () => {
  it("左右反転・上下反転しても面積・壁長さは変わらず、形だけが裏返る", () => {
    const shape = lShape(6, 4, 2, 1.5);
    const solved = solveShape(shape);
    for (const axis of ["x", "y"] as const) {
      const flipped = mirrorShape(shape, axis);
      const after = solveShape(flipped);
      expect(after.error).toBeNull();
      expect(floorArea(after)).toBe(floorArea(solved));
      expect(roomQuantities(after, 2.5).wallLength).toBe(
        roomQuantities(solved, 2.5).wallLength,
      );
      // 頂点の並びは変わる（元と同じ形のままではない）
      expect(cornerSet(flipped)).not.toEqual(cornerSet(shape));
      // 2回反転すれば元の形に戻る
      expect(cornerSet(mirrorShape(flipped, axis))).toEqual(cornerSet(shape));
    }
  });

  it("長方形の床面積と壁長さを算出する", () => {
    const solved = solveShape(rectangleShape(3, 3));
    expect(floorArea(solved)).toBe(9);
    expect(roomQuantities(solved, 2.5).wallLength).toBe(12);
  });

  it("未入力の寸法は閉じた形になるように自動算出する", () => {
    const shape = {
      edges: [edge("E", 4.5), edge("S", 3), edge("W", null), edge("N", null)],
    };
    const solved = solveShape(shape);
    expect(solved.missing).toEqual([]);
    expect(solved.edges[2].resolved).toBe(4.5);
    expect(solved.edges[2].auto).toBe(true);
    expect(floorArea(solved)).toBe(13.5);
  });

  it("同じ方向に未入力が2辺あると寸法不足として印を返す", () => {
    const shape = {
      edges: [edge("E", null), edge("S", 3), edge("W", null), edge("N", 3)],
    };
    const solved = solveShape(shape);
    expect(solved.missing).toHaveLength(2);
    expect(solved.points).toEqual([]);
  });

  it("L型は欠き取り分を差し引いた床面積になる", () => {
    const solved = solveShape(lShape(5, 4, 2, 1));
    expect(floorArea(solved)).toBe(5 * 4 - 2 * 1);
  });

  it("コ型は凹み分を差し引いた床面積になる", () => {
    const solved = solveShape(uShape(6, 4, 2, 1, 1));
    expect(floorArea(solved)).toBe(6 * 4 - 2 * 1);
  });

  it("指定した角をL型に欠き取っても他の辺の寸法は残る", () => {
    const shape = rectangleShape(5, 4);
    const cut = cutCorner(shape, 2, 1, 2);
    expect(cut.error).toBeNull();
    expect(cut.shape.edges).toHaveLength(6);
    expect(cut.shape.edges[0].length).toBe(5);
    expect(floorArea(solveShape(cut.shape))).toBe(5 * 4 - 2 * 1);
  });

  it("角を続けて欠き取っても先の欠き取りは残る", () => {
    const first = cutCorner(rectangleShape(6, 4), 2, 1, 2);
    const second = cutCorner(first.shape, 0, 1, 1);
    expect(second.error).toBeNull();
    expect(second.shape.edges).toHaveLength(8);
    expect(floorArea(solveShape(second.shape))).toBe(6 * 4 - 2 * 1 - 1 * 1);
  });

  it("欠き取りが元の辺より長いときは辺の長さに合わせて欠き取る", () => {
    const shape = rectangleShape(5, 4);
    const cut = cutCorner(shape, 2, 9, 2);
    expect(cut.error).toBeNull();
    expect(cut.adjusted).toBe(true);
    expect(solveShape(cut.shape).error).toBeNull();
    expect(floorArea(solveShape(cut.shape))).toBeCloseTo(5 * 4 - 4 * 2, 1);
  });

  it("両隣の辺いっぱいに欠き取っても形がつぶれない", () => {
    const cut = cutCorner(rectangleShape(6, 4), 1, 10, 10);
    expect(cut.error).toBeNull();
    expect(cut.adjusted).toBe(true);
    const solved = solveShape(cut.shape);
    expect(solved.error).toBeNull();
    expect(floorArea(solved) ?? 0).toBeGreaterThan(0);
  });

  it("短い辺どうしの角でもL型に欠き取れる", () => {
    const shape = {
      edges: [
        edge("E", 1.1),
        edge("S", 1),
        edge("E", 1.7),
        edge("S", 3.8),
        edge("W", 2.8),
        edge("N", 4.8),
      ],
    };
    expect(solveShape(shape).error).toBeNull();
    const cut = cutCorner(shape, 1, 1, 1);
    expect(cut.error).toBeNull();
    expect(solveShape(cut.shape).error).toBeNull();
    expect(floorArea(solveShape(cut.shape))).toBeLessThan(
      floorArea(solveShape(shape)) ?? 0,
    );
  });

  it("斜め辺に接する角もL型に欠き取れる", () => {
    const moved = moveCorner(rectangleShape(6, 4), 1, -1, -1);
    expect(moved.error).toBeNull();
    const cut = cutCorner(moved.shape, 3, 1, 1);
    expect(cut.error).toBeNull();
    const solved = solveShape(cut.shape);
    expect(solved.error).toBeNull();
    expect(solved.points).toHaveLength(cut.shape.edges.length);
  });

  it("斜め辺を作ったあとでも角の欠き取りを何度でも続けられる", () => {
    const moved = moveCorner(rectangleShape(8, 6), 1, -1, -1);
    let shape = moved.shape;
    for (const corner of [3, 0, 4]) {
      const cut = cutCorner(shape, corner, 0.3, 0.3);
      expect(cut.error).toBeNull();
      shape = cut.shape;
      expect(solveShape(shape).error).toBeNull();
    }
  });

  it("閉じていない寸法を自動で合わせる", () => {
    const shape = {
      edges: [edge("E", 4), edge("S", 3), edge("W", 3.5), edge("N", 3)],
    };
    expect(solveShape(shape).error).toBe(
      "横方向の寸法が閉じていません（← 左へ 0.50 足りません）",
    );
    const closed = closeShape(shape);
    expect(closed.changed).toBe(true);
    expect(solveShape(closed.shape).error).toBeNull();
    expect(floorArea(solveShape(closed.shape))).toBe(12);
  });

  it("選んだ辺だけを直して形を閉じる", () => {
    const shape = {
      edges: [edge("E", 4), edge("S", 3), edge("W", 3.5), edge("N", 3)],
    };

    const fixed = closeShapeAtEdge(shape, shape.edges[0].id);
    expect(fixed.error).toBeNull();
    expect(fixed.length).toBe(3.5);
    expect(solveShape(fixed.shape).error).toBeNull();
    // 選んだ辺以外は変えない
    expect(fixed.shape.edges[2].length).toBe(3.5);

    const other = closeShapeAtEdge(shape, shape.edges[2].id);
    expect(other.length).toBe(4);

    // 別の向きに空欄（自動算出）があっても合わせられる
    const withBlank = {
      edges: [edge("E", 4), edge("S", 3), edge("W", 3.5), edge("N", null)],
    };
    const blankFixed = closeShapeAtEdge(withBlank, withBlank.edges[0].id);
    expect(blankFixed.error).toBeNull();
    expect(blankFixed.length).toBe(3.5);

    // 縦の辺は縦方向が合っているので変わらない
    const vertical = closeShapeAtEdge(shape, shape.edges[1].id);
    expect(vertical.error).toBeNull();
    expect(vertical.shape).toBe(shape);
  });

  it("閉じている形は自動補正しない", () => {
    const shape = rectangleShape(3, 3);
    expect(closeShape(shape).changed).toBe(false);
    expect(closeShape(shape).shape).toBe(shape);
  });

  it("斜め辺もコ型に凹ませられる", () => {
    const moved = moveCorner(rectangleShape(6, 4), 1, -1, -1);
    const index = moved.shape.edges.findIndex((row) => row.direction === "D");
    expect(index).toBeGreaterThanOrEqual(0);
    const notched = notchEdge(moved.shape, index, 0.5, 0.5);
    expect(notched.error).toBeNull();
    expect(solveShape(notched.shape).error).toBeNull();
    expect(notched.shape.edges.length).toBeGreaterThan(
      moved.shape.edges.length,
    );
  });

  it("斜め辺も途中で分けて角を足せる", () => {
    const moved = moveCorner(rectangleShape(6, 4), 1, -1, -1);
    const diagonal = moved.shape.edges.find((row) => row.direction === "D");
    expect(diagonal).toBeDefined();
    const split = splitEdge(moved.shape, diagonal!.id, 0.5);
    expect(split.edges).toHaveLength(moved.shape.edges.length + 1);
    expect(solveShape(split).error).toBeNull();
    expect(floorArea(solveShape(split))).toBeCloseTo(
      floorArea(solveShape(moved.shape)) ?? 0,
      1,
    );
  });

  it("指定した辺の途中をコ型に凹ませる", () => {
    const shape = rectangleShape(6, 4);
    const notched = notchEdge(shape, 2, 2, 1);
    expect(notched.error).toBeNull();
    expect(notched.shape.edges).toHaveLength(8);
    expect(floorArea(solveShape(notched.shape))).toBe(6 * 4 - 2 * 1);
  });

  it("凹み位置を指定できる", () => {
    const notched = notchEdge(rectangleShape(6, 4), 2, 2, 1, 1);
    expect(notched.shape.edges[2].length).toBe(1);
    expect(notched.shape.edges[6].length).toBe(3);
    expect(floorArea(solveShape(notched.shape))).toBe(6 * 4 - 2 * 1);
  });

  it("壁の無い開口は壁長さに入れない", () => {
    const shape = rectangleShape(3, 3);
    const opened = updateEdge(shape, shape.edges[0].id, { kind: "opening" });
    const quantities = roomQuantities(solveShape(opened), 2.5);
    expect(quantities.wallLength).toBe(9);
    expect(quantities.wallArea).toBe(22.5);
  });

  it("柱は柱長さ・柱面積として分けて数える", () => {
    const shape = rectangleShape(3, 3);
    const withColumn = updateEdge(shape, shape.edges[1].id, { kind: "column" });
    const quantities = roomQuantities(solveShape(withColumn), 2.5);
    expect(quantities.wallLength).toBe(9);
    expect(quantities.columnLength).toBe(3);
    expect(quantities.columnArea).toBe(7.5);
    expect(quantities.baseboardLength).toBe(12);
  });

  it("記号表に合計と辺ごとの記号を作る", () => {
    const solved = solveShape(rectangleShape(3, 2));
    const symbols = roomSymbols(solved, 2.5);
    expect(symbols.find((row) => row.symbol === "FA")?.value).toBe(6);
    expect(symbols.find((row) => row.symbol === "HL")?.value).toBe(10);
    expect(symbols.find((row) => row.symbol === "WA")?.value).toBe(25);
    expect(symbols.find((row) => row.symbol === "WA1")?.value).toBe(7.5);
    expect(
      symbols.filter(
        (row) => row.symbol.startsWith("HL") && row.symbol !== "HL",
      ),
    ).toHaveLength(4);
  });

  it("天井高さが未入力なら面積の記号は空にする", () => {
    const symbols = roomSymbols(solveShape(rectangleShape(3, 2)), null);
    expect(symbols.find((row) => row.symbol === "WA")?.value).toBeNull();
    expect(symbols.find((row) => row.symbol === "FA")?.value).toBe(6);
  });

  it("辺を分割すると残りは自動算出になる", () => {
    const shape = rectangleShape(10, 3);
    const split = splitEdge(shape, shape.edges[0].id, 5.5);
    expect(split.edges).toHaveLength(5);
    expect(split.edges[0].length).toBe(5.5);
    expect(split.edges[1].length).toBe(4.5);
    expect(floorArea(solveShape(split))).toBe(30);
  });

  it("取り合いの欠除は0.5m2以下を差し引かない", () => {
    expect(deducts(0.49)).toBe(false);
    expect(deducts(0.5)).toBe(false);
    expect(deducts(0.51)).toBe(true);
    expect(deducts(0.4, 0.3)).toBe(true);
  });

  it("上段の建具は壁面積と巾木長さから差し引く（数の分だけ）", () => {
    const solved = solveShape(rectangleShape(4, 3));
    const fittings = [
      {
        symbol: "AW1",
        multiplier: 2,
        area: 3.6,
        baseboardDeduction: 1.8,
        edgeId: null,
      },
    ];
    const plain = roomQuantities(solved, 2.5);
    const withFittings = roomQuantities(solved, 2.5, fittings);

    expect(plain.wallArea).toBe(35);
    expect(withFittings.wallArea).toBe(27.8);
    expect(withFittings.baseboardLength).toBe(10.4);
    expect(withFittings.fittingArea).toBe(7.2);
  });

  it("取り付く壁を指定した建具はその壁の記号からも差し引く", () => {
    const shape = rectangleShape(4, 3);
    const solved = solveShape(shape);
    const fittings = [
      {
        symbol: "SD1",
        multiplier: 1,
        area: 1.89,
        baseboardDeduction: 0.9,
        edgeId: shape.edges[0].id,
      },
    ];
    const symbols = roomSymbols(solved, 2.5, fittings);
    expect(symbols.find((row) => row.symbol === "WA1")?.value).toBe(8.11);
    expect(symbols.find((row) => row.symbol === "HL1")?.value).toBe(3.1);
    expect(symbols.find((row) => row.symbol === "WA2")?.value).toBe(7.5);
    expect(symbols.find((row) => row.symbol === "DL")?.value).toBe(0.9);
  });

  it("寸法が閉じていない場合はエラーを返す", () => {
    const shape = {
      edges: [edge("E", 3), edge("S", 3), edge("W", 2), edge("N", 3)],
    };
    expect(solveShape(shape).error).toBe(
      "横方向の寸法が閉じていません（← 左へ 1.00 足りません）",
    );
  });

  it("縦の寸法が合っていれば閉じていないと言わない", () => {
    // 1.45+0.50+3.50+9.45 = 14.90（戻りが14.90なので閉じている）
    const shape = {
      edges: [
        edge("S", 14.9),
        edge("W", 1.9),
        edge("N", 1.45),
        edge("E", 0.3),
        edge("N", 0.5),
        edge("N", 3.5),
        edge("N", 9.45),
        edge("E", 1.6),
      ],
    };
    expect(solveShape(shape).error).toBeNull();
  });

  it("辺追加は閉じていない方向へ戻る向きを選ぶ", () => {
    // 縦は 14.90 下って 5.45 戻った状態。次の辺は「↑ 上」になる
    const shape = {
      edges: [
        edge("S", 14.9),
        edge("W", 1.9),
        edge("N", 1.45),
        edge("E", 0.3),
        edge("N", 0.5),
        edge("N", 3.5),
      ],
    };
    expect(nextEdgeDirection(shape)).toBe("N");
  });

  it("曲面壁は弦の長さと矢から弧長を出して壁長さに使う", () => {
    // 半円（弦4.00・矢2.00）の弧長は 2π ≒ 6.28
    expect(arcLength(4, 2)).toBe(6.28);
    // 矢が無ければ直線として弦の長さを使う
    expect(arcLength(4, 0)).toBe(4);
    // 内側へ凹む（マイナス）でも弧長は同じ
    expect(arcLength(4, -2)).toBe(6.28);

    const shape = {
      edges: [
        edge("E", 4),
        edge("S", 3),
        { ...edge("W", 4, "curve"), bulge: 0.5 },
        edge("N", 3),
      ],
    };
    const solved = solveShape(shape);
    expect(solved.edges[2].measured).toBe(4.16);
    // 壁長さは曲面壁の弧長で数える（4 + 3 + 4.16 + 3）
    expect(roomQuantities(solved, 2.5).wallLength).toBe(14.16);
  });

  it("頂点を上下左右へ動かすと両隣の辺の寸法が変わる", () => {
    const shape = rectangleShape(4, 3);
    const moved = moveCorner(shape, 1, 1, 0);
    expect(moved.error).toBeNull();
    const solved = solveShape(moved.shape);
    // 右上の角から右へ1.00動かすと上辺が5.00、下辺は斜めになる
    expect(solved.edges[0].length).toBe(5);
    expect(solved.edges[1].direction).toBe("D");
    expect(solved.edges[1].dx).toBe(-1);
    expect(solved.edges[1].dy).toBe(3);
    expect(solved.edges[1].resolved).toBe(3.16);
  });

  it("斜め辺を含む形でも閉じた形として面積を出せる", () => {
    const shape = rectangleShape(4, 3);
    const moved = moveCorner(shape, 1, 1, 0);
    const solved = solveShape(moved.shape);
    expect(solved.error).toBeNull();
    expect(solved.points).toHaveLength(4);
    // 台形（上辺5.00・下辺4.00・高さ3.00）
    expect(floorArea(solved)).toBe(13.5);
  });

  it("外形寸法（X・Y の最大）を出せる", () => {
    // 6.90×3.45 の下側に 6.40×0.30 が付いた形（右下が 0.50×0.30 の欠き）
    const shape = {
      edges: [
        edge("E", 6.9),
        edge("S", 3.45),
        edge("W", 0.5, "column"),
        edge("S", 0.3, "column"),
        edge("W", 6.4),
        edge("N", 0.3, "column"),
        edge("N", 3.45),
      ],
    };
    const solved = solveShape(shape);
    expect(solved.error).toBeNull();
    expect(shapeExtents(solved)).toEqual({ x: 6.9, y: 3.75 });
    // 柱の欠き（0.50×0.30＝0.15）は取合欠除（0.5m2）以下なので引かない
    expect(columnNotches(solved).map((notch) => notch.area)).toEqual([0.15]);
    expect(floorArea(solved)).toBe(25.88);
    // 取合欠除を0にすると図形どおりに引く
    expect(floorArea(solved, 0)).toBe(25.73);
  });
});
