import { describe, expect, it } from 'vitest'
import {
  buildPastePreview,
  copyRangeAsTsv,
  isInRange,
  normalizeRange,
  type GridColumn
} from '../../src/renderer/src/features/grid/gridClipboard'

interface Row {
  code: string
  name: string
  qty: number | null
}

const columns: GridColumn<Row>[] = [
  { key: 'code', label: '記号', get: (r) => r.code, set: (r, v) => ({ row: { ...r, code: v } }) },
  { key: 'name', label: '名称', get: (r) => r.name, set: (r, v) => ({ row: { ...r, name: v } }) },
  {
    key: 'qty',
    label: '数量',
    get: (r) => (r.qty === null ? '' : String(r.qty)),
    set: (r, v) => {
      if (v === '') return { row: { ...r, qty: null } }
      const n = Number(v)
      if (Number.isNaN(n)) return { row: r, error: '数値ではありません' }
      return { row: { ...r, qty: n } }
    }
  }
]

const createRow = (): Row => ({ code: '', name: '', qty: null })

const rows: Row[] = [
  { code: 'A', name: '床', qty: 1 },
  { code: 'B', name: '壁', qty: 2 }
]

describe('グリッドのExcel互換コピー＆ペースト', () => {
  it('選択範囲をTSVでコピーする', () => {
    expect(copyRangeAsTsv(rows, columns, { startRow: 0, startCol: 0, endRow: 1, endCol: 1 })).toBe(
      'A\t床\r\nB\t壁'
    )
  })

  it('逆方向の範囲指定も正規化して扱う', () => {
    expect(normalizeRange({ startRow: 2, startCol: 3, endRow: 0, endCol: 1 })).toEqual({
      startRow: 0,
      startCol: 1,
      endRow: 2,
      endCol: 3
    })
    expect(isInRange({ startRow: 2, startCol: 2, endRow: 0, endCol: 0 }, 1, 1)).toBe(true)
    expect(isInRange(null, 0, 0)).toBe(false)
  })

  it('貼り付けプレビューを作成し、行不足分は追加行として扱う', () => {
    const preview = buildPastePreview(rows, columns, 'C\t天井\t3\nD\t梁\t4', 1, 0, createRow)
    expect(preview.addedRows).toBe(1)
    expect(preview.errorCount).toBe(0)
    expect(preview.rows.length).toBe(3)
    expect(preview.rows[1]).toEqual({ code: 'C', name: '天井', qty: 3 })
    expect(preview.rows[2]).toEqual({ code: 'D', name: '梁', qty: 4 })
    expect(rows.length).toBe(2)
  })

  it('不正値はエラーとして数え、確定前に判別できる', () => {
    const preview = buildPastePreview(rows, columns, 'X\tあ\tｱｲｳ', 0, 0, createRow)
    expect(preview.errorCount).toBe(1)
    expect(preview.cells[0][2].error).toBe('数値ではありません')
    expect(preview.rows[0].qty).toBe(1)
  })

  it('列数を超える貼り付けはエラーにする', () => {
    const preview = buildPastePreview(rows, columns, 'a\tb\tc\td', 0, 0, createRow)
    expect(preview.cells[0][3].error).toBe('列がありません')
  })

  it('全角数字・桁区切りは正規化して取り込む', () => {
    const preview = buildPastePreview(rows, columns, 'A\t床\t１，２３４', 0, 0, createRow)
    expect(preview.errorCount).toBe(0)
    expect(preview.rows[0].qty).toBe(1234)
  })
})
