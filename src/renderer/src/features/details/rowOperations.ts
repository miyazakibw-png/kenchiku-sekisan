import type { Detail, DetailDraft } from '@shared/types'

export interface DraftRow extends DetailDraft {
  /** 画面上で行を一意に識別するキー（新規行を含む） */
  key: string
}

let sequence = 0

export function createEmptyRow(): DraftRow {
  sequence += 1
  return {
    key: `new-${sequence}`,
    id: null,
    detailNumber: '',
    materialCategoryId: null,
    name: '',
    description: '',
    unit: '',
    remarks: '',
    isActive: true
  }
}

export function toDraftRows(details: Detail[]): DraftRow[] {
  return details.map((detail) => ({
    key: `row-${detail.id}`,
    id: detail.id,
    detailNumber: detail.detailNumber ?? '',
    materialCategoryId: detail.materialCategoryId,
    name: detail.name,
    description: detail.description,
    unit: detail.unit,
    remarks: detail.remarks,
    isActive: detail.isActive
  }))
}

export function insertRow(rows: DraftRow[], index: number): DraftRow[] {
  const next = [...rows]
  next.splice(clampIndex(index, rows.length), 0, createEmptyRow())
  return next
}

export function removeRow(rows: DraftRow[], index: number): DraftRow[] {
  if (index < 0 || index >= rows.length) return rows
  return rows.filter((_, i) => i !== index)
}

export function copyRow(rows: DraftRow[], index: number): DraftRow[] {
  if (index < 0 || index >= rows.length) return rows
  const next = [...rows]
  next.splice(index + 1, 0, { ...omitKeys(rows[index]), key: createEmptyRow().key, id: null })
  return next
}

export function moveRow(rows: DraftRow[], from: number, to: number): DraftRow[] {
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) return rows
  const next = [...rows]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function updateRow<K extends keyof DetailDraft>(
  rows: DraftRow[],
  index: number,
  field: K,
  value: DetailDraft[K]
): DraftRow[] {
  if (index < 0 || index >= rows.length) return rows
  return rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
}

/** 複製時は入力値のみ引き継ぎ、IDは新規扱いにする */
function omitKeys(row: DraftRow): Omit<DraftRow, 'key' | 'id'> {
  const { key: _key, id: _id, ...rest } = row
  return rest
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length)
}
