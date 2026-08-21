import { describe, expect, it } from "vitest";
import {
  aggregateByRoom,
  aggregateItems,
  checkQuantityUnit,
  entriesFromCalcSheet,
  masterKeyOf,
  traceRoomName,
  type AggregateEntry,
  type EstimateRowContext,
} from "../../src/core/aggregate/aggregate";
import type { CalcSet, CalcSheetResult } from "../../src/core/room/calcSheet";

function context(over: Partial<EstimateRowContext> = {}): EstimateRowContext {
  return {
    estimateRowId: 1,
    part1: "建築",
    part2: "1階",
    part2Split: true,
    part2Order: 0,
    part3: "事務室",
    formwork: "",
    multiplier: 1,
    sourceKind: "room",
    ...over,
  };
}

function set(id: string, coefficient: number): CalcSet {
  return {
    id,
    partNumber: 10,
    partName: "床",
    details: [
      {
        id: `${id}-d1`,
        sourceDetailId: null,
        subjectId: 5,
        detailNumber: 1.01,
        materialCategory: "仕上",
        partName: "",
        name: "ビニル床シート",
        descriptionUpper: "",
        descriptionLower: "t=2.0",
        unit: "m2",
        remarksUpper: "",
        remarksLower: "",
        estimateDisplay: "",
        coefficient,
      },
    ],
    lines: [],
  };
}

function result(id: string, total: number): CalcSheetResult {
  return {
    setTotals: new Map([[id, total]]),
    lineValues: new Map(),
    errors: [],
  } as unknown as CalcSheetResult;
}

describe("集計処理", () => {
  it("計上数量はセット累計×明細の掛け率×部位別入力表の倍率", () => {
    const entries = entriesFromCalcSheet(
      context({ multiplier: 2 }),
      [set("s1", 1.05)],
      result("s1", 10),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].setTotal).toBe(10);
    expect(entries[0].coefficient).toBe(1.05);
    expect(entries[0].multiplier).toBe(2);
    expect(entries[0].quantity).toBe(21);
  });

  it("部位名は明細に無ければセットの部位名を使う", () => {
    const entries = entriesFromCalcSheet(context(), [set("s1", 1)], result("s1", 3));
    expect(entries[0].partName).toBe("床");
    expect(entries[0].partNumber).toBe(10);
  });

  it("仕分け✔なしのときは部位Ⅱを集計キーに使わない", () => {
    const on = entriesFromCalcSheet(context(), [set("s1", 1)], result("s1", 1));
    const off = entriesFromCalcSheet(
      context({ part2Split: false }),
      [set("s1", 1)],
      result("s1", 1),
    );
    expect(on[0].part2).toBe("1階");
    expect(off[0].part2).toBe("");
    // 表示・根拠用の部位Ⅱは仕分けの有無に関わらず残す
    expect(off[0].part2Raw).toBe("1階");
    expect(masterKeyOf(on[0])).not.toBe(masterKeyOf(off[0]));
  });

  it("同じ明細は数量を足し、部屋別の根拠を残す", () => {
    const a = entriesFromCalcSheet(
      context({ estimateRowId: 1, part3: "事務室" }),
      [set("s1", 1)],
      result("s1", 10),
    );
    const b = entriesFromCalcSheet(
      context({ estimateRowId: 2, part3: "会議室" }),
      [set("s2", 1)],
      result("s2", 5.5),
    );
    const items = aggregateItems([...a, ...b]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(15.5);
    expect(items[0].rooms).toEqual([
      { roomName: "1階：事務室", quantity: 10 },
      { roomName: "1階：会議室", quantity: 5.5 },
    ]);
    expect(items[0].traceIds).toHaveLength(2);
  });

  it("科目の「部位Ⅱ分不要」があれば部位Ⅱでは分けない", () => {
    const a = entriesFromCalcSheet(
      context({ part2: "1階", part2Order: 0 }),
      [set("s1", 1)],
      result("s1", 10),
    );
    const b = entriesFromCalcSheet(
      context({ part2: "2階", part2Order: 1 }),
      [set("s2", 1)],
      result("s2", 4),
    );
    const split = aggregateItems([...a, ...b]);
    expect(split).toHaveLength(2);
    const merged = aggregateItems([...a, ...b], new Set([5]));
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(14);
  });

  it("転記入力表の分は集計書に計上するが根拠集計には出さない", () => {
    const room = entriesFromCalcSheet(context(), [set("s1", 1)], result("s1", 10));
    const transfer: AggregateEntry = {
      ...room[0],
      traceId: "t:1",
      sourceKind: "transfer",
      estimateRowId: null,
      transferRowId: 1,
      quantity: 3,
      setTotal: 3,
    };
    const items = aggregateItems([...room, transfer]);
    expect(items[0].quantity).toBe(13);
    expect(items[0].rooms).toEqual([{ roomName: "1階：事務室", quantity: 10 }]);
  });

  it("並びは科目ID→部位Ⅰ→部位Ⅱの入力順→部位ID→明細ID", () => {
    const later = entriesFromCalcSheet(
      context({ part2: "2階", part2Order: 1 }),
      [set("s1", 1)],
      result("s1", 1),
    );
    const earlier = entriesFromCalcSheet(
      context({ part2: "1階", part2Order: 0 }),
      [set("s2", 1)],
      result("s2", 1),
    );
    const items = aggregateItems([...later, ...earlier]);
    expect(items.map((item) => item.part2)).toEqual(["1階", "2階"]);
  });

  it("倍率が1でなければ根拠の部屋名に「× 2」を付ける", () => {
    const entries = entriesFromCalcSheet(
      context({ multiplier: 2 }),
      [set("s1", 1)],
      result("s1", 1),
    );
    expect(traceRoomName(entries[0])).toBe("1階：事務室 × 2");
  });
});

