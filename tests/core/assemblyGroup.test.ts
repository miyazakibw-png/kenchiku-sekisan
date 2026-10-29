import { describe, expect, it } from "vitest";
import type { AssemblyItem, FinishAssembly } from "../../src/shared/types";
import { createEmptyItem } from "../../src/renderer/src/features/assemblies/assemblyEditor";
import {
  groupAssembliesByHead,
  hideBasicDuplicates,
} from "../../src/core/masters/assemblyGroup";

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

function basicAssembly(id: number, names: string[]): FinishAssembly {
  return {
    ...assembly(id, names),
    scope: "basic",
    projectId: null,
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

  it("中身が同じ工事セットがあれば基準セットを隠す", () => {
    const basic = basicAssembly(1, ["壁仕上"]);
    const project = assembly(2, ["壁仕上"]);

    expect(hideBasicDuplicates([basic, project])).toEqual([project]);
  });

  it("式だけ異なる場合も同じ内容として基準セットを隠す", () => {
    const basic = basicAssembly(1, ["壁仕上"]);
    basic.items[0].formula = "X";
    const project = assembly(2, ["壁仕上"]);
    project.items[0].formula = "";

    expect(hideBasicDuplicates([basic, project])).toEqual([project]);
  });

  it("基準の部位欄が空なら先頭明細と同じ部位を持つ工事セットで隠す", () => {
    const basic = basicAssembly(1, ["壁仕上"]);
    basic.items[0].partNumber = 12;
    basic.items[0].partName = "壁";
    const project = assembly(2, ["壁仕上"]);
    project.items[0].partNumber = 12;
    project.items[0].partName = "壁";
    project.setPartNumber = 12;
    project.setPartName = "壁";

    expect(hideBasicDuplicates([basic, project])).toEqual([project]);
  });

  it("構成明細の内容が異なると両方残す", () => {
    const basic = basicAssembly(1, ["壁仕上"]);
    const project = assembly(2, ["天井仕上"]);

    expect(hideBasicDuplicates([basic, project])).toEqual([basic, project]);
  });

  it("工事セットの部位欄が異なると両方残す", () => {
    const basic = basicAssembly(1, ["壁仕上"]);
    basic.items[0].partNumber = 12;
    basic.items[0].partName = "壁";
    const project = assembly(2, ["壁仕上"]);
    project.items[0].partNumber = 12;
    project.items[0].partName = "壁";
    project.setPartNumber = 13;
    project.setPartName = "天井";

    expect(hideBasicDuplicates([basic, project])).toEqual([basic, project]);
  });

  it("重複しない基準セットを残し、残った順序を保つ", () => {
    const firstProject = assembly(1, ["工事セット1"]);
    const basicOnly = basicAssembly(2, ["基準のみ"]);
    const hiddenBasic = basicAssembly(3, ["工事セット2"]);
    const lastProject = assembly(4, ["工事セット2"]);

    expect(
      hideBasicDuplicates([
        firstProject,
        basicOnly,
        hiddenBasic,
        lastProject,
      ]),
    ).toEqual([firstProject, basicOnly, lastProject]);
  });
});
