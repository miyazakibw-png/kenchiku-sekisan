import { describe, expect, it } from "vitest";
import {
  applyFurnitureDetails,
  entriesFromFurnitureSheet,
  fittingsFromFurniture,
  furnitureCellValue,
  furnitureColumn,
  furnitureColumnTotal,
  furnitureRow,
  furnitureSettings,
  resolveFurnitureRows,
  rowQuantity,
  symbolText,
} from "../../src/core/furniture/furnitureSheet";

const settings = furnitureSettings({
  partSymbols: [{ symbol: "GE", text: "玄関" }],
  nameSymbols: [
    { symbol: "G", text: "下足入" },
    { symbol: "IS", text: "インフィル収納" },
  ],
});

function sample(): ReturnType<typeof furnitureRow>[] {
  return [
    furnitureRow({
      id: "r1",
      subjectId: 42,
      partNumber: 300,
      detailNumber: 100,
      nameSymbol: "＜Ａタイプ＞",
      quantity: "0",
    }),
    furnitureRow({
      id: "r2",
      part: "A",
      partAdd: "2",
      partSymbol: "GE",
      nameSymbol: "G",
      width: "1200",
      height: "1100",
      depth: "400",
      quantity: "1",
      unit: "ヶ所",
      remarksLower: "設計標準ﾁｪｯｸﾘｽﾄ",
    }),
    furnitureRow({
      id: "r3",
      partSymbol: "GE",
      nameSymbol: "IS",
      width: "400",
      height: "2170",
      depth: "400",
      quantity: "5",
      unit: "ヶ所",
    }),
  ];
}

describe("家具計算書の引き継ぎ", () => {
  it("科目・部位ID・部位・数量は上の行と同じ、名称IDは+0.01", () => {
    const resolved = resolveFurnitureRows(sample());
    expect(resolved[1].subjectId).toBe(42);
    expect(resolved[1].partNumber).toBe(300);
    expect(resolved[1].detailNumber).toBe(100.01);
    expect(resolved[2].detailNumber).toBe(100.02);
    expect(resolved[2].part).toBe("A");
  });

  it("単位も未入力なら上の行と同じ（明細側にもその単位が出る）", () => {
    const rows = sample();
    rows[2].unit = "";
    const resolved = resolveFurnitureRows(rows);
    expect(resolved[2].unit).toBe("ヶ所");
    expect(applyFurnitureDetails(rows, settings)[2].detail.unit).toBe("ヶ所");
  });
});

describe("明細欄の自動作成", () => {
  it("部位は設定文字を付け、W・H・Dは摘要下段に出す", () => {
    const rows = applyFurnitureDetails(sample(), settings);
    expect(rows[1].detail.partName).toBe("Aﾀｲﾌﾟ(2F)玄関");
    expect(rows[1].detail.name).toBe("下足入");
    expect(rows[1].detail.descriptionLower).toBe("W1200*H1100*D400");
    expect(rows[1].detail.unit).toBe("ヶ所");
    expect(rows[1].detail.remarksLower).toBe("設計標準ﾁｪｯｸﾘｽﾄ");
  });

  it("記号は全角・小文字・空白の違いがあっても文字に変わる（表に無いものはそのまま）", () => {
    const symbols = settings.nameSymbols;
    expect(symbolText(symbols, "Ｇ")).toBe("下足入");
    expect(symbolText(symbols, "g")).toBe("下足入");
    expect(symbolText(symbols, " IS ")).toBe("インフィル収納");
    expect(symbolText(symbols, "ＩＳ")).toBe("インフィル収納");
    expect(symbolText(symbols, "CL")).toBe("CL");
    expect(symbolText(symbols, "")).toBe("");
    const rows = sample();
    rows[2].nameSymbol = "ｉｓ";
    expect(applyFurnitureDetails(rows, settings)[2].detail.name).toBe(
      "インフィル収納",
    );
  });

  it("手で直した欄は自動作成で上書きしない", () => {
    const rows = sample();
    rows[1].detail = {
      ...rows[1].detail,
      name: "下足入（特注）",
      edited: ["name"],
    };
    const applied = applyFurnitureDetails(rows, settings);
    expect(applied[1].detail.name).toBe("下足入（特注）");
    expect(applied[1].detail.partName).toBe("Aﾀｲﾌﾟ(2F)玄関");
  });
});

