import { describe, expect, it } from "vitest";
import {
  resolvePartNumberInput,
} from "../../src/renderer/src/features/estimate/partNumberInput";

const parts = [
  { id: 1, name: "壁" },
  { id: 2, name: "床" },
];

describe("計算書の部位ID入力", () => {
  it("登録された番号はマスターの部位名と一緒に確定する", () => {
    expect(resolvePartNumberInput(parts, "1", "既存部位")).toEqual({
      partNumber: 1,
      partName: "壁",
    });
  });

  it("未登録の整数・小数はその番号を保ち、部位名を変えない", () => {
    expect(resolvePartNumberInput(parts, "999", "既存部位")).toEqual({
      partNumber: 999,
      partName: "既存部位",
    });
    expect(resolvePartNumberInput(parts, "180", "既存部位")).toEqual({
      partNumber: 180,
      partName: "既存部位",
    });
    expect(resolvePartNumberInput(parts, "30.01", "既存部位")).toEqual({
      partNumber: 30.01,
      partName: "既存部位",
    });
  });

  it("数値でない入力は部位番号を空にし、部位名を残す", () => {
    expect(resolvePartNumberInput(parts, "未登録", "既存部位")).toEqual({
      partNumber: null,
      partName: "既存部位",
    });
  });
});
