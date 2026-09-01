import { describe, expect, it } from "vitest";
import {
  beamFootprintArea,
  ceilingElement,
  ceilingLines,
  ceilingQuantities,
  ceilingRegions,
  ceilingSymbols,
  normalizeCeilingHeights,
  type CeilingElement,
} from "../../src/core/room/ceiling";
import {
  lShape,
  rectangleShape,
  roomQuantities,
  solveShape,
} from "../../src/core/room/shape";

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
  it("壁付き梁型は沿う壁の長さを引き継ぎ、面積は梁底＋見付1面", () => {
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
    // 梁底（Ｗ幅0.40）＋見付1面（Ｈ0.50）
    expect(result.totals.wallBeamArea).toBe(3.6);
  });

  it("天井付梁型は壁までの長さを自動で使い、梁底＋見付2面で数える", () => {
    const solved = shape();
    const wall = solved.edges[0];
    const result = ceilingQuantities(
      [
        element("ceilingBeam", wall.id, {
          width: 0.4,
          ceilingHeight: 2.4,
        }),
      ],
      solved,
      2.7,
    );
    // 2本の見付線それぞれが壁から壁まで（4m）
    expect(result.totals.ceilingBeamLength).toBe(4);
    // 梁底（Ｗ幅0.40）＋見付2面（Ｈ0.30×2）
    expect(result.totals.ceilingBeamArea).toBe(4);
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
    // 0.3の2本は、より低い0.5の線に当たって止まる（4m→3m）
    expect(result.dropCeilingByHeight).toEqual([
      { drop: 0.3, length: 6 },
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

  it("壁付き梁型は壁の長さのままで、他の線では切らない", () => {
    const solved = shape();
    const result = ceilingQuantities(
      [
        element("wallBeam", solved.edges[0].id, { width: 0.3, height: 0.4 }),
        // 直交してぶつかる、より低い下がり天井
        element("dropCeiling", solved.edges[1].id, { offset: 2, height: 0.6 }),
      ],
      solved,
      2.7,
    );
    expect(result.items[0].length).toBe(4);
  });

  it("下がり天井は自分より低くなる線のところで止まる", () => {
    const solved = shape();
    const low = element("dropCeiling", solved.edges[1].id, {
      offset: 1.5,
      height: 0.6,
    });
    const high = element("dropCeiling", solved.edges[0].id, {
      offset: 1,
      height: 0.3,
    });
    const result = ceilingQuantities([high, low], solved, 2.7);
    // 4mの壁沿いだが、低い下がり天井（右から1.5m）に当たって止まる
    expect(result.items[0].length).toBe(2.5);
    // 低い方は高い線では切られない
    expect(result.items[1].length).toBe(3);
  });

  it("下がり天井の線は梁型のところで止まる（下がりが小さい梁でも）", () => {
    const solved = shape();
    // 4mの壁に沿う下がり天井（下がり0.6）と、直交する壁に沿う幅0.5の梁型（下がり0.3）
    const drop = element("dropCeiling", solved.edges[0].id, {
      offset: 1,
      height: 0.6,
    });
    const beam = element("wallBeam", solved.edges[1].id, {
      width: 0.5,
      height: 0.3,
    });
    const result = ceilingQuantities([drop, beam], solved, 2.7);
    // 壁までの4mではなく、梁の見付（壁から0.5m）で止まる
    expect(result.items[0].length).toBe(3.5);
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

  it("梁の前に下がり天井があれば、取りつく天井は下がった天井になる", () => {
    const solved = shape();
    const drop = element("dropCeiling", solved.edges[0].id, {
      offset: 1,
      height: 0.4,
    });
    const beam = element("wallBeam", solved.edges[0].id, {
      width: 0.4,
      height: 0.35,
    });
    const result = ceilingQuantities([drop, beam], solved, 2.7);
    const row = result.items[1];
    // 取りつく天井＝2.70−0.40、壁高さ＝2.30−0.35
    expect(row.baseHeight).toBe(2.3);
    expect(row.wallHeight).toBe(1.95);
    expect(row.drop).toBe(0.35);
  });

  it("取りつく天井高さは手で入れた値が優先される", () => {
    const solved = shape();
    const result = ceilingQuantities(
      [
        element("wallBeam", solved.edges[0].id, {
          width: 0.4,
          height: 0.35,
          baseHeight: 3.0,
        }),
      ],
      solved,
      3.82,
    );
    expect(result.items[0].baseHeight).toBe(3.0);
    expect(result.items[0].wallHeight).toBe(2.65);
  });

  it("部屋の天井高さを変えると壁高さも付いてくる（コピーした計算書）", () => {
    const solved = shape();
    const beam = element("wallBeam", solved.edges[0].id, {
      width: 0.2,
      height: 0.35,
    });
    expect(ceilingQuantities([beam], solved, 5.1).items[0].wallHeight).toBe(
      4.75,
    );
    expect(ceilingQuantities([beam], solved, 3.82).items[0].wallHeight).toBe(
      3.47,
    );
  });

  it("保存済みの壁高さはＨに直して読み込む（元の天井高さを持ち込まない）", () => {
    const solved = shape();
    const saved = element("wallBeam", solved.edges[0].id, {
      width: 0.2,
      ceilingHeight: 4.75,
      height: null,
    });
    const [fixed] = normalizeCeilingHeights([saved], 5.1);
    expect(fixed.height).toBe(0.35);
    expect(fixed.ceilingHeight).toBeNull();
    // 部屋の天井高さを3.82に変えると壁高さは3.47
    expect(ceilingQuantities([fixed], solved, 3.82).items[0].wallHeight).toBe(
      3.47,
    );
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

  it("Ｗ幅が未入力なら面積は出さない（長さだけ数える）", () => {
    const solved = shape();
    const result = ceilingQuantities(
      [element("wallBeam", solved.edges[0].id, { width: null })],
      solved,
      2.7,
    );
    expect(result.items[0].area).toBeNull();
    expect(result.totals.wallBeamLength).toBe(4);
    expect(result.totals.wallBeamArea).toBe(0);
  });

  it("線で囲まれた天井の区画すべてに番号（C1・C2…）を振る", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [
        element("dropCeiling", solved.edges[0].id, { offset: 1, height: 0.3 }),
        element("dropCeiling", solved.edges[1].id, {
          offset: 1.5,
          height: 0.6,
        }),
      ],
      solved,
      2.7,
    );
    expect(regions.map((row) => row.code)).toEqual(["C1", "C2", "C3"]);
    expect(regions.reduce((sum, row) => sum + row.area, 0)).toBeCloseTo(12, 6);
    // 区画ごとに天井高さが出る（部屋2.7−下がり）
    expect(regions.map((row) => row.height).sort()).toEqual([2.1, 2.4, 2.7]);
  });

  it("天井高さが同じでつながる区画（コ型の下がり天井）は1つにまとめて番号も1つ", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [
        element("dropCeiling", solved.edges[0].id, {
          offset: 0.5,
          height: 0.2,
        }),
        element("dropCeiling", solved.edges[1].id, {
          offset: 0.5,
          height: 0.2,
        }),
        element("dropCeiling", solved.edges[2].id, {
          offset: 0.5,
          height: 0.2,
        }),
      ],
      solved,
      2.7,
    );
    // コ型の下がり天井（1つ）＋真ん中の天井（1つ）
    expect(regions.map((row) => row.code)).toEqual(["C1", "C2"]);
    const drop = regions.find((row) => row.drop === 0.2);
    expect(drop?.height).toBe(2.5);
    expect(regions.reduce((sum, row) => sum + row.area, 0)).toBeCloseTo(12, 6);
  });

  it("区画を分けるのは下がり天井の線だけ（壁付き梁型・下がり壁では分けない）", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [
        element("wallBeam", solved.edges[0].id, { width: 0.4, height: 0.4 }),
        element("dropWall", solved.edges[1].id, { width: 0.3, height: 0.3 }),
        element("ceilingBeam", solved.edges[0].id, {
          offset: 1,
          width: 0.4,
          height: 0.4,
        }),
      ],
      solved,
      2.7,
    );
    expect(regions.map((row) => row.code)).toEqual(["C1"]);
    // 梁型の梁底（壁付き4.00×0.40＋天井付4.00×0.40）は天井の面積から引く
    expect(regions[0].area).toBeCloseTo(8.8, 6);
    expect(regions[0].height).toBe(2.7);
  });

  it("L型でも下がり天井の線で区画を2つに分ける", () => {
    const solved = solveShape(lShape(6, 5, 2, 2));
    const wall = solved.edges[3]; // 欠き取りの縦壁（この壁に沿う下がり天井）
    const regions = ceilingRegions(
      [element("dropCeiling", wall.id, { offset: 1.5, height: 0.4 })],
      solved,
      2.7,
    );
    expect(regions.map((row) => row.code)).toEqual(["C1", "C2"]);
    expect(regions.map((row) => row.height).sort()).toEqual([2.3, 2.7]);
    expect(regions.reduce((sum, row) => sum + row.area, 0)).toBeCloseTo(26, 6);
  });

  it("天井高さがまだ空でも下がり天井の線で区画を2つに分ける", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [element("dropCeiling", solved.edges[0].id, { offset: 1 })],
      solved,
      2.7,
    );
    expect(regions.map((row) => row.code)).toEqual(["C1", "C2"]);
    expect(regions.reduce((sum, row) => sum + row.area, 0)).toBeCloseTo(12, 6);
  });

  it("区画には天井高さを入れる先（下がり天井の行）が付く", () => {
    const solved = shape();
    const drop = element("dropCeiling", solved.edges[0].id, { offset: 1 });
    const regions = ceilingRegions([drop], solved, 2.7);
    // 壁側（下がる側）の区画は、その下がり天井の行へ高さを入れる
    const lowered = regions.filter((row) => row.elementIds.length > 0);
    expect(lowered).toHaveLength(1);
    expect(lowered[0].elementIds).toEqual([drop.id]);
    // 下がっていない側の区画にも、ふちの下がり天井が付く（そちらにも高さを入れられる）
    const other = regions.filter((row) => row.elementIds.length === 0);
    expect(other).toHaveLength(1);
    expect(other[0].boundaryIds).toEqual([drop.id]);
  });

  it("高さがまだのうちは下がり天井の線で区画を分ける", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [element("dropCeiling", solved.edges[0].id, { offset: 1 })],
      solved,
      2.7,
    );
    expect(regions.map((row) => row.code)).toEqual(["C1", "C2"]);
  });

  it("同じ高さ（下がり0）を入れると隣とひと続きになり、線も引かない", () => {
    const solved = shape();
    const same = element("dropCeiling", solved.edges[0].id, {
      offset: 1,
      height: 0,
    });
    const regions = ceilingRegions([same], solved, 2.7);
    expect(regions.map((row) => row.code)).toEqual(["C1"]);
    expect(regions[0].height).toBe(2.7);
    // 線は図に残す（天井を分けていない線として薄く出す）
    expect(ceilingLines([same], solved, 2.7).map((line) => line.same)).toEqual([
      true,
    ]);
  });

  it("下がる側を線の向こう側に入れ替えられる", () => {
    const solved = shape();
    const wall = solved.edges[0];
    const near = ceilingRegions(
      [element("dropCeiling", wall.id, { offset: 1, height: 0.3 })],
      solved,
      2.7,
    );
    // 壁側（4×1）が下がる
    expect(near.find((row) => row.drop === 0.3)?.area).toBeCloseTo(4, 6);
    const far = ceilingRegions(
      [
        element("dropCeiling", wall.id, {
          offset: 1,
          height: 0.3,
          inner: true,
        }),
      ],
      solved,
      2.7,
    );
    // 線の向こう側（4×2）が下がる
    expect(far.find((row) => row.drop === 0.3)?.area).toBeCloseTo(8, 6);
  });

  it("梁型の線で下がり天井が短く切れていても、区画は壁まででで分ける", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [
        element("dropCeiling", solved.edges[0].id, { offset: 1, height: 0.3 }),
        // 下がり天井より低い壁付き梁型（下がり天井の線はこの線で切れる）
        element("wallBeam", solved.edges[1].id, { width: 0.2, height: 0.5 }),
      ],
      solved,
      2.7,
    );
    expect(regions.map((row) => row.code)).toEqual(["C1", "C2"]);
    // 梁底（3.00×0.20）を引いた面積
    expect(regions.reduce((sum, row) => sum + row.area, 0)).toBeCloseTo(
      11.4,
      6,
    );
  });

  it("天井面積（CA）は梁型の梁底の分を引く", () => {
    const solved = shape();
    const beams = [
      element("wallBeam", solved.edges[0].id, { width: 0.2, height: 0.4 }),
      element("ceilingBeam", solved.edges[1].id, { offset: 1, width: 0.3 }),
    ];
    // 引くのは梁底だけ（壁付き4.00×0.20＋天井付（壁付き梁型で止まって2.80）×0.30）
    const beamArea = beamFootprintArea(beams, solved, 2.7);
    expect(beamArea).toBeCloseTo(4 * 0.2 + 2.8 * 0.3, 6);
    const quantities = roomQuantities(solved, 2.7, [], undefined, beamArea);
    expect(quantities.floorArea).toBe(12);
    expect(quantities.ceilingArea).toBe(10.36);
  });

  it("番号は区画の中（外まわりの線から離れたところ）に出す", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [element("dropCeiling", solved.edges[0].id, { offset: 1, height: 0.3 })],
      solved,
      2.7,
    );
    const wide = regions.find((row) => row.drop === 0);
    expect(wide?.center.y).toBeGreaterThan(1);
    expect(wide?.center.y).toBeLessThan(3);
    expect(wide?.center.x).toBeGreaterThan(0.5);
    expect(wide?.center.x).toBeLessThan(3.5);
  });
});

