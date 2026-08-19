import { evaluateFormula } from '../formula/evaluate'

/** 建具表1行の入力値（計算結果は保持せず、常にここから算出する） */
export interface FittingInput {
  /** 建具記号（積算入力の計算式では <AW-1> のように山カッコを付けて建具と判別する） */
  symbol: string
  /** 最大幅 */
  width: number | null
  /** 最大高さ */
  height: number | null
  /** 腰高（FLから建具下端まで）。値がある場合は巾木の差し引きをしない */
  sillHeight: number | null
  /** 面積計算（自動計算修正用）。入力すると W*H の代わりにこの結果を面積とする */
  areaFormula: string
  /** 巾木長さ（自動計算修正用）。入力すると W の代わりにこの結果を巾木減とする */
  baseboardFormula: string
}

export interface FittingComputed {
  area: number | null
  baseboardDeduction: number | null
  /** 軸組計算の開口部横補強（タテ補強は施工高さで変わるためここでは算出しない） */
  reinforcement: number | null
  areaFormulaError: boolean
  baseboardFormulaError: boolean
}

/** 積算で使う寸法は小数2桁で扱う */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function variables(row: FittingInput): Record<string, number> {
  return {
    W: row.width ?? 0,
    H: row.height ?? 0,
    腰高: row.sillHeight ?? 0
  }
}

/**
 * 建具表の派生値を求める。
 * - 面積：W*H（面積計算に式があればその結果）
 * - 巾木減：腰高が無いときの W（巾木長さに式があればその結果）
 * - 軸組横補強：腰高なし=W／腰高あり=W*2／腰高ありで巾木減がWと異なる=W*2-巾木減+腰高*2
 */
export function computeFitting(row: FittingInput): FittingComputed {
  const vars = variables(row)
  const hasSill = (row.sillHeight ?? 0) > 0

  const areaByFormula = row.areaFormula.trim() ? evaluateFormula(row.areaFormula, vars) : null
  const areaFormulaError = row.areaFormula.trim() !== '' && areaByFormula === null
  const area =
    areaByFormula !== null
      ? round2(areaByFormula)
      : row.width !== null && row.height !== null
        ? round2(row.width * row.height)
        : null

  const baseByFormula = row.baseboardFormula.trim()
    ? evaluateFormula(row.baseboardFormula, vars)
    : null
  const baseboardFormulaError = row.baseboardFormula.trim() !== '' && baseByFormula === null
  const baseboardDeduction =
    baseByFormula !== null ? round2(baseByFormula) : hasSill ? null : row.width

  const reinforcement =
    row.width === null
      ? null
      : !hasSill
        ? round2(row.width)
        : baseboardDeduction !== null && baseboardDeduction !== row.width
          ? round2(row.width * 2 - baseboardDeduction + (row.sillHeight ?? 0) * 2)
          : round2(row.width * 2)

  return { area, baseboardDeduction, reinforcement, areaFormulaError, baseboardFormulaError }
}

/** 同じ建具記号が複数ある行の位置（重複を赤文字で知らせる） */
export function duplicateSymbolIndexes(symbols: string[]): Set<number> {
  const seen = new Map<string, number[]>()
  symbols.forEach((symbol, index) => {
    const key = symbol.trim()
    if (key === '') return
    const list = seen.get(key) ?? []
    list.push(index)
    seen.set(key, list)
  })
  const duplicated = new Set<number>()
  seen.forEach((list) => {
    if (list.length > 1) list.forEach((index) => duplicated.add(index))
  })
  return duplicated
}

const collator = new Intl.Collator('ja')

/** 建具記号を「英字部分→数字部分→残り」の順で昇順に並べる（AW2 が AW10 より前） */
export function compareSymbols(a: string, b: string): number {
  const pattern = /^(\D*)(\d*)(.*)$/
  const [, aHead = '', aNumber = '', aTail = ''] = pattern.exec(a.trim()) ?? []
  const [, bHead = '', bNumber = '', bTail = ''] = pattern.exec(b.trim()) ?? []
  const head = collator.compare(aHead, bHead)
  if (head !== 0) return head
  if (aNumber !== bNumber) {
    if (aNumber === '') return -1
    if (bNumber === '') return 1
    return Number(aNumber) - Number(bNumber)
  }
  return collator.compare(aTail, bTail)
}

export interface SymbolSeries {
  /** 記号（例：SD） */
  prefix: string
  /** 連番の開始・終了（例：1〜5） */
  from: number
  to: number
  /** 枝番の英字（例：A〜C）。省略時は枝番なし */
  suffixFrom?: string
  suffixTo?: string
}

/** 記号＋連番＋枝番からまとめて建具記号を作る（SD1〜SD5／SD3A〜SD3C など） */
export function expandSymbols(series: SymbolSeries): string[] {
  const { prefix, from, to, suffixFrom, suffixTo } = series
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return []
  const numbers: string[] = []
  for (let n = Math.trunc(from); n <= Math.trunc(to); n++) numbers.push(`${prefix}${n}`)
  if (!suffixFrom) return numbers
  const start = suffixFrom.toUpperCase().charCodeAt(0)
  const end = (suffixTo || suffixFrom).toUpperCase().charCodeAt(0)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return numbers
  const suffixes: string[] = []
  for (let c = start; c <= end; c++) suffixes.push(String.fromCharCode(c))
  return numbers.flatMap((base) => suffixes.map((suffix) => `${base}${suffix}`))
}
