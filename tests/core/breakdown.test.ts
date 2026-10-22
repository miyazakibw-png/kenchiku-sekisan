import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_LAYOUT,
  DEFAULT_BREAKDOWN_SETTINGS,
  NAME_PATTERN,
  applyReplacements,
  buildBreakdownRows,
  buildGroupedBreakdownRows,
  collectSubjectOrder,
  collectUnits,
  mergeSubjectOrder,
  relayoutBreakdownRows,
  roundQuantity,
  splitDescription,
  textWidth,
  toFullWidth,
  toHalfWidth,
  unwrapBreakdownRows,
  withSubjectSubtotals,
} from "../../src/core/breakdown/breakdown";
import { toBcsCsv } from "../../src/core/breakdown/bcs";
import { compareBreakdown, moveRow } from "../../src/core/breakdown/compare";
import {
  compareBlocksBySubject,
  toCompareBlocks,
} from "../../src/core/breakdown/compareBlocks";
import {
  splitBySubject,
  toSpreadsheetSheets,
  toSpreadsheetWorkbook,
} from "../../src/core/breakdown/spreadsheet";
import type { BreakdownSourceItem } from "../../src/core/breakdown/breakdown";

const subjects = [
  { id: 1, name: "コンクリート工事", displayOrder: 1 },
  { id: 2, name: "型枠工事", displayOrder: 2 },
];

function item(patch: Partial<BreakdownSourceItem>): BreakdownSourceItem {
  return {
    id: 1,
    masterKey: "k1",
    subjectId: 1,
    part1: "",
    partNumber: null,
    partName: "基礎",
    name: "普通コンクリート",
    descriptionUpper: "FC21*18",
    descriptionLower: "呼び強度21",
    quantity: 12.345,
    unit: "m3",
    remarksUpper: "上段備考",
    remarksLower: "下段備考",
    ...patch,
  };
}

