import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_LAYOUT,
  DEFAULT_BREAKDOWN_SETTINGS,
  NAME_PATTERN,
  applyReplacements,
  buildBreakdownRows,
  collectSubjectOrder,
  collectUnits,
  roundQuantity,
  toFullWidth,
  toHalfWidth,
} from "../../src/core/breakdown/breakdown";
import { toBcsCsv } from "../../src/core/breakdown/bcs";
import { compareBreakdown, moveRow } from "../../src/core/breakdown/compare";
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

  it("名称の文字を全角・半角にそろえる（半角カタカナも）", () => {
    const source = item({ partName: "ﾌｶｼ壁", name: "ﾒﾀｶﾗｰSK-FB" });
    const full = buildBreakdownRows([source], subjects, {
      ...DEFAULT_BREAKDOWN_SETTINGS,
      nameWidth: "full",
    });
    expect(full[1].nameUpper).toBe("フカシ壁");
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
    const book = toSpreadsheetSheets(
      sheets,
      DEFAULT_BREAKDOWN_SETTINGS.layout,
    );
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
    const values = book[0].rows.flatMap((row) =>
      row.map((cell) => cell.value),
    );
    expect(values).toContain("基礎\n普通コンクリート");
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
    // タイトル行は先頭だけ（2段目に文字）
    expect(book[0].rows[0][0].value).toBe("");
    expect(book[0].rows[1][0].value).toBe("名称");
    expect(book[0].rows.slice(2).some((row) => row[0].value === "名称")).toBe(
      false,
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

  it("行を上下に動かせる", () => {
    expect(moveRow([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveRow([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
