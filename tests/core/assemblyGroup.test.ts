import { describe, expect, it } from "vitest";
import type { AssemblyItem, FinishAssembly } from "../../src/shared/types";
import { createEmptyItem } from "../../src/renderer/src/features/assemblies/assemblyEditor";
import { groupAssembliesByHead } from "../../src/core/masters/assemblyGroup";

function item(name: string): AssemblyItem {
  return { ...createEmptyItem(1), name };
}

function assembly(id: number, names: string[]): FinishAssembly {
  return {
    id,
    scope: "project",
    projectId: 1,
    setPartNumber: null,
    setPartName: "",
    note: "",
    displayOrder: id,
    items: names.map(item),
  };
}

describe("呼出画面のセットまとめ", () => {
  it("1行目が同じセットは1件にまとめる", () => {
    const groups = groupAssembliesByHead([
      assembly(1, ["ビニールクロス", "石膏ボード"]),
      assembly(2, ["ビニールクロス", "軽鉄下地"]),
      assembly(3, ["岩綿吸音板"]),
    ]);
    expect(groups.length).toBe(2);
    expect(groups[0].list.map((a) => a.id)).toEqual([1, 2]);
    expect(groups[1].list.map((a) => a.id)).toEqual([3]);
  });

  it("基準と工事は同じ1行目でも分けて出す", () => {
    const basic = {
      ...assembly(1, ["ビニールクロス"]),
      scope: "basic" as const,
    };
    const groups = groupAssembliesByHead([
      basic,
      assembly(2, ["ビニールクロス"]),
    ]);
    expect(groups.length).toBe(2);
  });

  it("明細の無いセットは出さない", () => {
    expect(groupAssembliesByHead([assembly(1, [])]).length).toBe(0);
  });

  it("先頭が説明行でも通常明細をセットの見出しに使う", () => {
    const withNoteFirst = assembly(1, ["説明", "明細"]);
    withNoteFirst.items[0].note = true;
    withNoteFirst.items[1].name = "共通の見出し";
    const matching = assembly(2, ["共通の見出し"]);

    const groups = groupAssembliesByHead([withNoteFirst, matching]);

    expect(groups).toHaveLength(1);
    expect(groups[0].list.map((a) => a.id)).toEqual([1, 2]);
  });
});
