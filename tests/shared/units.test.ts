import { describe, expect, it } from "vitest";
import type { Unit } from "../../src/shared/types";
import { resolveUnitName } from "../../src/shared/units";

const units: Unit[] = [
  { id: 1, name: "m", displayOrder: 1 },
  { id: 2, name: "m2", displayOrder: 2 },
  { id: 9, name: "式", displayOrder: 9 },
];

describe("単位欄の番号入力", () => {
  it("IDを入力すると単位名へ変換する", () => {
    expect(resolveUnitName(units, "1")).toBe("m");
    expect(resolveUnitName(units, "2")).toBe("m2");
    expect(resolveUnitName(units, "9")).toBe("式");
  });

  it("該当IDが無い番号・単位名の直接入力・空文字はそのまま返す", () => {
    expect(resolveUnitName(units, "8")).toBe("8");
    expect(resolveUnitName(units, "m3")).toBe("m3");
    expect(resolveUnitName(units, "")).toBe("");
  });
});
