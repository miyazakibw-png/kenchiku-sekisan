import { describe, expect, it } from "vitest";
import {
  numberOf,
  sheetName,
  toScreenSheets,
  toScreenWorkbook,
} from "../../src/core/export/screenSheet";

describe("画面のエクセル掃き出し", () => {
  it("数字だけのセルは数値、桁区切りは外す", () => {
    expect(numberOf("12.35")).toBe(12.35);
    expect(numberOf("1,800")).toBe(1800);
    expect(numberOf("-3")).toBe(-3);
    expect(numberOf("2*3")).toBeNull();
    expect(numberOf("")).toBeNull();
  });

  it("シート名は使えない文字を置き換え、重複は連番にする", () => {
    const used: string[] = [];
    expect(sheetName("部屋計算書", 0, used)).toBe("部屋計算書");
    used.push("部屋計算書");
    expect(sheetName("部屋計算書", 1, used)).toBe("部屋計算書(2)");
    expect(sheetName("集計/表", 2, used)).toBe("集計･表");
    expect(sheetName("", 3, used)).toBe("シート4");
  });

  it("入力表ごとに1シートで、1行目は見出しになる", () => {
    const book = toScreenSheets([
      {
        name: "建具表",
        rows: [
          ["建具記号", "W"],
          ["SD2", "1.80"],
        ],
      },
      { name: "部屋計算書", rows: [["名称"], ["ビニル床シート"]] },
    ]);
    expect(book.map((sheet) => sheet.name)).toEqual(["建具表", "部屋計算書"]);
    expect(book[0].rows[0][0]).toMatchObject({
      value: "建具記号",
      kind: "header",
    });
    expect(book[0].rows[1][1]).toMatchObject({ value: 1.8, kind: "number" });
    // 見出し行は数字に見えても文字のまま
    expect(
      toScreenSheets([{ name: "表", rows: [["1"]] }])[0].rows[0][0],
    ).toMatchObject({ value: "1", kind: "header" });
  });

  it(".xlsx（zip）として書き出す", () => {
    const file = toScreenWorkbook([
      { name: "表", rows: [["名称"], ["<SD2>&A"]] },
    ]);
    expect(file.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(file.length).toBeGreaterThan(0);
  });
});
