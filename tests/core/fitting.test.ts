import { describe, expect, it } from 'vitest'
import {
  compareSymbols,
  computeFitting,
  duplicateSymbolIndexes,
  expandSymbols,
  type FittingInput
} from '../../src/core/fittings/fitting'
import { evaluateFormula } from '../../src/core/formula/evaluate'

function row(patch: Partial<FittingInput>): FittingInput {
  return {
    symbol: 'AW1',
    width: null,
    height: null,
    sillHeight: null,
    areaFormula: '',
    baseboardFormula: '',
    ...patch
  }
}

describe('計算式', () => {
  it('四則演算・カッコ・全角記号を扱う', () => {
    expect(evaluateFormula('1.2*2.4')).toBeCloseTo(2.88)
    expect(evaluateFormula('（1+2）＊3')).toBe(9)
    expect(evaluateFormula('10-2*3')).toBe(4)
    expect(evaluateFormula('-2+5')).toBe(3)
  })

  it('変数を使える', () => {
    expect(evaluateFormula('W*H-0.5', { W: 2, H: 3 })).toBe(5.5)
  })

  it('不正な式は null', () => {
    expect(evaluateFormula('1+')).toBeNull()
    expect(evaluateFormula('(1+2')).toBeNull()
    expect(evaluateFormula('あ')).toBeNull()
  })
})

describe('建具表の自動計算', () => {
  it('面積は W*H、巾木減は腰高が無いとき W', () => {
    const calc = computeFitting(row({ width: 2.4, height: 2.2 }))
    expect(calc.area).toBe(5.28)
    expect(calc.baseboardDeduction).toBe(2.4)
  })

  it('腰高がある建具は巾木を差し引かない', () => {
    const calc = computeFitting(row({ width: 1.5, height: 1.76, sillHeight: 0.9 }))
    expect(calc.area).toBe(2.64)
    expect(calc.baseboardDeduction).toBeNull()
  })

  it('計算式を入れた場合は式の結果を面積・巾木減にする', () => {
    const calc = computeFitting(
      row({ width: 2, height: 2, areaFormula: 'W*H-0.5', baseboardFormula: 'W+0.3' })
    )
    expect(calc.area).toBe(3.5)
    expect(calc.baseboardDeduction).toBe(2.3)
    expect(calc.areaFormulaError).toBe(false)
  })

  it('計算式が不正なときは知らせる', () => {
    const calc = computeFitting(row({ width: 2, height: 2, areaFormula: 'W*' }))
    expect(calc.areaFormulaError).toBe(true)
    expect(calc.area).toBe(4)
  })

  it('軸組横補強：腰高なしは W', () => {
    expect(computeFitting(row({ width: 1.2, height: 2 })).reinforcement).toBe(1.2)
  })

  it('軸組横補強：腰高ありは W*2', () => {
    expect(computeFitting(row({ width: 1.5, height: 1.2, sillHeight: 0.9 })).reinforcement).toBe(3)
  })

  it('軸組横補強：腰高ありで巾木減がWと違うときは W*2-巾木減+腰高*2', () => {
    const calc = computeFitting(
      row({ width: 1.5, height: 1.2, sillHeight: 0.9, baseboardFormula: '0.6' })
    )
    expect(calc.reinforcement).toBe(1.5 * 2 - 0.6 + 0.9 * 2)
  })
})

describe('建具記号', () => {
  it('重複している行が分かる', () => {
    expect([...duplicateSymbolIndexes(['AW1', 'AW2', 'AW1', ''])]).toEqual([0, 2])
  })

  it('英字→数字の順で昇順に並ぶ', () => {
    const sorted = ['AW10', 'AW2', 'SD1', 'AD1'].sort(compareSymbols)
    expect(sorted).toEqual(['AD1', 'AW2', 'AW10', 'SD1'])
  })

  it('記号＋連番＋枝番からまとめて作れる', () => {
    expect(expandSymbols({ prefix: 'SD', from: 1, to: 5 })).toEqual([
      'SD1',
      'SD2',
      'SD3',
      'SD4',
      'SD5'
    ])
    expect(expandSymbols({ prefix: 'SD', from: 3, to: 3, suffixFrom: 'A', suffixTo: 'C' })).toEqual([
      'SD3A',
      'SD3B',
      'SD3C'
    ])
  })
})
