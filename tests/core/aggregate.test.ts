import { describe, expect, it } from "vitest";
import {
  aggregateByPart,
  aggregateByRoom,
  aggregateItems,
  NO_PART_LABEL,
  aggregateQuantityText,
  checkQuantityUnit,
  entriesFromCalcSheet,
  masterKeyOf,
  traceRoomName,
  type AggregateEntry,
  type EstimateRowContext,
} from "../../src/core/aggregate/aggregate";
import {
  mergeManualItems,
  type ManualAggregateRow,
} from "../../src/core/aggregate/manualItems";
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
  it("説明行は数量0で集計へ入る（名称・摘要だけの行）", () => {
    const target = set("s1", 1);
    const note = {
      ...target.details[0],
      id: "s1-note",
      name: "内部 白塗装仕上 ※要メンテナンス",
      note: true,
    };
    target.details = [target.details[0], note];
    const entries = entriesFromCalcSheet(
      context(),
      [target],
      result("s1", 10),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].quantity).toBe(10);
    expect(entries[1].name).toBe("内部 白塗装仕上 ※要メンテナンス");
    expect(entries[1].quantity).toBe(0);
  });

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

  it("摘要の○○面・○○下は集計へ入る時に上下の行の積算用表示で置き換わる", () => {
    const target = set("s1", 1);
    const base = target.details[0];
    target.details = [
      {
        ...base,
        id: "s1-d0",
        name: "モルタル下地",
        estimateDisplay: "モルタル",
      },
      {
        ...base,
        id: "s1-d1",
        name: "磁器質タイル",
        descriptionLower: "t8 ○○下 ○○面",
        estimateDisplay: "タイル",
      },
      {
        ...base,
        id: "s1-d2",
        name: "目地",
        descriptionLower: "○○下 ○○面",
        estimateDisplay: "",
      },
    ];
    const entries = entriesFromCalcSheet(context(), [target], result("s1", 3));
    expect(entries.map((entry) => entry.descriptionLower)).toEqual([
      "t=2.0",
      "t8 モルタル下",
      "タイル下",
    ]);
  });

  it("部位名は明細に無ければセットの部位名を使う", () => {
    const entries = entriesFromCalcSheet(
      context(),
      [set("s1", 1)],
      result("s1", 3),
    );
    expect(entries[0].partName).toBe("床");
    expect(entries[0].partNumber).toBe(10);
  });

  it("明細に部位を入れてあればセットの部位へ読み替えない", () => {
    const target = set("s1", 1);
    target.details[0].partNumber = 110;
    target.details[0].partName = "";
    target.details.push({
      ...target.details[0],
      id: "s1-d2",
      partNumber: 40,
      partName: "柱型",
      name: "軽鉄下地",
    });
    const entries = entriesFromCalcSheet(context(), [target], result("s1", 3));
    expect(entries[0].partNumber).toBe(110);
    expect(entries[0].partName).toBe("");
    expect(entries[1].partNumber).toBe(40);
    expect(entries[1].partName).toBe("柱型");
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
    const room = entriesFromCalcSheet(
      context(),
      [set("s1", 1)],
      result("s1", 10),
    );
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

  it("家具計算書の分は集計書に計上するが根拠の部屋名は出さない", () => {
    const room = entriesFromCalcSheet(
      context(),
      [set("s1", 1)],
      result("s1", 10),
    );
    const furniture: AggregateEntry = {
      ...room[0],
      traceId: "furniture:3:r2",
      sourceKind: "furniture",
      estimateRowId: null,
      quantity: 4,
      setTotal: 4,
    };
    const items = aggregateItems([...room, furniture]);
    expect(items[0].quantity).toBe(14);
    expect(items[0].rooms).toEqual([{ roomName: "1階：事務室", quantity: 10 }]);
    expect(items[0].traceIds).toContain("furniture:3:r2");
  });

  it("部位Ⅰは部位別入力表の入力順。表に無い新しい部位Ⅰはその後ろ（出てきた順）", () => {
    const z = entriesFromCalcSheet(
      context({ estimateRowId: 1, part1: "Z床" }),
      [set("s1", 1)],
      result("s1", 1),
    );
    const a = entriesFromCalcSheet(
      context({ estimateRowId: 2, part1: "A天井" }),
      [set("s2", 1)],
      result("s2", 1),
    );
    // 部位別入力表に無い部位Ⅰ（建具明細作成表など）
    const newPart1: AggregateEntry = {
      ...z[0],
      traceId: "furniture:1:r1",
      sourceKind: "furniture",
      estimateRowId: null,
      part1: "A新設",
      setTotal: 1,
      quantity: 1,
    };
    const items = aggregateItems([...z, newPart1, ...a]);
    // 部位別入力表の部位Ⅰは入力行順（Z床→A天井）、新しい部位Ⅰは後ろ
    expect(items.map((item) => item.part1)).toEqual(["Z床", "A天井", "A新設"]);
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
    const groups = aggregateByRoom([...a, ...b, ...c], ["事務室", "会議室"]);
    expect(groups.map((group) => group.label)).toEqual(["事務室", "会議室"]);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].quantity).toBe(12.5);
    expect(groups[0].quantityTotal).toBe(12.5);
  });

  it("転記入力表の分と部屋名が空の分は出さない", () => {
    const room = entriesFromCalcSheet(
      context(),
      [set("s1", 1)],
      result("s1", 10),
    );
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

describe("部位別集計", () => {
  it("部位Ⅱごとにまとめ、同じ部位Ⅱの部屋はひとつにまとまる", () => {
    // 居室・押入れ・踏み込みは同じ部位Ⅱ「居室」
    const a = entriesFromCalcSheet(
      context({ part2: "居室", part3: "居室", part2Order: 1 }),
      [set("s1", 1)],
      result("s1", 4),
    );
    const b = entriesFromCalcSheet(
      context({ part2: "居室", part3: "押入れ", part2Order: 1 }),
      [set("s2", 1)],
      result("s2", 2.5),
    );
    const c = entriesFromCalcSheet(
      context({ part2: "玄関", part3: "玄関", part2Order: 0 }),
      [set("s3", 1)],
      result("s3", 3),
    );
    const groups = aggregateByPart([...a, ...b, ...c]);
    // 部位Ⅱの出た順（玄関→居室）で並ぶ
    expect(groups.map((group) => group.label)).toEqual(["玄関", "居室"]);
    expect(groups[1].items).toHaveLength(1);
    expect(groups[1].items[0].quantity).toBe(6.5);
    expect(groups[1].quantityTotal).toBe(6.5);
  });

  it("部位Ⅱが空の明細は最後にまとめ、転記入力表の分も部位Ⅱで入る", () => {
    const room = entriesFromCalcSheet(
      context({ part2: "居室", part3: "居室", part2Order: 1 }),
      [set("s1", 1)],
      result("s1", 10),
    );
    const transfer: AggregateEntry = {
      ...room[0],
      traceId: "t:1",
      sourceKind: "transfer",
      part2Raw: "玄関",
      part2Order: 0,
      quantity: 3,
    };
    const noPart: AggregateEntry = {
      ...room[0],
      traceId: "x:1",
      part2Raw: "",
      quantity: 5,
    };
    const groups = aggregateByPart([...room, transfer, noPart]);
    expect(groups.map((group) => group.label)).toEqual([
      "玄関",
      "居室",
      NO_PART_LABEL,
    ]);
    expect(groups[0].quantityTotal).toBe(3);
    expect(groups[1].quantityTotal).toBe(10);
    expect(groups[2].quantityTotal).toBe(5);
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

describe("集計書兼工事マスターの数量表示", () => {
  it("単位が無い数量0は何も書かない", () => {
    expect(aggregateQuantityText(0, "")).toBe("");
    expect(aggregateQuantityText(0, " ")).toBe("");
  });

  it("単位があるとき・数量があるときは今までどおり表示する", () => {
    expect(aggregateQuantityText(0, "m2")).toBe("0.00");
    expect(aggregateQuantityText(1.25, "")).toBe("1.25");
  });
});

describe("集計書の手入力行", () => {
  const manualRow = (
    over: Partial<ManualAggregateRow> = {},
  ): ManualAggregateRow => ({
    id: 1,
    afterMasterKey: "",
    before: false,
    subjectId: 5,
    materialCategory: "仕上",
    part1: "建築",
    part2: "1階",
    part2Raw: "1階",
    partNumber: null,
    partName: "",
    detailNumber: null,
    name: "説明行",
    descriptionUpper: "",
    descriptionLower: "",
    unit: "",
    remarksUpper: "",
    remarksLower: "",
    estimateDisplay: "",
    formwork: "",
    quantity: 0,
    ...over,
  });

  it("番号が空の手入力行は、付き先の部位番号・部位名・明細番号を見せる", () => {
    const anchor = aggregateItems(
      entriesFromCalcSheet(context(), [set("s1", 1)], result("s1", 2)),
    )[0];
    const merged = mergeManualItems(
      [anchor],
      [manualRow({ afterMasterKey: anchor.masterKey })],
      new Set(),
    );
    expect(merged).toHaveLength(2);
    expect(merged[1].partNumber).toBe(anchor.partNumber);
    expect(merged[1].partName).toBe(anchor.partName);
    expect(merged[1].detailNumber).toBe(anchor.detailNumber);
  });

  it("手で入れた番号は付き先で上書きしない", () => {
    const anchor = aggregateItems(
      entriesFromCalcSheet(context(), [set("s1", 1)], result("s1", 2)),
    )[0];
    const merged = mergeManualItems(
      [anchor],
      [
        manualRow({
          afterMasterKey: anchor.masterKey,
          partNumber: 99,
          partName: "柱型",
          detailNumber: 99.5,
        }),
      ],
      new Set(),
    );
    expect(merged[1].partNumber).toBe(99);
    expect(merged[1].partName).toBe("柱型");
    expect(merged[1].detailNumber).toBe(99.5);
  });

  it("部位Ⅰ・部位Ⅱ・科目・材種区分は付き先に揃える（見出しで分かれないように）", () => {
    const anchor = aggregateItems(
      entriesFromCalcSheet(context(), [set("s1", 1)], result("s1", 2)),
    )[0];
    const merged = mergeManualItems(
      [anchor],
      [manualRow({ afterMasterKey: anchor.masterKey })],
      new Set(),
    );
    expect(merged[1].subjectId).toBe(anchor.subjectId);
    expect(merged[1].materialCategory).toBe(anchor.materialCategory);
    expect(merged[1].part1).toBe(anchor.part1);
    expect(merged[1].part2).toBe(anchor.part2);
    expect(merged[1].part2Raw).toBe(anchor.part2Raw);
  });

  it("付き先が見つからない手入力行は、置いた場所の隣の明細の部位に揃える", () => {
    const anchor = aggregateItems(
      entriesFromCalcSheet(context(), [set("s1", 1)], result("s1", 2)),
    )[0];
    const merged = mergeManualItems(
      [anchor],
      [
        manualRow({
          afterMasterKey: "missing",
          subjectId: 999,
          part1: "別の部位",
          part2: "別の部位Ⅱ",
        }),
      ],
      new Set(),
    );
    // 付き先不明で末尾に置かれる → 隣の明細の部位に揃うので見出しで分かれない
    expect(merged).toHaveLength(2);
    expect(merged[1].subjectId).toBe(anchor.subjectId);
    expect(merged[1].part1).toBe(anchor.part1);
    expect(merged[1].part2).toBe(anchor.part2);
  });
});
