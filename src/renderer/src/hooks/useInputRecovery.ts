import { useEffect } from "react";

/**
 * 画面へ入力先（フォーカス）を戻す。
 * 選択欄や窓を使ったあと、Windowsで入力先が別の窓に残って文字が入らなくなることがあるため。
 */
export async function refocusWindow(): Promise<void> {
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  await window.sekisan.focusWindow();
  window.focus();
  if (active !== null && document.contains(active)) active.focus();
}

/**
 * 文字が入らなくなったときの復帰。
 * ・選択欄（プルダウン）を使ったあとは自動で入力先を戻す
 * ・Escキーでいつでも入力先を戻せる
 */
export function useInputRecovery(): void {
  useEffect(() => {
    const onChange = (event: Event): void => {
      if (event.target instanceof HTMLSelectElement) void refocusWindow();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") void refocusWindow();
    };
    document.addEventListener("change", onChange, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
