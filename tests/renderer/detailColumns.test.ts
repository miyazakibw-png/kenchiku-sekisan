import { describe, expect, it } from 'vitest'
import type { MaterialCategory, Unit } from '../../src/shared/types'
import {
  buildDetailColumns,
  sortByDetailNumber
} from '../../src/renderer/src/features/details/detailColumns'
import { createEmptyRow } from '../../src/renderer/src/features/details/rowOperations'

const materialCategories: MaterialCategory[] = [
  { id: 1, code: '1', name: '仕上', displayOrder: 1 },
  { id: 2, code: '2', name: '軸組', displayOrder: 2 }
]
const units: Unit[] = [
  { id: 2, name: 'm2', displayOrder: 2 },
  { id: 9, name: '式', displayOrder: 9 }
]
const columns = buildDetailColumns(materialCategories, units)
const column = (key: string): (typeof columns)[number] => {
  const found = columns.find((c) => c.key === key)
  if (!found) throw new Error(`列が見つかりません: ${key}`)
  return found
}

describe('明細マスターの貼り付け列定義', () => {
  it('明細番号は小数2桁へ整形し、不正値はエラーにする', () => {
    const set = column('detailNumber').set
    if (!set) throw new Error('set が未定義です')
    const ok = set(createEmptyRow(), '302.5')
    expect(ok.error).toBeUndefined()
    expect(ok.row.detailNumber).toBe(302.5)
    expect(ok.row.detailNumberInput).toBe('302.50')

    expect(set(createEmptyRow(), 'K-001').error).toBeDefined()
    expect(set(createEmptyRow(), '12.345').error).toBeDefined()
    expect(set(createEmptyRow(), '').row.detailNumber).toBeNull()
  })

  it('材種区分は名称またはコードで解決し、未登録はエラーにする', () => {
    const set = column('materialCategory').set
    if (!set) throw new Error('set が未定義です')
    expect(set(createEmptyRow(), '軸組').row.materialCategoryId).toBe(2)
    expect(set(createEmptyRow(), '1').row.materialCategoryId).toBe(1)
    expect(set(createEmptyRow(), '存在しない').error).toBeDefined()
  })

  it('単位はマスタ未登録でも取り込むが警告を出す', () => {
    const set = column('unit').set
    if (!set) throw new Error('set が未定義です')
    expect(set(createEmptyRow(), 'm2').error).toBeUndefined()
    const warned = set(createEmptyRow(), '坪')
    expect(warned.error).toBeDefined()
    expect(warned.row.unit).toBe('坪')
  })

  it('明細番号の昇順に並べ替え、未設定は末尾にする', () => {
    const rows = [
      { ...createEmptyRow(), detailNumber: 10 },
      { ...createEmptyRow(), detailNumber: null },
      { ...createEmptyRow(), detailNumber: 2.5 },
      { ...createEmptyRow(), detailNumber: 1 }
    ]
    expect(sortByDetailNumber(rows).map((r) => r.detailNumber)).toEqual([1, 2.5, 10, null])
  })
})
