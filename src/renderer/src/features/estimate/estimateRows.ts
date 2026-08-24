import type { CalcType, EstimateRow, EstimateRowDraft, MasterEntry } from '@shared/types'
import { resolveMasterName } from '@shared/masters'
import type { GridColumn } from '../grid/gridClipboard'

/** 計算タイプ（計算書書式）の既定値。書式マスターの先頭を使う */
export const DEFAULT_CALC_TYPE = 'room'

export function toDrafts(rows: EstimateRow[]): EstimateRowDraft[] {
  return rows.map(({ id, projectId: _projectId, displayOrder: _displayOrder, ...rest }) => ({
    id,
    ...rest
  }))
}

export function emptyRow(calcType: CalcType = DEFAULT_CALC_TYPE): EstimateRowDraft {
  return {
    id: null,
    rowType: 'room',
    part1: '',
    part2: '',
    part2Split: 0,
    formwork: '',
    part3: '',
    ceilingHeight: null,
    multiplier: 1,
    note: '',
    calcType
  }
}

export function subtotalRow(): EstimateRowDraft {
  return { ...emptyRow(), rowType: 'subtotal', part3: '小計', multiplier: 0 }
}

/** 天井高さ・倍率の表示（未入力は空欄） */
export function formatNumber(value: number | null, decimals = 2): string {
  return value === null ? '' : value.toFixed(decimals)
}

export function parseNumber(text: string): { value: number | null; error?: string } {
  const trimmed = text
    .trim()
    .replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (trimmed === '') return { value: null }
  const value = Number(trimmed)
  if (Number.isNaN(value)) return { value: null, error: '数値で入力してください' }
  return { value: Math.round(value * 100) / 100 }
}

/** 倍率は -99〜99 の範囲 */
export function parseMultiplier(text: string): { value: number | null; error?: string } {
  const parsed = parseNumber(text)
  if (parsed.error || parsed.value === null) return parsed
  if (parsed.value < -99 || parsed.value > 99) {
    return { value: null, error: '倍率は -99〜99 で入力してください' }
  }
  return parsed
}

/**
 * 部位Ⅰ・部位Ⅱは未入力なら入力のある上の行を引き継ぐ。
 * 小計行は部位の区切りには使わず、直前の値をそのまま持ち越す。
 */
export function resolveInherited(
  rows: EstimateRowDraft[]
): { part1: string; part2: string; part2Split: number }[] {
  let part1 = ''
  let part2 = ''
  let part2Split = 0
  return rows.map((row) => {
    if (row.part1.trim() !== '') part1 = row.part1
    if (row.part2.trim() !== '') {
      part2 = row.part2
      part2Split = row.part2Split
    }
    return { part1, part2, part2Split: row.part2.trim() !== '' ? row.part2Split : part2Split }
  })
}

export function insertRow(rows: EstimateRowDraft[], index: number): EstimateRowDraft[] {
  const at = Math.min(Math.max(index, 0), rows.length)
  return [...rows.slice(0, at), emptyRow(), ...rows.slice(at)]
}

export function removeRow(rows: EstimateRowDraft[], index: number): EstimateRowDraft[] {
  if (index < 0 || index >= rows.length) return rows
  return rows.filter((_row, i) => i !== index)
}

export function updateRow(
  rows: EstimateRowDraft[],
  index: number,
  patch: Partial<EstimateRowDraft>
): EstimateRowDraft[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
}

export function moveRow(rows: EstimateRowDraft[], from: number, to: number): EstimateRowDraft[] {
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) return rows
  const next = [...rows]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * 他の行（同物件・他物件）を貼り込む。
 * IDを外して新しい行として複製するので、コピー元とは切り離される。
 * 元の行IDは copySourceId に残し、保存時に計算書の中身も複製する。
 */
export function copyRowsInto(
  rows: EstimateRowDraft[],
  index: number,
  copied: EstimateRowDraft[]
): EstimateRowDraft[] {
  const at = Math.min(Math.max(index, 0), rows.length)
  const cloned = copied.map((row) => ({
    ...row,
    id: null,
    copySourceId: row.id ?? row.copySourceId ?? null
  }))
  return [...rows.slice(0, at), ...cloned, ...rows.slice(at)]
}

/** Excelからの貼り付け・コピーで扱う列（画面の列順と同じ） */
export function buildEstimateColumns(formworks: MasterEntry[]): GridColumn<EstimateRowDraft>[] {
  return [
    {
      key: 'part1',
      label: '部位Ⅰ',
      get: (row) => row.part1,
      set: (row, value) => ({ row: { ...row, part1: value.trim() } })
    },
    {
      key: 'part2',
      label: '部位Ⅱ',
      get: (row) => row.part2,
      set: (row, value) => ({ row: { ...row, part2: value.trim() } })
    },
    {
      key: 'part2Split',
      label: '部位Ⅱ別仕訳',
      get: (row) => (row.part2Split === 1 ? '✔' : ''),
      set: (row, value) => ({
        row: { ...row, part2Split: /^(✔|✓|1|レ|○|o|O|x|X)$/.test(value.trim()) ? 1 : 0 }
      })
    },
    {
      key: 'formwork',
      label: '型枠',
      get: (row) => row.formwork,
      set: (row, value) => ({ row: { ...row, formwork: resolveMasterName(formworks, value) } })
    },
    {
      key: 'part3',
      label: '部位Ⅲ（部屋名）',
      get: (row) => row.part3,
      // 部屋名は記号を含め自由入力（Excelのシート名制限は無い）
      set: (row, value) => ({ row: { ...row, part3: value } })
    },
    {
      key: 'ceilingHeight',
      label: '天井高さ',
      get: (row) => formatNumber(row.ceilingHeight),
      set: (row, value) => {
        const parsed = parseNumber(value)
        return parsed.error
          ? { row, error: parsed.error }
          : { row: { ...row, ceilingHeight: parsed.value } }
      }
    },
    {
      key: 'multiplier',
      label: '倍率',
      get: (row) => String(row.multiplier),
      set: (row, value) => {
        const parsed = parseMultiplier(value)
        if (parsed.error) return { row, error: parsed.error }
        return { row: { ...row, multiplier: parsed.value ?? 1 } }
      }
    },
    {
      key: 'note',
      label: '備考',
      get: (row) => row.note,
      set: (row, value) => ({ row: { ...row, note: value } })
    }
  ]
}
