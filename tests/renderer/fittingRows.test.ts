import { describe, expect, it } from 'vitest'
import {
  buildFittingColumns,
  emptyRow,
  insertRow,
  parseNumber,
  parseSize,
  removeRow,
  sortBySymbol,
  updateRow
} from '../../src/renderer/src/features/fittings/fittingRows'
import { buildPastePreview } from '../../src/renderer/src/features/grid/gridClipboard'

describe('建具表の行操作', () => {
  it('行挿入・削除・更新ができる', () => {
    const rows = [{ ...emptyRow(), symbol: 'AW1' }, { ...emptyRow(), symbol: 'AW2' }]
    expect(insertRow(rows, 1)).toHaveLength(3)
    expect(removeRow(rows, 0).map((row) => row.symbol)).toEqual(['AW2'])
    expect(updateRow(rows, 1, { width: 1.2 })[1].width).toBe(1.2)
  })

  it('記号昇順で並べ、積算入力からの登録行は後ろへまとめる', () => {
    const rows = [
      { ...emptyRow(), symbol: 'X1', fromEstimate: 1 },
      { ...emptyRow(), symbol: 'SD2' },
      { ...emptyRow(), symbol: 'AW10' },
      { ...emptyRow(), symbol: 'AW2' }
    ]
    expect(sortBySymbol(rows).map((row) => row.symbol)).toEqual(['AW2', 'AW10', 'SD2', 'X1'])
  })

  it('寸法は小数2桁に丸め、数値以外はエラーにする', () => {
    expect(parseNumber('１．２３４').value).toBe(1.23)
    expect(parseNumber('').value).toBeNull()
    expect(parseNumber('あ').error).toBeTruthy()
  })
})

describe('Excelからの貼り付け', () => {
  it('画面と同じ列順で取り込み、自動計算列は取り込まない', () => {
    const clipboard = ['AW1\t1.50\t1.76\t0.90\t2.64\t\t3.00\t\t\t南面', 'SD1\t0.90\t2.00'].join('\n')
    const preview = buildPastePreview([], buildFittingColumns(), clipboard, 0, 0, emptyRow)
    expect(preview.rows).toHaveLength(2)
    expect(preview.rows[0]).toMatchObject({
      symbol: 'AW1',
      width: 1.5,
      height: 1.76,
      sillHeight: 0.9,
      note: '南面'
    })
    expect(preview.rows[1]).toMatchObject({ symbol: 'SD1', width: 0.9, height: 2 })
    expect(preview.errorCount).toBe(0)
    // 面積 2.64 と軸組横補強 3.00 は取り込まず警告にする
    expect(preview.warningCount).toBe(2)
  })

  it('W・H・腰高は計算式で入れられ、値は計算結果になる', () => {
    expect(parseSize('900+150')).toEqual({ value: 1050, formula: '900+150' })
    expect(parseSize('1.8')).toEqual({ value: 1.8, formula: '' })
    expect(parseSize('')).toEqual({ value: null, formula: '' })
    expect(parseSize('あ').error).toBeTruthy()
  })

  it('計算式で入れたW・Hは行に式も残る', () => {
    const columns = buildFittingColumns()
    const preview = buildPastePreview([emptyRow()], columns, 'AW1\t0.9*2', 0, 0, emptyRow)
    expect(preview.rows[0]).toMatchObject({ width: 1.8, widthFormula: '0.9*2' })
  })
})
