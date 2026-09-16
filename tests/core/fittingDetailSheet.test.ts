import { describe, expect, it } from "vitest";
import {
  applyFurnitureDetails,
  composedSymbolText,
  entriesFromFurnitureSheet,
  furnitureRow,
  furnitureSettingsFor,
  hasTripleWidth,
  isConvertibleFitting,
  isFittingDetailSheet,
  mmPreciseText,
  patternSymbolText,
  resolveFurnitureRows,
  sizeText,
  syncFittingDetailRows,
  type FittingLink,
  type FurnitureSymbol,
} from "../../src/core/furniture/furnitureSheet";

const nameSymbols: FurnitureSymbol[] = [
  { symbol: "D", text: "ドア" },
  { symbol: "M", text: "窓" },
  { symbol: "S", text: "シャッター" },
  { symbol: "KB", text: "片開き" },
  { symbol: "OB", text: "親子開き" },
  { symbol: "RB", text: "両開き" },
  { symbol: "HI", text: "引き違い" },
  { symbol: "SD", text: "外倒し" },
  { symbol: "SDR", text: "外倒し連" },
];

const partSymbols: FurnitureSymbol[] = [
  { symbol: "Y[]", text: "洋間[]" },
  { symbol: "AW[]", text: "アルミ窓" },
];