describe("天井の区画は高さの種類ごとにまとめる", () => {
  it("離れていても同じ高さなら1つの番号にし、番号は離れた所にも出す", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [
        element("dropCeiling", solved.edges[0].id, { offset: 1, height: 0.3 }),
        element("dropCeiling", solved.edges[2].id, { offset: 1, height: 0.3 }),
      ],
      solved,
      2.7,
      true,
    );

    // 高さは2種類（2.40の下がり天井と2.70の天井）＝2行
    expect(regions.map((row) => row.code)).toEqual(["C1", "C2"]);
    const dropped = regions.find((row) => row.height === 2.4);
    expect(dropped?.parts).toHaveLength(2);
    // 離れている2か所それぞれに番号を出す
    expect(dropped?.centers).toHaveLength(2);
    expect(dropped?.area).toBeCloseTo(8, 6);
    expect(regions.find((row) => row.height === 2.7)?.centers).toHaveLength(1);
  });

  it("まとめないときは、離れた同じ高さの区画は別の番号にする", () => {
    const solved = shape();
    const regions = ceilingRegions(
      [
        element("dropCeiling", solved.edges[0].id, { offset: 1, height: 0.3 }),
        element("dropCeiling", solved.edges[2].id, { offset: 1, height: 0.3 }),
      ],
      solved,
      2.7,
    );

    expect(regions.map((row) => row.code)).toEqual(["C1", "C2", "C3"]);
  });
});
