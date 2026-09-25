import { describe, expect, it } from "vitest";
import {
  appendTransferRows,
  applyDetail,
  applyEstimateParts,
  emptyTransferRow,
  insertTransferRow,
  insertTransferRows,
  overwriteTransferRows,
  parseQuantity,
  removeTransferRow,
  resolveTransferInherited,
  updateTransferRow,
} from "../../src/renderer/src/features/estimate/transferRows";
import {
  copyTransferCells,
  pasteTransferCells,
} from "../../src/renderer/src/features/estimate/transferCells";
import type { Detail, EstimateRow } from "../../src/shared/types";

describe("転記入力表の行操作", () => {
  it("Ａ〜Ｉは入力が無ければ入力のある上の行を引き継ぐ", () => {
    const rows = [
      {
        ...emptyTransferRow(),
        part1: "1階",
        part2: "内部",
        part2Split: 1,
        part3: "事務室",
        subjectId: 5,
        materialCategory: "仕上",
      },
      emptyTransferRow(),
      { ...emptyTransferRow(), part3: "廊下" },
    ];

    const inherited = resolveTransferInherited(rows);
    expect(inherited[1]).toEqual({
      part1: "1階",
      part2: "内部",
      part2Split: 1,
      formwork: "",
      part3: "事務室",
      subjectId: 5,
      materialCategory: "仕上",
      partId: null,
      detailNumber: null,
    });
    expect(inherited[2].part3).toBe("廊下");
    expect(inherited[2].part1).toBe("1階");
  });

  it("部位IDは上の行と同じ、明細IDは上の行＋0.01を引き継ぐ", () => {
    const rows = [
      { ...emptyTransferRow(), partId: 165, detailNumber: 290 },
      emptyTransferRow(),
      emptyTransferRow(),
      { ...emptyTransferRow(), detailNumber: 300 },
      emptyTransferRow(),
    ];

    const inherited = resolveTransferInherited(rows);
    expect(inherited.map((row) => row.partId)).toEqual([
      165, 165, 165, 165, 165,
    ]);
    expect(inherited.map((row) => row.detailNumber)).toEqual([
      290, 290.01, 290.02, 300, 300.01,
    ]);
  });

  it("行挿入・行削除・行更新ができる", () => {
    const rows = [
      { ...emptyTransferRow(), name: "床" },
      { ...emptyTransferRow(), name: "壁" },
    ];
    const inserted = insertTransferRow(rows, 1);
    expect(inserted.map((row) => row.name)).toEqual(["床", "", "壁"]);
    expect(removeTransferRow(inserted, 0).map((row) => row.name)).toEqual([
      "",
      "壁",
    ]);
    expect(updateTransferRow(rows, 1, { quantity: 2 })[1].quantity).toBe(2);
  });

  it("部位別入力表の部位を転記する", () => {
    const source: EstimateRow = {
      id: 1,
      projectId: 1,
      rowType: "room",
      part1: "1階",
      part2: "内部",
      part2Split: 1,
      formwork: "地上階",
      part3: "風除室",
      ceilingHeight: 2.4,
      multiplier: 1,
      note: "",
      calcType: "room",
      displayOrder: 0,
    };
    const row = applyEstimateParts(emptyTransferRow(), source);
    expect(row.part1).toBe("1階");
    expect(row.part3).toBe("風除室");
    expect(row.formwork).toBe("地上階");
    expect(row.part2Split).toBe(1);
  });

  it("明細マスターを1明細として転記する（呼出元の明細IDを持つ）", () => {
    const detail: Detail = {
      id: 42,
      subjectId: 7,
      detailNumber: 3.02,
      materialCategory: "仕上",
      partName: "床",
      name: "ビニル床シート",
      descriptionUpper: "",
      descriptionLower: "t=2.0",
      unit: "m2",
      remarksUpper: "",
      remarksLower: "",
      estimateDisplay: "",
      displayOrder: 0,
      isActive: true,
      scope: "basic",
      projectId: null,
      sourceDetailId: null,
    };
    const row = applyDetail(emptyTransferRow(), detail);
    expect(row.sourceDetailId).toBe(42);
    expect(row.subjectId).toBe(7);
    expect(row.detailNumber).toBe(3.02);
    expect(row.name).toBe("ビニル床シート");
    expect(row.unit).toBe("m2");

    // 明細マスター側が空欄なら、先に入れてある部位・区分・単位は消さない
    const kept = applyDetail(
      {
        ...emptyTransferRow(),
        partName: "壁",
        materialCategory: "仕上",
        unit: "m",
      },
      { ...detail, partName: "", materialCategory: "", unit: "" },
    );
    expect(kept.partName).toBe("壁");
    expect(kept.materialCategory).toBe("仕上");
    expect(kept.unit).toBe("m");
  });

  it("数量は全角も受け付けて小数2桁で保持する", () => {
    expect(parseQuantity("１２．３４５").value).toBe(12.35);
    expect(parseQuantity("").value).toBeNull();
    expect(parseQuantity("あ").error).toBeTruthy();
  });
});

