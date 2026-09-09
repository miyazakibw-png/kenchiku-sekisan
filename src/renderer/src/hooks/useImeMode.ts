import { useEffect } from "react";
import type { ImeMode } from "@shared/types";
import { isHalfWidthField } from "./useHalfWidthFields";

/**
 * 日本語で入れる欄か。画面全体（html・body）の lang="ja" は数えない
 * （数えると計算式などの欄まで日本語の欄になってしまう）。
 */
function japaneseField(input: HTMLInputElement): boolean {
  if (isHalfWidthField(input)) return false;
  if (input.lang === "ja") return true;
  const holder = input.closest('[lang="ja"]');
  return (
    holder !== null &&
    holder !== document.documentElement &&
    holder !== document.body
  );
}

/**
 * 入った欄に合わせてWindowsの日本語入力を切り替える。
 * ・部位名・名称・摘要・備考など日本語の欄（lang="ja"）：ひらがな
 * ・ID・単位・計算式など半角の欄、それ以外の欄：半角英数
 */
function modeOf(target: EventTarget | null): ImeMode | null {
  if (target instanceof HTMLTextAreaElement) return "hiragana";
  if (!(target instanceof HTMLInputElement)) return null;
  if (target.type !== "text" && target.type !== "search") return null;
  return japaneseField(target) ? "hiragana" : "alphanumeric";
}

const SETTING_KEY = "ime-auto";

/** 欄ごとの自動切り替えを使うか（初期は使う） */
export function imeAutoEnabled(): boolean {
  return window.localStorage.getItem(SETTING_KEY) !== "0";
}

export function setImeAutoEnabled(enabled: boolean): void {
  window.localStorage.setItem(SETTING_KEY, enabled ? "1" : "0");
}

export function useImeMode(): void {
  useEffect(() => {
    let current: ImeMode | null = null;
    const onFocus = (event: FocusEvent): void => {
      if (!imeAutoEnabled()) return;
      const mode = modeOf(event.target);
      if (mode === null || mode === current) return;
      current = mode;
      void window.sekisan.setImeMode(mode);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
}
