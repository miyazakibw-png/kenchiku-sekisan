import { describe, expect, it } from "vitest";
import type { AggregatedItem } from "../../src/core/aggregate/aggregate";
import {
  isManualMasterKey,
  manualIdOf,
  manualMasterKey,
  mergeManualItems,
  type ManualAggregateRow,
} from "../../src/core/aggregate/manualItems";

function item(masterKey: string, over: Partial<AggregatedItem> = {}): AggregatedItem {
  return {
    masterKey,
    part1: "1階",
    part2: "事務室",
    part2Raw: "事務室",
    part2Order: 0,
    subjectId: 1,
    materialCategory: "仕上",
    partNumber: 10,
    partName: "床",
    detailNumber: 1,
    name: "明細",
    descriptionUpper: "",
    descriptionLower: "",
    unit: "m2",
    remarksUpper: "",
    remarksLower: "",
    estimateDisplay: "",
    formwork: "",
    unused: false,
    quantity: 1,
    rooms: [],
    traceIds: [],
    ...over,
  };
}

function row(id: number, afterMasterKey: string, over: Partial<ManualAggregateRow> = {}): ManualAggregateRow {
  return {
    id,
    afterMasterKey,
    subjectId: 1,
    materialCategory: "仕上",
    part1: "1階",
    part2: "事務室",
    part2Raw: "事務室",
    partNumber: 10,
    partName: "床",
    detailNumber: 1,
    name: "手入力",
    descriptionUpper: "",
    descriptionLower: "説明文",
    unit: "",
    remarksUpper: "",
    remarksLower: "",
    estimateDisplay: "",
    formwork: "",
    quantity: 0,
    ...over,
  };
}

const keys = (items: AggregatedItem[]) => items.map((i) => i.masterKey);

describe("手入力の集計明細", () => {
  it("masterKey は manual:<id> で、計算書のキーと衝突しない", () => {
    expect(manualMasterKey(3)).toBe("manual:3");
    expect(isManualMasterKey("manual:3")).toBe(true);
    expect(isManualMasterKey("床|1|x")).toBe(false);
    expect(manualIdOf("manual:3")).toBe(3);
    expect(manualIdOf("床|1|x")).toBe(null);
  });

  it("アンカー行の直後に差し込む", () => {
    const merged = mergeManualItems(
      [item("a"), item("b"), item("c")],
      [row(1, "b")],
      new Set(),
    );
    expect(keys(merged)).toEqual(["a", "b", "manual:1", "c"]);
  });

  it("同じアンカーに2行挿入したら登録順に並ぶ", () => {
    const merged = mergeManualItems(
      [item("a")],
      [row(1, "a"), row(2, "a")],
      new Set(),
    );
    expect(keys(merged)).toEqual(["a", "manual:1", "manual:2"]);
  });

  it("手入力行をアンカーにして連続で挿入できる", () => {
    const merged = mergeManualItems(
      [item("a")],
      [row(1, "a"), row(2, "manual:1")],
      new Set(),
    );
    expect(keys(merged)).toEqual(["a", "manual:1", "manual:2"]);
  });

  it("アンカーが消えたら同じ 科目+部位Ⅰ+部位Ⅱ の最後に置く", () => {
    const merged = mergeManualItems(
      [
        item("a", { subjectId: 1, part1: "1階", part2: "事務室" }),
        item("b", { subjectId: 1, part1: "1階", part2: "事務室" }),
        item("c", { subjectId: 1, part1: "1階", part2: "会議室" }),
        item("d", { subjectId: 2, part1: "1階", part2: "事務室" }),
      ],
      [row(1, "gone")],
      new Set(),
    );
    expect(keys(merged)).toEqual(["a", "b", "manual:1", "c", "d"]);
  });

  it("同じ部位が無ければ同じ科目の最後、それも無ければ全体の最後", () => {
    const merged = mergeManualItems(
      [
        item("a", { subjectId: 1, part1: "1階", part2: "事務室" }),
        item("b", { subjectId: 2, part1: "1階", part2: "事務室" }),
        item("c", { subjectId: 1, part1: "2階", part2: "廊下" }),
      ],
      [row(1, "gone", { part1: "9階", part2: "無し" }), row(2, "gone", { subjectId: 9 })],
      new Set(),
    );
    // row1: subjectId=1・部位違い → 科目1の最後（cの後）。row2: subjectId=9 無し → 最後
    expect(keys(merged)).toEqual(["a", "b", "c", "manual:1", "manual:2"]);
  });

  it("手入力行は集計値・根拠を持たない（数量は登録値、根拠は空）", () => {
    const merged = mergeManualItems(
      [item("a")],
      [row(1, "a", { quantity: 2.5 })],
      new Set(),
    );
    const manual = merged[1];
    expect(manual.quantity).toBe(2.5);
    expect(manual.rooms).toEqual([]);
    expect(manual.traceIds).toEqual([]);
  });

  it("不要の印は masterKey で覚えるので手入力行にも付く", () => {
    const merged = mergeManualItems(
      [item("a")],
      [row(1, "a")],
      new Set(["manual:1"]),
    );
    expect(merged[1].unused).toBe(true);
  });
});
