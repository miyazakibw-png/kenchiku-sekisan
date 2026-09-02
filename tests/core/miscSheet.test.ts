import { describe, expect, it } from "vitest";
import {
  cellValue,
  columnTotal,
  entriesFromMiscSheet,
  isEmptyColumn,
  miscColumn,
  miscRow,
  syncRowsFromEstimate,
  type MiscEstimateRow,
} from "../../src/core/misc/miscSheet";

function estimateRow(patch: Partial<MiscEstimateRow>): MiscEstimateRow {
  return {
    id: 1,
    rowType: "room",
    part1: "",
    part2: "",
    part2Split: 0,
    formwork: "",
    part3: "",
    multiplier: 1,
    ...patch,
  };
}

describe("部位別雑・金物入力表", () => {
  it("数量は数字でも計算式でも入れられる", () => {
    expect(cellValue("3")).toBe(3);
    expect(cellValue("2*3+1")).toBe(7);
    expect(cellValue("")).toBeNull();
    expect(cellValue("あ")).toBeNull();
  });

  it("明細（列）ごとの合計は倍率をかけて足す", () => {
    const column = miscColumn({ name: "消火器" });
    const rows = [
      miscRow({ part3: "事務室", values: { [column.id]: "2" } }),
      miscRow({ part3: "廊下", multiplier: 2, values: { [column.id]: "1+2" } }),
    ];
    expect(columnTotal({ columns: [column], rows }, column.id)).toBe(8);
  });

  it("部位別入力表から部屋を出す（入れてある数量は残す・小計行は出さない）", () => {
    const column = miscColumn({ name: "消火器" });
    const kept = miscRow({
      estimateRowId: 2,
      part3: "古い名前",
      values: { [column.id]: "5" },
    });
    const synced = syncRowsFromEstimate(
      [kept],
      [
        estimateRow({ id: 1, part1: "本館", part2: "1階", part3: "事務室" }),
        estimateRow({ id: 9, rowType: "subtotal", part3: "小計" }),
        estimateRow({ id: 2, part3: "廊下", multiplier: 2 }),
      ],
    );
    expect(synced.map((row) => row.part3)).toEqual(["事務室", "廊下"]);
    // 部位Ⅰ・部位Ⅱは空欄なら上の行から引き継ぐ
    expect(synced[1].part1).toBe("本館");
    expect(synced[1].part2).toBe("1階");
    expect(synced[1].values[column.id]).toBe("5");
    expect(synced[1].multiplier).toBe(2);
  });

  it("集計詳細は1マス1件で作る（空の明細・空のマスは作らない）", () => {
    const column = miscColumn({
      name: "消火器",
      unit: "個",
      subjectId: 20,
      detailNumber: 12.5,
    });
    const empty = miscColumn();
    expect(isEmptyColumn(empty)).toBe(true);
    const rows = [
      miscRow({
        estimateRowId: 1,
        part1: "本館",
        part2: "1階",
        part3: "事務室",
        values: { [column.id]: "2", [empty.id]: "3" },
      }),
      miscRow({ part3: "廊下", multiplier: 2, values: { [column.id]: "" } }),
    ];
    const entries = entriesFromMiscSheet(
      { columns: [column, empty], rows },
      new Map([["1階", 0]]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceKind).toBe("misc");
    expect(entries[0].estimateRowId).toBe(1);
    expect(entries[0].part3).toBe("事務室");
    expect(entries[0].name).toBe("消火器");
    expect(entries[0].quantity).toBe(2);
  });

  it("倍率は計上数量にかける", () => {
    const column = miscColumn({ name: "消火器" });
    const entries = entriesFromMiscSheet(
      {
        columns: [column],
        rows: [
          miscRow({
            part3: "廊下",
            multiplier: 3,
            values: { [column.id]: "2" },
          }),
        ],
      },
      new Map(),
    );
    expect(entries[0].setTotal).toBe(2);
    expect(entries[0].quantity).toBe(6);
  });
});