describe("摘要の文字幅と折り返し", () => {
  it("全角・半角・半角カナを文字幅に換算する", () => {
    expect(textWidth("A1ｶ")).toBe(3);
    expect(textWidth("床・壁")).toBe(6);
    expect(textWidth("😀")).toBe(2);
  });

  it("幅内の最後の半角・全角スペースで分割し、接着文字を保持する", () => {
    expect(splitDescription("ABC DE FG", 6)).toEqual([
      { text: "ABC DE", glue: "" },
      { text: "FG", glue: " " },
    ]);
    expect(splitDescription("ABC　DEF", 3)).toEqual([
      { text: "ABC", glue: "" },
      { text: "DEF", glue: "　" },
    ]);
  });

  it("スペースが無ければ幅位置で分割し、収まる文字列や幅0はそのまま返す", () => {
    expect(splitDescription("ABCDE", 2)).toEqual([
      { text: "AB", glue: "" },
      { text: "CD", glue: "" },
      { text: "E", glue: "" },
    ]);
    expect(splitDescription("床A", 4)).toEqual([{ text: "床A", glue: "" }]);
    expect(splitDescription("ABCDE", 0)).toEqual([
      { text: "ABCDE", glue: "" },
    ]);
  });

  it("上段と下段が幅内なら元の2行のまま返す", () => {
    const rows = buildBreakdownRows(
      [item({ descriptionUpper: "AB", descriptionLower: "CD" })],
      subjects,
      {
        ...DEFAULT_BREAKDOWN_SETTINGS,
        layout: BREAKDOWN_LAYOUT.twoRow,
        descriptionWidth: 2,
      },
    );
    expect(rows.slice(1).map((row) => row.descriptionLower)).toEqual([
      "AB",
      "CD",
    ]);
    expect(rows.some((row) => row.wrap !== undefined && row.wrap !== "")).toBe(
      false,
    );
  });

  it("上段が折り返されると数量行の後へ上段を移す", () => {
    const rows = buildBreakdownRows(
      [item({ descriptionUpper: "ABCD", descriptionLower: "X" })],
      subjects,
      {
        ...DEFAULT_BREAKDOWN_SETTINGS,
        layout: BREAKDOWN_LAYOUT.twoRow,
        descriptionWidth: 2,
      },
    );
    expect(
      rows.slice(1).map((row) => [row.rowKind, row.descriptionLower]),
    ).toEqual([
      ["note", ""],
      ["detail", "X"],
      ["note", "AB"],
      ["detail", "CD"],
    ]);
    expect(rows.slice(3).map((row) => row.wrap)).toEqual(["upper", "upper"]);
  });

  it("下段が折り返されると数量行に先頭を残し、奇数行をfillで補う", () => {
    const rows = buildBreakdownRows(
      [item({ descriptionUpper: "X", descriptionLower: "ABCDE" })],
      subjects,
      {
        ...DEFAULT_BREAKDOWN_SETTINGS,
        layout: BREAKDOWN_LAYOUT.twoRow,
        descriptionWidth: 2,
      },
    );
    expect(
      rows
        .slice(1)
        .map((row) => [row.rowKind, row.descriptionLower, row.wrap]),
    ).toEqual([
      ["note", "X", undefined],
      ["detail", "AB", "lower"],
      ["note", "CD", "lower"],
      ["detail", "E", "lower"],
    ]);
  });

  it("下段が空なら上段の2つ目を数量行へ移して継続行をペアにする", () => {
    const rows = buildBreakdownRows(
      [item({ descriptionUpper: "ABCDE", descriptionLower: "" })],
      subjects,
      {
        ...DEFAULT_BREAKDOWN_SETTINGS,
        layout: BREAKDOWN_LAYOUT.twoRow,
        descriptionWidth: 2,
      },
    );
    expect(
      rows
        .slice(1)
        .map((row) => [row.rowKind, row.descriptionLower, row.wrap]),
    ).toEqual([
      ["note", "AB", undefined],
      ["detail", "CD", "upper"],
      ["note", "E", "upper"],
      ["detail", "", "fill"],
    ]);
  });

  it("上段を1文字幅に分けても数量行を保持し、継続行を交互に並べる", () => {
    const rows = buildBreakdownRows(
      [item({ descriptionUpper: "ABCDEF", descriptionLower: "Q" })],
      subjects,
      {
        ...DEFAULT_BREAKDOWN_SETTINGS,
        layout: BREAKDOWN_LAYOUT.twoRow,
        descriptionWidth: 1,
      },
    );
    expect(rows.slice(1).map((row) => [row.rowKind, row.descriptionLower])).toEqual([
      ["note", ""],
      ["detail", "Q"],
      ["note", "A"],
      ["detail", "B"],
      ["note", "C"],
      ["detail", "D"],
      ["note", "E"],
      ["detail", "F"],
    ]);
  });

  it("折り返しを解除して原文へ戻し、幅変更で再分割する", () => {
    const source = [item({ descriptionUpper: "ABCDE", descriptionLower: "FGHIJ" })];
    const original = buildBreakdownRows(source, subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.twoRow,
    });
    const wrapped = buildBreakdownRows(source, subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.twoRow,
      descriptionWidth: 2,
    });
    expect(unwrapBreakdownRows(wrapped)).toEqual(original);
    expect(
      relayoutBreakdownRows(wrapped, {
        layout: BREAKDOWN_LAYOUT.twoRow,
        namePattern: NAME_PATTERN.asIs,
        descriptionWidth: 0,
      }),
    ).toEqual(original);
    const wider = relayoutBreakdownRows(wrapped, {
      layout: BREAKDOWN_LAYOUT.twoRow,
      namePattern: NAME_PATTERN.asIs,
      descriptionWidth: 4,
    });
    expect(wider.filter((row) => row.wrap === "upper")).toHaveLength(2);
    expect(wider.filter((row) => row.wrap === "lower")).toHaveLength(2);
    const oneLine = relayoutBreakdownRows(wrapped, {
      layout: BREAKDOWN_LAYOUT.oneLine,
      namePattern: NAME_PATTERN.asIs,
      descriptionWidth: 2,
    });
    expect(
      oneLine.some(
        (row) =>
          row.wrap === "upper" || row.wrap === "lower" || row.wrap === "fill",
      ),
    ).toBe(false);
  });

  it("エクセル書式では幅設定があっても摘要を分割しない", () => {
    const rows = buildBreakdownRows(
      [item({ descriptionUpper: "ABCDE", descriptionLower: "FGHIJ" })],
      subjects,
      {
        ...DEFAULT_BREAKDOWN_SETTINGS,
        layout: BREAKDOWN_LAYOUT.excel,
        descriptionWidth: 1,
      },
    );
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.wrap !== undefined && row.wrap !== "")).toBe(
      false,
    );
  });
});

describe("数量の丸め", () => {
  it("100以上は整数、100未満は小数1桁", () => {
    expect(roundQuantity(123.45, DEFAULT_BREAKDOWN_SETTINGS)).toBe(123);
    expect(roundQuantity(12.34, DEFAULT_BREAKDOWN_SETTINGS)).toBe(12.3);
    expect(roundQuantity(100, DEFAULT_BREAKDOWN_SETTINGS)).toBe(100);
  });

  it("小数1桁で0になる場合は数字が出る桁まで表示する", () => {
    expect(roundQuantity(0.04, DEFAULT_BREAKDOWN_SETTINGS)).toBe(0.04);
    expect(roundQuantity(0.0004, DEFAULT_BREAKDOWN_SETTINGS)).toBe(0.0004);
    expect(roundQuantity(0, DEFAULT_BREAKDOWN_SETTINGS)).toBe(0);
  });
});

describe("文字の変換", () => {
  it("半角と全角を変換する", () => {
    expect(toFullWidth("A1-2")).toBe("Ａ１－２");
    expect(toHalfWidth("Ａ１－２")).toBe("A1-2");
  });

  it("摘要の文字を置き換える", () => {
    expect(applyReplacements("21*18", [{ from: "*", to: "✕" }])).toBe("21✕18");
  });
});

