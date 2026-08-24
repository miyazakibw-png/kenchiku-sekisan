import type {
  CalcDetail,
  CalcLine,
  CalcSet,
} from "../../../../core/room/calcSheet";

/**
 * セット・明細のコピー内容を計算書どうしで持ち回るための置き場。
 * Windowsのクリップボードへ入れた文字列も一緒に覚えておき、
 * 貼り付けのときに「この画面でコピーしたもの」か「Excelからのもの」かを見分ける。
 */
export type CalcClip =
  | { kind: "set"; text: string; set: CalcSet }
  | { kind: "detail"; text: string; detail: CalcDetail }
  | {
      kind: "rows";
      text: string;
      details: CalcDetail[];
      lines: CalcLine[];
    };

let clip: CalcClip | null = null;

export function setCalcClip(next: CalcClip): void {
  clip = next;
}

/** クリップボードの文字列と一致するときだけ、コピーしたセット・明細を返す */
export function getCalcClip(clipboardText: string): CalcClip | null {
  if (clip === null) return null;
  return clip.text === clipboardText ? clip : null;
}
