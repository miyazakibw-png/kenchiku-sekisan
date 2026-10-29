import { describe, expect, it } from "vitest";
import {
  copyName,
  moveProject,
  normalizeDate,
  pinnedOnTop,
  sortProjects,
} from "../../src/renderer/src/features/projects/projectLedger";
import type { ProjectSummary } from "../../src/shared/types";

function project(
  id: number,
  name: string,
  projectDate: string,
): ProjectSummary {
  return {
    id,
    managementNo: `P-${String(id).padStart(4, "0")}`,
    projectDate,
    name,
    builderName: "",
    designerName: "",
    note: "",
    displayOrder: id,
    pinned: false,
    fieldValues: {},
    marks: [],
  };
}

const projects = [
  project(1, "B工事", "2026-08-17"),
  project(2, "A工事", "2026-01-05"),
  project(3, "C工事", "2026-12-31"),
];

describe("物件管理台帳の並べ替え", () => {
  it("作成順と関係なく行を移動できる", () => {
    expect(moveProject(projects, 2, 0).map((p) => p.id)).toEqual([3, 1, 2]);
  });

  it("範囲外の移動は元の配列をそのまま返す", () => {
    expect(moveProject(projects, 0, 5)).toBe(projects);
  });

  it("列を指定して並べ替えられる", () => {
    expect(sortProjects(projects, "projectDate").map((p) => p.id)).toEqual([
      2, 1, 3,
    ]);
    expect(sortProjects(projects, "name", true).map((p) => p.id)).toEqual([
      3, 1, 2,
    ]);
  });

  it("「上に固定」の工事は並べ替え・移動で崩れない", () => {
    const pinned = [
      { ...projects[0], pinned: true },
      projects[1],
      projects[2],
    ];
    // 列の並べ替えは固定以外だけに効く（固定の段の順はそのまま先頭）
    expect(sortProjects(pinned, "projectDate").map((p) => p.id)).toEqual([
      1, 2, 3,
    ]);
    // 固定以外を固定の段の上へ動かそうとしても上には行かない
    expect(moveProject(pinned, 2, 0).map((p) => p.id)).toEqual([1, 3, 2]);
    // 固定の段の中の順は変えられる
    const two = [
      { ...projects[0], pinned: true },
      { ...projects[1], pinned: true },
      projects[2],
    ];
    expect(moveProject(two, 1, 0).map((p) => p.id)).toEqual([2, 1, 3]);
    expect(pinnedOnTop(two).map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe("日付の正規化", () => {
  it("固定桁の YYYY-MM-DD へ整える", () => {
    expect(normalizeDate("2026-8-7")).toBe("2026-08-07");
    expect(normalizeDate(" 2026-08-17 ")).toBe("2026-08-17");
  });

  it("形式や日付として不正な入力は受け付けない", () => {
    expect(normalizeDate("2026/08/17")).toBeNull();
    expect(normalizeDate("2026-02-30")).toBeNull();
  });
});

describe("コピー作成", () => {
  it("コピー元が分かる初期名称を付ける", () => {
    expect(copyName("A工事")).toBe("A工事（コピー）");
  });
});
