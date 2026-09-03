/**
 * 表の中をExcelのようにキーボードで移動するための共通処理。
 * Enter・↑↓で上下、←→は文字カーソルが端にあるときだけ左右へ動く。
 */

export interface CellPosition {
  row: number;
  col: number;
}

export type NavMove = "up" | "down" | "left" | "right";

/** 押されたキーからどこへ動くかを決める。動かさないときは null */
export function navMoveOf(
  key: string,
  shiftKey: boolean,
  caretAtStart: boolean,
  caretAtEnd: boolean,
): NavMove | null {
  if (key === "Enter") return shiftKey ? "up" : "down";
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return caretAtStart ? "left" : null;
  if (key === "ArrowRight") return caretAtEnd ? "right" : null;
  return null;
}

/**
 * 青く囲まれた（全選択の）欄の中へ文字カーソルを入れるキーかどうか。
 * Shift+→ は文字の後ろ、Shift+← は先頭、F2 は後ろに入れる。
 */
export function caretJumpOf(
  key: string,
  shiftKey: boolean,
): "start" | "end" | null {
  if (key === "F2") return "end";
  if (!shiftKey) return null;
  if (key === "ArrowRight") return "end";
  if (key === "ArrowLeft") return "start";
  return null;
}

/**
 * 移動先のセルを求める。
 * counts は行ごとの入力欄の数。行をまたぐときは同じ列（無ければ最後の列）に移る。
 * 表の外へ出る場合は null を返す。
 */
export function nextCellPosition(
  move: NavMove,
  current: CellPosition,
  counts: readonly number[],
): CellPosition | null {
  const { row, col } = current;
  if (move === "up" || move === "down") {
    const step = move === "down" ? 1 : -1;
    for (
      let next = row + step;
      next >= 0 && next < counts.length;
      next += step
    ) {
      if (counts[next] > 0)
        return { row: next, col: Math.min(col, counts[next] - 1) };
    }
    return null;
  }
  if (move === "left") {
    if (col > 0) return { row, col: col - 1 };
    for (let next = row - 1; next >= 0; next--) {
      if (counts[next] > 0) return { row: next, col: counts[next] - 1 };
    }
    return null;
  }
  if (col < counts[row] - 1) return { row, col: col + 1 };
  for (let next = row + 1; next < counts.length; next++) {
    if (counts[next] > 0) return { row: next, col: 0 };
  }
  return null;
}
