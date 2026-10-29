import { useCallback, useEffect } from "react";
import type { KeyboardEvent } from "react";
import {
  caretJumpOf,
  navMoveOf,
  nextCellPosition,
  nextSharedCellPosition,
} from "./gridKeyNav";
import { focusCell } from "./focusCell";

const FIELDS =
  "input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const sharedFieldRows = new WeakMap<Field, HTMLTableRowElement>();

function isField(target: EventTarget | null): target is Field {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

function isSharedField(field: Field): boolean {
  if (field.hasAttribute("data-nav-both")) return true;
  const cell = field.closest("td,th");
  return (
    cell?.hasAttribute("data-nav-both") === true ||
    (cell instanceof HTMLTableCellElement && cell.rowSpan > 1)
  );
}

function isSharedTable(table: HTMLTableElement): boolean {
  return table.hasAttribute("data-nav-shared");
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

/** 文字カーソルを置ける欄か（数値欄などは置けないので選択のまま） */
function canPlaceCaret(
  field: Field,
): field is HTMLInputElement | HTMLTextAreaElement {
  if (field instanceof HTMLTextAreaElement) return true;
  return (
    field instanceof HTMLInputElement &&
    ["text", "search", "url", "tel", "password"].includes(field.type)
  );
}

/** 欄に入った直後のように、文字が全部選ばれているか */
function isAllSelected(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (field.value === "") return false;
  return (
    field.selectionStart === 0 && field.selectionEnd === field.value.length
  );
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
  useEffect(() => {
    const rememberClickedRow = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return;
      const field = event.target.closest(FIELDS);
      if (!isField(field)) return;
      const table = field.closest("table[data-nav-shared]");
      if (
        !(table instanceof HTMLTableElement) ||
        !isSharedField(field)
      )
        return;
      const tbody = field.closest("tbody");
      if (!tbody) return;
      const rows = Array.from(tbody.rows);
      if (rows.length === 0) return;

      let closest = rows[0];
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const distance =
          event.clientY < rect.top
            ? rect.top - event.clientY
            : event.clientY > rect.bottom
              ? event.clientY - rect.bottom
              : 0;
        if (distance < closestDistance) {
          closest = row;
          closestDistance = distance;
        }
      }
      sharedFieldRows.set(field, closest);
    };

    const defaultFocusedRow = (event: FocusEvent): void => {
      if (!isField(event.target)) return;
      const table = event.target.closest("table[data-nav-shared]");
      if (
        !(table instanceof HTMLTableElement) ||
        !isSharedField(event.target) ||
        sharedFieldRows.has(event.target)
      )
        return;
      const firstRow = event.target.closest("tbody")?.rows.item(0);
      if (firstRow) sharedFieldRows.set(event.target, firstRow);
    };

    const forgetFocusedRow = (event: FocusEvent): void => {
      if (isField(event.target)) sharedFieldRows.delete(event.target);
    };

    document.addEventListener("mousedown", rememberClickedRow, true);
    document.addEventListener("focusin", defaultFocusedRow, true);
    document.addEventListener("focusout", forgetFocusedRow, true);
    return () => {
      document.removeEventListener("mousedown", rememberClickedRow, true);
      document.removeEventListener("focusin", defaultFocusedRow, true);
      document.removeEventListener("focusout", forgetFocusedRow, true);
    };
  }, []);

  return useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const field = event.target;
    if (!isField(field)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (field instanceof HTMLTextAreaElement && event.key === "Enter") return;

    // 欄に入った直後（文字が全部青くなっている）だけ、Shift+←→・F2 で
    // 欄の中へ文字カーソルを入れる。中に入った後の Shift+←→ は範囲選択のまま。
    const jump = caretJumpOf(event.key, event.shiftKey);
    if (jump !== null && canPlaceCaret(field) && isAllSelected(field)) {
      event.preventDefault();
      const at = jump === "end" ? field.value.length : 0;
      field.setSelectionRange(at, at);
      return;
    }

    const { atStart, atEnd } = caretRange(field);
    const move = navMoveOf(event.key, event.shiftKey, atStart, atEnd);
    if (!move) return;

    const table = field.closest("table");
    if (!(table instanceof HTMLTableElement)) return;
    const sharedTable = isSharedTable(table);
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"))
      .filter((tr) => tr.closest("table") === table);
    const allFields = Array.from(table.querySelectorAll<Field>(FIELDS)).filter(
      (cell) => cell.closest("table") === table,
    );
    const domOrder = new Map<Field, number>(
      allFields.map((cell, index) => [cell, index]),
    );
    const lines = rows.map((tr) => {
      const rowFields = Array.from(tr.querySelectorAll<Field>(FIELDS)).filter(
        (cell) => cell.closest("table") === table,
      );
      if (!sharedTable) return rowFields;
      const tbody = tr.closest("tbody");
      if (!tbody || tbody.closest("table") !== table) return rowFields;
      const cells = new Set(rowFields);
      for (const cell of Array.from(tbody.querySelectorAll<Field>(FIELDS))) {
        if (
          cell.closest("table") === table &&
          isSharedField(cell)
        )
          cells.add(cell);
      }
      return Array.from(cells).sort((a, b) => {
        const leftDifference =
          a.getBoundingClientRect().left - b.getBoundingClientRect().left;
        return (
          leftDifference ||
          (domOrder.get(a) ?? 0) - (domOrder.get(b) ?? 0)
        );
      });
    });
    let row: number;
    if (sharedTable && isSharedField(field)) {
      const rememberedRow = sharedFieldRows.get(field);
      row = rememberedRow ? rows.indexOf(rememberedRow) : -1;
      if (row < 0) {
        const firstRow = field.closest("tbody")?.rows.item(0);
        row = firstRow ? rows.indexOf(firstRow) : -1;
      }
    } else {
      row = lines.findIndex((line) => line.includes(field));
    }
    if (row < 0) return;
    const col = lines[row].indexOf(field);
    if (col < 0) return;
    const next = sharedTable
      ? nextSharedCellPosition(
          move,
          { row, col },
          lines.map((line) =>
            line.map((cell) => {
              const rect = cell.getBoundingClientRect();
              return { key: cell, left: rect.left, right: rect.right };
            }),
          ),
          { sameColumn: table.hasAttribute("data-nav-same-column") },
        )
      : nextCellPosition(
          move,
          { row, col },
          lines.map((line) => line.length),
        );
    if (!next) return;
    // 上下は見た目の位置が一番近い欄へ移る（上下2行組の表でも真っ直ぐ動くように）
    const target =
      sharedTable || move === "left" || move === "right"
        ? lines[next.row][next.col]
        : nearestByLeft(lines[next.row], field);
    event.preventDefault();
    if (sharedTable && isSharedField(target))
      sharedFieldRows.set(target, rows[next.row]);
    focusCell(target);
    if (target instanceof HTMLInputElement && target.type === "text")
      target.select();
    else if (target instanceof HTMLTextAreaElement) target.select();
  }, []);
}
