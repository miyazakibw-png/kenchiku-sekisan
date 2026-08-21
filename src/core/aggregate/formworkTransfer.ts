/**
 * 型枠転記（打放型枠など）。
 * 集計した明細のうち型枠分類が付いているものを分類別に集計し、
 * 分類ごとに決めた転記先明細（科目・部位・名称・単位・掛け率）で
 * 転記入力表の最終行へ追記するための行を作る。
 * 生成した行は分類が分かる印を持たせるので、集計をかけ直すたびに作り直せる。
 */

export interface FormworkSourceDetail {
  /** 型枠分類（空欄は転記しない） */
  formwork: string
  part1: string
  part2: string
  part2Split: boolean
  quantity: number
}

/** 分類ごとの転記先。明細自体が転記情報を持つので集計をかけ直しても残る */
export interface FormworkTransferRule {
  formwork: string
  coefficient: number
  subjectId: number | null
  materialCategory: string
  partNumber: number | null
  partName: string
  detailNumber: number | null
  name: string
  description: string
  unit: string
  remarks: string
}

export interface FormworkTransferRow {
  /** 生成元が分かる印（型枠分類）。作り直すときの目印にする */
  formworkKey: string
  formwork: string
  part1: string
  part2: string
  part2Split: boolean
  subjectId: number | null
  materialCategory: string
  partNumber: number | null
  partName: string
  detailNumber: number | null
  name: string
  description: string
  /** 集計数量×掛け率（小数2桁） */
  quantity: number
  sourceQuantity: number
  unit: string
  remarks: string
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 型枠分類が付いた明細を 分類×部位Ⅰ×部位Ⅱ で合算する */
export function collectFormworkQuantities(
  details: readonly FormworkSourceDetail[]
): { formwork: string; part1: string; part2: string; part2Split: boolean; quantity: number }[] {
  const groups = new Map<
    string,
    { formwork: string; part1: string; part2: string; part2Split: boolean; quantity: number }
  >()
  details.forEach((detail) => {
    const formwork = detail.formwork.trim()
    if (formwork === '') return
    const part2 = detail.part2Split ? detail.part2 : ''
    const key = `${formwork}|${detail.part1}|${part2}`
    const group = groups.get(key) ?? {
      formwork,
      part1: detail.part1,
      part2,
      part2Split: detail.part2Split,
      quantity: 0
    }
    group.quantity += detail.quantity
    groups.set(key, group)
  })
  return [...groups.values()].map((group) => ({ ...group, quantity: round2(group.quantity) }))
}

/**
 * 転記入力表へ追記する行を作る。
 * 転記先を決めていない分類は作らない（画面で名称・単位を設定してから転記する）。
 */
export function buildFormworkTransferRows(
  details: readonly FormworkSourceDetail[],
  rules: readonly FormworkTransferRule[]
): FormworkTransferRow[] {
  const rows: FormworkTransferRow[] = []
  collectFormworkQuantities(details).forEach((group) => {
    const rule = rules.find((item) => item.formwork === group.formwork)
    if (!rule || rule.name.trim() === '') return
    rows.push({
      formworkKey: group.formwork,
      formwork: group.formwork,
      part1: group.part1,
      part2: group.part2,
      part2Split: group.part2Split,
      subjectId: rule.subjectId,
      materialCategory: rule.materialCategory,
      partNumber: rule.partNumber,
      partName: rule.partName,
      detailNumber: rule.detailNumber,
      name: rule.name,
      description: rule.description,
      quantity: round2(group.quantity * rule.coefficient),
      sourceQuantity: group.quantity,
      unit: rule.unit,
      remarks: rule.remarks
    })
  })
  return rows
}
