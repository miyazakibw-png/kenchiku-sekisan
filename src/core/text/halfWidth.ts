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

const HALF_WIDTH_KATAKANA: ReadonlyMap<string, string> = new Map([
  ["ァ", "ｧ"],
  ["ア", "ｱ"],
  ["ィ", "ｨ"],
  ["イ", "ｲ"],
  ["ゥ", "ｩ"],
  ["ウ", "ｳ"],
  ["ェ", "ｪ"],
  ["エ", "ｴ"],
  ["ォ", "ｫ"],
  ["オ", "ｵ"],
  ["カ", "ｶ"],
  ["キ", "ｷ"],
  ["ク", "ｸ"],
  ["ケ", "ｹ"],
  ["コ", "ｺ"],
  ["サ", "ｻ"],
  ["シ", "ｼ"],
  ["ス", "ｽ"],
  ["セ", "ｾ"],
  ["ソ", "ｿ"],
  ["タ", "ﾀ"],
  ["チ", "ﾁ"],
  ["ッ", "ｯ"],
  ["ツ", "ﾂ"],
  ["テ", "ﾃ"],
  ["ト", "ﾄ"],
  ["ナ", "ﾅ"],
  ["ニ", "ﾆ"],
  ["ヌ", "ﾇ"],
  ["ネ", "ﾈ"],
  ["ノ", "ﾉ"],
  ["ハ", "ﾊ"],
  ["ヒ", "ﾋ"],
  ["フ", "ﾌ"],
  ["ヘ", "ﾍ"],
  ["ホ", "ﾎ"],
  ["マ", "ﾏ"],
  ["ミ", "ﾐ"],
  ["ム", "ﾑ"],
  ["メ", "ﾒ"],
  ["モ", "ﾓ"],
  ["ャ", "ｬ"],
  ["ヤ", "ﾔ"],
  ["ュ", "ｭ"],
  ["ユ", "ﾕ"],
  ["ョ", "ｮ"],
  ["ヨ", "ﾖ"],
  ["ラ", "ﾗ"],
  ["リ", "ﾘ"],
  ["ル", "ﾙ"],
  ["レ", "ﾚ"],
  ["ロ", "ﾛ"],
  ["ワ", "ﾜ"],
  ["ヲ", "ｦ"],
  ["ン", "ﾝ"],
  ["ー", "ｰ"],
  ["。", "｡"],
  ["「", "｢"],
  ["」", "｣"],
  ["、", "､"],
  ["・", "･"],
]);

function toHalfWidthKatakana(character: string): string | undefined {
  const decomposed = Array.from(character.normalize("NFD"));
  if (decomposed.length === 2) {
    const base = HALF_WIDTH_KATAKANA.get(decomposed[0]);
    if (base !== undefined && decomposed[1] === "\u3099") return `${base}ﾞ`;
    if (base !== undefined && decomposed[1] === "\u309a") return `${base}ﾟ`;
  }
  return HALF_WIDTH_KATAKANA.get(character);
}

/** 名前用の半角化：英数字・記号・空白・カタカナを半角に（漢字・ひらがなはそのまま。ーはｰ） */
export function toHalfWidthName(text: string): string {
  let converted = "";
  const characters = Array.from(text);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0xff01 && code <= 0xff5e) {
      converted += String.fromCodePoint(code - 0xfee0);
      continue;
    }
    if (character === "\u3000") {
      converted += " ";
      continue;
    }
    const base = HALF_WIDTH_KATAKANA.get(character);
    const next = characters[index + 1];
    const mark =
      next === "\u3099" || next === "\u309b"
        ? "ﾞ"
        : next === "\u309a" || next === "\u309c"
          ? "ﾟ"
          : "";
    if (base !== undefined && mark !== "") {
      converted += `${base}${mark}`;
      index += 1;
    } else {
      converted += toHalfWidthKatakana(character) ?? character;
    }
  }
  return converted;
}

/** 半角へ直す必要があるか（無駄な書き換えを避ける） */
export function needsHalfWidth(text: string): boolean {
  return toHalfWidth(text) !== text;
}
