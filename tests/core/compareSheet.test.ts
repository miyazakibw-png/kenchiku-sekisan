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
    // 内訳書単体と同じく1ページの行数（17明細×2行）まで空行で埋める
    expect(sheet.rows.length).toBe(17 * 2);
    // 見出しは下の行に出し、右の明細と高さがそろう
    expect(sheet.rows[2]?.[0]?.value).toBe("");
    expect(sheet.rows[3]?.[0]?.value).toBe("コンクリート工事");
    expect(sheet.rows[3]?.[8]?.value).toBe("普通コンクリート");
    // 2つ目のかたまりは左右とも明細で、数量の違いに色が付く
    expect(sheet.rows[5]?.[0]?.value).toBe("普通コンクリート");
    expect(sheet.rows[5]?.[2]?.mark).toBe("diff");
    expect(sheet.rows[5]?.[10]?.mark).toBe("plain");
  });

  it("2段2行の明細は上段・下段を行ごとに色を付ける", () => {
    const pair = (detail: string): BreakdownRow[] => [
      row({ rowKind: "note", nameLower: "基礎", quantity: null, unit: "" }),
      row({ rowKind: "detail", nameLower: detail }),
    ];
    const sheet = toCompareSheet({
      // 上段（note）は同じで下段（detail）だけ違う
      left: pair("普通コンクリート"),
      right: pair("型枠コンクリート"),
      layout: BREAKDOWN_LAYOUT.twoRow,
      leftTitle: "2回目",
      rightTitle: "1回目",
    });
    // 上段の行は同じなので色なし、下段の行は違うので色あり
    expect(sheet.rows[2]?.[0]?.value).toBe("基礎");
    expect(sheet.rows[2]?.[0]?.mark).toBe("plain");
    expect(sheet.rows[3]?.[0]?.value).toBe("普通コンクリート");
    expect(sheet.rows[3]?.[0]?.mark).toBe("diff");
  });

  it("2段2行で上段だけ違うときは上段の行にだけ色が付く", () => {
    const pair = (note: string): BreakdownRow[] => [
      row({ rowKind: "note", nameLower: note, quantity: null, unit: "" }),
      row({ rowKind: "detail" }),
    ];
    const sheet = toCompareSheet({
      // 下段（detail）は同じで上段（note）だけ違う
      left: pair("基礎スラブ"),
      right: pair("基礎"),
      layout: BREAKDOWN_LAYOUT.twoRow,
      leftTitle: "2回目",
      rightTitle: "1回目",
    });
    // 上段の行は違うので色あり、下段の行は同じなので色なし
    expect(sheet.rows[2]?.[0]?.mark).toBe("diff");
    expect(sheet.rows[3]?.[0]?.mark).toBe("plain");
  });

  it("画面で開けた空行もそのまま出す", () => {
    const sheet = toCompareSheet({
      left: [row({}), row({ rowKind: "blank", nameLower: "", quantity: null })],
      right: [row({}), row({})],
      layout,
      leftTitle: "2回目",
      rightTitle: "1回目",
    });
    // 1ページの行数（17明細）まで空行で埋める
    expect(sheet.rows.length).toBe(17);
    expect(sheet.rows[3]?.[0]?.value).toBe("");
  });

  it("内訳書単体と同じく科目が変わるところでページを改める", () => {
    const subject = (id: number, name: string): BreakdownRow =>
      row({ rowKind: "subject", subjectId: id, subjectName: name });
    const sheet = toCompareSheet({
      left: [
        subject(1, "A工事"),
        row({}),
        subject(2, "B工事"),
        row({ subjectId: 2 }),
      ],
      right: [
        subject(1, "A工事"),
        row({}),
        subject(2, "B工事"),
        row({ subjectId: 2 }),
      ],
      layout,
      leftTitle: "2回目",
      rightTitle: "1回目",
      page: { detailsPerPage: 17, detailsPerPageLater: 16 },
    });
    // 1ページ目17明細＋2ページ目16明細＝33行
    expect(sheet.rows.length).toBe(17 + 16);
    // B工事は次のページの先頭から
    expect(sheet.rows[17]?.[0]?.value).toBe("B工事");
    expect(sheet.rows[17]?.[8]?.value).toBe("B工事");
  });

  it("小計は科目が終わるページの最後の行に出る（左右それぞれ）", () => {
    const subject = (id: number, name: string): BreakdownRow =>
      row({ rowKind: "subject", subjectId: id, subjectName: name });
    const subtotal = (amount: number): BreakdownRow =>
      row({
        subtotal: true,
        nameLower: "小計",
        amount,
        quantity: null,
        unit: "",
      });
    const sheet = toCompareSheet({
      left: [subject(1, "A工事"), row({ amount: 100 }), subtotal(100)],
      right: [subject(1, "A工事"), row({})],
      layout,
      leftTitle: "2回目",
      rightTitle: "1回目",
      page: { detailsPerPage: 17, detailsPerPageLater: 16 },
    });
    // 1ページ目の最後の行（17行目）に左だけ小計
    expect(sheet.rows[16]?.[0]?.value).toBe("小計");
    expect(sheet.rows[16]?.[5]?.value).toBe(100);
    expect(sheet.rows[16]?.[8]?.value).toBe("");
    // 小計の行は明細のすぐ次には出ない
    expect(sheet.rows[4]?.[0]?.value).not.toBe("小計");
  });
});
