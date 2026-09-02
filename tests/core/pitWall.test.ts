import { describe, expect, it } from "vitest";
import {
  defaultPitSleeveKinds,
  groupLengthMm,
  pitSleeveLength,
  pitSleeveTable,
  pitWallLength,
  pitWallTallies,
  pitWallTable,
  pitWallVariables,
  pitGapLink,
  layoutPits,
  normalizeRects,
  type PitSleeve,
  type PitShape,
  type PitWall,
} from "../../src/core/pit/pit";

function wall(
  id: string,
  length: number,
  width: number,
  color = "#000000",
): PitWall {
  return { id, x1: 0, y1: 0, x2: length, y2: 0, width, color };
}

function sleeve(
  id: string,
  wallId: string,
  kindId: string,
  length: number | null,
): PitSleeve {
  return { id, wallId, kindId, position: 0.5, length };
}

describe("ピット間（基礎梁）と人通口・スリーブ", () => {
  it("ピット間の長さは始点と終点から出す", () => {
    expect(
      pitWallLength({
        id: "w1",
        x1: 0,
        y1: 0,
        x2: 3,
        y2: 4,
        width: 0.5,
        color: "#000000",
      }),
    ).toBe(5);
  });

  it("長さは50mmごとにまとめる", () => {
    expect(groupLengthMm(374)).toBe(350);
    expect(groupLengthMm(375)).toBe(400);
    expect(groupLengthMm(412)).toBe(400);
    expect(groupLengthMm(500)).toBe(500);
  });

  it("長さ別に本数と合計長さを数える（図の太さは集計に関係しない）", () => {
    const walls = [
      wall("w1", 3.02, 0.5),
      wall("w2", 3.0, 0.2),
      wall("w3", 2.0, 0.2),
    ];
    const tallies = pitWallTallies(walls);
    expect(tallies).toEqual([
      { lengthMm: 2000, count: 1, total: 2 },
      { lengthMm: 3000, count: 2, total: 6.02 },
    ]);
  });

  it("スリーブの長さは手入力が無ければピット間の長さ（mm）", () => {
    const walls = [wall("w1", 0.42, 0.5)];
    expect(pitSleeveLength(sleeve("v1", "w1", "s1", 450), walls)).toBe(450);
    expect(pitSleeveLength(sleeve("v2", "w1", "s1", null), walls)).toBe(420);
  });

  it("種類別×長さ別の個数表を作る", () => {
    const walls = [wall("w1", 0.5, 0.5), wall("w2", 0.35, 0.2)];
    const kinds = defaultPitSleeveKinds();
    const sleeves = [
      sleeve("v1", "w1", "s1", null),
      sleeve("v2", "w1", "s1", 480),
      sleeve("v3", "w2", "s2", null),
    ];
    const table = pitSleeveTable(sleeves, walls, kinds);
    expect(table.lengths).toEqual([350, 500]);
    expect(table.rows[0]).toEqual({ kindId: "s1", counts: [0, 2], total: 2 });
    expect(table.rows[1]).toEqual({ kindId: "s2", counts: [1, 0], total: 1 });
  });

  it("計算式に使う記号を作る", () => {
    const walls = [wall("w1", 2, 0.2), wall("w2", 3, 0.5)];
    const kinds = defaultPitSleeveKinds();
    const sleeves = [sleeve("v1", "w1", "s1", null)];
    const values = pitWallVariables(walls, sleeves, kinds);
    expect(values.MW).toBe(5);
    expect(values.MN).toBe(2);
    expect(values.MWL2000).toBe(2);
    expect(values.MNL3000).toBe(1);
    expect(values.MN1).toBe(2);
    expect(values.MN1L3000).toBe(1);
    expect(values.SV1).toBe(1);
    expect(values.SV1L2000).toBe(1);
  });

  it("ピット間をクリックすると、向かいのピット壁へ垂直につなぐ", () => {
    const pits: PitShape[] = [
      {
        id: "p1",
        symbol: "Ｐ1",
        x: 4,
        y: 3,
        depth: 1,
        direction: "right",
        gap: 0,
      },
      {
        id: "p2",
        symbol: "Ｐ2",
        x: 4,
        y: 3,
        depth: 1,
        direction: "right",
        gap: 0.4,
      },
    ];
    const plan = normalizeRects(layoutPits(pits));
    const link = pitGapLink(plan.rects, pits, { x: 4.2, y: 1.5 });
    expect(link).not.toBeNull();
    expect(link?.from).toEqual({ x: 4, y: 1.5 });
    expect(link?.to).toEqual({ x: 4.4, y: 1.5 });
  });
});

describe("ピット間の表（種類＝線色＋A・B別×長さ別の本数）", () => {
  it("線色と図の太さごとに長さ別の本数を数える", () => {
    const red = "#dc2626";
    const blue = "#2563eb";
    const walls = [
      wall("w1", 0.5, 0.5, red),
      wall("w2", 0.48, 0.5, red),
      wall("w3", 0.35, 0.2, blue),
    ];
    const table = pitWallTable(walls);
    expect(table.lengths).toEqual([350, 500]);
    expect(table.rows).toEqual([
      { color: red, counts: [0, 2], total: 2 },
      { color: blue, counts: [1, 0], total: 1 },
    ]);
  });
});
