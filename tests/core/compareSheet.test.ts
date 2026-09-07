import { describe, expect, it } from "vitest";
import { BREAKDOWN_LAYOUT } from "../../src/core/breakdown/breakdown";
import type { BreakdownRow } from "../../src/core/breakdown/breakdown";
import { toCompareSheet } from "../../src/core/breakdown/compareSheet";

function row(patch: Partial<BreakdownRow>): BreakdownRow {
  return {
    rowKind: "detail",
    subjectId: 1,
    subjectName: "コンクリート工事",
    masterKey: "k1",
    aggregateItemId: null,
    partName: "基礎",
    nameUpper: "",
    nameLower: "普通コンクリート",
    descriptionUpper: "",
    descriptionLower: "呼び強度21",
    quantity: 10,
    unit: "m3",
    unitPrice: null,
    amount: null,
    remarksUpper: "",
    remarksLower: "",
    ...patch,
  };
}

describe("比較のエクセル掃き出し", () => {
  const layout = BREAKDOWN_LAYOUT.twoLine;

  it("左に新しい回・右に比べる元を並べて出す", () => {
    const sheet = toCompareSheet({
      left: [row({})],
      right: [row({})],
      layout,
      leftTitle: "2回目（新しい方）",
      rightTitle: "1回目",
    });
    // 7列＋あき1列＋7列
    expect(sheet.rows[0]?.length).toBe(15);
    expect(sheet.rows[0]?.[0]?.value).toBe("2回目（新しい方）");
    expect(sheet.rows[0]?.[8]?.value).toBe("1回目");
    expect(sheet.rows[1]?.[0]?.value).toBe("名称");
    expect(sheet.rows[2]?.[0]?.value).toBe("普通コンクリート");
    expect(sheet.rows[2]?.[8]?.value).toBe("普通コンクリート");
  });

  it("違うところは左だけ色を付け、比べる元（右）には付けない", () => {
    const sheet = toCompareSheet({
      left: [row({ quantity: 12 })],
      right: [row({ quantity: 10 })],
      layout,
      leftTitle: "2回目",
      rightTitle: "1回目",
    });
    const line = sheet.rows[2] ?? [];
    // 数量（3列目）だけ違う
    expect(line[2]?.mark).toBe("diff");
    expect(line[0]?.mark).toBe("plain");
    // 右側は色を付けない
    expect(line[10]?.mark).toBe("plain");
  });

  it("片側にしかない明細は左側に色が付く", () => {
    const sheet = toCompareSheet({
      left: [row({}), row({ nameLower: "増えた明細" })],
      right: [row({})],
      layout,
      leftTitle: "2回目",
      rightTitle: "1回目",
    });
    const line = sheet.rows[3] ?? [];
    expect(line[0]?.value).toBe("増えた明細");
    expect(line[0]?.mark).toBe("diff");
    expect(line[8]?.value).toBe("");
    expect(line[8]?.mark).toBe("plain");
  });

  it("2段2行の書式では見出しも1明細分（2行）にして左右をそろえる", () => {
    const pair = (name: string, quantity: number): BreakdownRow[] => [
      row({ rowKind: "note", nameLower: "基礎", quantity: null, unit: "" }),
      row({ rowKind: "detail", nameLower: name, quantity }),
    ];
    const sheet = toCompareSheet({
      // 左だけ工種科目の見出しが増えている
      left: [row({ rowKind: "subject" }), ...pair("普通コンクリート", 12)],
      right: [...pair("普通コンクリート", 10), ...pair("型枠", 5)],
      layout: BREAKDOWN_LAYOUT.twoRow,
      leftTitle: "2回目",
      rightTitle: "1回目",
    });
    // 見出し・明細ともに2行ずつ＝かたまりの数×2
    expect(sheet.rows.length).toBe(2 + 2 * 2);
    // 見出しは下の行に出し、右の明細と高さがそろう
    expect(sheet.rows[2]?.[0]?.value).toBe("");
    expect(sheet.rows[3]?.[0]?.value).toBe("コンクリート工事");
    expect(sheet.rows[3]?.[8]?.value).toBe("普通コンクリート");
    // 2つ目のかたまりは左右とも明細で、数量の違いに色が付く
    expect(sheet.rows[5]?.[0]?.value).toBe("普通コンクリート");
    expect(sheet.rows[5]?.[2]?.mark).toBe("diff");
    expect(sheet.rows[5]?.[10]?.mark).toBe("plain");
  });

  it("画面で開けた空行もそのまま出す", () => {
    const sheet = toCompareSheet({
      left: [row({}), row({ rowKind: "blank", nameLower: "", quantity: null })],
      right: [row({}), row({})],
      layout,
      leftTitle: "2回目",
      rightTitle: "1回目",
    });
    expect(sheet.rows.length).toBe(4);
    expect(sheet.rows[3]?.[0]?.value).toBe("");
  });
});
