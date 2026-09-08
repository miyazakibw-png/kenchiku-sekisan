import { describe, expect, it } from "vitest";
import {
  calcSet,
  commentSet,
  isCommentSet,
} from "../../src/core/room/calcSheet";
import {
  defaultLowerTemplate,
  hasLowerContent,
  isLowerBlank,
  lowerFromTemplate,
  lowerTemplateFrom,
  parseLowerTemplate,
} from "../../src/core/room/lowerTemplate";

describe("部屋別計算書 下段の初期状態", () => {
  it("初めの初期状態は色付き見出し＋床・巾木・壁・柱型・梁型・天井・その他・その他", () => {
    const template = defaultLowerTemplate();
    expect(template).toHaveLength(16);
    const parts = template.filter((set) => !isCommentSet(set));
    expect(parts.map((set) => set.partName)).toEqual([
      "床",
      "巾木",
      "壁",
      "柱型",
      "梁型",
      "天井",
      "その他",
      "その他",
    ]);
    template.forEach((set, index) => {
      if (index % 2 === 0) {
        expect(isCommentSet(set)).toBe(true);
        expect(set.banner?.color).toMatch(/^#/);
      } else {
        expect(set.details).toHaveLength(1);
        expect(set.lines).toHaveLength(1);
      }
    });
    // 見出し色は全部違う
    const colors = template.filter(isCommentSet).map((s) => s.banner?.color);
    expect(new Set(colors).size).toBe(8);
  });

  it("今の計算書から初期状態を作ると、見出しと部位だけ残り明細・計算式は空になる", () => {
    const floor = calcSet(2);
    floor.partNumber = 10;
    floor.partName = "床";
    floor.details[0].name = "フローリング";
    floor.details[0].detailNumber = 123;
    floor.lines[0].formulaA = "FA";
    floor.lines[0].bSymbol = "B1";
    const wall = calcSet(1);
    wall.partName = "壁";
    wall.banner = { text: "壁まわり", color: "#dbeafe" };

    const template = lowerTemplateFrom([
      commentSet("床まわり", "#dcfce7"),
      floor,
      wall,
    ]);
    expect(template.map((set) => set.banner?.text ?? set.partName)).toEqual([
      "床まわり",
      "床",
      "壁まわり",
      "壁",
    ]);
    expect(template[1].partNumber).toBe(10);
    expect(template[1].details).toHaveLength(1);
    expect(template[1].details[0].name).toBe("");
    expect(template[1].details[0].detailNumber).toBeNull();
    expect(template[1].lines).toHaveLength(1);
    expect(template[1].lines[0].formulaA).toBe("");
    expect(template[1].lines[0].bSymbol).toBe("");
    expect(template[3].banner).toBeNull();
    expect(hasLowerContent(template)).toBe(true); // 見出しの文字は中身に数える
  });

  it("初期状態を計算書に入れるたびに新しいIDになる", () => {
    const template = defaultLowerTemplate();
    const first = lowerFromTemplate(template);
    const second = lowerFromTemplate(template);
    expect(first[1].id).not.toBe(second[1].id);
    expect(first[1].details[0].id).not.toBe(second[1].details[0].id);
    expect(first[1].lines[0].id).not.toBe(second[1].lines[0].id);
    expect(first[1].partName).toBe(second[1].partName);
  });

  it("初期状態のままの下段は空扱い（中身なし）、明細や式を入れると中身あり", () => {
    const sets = lowerFromTemplate(defaultLowerTemplate());
    expect(hasLowerContent(sets)).toBe(false);
    expect(isLowerBlank(sets)).toBe(false); // 部位は入っているので置き換えはしない
    expect(isLowerBlank([])).toBe(true);
    expect(isLowerBlank([calcSet(1)])).toBe(true);

    const typed = lowerFromTemplate(defaultLowerTemplate());
    typed[1].lines[0].formulaA = "3.6*2.7";
    expect(hasLowerContent(typed)).toBe(true);

    const named = lowerFromTemplate(defaultLowerTemplate());
    named[3].details[0].name = "ビニル巾木";
    expect(hasLowerContent(named)).toBe(true);
  });

  it("保存が無い・壊れているときは初めの初期状態、空の配列はそのまま", () => {
    expect(parseLowerTemplate(null)).toHaveLength(16);
    expect(parseLowerTemplate("")).toHaveLength(16);
    expect(parseLowerTemplate("{bad")).toHaveLength(16);
    expect(parseLowerTemplate('{"a":1}')).toHaveLength(16);
    expect(parseLowerTemplate("[]")).toEqual([]);
    const saved = JSON.stringify([commentSet("仕上", "#fef9c3"), calcSet(1)]);
    expect(parseLowerTemplate(saved)).toHaveLength(2);
  });
});