describe("部屋別集計", () => {
  it("部位Ⅲごとにまとめ、部位別入力表の入力順に並べる", () => {
    const a = entriesFromCalcSheet(
      context({ estimateRowId: 1, part3: "会議室" }),
      [set("s1", 1)],
      result("s1", 4),
    );
    const b = entriesFromCalcSheet(
      context({ estimateRowId: 2, part3: "事務室" }),
      [set("s2", 1)],
      result("s2", 10),
    );
    const c = entriesFromCalcSheet(
      context({ estimateRowId: 3, part3: "事務室" }),
      [set("s3", 1)],
      result("s3", 2.5),
    );
    const groups = aggregateByRoom(
      [...a, ...b, ...c],
      ["事務室", "会議室"],
    );
    expect(groups.map((group) => group.roomName)).toEqual([
      "事務室",
      "会議室",
    ]);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].quantity).toBe(12.5);
    expect(groups[0].quantityTotal).toBe(12.5);
  });

  it("転記入力表の分と部屋名が空の分は出さない", () => {
    const room = entriesFromCalcSheet(context(), [set("s1", 1)], result("s1", 10));
    const transfer: AggregateEntry = {
      ...room[0],
      traceId: "t:1",
      sourceKind: "transfer",
      part3: "事務室",
      quantity: 3,
    };
    const noRoom: AggregateEntry = { ...room[0], traceId: "x:1", part3: "" };
    const groups = aggregateByRoom([...room, transfer, noRoom]);
    expect(groups).toHaveLength(1);
    expect(groups[0].quantityTotal).toBe(10);
  });
});

describe("数量・単位チェック", () => {
  it("単位ありで数量なし・0以下は赤", () => {
    expect(checkQuantityUnit(null, "m2")).toBe("error");
    expect(checkQuantityUnit(0, "m2")).toBe("error");
    expect(checkQuantityUnit(-1, "m2")).toBe("error");
    expect(checkQuantityUnit(1.25, "m2")).toBe("");
  });

  it("ヶ所・本・台などは小数だと赤", () => {
    expect(checkQuantityUnit(1.5, "か所")).toBe("error");
    expect(checkQuantityUnit(2, "ヶ所")).toBe("");
    expect(checkQuantityUnit(3, "本")).toBe("");
    expect(checkQuantityUnit(0.5, "台")).toBe("error");
  });

  it("単位「式」は1以外だと赤", () => {
    expect(checkQuantityUnit(1, "式")).toBe("");
    expect(checkQuantityUnit(2, "式")).toBe("error");
  });

  it("数量ありで単位なしは黄、数量0・空欄は警告なし", () => {
    expect(checkQuantityUnit(3, "")).toBe("warn");
    expect(checkQuantityUnit(0, "")).toBe("");
    expect(checkQuantityUnit(null, "")).toBe("");
  });
});
