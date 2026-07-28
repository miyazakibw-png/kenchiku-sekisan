import { describe, expect, it } from 'vitest'
import {
  copyRow,
  createEmptyRow,
  insertRow,
  moveRow,
  removeRow,
  toDraftRows,
  updateRow
} from '../../src/renderer/src/features/details/rowOperations'
import type { Detail } from '../../src/shared/types'

function detail(id: number, name: string): Detail {
  return {
    id,
    subjectId: 1,
    detailNumber: `D${id}`,
    materialCategoryId: null,
    name,
    description: '',
    unit: '㎡',
    remarks: '',
    displayOrder: id,
    isActive: true
  }
}

const rows = toDraftRows([detail(1, 'あ'), detail(2, 'い'), detail(3, 'う')])

describe('明細マスターの行操作', () => {
  it('行挿入は指定位置に空行を差し込む', () => {
    const next = insertRow(rows, 1)
    expect(next).toHaveLength(4)
    expect(next[1].id).toBeNull()
    expect(next[2].name).toBe('い')
  })

  it('行削除は対象行のみ取り除く', () => {
    expect(removeRow(rows, 1).map((r) => r.name)).toEqual(['あ', 'う'])
    expect(removeRow(rows, 9)).toBe(rows)
  })

  it('行コピーは直下に新規行として複製する', () => {
    const next = copyRow(rows, 0)
    expect(next[1].name).toBe('あ')
    expect(next[1].id).toBeNull()
    expect(next[1].key).not.toBe(next[0].key)
  })

  it('行移動は上下いずれも順序を入れ替える', () => {
    expect(moveRow(rows, 2, 0).map((r) => r.name)).toEqual(['う', 'あ', 'い'])
    expect(moveRow(rows, 0, 1).map((r) => r.name)).toEqual(['い', 'あ', 'う'])
    expect(moveRow(rows, 0, -1)).toBe(rows)
    expect(moveRow(rows, 0, 3)).toBe(rows)
  })

  it('セル更新は該当行のみ変更する', () => {
    const next = updateRow(rows, 1, 'name', '変更')
    expect(next[1].name).toBe('変更')
    expect(next[0]).toBe(rows[0])
  })

  it('空行のキーは一意である', () => {
    expect(createEmptyRow().key).not.toBe(createEmptyRow().key)
  })
})