describe("内訳書の行づくり", () => {
  it("科目見出しの下に明細を並べ、上段は次の行へ送る", () => {
    const rows = buildBreakdownRows(
      [item({})],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    expect(rows[0].rowKind).toBe("subject");
    expect(rows[0].subjectName).toBe("コンクリート工事");
    // 数量・単位のある明細は下段が主、上段は次の行（note）へ送る
    expect(rows[1].nameUpper).toBe("基礎");
    expect(rows[1].nameLower).toBe("普通コンクリート");
    expect(rows[1].descriptionLower).toBe("呼び強度21");
    expect(rows[1].quantity).toBe(12.3);
    expect(rows[2].rowKind).toBe("note");
    expect(rows[2].descriptionLower).toBe("FC21*18");
    expect(rows[2].remarksLower).toBe("上段備考");
  });

  it("数量・単位が無い明細は上段を残して下段を次の行へ送る", () => {
    const rows = buildBreakdownRows(
      [item({ unit: "" })],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    expect(rows[1].quantity).toBeNull();
    expect(rows[1].descriptionLower).toBe("FC21*18");
    expect(rows[2].descriptionLower).toBe("呼び強度21");
  });

  it("書式②は部位＋半角スペース＋名称の1段にする", () => {
    const rows = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.oneLine,
    });
    expect(rows[1].nameUpper).toBe("");
    expect(rows[1].nameLower).toBe("基礎 普通コンクリート");
  });

  it("書式④は集計書のまま2段2行にする", () => {
    const rows = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.twoRow,
    });
    // 上段（部位名・摘要上段・備考上段）と下段（名称・摘要下段・数量）が別の行になる
    expect(rows[1]).toMatchObject({
      rowKind: "note",
      nameLower: "基礎",
      descriptionLower: "FC21*18",
      remarksLower: "上段備考",
      quantity: null,
    });
    expect(rows[2]).toMatchObject({
      rowKind: "detail",
      nameLower: "普通コンクリート",
      descriptionLower: "呼び強度21",
      remarksLower: "下段備考",
      quantity: 12.3,
      unit: "m3",
    });
  });

  it("書式④は上段が空でも2行1組にする", () => {
    const rows = buildBreakdownRows(
      [item({ partName: "", descriptionUpper: "", remarksUpper: "" })],
      subjects,
      { ...DEFAULT_BREAKDOWN_SETTINGS, layout: BREAKDOWN_LAYOUT.twoRow },
    );
    expect(rows).toHaveLength(3);
    expect(rows[1].rowKind).toBe("note");
    expect(rows[1].nameLower).toBe("");
    expect(rows[2].nameLower).toBe("普通コンクリート");
  });

  it("部位Ⅰが変わるところへタイトル行を入れる", () => {
    const rows = buildBreakdownRows(
      [
        item({ part1: "内部", masterKey: "k1" }),
        item({ part1: "内部", masterKey: "k2" }),
        item({ part1: "外部", masterKey: "k3" }),
      ],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const titles = rows.filter((row) => row.rowKind === "title");
    expect(titles.map((row) => row.nameLower)).toEqual([
      "（内部）",
      "（外部）",
    ]);
  });

  it("部位Ⅱの切り替わりに見出しを入れ、基本部位の見出しを出し直す", () => {
    const items = [
      item({
        id: 1,
        masterKey: "part2-1",
        part1: "共用内装",
        part2: "1階レセプション",
        partNumber: 11,
        name: "受付A",
        descriptionUpper: "",
        descriptionLower: "",
        remarksUpper: "",
        remarksLower: "",
      }),
      item({
        id: 2,
        masterKey: "part2-2",
        part1: "共用内装",
        part2: "1階レセプション",
        partNumber: 11,
        name: "受付B",
        descriptionUpper: "",
        descriptionLower: "",
        remarksUpper: "",
        remarksLower: "",
      }),
      item({
        id: 3,
        masterKey: "part2-3",
        part1: "共用内装",
        part2: "2階ロビー",
        partNumber: 11,
        name: "ロビー",
        descriptionUpper: "",
        descriptionLower: "",
        remarksUpper: "",
        remarksLower: "",
      }),
      item({
        id: 4,
        masterKey: "part2-4",
        part1: "外部",
        part2: "",
        partNumber: 11,
        name: "外部明細",
        descriptionUpper: "",
        descriptionLower: "",
        remarksUpper: "",
        remarksLower: "",
      }),
    ];
    const settings = { ...DEFAULT_BREAKDOWN_SETTINGS, partTitlesOn: true };
    const rows = buildBreakdownRows(items, subjects, settings);
    const names = rows.map((row) =>
      row.rowKind === "subject" ? row.subjectName : row.nameLower,
    );

    expect(names).toEqual([
      "コンクリート工事",
      "（共用内装）",
      "＜1階レセプション＞",
      "＜床＞",
      "受付A",
      "受付B",
      "＜2階ロビー＞",
      "＜床＞",
      "ロビー",
      "（外部）",
      "＜床＞",
      "外部明細",
    ]);
    expect(rows.some((row) => row.nameLower === "＜＞")).toBe(false);

    const relayouted = relayoutBreakdownRows(rows, {
      layout: BREAKDOWN_LAYOUT.oneLine,
      namePattern: NAME_PATTERN.asIs,
    });
    expect(
      relayouted
        .filter((row) => row.rowKind === "title")
        .map((row) => row.nameLower),
    ).toEqual([
      "（共用内装）",
      "＜1階レセプション＞",
      "＜床＞",
      "＜2階ロビー＞",
      "＜床＞",
      "（外部）",
      "＜床＞",
    ]);
    const part2Heading = toCompareBlocks(
      relayouted,
      BREAKDOWN_LAYOUT.twoRow,
    ).find((block) => block.lower.nameLower === "＜1階レセプション＞");
    expect(part2Heading?.heading).toBe(true);

    const grouped = buildGroupedBreakdownRows(
      [{ name: "居室", items }],
      settings,
    );
    expect(grouped.some((row) => row.nameLower === "＜1階レセプション＞")).toBe(
      false,
    );
  });

  it("名称の文字を全角・半角にそろえる（部位名はそのまま）", () => {
    const source = item({ partName: "ﾌｶｼ壁", name: "ﾒﾀｶﾗｰSK-FB" });
    const full = buildBreakdownRows([source], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      nameWidth: "full",
    });
    expect(full[1].nameUpper).toBe("ﾌｶｼ壁");
    expect(full[1].nameLower).toBe("メタカラーＳＫ－ＦＢ");

    const half = buildBreakdownRows([source], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      nameWidth: "half",
    });
    expect(half[1].nameLower).toBe("ﾒﾀｶﾗｰSK-FB");
  });

  it("名称パターンで部位＋名称にできる", () => {
    const rows = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      namePattern: NAME_PATTERN.withPart,
    });
    expect(rows[1].nameLower).toBe("基礎 普通コンクリート");
  });

  it("書式④でも名称パターンで部位：名称にできる", () => {
    const rows = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.twoRow,
      namePattern: NAME_PATTERN.withPartColon,
    });
    expect(rows[1].nameLower).toBe("");
    expect(rows[2].nameLower).toBe("基礎:普通コンクリート");
    const fullColon = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.twoRow,
      namePattern: NAME_PATTERN.withPartFullColon,
    });
    expect(fullColon[2].nameLower).toBe("基礎：普通コンクリート");
  });

  it("部位番号の範囲が変わるところに基本部位のタイトル行が出る", () => {
    const rows = buildBreakdownRows(
      [
        item({ partNumber: 11 }),
        item({ partNumber: 15 }),
        item({ partNumber: 25 }),
        item({ partNumber: 72 }),
      ],
      subjects,
      { ...DEFAULT_BREAKDOWN_SETTINGS, partTitlesOn: true },
    );
    expect(
      rows.map((row) =>
        row.rowKind === "subject" ? row.subjectName : row.nameLower,
      ),
    ).toEqual([
      "コンクリート工事",
      "＜床＞",
      "普通コンクリート",
      "",
      "普通コンクリート",
      "",
      "＜巾木＞",
      "普通コンクリート",
      "",
      "＜その他＞",
      "普通コンクリート",
      "",
    ]);
  });

  it("基本部位のタイトル行は部位Ⅰが変わると出し直す", () => {
    const rows = buildBreakdownRows(
      [
        item({ part1: "内部", partNumber: 11 }),
        item({ part1: "外部", partNumber: 12 }),
      ],
      subjects,
      { ...DEFAULT_BREAKDOWN_SETTINGS, partTitlesOn: true },
    );
    expect(
      rows.map((row) =>
        row.rowKind === "subject" ? row.subjectName : row.nameLower,
      ),
    ).toEqual([
      "コンクリート工事",
      "（内部）",
      "＜床＞",
      "普通コンクリート",
      "",
      "（外部）",
      "＜床＞",
      "普通コンクリート",
      "",
    ]);
  });

  it("部位タイトル行を出さない設定では出ない（表は残る）", () => {
    const rows = buildBreakdownRows(
      [item({ partNumber: 11 }), item({ partNumber: 25 })],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    expect(rows.some((row) => row.nameLower === "＜床＞")).toBe(false);
    expect(rows.some((row) => row.nameLower === "＜巾木＞")).toBe(false);
  });

  it("名称パターンで部位：名称にできる（2段1行・1段とも）", () => {
    const twoLine = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      namePattern: NAME_PATTERN.withPartColon,
    });
    expect(twoLine[1].nameUpper).toBe("");
    expect(twoLine[1].nameLower).toBe("基礎:普通コンクリート");
    const oneLine = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.oneLine,
      namePattern: NAME_PATTERN.withPartColon,
    });
    expect(oneLine[1].nameLower).toBe("基礎:普通コンクリート");
  });

  it("工種科目の並びを設定どおりにする", () => {
    const rows = buildBreakdownRows(
      [item({}), item({ id: 2, masterKey: "k2", subjectId: 2 })],
      subjects,
      { ...DEFAULT_BREAKDOWN_SETTINGS, subjectOrder: [2, 1] },
    );
    expect(rows[0].subjectName).toBe("型枠工事");
  });

  it("集計書から使っている科目と単位を抜き出す", () => {
    const items = [item({}), item({ id: 2, subjectId: 2, unit: "m2" })];
    expect(collectSubjectOrder(items, subjects)).toEqual([1, 2]);
    expect(collectUnits(items)).toEqual(["m3", "m2"]);
  });

  it("新しい科目は科目マスターの並びで直前の科目の直後に入る（後ろに並べない）", () => {
    const list = [
      { id: 1, name: "A", displayOrder: 1 },
      { id: 2, name: "B", displayOrder: 2 },
      { id: 3, name: "C", displayOrder: 3 },
      { id: 4, name: "D", displayOrder: 4 },
    ];
    // 並びそのまま：1回目に無いD(4)はC(3)の直後
    expect(mergeSubjectOrder([1, 3], [1, 3, 4], list)).toEqual([1, 3, 4]);
    // 新しい科目どうしも科目マスターの順で入る
    expect(mergeSubjectOrder([1, 3], [1, 2, 3, 4], list)).toEqual([1, 2, 3, 4]);
    // 並びを動かしている場合：覚えた並び [3,1]（C→A）。新しいB(2)は
    // 科目マスター順で直前のA(1)の直後（前後の科目から位置を決める）
    expect(mergeSubjectOrder([3, 1], [2], list)).toEqual([3, 1, 2]);
    // どの既存科目より前なら先頭
    expect(mergeSubjectOrder([2, 3], [1, 2, 3], list)).toEqual([1, 2, 3]);
  });
});

