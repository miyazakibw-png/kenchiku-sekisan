import type { AssemblyItem, FinishAssembly, MaterialCategory, Unit } from '@shared/types'
import { formatDetailNumber, isValidDetailNumberInput, parseDetailNumber } from '@shared/detailNumber'
import { sortDetails, type SortableDetail } from '../../../../core/sort/detailSortKey'

/** セット明細の編集行（数値欄は入力途中の文字列を保持する） */
export interface DraftItem extends AssemblyItem {
  key: string
  partNumberInput: string
  detailNumberInput: string
  coefficientInput: string
}

let sequence = 0

function nextKey(): string {
  sequence += 1
  return `item-${sequence}`
}

export function toDraftItems(items: AssemblyItem[]): DraftItem[] {
  return items.map((item) => ({
    ...item,
    key: nextKey(),
    partNumberInput: formatDetailNumber(item.partNumber),
    detailNumberInput: formatDetailNumber(item.detailNumber),
    coefficientInput: String(item.coefficient)
  }))
}

export function toAssemblyItems(items: DraftItem[]): AssemblyItem[] {
  return items.map(
    ({ key: _key, partNumberInput: _p, detailNumberInput: _d, coefficientInput: _c, ...item }) =>
      item
  )
}

/** 部位番号・明細番号の入力（小数2桁まで。形式違反はその場で拒否する） */
export function updateNumberInput(
  items: DraftItem[],
  index: number,
  field: 'partNumber' | 'detailNumber',
  input: string
): DraftItem[] {
  if (index < 0 || index >= items.length || !isValidDetailNumberInput(input)) return items
  const inputField = field === 'partNumber' ? 'partNumberInput' : 'detailNumberInput'
  return items.map((item, i) =>
    i === index ? { ...item, [field]: parseDetailNumber(input), [inputField]: input } : item
  )
}

/** 掛け率の入力（"1." のような途中入力を保持する） */
export function updateCoefficientInput(
  items: DraftItem[],
  index: number,
  input: string
): DraftItem[] {
  if (index < 0 || index >= items.length) return items
  const parsed = Number(input)
  const coefficient = input === '' || Number.isNaN(parsed) ? items[index].coefficient : parsed
  return items.map((item, i) =>
    i === index ? { ...item, coefficient, coefficientInput: input } : item
  )
}

/** セットの表示行（一覧に出るのは1行目の明細だけ） */
export function headItem(assembly: FinishAssembly): AssemblyItem | null {
  return assembly.items[0] ?? null
}

/** 科目で絞り込む。セットの所属科目は1行目の明細の科目とする */
export function filterBySubject(
  assemblies: FinishAssembly[],
  subjectId: number | null
): FinishAssembly[] {
  if (subjectId === null) return assemblies
  return assemblies.filter((a) => headItem(a)?.subjectId === subjectId)
}

function toSortable(
  item: AssemblyItem,
  subjectOrderById: Map<number, number>,
  units: Unit[],
  materialCategories: MaterialCategory[]
): SortableDetail {
  return {
    subjectOrder: subjectOrderById.get(item.subjectId) ?? null,
    part1: '',
    part2SortOrder: null,
    part2Name: '',
    partNumber: item.partNumber,
    detailNumber: item.detailNumber,
    partName: item.partName,
    name: item.name,
    unitOrder: units.find((u) => u.name === item.unit)?.id ?? null,
    descriptionLower: item.descriptionLower,
    descriptionUpper: item.descriptionUpper,
    remarksLower: item.remarksLower,
    remarksUpper: item.remarksUpper,
    materialCategoryOrder:
      materialCategories.find((c) => c.name === item.materialCategory)?.displayOrder ?? null
  }
}

/**
 * セット一覧の並び替え。
 * 自動登録されるマスターなので常に昇順（切替なし）で、共通ソートキーに従う。
 * 判定に使うのは一覧に出ている1行目の明細。
 */
export function sortAssemblies(
  assemblies: FinishAssembly[],
  subjectOrderById: Map<number, number>,
  units: Unit[],
  materialCategories: MaterialCategory[]
): FinishAssembly[] {
  const empty: SortableDetail = {
    subjectOrder: null,
    part1: '',
    part2SortOrder: null,
    part2Name: '',
    partNumber: null,
    detailNumber: null,
    partName: '',
    name: '',
    unitOrder: null,
    descriptionLower: '',
    descriptionUpper: '',
    remarksLower: '',
    remarksUpper: '',
    materialCategoryOrder: null
  }
  return sortDetails(assemblies, (assembly) => {
    const head = headItem(assembly)
    return head ? toSortable(head, subjectOrderById, units, materialCategories) : empty
  })
}

export function updateItem(
  items: DraftItem[],
  index: number,
  patch: Partial<DraftItem>
): DraftItem[] {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item))
}

export function addItem(items: DraftItem[], item: DraftItem): DraftItem[] {
  return [...items, item]
}

/** セット内の明細は最低1明細残るまで削除できる */
export function removeItem(items: DraftItem[], index: number): DraftItem[] {
  if (items.length <= 1 || index < 0 || index >= items.length) return items
  return items.filter((_, i) => i !== index)
}

export function moveItem(items: DraftItem[], from: number, to: number): DraftItem[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** 空の構成明細（科目だけ決めて手入力する場合に使う） */
export function createEmptyItem(subjectId: number): DraftItem {
  return {
    key: nextKey(),
    partNumberInput: '',
    detailNumberInput: '',
    coefficientInput: '1',
    id: null,
    sourceDetailId: null,
    subjectId,
    partNumber: null,
    detailNumber: null,
    materialCategory: '',
    partName: '',
    name: '',
    descriptionUpper: '',
    descriptionLower: '',
    unit: '',
    remarksUpper: '',
    remarksLower: '',
    estimateDisplay: '',
    formula: '',
    coefficient: 1
  }
}

