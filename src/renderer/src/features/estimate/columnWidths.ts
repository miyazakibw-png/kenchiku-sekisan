import { useCallback, useEffect, useRef, useState } from "react";

/** 列幅は文字が見えなくなるほど細くできる */
export const COLUMN_MIN_WIDTH = 8;

/** 見出しの右端この幅をつかむと列幅変更になる */
const RESIZE_GRIP = 8;

function readWidths(key: string): Record<string, number> {
  const saved = window.localStorage.getItem(key);
  if (saved === null) return {};
  try {
    const parsed: unknown = JSON.parse(saved);
    if (parsed === null || typeof parsed !== "object") return {};
    const result: Record<string, number> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([id, value]) => {
      if (typeof value === "number" && value >= COLUMN_MIN_WIDTH)
        result[id] = value;
    });
    return result;
  } catch {
    return {};
  }
}

/** 一覧表の見出しの右端をドラッグして列幅を変える。幅は物件ごとにブラウザへ覚える */
export function useColumnWidths(storageKey: string): {
  widthOf: (id: string, defaultWidth: number) => number;
  startResize: (
    id: string,
    defaultWidth: number,
    event: React.MouseEvent,
  ) => void;
  /** 見出しの右端近くを押したときだけ列幅の変更を始める（th 全体に付ける） */
  resizeAtEdge: (
    id: string,
    defaultWidth: number,
    event: React.MouseEvent,
  ) => void;
} {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    readWidths(storageKey),
  );
  const widthRef = useRef(widths);
  widthRef.current = widths;

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [storageKey, widths]);

  const startResize = useCallback(
    (id: string, defaultWidth: number, event: React.MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = widthRef.current[id] ?? defaultWidth;
      const move = (e: MouseEvent): void =>
        setWidths({
          ...widthRef.current,
          [id]: Math.max(
            COLUMN_MIN_WIDTH,
            startWidth + e.clientX - startX,
          ),
        });
      const up = (): void => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [],
  );

  const resizeAtEdge = useCallback(
    (id: string, defaultWidth: number, event: React.MouseEvent): void => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.right - event.clientX <= RESIZE_GRIP) {
        startResize(id, defaultWidth, event);
      }
    },
    [startResize],
  );

  const widthOf = useCallback(
    (id: string, defaultWidth: number): number =>
      widths[id] ?? defaultWidth,
    [widths],
  );

  return { widthOf, startResize, resizeAtEdge };
}
