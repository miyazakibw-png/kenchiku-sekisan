import {
  calcSet,
  commentSet,
  isCommentSet,
  normalizeSets,
  withUniqueIds,
  type CalcSet,
} from "./calcSheet";

/**
 * 部屋別計算書の下段（セット明細計算表）の初期状態。
 * 新しい計算書を開いたときに、色付きの見出し行＋部位だけ入ったセットを並べておく。
 * 全物件共通で1つ持ち、人が今の計算書の並びを「初期状態として保存」で置き換えられる。
 */

/** 初めの初期状態（見出し色は※行挿入で選べる色と同じ） */
const DEFAULT_PARTS: { partName: string; color: string }[] = [
  { partName: "床", color: "#dcfce7" },
  { partName: "巾木", color: "#fce7f3" },
  { partName: "壁", color: "#dbeafe" },
  { partName: "柱型", color: "#fef9c3" },
  { partName: "梁型", color: "#ffedd5" },
  { partName: "天井", color: "#e2e8f0" },
  { partName: "その他", color: "#ede9fe" },
  { partName: "その他", color: "#cffafe" },
];

export function defaultLowerTemplate(): CalcSet[] {
  return DEFAULT_PARTS.flatMap(({ partName, color }) => {
    const set = calcSet(1);
    return [commentSet("", color), { ...set, partName }];
  });
}

/**
 * 今の計算書の並びから初期状態を作る。
 * 残すのは見出し行（文字と色）と各セットの部位（番号・名称）だけで、
 * 明細の中身・計算式・記号は空にする（部屋ごとの数量が初期状態に混ざらないように）。
 */
export function lowerTemplateFrom(sets: readonly CalcSet[]): CalcSet[] {
  const template: CalcSet[] = [];
  sets.forEach((set) => {
    if (set.banner != null)
      template.push(commentSet(set.banner.text, set.banner.color));
    if (isCommentSet(set)) return;
    const blank = calcSet(1);
    template.push({
      ...blank,
      partNumber: set.partNumber,
      partName: set.partName,
    });
  });
  return template;
}

/** 初期状態を計算書に入れる形にする（IDは毎回新しく振る） */
export function lowerFromTemplate(template: readonly CalcSet[]): CalcSet[] {
  return withUniqueIds(
    template.map((set) => ({
      ...set,
      id: "",
      details: set.details.map((detail) => ({ ...detail, id: "" })),
      lines: set.lines.map((line) => ({ ...line, id: "" })),
    })),
  );
}

/**
 * 下段に人が入れた中身（明細・計算式・見出しの文字）があるか。
 * 見出しの色とセットの部位だけ（＝初期状態のまま）なら中身なしと見る。
 */
export function hasLowerContent(sets: readonly CalcSet[]): boolean {
  return sets.some(
    (set) =>
      (set.banner?.text.trim() ?? "") !== "" ||
      set.details.some(
        (detail) =>
          detail.name.trim() !== "" ||
          detail.partName.trim() !== "" ||
          detail.descriptionUpper.trim() !== "" ||
          detail.descriptionLower.trim() !== "" ||
          detail.detailNumber !== null,
      ) ||
      set.lines.some(
        (line) =>
          line.formulaA.trim() !== "" ||
          line.formulaB.trim() !== "" ||
          line.comment.trim() !== "",
      ),
  );
}

/** 保存してある初期状態を読む（壊れていれば初めの初期状態） */
export function parseLowerTemplate(json: string | null | undefined): CalcSet[] {
  if (json == null || json === "") return defaultLowerTemplate();
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return defaultLowerTemplate();
    return normalizeSets(parsed as CalcSet[]);
  } catch {
    return defaultLowerTemplate();
  }
}
