import { describe, expect, it } from "vitest";
import { inflateRawSync } from "zlib";
import { columnName, toXlsx, xlsxSheetName } from "../../src/core/export/xlsx";

/** zip の中の1つの中身を取り出す（テスト用の簡単な読み取り） */
function entry(file: Buffer, name: string): string {
  let offset = 0;
  while (offset + 30 <= file.length) {
    if (file.readUInt32LE(offset) !== 0x04034b50) break;
    const compressedSize = file.readUInt32LE(offset + 18);
    const nameLength = file.readUInt16LE(offset + 26);
    const extraLength = file.readUInt16LE(offset + 28);
    const entryName = file
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    if (entryName === name) {
      return inflateRawSync(file.subarray(start, start + compressedSize)).toString(
        "utf8",
      );
    }
    offset = start + compressedSize;
  }
  throw new Error(`${name} が見つかりません`);
}

describe("エクセル（.xlsx）の書き出し", () => {
  it("列名を A, B, ... AA の順に作る", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
  });

  it("シート名は使えない文字を置き換え、重複は連番にする", () => {
    const used: string[] = [];
    expect(xlsxSheetName("集計/表", 0, used)).toBe("集計･表");
    used.push("集計･表");
    expect(xlsxSheetName("集計/表", 1, used)).toBe("集計･表(2)");
  });

  it("zip の中にシートと書式を入れ、困る文字は逃がす", () => {
    const file = toXlsx([
      {
        name: "内訳書",
        columnWidths: [20, 10],
        rows: [
          [
            { value: "名称", kind: "header", border: "one" },
            { value: "数量", kind: "header", border: "one" },
          ],
          [
            { value: "<SD2>&A", kind: "text", border: "upper" },
            { value: 1.5, kind: "number", border: "lower" },
          ],
        ],
      },
    ]);
    expect(file.subarray(0, 2).toString("latin1")).toBe("PK");
    const sheet = entry(file, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain("&lt;SD2&gt;&amp;A");
    expect(sheet).toContain("<v>1.5</v>");
    expect(entry(file, "xl/workbook.xml")).toContain('name="内訳書"');
    expect(entry(file, "xl/styles.xml")).toContain("#,##0.00");
  });
});
