import { describe, expect, it } from "vitest";
import { fillRoomName } from "../../src/core/room/roomPartName";

describe("部位名の室名置きかえ", () => {
  it("部位Ⅱと部位Ⅲの間を空けず、英数字を半角にして置きかえる", () => {
    expect(fillRoomName("室名床", "１Ｆ玄関")).toBe("1F玄関床");
  });

  it("部位Ⅲのカタカナも名前用に半角へ直す", () => {
    expect(fillRoomName("室名床", "１Ｆロビー")).toBe("1Fﾛﾋﾞｰ床");
  });

  it("部位名にあるすべての室名を置きかえる", () => {
    expect(fillRoomName("室名床・室名巾木", "１Ｆ玄関")).toBe(
      "1F玄関床・1F玄関巾木",
    );
  });

  it("部位Ⅱ・Ⅲの中にある空白は残す", () => {
    expect(fillRoomName("室名床", "１Ｆ玄 関")).toBe("1F玄 関床");
  });

  it("室名を含まない部位名はそのまま", () => {
    expect(fillRoomName("外壁", "１Ｆ玄関")).toBe("外壁");
  });

  it.each([undefined, "", "　　"])(
    "部屋名が空のときは室名を残す (%s)",
    (roomName) => {
      expect(fillRoomName("室名床", roomName)).toBe("室名床");
    },
  );
});
