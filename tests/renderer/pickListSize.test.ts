import { describe, expect, it } from "vitest";
import { pickListHeight } from "../../src/renderer/src/components/pickListSize";

describe("候補一覧の高さ", () => {
  it("基本の高さを使う", () => {
    expect(pickListHeight(1, 1000)).toBe(320);
  });

  it("部位ID候補を3倍にする", () => {
    expect(pickListHeight(3, 1000)).toBe(960);
  });

  it("科目ID候補を2倍にする", () => {
    expect(pickListHeight(2, 1000)).toBe(640);
  });

  it("3倍の高さを画面に収める", () => {
    expect(pickListHeight(3, 700)).toBe(700);
  });

  it("2倍の高さを画面に収める", () => {
    expect(pickListHeight(2, 500)).toBe(500);
  });
});
