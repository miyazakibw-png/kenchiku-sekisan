/**
 * 全角の英数字・記号・空白を半角へ直す。
 * ID・番号・計算式など半角で入れる欄で、日本語入力のまま打った文字を自動で直すために使う。
 * ひらがな・カタカナ・漢字はそのまま残す（人が見て直せるようにする）。
 */
export function toHalfWidth(text: string): string {
  let converted = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0xff01 && code <= 0xff5e) {
      converted += String.fromCodePoint(code - 0xfee0);
    } else if (character === "\u3000") {
      converted += " ";
    } else if (character === "\u30fc" || character === "\u2212") {
      // 全角の長音・マイナスは計算式で使うマイナスへ直す
      converted += "-";
    } else if (character === "\u3002") {
      converted += ".";
    } else if (character === "\u3001") {
      converted += ",";
    } else {
      converted += character;
    }
  }
  return converted;
}

/** 半角へ直す必要があるか（無駄な書き換えを避ける） */
export function needsHalfWidth(text: string): boolean {
  return toHalfWidth(text) !== text;
}
