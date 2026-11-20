import { describe, expect, it } from "vitest";
import type { AssemblyItem } from "../../src/shared/types";
import {
  assemblyHead,
  assemblyItemSubjectId,
} from "../../src/shared/assemblyItem";
import { assemblySignature } from "../../src/shared/assemblySignature";

function item(patch: Partial<AssemblyItem> = {}): AssemblyItem {
  return {
    id: null,
    sourceDetailId: null,
    subjectId: 1,
    partNumber: null,
    detailNumber: null,
    materialCategory: "",
    partName: "",
    name: "",
    descriptionUpper: "",
    descriptionLower: "",
    unit: "",
    remarksUpper: "",
    remarksLower: "",
    estimateDisplay: "",
    formula: "",
    coefficient: 1,
    ...patch,
  };
}

describe("仕上明細セットの共通処理", () => {
  it("説明行を飛ばしてセットの先頭明細を返す", () => {
    const note = item({ name: "説明", note: true });
    const detail = item({ name: "明細" });

    expect(assemblyHead([note, detail])).toBe(detail);
    expect(assemblyHead([note])).toBe(note);
    expect(assemblyHead([])).toBeUndefined();
  });

  it("説明行の科目ID 0 は null に戻し、通常行の 0 はそのまま返す", () => {
    expect(
      assemblyItemSubjectId(item({ subjectId: 0, note: true })),
    ).toBeNull();
    expect(assemblyItemSubjectId(item({ subjectId: 0 }))).toBe(0);
  });

  it("説明行の有無をセット照合キーへ含める", () => {
    const detail = item({ name: "説明" });
    expect(assemblySignature([detail])).not.toBe(
      assemblySignature([{ ...detail, note: true }]),
    );
  });
});
