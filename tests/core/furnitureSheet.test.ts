import { describe, expect, it } from "vitest";
import {
  applyFurnitureDetails,
  entriesFromFurnitureSheet,
  fittingsFromFurniture,
  furnitureRow,
  furnitureSettings,
  resolveFurnitureRows,
  rowQuantity,
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
