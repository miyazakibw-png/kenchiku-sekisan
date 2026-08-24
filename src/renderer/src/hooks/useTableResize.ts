import { useCallback, useEffect, useRef } from "react";

const MIN_WIDTH = 28;

/** 記憶した列幅（列番号→px）を読む */
export function readTableWidths(storageKey: string): Record<number, number> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Record<number, number> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(
      ([key, value]) => {
        const index = Number(key);
        if (
          Number.isInteger(index) &&
          typeof value === "number" &&
          Number.isFinite(value)
        ) {
          result[index] = Math.max(MIN_WIDTH, value);
        }
      },
    );
    return result;
  } catch {
    return {};
  }
}

/**
 * 列ごとの見出しセルを左から順に返す。
 * 見出しが2段以上ある表（部位別入力表など）でも、
 * その列だけを受け持つ見出し（横につながっていない見出し）を選んで幅を変えられるようにする。
 */
function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const rows = [...(table.tHead?.rows ?? [])];
  if (rows.length === 0) return [];
  /** 上の行から縦につながっている見出しが、どの行まで場所を取るか（列ごと） */
  const until: number[] = [];
  const byColumn = new Map<number, HTMLTableCellElement>();
  rows.forEach((row, rowIndex) => {
    let column = 0;
    [...row.cells].forEach((cell) => {
      while ((until[column] ?? -1) >= rowIndex) column += 1;
      if (cell.colSpan === 1 && !byColumn.has(column))
        byColumn.set(column, cell);
      for (let i = 0; i < cell.colSpan; i += 1) {
        until[column + i] = rowIndex + cell.rowSpan - 1;
      }
      column += cell.colSpan;
    });
  });
  return [...byColumn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cell]) => cell);
}

/**
 * どの表形式画面でも列幅をドラッグで変えられるようにする共通フック。
 * 表の見出し（一番下の行）の右端にドラッグ用のつまみを付け、
 * 変えた幅はこのパソコンに記憶して次に開いたときも同じ幅で表示する。
 * 戻り値を <table ref={...}> に渡すだけで使える。
 */
export function useTableResize(
  storageKey: string,
): (table: HTMLTableElement | null) => void {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const widthsRef = useRef<Record<number, number>>({});

  const apply = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    headerCells(table).forEach((cell, index) => {
      const width = widthsRef.current[index];
      if (width === undefined) return;
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;
      cell.style.maxWidth = `${width}px`;
    });
  }, []);

  const attachHandles = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    headerCells(table).forEach((cell, index) => {
      if (cell.querySelector(":scope > .table-col-resize")) return;
      const handle = document.createElement("span");
      handle.className = "table-col-resize";
      handle.title = "ドラッグで列幅を変える（ダブルクリックで元に戻す）";
      handle.addEventListener("mousedown", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = cell.getBoundingClientRect().width;
        const move = (e: MouseEvent): void => {
          const next = Math.max(MIN_WIDTH, startWidth + e.clientX - startX);
          widthsRef.current = { ...widthsRef.current, [index]: next };
          apply();
        };
        const up = (): void => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          window.localStorage.setItem(
            storageKey,
            JSON.stringify(widthsRef.current),
          );
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });
      handle.addEventListener("dblclick", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const next = { ...widthsRef.current };
        delete next[index];
        widthsRef.current = next;
        cell.style.width = "";
        cell.style.minWidth = "";
        cell.style.maxWidth = "";
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      });
      cell.appendChild(handle);
    });
  }, [apply, storageKey]);

  useEffect(() => {
    widthsRef.current = readTableWidths(storageKey);
    attachHandles();
    apply();
  }, [apply, attachHandles, storageKey]);

  // 行や列が増減しても、つまみと幅を付け直す
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return undefined;
    const observer = new MutationObserver(() => {
      attachHandles();
      apply();
    });
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [apply, attachHandles]);

  return useCallback(
    (table: HTMLTableElement | null) => {
      tableRef.current = table;
      if (!table) return;
      widthsRef.current = readTableWidths(storageKey);
      attachHandles();
      apply();
    },
    [apply, attachHandles, storageKey],
  );
}
