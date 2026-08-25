/**
 * 型枠転記（打放型枠など）。
 * 集計書兼工事マスターの明細（コンクリート壁など）を選び、
 * その明細の「部屋ごとの拾い数量」を型枠分類（部位別入力表で付けた分類）で分けて合算し、
 * 掛け率を掛けて、別の明細（型枠）として転記入力表へ自動転記する。
 *
 * 選んだ明細（元明細）と転記先の書式は明細自体が覚えているので、
 * 計算書を直して集計をかけ直しても、そのつど型枠数量を作り直せる。
 */

/** 集計詳細データ（部屋ごとの拾い1行） */
export interface FormworkSourceDetail {
  /** 集計書兼工事マスターの明細をまとめるキー（元明細の指定に使う） */
  masterKey: string;
  /** 型枠分類（部位別入力表で付けた分類） */
  formwork: string;
  part1: string;
  part2: string;
  part2Split: boolean;
  quantity: number;
}

/** 型枠転記の1本。元明細（複数可）＋掛け率＋転記先の書式を持つ */
export interface FormworkTransferRule {
  /** ルールの目印。転記した行に付けるので、作り直しても二重に増えない */
  key: string;
  /** 算出のもとにする集計明細（集計書兼工事マスターの明細） */
  sourceKeys: string[];
  /** 型枠分類での絞り込み（空欄なら分類を問わず、元明細の数量を全部使う） */
  formwork: string;
  coefficient: number;
  subjectId: number | null;
  materialCategory: string;
  /** 転記先の部位Ⅰ（空欄なら元明細の部位Ⅰをそのまま使う） */
  part1: string;
  /** 転記先の部位Ⅱ（空欄なら元明細の部位Ⅱをそのまま使う） */
  part2: string;
  /** 転記先の部位Ⅲ */
  part3: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  description: string;
  unit: string;
  remarks: string;
}

/** 型枠転記でできる行（転記入力表へ入れる） */
export interface FormworkTransferRow {
  /** 生成元が分かる印（ルールの目印）。作り直すときの目印にする */
  formworkKey: string;
  /** もとになった型枠分類（分類で分けていないときは空欄） */
  formwork: string;
  part1: string;
  part2: string;
  part2Split: boolean;
  part3: string;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  description: string;
  /** 集計数量×掛け率（小数2桁） */
  quantity: number;
  sourceQuantity: number;
  unit: string;
  remarks: string;
}

/** 元明細ごとの型枠分類別の数量（画面で確かめるための表） */
export interface FormworkSourceGroup {
  masterKey: string;
  formwork: string;
  part1: string;
  part2: string;
  part2Split: boolean;
  quantity: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 元明細×型枠分類×部位Ⅰ×部位Ⅱ で合算する */
export function collectFormworkQuantities(
  details: readonly FormworkSourceDetail[],
): FormworkSourceGroup[] {
  const groups = new Map<string, FormworkSourceGroup>();
  details.forEach((detail) => {
    const part2 = detail.part2Split ? detail.part2 : "";
    const key = `${detail.masterKey}|${detail.formwork}|${detail.part1}|${part2}`;
    const group = groups.get(key) ?? {
      masterKey: detail.masterKey,
      formwork: detail.formwork,
      part1: detail.part1,
      part2,
      part2Split: detail.part2Split,
      quantity: 0,
    };
    group.quantity += detail.quantity;
    groups.set(key, group);
  });
  return [...groups.values()].map((group) => ({
    ...group,
    quantity: round2(group.quantity),
  }));
}

/**
 * 転記入力表へ入れる行を作る。
 * 元明細を選んでいない、または名称の無いルールは作らない。
 * 行は 型枠分類×部位Ⅰ×部位Ⅱ でまとめる（部位Ⅱは仕分け✔のある行だけ分ける）。
 */
export function buildFormworkTransferRows(
  details: readonly FormworkSourceDetail[],
  rules: readonly FormworkTransferRule[],
): FormworkTransferRow[] {
  const rows: FormworkTransferRow[] = [];
  rules.forEach((rule) => {
    if (rule.sourceKeys.length === 0 || rule.name.trim() === "") return;
    const filter = rule.formwork.trim();
    const targets = details.filter(
      (detail) =>
        rule.sourceKeys.includes(detail.masterKey) &&
        (filter === "" || detail.formwork.trim() === filter),
    );
    const groups = new Map<string, FormworkSourceGroup>();
    targets.forEach((detail) => {
      const part2 = detail.part2Split ? detail.part2 : "";
      const formwork = filter === "" ? detail.formwork.trim() : filter;
      const key = `${formwork}|${detail.part1}|${part2}`;
      const group = groups.get(key) ?? {
        masterKey: "",
        formwork,
        part1: detail.part1,
        part2,
        part2Split: detail.part2Split,
        quantity: 0,
      };
      group.quantity += detail.quantity;
      groups.set(key, group);
    });
    [...groups.values()].forEach((group) => {
      const quantity = round2(group.quantity);
      if (quantity === 0) return;
      const coefficient = rule.coefficient === 0 ? 1 : rule.coefficient;
      rows.push({
        formworkKey: rule.key,
        formwork: group.formwork,
        part1: rule.part1 === "" ? group.part1 : rule.part1,
        part2: rule.part2 === "" ? group.part2 : rule.part2,
        part2Split: group.part2Split,
        part3: rule.part3,
        subjectId: rule.subjectId,
        materialCategory: rule.materialCategory,
        partNumber: rule.partNumber,
        partName: rule.partName,
        detailNumber: rule.detailNumber,
        name: rule.name,
        description: rule.description,
        quantity: round2(quantity * coefficient),
        sourceQuantity: quantity,
        unit: rule.unit,
        remarks: rule.remarks,
      });
    });
  });
  return rows;
}