describe("数量", () => {
  it("0はタイトル行なので数量にしない", () => {
    const rows = sample();
    const resolved = resolveFurnitureRows(rows);
    expect(rowQuantity(rows[0], resolved[0])).toBeNull();
    expect(rowQuantity(rows[1], resolved[1])).toBe(1);
  });

  it("計算式ではW・H・Dをm換算で使える（未入力は上の行の式）", () => {
    const rows = sample();
    rows[1].detail = { ...rows[1].detail, formula: "W*H" };
    const resolved = resolveFurnitureRows(rows);
    expect(rowQuantity(rows[1], resolved[1])).toBe(1.32);
    expect(rowQuantity(rows[2], resolved[2])).toBe(0.87);
  });
});

describe("集計と建具転記", () => {
  it("空の明細と数量0の行は集計しない", () => {
    const entries = entriesFromFurnitureSheet(
      {
        sheetId: 3,
        part1: "建築",
        part2: "2階",
        part2Split: true,
        part3: "システム収納",
        multiplier: 2,
      },
      { rows: sample(), settings },
      new Map(),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].traceId).toBe("furniture:3:r2");
    expect(entries[0].quantity).toBe(2);
    expect(entries[0].part3).toBe("システム収納");
  });

  it("名称の記号は明細側で設定の文字に変わる（表に無い文字はそのまま）", () => {
    const view = applyFurnitureDetails(sample(), settings);
    expect(view[1].detail.name).toBe("下足入");
    expect(view[2].detail.name).toBe("インフィル収納");
    expect(view[0].detail.name).toBe("＜Ａタイプ＞");
  });

  it("建具記号は入力した英数字をつなげ、寸法はm換算する", () => {
    const fittings = fittingsFromFurniture({ rows: sample(), settings });
    expect(fittings).toHaveLength(2);
    expect(fittings[0]).toMatchObject({
      symbol: "A2GEG",
      width: 1.2,
      height: 1.1,
    });
    expect(fittings[1].symbol).toBe("AGEIS");
  });
});

describe("タテ方向の明細（列）", () => {
  const column = furnitureColumn({
    id: "c1",
    subjectId: 42,
    partNumber: 300,
    detailNumber: 12.5,
    partName: "家具",
    name: "カウンター取付",
    unit: "ヶ所",
  });

  function rowsWithValues(): ReturnType<typeof furnitureRow>[] {
    const rows = sample();
    rows[1].values = { c1: "2" };
    rows[2].values = { c1: "1+2" };
    return rows;
  }

  it("列の合計は各行の数量（計算式も可）を足したもの", () => {
    expect(furnitureColumnTotal(rowsWithValues(), "c1")).toBe(5);
  });

  it("計算式では行のW・H・D（mm→m）が使える（全角・小文字も）", () => {
    const row = sample()[1]; // W1200 H1100 D400
    expect(furnitureCellValue(row, "W*H")).toBe(1.32);
    expect(furnitureCellValue(row, "Ｗ＊Ｈ")).toBe(1.32);
    expect(furnitureCellValue(row, "(w+d)*2")).toBe(3.2);
    expect(furnitureCellValue(row, "2*3")).toBe(6);
    expect(furnitureCellValue(row, "")).toBeNull();
    expect(furnitureCellValue(furnitureRow(), "W*H")).toBe(0);
  });

  it("列の合計・集計でもW・H・Dが使える", () => {
    const rows = sample();
    rows[1].values = { c1: "W" };
    rows[2].values = { c1: "H" };
    expect(furnitureColumnTotal(rows, "c1")).toBe(3.37);
  });

  it("ヨコの自動明細とは別のtraceIdで集計する", () => {
    const entries = entriesFromFurnitureSheet(
      {
        sheetId: 3,
        part1: "建築",
        part2: "2階",
        part2Split: true,
        part3: "システム収納",
        multiplier: 2,
      },
      { rows: rowsWithValues(), settings, columns: [column] },
      new Map(),
    );
    const vertical = entries.filter((entry) =>
      entry.traceId.startsWith("furniturecol:"),
    );
    expect(vertical.map((entry) => entry.traceId)).toEqual([
      "furniturecol:3:r2:c1",
      "furniturecol:3:r3:c1",
    ]);
    expect(vertical[0].quantity).toBe(4);
    expect(vertical[1].quantity).toBe(6);
    expect(vertical[0].name).toBe("カウンター取付");
    expect(vertical[0].sourceKind).toBe("furniture");
  });
});
