import { describe, expect, it } from "vitest";
import {
  hiddenLedgerKeys,
  ledgerKeyForWorkspace,
  setColumnVisible,
  workspaceKeyForLedger,
} from "../../src/renderer/src/features/projects/ledgerColumns";
import {
  ALWAYS_VISIBLE,
  WORKSPACE_MENU,
} from "../../src/renderer/src/features/projects/workspaceMenu";

describe("工事管理画面の表示項目", () => {
  it("日付・管理番号・工事名称は非表示にできない（台帳の固定列と同じ）", () => {
    expect(ALWAYS_VISIBLE).toEqual(["projectDate", "managementNo", "name"]);
  });
});

describe("表示項目と台帳の「列の表示・並び」の共通設定", () => {
  it("項目キーと列キーを相互に変換する", () => {
    expect(ledgerKeyForWorkspace("builderName")).toBe("builderName");
    expect(ledgerKeyForWorkspace("field-12")).toBe("field:12");
    expect(workspaceKeyForLedger("field:12")).toBe("field-12");
    expect(workspaceKeyForLedger("mark:2")).toBe("mark:2");
  });

  it("チェックを外すとその項目が非表示になる（無ければ末尾に足す）", () => {
    const settings = setColumnVisible([], "builderName", false);
    expect(settings).toEqual([{ key: "builderName", visible: false }]);
    expect(hiddenLedgerKeys(settings)).toEqual(["builderName"]);
  });

  it("同じ項目をもう一度切り替えると既存の設定だけを変える", () => {
    const settings = setColumnVisible(
      [{ key: "builderName", visible: false }],
      "builderName",
      true,
    );
    expect(settings).toEqual([{ key: "builderName", visible: true }]);
    expect(hiddenLedgerKeys(settings)).toEqual([]);
  });

  it("ユーザー定義列は field-◯ と field:◯ でつながっている", () => {
    const settings = setColumnVisible([], "field-12", false);
    expect(settings).toEqual([{ key: "field:12", visible: false }]);
    expect(hiddenLedgerKeys(settings)).toEqual(["field-12"]);
  });

  it("固定列（日付・管理番号・工事名称）は設定にあっても非表示にしない", () => {
    expect(
      hiddenLedgerKeys([
        { key: "projectDate", visible: false },
        { key: "note", visible: false },
      ]),
    ).toEqual(["note"]);
  });
});

describe("工事管理画面のメニュー", () => {
  it("キーが重複しない", () => {
    const keys = WORKSPACE_MENU.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
