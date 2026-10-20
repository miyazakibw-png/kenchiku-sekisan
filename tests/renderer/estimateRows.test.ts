import { describe, expect, it } from "vitest";
import type { EstimateRowDraft } from "../../src/shared/types";
import {
  buildEstimateColumns,
  copyRowsInto,
  duplicateRoomFlags,
  emptyRow,
  insertRow,
  moveRow,
  overwriteRowsInto,
  parseMultiplier,
  removeRow,
  resolveInherited,
  subtotalRow,
  subtotalSums,
  updateRow,
} from "../../src/renderer/src/features/estimate/estimateRows";
import { buildPastePreview } from "../../src/renderer/src/features/grid/gridClipboard";

const FORMWORKS = [
  { id: 1, name: "基礎階" },
  { id: 2, name: "地下階" },
  { id: 3, name: "地上階" },
];

function row(patch: Partial<EstimateRowDraft>): EstimateRowDraft {
  return { ...emptyRow(), ...patch };
}

describe("部位Ⅰ・部位Ⅱの引き継ぎ", () => {
  it("空欄の行は入力のある上の行を引き継ぐ", () => {
    const rows = [
      row({ part1: "内部", part2: "1階", part3: "風除室" }),
      row({ part3: "玄関ホール" }),
      row({ part2: "2階", part3: "ホール" }),
      row({ part3: "会議室" }),
    ];
    expect(resolveInherited(rows).map((r) => `${r.part1}/${r.part2}`)).toEqual([
      "内部/1階",
      "内部/1階",
      "内部/2階",
      "内部/2階",
    ]);
  });

  it("部位Ⅱ別仕訳も部位Ⅱと一緒に引き継ぐ", () => {
    const rows = [
      row({ part2: "1階", part2Split: 1 }),
      row({ part3: "事務室" }),
    ];
    expect(resolveInherited(rows).map((r) => r.part2Split)).toEqual([1, 1]);
  });

  it("型枠も空欄の行は入力のある上の行を引き継ぐ", () => {
    const rows = [
      row({ formwork: "地下階", part3: "風除室" }),
      row({ part3: "玄関ホール" }),
      row({ formwork: "地上階", part3: "ホール" }),
      row({ part3: "会議室" }),
    ];
    expect(resolveInherited(rows).map((r) => r.formwork)).toEqual([
      "地下階",
      "地下階",
      "地上階",
      "地上階",
    ]);
  });
});

