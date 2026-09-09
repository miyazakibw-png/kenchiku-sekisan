import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { app, screen, type BrowserWindow } from "electron";

/** 記憶するウィンドウの種類（本体の画面・明細入力の小窓） */
export type WindowKind = "main" | "calc";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

type StateFile = Partial<Record<WindowKind, Bounds>>;

function statePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function readState(): StateFile {
  try {
    const path = statePath();
    if (!existsSync(path)) return {};
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as StateFile)
      : {};
  } catch {
    return {};
  }
}

function writeState(state: StateFile): void {
  try {
    const path = statePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state), "utf8");
  } catch {
    // 記憶できなくても動作には影響しないので何もしない
  }
}

/** 画面の外に出てしまった位置は使わない（モニタ構成が変わったとき用） */
function onScreen(bounds: Bounds): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x + bounds.width > area.x &&
      bounds.y + bounds.height > area.y &&
      bounds.x < area.x + area.width &&
      bounds.y < area.y + area.height
    );
  });
}

/** 前に使った大きさ・位置（無ければ既定の大きさ） */
export function savedBounds(
  kind: WindowKind,
  fallback: { width: number; height: number },
): { width: number; height: number; x?: number; y?: number } {
  const saved = readState()[kind];
  if (!saved) return fallback;
  const size = { width: saved.width, height: saved.height };
  return onScreen(saved) ? { ...size, x: saved.x, y: saved.y } : size;
}

/** 最大化していたかどうか */
export function wasMaximized(kind: WindowKind): boolean {
  return readState()[kind]?.maximized === true;
}

/** 大きさ・位置・最大化を記憶する（動かすたび・閉じるときに書き出す） */
export function rememberWindowState(
  window: BrowserWindow,
  kind: WindowKind,
): void {
  let timer: NodeJS.Timeout | null = null;
  const store = (): void => {
    if (window.isDestroyed() || window.isMinimized()) return;
    const maximized = window.isMaximized();
    // 最大化中は元の大きさ（戻したときの大きさ）を残す
    const bounds = maximized ? window.getNormalBounds() : window.getBounds();
    writeState({
      ...readState(),
      [kind]: { ...bounds, maximized },
    });
  };
  const later = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(store, 400);
  };
  window.on("resize", later);
  window.on("move", later);
  window.on("maximize", store);
  window.on("unmaximize", store);
  window.on("close", () => {
    if (timer) clearTimeout(timer);
    store();
  });
}
