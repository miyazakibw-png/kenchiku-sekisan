import { describe, expect, it } from 'vitest'
import {
  buildFormworkRulesFromSources,
  buildFormworkTransferRows,
  collectFormworkQuantities,
  type FormworkCategory,
  type FormworkSourceDetail,
  type FormworkTransferRule
} from '../../src/core/aggregate/formworkTransfer'

/** 元明細（打放補修 = 'k1' / 'k2'）の部屋ごとの拾い数量 */
const details: FormworkSourceDetail[] = [
  { masterKey: 'k1', formwork: '地上階', part1: '建築', part2: '1階', part2Split: true, quantity: 10.5 },
  { masterKey: 'k1', formwork: '地上階', part1: '建築', part2: '1階', part2Split: true, quantity: 4.5 },
  { masterKey: 'k1', formwork: '基礎階', part1: '建築', part2: '2階', part2Split: true, quantity: 3 },
  { masterKey: 'k1', formwork: '', part1: '建築', part2: '1階', part2Split: false, quantity: 2 },
  { masterKey: 'k2', formwork: '地上階', part1: '建築', part2: '1階', part2Split: true, quantity: 100 }
]

/** 型枠分類マスター（登録番号順に並べる） */
const categories: FormworkCategory[] = [
  { id: 1, name: '基礎階', displayOrder: 1 },
  { id: 2, name: '地上階', displayOrder: 2 }
]

function rule(patch: Partial<FormworkTransferRule> = {}): FormworkTransferRule {
  return {
    key: '型枠1',
    sourceKeys: ['k1'],
    coefficient: 1,
    subjectId: 5,
    materialCategory: '型枠',
    name: '打放型枠',
    description: '仕上',
    descriptionLower: '',
    unit: 'm2',
    remarks: '',
    ...patch
  }
}

describe('buildFormworkRulesFromSources', () => {
  const sources = [
    {
      masterKey: 'k1',
      materialCategory: '仕上',
      descriptionUpper: '仕上',
      descriptionLower: '打放補修共',
      unit: 'm2'
    },
    {
      masterKey: 'k2',
      materialCategory: '仕上',
      descriptionUpper: '貼物下',
      descriptionLower: '',
      unit: 'm2'
    }
  ]

  const spec = {
    subjectId: 5,
    name: '打放型枠',
    unit: '',
    coefficient: 1,
    materialCategory: '型枠',
    copyDescription: true
  }

  it('探した元明細1件につき1本、名称だけ型枠に変えて作る', () => {
    const rules = buildFormworkRulesFromSources(sources, spec, '型枠')
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({
      key: '型枠-1',
      sourceKeys: ['k1'],
      subjectId: 5,
      materialCategory: '型枠',
      name: '打放型枠',
      description: '仕上',
      descriptionLower: '打放補修共',
      unit: 'm2'
    })
    expect(rules[1].description).toBe('貼物下')
  })

  it('摘要を写さない指定・単位の変更・掛け率が効く', () => {
    const rules = buildFormworkRulesFromSources(
      sources,
      { ...spec, unit: 'm', coefficient: 2, copyDescription: false },
      '型枠'
    )
    expect(rules[0]).toMatchObject({
      description: '',
      descriptionLower: '',
      unit: 'm',
      coefficient: 2
    })
  })
})

describe('collectFormworkQuantities', () => {
  it('元明細×型枠分類×部位Ⅰ×部位Ⅱで合算する', () => {
    expect(collectFormworkQuantities(details)).toEqual([
      { masterKey: 'k1', formwork: '地上階', part1: '建築', part2: '1階', part2Split: true, quantity: 15 },
      { masterKey: 'k1', formwork: '基礎階', part1: '建築', part2: '2階', part2Split: true, quantity: 3 },
      { masterKey: 'k1', formwork: '', part1: '建築', part2: '', part2Split: false, quantity: 2 },
      { masterKey: 'k2', formwork: '地上階', part1: '建築', part2: '1階', part2Split: true, quantity: 100 }
    ])
  })
})

describe('buildFormworkTransferRows', () => {
  it('型枠分類ごとにタイトル行を置き、明細番号を連番にする', () => {
    const rows = buildFormworkTransferRows(details, [rule()], categories)
    expect(
      rows.map((row) => [row.detailNumber, row.name, row.quantity, row.title])
    ).toEqual([
      [1, '<基礎階>', 0, true],
      [2, '打放型枠', 3, false],
      [3, '<地上階>', 0, true],
      [4, '打放型枠', 15, false],
      [5, '<分類なし>', 0, true],
      [6, '打放型枠', 2, false]
    ])
    expect(rows[1]).toMatchObject({
      formwork: '基礎階',
      part1: '',
      subjectId: 5,
      materialCategory: '型枠',
      description: '仕上',
      unit: 'm2'
    })
    expect(rows[0].part1).toBe('基礎階')
  })

  it('同じ分類・同じ摘要は元明細が違っても合算する', () => {
    const rows = buildFormworkTransferRows(
      details,
      [rule(), rule({ key: '型枠2', sourceKeys: ['k2'] })],
      categories
    )
    const 地上 = rows.filter((row) => row.formwork === '地上階' && !row.title)
    expect(地上).toHaveLength(1)
    expect(地上[0].quantity).toBe(115)
  })

  it('摘要が違えば分類の下で別の行にする', () => {
    const rows = buildFormworkTransferRows(
      details,
      [rule(), rule({ key: '型枠2', sourceKeys: ['k2'], description: '貼物下' })],
      categories
    )
    const 地上 = rows.filter((row) => row.formwork === '地上階' && !row.title)
    expect(地上.map((row) => [row.description, row.quantity])).toEqual([
      ['仕上', 15],
      ['貼物下', 100]
    ])
  })

  it('掛け率は元明細ごとに掛ける', () => {
    const rows = buildFormworkTransferRows(
      details,
      [rule({ coefficient: 1.05 })],
      categories
    )
    expect(rows[1].quantity).toBe(3.15)
    expect(rows[1].sourceQuantity).toBe(3)
    expect(rows[3].quantity).toBe(15.75)
  })

  it('型枠分類マスターの登録番号順に並べる', () => {
    const rows = buildFormworkTransferRows(details, [rule()], [
      { id: 1, name: '地上階', displayOrder: 1 },
      { id: 2, name: '基礎階', displayOrder: 2 }
    ])
    expect(rows.filter((row) => row.title).map((row) => row.formwork)).toEqual([
      '地上階',
      '基礎階',
      '分類なし'
    ])
  })

  it('元明細を選んでいない・名称が未入力のものは転記しない', () => {
    expect(buildFormworkTransferRows(details, [rule({ name: '' })], categories)).toEqual([])
    expect(buildFormworkTransferRows(details, [rule({ sourceKeys: [] })], categories)).toEqual([])
  })
})
