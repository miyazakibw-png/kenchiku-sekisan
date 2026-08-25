import type {
  CalcDetail,
  CalcLine,
  CalcSet,
} from "../../../../core/room/calcSheet";

/**
 * セット・明細のコピー内容を計算書どうしで持ち回るための置き場。
 * Windowsのクリップボードへ入れた文字列も一緒に覚えておき、
 * 貼り付けのときに「この画面でコピーしたもの」か「Excelからのもの」かを見分ける。
 * 別ウィンドウの計算書へも貼れるよう、内容はブラウザの保存領域にも残す。
 */
export type CalcClip =
  | { kind: "set"; text: string; set: CalcSet }
  | { kind: "detail"; text: string; detail: CalcDetail }
  | {
      kind: "rows";
      text: string;
      details: CalcDetail[];
      lines: CalcLine[];
      /** 写し元のセットの部位（貼り付け先の部位が空のときだけ使う） */
      partNumber: number | null;
      partName: string;
    };

const STORAGE_KEY = "calcClip";

let clip: CalcClip | null = null;

/** 改行コードや末尾の空行の違いを無視して見比べるための形にそろえる */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

export function setCalcClip(next: CalcClip): void {
  clip = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくてもこの画面の中では貼り付けできるので何もしない
  }
}

function storedClip(): CalcClip | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as CalcClip)
      : null;
  } catch {
    return null;
  }
}

/** クリップボードの文字列と一致するときだけ、コピーしたセット・明細を返す */
export function getCalcClip(clipboardText: string): CalcClip | null {
  const text = normalize(clipboardText);
  if (clip !== null && normalize(clip.text) === text) return clip;
  const saved = storedClip();
  if (saved !== null && normalize(saved.text) === text) {
    clip = saved;
    return saved;
  }
  return null;
}
