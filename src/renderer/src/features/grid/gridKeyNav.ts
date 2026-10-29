/**
 * 表の中をExcelのようにキーボードで移動するための共通処理。
 * Enter・↑↓で上下、←→は文字カーソルが端にあるときだけ左右へ動く。
 */

export interface CellPosition {
  row: number;
  col: number;
}

export interface NavLineCell<T = unknown> {
  key: T;
  left: number;
  right?: number;
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

/**
 * 行をまたぐ欄を含む表の移動先を求める。
 * lines は左から順に並び、同じ欄が上下の行に含まれる場合は同じ key を使う。
 */
export function nextSharedCellPosition<T>(
  move: NavMove,
  current: CellPosition,
  lines: readonly (readonly NavLineCell<T>[])[],
  options?: { sameColumn?: boolean; lineGroups?: readonly unknown[] },
): CellPosition | null {
  const currentCell = lines[current.row]?.[current.col];
  if (!currentCell) return null;

  if (move !== "up" && move !== "down") {
    if (options?.sameColumn) {
      const line = lines[current.row];
      const atEdge =
        move === "left" ? current.col === 0 : current.col === line.length - 1;
      if (atEdge) {
        for (const row of [current.row - 1, current.row + 1]) {
          const adjacent = lines[row];
          if (!adjacent) continue;
          const sharedCol = adjacent.findIndex(
            (cell) => cell.key === currentCell.key,
          );
          if (sharedCol < 0) continue;
          if (move === "left" && sharedCol > 0)
            return { row, col: sharedCol - 1 };
          if (move === "right" && sharedCol < adjacent.length - 1)
            return { row, col: sharedCol + 1 };
        }
      }

      const lineGroups = options.lineGroups;
      const currentGroup = lineGroups?.[current.row];
      if (lineGroups && currentGroup !== undefined && currentGroup !== null) {
        const line = lines[current.row];
        const candidate =
          line[move === "left" ? current.col - 1 : current.col + 1];
        const currentKeys = new Set(line.map((cell) => cell.key));
        let closest: CellPosition | null = null;
        let closestDistance = Number.POSITIVE_INFINITY;

        for (const row of [current.row - 1, current.row + 1]) {
          if (lineGroups[row] !== currentGroup) continue;
          const adjacent = lines[row];
          if (!adjacent) continue;

          for (let col = 0; col < adjacent.length; col++) {
            const cell = adjacent[col];
            if (currentKeys.has(cell.key)) continue;
            const between =
              move === "left"
                ? cell.left < currentCell.left &&
                  (candidate === undefined || candidate.left < cell.left)
                : cell.left > currentCell.left &&
                  (candidate === undefined || cell.left < candidate.left);
            if (!between) continue;

            const distance = Math.abs(cell.left - currentCell.left);
            if (distance < closestDistance) {
              closest = { row, col };
              closestDistance = distance;
            }
          }
        }

        if (closest) return closest;
      }
    }
    return nextCellPosition(
      move,
      current,
      lines.map((line) => line.length),
    );
  }

  const step = move === "down" ? 1 : -1;
  for (
    let row = current.row + step;
    row >= 0 && row < lines.length;
    row += step
  ) {
    const line = lines[row];
    if (line.length === 0) continue;

    const candidates = line
      .map((cell, col) => ({ cell, col }))
      .filter(
        ({ cell }) =>
          !options?.sameColumn ||
          currentCell.right === undefined ||
          cell.right === undefined ||
          (cell.left < currentCell.right && cell.right > currentCell.left),
      );
    if (candidates.length === 0) continue;

    let closest = candidates[0].col;
    let closestDistance = Math.abs(candidates[0].cell.left - currentCell.left);
    for (const { cell, col } of candidates.slice(1)) {
      const distance = Math.abs(cell.left - currentCell.left);
      if (distance < closestDistance) {
        closest = col;
        closestDistance = distance;
      }
    }
    if (line[closest].key === currentCell.key) continue;
    return { row, col: closest };
  }
  return null;
}
