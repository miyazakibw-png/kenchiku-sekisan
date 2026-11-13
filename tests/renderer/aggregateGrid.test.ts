import { describe, expect, it } from "vitest";
import type {
  AggregateItem,
  AggregateItemEdit,
  Subject,
} from "../../src/shared/types";
import {
  aggregateRangeTsv,
  buildAggregateGrid,
  itemsInGridRange,
  type AggregateGridLine,
} from "../../src/renderer/src/features/aggregate/aggregateGrid";

function item(overrides: Partial<AggregateItem> = {}): AggregateItem {
  return {
    id: 1,
    runId: 1,
    displayOrder: 1,
    masterKey: "item-1",
    part1: "部位Ⅰ",
    part2: "部位Ⅱ",
    part2Raw: "部位Ⅱ",
    subjectId: 10,
    materialCategory: "材種",
    partNumber: 20,
    partName: "部位名",
    detailNumber: 30,
    name: "名称",
    descriptionUpper: "摘要上",
    descriptionLower: "摘要下",
    unit: "m",
    remarksUpper: "備考上",
    remarksLower: "備考下",
    estimateDisplay: "積算用表示",
    formwork: "",
    unused: false,
    manual: false,
    note: false,
    quantity: 12,
    rooms: [],
    ...overrides,
  };
}

const subjects: Subject[] = [
  {
    id: 10,
    code: "10",
    name: "工種科目",
    displayOrder: 1,
    skipPart2: 0,
    aggregateOrder: 1,
    note: "",
    spare1: "",
    spare2: "",
  },
];

describe("集計書グリッドの表示文字", () => {
  it("見出し1行と明細2行を10列に展開し、rowSpan値は上段だけに置く", () => {
    const lines: AggregateGridLine[] = [
      {
        kind: "heading",
        heading: { kind: "subject", subjectId: 10, text: "工種科目" },
      },
      { kind: "item", item: item() },
      {
        kind: "item",
        item: item({ id: 2, masterKey: "item-2", partName: "別の部位" }),
      },
    ];

    const grid = buildAggregateGrid(lines, {}, subjects);

    expect(grid).toHaveLength(5);
    expect(grid.every((row) => row.length === 10)).toBe(true);
    expect(grid[0]).toEqual(["10", "工種科目", "", "", "", "", "", "", "", ""]);
    expect(grid[1]).toEqual([
      "10",
      "10 工種科目",
      "材種",
      "20",
      "部位名",
      "摘要上",
      "",
      "",
      "備考上",
      "積算用表示",
    ]);
    expect(grid[2].slice(0, 3)).toEqual(["", "", ""]);
    expect(grid[2][9]).toBe("");
    expect(grid[3][4]).toBe("別の部位");
  });

  it("編集値を表示に反映し、手入力明細は編集数量を文字列にする", () => {
    const manual = item({
      id: 2,
      masterKey: "manual",
      manual: true,
      quantity: 3,
    });
    const edit: AggregateItemEdit = {
      masterKey: "manual",
      subjectId: 10,
      materialCategory: "更新材種",
      partNumber: 99,
      partName: "更新部位",
      detailNumber: 88,
      name: "更新名称",
      descriptionUpper: "更新摘要上",
      descriptionLower: "更新摘要下",
      unit: "個",
      remarksUpper: "更新備考上",
      remarksLower: "更新備考下",
      estimateDisplay: "更新表示",
      quantity: 7.5,
    };

    const grid = buildAggregateGrid(
      [{ kind: "item", item: manual }],
      { manual: edit },
      subjects,
    );

    expect(grid[0]).toEqual([
      "10",
      "10 工種科目",
      "更新材種",
      "99",
      "更新部位",
      "更新摘要上",
      "",
      "",
      "更新備考上",
      "更新表示",
    ]);
    expect(grid[1]).toEqual([
      "",
      "",
      "",
      "88",
      "更新名称",
      "更新摘要下",
      "7.5",
      "個",
      "更新備考下",
      "",
    ]);
  });

  it("非手入力の数量は集計書と同じ数量表示を使う", () => {
    const grid = buildAggregateGrid(
      [{ kind: "item", item: item({ quantity: 12, unit: "m" }) }],
      {},
      subjects,
    );
    expect(grid[1][6]).toBe("12.00");
  });
});

describe("集計書の範囲コピー", () => {
  it("ドラッグ方向が逆でも範囲を正規化してTSV化する", () => {
    const grid = [
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "i"],
    ];
    expect(
      aggregateRangeTsv(grid, {
        anchor: { row: 2, col: 2 },
        end: { row: 0, col: 1 },
      }),
    ).toBe("b\tc\r\ne\tf\r\nh\ti");
  });

  it("タブ・改行・引用符を含むセルをExcel向けに引用する", () => {
    expect(
      aggregateRangeTsv(
        [["仕様\t行\n次行 \"A\"", "質疑"]],
        {
          anchor: { row: 0, col: 0 },
          end: { row: 0, col: 1 },
        },
      ),
    ).toBe('"仕様\t行\n次行 ""A"""\t質疑');
  });
});

describe("集計書の範囲科目変更", () => {
  const lines: AggregateGridLine[] = [
    {
      kind: "heading",
      heading: { kind: "subject", subjectId: 10, text: "工種科目" },
    },
    { kind: "item", item: item() },
    {
      kind: "heading",
      heading: { kind: "part1", subjectId: null, text: "（別の部位）" },
    },
    {
      kind: "item",
      item: item({ id: 2, masterKey: "item-2", partName: "別の部位" }),
    },
  ];

  it("下段だけに触れる範囲でもその明細を含める", () => {
    expect(
      itemsInGridRange(lines, {
        anchor: { row: 2, col: 4 },
        end: { row: 2, col: 4 },
      }).map((row) => row.masterKey),
    ).toEqual(["item-1"]);
  });

  it("見出しだけの範囲では明細を返さない", () => {
    expect(
      itemsInGridRange(lines, {
        anchor: { row: 0, col: 0 },
        end: { row: 0, col: 9 },
      }),
    ).toEqual([]);
  });

  it("逆向きの範囲でも画面上の順に明細を1回ずつ返す", () => {
    expect(
      itemsInGridRange(lines, {
        anchor: { row: 4, col: 8 },
        end: { row: 1, col: 4 },
      }).map((row) => row.masterKey),
    ).toEqual(["item-1", "item-2"]);
  });
});