describe("内訳書の書式を並べ替える", () => {
  const relayoutItems = [
    item({
      id: 101,
      masterKey: "relayout-101",
      part1: "内部",
      partNumber: 11,
      partName: "床",
      name: "ビニルクロス　ＶＰ",
      descriptionUpper: "上段摘要",
      descriptionLower: "下段摘要",
      remarksUpper: "上段備考",
      remarksLower: "下段備考",
    }),
    item({
      id: 102,
      masterKey: "relayout-102",
      part1: "内部",
      partNumber: 31,
      partName: "",
      subjectId: 2,
      name: "部位名のない明細",
      descriptionUpper: "",
      descriptionLower: "数量のある明細",
      remarksUpper: "",
      remarksLower: "備考",
    }),
    item({
      id: 103,
      masterKey: "relayout-103",
      part1: "外部",
      partNumber: 70,
      partName: "壁",
      name: "数量なし明細",
      unit: "",
      descriptionUpper: "上段が主",
      descriptionLower: "下段摘要",
      remarksUpper: "上段備考",
      remarksLower: "下段備考",
    }),
  ];
  const baseSettings = {
    ...DEFAULT_BREAKDOWN_SETTINGS,
    partTitlesOn: true,
    replacements: [{ from: "上段", to: "先行" }],
  };
  const layouts = [
    BREAKDOWN_LAYOUT.twoLine,
    BREAKDOWN_LAYOUT.oneLine,
    BREAKDOWN_LAYOUT.excel,
    BREAKDOWN_LAYOUT.twoRow,
  ];
  const namePatterns = [
    NAME_PATTERN.asIs,
    NAME_PATTERN.withPart,
    NAME_PATTERN.withPartColon,
    NAME_PATTERN.withPartFullColon,
  ];

  it("全書式・名称欄の組み合わせで新規転記と同じ行になる", () => {
    layouts.forEach((sourceLayout) =>
      namePatterns.forEach((sourcePattern) => {
        const sourceRows = buildBreakdownRows(relayoutItems, subjects, {
          ...baseSettings,
          layout: sourceLayout,
          namePattern: sourcePattern,
        });
        layouts.forEach((targetLayout) =>
          namePatterns.forEach((targetPattern) => {
            const targetSettings = {
              ...baseSettings,
              layout: targetLayout,
              namePattern: targetPattern,
            };
            expect(relayoutBreakdownRows(sourceRows, targetSettings)).toEqual(
              buildBreakdownRows(relayoutItems, subjects, targetSettings),
            );
          }),
        );
      }),
    );
  });

  it("単価・金額・取消線を保ち、2行形式では上下両方に取消線を出す", () => {
    const original = buildBreakdownRows(
      [
        item({
          descriptionUpper: "",
          descriptionLower: "",
          remarksUpper: "",
          remarksLower: "",
        }),
      ],
      subjects,
      { ...DEFAULT_BREAKDOWN_SETTINGS, layout: BREAKDOWN_LAYOUT.twoLine },
    )
      .map((row, index) => ({ ...row, id: index + 10, versionId: 42 }))
      .map((row) =>
        row.rowKind === "detail"
          ? { ...row, unitPrice: 125, amount: 1500, struck: 1 }
          : row,
      );
    const twoRow = relayoutBreakdownRows(original, {
      layout: BREAKDOWN_LAYOUT.twoRow,
      namePattern: NAME_PATTERN.asIs,
    });
    expect(twoRow[1]).toMatchObject({
      rowKind: "note",
      unitPrice: null,
      amount: null,
      struck: 1,
      id: original[1].id,
      versionId: 42,
    });
    expect(twoRow[2]).toMatchObject({
      rowKind: "detail",
      unitPrice: 125,
      amount: 1500,
      struck: 1,
      id: original[1].id,
      versionId: 42,
    });
    expect(
      relayoutBreakdownRows(twoRow, {
        layout: BREAKDOWN_LAYOUT.twoLine,
        namePattern: NAME_PATTERN.asIs,
      }),
    ).toEqual(original);
  });

  it("空行とキーのない注記を位置を変えずに通し、同じ書式への変換は冪等", () => {
    const source = buildBreakdownRows(
      [
        item({
          descriptionUpper: "",
          descriptionLower: "",
          remarksUpper: "",
          remarksLower: "",
        }),
        item({
          id: 2,
          masterKey: "k2",
          descriptionUpper: "",
          descriptionLower: "",
          remarksUpper: "",
          remarksLower: "",
        }),
      ],
      subjects,
      { ...DEFAULT_BREAKDOWN_SETTINGS, layout: BREAKDOWN_LAYOUT.oneLine },
    );
    const keylessNote = {
      ...source[1],
      rowKind: "note" as const,
      masterKey: "",
      aggregateItemId: null,
    };
    const subtotal = {
      ...source[1],
      nameLower: "小計",
      subtotal: true,
    };
    const blank = {
      ...source[1],
      rowKind: "blank" as const,
      masterKey: "",
      aggregateItemId: null,
    };
    const rows = [
      source[0],
      source[1],
      subtotal,
      keylessNote,
      blank,
      source[2],
    ];
    const settings = {
      layout: BREAKDOWN_LAYOUT.twoRow,
      namePattern: NAME_PATTERN.withPartColon,
    };
    const once = relayoutBreakdownRows(rows, settings);
    expect(once[3]).toBe(subtotal);
    expect(once[4]).toBe(keylessNote);
    expect(once[5]).toBe(blank);
    expect(relayoutBreakdownRows(once, settings)).toEqual(once);
  });
});

