import { describe, expect, it } from "vitest";
import {
  autoSectionFormula,
  calcColumnRow,
  columnSheetTotals,
  defaultWallLabels,
  emptyManageDetail,
  entriesFromFireproofSheet,
  findColumnSize,
  inheritedFloors,
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

  it("□型の断面必要計算式を自動で作る（資料の図どおり・厚みは小数3桁）", () => {
    expect(autoSectionFormula("box", 250, 250, 4, 25)).toBe(
      "0.25*2+0.25*2+0.025*4",
    );
    expect(autoSectionFormula("box", 250, 250, 3, 25)).toBe(
      "0.25*2+0.25+0.025*2",
    );
    expect(autoSectionFormula("box", 250, 250, 2, 25)).toBe("0.25+0.25+0.025");
    expect(autoSectionFormula("box", 250, 250, 1, 25)).toBe("0.25");
    expect(autoSectionFormula("box", null, 250, 3, 25)).toBe("");
    // 厚みが未入力・0以下のときは自動で出さない（1面は厚みを使わないので出る）
    expect(autoSectionFormula("box", 250, 250, 4, null)).toBe("");
    expect(autoSectionFormula("box", 250, 250, 4, 0)).toBe("");
    expect(autoSectionFormula("box", 250, 250, 1, null)).toBe("0.25");
  });

  it("Ｈ鋼の断面必要計算式を自動で作る（資料の図どおり）", () => {
    expect(autoSectionFormula("h", 250, 125, 4, 25)).toBe(
      "0.25*2+0.125*4+0.025*4",
    );
    expect(autoSectionFormula("h", 250, 125, 3, 25)).toBe(
      "0.25*2+0.125*3+0.025*2",
    );
    expect(autoSectionFormula("h", 250, 125, 2, 25)).toBe(
      "0.25+0.125+0.125/2*2+0.025",
    );
    expect(autoSectionFormula("h", 250, 125, 1, 25)).toBe("0.125");
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
    expect(calc.sectionText).toBe("0.25*2+0.25+0.025*2");
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
        wallLabels: defaultWallLabels(),
        rows: [
          columnRow({ count: 4, faces: 3, lengthFormula: "3.42" }),
          columnRow({ count: 1, faces: 4, lengthFormula: "3.42" }),
        ],
      },
    };
    const totals = columnSheetTotals(row.sheet, list());
    // 4面の行は 0.25*2+0.25*2+0.025*4 ＝ 1.1 → 1.1*3.42 ＝ 3.762
    expect(totals.needed).toBeCloseTo(10.94 + 3.762, 2);
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

  it("階が空欄の行は上の行と同じ階で拾う", () => {
    const rows = [
      columnRow({ floor: "1" }),
      columnRow({ floor: "" }),
      columnRow({ floor: "2" }),
      columnRow({ floor: "" }),
    ];
    expect(inheritedFloors(rows)).toEqual(["1", "1", "2", "2"]);
    // 階を空欄にした行も上の階の寸法で計算する
    const totals = columnSheetTotals(
      {
        thickness: 25,
        wallLabels: defaultWallLabels(),
        rows: [
          columnRow({ count: 4, faces: 3, lengthFormula: "3.42" }),
          columnRow({
            floor: "",
            count: 4,
            faces: 3,
            lengthFormula: "3.42",
          }),
        ],
      },
      list(),
    );
    expect(totals.needed).toBeCloseTo(21.888, 2);
  });

  it("壁取合mは✔を付けたＡ・Ｂ・Ｃの欄で別々に合計する", () => {
    const totals = columnSheetTotals(
      {
        thickness: 25,
        wallLabels: defaultWallLabels(),
        rows: [
          columnRow({
            faces: 3,
            lengthFormula: "3.42",
            wallChecks: [true, false, false],
          }),
          columnRow({
            faces: 3,
            lengthFormula: "3.42",
            wallChecks: [true, true, false],
          }),
        ],
      },
      list(),
    );
    expect(totals.wall).toBeCloseTo(6.84 * 2, 2);
    expect(totals.wallMarks[0]).toBeCloseTo(6.84 * 2, 2);
    expect(totals.wallMarks[1]).toBeCloseTo(6.84, 2);
    // ✔の付いていない欄は空欄
    expect(totals.wallMarks[2]).toBeNull();
  });

  it("入力管理表の明細を集計に載せる（数量＝必要数㎡合計×倍率）", () => {
    const rows: FireproofManageRow[] = [
      {
        ...newManageRow(),
        part1: "1階",
        multiplier: 2,
        detail: { ...emptyManageDetail(), partName: "柱", name: "耐火被覆" },
        sheet: {
          thickness: 25,
          rows: [columnRow({ count: 4, faces: 3, lengthFormula: "3.42" })],
        },
      },
      // 部位名も名称も無い行は集計に載せない
      { ...newManageRow(), part1: "" },
    ];
    const entries = entriesFromFireproofSheet(rows, list(), new Map());
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceKind).toBe("fireproof");
    expect(entries[0].traceId).toBe(`fireproof:${rows[0].id}`);
    expect(entries[0].part1).toBe("1階");
    expect(entries[0].name).toBe("耐火被覆");
    // 10.94×2＝21.888 → 小数2桁表示で21.89
    expect(entries[0].quantity).toBeCloseTo(21.89, 2);
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
