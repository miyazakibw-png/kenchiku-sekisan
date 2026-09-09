import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@shared/types";
import {
  filterProjectsByMarks,
  toggleMark,
} from "../../src/renderer/src/features/projects/projectMarks";

function project(id: number, marks: number[]): ProjectSummary {
  return {
    id,
    managementNo: `P-000${id}`,
    projectDate: "2026-08-17",
    name: `${id}工事`,
    builderName: "",
    designerName: "",
    note: "",
    displayOrder: id,
    fieldValues: {},
    marks,
  };
}

describe("物件管理台帳の表示切替（取引先別チェック）", () => {
  it("チェックを付ける・外すと番号順に持つ", () => {
    expect(toggleMark([3], 1, true)).toEqual([1, 3]);
    expect(toggleMark([1, 3], 3, false)).toEqual([1]);
    expect(toggleMark([1], 1, true)).toEqual([1]);
  });

  it("何も選ばないときは全表示", () => {
    const projects = [project(1, []), project(2, [2])];
    expect(filterProjectsByMarks(projects, [])).toHaveLength(2);
  });

  it("複数選んだときは、どれかが付いた物件を出す", () => {
    const projects = [project(1, [1]), project(2, [2]), project(3, [3, 5])];
    expect(
      filterProjectsByMarks(projects, [1, 5]).map((row) => row.id),
    ).toEqual([1, 3]);
  });
});
