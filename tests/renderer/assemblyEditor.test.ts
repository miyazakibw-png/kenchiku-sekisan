import { describe, expect, it } from 'vitest'
import type { FinishAssembly } from '../../src/shared/types'
import {
  addItem,
  createItem,
  duplicateAsNew,
  filterAssemblies,
  moveItem,
  removeItem,
  roleLabel,
  updateItem
} from '../../src/renderer/src/features/assemblies/assemblyEditor'

function assembly(overrides: Partial<FinishAssembly> = {}): FinishAssembly {
  return {
    id: 1,
    assemblyCode: 'W-1',
    assemblyName: '内部壁',
    partId: 3,
    usageCategory: '内部',
    scope: 'basic',
    projectId: null,
    note: '',
    displayOrder: 0,
    items: [],
    ...overrides
  }
}

describe('仕上明細セットの編集ロジック', () => {
  it('部位・用途で絞り込む', () => {
    const list = [
      assembly(),
      assembly({ id: 2, usageCategory: '外部', partId: 3 }),
      assembly({ id: 3, usageCategory: '内部', partId: 6 })
    ]
    expect(filterAssemblies(list, { usageCategory: '内部', partId: null }).map((a) => a.id)).toEqual(
      [1, 3]
    )
    expect(filterAssemblies(list, { usageCategory: '内部', partId: 6 }).map((a) => a.id)).toEqual([
      3
    ])
    expect(filterAssemblies(list, { usageCategory: null, partId: null }).length).toBe(3)
  })

  it('構成明細の追加・削除・移動・更新ができる', () => {
    let items = addItem([], createItem(10, 'finish'))
    items = addItem(items, createItem(11, 'base1'))
    expect(items.map((i) => i.detailId)).toEqual([10, 11])

    items = moveItem(items, 1, 0)
    expect(items.map((i) => i.detailId)).toEqual([11, 10])

    items = updateItem(items, 0, { coefficient: 1.2, formula: 'P*1.2' })
    expect(items[0].coefficient).toBe(1.2)
    expect(items[1].formula).toBe('')

    expect(removeItem(items, 0).map((i) => i.detailId)).toEqual([10])
  })

  it('範囲外の移動は無視する', () => {
    const items = [createItem(1)]
    expect(moveItem(items, 0, -1)).toBe(items)
    expect(moveItem(items, 0, 5)).toBe(items)
  })

  it('複製は新規セット（id=0）となり構成明細のIDを引き継がない', () => {
    const source = assembly({ items: [{ ...createItem(10), id: 99 }] })
    const copy = duplicateAsNew(source)
    expect(copy.id).toBe(0)
    expect(copy.assemblyName).toBe('内部壁（複製）')
    expect(copy.items[0].id).toBeNull()
  })

  it('役割を日本語表示する', () => {
    expect(roleLabel('base1')).toBe('下地1')
    expect(roleLabel('reinforce')).toBe('補強')
  })
})
