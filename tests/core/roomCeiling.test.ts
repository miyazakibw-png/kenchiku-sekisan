import { describe, expect, it } from "vitest";
import {
  ceilingElement,
  ceilingQuantities,
  ceilingSymbols,
  type CeilingElement,
} from "../../src/core/room/ceiling";
import { rectangleShape, solveShape } from "../../src/core/room/shape";

function shape() {
  return solveShape(rectangleShape(4, 3));
}

function element(
  kind: CeilingElement["kind"],
  edgeId: string | null,
  patch: Partial<CeilingElement>,
): CeilingElement {
  return { ...ceilingElement(kind, edgeId), ...patch };
}

describe("天井伏図", () => {
  it("壁付き梁型は沿う壁の長さを引き継ぎ、面積は長さ×(梁幅＋下がり)", () => {
    const solved = shape();
    const wall = solved.edges[0];
    const result = ceilingQuantities(
      [element("wallBeam", wall.id, { width: 0.4, ceilingHeight: 2.2 })],
      solved,
      2.7,
    );
    expect(result.items[0].length).toBe(4);
    expect(result.items[0].drop).toBe(0.5);
    expect(result.totals.wallBeamLength).toBe(4);
    expect(result.totals.wallBeamArea).toBe(3.6);
  });

  it("天井付梁型は両側に見付が出るので下がりを2倍で数える", () => {
    const solved = shape();
    const wall = solved.edges[0];
    const result = ceilingQuantities(
      [
        element("ceilingBeam", wall.id, {
          length: 3,
          width: 0.4,
          ceilingHeight: 2.4,
        }),
      ],
      solved,
      2.7,
    );
    expect(result.totals.ceilingBeamLength).toBe(3);
    expect(result.totals.ceilingBeamArea).toBe(3);
  });

  it("下がり壁は下がり高さ分の面積になる", () => {
    const solved = shape();
    const wall = solved.edges[1];
    const result = ceilingQuantities(
      [element("dropWall", wall.id, { ceilingHeight: 2.3 })],
      solved,
      2.7,
    );
    expect(result.totals.dropWallLength).toBe(3);
    expect(result.totals.dropWallArea).toBe(1.2);
  });

  it("下がり天井は高さごとに長さをまとめる", () => {
    const solved = shape();
    const result = ceilingQuantities(
      [
        element("dropCeiling", solved.edges[0].id, {
          ceilingHeight: 2.4,
          area: 4,
        }),
        element("dropCeiling", solved.edges[2].id, { ceilingHeight: 2.4 }),
        element("dropCeiling", solved.edges[1].id, { ceilingHeight: 2.2 }),
      ],
      solved,
      2.7,
    );
    expect(result.dropCeilingByHeight).toEqual([
      { drop: 0.3, length: 8 },
      { drop: 0.5, length: 3 },
    ]);
    expect(result.totals.dropCeilingArea).toBe(4);
  });

  it("下がり天井の線は壁に当たるところで止まり、その長さを自動で使う", () => {
    // 6×4の部屋の右下を2×2欠き取ったL型
    const solved = solveShape({
      edges: [
        { id: "e1", direction: "E", length: 6, kind: "wall" },
        { id: "e2", direction: "S", length: 2, kind: "wall" },
        { id: "e3", direction: "W", length: 2, kind: "wall" },
        { id: "e4", direction: "S", length: 2, kind: "wall" },
        { id: "e5", direction: "W", length: 4, kind: "wall" },
        { id: "e6", direction: "N", length: 4, kind: "wall" },
      ],
    });
    // 上の壁から3m下がった位置＝欠き取りの外なので、壁から壁まで4mになる
    const deep = ceilingQuantities(
      [element("dropCeiling", "e1", { offset: 3 })],
      solved,
      2.7,
    );
    expect(deep.items[0].length).toBe(4);
    // 上の壁から1m下がった位置は欠き取りより上なので6mのまま（○～○）
    const shallow = ceilingQuantities(
      [element("dropCeiling", "e1", { offset: 1 })],
      solved,
      2.7,
    );
    expect(shallow.items[0].length).toBe(6);
  });

  it("下がり天井には図に出す番号（C1・C2…）を付ける", () => {
    const solved = shape();
    const result = ceilingQuantities(
      [
        element("wallBeam", solved.edges[0].id, {}),
        element("dropCeiling", solved.edges[0].id, {}),
        element("dropCeiling", solved.edges[1].id, {}),
      ],
      solved,
      2.7,
    );
    expect(result.items.map((row) => row.code)).toEqual([null, "C1", "C2"]);
  });

  it("梁型はＨ（梁せい）を入れれば壁の高さを入れなくても面積が出る", () => {
    const solved = shape();
    const result = ceilingQuantities(
      [element("wallBeam", solved.edges[0].id, { width: 0.4, height: 0.5 })],
      solved,
      2.7,
    );
    expect(result.items[0].drop).toBe(0.5);
    expect(result.totals.wallBeamArea).toBe(3.6);
  });

  it("記号は合計と線ごとに作る", () => {
    const solved = shape();
    const result = ceilingQuantities(
      [
        element("wallBeam", solved.edges[0].id, {
          width: 0.4,
          ceilingHeight: 2.2,
        }),
      ],
      solved,
      2.7,
    );
    const symbols = ceilingSymbols(result);
    expect(symbols.find((row) => row.symbol === "GA")?.value).toBe(3.6);
    expect(symbols.find((row) => row.symbol === "GL1")?.value).toBe(4);
    expect(symbols.find((row) => row.symbol === "GA1")?.value).toBe(3.6);
  });

  it("天井高さが未入力なら面積は出さない（長さだけ数える）", () => {
    const solved = shape();
    const result = ceilingQuantities(
      [element("wallBeam", solved.edges[0].id, { width: 0.4 })],
      solved,
      2.7,
    );
    expect(result.items[0].area).toBeNull();
    expect(result.totals.wallBeamLength).toBe(4);
    expect(result.totals.wallBeamArea).toBe(0);
  });
});
