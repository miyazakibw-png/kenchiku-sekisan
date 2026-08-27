import { describe, expect, it } from "vitest";
import {
  applyDetail,
  buildTransferColumns,
  applyEstimateParts,
  emptyTransferRow,
  insertTransferRow,
  parseQuantity,
  removeTransferRow,
  resolveTransferInherited,
  updateTransferRow,
} from "../../src/renderer/src/features/estimate/transferRows";
import type { Detail, EstimateRow } from "../../src/shared/types";
import { buildPastePreview } from "../../src/renderer/src/features/grid/gridClipboard";

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
    });
    expect(inherited[2].part3).toBe("廊下");
    expect(inherited[2].part1).toBe("1階");
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

describe("転記入力表のエクセル貼り付け（科目IDから）", () => {
  const columns = buildTransferColumns(
    [{ id: 1, name: "仕上" }],
    [{ id: 2, name: "m2" }],
    [{ id: 3, name: "床" }],
  );

  it("科目IDから右へ、1行1明細で取り込む", () => {
    const text = [
      [
        "5",
        "1",
        "3",
        "1.02",
        "",
        "ビニル床シート",
        "上段",
        "下段",
        "12.345",
        "2",
        "備考上",
        "備考下",
      ].join("\t"),
      ["6", "仕上", "", "", "壁", "塗装", "", "", "3", "m2", "", ""].join("\t"),
    ].join("\n");

    const preview = buildPastePreview(
      [emptyTransferRow()],
      columns,
      text,
      0,
      0,
      () => emptyTransferRow(),
    );

    expect(preview.errorCount).toBe(0);
    expect(preview.addedRows).toBe(1);
    const [first, second] = preview.rows;
    expect(first.subjectId).toBe(5);
    // マスターのIDで打った仕上区分・単位・部位はマスターの名前に直す
    expect(first.materialCategory).toBe("仕上");
    expect(first.unit).toBe("m2");
    expect(first.partId).toBe(3);
    expect(first.partName).toBe("床");
    expect(first.detailNumber).toBe(1.02);
    expect(first.quantity).toBe(12.35);
    expect(first.remarks).toBe("備考上");
    expect(first.remarksLower).toBe("備考下");
    expect(second.subjectId).toBe(6);
    expect(second.partName).toBe("壁");
  });

  it("数字で入れる欄に文字が来たときは取り込まずに件数を返す", () => {
    const preview = buildPastePreview(
      [emptyTransferRow()],
      columns,
      "あ\t仕上",
      0,
      0,
      () => emptyTransferRow(),
    );
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0].subjectId).toBeNull();
    expect(preview.rows[0].materialCategory).toBe("仕上");
  });
});
