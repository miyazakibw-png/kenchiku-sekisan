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
  furnitureSettingsFor,
  hasTripleWidth,
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

  it("列の合計は各行の値（計算式も可）×その行の数量を足したもの", () => {
    // rows[1]: 2 × 数量1, rows[2]: (1+2) × 数量5
    expect(furnitureColumnTotal(rowsWithValues(), "c1")).toBe(17);
  });

  it("数量が未入力の行は上の行の数量を使い、どこにも無ければ1とする", () => {
    const rows = rowsWithValues();
    rows[2].quantity = "";
    expect(furnitureColumnTotal(rows, "c1")).toBe(5);
    rows[0].quantity = "";
    rows[1].quantity = "";
    expect(furnitureColumnTotal(rows, "c1")).toBe(5);
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

  it("列の合計・集計でもW・H・Dが使える（数量を掛ける）", () => {
    const rows = sample();
    rows[1].values = { c1: "W" }; // 1.2 × 1
    rows[2].values = { c1: "H" }; // 2.17 × 5
    expect(furnitureColumnTotal(rows, "c1")).toBe(12.05);
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
    // 値 × 行の数量 × 表の倍率
    expect(vertical[0].setTotal).toBe(2);
    expect(vertical[0].quantity).toBe(4);
    expect(vertical[1].setTotal).toBe(15);
    expect(vertical[1].quantity).toBe(30);
    expect(vertical[0].name).toBe("カウンター取付");
    expect(vertical[0].sourceKind).toBe("furniture");
  });
});

