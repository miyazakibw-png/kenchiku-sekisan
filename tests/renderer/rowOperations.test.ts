import { describe, expect, it } from 'vitest'
import {
  assignSavedIds,
  copyRow,
  restoreSnapshot,
  type HistorySnapshot,
  createEmptyRow,
  insertRow,
  moveRow,
  removeRow,
  normalizeDetailNumberInput,
  toDraftRows,
  updateDetailNumberInput,
  updateRow
} from '../../src/renderer/src/features/details/rowOperations'
import type { Detail } from '../../src/shared/types'

function detail(id: number, name: string): Detail {
  return {
    id,
    subjectId: 1,
    detailNumber: id + 0.5,
    materialCategoryId: null,
    partName: '',
    name,
    descriptionUpper: '',
    descriptionLower: '',
    unit: '㎡',
    remarksUpper: '',
    remarksLower: '',
    estimateDisplay: '',
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

  it('明細番号は小数2桁表示で復元される', () => {
    expect(rows[0].detailNumberInput).toBe('1.50')
  })

  it('明細番号は数値のみ受け付け、不正入力を拒否する', () => {
    expect(updateDetailNumberInput(rows, 0, '302.5')[0]).toMatchObject({
      detailNumberInput: '302.5',
      detailNumber: 302.5
    })
    expect(updateDetailNumberInput(rows, 0, '302.')[0].detailNumberInput).toBe('302.')
    expect(updateDetailNumberInput(rows, 0, 'K-001')).toBe(rows)
    expect(updateDetailNumberInput(rows, 0, '302.555')).toBe(rows)
    expect(updateDetailNumberInput(rows, 0, '')[0].detailNumber).toBeNull()
  })

  it('フォーカスアウトで明細番号を小数2桁へ整形する', () => {
    const edited = updateDetailNumberInput(rows, 0, '302.5')
    expect(normalizeDetailNumberInput(edited, 0)[0].detailNumberInput).toBe('302.50')
  })
})

describe('保存後のID反映', () => {
  it('キーが一致する未保存行にだけIDを埋め、行オブジェクトの同一性を保つ', () => {
    const rows = toDraftRows([])
    const first = createEmptyRow()
    const second = { ...createEmptyRow(), id: 5 }
    const target = [first, second]
    const next = assignSavedIds(target, new Map([[first.key, 11], [second.key, 99]]))
    expect(next[0].id).toBe(11)
    expect(next[1].id).toBe(5)
    expect(next[1]).toBe(second)
    expect(rows).toEqual([])
  })
})

describe('履歴からの復元（保存を挟むケース）', () => {
  it('挿入3回→保存→戻す3回で、保存済みの追加行がすべて削除対象になる', () => {
    const base = [{ ...createEmptyRow(), id: 1 }, { ...createEmptyRow(), id: 2 }]
    const added = [createEmptyRow(), createEmptyRow(), createEmptyRow()]

    // 挿入のたびに直前の状態を履歴へ積む
    const history: HistorySnapshot[] = [
      { rows: base, deletedIds: [] },
      { rows: [...base, added[0]], deletedIds: [] },
      { rows: [...base, added[0], added[1]], deletedIds: [] }
    ]
    let current: HistorySnapshot = {
      rows: [...base, added[0], added[1], added[2]],
      deletedIds: []
    }

    // 保存: 追加行にIDが振られ、履歴側にも同じIDを反映する
    const idByKey = new Map(added.map((row, index) => [row.key, 11 + index]))
    current = { rows: assignSavedIds(current.rows, idByKey), deletedIds: [] }
    const saved = history.map((snapshot) => ({
      rows: assignSavedIds(snapshot.rows, idByKey),
      deletedIds: snapshot.deletedIds
    }))

    // 戻す3回
    for (let i = saved.length - 1; i >= 0; i -= 1) {
      current = restoreSnapshot(current, saved[i])
    }

    expect(current.rows.map((row) => row.id)).toEqual([1, 2])
    expect([...current.deletedIds].sort()).toEqual([11, 12, 13])
  })

  it('進むで戻ってきた行は削除対象から外れる', () => {
    const kept = { ...createEmptyRow(), id: 1 }
    const restored = { ...createEmptyRow(), id: 7 }
    const current: HistorySnapshot = { rows: [kept], deletedIds: [7] }
    const next = restoreSnapshot(current, { rows: [kept, restored], deletedIds: [] })
    expect(next.deletedIds).toEqual([])
  })
})
