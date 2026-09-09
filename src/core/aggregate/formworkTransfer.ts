/**
 * 型枠転記（打放型枠など）。
 *
 * 計算書で型枠に使える数量（普通は打放補修）を拾い、集計したあとに、
 * その明細の数量を型枠の明細（打放型枠など）へ変換して転記入力表へ入れる。
 *
 * ・型枠分類は部位別入力表で部屋ごとに入れる。その部屋で拾った分はその分類になる
 * ・転記先に部位Ⅰ・Ⅱ・Ⅲは要らない。型枠分類がタイトル行になる（部位Ⅰの代わり）
 * ・分類の下は摘要ごとに1行。同じ分類・同じ摘要（同じ名称・単位）は合算する
 * ・掛け率と摘要は元明細ごとに決める
 * ・分類の並びは型枠分類マスターの登録番号順。分類の無い拾いは「分類なし」でまとめる
 *
 * 元明細と転記先の書式は保存するので、計算書を直して集計をかけ直しても作り直せる。
 */

/** 型枠分類が入っていない拾いのまとめ先 */
export const NO_FORMWORK = "分類なし";

/** 生成した行に付ける目印（作り直すときに消す行の判別に使う） */
export const FORMWORK_ROW_KEY = "型枠転記";

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

/** 型枠分類マスター（登録番号順に並べるために使う） */
export interface FormworkCategory {
  id: number;
  name: string;
  displayOrder: number;
}

/** 型枠転記の1本。元明細（合算するときは複数）＋掛け率＋転記先の書式 */
export interface FormworkTransferRule {
  /** ルールの目印 */
  key: string;
  /** 算出のもとにする集計明細（集計書兼工事マスターの明細） */
  sourceKeys: string[];
  /** 掛け率（元明細ごと） */
  coefficient: number;
  subjectId: number | null;
  materialCategory: string;
  /** 転記先名称（例：打放型枠） */
  name: string;
  /** 転記先の摘要 上段（元明細から写して、明細ごとに変えられる） */
  description: string;
  /** 転記先の摘要 下段 */
  descriptionLower: string;
  unit: string;
  remarks: string;
}