describe("BCS.CSV", () => {
  it("階層と行種別を出す", () => {
    const rows = buildBreakdownRows(
      [item({})],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const csv = toBcsCsv(rows, {
      projectName: "港区計画",
      workCategory: "建築主体工事",
    });
    const lines = csv.split("\r\n").filter((line) => line !== "");
    expect(lines[0]).toContain('"P"');
    expect(lines[0]).toContain("港区計画");
    expect(lines.some((line) => line.includes('"建築主体工事"'))).toBe(true);
    expect(lines.some((line) => line.includes('"コンクリート工事"'))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes('"D"'))).toBe(true);
    expect(lines.some((line) => line.includes('"T"'))).toBe(true);
    lines.forEach((line) => {
      expect(line.split(",").length).toBeGreaterThanOrEqual(19);
    });
  });

  it("2段1明細を1行にまとめ、上段は名称・摘要・備考の右の欄へ出す", () => {
    const rows = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.excel,
    });
    const csv = toBcsCsv(rows, {
      projectName: "港区計画",
      workCategory: "建築主体工事",
    });
    const detail = csv.split("\r\n").filter((line) => line.includes('"D"'));
    expect(detail.length).toBe(1);
    const cells = detail[0].split(",");
    expect(cells[10]).toBe('"普通コンクリート"');
    expect(cells[11]).toBe('"呼び強度21"');
    expect(cells[12]).toBe("12.3");
    expect(cells[13]).toBe('"m3"');
    expect(cells[15]).toBe('"下段備考"');
    expect(cells[16]).toBe('"基礎"');
    expect(cells[17]).toBe('"FC21*18"');
    expect(cells[18]).toBe('"上段備考"');
  });
});

