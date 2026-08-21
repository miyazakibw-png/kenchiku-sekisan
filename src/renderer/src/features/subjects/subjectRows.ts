import type { Subject, SubjectDraft } from '@shared/types'

export function toDrafts(subjects: Subject[]): SubjectDraft[] {
  return subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
    skipPart2: subject.skipPart2,
    aggregateOrder: subject.aggregateOrder,
    note: subject.note,
    spare1: subject.spare1,
    spare2: subject.spare2
  }))
}

export function emptyDraft(): SubjectDraft {
  return { id: null, name: '', skipPart2: 0, aggregateOrder: 1, note: '', spare1: '', spare2: '' }
}

/** 選択行の位置へ空の科目を挿入する（以降の科目IDは自動で繰り下がる） */
export function insertRow(rows: SubjectDraft[], index: number): SubjectDraft[] {
  const at = Math.min(Math.max(index, 0), rows.length)
  return [...rows.slice(0, at), emptyDraft(), ...rows.slice(at)]
}

export function removeRow(rows: SubjectDraft[], index: number): SubjectDraft[] {
  if (index < 0 || index >= rows.length) return rows
  return rows.filter((_row, i) => i !== index)
}

export function moveRow(rows: SubjectDraft[], from: number, to: number): SubjectDraft[] {
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) return rows
  const next = [...rows]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function updateRow(
  rows: SubjectDraft[],
  index: number,
  patch: Partial<SubjectDraft>
): SubjectDraft[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
}

/** 画面に表示する科目ID（行位置で自動採番） */
export function displayCode(index: number): string {
  return String(index + 1).padStart(2, '0')
}
