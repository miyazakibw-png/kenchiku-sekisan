import { describe, expect, it } from 'vitest'
import {
  buildFormworkTransferRows,
  collectFormworkQuantities,
  type FormworkSourceDetail,
  type FormworkTransferRule
} from '../../src/core/aggregate/formworkTransfer'

const details: FormworkSourceDetail[] = [
  { formwork: '打放型枠', part1: '建築', part2: '1階', part2Split: true, quantity: 10.5 },
  { formwork: '打放型枠', part1: '建築', part2: '1階', part2Split: true, quantity: 4.5 },
  { formwork: '打放型枠', part1: '建築', part2: '2階', part2Split: true, quantity: 3 },
  { formwork: '化粧型枠', part1: '建築', part2: '1階', part2Split: false, quantity: 2 },
  { formwork: '', part1: '建築', part2: '1階', part2Split: true, quantity: 100 }
]

const rules: FormworkTransferRule[] = [
  {
    formwork: '打放型枠',
    coefficient: 1,
    subjectId: 5,
    materialCategory: '型枠',
    partNumber: 60,
    partName: '型枠',
    detailNumber: 1,
    name: '打放型枠',
    description: '合板型枠',
    unit: 'm2',
    remarks: ''
  }
]

describe('collectFormworkQuantities', () => {
  it('型枠分類×部位Ⅰ×部位Ⅱで合算し、分類の無い明細は除く', () => {
    expect(collectFormworkQuantities(details)).toEqual([
      { formwork: '打放型枠', part1: '建築', part2: '1階', part2Split: true, quantity: 15 },
      { formwork: '打放型枠', part1: '建築', part2: '2階', part2Split: true, quantity: 3 },
      { formwork: '化粧型枠', part1: '建築', part2: '', part2Split: false, quantity: 2 }
    ])
  })
})

describe('buildFormworkTransferRows', () => {
  it('転記先を決めた分類だけ、集計数量×掛け率で行を作る', () => {
    const rows = buildFormworkTransferRows(details, rules)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      formworkKey: '打放型枠',
      part2: '1階',
      subjectId: 5,
      name: '打放型枠',
      unit: 'm2',
      sourceQuantity: 15,
      quantity: 15
    })
    expect(rows[1].part2).toBe('2階')
  })

  it('掛け率を掛けて小数2桁にする', () => {
    const rows = buildFormworkTransferRows(details, [{ ...rules[0], coefficient: 1.05 }])
    expect(rows[0].quantity).toBe(15.75)
    expect(rows[1].quantity).toBe(3.15)
  })

  it('名称が未入力の分類は転記しない', () => {
    expect(buildFormworkTransferRows(details, [{ ...rules[0], name: '' }])).toEqual([])
  })
})
