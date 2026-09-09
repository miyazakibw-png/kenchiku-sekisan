/**
 * ローマ字とひらがなの入替え。
 * 日本語で入れる欄（部位名・名称・摘要・備考など）は、日本語入力が半角のままでも
 * 打った小文字のローマ字をひらがなへ直す。
 * ID・番号・計算式など半角で入れる欄は、日本語入力のまま打ったかなをローマ字（半角）へ直す。
 */

/** 3文字以上の並び（拗音・撥音つき） */
const COMBOS: Record<string, string> = {
  kya: "きゃ",
  kyi: "きぃ",
  kyu: "きゅ",
  kye: "きぇ",
  kyo: "きょ",
  gya: "ぎゃ",
  gyu: "ぎゅ",
  gyo: "ぎょ",
  sha: "しゃ",
  shu: "しゅ",
  she: "しぇ",
  sho: "しょ",
  sya: "しゃ",
  syu: "しゅ",
  syo: "しょ",
  shi: "し",
  ja: "じゃ",
  ju: "じゅ",
  je: "じぇ",
  jo: "じょ",
  jya: "じゃ",
  jyu: "じゅ",
  jyo: "じょ",
  zya: "じゃ",
  zyu: "じゅ",
  zyo: "じょ",
  cha: "ちゃ",
  chu: "ちゅ",
  che: "ちぇ",
  cho: "ちょ",
  cya: "ちゃ",
  cyu: "ちゅ",
  cyo: "ちょ",
  chi: "ち",
  tsu: "つ",
  tya: "ちゃ",
  tyu: "ちゅ",
  tyo: "ちょ",
  nya: "にゃ",
  nyu: "にゅ",
  nyo: "にょ",
  hya: "ひゃ",
  hyu: "ひゅ",
  hyo: "ひょ",
  bya: "びゃ",
  byu: "びゅ",
  byo: "びょ",
  pya: "ぴゃ",
  pyu: "ぴゅ",
  pyo: "ぴょ",
  mya: "みゃ",
  myu: "みゅ",
  myo: "みょ",
  rya: "りゃ",
  ryu: "りゅ",
  ryo: "りょ",
  fya: "ふゃ",
  fyu: "ふゅ",
  fyo: "ふょ",
  dya: "ぢゃ",
  dyu: "ぢゅ",
  dyo: "ぢょ",
  xtu: "っ",
  ltu: "っ",
  xya: "ゃ",
  xyu: "ゅ",
  xyo: "ょ",
  fa: "ふぁ",
  fi: "ふぃ",
  fe: "ふぇ",
  fo: "ふぉ",
  va: "ゔぁ",
  vi: "ゔぃ",
  vu: "ゔ",
  ve: "ゔぇ",
  vo: "ゔぉ",
  tha: "てゃ",
  thi: "てぃ",
  thu: "てゅ",
  the: "てぇ",
  tho: "てょ",
  dhi: "でぃ",
  dhu: "でゅ",
};

/** 2文字・1文字の並び */
const BASE: Record<string, string> = {
  a: "あ",
  i: "い",
  u: "う",
  e: "え",
  o: "お",
  ka: "か",
  ki: "き",
  ku: "く",
  ke: "け",
  ko: "こ",
  ga: "が",
  gi: "ぎ",
  gu: "ぐ",
  ge: "げ",
  go: "ご",
  sa: "さ",
  si: "し",
  su: "す",
  se: "せ",
  so: "そ",
  za: "ざ",
  ji: "じ",
  zi: "じ",
  zu: "ず",
  ze: "ぜ",
  zo: "ぞ",
  ta: "た",
  ti: "ち",
  tu: "つ",
  te: "て",
  to: "と",
  da: "だ",
  di: "ぢ",
  du: "づ",
  de: "で",
  do: "ど",
  na: "な",
  ni: "に",
  nu: "ぬ",
  ne: "ね",
  no: "の",
  ha: "は",
  hi: "ひ",
  hu: "ふ",
  fu: "ふ",
  he: "へ",
  ho: "ほ",
  ba: "ば",
  bi: "び",
  bu: "ぶ",
  be: "べ",
  bo: "ぼ",
  pa: "ぱ",
  pi: "ぴ",
  pu: "ぷ",
  pe: "ぺ",
  po: "ぽ",
  ma: "ま",
  mi: "み",
  mu: "む",
  me: "め",
  mo: "も",
  ya: "や",
  yu: "ゆ",
  yo: "よ",
  ra: "ら",
  ri: "り",
  ru: "る",
  re: "れ",
  ro: "ろ",
  wa: "わ",
  wo: "を",
  nn: "ん",
  xa: "ぁ",
  xi: "ぃ",
  xu: "ぅ",
  xe: "ぇ",
  xo: "ぉ",
  la: "ぁ",
  li: "ぃ",
  lu: "ぅ",
  le: "ぇ",
  lo: "ぉ",
};

