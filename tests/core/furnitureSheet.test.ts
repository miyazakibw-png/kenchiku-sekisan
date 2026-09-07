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
  pasteFurnitureRows,
  resolveFurnitureRows,
  revertFurnitureDetail,
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

  it("手で直した欄は1欄だけ・行ごとに自動作成（記号からの変換）に戻せる", () => {
    const rows = sample();
    rows[1].detail = {
      ...rows[1].detail,
      name: "下足入（特注）",
      partName: "玄関ホール",
      edited: ["name", "partName"],
    };
    rows[1] = revertFurnitureDetail(rows[1], ["name"]);
    expect(rows[1].detail.edited).toEqual(["partName"]);
    let applied = applyFurnitureDetails(rows, settings);
    expect(applied[1].detail.name).toBe("下足入");
    expect(applied[1].detail.partName).toBe("玄関ホール");
    rows[1] = revertFurnitureDetail(rows[1]);
    expect(rows[1].detail.edited).toEqual([]);
    applied = applyFurnitureDetails(rows, settings);
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

describe("家具計算書の行コピー・貼り付け", () => {
  const copied = () => {
    const rows = sample();
    return [
      {
        ...rows[1],
        detail: { ...rows[1].detail, name: "手直し", edited: ["name"] },
        values: { c1: "2*2" },
      },
      rows[2],
    ];
  };

  it("上書貼付：カーソルの行から順に置き換え、足りない分は末尾へ足す", () => {
    const rows = sample();
    const over = pasteFurnitureRows(rows, 2, copied(), "over");
    expect(over).toHaveLength(4);
    expect(over.slice(0, 2).map((row) => row.id)).toEqual(["r1", "r2"]);
    expect(over[2].nameSymbol).toBe("G");
    expect(over[3].nameSymbol).toBe("IS");
    const head = pasteFurnitureRows(rows, 0, copied(), "over");
    expect(head).toHaveLength(3);
    expect(head.map((row) => row.nameSymbol)).toEqual(["G", "IS", "IS"]);
    expect(head[2].id).toBe("r3");
  });

  it("挿入貼付：カーソルの行の上へ入る", () => {
    const rows = sample();
    const inserted = pasteFurnitureRows(rows, 1, copied(), "insert");
    expect(inserted).toHaveLength(5);
    expect(inserted[0].id).toBe("r1");
    expect(inserted[1].nameSymbol).toBe("G");
    expect(inserted[2].nameSymbol).toBe("IS");
    expect(inserted[3].id).toBe("r2");
    expect(inserted[4].id).toBe("r3");
  });

  it("追加貼付：カーソル位置に関係なく最終行の下へ", () => {
    const rows = sample();
    const appended = pasteFurnitureRows(rows, 0, copied(), "append");
    expect(appended.map((row) => row.id).slice(0, 3)).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
    expect(appended[3].nameSymbol).toBe("G");
    expect(appended[4].nameSymbol).toBe("IS");
  });

  it("貼った行は別のidになり、手直しの明細とタテの数量も写す（元とは別々に直せる）", () => {
    const rows = sample();
    const source = copied();
    const appended = pasteFurnitureRows(rows, 0, source, "append");
    const ids = new Set(appended.map((row) => row.id));
    expect(ids.size).toBe(appended.length);
    expect(appended[3].id).not.toBe("r2");
    expect(appended[3].detail.name).toBe("手直し");
    expect(appended[3].detail.edited).toEqual(["name"]);
    expect(appended[3].values).toEqual({ c1: "2*2" });
    expect(appended[3].detail.edited).not.toBe(source[0].detail.edited);
    expect(appended[3].values).not.toBe(source[0].values);
    const twice = pasteFurnitureRows(appended, 0, source, "append");
    expect(new Set(twice.map((row) => row.id)).size).toBe(twice.length);
  });

  it("何もコピーしていなければそのまま", () => {
    const rows = sample();
    expect(pasteFurnitureRows(rows, 1, [], "insert")).toBe(rows);
  });
});
