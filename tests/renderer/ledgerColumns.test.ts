import { describe, expect, it } from "vitest";
import {
  sortByLedgerOrder,
  type LedgerColumnSetting,
} from "../../src/renderer/src/features/projects/ledgerColumns";

describe("台帳の列並びへのそろえ", () => {
  const settings: LedgerColumnSetting[] = [
    { key: "note", visible: true },
    { key: "builderName", visible: true },
    { key: "field:12", visible: true },
    { key: "field:10", visible: true },
    { key: "mark:1", visible: true },
    { key: "designerName", visible: true },
  ];

  it("固定列は先頭、その他は台帳の設定どおりの順になる", () => {
    const keys = sortByLedgerOrder(
      [
        { key: "managementNo" },
        { key: "name" },
        { key: "projectDate" },
        { key: "builderName" },
        { key: "designerName" },
        { key: "note" },
        { key: "field-10" },
        { key: "field-12" },
      ],
      settings,
    ).map((item) => item.key);
    expect(keys).toEqual([
      "projectDate",
      "managementNo",
      "name",
      "note",
      "builderName",
      "field-12",
      "field-10",
      "designerName",
    ]);
  });

  it("台帳の field:◯ キーは積算操作側の field-◯ に対応づける", () => {
    const keys = sortByLedgerOrder(
      [{ key: "field-10" }, { key: "field-12" }],
      [
        { key: "field:12", visible: false },
        { key: "field:10", visible: true },
      ],
    ).map((item) => item.key);
    // 非表示でも並びの位置は決まっている
    expect(keys).toEqual(["field-12", "field-10"]);
  });

  it("設定に無いキーは末尾に元の順のまま足す", () => {
    const keys = sortByLedgerOrder(
      [{ key: "field-9" }, { key: "note" }, { key: "field-8" }],
      [{ key: "note", visible: true }],
    ).map((item) => item.key);
    expect(keys).toEqual(["note", "field-9", "field-8"]);
  });
});
