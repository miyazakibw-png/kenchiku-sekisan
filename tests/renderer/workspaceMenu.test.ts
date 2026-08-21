import { describe, expect, it } from "vitest";
import {
  ALWAYS_VISIBLE,
  toggleHiddenField,
  WORKSPACE_MENU,
} from "../../src/renderer/src/features/projects/workspaceMenu";

describe("工事管理画面の表示項目", () => {
  it("管理番号・工事名称は非表示にできない", () => {
    expect(ALWAYS_VISIBLE).toEqual(["managementNo", "name"]);
    expect(toggleHiddenField([], "managementNo")).toEqual([]);
    expect(toggleHiddenField([], "name")).toEqual([]);
  });

  it("それ以外の項目は表示・非表示を切り替えられる", () => {
    const hidden = toggleHiddenField([], "builderName");
    expect(hidden).toEqual(["builderName"]);
    expect(toggleHiddenField(hidden, "builderName")).toEqual([]);
  });
});

describe("工事管理画面のメニュー", () => {
  it("キーが重複しない", () => {
    const keys = WORKSPACE_MENU.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
