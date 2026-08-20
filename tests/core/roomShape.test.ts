import { describe, expect, it } from "vitest";
import {
  deducts,
  edge,
  floorArea,
  lShape,
  rectangleShape,
  roomQuantities,
  roomSymbols,
  solveShape,
  splitEdge,
  updateEdge,
  uShape,
} from "../../src/core/room/shape";

describe("部屋形状（単線図）", () => {
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
    expect(solveShape(shape).error).toBe("横方向の寸法が閉じていません");
  });
});