describe("転記入力表のマス単位のコピー・貼り付け", () => {
  const masters = {
    units: [{ id: 2, name: "m2" }],
    parts: [{ id: 3, name: "床" }],
  };
  const matrix = (text: string): string[][] =>
    text.split("\n").map((line) => line.split("\t"));

  it("選んでいるマスを左上にして、上段・下段の順に取り込む", () => {
    const result = pasteTransferCells(
      [emptyTransferRow()],
      { row: 0, line: 0, col: 0 },
      matrix(
        [
          "3\t床\t上段",
          "1.02\tビニル床シート\t下段",
          "\t\t次の明細の上段",
        ].join("\n"),
      ),
      masters,
    );

    expect(result.errorCount).toBe(0);
    expect(result.addedRows).toBe(1);
    const [first, second] = result.rows;
    expect(first.partId).toBe(3);
    expect(first.partName).toBe("床");
    expect(first.descriptionUpper).toBe("上段");
    expect(first.detailNumber).toBe(1.02);
    expect(first.name).toBe("ビニル床シート");
    expect(first.descriptionLower).toBe("下段");
    expect(second.descriptionUpper).toBe("次の明細の上段");
  });

  it("科目IDは対象外で、途中のマスからでも貼り付けられる", () => {
    const result = pasteTransferCells(
      [emptyTransferRow()],
      { row: 0, line: 1, col: 3 },
      matrix("12.345\t2"),
      masters,
    );

    expect(result.errorCount).toBe(0);
    const [row] = result.rows;
    expect(row.subjectId).toBeNull();
    expect(row.quantity).toBe(12.35);
    // 単位はマスターのIDで打っても名前に直す
    expect(row.unit).toBe("m2");
  });

  it("数字の欄に文字が来たときは取り込まずに件数を返す", () => {
    const result = pasteTransferCells(
      [emptyTransferRow()],
      { row: 0, line: 0, col: 0 },
      matrix("あ\t床"),
      masters,
    );
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].partId).toBeNull();
    expect(result.rows[0].partName).toBe("床");
  });

  it("選んだマスをエクセルへ貼れる形でコピーする", () => {
    const rows = [
      {
        ...emptyTransferRow(),
        partId: 3,
        partName: "床",
        detailNumber: 1.02,
        name: "ビニル床シート",
      },
    ];
    expect(
      copyTransferCells(rows, {
        start: { row: 0, line: 0, col: 0 },
        end: { row: 0, line: 1, col: 1 },
      }),
    ).toBe("3\t床\n1.02\tビニル床シート");
  });
});

describe("転記入力表の行コピー", () => {
  const rows = [
    { ...emptyTransferRow(), id: 1, name: "一" },
    { ...emptyTransferRow(), id: 2, name: "二" },
  ];
  const copied = [{ ...emptyTransferRow(), id: 9, name: "写し" }];

  it("上書貼付はカーソルの行を置き換える", () => {
    const next = overwriteTransferRows(rows, 1, copied);
    expect(next.map((row) => row.name)).toEqual(["一", "写し"]);
    // 貼り付けた行は新しい行として持つ
    expect(next[1].id).toBeNull();
  });

  it("挿入貼付はカーソルの行の上へ入れる", () => {
    expect(insertTransferRows(rows, 1, copied).map((row) => row.name)).toEqual([
      "一",
      "写し",
      "二",
    ]);
  });

  it("追加貼付は最終行の下へ足す", () => {
    expect(appendTransferRows(rows, copied).map((row) => row.name)).toEqual([
      "一",
      "二",
      "写し",
    ]);
  });
});
