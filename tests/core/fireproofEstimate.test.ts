import { describe, expect, it } from "vitest";
import {
  autoSectionFormula,
  calcColumnRow,
  columnSheetTotals,
  findColumnSize,
  manageRowQuantity,
  newColumnRow,
  newManageRow,
  normalizeManageRows,
  wallFactor,
  type FireproofColumnRow,
  type FireproofManageRow,
} from "../../src/core/fireproof/fireproofEstimate";
import {
  fireproofId,
  newMember,
  type FireproofFloorList,
} from "../../src/core/fireproof/fireproofList";

/** 1階だけ・柱C1が□250*250 のリスト */
function list(): FireproofFloorList {
  const member = newMember("C1");
  const floors = [{ id: fireproofId("f"), label: "1" }];
  member.sizes[floors[0].id] = { shape: "box", first: 250, second: 250 };
  return { floors, members: [member] };
}

function columnRow(patch: Partial<FireproofColumnRow>): FireproofColumnRow {
  return { ...newColumnRow("1", "C1"), ...patch };
}

describe("耐火被覆・塗装入力表", () => {
  it("記号と階から鉄骨リスト（柱）の寸法を拾う", () => {
    expect(findColumnSize(list(), "1", "C1")).toMatchObject({
      shape: "box",
      first: 250,
      second: 250,
    });
    expect(findColumnSize(list(), "2", "C1")).toBeNull();
    expect(findColumnSize(list(), "1", "C9")).toBeNull();
  });

  it("□型の断面必要計算式を自動で作る（Ｗ×取合＋厚み×(取合−1)）", () => {
    expect(autoSectionFormula("box", 250, 3, 25)).toBe("0.25*3+0.025*2");
    expect(autoSectionFormula("box", 250, 4, 25)).toBe("0.25*4+0.025*3");
    expect(autoSectionFormula("box", 250, 2, 25)).toBe("0.25*2+0.025");
    expect(autoSectionFormula("box", 250, 1, 25)).toBe("0.25*1");
    // Ｈ形は取合対応表ができるまで自動で作らない
    expect(autoSectionFormula("h", 250, 3, 25)).toBe("");
    expect(autoSectionFormula("box", null, 3, 25)).toBe("");
  });

  it("壁取合の本数は取合ごとに決まる（4:0、3:2、2:2、1:2）", () => {
    expect(wallFactor(4)).toBe(0);
    expect(wallFactor(3)).toBe(2);
    expect(wallFactor(2)).toBe(2);
    expect(wallFactor(1)).toBe(2);
    expect(wallFactor(null)).toBe(0);
  });

  it("必要数㎡＝断面×計算式(有効長)×倍数、壁取合m＝有効長×取合の本数", () => {
    const calc = calcColumnRow(
      columnRow({ count: 4, faces: 3, lengthFormula: "3.42" }),
      list(),
      25,
    );
    expect(calc.sectionText).toBe("0.25*3+0.025*2");
    expect(calc.section).toBeCloseTo(0.8, 6);
    expect(calc.needed).toBeCloseTo(10.94, 2);
    expect(calc.wall).toBeCloseTo(6.84, 2);
  });

  it("断面必要計算式を欄に打つとそれが優先される", () => {
    const calc = calcColumnRow(
      columnRow({
        count: 1,
        faces: 3,
        lengthFormula: "2",
        sectionFormula: "0.5",
      }),
      list(),
      25,
    );
    expect(calc.sectionText).toBe("0.5");
    expect(calc.needed).toBeCloseTo(1, 6);
  });

  it("柱入力表の合計と管理表の数量（倍率をかける）", () => {
    const row: FireproofManageRow = {
      ...newManageRow(),
      multiplier: 2,
      sheet: {
        thickness: 25,
        rows: [
          columnRow({ count: 4, faces: 3, lengthFormula: "3.42" }),
          columnRow({ count: 1, faces: 4, lengthFormula: "3.42" }),
        ],
      },
    };
    const totals = columnSheetTotals(row.sheet, list());
    // 4面の行は 0.25*4+0.025*3 ＝ 1.075 → 1.075*3.42 ＝ 3.6765
    expect(totals.needed).toBeCloseTo(10.94 + 3.6765, 2);
    expect(totals.wall).toBeCloseTo(6.84, 2);
    expect(manageRowQuantity(row, list())).toBeCloseTo(
      (totals.needed ?? 0) * 2,
      6,
    );
    // 計算書が空の行は数量なし
    expect(
      manageRowQuantity({ ...newManageRow(), multiplier: null }, list()),
    ).toBeNull();
  });

  it("空・古い保存でも入力管理表として読める", () => {
    expect(normalizeManageRows(null)).toEqual([]);
    const rows = normalizeManageRows([{ part1: "1階" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].part1).toBe("1階");
    expect(rows[0].multiplier).toBeNull();
    expect(rows[0].detail.name).toBe("");
    expect(rows[0].sheet.rows).toEqual([]);
  });
});