describe("建具明細作成表", () => {
  it("種類は fittingDetail（家具・設備入力表の種類とは別。W欄は1つ）", () => {
    expect(isFittingDetailSheet("fittingDetail")).toBe(true);
    expect(isFittingDetailSheet("furniture")).toBe(false);
    expect(hasTripleWidth("fittingDetail")).toBe(false);
  });

  it("名称の記号は登録そのまま・組み合わせ変換・無い文字はそのまま", () => {
    expect(composedSymbolText(nameSymbols, "D")).toBe("ドア");
    expect(composedSymbolText(nameSymbols, "KBD")).toBe("片開きドア");
    expect(composedSymbolText(nameSymbols, "SDRM")).toBe("外倒し連窓");
    // 全角・小文字も同じ記号とみなす
    expect(composedSymbolText(nameSymbols, "ＫＢＤ")).toBe("片開きドア");
    // 組み合わせと同じ並びの登録記号があるときは登録記号が優先（完全一致）
    const withExact: FurnitureSymbol[] = [
      ...nameSymbols,
      { symbol: "KBD", text: "特注ドア" },
    ];
    expect(composedSymbolText(withExact, "KBD")).toBe("特注ドア");
    // 表に無い文字はそのまま（一部だけ変換できたときは変換した分＋そのまま）
    expect(composedSymbolText(nameSymbols, "XD")).toBe("Xドア");
    expect(composedSymbolText(nameSymbols, "アルミ")).toBe("アルミ");
  });

  it("部位はアルファベット+[]+数字以降。アルファベットと数字の間は「-」等自由", () => {
    expect(patternSymbolText(partSymbols, "Y-1")).toBe("洋間1");
    expect(patternSymbolText(partSymbols, "Y1")).toBe("洋間1");
    // 最初のアルファベット＋数字以降の残り全部に分ける（AW-3A→AW+3A）
    expect(patternSymbolText(partSymbols, "AW-3A")).toBe("アルミ窓3A");
    expect(patternSymbolText(partSymbols, "AW-3")).toBe("アルミ窓3");
    // 表に無いときは分解した記号をそのまま部位にする（RM5→RM-5）
    expect(patternSymbolText(partSymbols, "RM5")).toBe("RM-5");
    expect(patternSymbolText(partSymbols, "X-1")).toBe("X-1");
    // 数字が無い記号はそのまま（完全一致の登録があれば変換）
    expect(patternSymbolText(partSymbols, "US")).toBe("US");
    expect(patternSymbolText(partSymbols, "Y")).toBe("Y");
    // 完全一致の登録は記号→文字のまま
    const exact: FurnitureSymbol[] = [
      { symbol: "US", text: "ユニットシャッター" },
      { symbol: "P1", text: "ピット" },
    ];
    expect(patternSymbolText(exact, "US")).toBe("ユニットシャッター");
    expect(patternSymbolText(exact, "P1")).toBe("ピット");
  });

  it("部位欄は上の行を引き継がない（未入力はそのまま空欄。名称だけの見出し行に使える）", () => {
    const rows = [
      furnitureRow({ part: "AD1" }),
      furnitureRow({ part: "" }),
      furnitureRow({ part: "AW2" }),
    ];
    const resolved = resolveFurnitureRows(rows, "fittingDetail");
    expect(resolved.map((row) => row.part)).toEqual(["AD1", "", "AW2"]);
    // 家具計算書はこれまでどおり引き継ぐ
    const furniture = resolveFurnitureRows(rows, "furniture");
    expect(furniture.map((row) => row.part)).toEqual(["AD1", "AD1", "AW2"]);
  });

  it("数量欄も上の行を引き継がない（全行入力）", () => {
    const rows = [
      furnitureRow({ quantity: "3" }),
      furnitureRow({ quantity: "" }),
      furnitureRow({ quantity: "1" }),
    ];
    const resolved = resolveFurnitureRows(rows, "fittingDetail");
    expect(resolved.map((row) => row.quantity)).toEqual(["3", "", "1"]);
    // 家具計算書はこれまでどおり引き継ぐ
    const furniture = resolveFurnitureRows(rows, "furniture");
    expect(furniture.map((row) => row.quantity)).toEqual(["3", "3", "1"]);
  });

  it("表に無い部位記号の間の文字は設定で変えられる（はじめは「-」）", () => {
    const settings = furnitureSettingsFor("fittingDetail", {
      partSeparator: "・",
    });
    const rows = applyFurnitureDetails(
      [furnitureRow({ part: "RM5" })],
      settings,
      "fittingDetail",
    );
    expect(rows[0].detail.partName).toBe("RM・5");
    const def = furnitureSettingsFor("fittingDetail");
    const rows2 = applyFurnitureDetails(
      [furnitureRow({ part: "RM5" })],
      def,
      "fittingDetail",
    );
    expect(rows2[0].detail.partName).toBe("RM-5");
  });

  it("明細の部位は部位欄だけで作る（+部位に入った文字は含めない）", () => {
    const settings = furnitureSettingsFor("fittingDetail", {
      partSymbols: [{ symbol: "AD[]", text: "アルミドア[]" }],
      nameSymbols,
    });
    const rows = applyFurnitureDetails(
      [furnitureRow({ part: "AD1", partAdd: "KBD", nameSymbol: "KBD" })],
      settings,
      "fittingDetail",
    );
    expect(rows[0].detail.partName).toBe("アルミドア1");
    expect(rows[0].detail.name).toBe("片開きドア");
  });

  it("単位は入れたまま出る（2行目以降は上と同じ。基本マスターから選ぶ）", () => {
    const settings = furnitureSettingsFor("fittingDetail");
    const rows = applyFurnitureDetails(
      [
        furnitureRow({ unit: "本" }),
        furnitureRow({ unit: "" }),
        furnitureRow({ unit: "枚" }),
      ],
      settings,
      "fittingDetail",
    );
    expect(rows.map((row) => row.detail.unit)).toEqual(["本", "本", "枚"]);
  });

  it("名称IDは2行目以降+1（家具計算書の+0.01とは違う）", () => {
    const rows = [
      furnitureRow({ detailNumber: 1 }),
      furnitureRow({}),
      furnitureRow({ detailNumber: 10 }),
      furnitureRow({}),
    ];
    const resolved = resolveFurnitureRows(rows, "fittingDetail");
    expect(resolved.map((row) => row.detailNumber)).toEqual([1, 2, 10, 11]);
    const furniture = resolveFurnitureRows(rows, "furniture");
    expect(furniture.map((row) => row.detailNumber)).toEqual([
      1, 1.01, 10, 10.01,
    ]);
  });

  it("明細の部位は記号変換・名称は組み合わせ変換になる", () => {
    const settings = furnitureSettingsFor("fittingDetail", {
      partSymbols,
      nameSymbols,
    });
    const rows = applyFurnitureDetails(
      [furnitureRow({ part: "Y-1", nameSymbol: "KBD" })],
      settings,
      "fittingDetail",
    );
    expect(rows[0].detail.partName).toBe("洋間1");
    expect(rows[0].detail.name).toBe("片開きドア");
  });

  it("部位Ⅰ（集計書での置き場所）は空欄なら上の行と同じ", () => {
    const rows = [
      furnitureRow({ place: "1階" }),
      furnitureRow({}),
      furnitureRow({ place: "2階" }),
      furnitureRow({}),
    ];
    const resolved = resolveFurnitureRows(rows, "fittingDetail");
    expect(resolved.map((row) => row.place)).toEqual([
      "1階",
      "1階",
      "2階",
      "2階",
    ]);
  });

  it("集計：置き場所（部位Ⅰ）は行の入力・根拠は行の記号・根拠の部屋集計に入れる", () => {
    const rows = [
      furnitureRow({ place: "1階", part: "AD1", quantity: "4", unit: "ヶ所" }),
      furnitureRow({ part: "AW1", quantity: "1" }),
    ];
    const entries = entriesFromFurnitureSheet(
      {
        sheetId: 1,
        part1: "",
        part2: "",
        part2Split: false,
        part3: "建具明細作成表",
        multiplier: 1,
      },
      {
        rows,
        settings: furnitureSettingsFor("fittingDetail"),
        kind: "fittingDetail",
      },
      new Map(),
    );
    // 部位Ⅰは行ごとの入力（2行目以降は上と同じ）
    expect(entries.map((entry) => entry.part1)).toEqual(["1階", "1階"]);
    // 根拠の部屋は行の記号（部位欄のまま）
    expect(entries.map((entry) => entry.part3)).toEqual(["AD1", "AW1"]);
    expect(entries.map((entry) => entry.includeInRooms)).toEqual([true, true]);
    // 家具計算書の分は置き場所の設定・表の名前のまま（変えない）
    const furniture = entriesFromFurnitureSheet(
      {
        sheetId: 2,
        part1: "建築",
        part2: "1階",
        part2Split: true,
        part3: "家具",
        multiplier: 1,
      },
      { rows, settings: furnitureSettingsFor("furniture"), kind: "furniture" },
      new Map(),
    );
    expect(furniture.map((entry) => entry.part1)).toEqual(["建築", "建築"]);
    expect(furniture.map((entry) => entry.part3)).toEqual(["家具", "家具"]);
    expect(furniture.map((entry) => entry.includeInRooms)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("W・H・Dは摘要下段へ「W*H*見込」の形で出る", () => {
    const settings = furnitureSettingsFor("fittingDetail");
    const row = furnitureRow({ width: "1152.25", height: "2100", depth: "50" });
    expect(sizeText(row, settings, "fittingDetail")).toBe(
      "W1152.25*H2100*見込50",
    );
  });

  it("m→mmは小数点以下自由（1.15225m→1152.25mm）", () => {
    expect(mmPreciseText(1.15225)).toBe("1152.25");
    expect(mmPreciseText(1.8)).toBe("1800");
    expect(mmPreciseText(null)).toBe("");
  });

  it("建具表と取り合う：増えた分を足し、結び付いた行は記号・W・Hを更新", () => {
    const fitting = (
      id: number,
      patch: Partial<FittingLink> = {},
    ): FittingLink => ({
      id,
      symbol: `W${id}`,
      name: `窓${id}`,
      width: 1,
      height: 2,
      fromEstimate: 0,
      fromFurniture: 0,
      ...patch,
    });
    const rows = syncFittingDetailRows(
      [
        furnitureRow({
          id: "r1",
          fittingId: 1,
          part: "OLD",
          width: "1",
          height: "2",
        }),
        furnitureRow({ id: "r2", nameSymbol: "手入力" }),
      ],
      [
        fitting(1, { symbol: "W-1", width: 1.15225, height: 2.1 }),
        fitting(2, { fromEstimate: 1 }),
        fitting(3, { fromFurniture: 1 }),
      ],
    );
    // 結び付いた行は建具表の値で更新（mm・小数点以下自由）
    expect(rows[0]).toMatchObject({
      id: "r1",
      fittingId: 1,
      part: "W-1",
      width: "1152.25",
      height: "2100",
    });
    // 家具転記分（fromFurniture=1）は足されない
    expect(rows.map((row) => row.id)).not.toContain(undefined);
    const appended = rows.slice(2);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      fittingId: 2,
      part: "W2",
      nameSymbol: "窓2",
      width: "1000",
      height: "2000",
    });
  });

  it("計算書転記分・建具入力部は設定で変換の有無を決める", () => {
    const fitting = (id: number, fromEstimate: number): FittingLink => ({
      id,
      symbol: `W${id}`,
      name: "",
      width: 1,
      height: 2,
      fromEstimate,
      fromFurniture: 0,
    });
    const rows = syncFittingDetailRows(
      [furnitureRow({ id: "r1", fittingId: 2, part: "X" })],
      [fitting(1, 0), fitting(2, 1)],
      { estimate: false, manual: true },
    );
    // 計算書転記分は対象外に→行はそのまま（取り合いは保つ）・建具入力部だけ足す
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "r1", fittingId: 2, part: "X" });
    expect(rows[1]).toMatchObject({ fittingId: 1, part: "W1" });
    const both = syncFittingDetailRows([], [fitting(1, 0), fitting(2, 1)], {
      estimate: false,
      manual: false,
    });
    expect(both).toHaveLength(0);
  });

  it("建具表で消えた行は取り合いだけ外す（行は残す）", () => {
    const rows = syncFittingDetailRows(
      [furnitureRow({ id: "r1", fittingId: 9, part: "W9" })],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fittingId).toBeUndefined();
  });

  it("変換対象か（家具転記分は常に対象外）", () => {
    const base = { id: 1, symbol: "", name: "", width: null, height: null };
    const include = { estimate: true, manual: true };
    expect(
      isConvertibleFitting(
        { ...base, fromEstimate: 0, fromFurniture: 0 },
        include,
      ),
    ).toBe(true);
    expect(
      isConvertibleFitting(
        { ...base, fromEstimate: 1, fromFurniture: 0 },
        include,
      ),
    ).toBe(true);
    expect(
      isConvertibleFitting(
        { ...base, fromEstimate: 0, fromFurniture: 1 },
        include,
      ),
    ).toBe(false);
    expect(
      isConvertibleFitting(
        { ...base, fromEstimate: 1, fromFurniture: 1 },
        include,
      ),
    ).toBe(false);
    expect(
      isConvertibleFitting(
        { ...base, fromEstimate: 1, fromFurniture: 0 },
        { estimate: false, manual: true },
      ),
    ).toBe(false);
    expect(
      isConvertibleFitting(
        { ...base, fromEstimate: 0, fromFurniture: 0 },
        { estimate: true, manual: false },
      ),
    ).toBe(false);
  });
});
