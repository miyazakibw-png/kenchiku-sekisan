import { describe, expect, it } from 'vitest'
import {
  buildFormworkRulesFromSources,
  buildFormworkTransferRows,
  collectFormworkQuantities,
  type FormworkSourceDetail,
  type FormworkTransferRule
} from '../../src/core/aggregate/formworkTransfer'

/** 元明細（コンクリート壁 = 'k1'）の部屋ごとの拾い数量 */
const details: FormworkSourceDetail[] = [
  { masterKey: 'k1', formwork: '打放型枠', part1: '建築', part2: '1階', part2Split: true, quantity: 10.5 },
  { masterKey: 'k1', formwork: '打放型枠', part1: '建築', part2: '1階', part2Split: true, quantity: 4.5 },
  { masterKey: 'k1', formwork: '打放型枠', part1: '建築', part2: '2階', part2Split: true, quantity: 3 },
  { masterKey: 'k1', formwork: '化粧型枠', part1: '建築', part2: '1階', part2Split: false, quantity: 2 },
  { masterKey: 'k2', formwork: '打放型枠', part1: '建築', part2: '1階', part2Split: true, quantity: 100 }
]

function rule(patch: Partial<FormworkTransferRule> = {}): FormworkTransferRule {
  return {
    key: '型枠1',
    sourceKeys: ['k1'],
    formwork: '打放型枠',
    coefficient: 1,
    subjectId: 5,
    materialCategory: '型枠',
    part1: '',
    part2: '',
    part3: '',
    partNumber: 60,
    partName: '型枠',
    detailNumber: 1,
    name: '打放型枠',
    description: '合板型枠',
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
      partNumber: 30,
      partName: 'ﾋﾟｯﾄ壁',
      detailNumber: 100,
      descriptionUpper: '仕上',
      unit: 'm2'
    },
    {
      masterKey: 'k2',
      materialCategory: '仕上',
      partNumber: 60,
      partName: '天井',
      detailNumber: 100,
      descriptionUpper: '貼物下',
      unit: 'm2'
    }
  ]

  const spec = {
    subjectId: 5,
    name: '打放型枠',
    unit: '',
    coefficient: 1,
    materialCategory: '型枠',
    formwork: '',
    copyPartName: true,
    copyDetailNumber: false,
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
      partNumber: 30,
      partName: 'ﾋﾟｯﾄ壁',
      detailNumber: null,
      name: '打放型枠',
      description: '仕上',
      unit: 'm2',
      part1: '',
      part2: ''
    })
    expect(rules[1].description).toBe('貼物下')
  })

  it('コピーしない指定・単位の変更・掛け率が効く', () => {
    const rules = buildFormworkRulesFromSources(
      sources,
      {
        ...spec,
        unit: 'm',
        coefficient: 2,
        copyPartName: false,
        copyDetailNumber: true,
        copyDescription: false
      },
      '型枠'
    )
    expect(rules[0]).toMatchObject({
      partName: '',
      partNumber: null,
      detailNumber: 100,
      description: '',
      unit: 'm',
      coefficient: 2
    })
  })
})

describe('collectFormworkQuantities', () => {
  it('元明細×型枠分類×部位Ⅰ×部位Ⅱで合算する', () => {
    expect(collectFormworkQuantities(details)).toEqual([
      { masterKey: 'k1', formwork: '打放型枠', part1: '建築', part2: '1階', part2Split: true, quantity: 15 },
      { masterKey: 'k1', formwork: '打放型枠', part1: '建築', part2: '2階', part2Split: true, quantity: 3 },
      { masterKey: 'k1', formwork: '化粧型枠', part1: '建築', part2: '', part2Split: false, quantity: 2 },
      { masterKey: 'k2', formwork: '打放型枠', part1: '建築', part2: '1階', part2Split: true, quantity: 100 }
    ])
  })
})

describe('buildFormworkTransferRows', () => {
  it('選んだ元明細だけを、型枠分類×部位で合算して行を作る', () => {
    const rows = buildFormworkTransferRows(details, [rule()])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      formworkKey: '型枠1',
      part2: '1階',
      subjectId: 5,
      name: '打放型枠',
      unit: 'm2',
      sourceQuantity: 15,
      quantity: 15
    })
    expect(rows[1].part2).toBe('2階')
  })

  it('型枠分類を空欄にすると、元明細の数量を分類を問わず全部使う', () => {
    const rows = buildFormworkTransferRows(details, [rule({ formwork: '' })])
    expect(rows.map((row) => row.sourceQuantity)).toEqual([15, 3, 2])
  })

  it('転記先の部位を入れると、その部位で転記する', () => {
    const rows = buildFormworkTransferRows(details, [
      rule({ part1: '建築A', part2: '共通', part3: '機械室' })
    ])
    expect(rows[0]).toMatchObject({ part1: '建築A', part2: '共通', part3: '機械室' })
  })

  it('掛け率を掛けて小数2桁にする', () => {
    const rows = buildFormworkTransferRows(details, [rule({ coefficient: 1.05 })])
    expect(rows[0].quantity).toBe(15.75)
    expect(rows[1].quantity).toBe(3.15)
  })

  it('元明細を選んでいない・名称が未入力のものは転記しない', () => {
    expect(buildFormworkTransferRows(details, [rule({ name: '' })])).toEqual([])
    expect(buildFormworkTransferRows(details, [rule({ sourceKeys: [] })])).toEqual([])
  })
})