/** 型枠転記でできる行（転記入力表へ入れる） */
export interface FormworkTransferRow {
  /** 生成した行の目印。作り直すときの目印にする */
  formworkKey: string;
  /** 型枠分類 */
  formwork: string;
  /** 1: 型枠分類のタイトル行（数量なし） */
  title: boolean;
  part1: string;
  part2: string;
  part2Split: boolean;
  part3: string;
  subjectId: number | null;
  materialCategory: string;
  partNumber: number | null;
  partName: string;
  /** 転記入力表の明細番号（タイトル行も1つ使って連番） */
  detailNumber: number | null;
  name: string;
  description: string;
  descriptionLower: string;
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

/** 一括作成のもとになる元明細（集計書兼工事マスターの明細） */
export interface FormworkBulkSource {
  masterKey: string;
  materialCategory: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
}

/** 名称で探した元明細を、まとめて型枠明細に変えるときの決めごと */
export interface FormworkBulkSpec {
  /** 転記科目（初期は 5 型枠工事） */
  subjectId: number | null;
  /** 転記先名称（例：打放型枠） */
  name: string;
  /** 単位（空欄なら元明細の単位を使う） */
  unit: string;
  /** 掛け率の初期値（あとで明細ごとに直せる） */
  coefficient: number;
  materialCategory: string;
  /** 摘要を元明細から写す */
  copyDescription: boolean;
}

/**
 * 名称で探した元明細から、型枠明細（ルール）をまとめて作る。
 * 元明細1件につき1本作る（摘要と掛け率はあとで明細ごとに直せる）。
 */
export function buildFormworkRulesFromSources(
  sources: readonly FormworkBulkSource[],
  spec: FormworkBulkSpec,
  keyPrefix: string,
): FormworkTransferRule[] {
  return sources.map((source, index) => ({
    key: `${keyPrefix}-${index + 1}`,
    sourceKeys: [source.masterKey],
    coefficient: spec.coefficient === 0 ? 1 : spec.coefficient,
    subjectId: spec.subjectId,
    materialCategory:
      spec.materialCategory === ""
        ? source.materialCategory
        : spec.materialCategory,
    name: spec.name,
    description: spec.copyDescription ? source.descriptionUpper : "",
    descriptionLower: spec.copyDescription ? source.descriptionLower : "",
    unit: spec.unit === "" ? source.unit : spec.unit,
    remarks: "",
  }));
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

interface Bucket {
  formwork: string;
  order: number;
  subjectId: number | null;
  materialCategory: string;
  name: string;
  description: string;
  descriptionLower: string;
  unit: string;
  remarks: string;
  quantity: number;
  sourceQuantity: number;
  at: number;
}

/** 型枠分類マスターの登録番号順。マスターに無い分類・分類なしは後ろへ */
function categoryOrder(
  categories: readonly FormworkCategory[],
  name: string,
): number {
  const found = categories.find((category) => category.name === name);
  if (found) return found.displayOrder * 1000 + found.id;
  return Number.MAX_SAFE_INTEGER;
}

/**
 * 転記入力表へ入れる行を作る。
 * 型枠分類ごとにタイトル行を1行置き、その下に摘要ごとの明細を並べる。
 * 明細番号はタイトル行も1つ使って連番にする。
 */
export function buildFormworkTransferRows(
  details: readonly FormworkSourceDetail[],
  rules: readonly FormworkTransferRule[],
  categories: readonly FormworkCategory[] = [],
): FormworkTransferRow[] {
  const buckets = new Map<string, Bucket>();
  rules.forEach((rule, ruleIndex) => {
    if (rule.sourceKeys.length === 0 || rule.name.trim() === "") return;
    const coefficient = rule.coefficient === 0 ? 1 : rule.coefficient;
    details
      .filter((detail) => rule.sourceKeys.includes(detail.masterKey))
      .forEach((detail) => {
        const formwork =
          detail.formwork.trim() === "" ? NO_FORMWORK : detail.formwork.trim();
        const key = [
          formwork,
          rule.subjectId ?? "",
          rule.materialCategory,
          rule.name,
          rule.description,
          rule.descriptionLower,
          rule.unit,
        ].join("|");
        const bucket = buckets.get(key) ?? {
          formwork,
          order: categoryOrder(categories, formwork),
          subjectId: rule.subjectId,
          materialCategory: rule.materialCategory,
          name: rule.name,
          description: rule.description,
          descriptionLower: rule.descriptionLower,
          unit: rule.unit,
          remarks: rule.remarks,
          quantity: 0,
          sourceQuantity: 0,
          at: ruleIndex,
        };
        bucket.quantity += detail.quantity * coefficient;
        bucket.sourceQuantity += detail.quantity;
        buckets.set(key, bucket);
      });
  });

  const kept = [...buckets.values()].filter(
    (bucket) => round2(bucket.quantity) !== 0,
  );
  kept.sort((a, b) =>
    a.order !== b.order
      ? a.order - b.order
      : a.formwork !== b.formwork
        ? a.formwork.localeCompare(b.formwork)
        : a.at - b.at,
  );

  const rows: FormworkTransferRow[] = [];
  let formwork = "";
  let number = 0;
  kept.forEach((bucket) => {
    if (bucket.formwork !== formwork) {
      formwork = bucket.formwork;
      number += 1;
      rows.push({
        formworkKey: FORMWORK_ROW_KEY,
        formwork,
        title: true,
        part1: formwork,
        part2: "",
        part2Split: false,
        part3: "",
        subjectId: bucket.subjectId,
        materialCategory: "",
        partNumber: null,
        partName: "",
        detailNumber: number,
        name: `<${formwork}>`,
        description: "",
        descriptionLower: "",
        quantity: 0,
        sourceQuantity: 0,
        unit: "",
        remarks: "",
      });
    }
    number += 1;
    rows.push({
      formworkKey: FORMWORK_ROW_KEY,
      formwork,
      title: false,
      part1: "",
      part2: "",
      part2Split: false,
      part3: "",
      subjectId: bucket.subjectId,
      materialCategory: bucket.materialCategory,
      partNumber: null,
      partName: "",
      detailNumber: number,
      name: bucket.name,
      description: bucket.description,
      descriptionLower: bucket.descriptionLower,
      quantity: round2(bucket.quantity),
      sourceQuantity: round2(bucket.sourceQuantity),
      unit: bucket.unit,
      remarks: bucket.remarks,
    });
  });
  return rows;
}