describe("行操作", () => {
  it("挿入・削除・移動ができる", () => {
    let rows = [row({ part3: "A" }), row({ part3: "B" })];
    rows = insertRow(rows, 1);
    expect(rows.map((r) => r.part3)).toEqual(["A", "", "B"]);
    rows = removeRow(rows, 1);
    rows = moveRow(rows, 0, 1);
    expect(rows.map((r) => r.part3)).toEqual(["B", "A"]);
  });

  it("小計行は倍率0で作る（集計に足さない）", () => {
    const subtotal = subtotalRow();
    expect(subtotal.rowType).toBe("subtotal");
    expect(subtotal.multiplier).toBe(0);
  });

  it("他物件からの行はIDを外して複製する", () => {
    const rows = [row({ part3: "A" })];
    const copied = [{ ...row({ part3: "倉庫" }), id: 12 }];
    const merged = copyRowsInto(rows, 1, copied);
    expect(merged.map((r) => r.part3)).toEqual(["A", "倉庫"]);
    expect(merged[1].id).toBeNull();
  });

  it("上書貼付はカーソルの行から置き換える", () => {
    const rows = [row({ part3: "A" }), emptyRow(), row({ part3: "C" })];
    const copied = [{ ...row({ part3: "倉庫" }), id: 12 }];
    const merged = overwriteRowsInto(rows, 1, copied);
    expect(merged.map((r) => r.part3)).toEqual(["A", "倉庫", "C"]);
    expect(merged[1].id).toBeNull();
    expect(merged[1].copySourceId).toBe(12);
  });

  it("入力済みの部屋行は入力を残し、空欄を埋めて計算書の複製元を設定する", () => {
    const target = row({
      id: 20,
      part1: "内部",
      part3: "既存の部屋",
      multiplier: 2,
      note: "既存備考",
    });
    const source = row({
      id: 12,
      part1: "外部",
      part2: "2階",
      part2Split: 1,
      formwork: "地上階",
      part3: "コピー元の部屋",
      ceilingHeight: 2.8,
      multiplier: 9,
      note: "コピー元備考",
      calcType: "general",
    });

    const [merged] = overwriteRowsInto([target], 0, [source]);

    expect(merged).toMatchObject({
      id: 20,
      part1: "内部",
      part2: "2階",
      part2Split: 1,
      formwork: "地上階",
      part3: "既存の部屋",
      ceilingHeight: 2.8,
      multiplier: 2,
      note: "既存備考",
      calcType: "general",
      rowType: "room",
      copySourceId: 12,
    });
  });

  it("部位Ⅱが入力済みなら部位Ⅱ別仕訳も残す", () => {
    const target = row({ id: 20, part2: "1階", part2Split: 0 });
    const source = row({ id: 12, part2: "2階", part2Split: 1 });

    const [merged] = overwriteRowsInto([target], 0, [source]);

    expect(merged.part2).toBe("1階");
    expect(merged.part2Split).toBe(0);
  });

  it("ID未採番の入力済み行はIDを維持しつつ複製元を設定する", () => {
    const target = row({ part1: "内部" });
    const source = row({ id: 12, part3: "コピー元" });

    const [merged] = overwriteRowsInto([target], 0, [source]);

    expect(merged.id).toBeNull();
    expect(merged.part1).toBe("内部");
    expect(merged.part3).toBe("コピー元");
    expect(merged.copySourceId).toBe(12);
  });

  it("貼り付け先とコピー元が同じ行なら変更しない", () => {
    const target = row({ id: 12, part1: "内部", part3: "事務室" });

    const [merged] = overwriteRowsInto([target], 0, [target]);

    expect(merged).toBe(target);
    expect(merged).not.toHaveProperty("copySourceId");
  });

  it("小計行を含む貼り付けは従来どおり行を置き換える", () => {
    const targetSubtotal = subtotalRow();
    const copiedRoom = row({ id: 12, part3: "倉庫" });
    const [room] = overwriteRowsInto([targetSubtotal], 0, [copiedRoom]);
    expect(room.rowType).toBe("room");
    expect(room.id).toBeNull();
    expect(room.part3).toBe("倉庫");

    const targetRoom = row({ id: 20, part1: "内部", part3: "事務室" });
    const [subtotal] = overwriteRowsInto([targetRoom], 0, [subtotalRow()]);
    expect(subtotal.rowType).toBe("subtotal");
    expect(subtotal.id).toBeNull();
  });

  it("貼り付け範囲が末尾を越えた分は追加する", () => {
    const rows = [emptyRow()];

    const merged = overwriteRowsInto(rows, 0, [
      row({ id: 12, part3: "A" }),
      row({ id: 13, part3: "B" }),
    ]);

    expect(merged.map((item) => item.part3)).toEqual(["A", "B"]);
    expect(merged.every((item) => item.id === null)).toBe(true);
    expect(merged.map((item) => item.copySourceId)).toEqual([12, 13]);
  });

  it("倍率は -999.99〜999.99 の範囲", () => {
    expect(parseMultiplier("2").value).toBe(2);
    expect(parseMultiplier("-3").value).toBe(-3);
    expect(parseMultiplier("100").value).toBe(100);
    expect(parseMultiplier("999.99").value).toBe(999.99);
    expect(parseMultiplier("1000").error).toBeTruthy();
  });

  it("部屋を入力した行の倍率は既定で1", () => {
    expect(updateRow([emptyRow()], 0, { part3: "事務室" })[0].multiplier).toBe(
      1,
    );
  });

  it("小計行に部位ごとの数量合計が入り、次の小計行では足し直す", () => {
    const rows = [
      row({ part3: "A" }),
      row({ part3: "B" }),
      subtotalRow(),
      row({ part3: "C" }),
      subtotalRow(),
    ];
    const quantity: Record<string, Record<string, number>> = {
      A: { 床: 10, 巾木: 4 },
      B: { 床: 5 },
      C: { 床: 2, 巾木: 1 },
    };
    const sums = subtotalSums(rows, ["床", "巾木"], (target, part) => {
      const value = quantity[target.part3]?.[part];
      return value === undefined ? null : value;
    });
    expect(sums[0]).toBeNull();
    expect(sums[2]).toEqual({ 床: 15, 巾木: 4 });
    expect(sums[4]).toEqual({ 床: 2, 巾木: 1 });
  });
});

describe("Excelからの貼り付け", () => {
  const columns = buildEstimateColumns(FORMWORKS);

  it("型枠はID入力で種類名に変換し、部屋名は記号もそのまま取り込む", () => {
    const preview = buildPastePreview(
      [emptyRow()],
      columns,
      "内部\t1階\t✔\t3\t製品取出し室(1)〜(5)\t6.00\t1\tメモ",
      0,
      0,
      () => emptyRow(),
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0]).toMatchObject({
      part1: "内部",
      part2: "1階",
      part2Split: 1,
      formwork: "地上階",
      part3: "製品取出し室(1)〜(5)",
      ceilingHeight: 6,
      multiplier: 1,
      note: "メモ",
    });
  });

  it("マスターに無い型枠の文字も入力できる", () => {
    const preview = buildPastePreview(
      [emptyRow()],
      columns,
      "\t\t\t特殊型枠",
      0,
      0,
      () => emptyRow(),
    );
    expect(preview.rows[0].formwork).toBe("特殊型枠");
  });

  it("天井高さに数値以外を貼るとエラーになる", () => {
    const preview = buildPastePreview(
      [emptyRow()],
      columns,
      "\t\t\t\t\tあいう",
      0,
      0,
      () => emptyRow(),
    );
    expect(preview.errorCount).toBe(1);
  });
});

describe("duplicateRoomFlags", () => {
  const partRow = (
    part1: string,
    part2: string,
    part3: string,
  ): EstimateRowDraft => ({ ...emptyRow(), part1, part2, part3 });

  it("部位Ⅰ＋部位Ⅱ＋部位Ⅲが同じ部屋の行に印を付ける", () => {
    const rows = [
      partRow("内部", "1F", "事務所"),
      partRow("内部", "1F", "事務所"),
      partRow("内部", "2F", "事務所"),
      partRow("外部", "1F", "事務所"),
      subtotalRow(),
      partRow("", "", ""),
    ];
    expect(duplicateRoomFlags(rows)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("部位Ⅰ・部位Ⅱが空欄の行は上の行を引き継いで見る", () => {
    const rows = [
      partRow("内部", "1F", "事務所"),
      partRow("", "", "事務所"),
      partRow("", "2F", "事務所"),
      partRow("", "", "事務所"),
    ];
    expect(duplicateRoomFlags(rows)).toEqual([true, true, true, true]);
  });
});