describe("エクセル掃き出し", () => {
  it("工種科目ごとにシートを分ける", () => {
    const rows = buildBreakdownRows(
      [item({}), item({ id: 2, masterKey: "k2", subjectId: 2 })],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const sheets = splitBySubject(rows);
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "コンクリート工事",
      "型枠工事",
    ]);
    const book = toSpreadsheetSheets(sheets, DEFAULT_BREAKDOWN_SETTINGS.layout);
    expect(book.map((sheet) => sheet.name)).toEqual([
      "コンクリート工事",
      "型枠工事",
    ]);
    // .xlsx （zip）として書き出している
    const file = toSpreadsheetWorkbook(
      sheets,
      DEFAULT_BREAKDOWN_SETTINGS.layout,
    );
    expect(file.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("書式③は2段をセル内改行で1行にまとめる", () => {
    const rows = buildBreakdownRows(
      [item({})],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const book = toSpreadsheetSheets(
      [{ name: "内訳書", rows }],
      BREAKDOWN_LAYOUT.excel,
    );
    const values = book[0].rows.flatMap((row) => row.map((cell) => cell.value));
    expect(values).toContain("基礎\n普通コンクリート");
  });

  it("書式③はソフト内は2段2行、エクセルでは1行にまとめる", () => {
    const rows = buildBreakdownRows([item({})], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.excel,
    });
    // ソフト内の表示は2段2行（上段＝部位・下段＝名称）
    expect(rows[1].nameLower).toBe("基礎");
    expect(rows[2].nameLower).toBe("普通コンクリート");
    const book = toSpreadsheetSheets(
      [{ name: "内訳書", rows }],
      BREAKDOWN_LAYOUT.excel,
    );
    const values = book[0].rows.flatMap((row) => row.map((cell) => cell.value));
    expect(values).toContain("基礎\n普通コンクリート");
    expect(values).toContain("FC21*18\n呼び強度21");
    expect(values).toContain("上段備考\n下段備考");
  });

  it("工種科目ごとに決めた明細数分の枠を空けて次の科目へ進む", () => {
    const rows = buildBreakdownRows(
      [item({}), item({ id: 2, masterKey: "k2", subjectId: 2 })],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const book = toSpreadsheetSheets(
      [{ name: "内訳書", rows }],
      BREAKDOWN_LAYOUT.twoLine,
      { detailsPerPage: 17, detailsPerPageLater: 16 },
    );
    // 1ページ目は17明細＝34行、2つ目の科目は次のページ（16明細＝32行）から
    expect(book[0].rows.length).toBe(34 + 32);
    // タイトル行は先頭だけ（2段目に文字）。先頭の列は「印」のあきで文字は出さない
    expect(book[0].rows[0][1].value).toBe("");
    expect(book[0].rows[1][0].value).toBe("");
    expect(book[0].rows[1][1].value).toBe("名称");
    expect(book[0].rows.slice(2).some((row) => row[1].value === "名称")).toBe(
      false,
    );
    // 明細の無い空欄の行にも罫線を引く。2段の書式なので上下段の間には線を入れない
    expect(book[0].rows[32].every((cell) => cell.border === "upper")).toBe(
      true,
    );
    expect(book[0].rows[33].every((cell) => cell.border === "lower")).toBe(
      true,
    );
  });

  it("単位は設定した表記へ置き換える（未入力ならそのまま）", () => {
    const rows = buildBreakdownRows([item({ unit: "m2" })], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      unitReplacements: [
        { from: "m2", to: "㎡" },
        { from: "m3", to: "" },
      ],
    });
    expect(rows.find((row) => row.rowKind === "detail")?.unit).toBe("㎡");
    const asIs = buildBreakdownRows([item({ unit: "m3" })], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      unitReplacements: [{ from: "m3", to: "" }],
    });
    expect(asIs.find((row) => row.rowKind === "detail")?.unit).toBe("m3");
  });
});

describe("回どうしの比較", () => {
  it("違う項目と片方だけの行を見つける", () => {
    const left = buildBreakdownRows(
      [item({})],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const right = buildBreakdownRows(
      [item({ quantity: 20, remarksLower: "変更" })],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const diffs = compareBreakdown(left, right.slice(0, 2));
    expect(diffs[1].changed).toContain("quantity");
    expect(diffs[1].changed).toContain("remarks");
    expect(diffs[2].onlyLeft).toBe(true);
  });

  it("保存時の書式が違っても現在の2段2行書式で差分なく比較する", () => {
    const source = item({
      id: 11,
      masterKey: "cross-format",
      partName: "壁",
      name: "コンクリートブロック",
      descriptionUpper: "上段摘要",
      descriptionLower: "下段摘要",
      remarksUpper: "上段備考",
      remarksLower: "下段備考",
    });
    const previousRows = buildBreakdownRows([source], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.twoLine,
      namePattern: NAME_PATTERN.withPart,
    });
    const currentRows = buildBreakdownRows([source], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.twoRow,
      namePattern: NAME_PATTERN.withPart,
    });
    const settings = {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      layout: BREAKDOWN_LAYOUT.twoRow,
      namePattern: NAME_PATTERN.withPart,
    };
    const leftRows = relayoutBreakdownRows(previousRows, settings);
    const rightRows = relayoutBreakdownRows(currentRows, settings);
    const leftBlocks = toCompareBlocks(leftRows, settings.layout);
    const rightBlocks = toCompareBlocks(rightRows, settings.layout);

    expect(leftBlocks.map((block) => block.span)).toEqual([1, 2]);
    expect(rightBlocks.map((block) => block.span)).toEqual([1, 2]);
    expect(
      compareBlocksBySubject(leftBlocks, rightBlocks).every(
        (diff) =>
          !diff.onlyLeft &&
          !diff.onlyRight &&
          diff.changed.length === 0 &&
          diff.changedHalves.length === 0,
      ),
    ).toBe(true);
  });

  it("行を上下に動かせる", () => {
    expect(moveRow([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveRow([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });

  it("金額が入った科目の終わりに小計行を足す", () => {
    const built = buildBreakdownRows(
      [
        item({}),
        item({ id: 2, masterKey: "k2" }),
        item({ id: 3, masterKey: "k3", subjectId: 2 }),
      ],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const rows = built.map((row) => {
      // k1は金額を直接入力、k2は数量×単価で出る（どちらも小計に足す）
      if (row.rowKind === "detail" && row.masterKey === "k1")
        return { ...row, amount: 100 };
      if (row.rowKind === "detail" && row.masterKey === "k2")
        return { ...row, quantity: 2, unitPrice: 25 };
      return row;
    });
    const next = withSubjectSubtotals(rows);
    const subtotals = next.filter((row) => row.nameLower === "小計");
    // 科目Aだけ小計150（科目Bは金額が無いので出さない）
    expect(subtotals).toHaveLength(1);
    expect(subtotals[0].amount).toBe(150);
    // 小計は科目Aの明細の直後・科目Bの見出しの直前に入る
    const headB = next.findIndex(
      (row) => row.rowKind === "subject" && row.subjectId === 2,
    );
    expect(next.indexOf(subtotals[0])).toBe(headB - 1);
  });

  it("エクセルでは小計を科目が終わるページの最後の行に出す", () => {
    const built = buildBreakdownRows(
      [item({}), item({ id: 2, masterKey: "k2", subjectId: 2 })],
      subjects,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const rows = withSubjectSubtotals(
      built.map((row) =>
        row.rowKind === "detail" && row.masterKey === "k1"
          ? { ...row, amount: 100 }
          : row,
      ),
    );
    const book = toSpreadsheetSheets(
      [{ name: "内訳書", rows }],
      BREAKDOWN_LAYOUT.twoLine,
      { detailsPerPage: 17, detailsPerPageLater: 16 },
    );
    // 1ページ目の最後の行（タイトル2行＋明細32行＝34行）に小計が来る
    expect(book[0].rows[33][1].value).toBe("小計");
    expect(book[0].rows[33][6].value).toBe(100);
    // 明細の直後は小計ではなく空欄（小計は明細のすぐ下には出ない）
    expect(book[0].rows.some((row) => row[1].value === "小計")).toBe(true);
    expect(book[0].rows[6][1].value).not.toBe("小計");
  });

  it("工種科目どうしで並びを合わせる（片方に無い科目は空欄。並びは多いほうが基準）", () => {
    const more = [
      { id: 1, name: "A", displayOrder: 1 },
      { id: 2, name: "B", displayOrder: 2 },
      { id: 3, name: "C", displayOrder: 3 },
    ];
    // 左（新しい回）：A・B。右（前の回）：A・C
    const leftRows = buildBreakdownRows(
      [
        item({}),
        item({ id: 2, masterKey: "k2", subjectId: 2 }),
        item({ id: 3, masterKey: "k3", subjectId: 2 }),
      ],
      more,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const rightRows = buildBreakdownRows(
      [item({}), item({ id: 4, masterKey: "k4", subjectId: 3 })],
      more,
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const leftBlocks = toCompareBlocks(leftRows, BREAKDOWN_LAYOUT.twoLine);
    const rightBlocks = toCompareBlocks(rightRows, BREAKDOWN_LAYOUT.twoLine);
    const diffs = compareBlocksBySubject(leftBlocks, rightBlocks);
    const heads = diffs.filter(
      (diff) =>
        (diff.leftIndex !== null && leftBlocks[diff.leftIndex].heading) ||
        (diff.rightIndex !== null && rightBlocks[diff.rightIndex].heading),
    );
    // 科目の見出しは同じ科目どうしで並ぶ。A・C（右だけ）→ B（左だけ）の順
    // （左のほうがかたまりが多いので左の並びが基準。Cは前の回でAの直後だったのでその位置）
    expect(heads.map((diff) => diff.left?.nameLower ?? "")).toEqual([
      "A",
      "",
      "B",
    ]);
    expect(heads.map((diff) => diff.right?.nameLower ?? "")).toEqual([
      "A",
      "C",
      "",
    ]);
    // Bの明細は左だけ・Cの明細は右だけになる（並びを追いかけてずれない）
    expect(diffs.some((diff) => diff.onlyLeft)).toBe(true);
    expect(diffs.some((diff) => diff.onlyRight)).toBe(true);
  });
});

describe("部屋別・部位別のまとめからの内訳書", () => {
  it("まとめの名前を見出しにし、明細はそのまとめの中に並ぶ", () => {
    const rows = buildGroupedBreakdownRows(
      [
        {
          name: "居室",
          items: [item({}), item({ id: 2, masterKey: "k2", quantity: 4 })],
        },
        { name: "玄関", items: [item({ id: 3, masterKey: "k3" })] },
      ],
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    const heads = rows.filter((row) => row.rowKind === "subject");
    expect(heads.map((row) => row.subjectName)).toEqual([
      "＜居室＞",
      "＜玄関＞",
    ]);
    // 見出しの下にそのまとめの明細が並ぶ（科目IDは明細のまま残る）
    expect(rows[1].nameLower).toBe("普通コンクリート");
    expect(rows[1].subjectId).toBe(1);
    expect(rows.filter((row) => row.rowKind === "detail")).toHaveLength(3);
  });

  it("まとめの見出しごとに小計が出る", () => {
    const rows = buildGroupedBreakdownRows(
      [
        { name: "居室", items: [item({})] },
        {
          name: "玄関",
          items: [item({ id: 3, masterKey: "k3", quantity: 2 })],
        },
      ],
      DEFAULT_BREAKDOWN_SETTINGS,
    );
    // 単価は内訳書で入れるので、行へ直接入れて小計を試す
    rows.forEach((row) => {
      if (row.rowKind === "detail") row.unitPrice = 100;
    });
    const subs = withSubjectSubtotals(rows).filter(
      (row) => row.subtotal === true,
    );
    // 12.3×100=1230、2×100=200
    expect(subs.map((row) => row.amount)).toEqual([1230, 200]);
  });
});
