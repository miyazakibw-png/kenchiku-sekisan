import type { AssemblyItem, AssemblyItemRole, FinishAssembly } from '@shared/types'

export const ROLE_LABELS: { value: AssemblyItemRole; label: string }[] = [
  { value: 'finish', label: '仕上' },
  { value: 'base1', label: '下地1' },
  { value: 'base2', label: '下地2' },
  { value: 'reinforce', label: '補強' },
  { value: 'other', label: 'その他' }
]

export function roleLabel(role: AssemblyItemRole): string {
  return ROLE_LABELS.find((r) => r.value === role)?.label ?? role
}

export interface TreeFilter {
  usageCategory: string | null
  partId: number | null
}

export function filterAssemblies(
  assemblies: FinishAssembly[],
  filter: TreeFilter
): FinishAssembly[] {
  return assemblies.filter(
    (a) =>
      (filter.usageCategory === null || a.usageCategory === filter.usageCategory) &&
      (filter.partId === null || a.partId === filter.partId)
  )
}

export function createItem(detailId: number, role: AssemblyItemRole = 'finish'): AssemblyItem {
  return { id: null, detailId, role, formula: '', coefficient: 1 }
}

export function addItem(items: AssemblyItem[], item: AssemblyItem): AssemblyItem[] {
  return [...items, item]
}

export function removeItem(items: AssemblyItem[], index: number): AssemblyItem[] {
  return items.filter((_, i) => i !== index)
}

export function moveItem(items: AssemblyItem[], from: number, to: number): AssemblyItem[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function updateItem(
  items: AssemblyItem[],
  index: number,
  patch: Partial<AssemblyItem>
): AssemblyItem[] {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item))
}

/** 物件セットを基本セットの雛形として複製する際の初期値 */
export function duplicateAsNew(assembly: FinishAssembly): FinishAssembly {
  return {
    ...assembly,
    id: 0,
    assemblyName: `${assembly.assemblyName}（複製）`,
    items: assembly.items.map((item) => ({ ...item, id: null }))
  }
}
