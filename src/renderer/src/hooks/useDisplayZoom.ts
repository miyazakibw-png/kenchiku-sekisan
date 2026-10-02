import { useCallback, useEffect, useState } from "react";

/**
 * 画面全体の表示倍率（ブラウザのズームと同じ仕組み）。
 * 覚えた倍率を全部のウィンドウにかける。0.5〜1.6（50〜160%）。
 */

const ZOOM_KEY = "app.displayZoom";
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.6;
/** 選べる倍率（5%きざみ） */
export const ZOOM_STEPS = Array.from(
  { length: (ZOOM_MAX - ZOOM_MIN) * 20 + 1 },
  (_value, index) => ZOOM_MIN + index * 0.05,
);

function clampZoom(factor: number): number {
  return Math.min(Math.max(factor, ZOOM_MIN), ZOOM_MAX);
}

export function loadDisplayZoom(): number {
  const raw = window.localStorage.getItem(ZOOM_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? clampZoom(parsed) : 1;
}

function saveDisplayZoom(factor: number): void {
  window.localStorage.setItem(ZOOM_KEY, String(factor));
}

export function useDisplayZoom(): [number, (factor: number) => void] {
  const [factor, setFactor] = useState(loadDisplayZoom);

  const apply = useCallback((next: number) => {
    setFactor(clampZoom(next));
  }, []);

  // 起動時・変更時に実際の倍率をかけて覚える
  useEffect(() => {
    window.sekisan.setZoomFactor(factor);
    saveDisplayZoom(factor);
  }, [factor]);

  // 別ウィンドウで倍率が変わったらこの画面にも同じ倍率をかける
  useEffect(() => {
    const sync = (event: StorageEvent): void => {
      if (event.key === null || event.key === ZOOM_KEY)
        setFactor(loadDisplayZoom());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  // Ctrl＋−／＋／0 でブラウザと同じズーム操作
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setFactor((current) => clampZoom(current - 0.05));
      } else if (event.key === "+" || event.key === "=" || event.key === ";") {
        event.preventDefault();
        setFactor((current) => clampZoom(current + 0.05));
      } else if (event.key === "0") {
        event.preventDefault();
        setFactor(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return [factor, apply];
}
