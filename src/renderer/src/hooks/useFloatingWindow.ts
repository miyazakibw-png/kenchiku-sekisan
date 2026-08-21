import { useCallback, useEffect, useRef, useState } from "react";

/** 切り離した小窓の位置と大きさ（画面座標・px） */
export interface FloatingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Stored {
  floating: boolean;
  rect: FloatingRect;
}

interface FloatingWindow {
  floating: boolean;
  setFloating: (on: boolean) => void;
  rect: FloatingRect;
  /** 見出し部分の押し下げで移動を始める */
  startMove: (event: React.MouseEvent) => void;
  /** 右下のつまみの押し下げで大きさ変更を始める */
  startResize: (event: React.MouseEvent) => void;
}

const MIN_WIDTH = 420;
const MIN_HEIGHT = 160;

function load(key: string, initial: FloatingRect): Stored {
  try {
    const text = window.localStorage.getItem(key);
    if (!text) return { floating: false, rect: initial };
    const value = JSON.parse(text) as Partial<Stored>;
    const rect = { ...initial, ...(value.rect ?? {}) };
    return { floating: value.floating === true, rect };
  } catch {
    return { floating: false, rect: initial };
  }
}

/**
 * 画面の一部を切り離して、移動・大きさ変更ができる小窓にする。
 * 位置・大きさ・切り離しの状態は次回も同じになるよう保存する。
 */
export function useFloatingWindow(
  key: string,
  initial: FloatingRect,
): FloatingWindow {
  const [state, setState] = useState<Stored>(() => load(key, initial));
  const drag = useRef<{
    mode: "move" | "resize";
    x: number;
    y: number;
    rect: FloatingRect;
  } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const start = drag.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      setState((prev) => ({
        ...prev,
        rect:
          start.mode === "move"
            ? {
                ...start.rect,
                // 画面の外へ出して掴めなくならないようにする
                x: Math.min(
                  Math.max(0, start.rect.x + dx),
                  window.innerWidth - 120,
                ),
                y: Math.min(
                  Math.max(0, start.rect.y + dy),
                  window.innerHeight - 40,
                ),
              }
            : {
                ...start.rect,
                w: Math.max(MIN_WIDTH, start.rect.w + dx),
                h: Math.max(MIN_HEIGHT, start.rect.h + dy),
              },
      }));
    };
    const onUp = (): void => {
      drag.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const begin = useCallback(
    (mode: "move" | "resize", event: React.MouseEvent): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = {
        mode,
        x: event.clientX,
        y: event.clientY,
        rect: state.rect,
      };
    },
    [state.rect],
  );

  return {
    floating: state.floating,
    setFloating: (on: boolean) =>
      setState((prev) => ({ ...prev, floating: on })),
    rect: state.rect,
    startMove: (event) => begin("move", event),
    startResize: (event) => begin("resize", event),
  };
}
