import { useEffect } from "react";
import { needsHalfWidth, toHalfWidth } from "../../../core/text/halfWidth";
import { hasKana, kanaToRomaji, romajiToKana } from "../../../core/text/romaji";

/** 日本語で入れる欄（部位名・名称・摘要・備考など）は lang="ja" を付けて分ける */
export function isJapaneseField(input: HTMLInputElement): boolean {
  return input.lang === "ja" || input.closest('[lang="ja"]') !== null;
}

/**
 * 番号でもマスターの名前でも入れる欄（部位・区分・科目・ID・単位）は
 * data-half を付けて、全角の英数字だけ半角へ直す（かな・カタカナはそのまま）。
 */
export function isHalfWidthField(input: HTMLInputElement): boolean {
  return input.dataset.half === "1";
}

/** React の管理下にある input の値を書き換える（onChange を通す） */
export function setValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const KANA_SETTING = "sekisan.autoKana";

/**
 * 「ローマ字を自動でひらがなにする」を使うか（設定画面で切り替える）。
 * 日本語入力（IME）で文字を作っている間は触らないので、漢字変換はそのまま使える。
 * 初期は使う（IMEが切れたままでも日本語の欄にひらがなが入る）。
 */
export function isAutoKanaOn(): boolean {
  return window.localStorage.getItem(KANA_SETTING) !== "off";
}

export function setAutoKana(on: boolean): void {
  window.localStorage.setItem(KANA_SETTING, on ? "on" : "off");
}

function editable(input: EventTarget | null): input is HTMLInputElement {
  return (
    input instanceof HTMLInputElement &&
    (input.type === "text" || input.type === "search")
  );
}

/**
 * 欄ごとに入力の文字を自動で合わせる。
 * ・ID・番号・計算式など半角の欄：全角の英数字を半角へ、かなで打ったらローマ字（半角）へ
 * ・部位名・名称・摘要・備考など日本語の欄：小文字のローマ字をひらがなへ
 * 変換中（IMEで文字を作っている間）は触らず、確定してから直す。
 */
export function useHalfWidthFields(): void {
  useEffect(() => {
    const fix = (event: Event): void => {
      const input = event.target;
      if (!editable(input)) return;
      if (event instanceof InputEvent && event.isComposing) return;
      const at = input.selectionStart ?? input.value.length;

      if (isHalfWidthField(input)) {
        // 日本語入力のまま打った「かな」も半角の英数字へ直す
        let value = input.value;
        if (hasKana(value)) value = kanaToRomaji(value);
        value = toHalfWidth(value);
        if (value === input.value) return;
        setValue(input, value);
        const caret = Math.min(at, value.length);
        input.setSelectionRange(caret, caret);
        return;
      }

      if (isJapaneseField(input)) {
        // 変換を確定した文字は触らない（漢字変換を壊さない）
        if (!isAutoKanaOn() || event.type === "compositionend") return;
        const head = input.value.slice(0, at);
        const converted = romajiToKana(head);
        if (converted === head) return;
        setValue(input, converted + input.value.slice(at));
        input.setSelectionRange(converted.length, converted.length);
        return;
      }

      let value = input.value;
      if (hasKana(value)) value = kanaToRomaji(value);
      if (needsHalfWidth(value)) value = toHalfWidth(value);
      if (value === input.value) return;
      setValue(input, value);
      const caret = Math.min(at, value.length);
      input.setSelectionRange(caret, caret);
    };
    document.addEventListener("input", fix);
    document.addEventListener("compositionend", fix);
    return () => {
      document.removeEventListener("input", fix);
      document.removeEventListener("compositionend", fix);
    };
  }, []);
}
