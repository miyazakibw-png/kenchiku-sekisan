import { formatDetailNumber, isValidDetailNumberInput, parseDetailNumber } from '@shared/detailNumber'
import type { Detail, DetailDraft } from '@shared/types'

export interface DraftRow extends DetailDraft {
  /** 画面上で行を一意に識別するキー（新規行を含む） */
  key: string
  /** 明細番号の入力途中の文字列（例: "302."） */
  detailNumberInput: string
}

let sequence = 0

export function createEmptyRow(): DraftRow {
  sequence += 1
  return {
    key: `new-${sequence}`,
    id: null,
    detailNumber: null,
    detailNumberInput: '',
    materialCategory: '',
    partName: '',
    name: '',
    descriptionUpper: '',
    descriptionLower: '',
    unit: '',
    remarksUpper: '',
    remarksLower: '',
    estimateDisplay: '',
    isActive: true
  }
}

export function toDraftRows(details: Detail[]): DraftRow[] {
  return details.map((detail) => ({
    key: `row-${detail.id}`,
    id: detail.id,
    detailNumber: detail.detailNumber,
    detailNumberInput: formatDetailNumber(detail.detailNumber),
    materialCategory: detail.materialCategory,
    partName: detail.partName,
    name: detail.name,
    descriptionUpper: detail.descriptionUpper,
    descriptionLower: detail.descriptionLower,
    unit: detail.unit,
    remarksUpper: detail.remarksUpper,
    remarksLower: detail.remarksLower,
    estimateDisplay: detail.estimateDisplay,
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

/**
 * 明細番号の入力を反映する。
 * 形式違反（数値以外・小数3桁以上など）はその場で入力を拒否する。
 */
export function updateDetailNumberInput(
  rows: DraftRow[],
  index: number,
  input: string
): DraftRow[] {
  if (index < 0 || index >= rows.length) return rows
  if (!isValidDetailNumberInput(input)) return rows
  return rows.map((row, i) =>
    i === index ? { ...row, detailNumberInput: input, detailNumber: parseDetailNumber(input) } : row
  )
}

/** フォーカスアウト時に小数2桁表示へ整形する */
export function normalizeDetailNumberInput(rows: DraftRow[], index: number): DraftRow[] {
  if (index < 0 || index >= rows.length) return rows
  const formatted = formatDetailNumber(rows[index].detailNumber)
  if (formatted === rows[index].detailNumberInput) return rows
  return rows.map((row, i) => (i === index ? { ...row, detailNumberInput: formatted } : row))
}

/** 複製時は入力値のみ引き継ぎ、IDは新規扱いにする */
function omitKeys(row: DraftRow): Omit<DraftRow, 'key' | 'id'> {
  const { key: _key, id: _id, ...rest } = row
  return rest
}

/** 保存用に画面専用フィールドを除去する */
export function toDetailDraft(row: DraftRow): DetailDraft {
  const { key: _key, detailNumberInput: _input, ...draft } = row
  return draft
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length)
}

/**
 * 保存で採番されたIDを、キーが一致する行へ反映する。
 * 保存のたびに行を作り直すと（キーが変わり）Undo履歴が現在のデータと食い違うため、
 * 行オブジェクトはそのままにIDだけを埋める。
 */
export function assignSavedIds(rows: DraftRow[], idByKey: Map<string, number>): DraftRow[] {
  return rows.map((row) => {
    const id = idByKey.get(row.key)
    return row.id === null && id !== undefined ? { ...row, id } : row
  })
}

/** Undo/Redoで復元する画面状態 */
export interface HistorySnapshot {
  rows: DraftRow[]
  deletedIds: number[]
}

/**
 * 履歴スナップショットから画面状態を復元する。
 * - 復元後に存在しない保存済み行は削除対象へ加える（加えないと次の保存でDBから復活する）
 * - 復元で戻ってきた行は削除対象から外す（保存時に同じIDで再作成される）
 * - 連続して戻す場合に前回分の削除対象を失わないよう、現在の削除対象も引き継ぐ
 */
export function restoreSnapshot(
  current: HistorySnapshot,
  snapshot: HistorySnapshot
): HistorySnapshot {
  const keptIds = new Set(
    snapshot.rows.map((row) => row.id).filter((id): id is number => id !== null)
  )
  const removedIds = current.rows
    .map((row) => row.id)
    .filter((id): id is number => id !== null && !keptIds.has(id))
  return {
    rows: snapshot.rows,
    deletedIds: [
      ...new Set([...snapshot.deletedIds, ...current.deletedIds, ...removedIds])
    ].filter((id) => !keptIds.has(id))
  }
}
