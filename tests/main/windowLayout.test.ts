import { describe, expect, it } from "vitest";
import { splitHalves } from "../../src/main/windowLayout";

describe("splitHalves", () => {
  it("splits the work area evenly and gives the remainder to the right", () => {
    expect(splitHalves({ x: 100, y: 40, width: 1441, height: 900 })).toEqual({
      left: { x: 100, y: 40, width: 720, height: 900 },
      right: { x: 820, y: 40, width: 721, height: 900 },
    });
  });
});
