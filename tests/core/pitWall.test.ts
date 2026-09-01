import { describe, expect, it } from "vitest";
import {
  defaultPitSleeveKinds,
  groupLengthMm,
  pitSleeveLength,
  pitSleeveTable,
  pitWallLength,
  pitWallTallies,
  pitWallVariables,
  type PitSleeve,
  type PitWall,
} from "../../src/core/pit/pit";

function wall(id: string, length: number, width: number): PitWall {
  return {
    id,
    x1: 0,
    y1: 0,
    x2: length,
    y2: 0,
    width,
    color: "#000000",
  };
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

  it("幅別・長さ別に本数と合計長さを数える", () => {
    const walls = [
      wall("w1", 3.02, 0.5),
      wall("w2", 3.0, 0.5),
      wall("w3", 2.0, 0.2),
    ];
    const tallies = pitWallTallies(walls);
    expect(tallies).toEqual([
      { width: 0.5, lengthMm: 3000, count: 2, total: 6.02 },
      { width: 0.2, lengthMm: 2000, count: 1, total: 2 },
    ]);
  });

  it("スリーブの長さは手入力・種類の長さ・ピット間の幅の順で決める", () => {
    const walls = [wall("w1", 3, 0.5)];
    const kinds = defaultPitSleeveKinds();
    const withKindLength = kinds.map((kind) =>
      kind.id === "s2" ? { ...kind, length: 400 } : kind,
    );
    expect(pitSleeveLength(sleeve("v1", "w1", "s1", 450), walls, kinds)).toBe(
      450,
    );
    expect(
      pitSleeveLength(sleeve("v2", "w1", "s2", null), walls, withKindLength),
    ).toBe(400);
    expect(pitSleeveLength(sleeve("v3", "w1", "s1", null), walls, kinds)).toBe(
      500,
    );
  });

  it("種類別×長さ別の個数表を作る", () => {
    const walls = [wall("w1", 3, 0.5), wall("w2", 3, 0.2)];
    const kinds = defaultPitSleeveKinds();
    const sleeves = [
      sleeve("v1", "w1", "s1", null),
      sleeve("v2", "w1", "s1", 480),
      sleeve("v3", "w2", "s2", 350),
    ];
    const table = pitSleeveTable(sleeves, walls, kinds);
    expect(table.lengths).toEqual([350, 500]);
    expect(table.rows[0]).toEqual({ kindId: "s1", counts: [0, 2], total: 2 });
    expect(table.rows[1]).toEqual({ kindId: "s2", counts: [1, 0], total: 1 });
  });

  it("計算式に使う記号を作る", () => {
    const walls = [wall("w1", 3, 0.5), wall("w2", 2, 0.2)];
    const kinds = defaultPitSleeveKinds();
    const sleeves = [sleeve("v1", "w1", "s1", null)];
    const values = pitWallVariables(walls, sleeves, kinds);
    expect(values.MW).toBe(5);
    expect(values.MN).toBe(2);
    expect(values.MW1).toBe(3);
    expect(values.MN2).toBe(1);
    expect(values.SV1).toBe(1);
    expect(values.SV1L500).toBe(1);
  });
});
