import { describe, expect, it } from 'vitest'
import type { AssemblyItem, FinishAssembly, MaterialCategory, Unit } from '../../src/shared/types'
import {
  addItem,
  createEmptyItem,
  filterBySubject,
  headItem,
  moveItem,
  removeItem,
  sortAssemblies,
  toAssemblyItems,
  toDraftItems,
  updateCoefficientInput,
  updateItem,
  updateNumberInput
} from '../../src/renderer/src/features/assemblies/assemblyEditor'

const UNITS: Unit[] = [
  { id: 1, name: 'm', displayOrder: 1 },
  { id: 2, name: 'm2', displayOrder: 2 }
]

const CATEGORIES: MaterialCategory[] = [
  { id: 1, code: '1', name: '仕上', displayOrder: 1 },
  { id: 3, code: '3', name: '下地1', displayOrder: 3 }
]

function item(name: string, overrides: Partial<AssemblyItem> = {}): AssemblyItem {
  return { ...createEmptyItem(1), name, ...overrides }
}

function assembly(id: number, items: AssemblyItem[]): FinishAssembly {
  return { id, scope: 'basic', projectId: null, note: '', displayOrder: 0, items }
}

describe('仕上明細セットの編集ロジック', () => {
  it('一覧に出るのは1行目の明細で、行を入れ替えると表示も変わる', () => {
    const set = assembly(1, [item('A'), item('B'), item('C')])
    expect(headItem(set)?.name).toBe('A')

    const swapped = assembly(1, moveItem(toDraftItems(set.items), 1, 0))
    expect(headItem(swapped)?.name).toBe('B')
    expect(swapped.items.map((i) => i.name)).toEqual(['B', 'A', 'C'])
  })

  it('科目で絞り込む（セットの科目は1行目の明細の科目）', () => {
    const list = [
      assembly(1, [item('A', { subjectId: 1 })]),
      assembly(2, [item('B', { subjectId: 2 })]),
      assembly(3, [item('C', { subjectId: 1 })])
    ]
    expect(filterBySubject(list, 1).map((a) => a.id)).toEqual([1, 3])
    expect(filterBySubject(list, null).length).toBe(3)
  })

  it('一覧は共通ソートキーの昇順（明細番号→名称）で並ぶ', () => {
    const list = [
      assembly(1, [item('い', { detailNumber: 20 })]),
      assembly(2, [item('あ', { detailNumber: 10 })]),
      assembly(3, [item('う', { detailNumber: 10 })])
    ]
    const sorted = sortAssemblies(list, new Map([[1, 1]]), UNITS, CATEGORIES)
    expect(sorted.map((a) => a.id)).toEqual([2, 3, 1])
  })

  it('構成明細の追加・移動・更新ができ、最低1明細は残す', () => {
    let items = toDraftItems([item('A')])
    items = addItem(items, createEmptyItem(1))
    items = updateItem(items, 1, { name: 'B' })
    expect(items.map((i) => i.name)).toEqual(['A', 'B'])

    items = moveItem(items, 1, 0)
    expect(items.map((i) => i.name)).toEqual(['B', 'A'])

    items = removeItem(items, 0)
    expect(items.map((i) => i.name)).toEqual(['A'])
    expect(removeItem(items, 0).map((i) => i.name)).toEqual(['A'])
  })

  it('掛け率は入力途中の文字列を保持し、数値化できる場合のみ反映する', () => {
    let items = toDraftItems([item('A')])
    items = updateCoefficientInput(items, 0, '1.')
    expect(items[0]).toMatchObject({ coefficientInput: '1.', coefficient: 1 })
    items = updateCoefficientInput(items, 0, '1.5')
    expect(items[0]).toMatchObject({ coefficientInput: '1.5', coefficient: 1.5 })
    items = updateCoefficientInput(items, 0, 'あ')
    expect(items[0]).toMatchObject({ coefficientInput: 'あ', coefficient: 1.5 })
  })

  it('部位番号・明細番号は小数2桁までを受け付け、不正入力は無視する', () => {
    let items = toDraftItems([item('A')])
    items = updateNumberInput(items, 0, 'partNumber', '12.5')
    expect(items[0].partNumber).toBe(12.5)
    const rejected = updateNumberInput(items, 0, 'detailNumber', 'K-1')
    expect(rejected).toBe(items)
  })

  it('保存用に変換すると画面用の入力欄が落ちる', () => {
    const [converted] = toAssemblyItems(toDraftItems([item('A', { coefficient: 1.2 })]))
    expect(converted).not.toHaveProperty('key')
    expect(converted).not.toHaveProperty('coefficientInput')
    expect(converted.coefficient).toBe(1.2)
  })
})
