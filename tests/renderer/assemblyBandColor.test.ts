import { describe, expect, it } from "vitest";
import { assemblyBandColor } from "../../src/renderer/src/features/estimate/bannerColors";

describe("assemblyBandColor", () => {
  it.each([
    [null, null],
    [0, null],
    [9.99, null],
    [-5, null],
    [10, "#dcfce7"],
    [19.99, "#dcfce7"],
    [20, "#fce7f3"],
    [30, "#dbeafe"],
    [40, "#fef9c3"],
    [50, "#ffedd5"],
    [60, "#e2e8f0"],
    [70, "#ede9fe"],
    [79.99, "#ede9fe"],
    [80, "#cffafe"],
    [999, "#cffafe"],
  ])("maps %s", (partNumber, color) => {
    expect(assemblyBandColor(partNumber)).toBe(color);
  });
});
