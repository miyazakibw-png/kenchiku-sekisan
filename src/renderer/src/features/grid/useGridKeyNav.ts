import { useCallback } from "react";
import type { KeyboardEvent } from "react";
import { navMoveOf, nextCellPosition } from "./gridKeyNav";

const FIELDS =
  "input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isField(target: EventTarget | null): target is Field {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

function caretRange(field: Field): { atStart: boolean; atEnd: boolean } {
  if (field instanceof HTMLSelectElement) return { atStart: true, atEnd: true };
  const start = field.selectionStart;
  const end = field.selectionEnd;
  if (start === null || end === null) return { atStart: true, atEnd: true };
  // 移動してきた直後は文字が全選択になっているので、そのまま左右へ動けるようにする
  if (start === 0 && end === field.value.length)
    return { atStart: true, atEnd: true };
  return {
    atStart: start === 0 && end === 0,
    atEnd: start === field.value.length && start === end,
  };
}

/** 同じ行の中で、今の欄と横の位置が一番近い欄を選ぶ */
function nearestByLeft(line: readonly Field[], field: Field): Field {
  const left = field.getBoundingClientRect().left;
  let best = line[0];
  let bestGap = Number.POSITIVE_INFINITY;
  line.forEach((cell) => {
    const gap = Math.abs(cell.getBoundingClientRect().left - left);
    if (gap < bestGap) {
      best = cell;
      bestGap = gap;
    }
  });
  return best;
}

/**
 * 表の中をEnterと矢印キーで移動できるようにする。
 * 表の要素（table を含む親）の onKeyDown に渡して使う。
 */
export function useGridKeyNav(): (event: KeyboardEvent) => void {
  return useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const field = event.target;
    if (!isField(field)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (field instanceof HTMLTextAreaElement && event.key === "Enter") return;

    const { atStart, atEnd } = caretRange(field);
    const move = navMoveOf(event.key, event.shiftKey, atStart, atEnd);
    if (!move) return;

    const table = field.closest("table");
    if (!table) return;
    const lines = Array.from(table.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.querySelectorAll<Field>(FIELDS)).filter(
        (cell) => cell.closest("table") === table,
      ),
    );
    const row = lines.findIndex((line) => line.includes(field));
    if (row < 0) return;
    const col = lines[row].indexOf(field);

    const next = nextCellPosition(
      move,
      { row, col },
      lines.map((line) => line.length),
    );
    if (!next) return;
    // 上下は見た目の位置が一番近い欄へ移る（上下2行組の表でも真っ直ぐ動くように）
    const target =
      move === "up" || move === "down"
        ? nearestByLeft(lines[next.row], field)
        : lines[next.row][next.col];
    event.preventDefault();
    target.focus();
    if (target instanceof HTMLInputElement && target.type === "text")
      target.select();
    else if (target instanceof HTMLTextAreaElement) target.select();
  }, []);
}
