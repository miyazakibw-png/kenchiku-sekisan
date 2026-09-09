import { describe, expect, it } from "vitest";
import {
  normalizePastedCell,
  parseTsv,
  toHalfWidth,
  toTsv,
} from "../../src/shared/tsv";

describe("TSV（Excelクリップボード形式）の相互変換", () => {
  it("タブ区切り・改行を行列に分解する", () => {
    expect(parseTsv("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseTsv("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("セル内改行・タブ・二重引用符を含むセルを解釈する", () => {
    expect(parseTsv('"1行目\n2行目"\tb')).toEqual([["1行目\n2行目", "b"]]);
    expect(parseTsv('"a""b"\tc')).toEqual([['a"b', "c"]]);
    expect(parseTsv('"タブ\tあり"\tx')).toEqual([["タブ\tあり", "x"]]);
  });

  it("Excelへ貼れるTSVを生成する", () => {
    expect(toTsv([["a", "b"]])).toBe("a\tb");
    expect(toTsv([["改\n行", "b"]])).toBe('"改\n行"\tb');
    expect(toTsv([['a"b', "c"]])).toBe('"a""b"\tc');
  });

  it("全角を半角へ変換する", () => {
    expect(toHalfWidth("３０２．５０")).toBe("302.50");
    expect(toHalfWidth("ＡＢＣ")).toBe("ABC");
  });

  it("貼り付け値を正規化する（空白・アポストロフィ・桁区切り）", () => {
    expect(normalizePastedCell("  302.50  ")).toBe("302.50");
    expect(normalizePastedCell("'0012")).toBe("0012");
    expect(normalizePastedCell("1,234.56")).toBe("1234.56");
    expect(normalizePastedCell("コンクリート")).toBe("コンクリート");
  });
});