const VOWELS = "aiueo";
const CONSONANTS = "bcdfghjkmpqrstvwxyz";

/** ひらがなに直す文字かどうか（小文字だけ。大文字・数字・記号は残す） */
function convertible(character: string): boolean {
  return /[a-z]/.test(character);
}

/**
 * 小文字のローマ字をひらがなへ直す。
 * 大文字・数字・記号はそのまま残す（ROOM-A のような表記を壊さない）。
 * 途中の並び（か行の「k」だけなど）は、続きが打たれるまでそのまま残す。
 */
export function romajiToKana(text: string): string {
  let result = "";
  let at = 0;
  while (at < text.length) {
    const character = text[at];
    if (!convertible(character)) {
      result += character;
      at += 1;
      continue;
    }
    const three = text.slice(at, at + 3);
    if (COMBOS[three] !== undefined) {
      result += COMBOS[three];
      at += 3;
      continue;
    }
    const two = text.slice(at, at + 2);
    const kana = COMBOS[two] ?? BASE[two];
    if (kana !== undefined) {
      result += kana;
      at += 2;
      continue;
    }
    // っ（同じ子音の重なり。次が母音・拗音になるときだけ）
    if (
      CONSONANTS.includes(character) &&
      text[at + 1] === character &&
      /[a-z]/.test(text[at + 2] ?? "")
    ) {
      result += "っ";
      at += 1;
      continue;
    }
    // ん（次が子音のとき）
    if (
      character === "n" &&
      text[at + 1] !== undefined &&
      /[a-z]/.test(text[at + 1]) &&
      !VOWELS.includes(text[at + 1]) &&
      text[at + 1] !== "y" &&
      text[at + 1] !== "n"
    ) {
      result += "ん";
      at += 1;
      continue;
    }
    if (BASE[character] !== undefined) {
      result += BASE[character];
      at += 1;
      continue;
    }
    result += character;
    at += 1;
  }
  return result;
}

const TO_ROMAJI = ((): Record<string, string> => {
  const table: Record<string, string> = {};
  const add = (romaji: string, kana: string): void => {
    if (table[kana] === undefined) table[kana] = romaji;
  };
  Object.entries(BASE).forEach(([romaji, kana]) => add(romaji, kana));
  Object.entries(COMBOS).forEach(([romaji, kana]) => add(romaji, kana));
  table["ん"] = "n";
  return table;
})();

/** カタカナをひらがなへ */
function toHiragana(text: string): string {
  let converted = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    converted +=
      code >= 0x30a1 && code <= 0x30f6
        ? String.fromCodePoint(code - 0x60)
        : character;
  }
  return converted;
}

/**
 * かな（ひらがな・カタカナ）を半角のローマ字へ直す。
 * 計算式・ID・記号など半角で入れる欄で、日本語入力のまま打ったときに使う。
 */
export function kanaToRomaji(text: string): string {
  const source = toHiragana(text);
  let result = "";
  let at = 0;
  while (at < source.length) {
    const two = source.slice(at, at + 2);
    if (TO_ROMAJI[two] !== undefined) {
      result += TO_ROMAJI[two];
      at += 2;
      continue;
    }
    const one = source[at];
    if (one === "っ") {
      const next = source[at + 1];
      const romaji = next === undefined ? "" : (TO_ROMAJI[next] ?? "");
      result += romaji.slice(0, 1) === "" ? "" : romaji.slice(0, 1);
      at += 1;
      continue;
    }
    if (TO_ROMAJI[one] !== undefined) {
      result += TO_ROMAJI[one];
      at += 1;
      continue;
    }
    result += one;
    at += 1;
  }
  return result;
}

/** かなが混ざっているか（無駄な書き換えを避ける） */
export function hasKana(text: string): boolean {
  return /[\u3041-\u3096\u30a1-\u30f6\u30fc]/.test(text);
}
