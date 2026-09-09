import { describe, expect, it } from "vitest";
import {
  calcPrintRows,
  paginateCalcRows,
  type CalcPrintRow,
} from "../../src/core/print/calcPrint";
import {
  calcDetail,
  calcLine,
  calcSet,
  commentSet,
  evaluateCalcSheet,
  type CalcSet,
} from "../../src/core/room/calcSheet";

function sheet(): CalcSet[] {
  const one = calcSet(0);
  one.partName = "床";
  one.details = [
    calcDetail({ name: "ビニル床シート", unit: "m2", coefficient: 1 }),
    calcDetail({ name: "下地", unit: "m2", coefficient: 1 }),
  ];
  one.lines = [
    calcLine({ formulaA: "2*3", comment: "居室" }),
    calcLine({ formulaA: "4" }),
  ];
  return [commentSet("1階", "#fde68a"), one];
}

describe("計算書の印刷", () => {
  it("見出し行と明細行を紙の並びに直す", () => {
    const sets = sheet();
    const result = evaluateCalcSheet(sets, {});
    const rows = calcPrintRows(sets, result);
    expect(rows).toHaveLength(3);
    expect(rows[0].banner?.text).toBe("1階");
    expect(rows[1].setPart).toBe("床");
    expect(rows[1].name).toBe("ビニル床シート");
    expect(rows[1].value).toBe("6.00");
    expect(rows[2].setPart).toBe("");
    expect(rows[2].total).toBe("10.00");
    // 部位合計は明細の掛け率を掛けたセットの累計
    expect(rows[1].setTotal).toBe("10.00");
  });

  it("1枚に収まるときは、余りを手書き用の横罫線で埋める", () => {
    const rows: CalcPrintRow[] = calcPrintRows(
      sheet(),
      evaluateCalcSheet(sheet(), {}),
    );
    const pages = paginateCalcRows(rows, 10, 30);
    expect(pages).toHaveLength(1);
    expect(pages[0].rows).toHaveLength(3);
    expect(pages[0].blankRows).toBe(7);
  });

  it("1枚で収まらないときは2枚目へ続け、最後の紙の下も罫線で埋める", () => {
    const rows: CalcPrintRow[] = Array.from({ length: 25 }, () => ({
      ...calcPrintRows(sheet(), evaluateCalcSheet(sheet(), {}))[1],
    }));
    const pages = paginateCalcRows(rows, 8, 12);
    expect(pages).toHaveLength(3);
    expect(pages[0].rows).toHaveLength(8);
    expect(pages[0].blankRows).toBe(0);
    expect(pages[1].rows).toHaveLength(12);
    expect(pages[1].blankRows).toBe(0);
    expect(pages[2].rows).toHaveLength(5);
    expect(pages[2].blankRows).toBe(7);
  });

  it("上段で1枚目が埋まっているときは、1枚目に明細を出さない", () => {
    const rows: CalcPrintRow[] = Array.from({ length: 3 }, () => ({
      ...calcPrintRows(sheet(), evaluateCalcSheet(sheet(), {}))[1],
    }));
    const pages = paginateCalcRows(rows, 0, 10);
    expect(pages).toHaveLength(2);
    expect(pages[0].rows).toHaveLength(0);
    expect(pages[1].rows).toHaveLength(3);
    expect(pages[1].blankRows).toBe(7);
  });
});
