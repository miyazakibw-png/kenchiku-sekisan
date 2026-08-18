import { describe, expect, it } from 'vitest'
import {
  displayCode,
  emptyDraft,
  insertRow,
  moveRow,
  removeRow,
  updateRow
} from '../../src/renderer/src/features/subjects/subjectRows'

const rows = [
  { ...emptyDraft(), id: 1, name: '仮設工事' },
  { ...emptyDraft(), id: 2, name: '土工事' },
  { ...emptyDraft(), id: 3, name: '地業工事' }
]

describe('工種科目マスターの行操作', () => {
  it('選択位置に空行を挿入する', () => {
    const next = insertRow(rows, 2)
    expect(next.map((row) => row.name)).toEqual(['仮設工事', '土工事', '', '地業工事'])
    expect(next[2].id).toBeNull()
  })

  it('行を削除・移動できる', () => {
    expect(removeRow(rows, 1).map((row) => row.name)).toEqual(['仮設工事', '地業工事'])
    expect(moveRow(rows, 2, 0).map((row) => row.name)).toEqual(['地業工事', '仮設工事', '土工事'])
    expect(moveRow(rows, 0, 9)).toBe(rows)
  })

  it('値を書き換える', () => {
    expect(updateRow(rows, 0, { skipPart2: 1 })[0].skipPart2).toBe(1)
    expect(updateRow(rows, 0, { skipPart2: 1 })[1].skipPart2).toBe(0)
  })

  it('科目IDは行位置で2桁表示になる', () => {
    expect(displayCode(0)).toBe('01')
    expect(displayCode(11)).toBe('12')
  })
})
