import { describe, expect, it } from "vitest";
import { printDateText } from "../../src/renderer/src/features/projects/ProjectSummarySheet";

describe("工事概要の印刷書式", () => {
  it("右上の印刷日は 2026/8/27 の形にする", () => {
    expect(printDateText(new Date(2026, 7, 27))).toBe("2026/8/27");
    expect(printDateText(new Date(2026, 11, 5))).toBe("2026/12/5");
  });
});
