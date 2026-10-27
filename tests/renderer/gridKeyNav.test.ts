import { describe, expect, it } from "vitest";
import {
  caretJumpOf,
  navMoveOf,
  nextCellPosition,
  nextSharedCellPosition,
} from "@renderer/features/grid/gridKeyNav";

describe("表のキーボード移動", () => {
  it("Enterは下、Shift+Enterは上へ動く", () => {
    expect(navMoveOf("Enter", false, true, true)).toBe("down");
    expect(navMoveOf("Enter", true, true, true)).toBe("up");
    expect(navMoveOf("ArrowDown", false, false, false)).toBe("down");
    expect(navMoveOf("ArrowUp", false, false, false)).toBe("up");
  });

  it("左右は文字カーソルが端にあるときだけ動く", () => {
    expect(navMoveOf("ArrowLeft", false, true, false)).toBe("left");
    expect(navMoveOf("ArrowLeft", false, false, false)).toBeNull();
    expect(navMoveOf("ArrowRight", false, false, true)).toBe("right");
    expect(navMoveOf("ArrowRight", false, false, false)).toBeNull();
    expect(navMoveOf("a", false, true, true)).toBeNull();
  });

  it("上下は同じ列へ、列が足りない行では最後の列へ移る", () => {
    expect(nextCellPosition("down", { row: 0, col: 2 }, [3, 3, 3])).toEqual({
      row: 1,
      col: 2,
    });
    expect(nextCellPosition("down", { row: 0, col: 2 }, [3, 2])).toEqual({
      row: 1,
      col: 1,
    });
    expect(nextCellPosition("up", { row: 0, col: 0 }, [3, 3])).toBeNull();
    expect(nextCellPosition("down", { row: 1, col: 0 }, [3, 3])).toBeNull();
  });

  it("入力欄の無い行（見出し行）は飛ばす", () => {
    expect(nextCellPosition("down", { row: 0, col: 1 }, [2, 0, 2])).toEqual({
      row: 2,
      col: 1,
    });
  });

  it("左右は行をまたいで続く", () => {
    expect(nextCellPosition("right", { row: 0, col: 1 }, [2, 2])).toEqual({
      row: 1,
      col: 0,
    });
    expect(nextCellPosition("left", { row: 1, col: 0 }, [2, 2])).toEqual({
      row: 0,
      col: 1,
    });
    expect(nextCellPosition("right", { row: 1, col: 1 }, [2, 2])).toBeNull();
  });
});

describe("欄の中へ文字カーソルを入れるキー", () => {
  it("Shift+→は後ろ・Shift+←は先頭・F2は後ろ", () => {
    expect(caretJumpOf("ArrowRight", true)).toBe("end");
    expect(caretJumpOf("ArrowLeft", true)).toBe("start");
    expect(caretJumpOf("F2", false)).toBe("end");
  });

  it("Shift無しの矢印やEnterは対象外（今までどおり隣へ動く）", () => {
    expect(caretJumpOf("ArrowRight", false)).toBeNull();
    expect(caretJumpOf("ArrowLeft", false)).toBeNull();
    expect(caretJumpOf("Enter", true)).toBeNull();
  });
});

describe("上下2行の表で共有欄を含めたキーボード移動", () => {
  const lines = [
    [
      { key: "category-1", left: 0 },
      { key: "part-1", left: 100 },
      { key: "name-upper-1", left: 200 },
    ],
    [
      { key: "category-1", left: 0 },
      { key: "detail-1", left: 100 },
      { key: "name-lower-1", left: 200 },
      { key: "unit-1", left: 300 },
      { key: "remarks-1", left: 400 },
    ],
    [
      { key: "category-2", left: 0 },
      { key: "part-2", left: 100 },
      { key: "name-upper-2", left: 200 },
    ],
    [
      { key: "category-2", left: 0 },
      { key: "detail-2", left: 100 },
      { key: "name-lower-2", left: 200 },
      { key: "unit-2", left: 300 },
      { key: "remarks-2", left: 400 },
    ],
  ];

  it("下段を右へ進むと共有の単位を通って下段のまま続く", () => {
    const unit = nextSharedCellPosition(
      "right",
      { row: 1, col: 2 },
      lines,
    );
    expect(unit).toEqual({ row: 1, col: 3 });
    expect(lines[unit!.row][unit!.col].key).toBe("unit-1");
    expect(
      nextSharedCellPosition("right", unit!, lines),
    ).toEqual({ row: 1, col: 4 });
  });

  it("下段の明細番号から左へ共有の材種区分へ戻る", () => {
    expect(
      nextSharedCellPosition("left", { row: 1, col: 1 }, lines),
    ).toEqual({ row: 1, col: 0 });
    expect(lines[1][0].key).toBe("category-1");
  });

  it("共有の材種区分から下へ同じ列の次明細へ進む", () => {
    expect(
      nextSharedCellPosition("down", { row: 0, col: 0 }, lines),
    ).toEqual({ row: 2, col: 0 });
  });

  it("上段の通常欄から下へ同じ位置の下段欄へ進む", () => {
    expect(
      nextSharedCellPosition("down", { row: 0, col: 2 }, lines),
    ).toEqual({ row: 1, col: 2 });
  });
});
