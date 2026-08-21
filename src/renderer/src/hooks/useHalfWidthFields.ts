import { useEffect } from "react";
import { needsHalfWidth, toHalfWidth } from "../../../core/text/halfWidth";

/** 日本語で入れる欄（部位名・名称・摘要・備考など）は lang="ja" を付けて除外する */
function isJapaneseField(input: HTMLInputElement): boolean {
  return input.lang === "ja" || input.closest('[lang="ja"]') !== null;
}

/** React の管理下にある input の値を書き換える（onChange を通す） */
function setValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * ID・番号・計算式など日本語以外の欄は、日本語入力のまま打っても半角英数へ直す。
 * 変換中（IMEで文字を作っている間）は触らず、確定してから直す。
 */
export function useHalfWidthFields(): void {
  useEffect(() => {
    const fix = (event: Event): void => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.type !== "text" && input.type !== "search") return;
      if (isJapaneseField(input)) return;
      if (event instanceof InputEvent && event.isComposing) return;
      if (!needsHalfWidth(input.value)) return;
      const at = input.selectionStart;
      setValue(input, toHalfWidth(input.value));
      if (at !== null) input.setSelectionRange(at, at);
    };
    document.addEventListener("input", fix);
    document.addEventListener("compositionend", fix);
    return () => {
      document.removeEventListener("input", fix);
      document.removeEventListener("compositionend", fix);
    };
  }, []);
}
