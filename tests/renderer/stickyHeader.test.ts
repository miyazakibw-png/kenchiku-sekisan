import { describe, expect, it } from "vitest";
import { stickyTops } from "../../src/renderer/src/features/grid/stickyHeader";

describe("見出し行の固定位置", () => {
  it("ツールバーの下に見出し行を順に積む", () => {
    expect(stickyTops(40, [24, 20])).toEqual([40, 64]);
  });

  it("ツールバーが一緒に流れない画面は0から始まる", () => {
    expect(stickyTops(0, [24])).toEqual([0]);
    expect(stickyTops(30, [])).toEqual([]);
  });
});
