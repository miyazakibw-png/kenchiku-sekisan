import { useCallback, useEffect, useRef, useState } from "react";

const MIN_WIDTH = 28;

function read(key: string, defaults: number[]): number[] {
  const saved = window.localStorage.getItem(key);
  if (saved === null) return defaults;
  try {
    const parsed: unknown = JSON.parse(saved);
    if (
      Array.isArray(parsed) &&
      parsed.length === defaults.length &&
      parsed.every((value) => typeof value === "number" && value >= MIN_WIDTH)
    ) {
      return parsed as number[];
    }
  } catch {
    // 記憶した値が壊れていれば既定の幅に戻す
  }
  return defaults;
}

export interface ColumnWidths {
  widths: number[];
  /** 見出しの右端をドラッグしたときに呼ぶ */
  startResize: (index: number, event: React.MouseEvent) => void;
  /** 既定の幅へ戻す */
  reset: () => void;
}

/**
 * 表の列幅をドラッグで変えられるようにする。
 * 変えた幅はこのパソコンに記憶し、次に開いたときも同じ幅で表示する。
 */
export function useColumnWidths(
  storageKey: string,
  defaults: number[],
): ColumnWidths {
  const [widths, setWidths] = useState<number[]>(() =>
    read(storageKey, defaults),
  );
  const latest = useRef(widths);
  latest.current = widths;

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [storageKey, widths]);

  const startResize = useCallback(
    (index: number, event: React.MouseEvent): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = latest.current[index] ?? MIN_WIDTH;
      const move = (e: MouseEvent): void => {
        const next = [...latest.current];
        next[index] = Math.max(MIN_WIDTH, startWidth + e.clientX - startX);
        setWidths(next);
      };
      const up = (): void => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [],
  );

  const reset = useCallback(() => setWidths(defaults), [defaults]);

  return { widths, startResize, reset };
}