describe("システムキッチン（W1・W2・W3）", () => {
  const kitchen = furnitureSettingsFor("kitchen");

  function kitchenRow(patch: Parameters<typeof furnitureRow>[0]) {
    return furnitureRow({
      part: "1",
      partSymbol: "K",
      nameSymbol: "S",
      height: "850",
      depth: "650",
      quantity: "1",
      unit: "ヶ所",
      ...patch,
    });
  }

  it("システムキッチンと洗面化粧台はW欄が3つ", () => {
    expect(hasTripleWidth("kitchen")).toBe(true);
    expect(hasTripleWidth("washstand")).toBe(true);
    expect(hasTripleWidth("furniture")).toBe(false);
    expect(hasTripleWidth("other")).toBe(false);
  });

  it("洗面化粧台は作りはキッチンと同じで、初めの記号表は洗面用（基準は別）", () => {
    const washstand = furnitureSettingsFor("washstand");
    expect(washstand.partSymbols).toEqual([
      { symbol: "S", text: "洗面脱衣室" },
      { symbol: "T", text: "トイレ" },
    ]);
    expect(washstand.nameSymbols).toEqual([{ symbol: "S", text: "洗面化粧台" }]);
    expect(washstand).toMatchObject({
      width2Label: "+",
      width3Label: "+",
      lShapeLabel: "(L型)",
      uShapeLabel: "(コ型)",
    });
    const rows = applyFurnitureDetails(
      [
        furnitureRow({
          partSymbol: "S",
          nameSymbol: "S",
          width: "900",
          width2: "600",
          height: "1900",
          depth: "500",
        }),
      ],
      washstand,
    );
    expect(rows[0].detail.partName).toBe("洗面脱衣室");
    expect(rows[0].detail.name).toBe("洗面化粧台");
    expect(rows[0].detail.descriptionLower).toBe("W900+600(L型)*H1900*D500");
  });

  it("初めの設定は種類ごと（キッチンは記号表がキッチン用・W2/W3の文字は+・(L型)・(コ型)）", () => {
    expect(kitchen.partSymbols).toEqual([
      { symbol: "K", text: "キッチン" },
      { symbol: "LDK", text: "LDK" },
    ]);
    expect(kitchen.nameSymbols.map((item) => item.text)).toEqual([
      "システムキッチン",
      "ミニキッチン",
      "キッチンセット",
    ]);
    expect(kitchen).toMatchObject({
      partPrefix: "",
      partSuffix: "ﾀｲﾌﾟ",
      addPrefix: "(",
      addSuffix: "F)",
      widthLabel: "W",
      width2Label: "+",
      width3Label: "+",
      lShapeLabel: "(L型)",
      uShapeLabel: "(コ型)",
      heightLabel: "*H",
      depthLabel: "*D",
    });
    expect(furnitureSettingsFor("furniture")).toEqual(furnitureSettings());
    expect(furnitureSettingsFor("other")).toEqual(furnitureSettings());
  });

  it("W1だけ→家具と同じ、W2あり・W3なし→(L型)、W3あり→(コ型)を摘要下段に付ける", () => {
    const rows = applyFurnitureDetails(
      [
        kitchenRow({ width: "2550" }),
        kitchenRow({ width: "2550", width2: "1800" }),
        kitchenRow({ width: "2550", width2: "1800", width3: "1650" }),
        kitchenRow({ width: "2550", width2: "", width3: "1650" }),
        kitchenRow({ width: "", width2: "1800" }),
      ],
      kitchen,
    );
    expect(rows[0].detail.partName).toBe("1ﾀｲﾌﾟキッチン");
    expect(rows[0].detail.name).toBe("システムキッチン");
    expect(rows[0].detail.descriptionLower).toBe("W2550*H850*D650");
    expect(rows[1].detail.descriptionLower).toBe("W2550+1800(L型)*H850*D650");
    expect(rows[2].detail.descriptionLower).toBe(
      "W2550+1800+1650(コ型)*H850*D650",
    );
    expect(rows[3].detail.descriptionLower).toBe("W2550+1650(コ型)*H850*D650");
    expect(rows[4].detail.descriptionLower).toBe("W+1800(L型)*H850*D650");
  });

  it("設定の文字を変えると摘要に反映する", () => {
    const custom = furnitureSettingsFor("kitchen", {
      width2Label: "×",
      width3Label: "×",
      lShapeLabel: "L",
      uShapeLabel: "U",
    });
    const rows = applyFurnitureDetails(
      [
        kitchenRow({ width: "2550", width2: "1800" }),
        kitchenRow({ width: "2550", width2: "1800", width3: "900" }),
      ],
      custom,
    );
    expect(rows[0].detail.descriptionLower).toBe("W2550×1800L*H850*D650");
    expect(rows[1].detail.descriptionLower).toBe("W2550×1800×900U*H850*D650");
  });

  it("古い保存（width2/width3が無い行）は家具と同じ", () => {
    const row = furnitureRow({ width: "1200", height: "1100" });
    delete row.width2;
    delete row.width3;
    const rows = applyFurnitureDetails([row], kitchen);
    expect(rows[0].detail.descriptionLower).toBe("W1200*H1100");
    expect(furnitureCellValue(row, "W*H")).toBe(1.32);
  });

  it("計算式ではW1・W2・W3をm換算で使え、WはW1+W2+W3の合計", () => {
    const row = kitchenRow({ width: "2550", width2: "1800", width3: "1650" });
    expect(furnitureCellValue(row, "W1")).toBe(2.55);
    expect(furnitureCellValue(row, "W2")).toBe(1.8);
    expect(furnitureCellValue(row, "W3")).toBe(1.65);
    expect(furnitureCellValue(row, "W")).toBe(6);
    expect(furnitureCellValue(row, "w1+w2")).toBe(4.35);
    expect(furnitureCellValue(row, "W*D")).toBe(3.9);
    const rows = [row];
    rows[0].detail = { ...rows[0].detail, formula: "W1*H" };
    const resolved = resolveFurnitureRows(rows);
    expect(rowQuantity(rows[0], resolved[0])).toBe(2.17);
    expect(furnitureCellValue(kitchenRow({ width: "2550" }), "W")).toBe(2.55);
  });

  it("建具転記の幅はW1+W2+W3の合計（m換算）", () => {
    const fittings = fittingsFromFurniture({
      rows: [kitchenRow({ width: "2550", width2: "1800" })],
      settings: kitchen,
    });
    expect(fittings).toHaveLength(1);
    expect(fittings[0]).toMatchObject({ symbol: "1KS", width: 4.35, height: 0.85 });
  });

  it("行コピーでW2・W3も写る", () => {
    const rows = [kitchenRow({ width: "2550", width2: "1800", width3: "900" })];
    const pasted = pasteFurnitureRows(rows, 0, rows, "append");
    expect(pasted[1]).toMatchObject({ width: "2550", width2: "1800", width3: "900" });
    expect(pasted[1].id).not.toBe(rows[0].id);
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
