import { useEffect } from "react";
import type { LineStyleSettings } from "@shared/types";

/**
 * 画面の罫線（細い線＝表のマス目、太い線＝まとまりの区切り）。
 * 既定の細い線は家具・設備入力表と同じ細さ・色にそろえてある。
 */
export const DEFAULT_LINE_STYLES: LineStyleSettings = {
  thin: { width: 1, style: "solid", color: "#999999" },
  thick: { width: 2, style: "solid", color: "#94a3b8" },
};

function lineText(line: LineStyleSettings["thin"]): string {
  return `${line.width}px ${line.style} ${line.color}`;
}

/** 罫線の設定を画面全体（CSS変数）へ反映する */
export function applyLineStyles(settings: LineStyleSettings): void {
  const root = document.documentElement;
  root.style.setProperty("--line-thin", lineText(settings.thin));
  root.style.setProperty("--line-thick", lineText(settings.thick));
  root.style.setProperty("--line-thin-color", settings.thin.color);
  root.style.setProperty("--line-thick-color", settings.thick.color);
}

/** ソフトを開いたときに、保存してある罫線の設定を当てる（他ウィンドウでの変更にも追従する） */
export function useLineStyles(): void {
  useEffect(() => {
    void window.sekisan.getLineStyles().then((saved) => {
      applyLineStyles(saved ?? DEFAULT_LINE_STYLES);
    });
    window.sekisan.onLineStylesChanged(applyLineStyles);
  }, []);
}
