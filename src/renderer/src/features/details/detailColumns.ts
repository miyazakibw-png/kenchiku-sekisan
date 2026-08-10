import type { MaterialCategory, Unit } from '@shared/types'
import {
  formatDetailNumber,
  isValidDetailNumberInput,
  parseDetailNumber
} from '@shared/detailNumber'
import { resolveUnitName } from '@shared/units'
import { sortDetails, type SortableDetail } from '../../../../core/sort/detailSortKey'
import type { GridColumn } from '../grid/gridClipboard'
import type { DraftRow } from './rowOperations'

/**
 * Excelとの範囲コピー／貼り付けで用いる論理列。
 * 1明細（上下2段）を1行として扱う。
 */
export function buildDetailColumns(
  materialCategories: MaterialCategory[],
  units: Unit[]
): GridColumn<DraftRow>[] {
  return [
    {
      key: 'detailNumber',
      label: '明細番号',
      get: (row) => row.detailNumberInput,
      set: (row, value) => {
        if (value === '') return { row: { ...row, detailNumberInput: '', detailNumber: null } }
        if (!isValidDetailNumberInput(value)) {
          return { row, error: '明細番号は小数点以下2桁までの数値です' }
        }
        const parsed = parseDetailNumber(value)
        return {
          row: { ...row, detailNumber: parsed, detailNumberInput: formatDetailNumber(parsed) }
        }
      }
    },
    { key: 'partName', label: '部位名（上段）', get: (row) => row.partName, set: (row, value) => ({ row: { ...row, partName: value } }) },
    { key: 'name', label: '名称（下段）', get: (row) => row.name, set: (row, value) => ({ row: { ...row, name: value } }) },
    {
      key: 'descriptionUpper',
      label: '摘要（上段）',
      get: (row) => row.descriptionUpper,
      set: (row, value) => ({ row: { ...row, descriptionUpper: value } })
    },
    {
      key: 'descriptionLower',
      label: '摘要（下段）',
      get: (row) => row.descriptionLower,
      set: (row, value) => ({ row: { ...row, descriptionLower: value } })
    },
    {
      key: 'unit',
      label: '単位',
      get: (row) => row.unit,
      set: (row, value) => {
        const resolved = resolveUnitName(units, value)
        if (resolved !== value) return { row: { ...row, unit: resolved } }
        if (value !== '' && !units.some((u) => u.name === value)) {
          return { row: { ...row, unit: value }, warning: '単位マスタに存在しません（取り込みます）' }
        }
        return { row: { ...row, unit: value } }
      }
    },
    {
      key: 'remarksUpper',
      label: '備考（上段）',
      get: (row) => row.remarksUpper,
      set: (row, value) => ({ row: { ...row, remarksUpper: value } })
    },
    {
      key: 'remarksLower',
      label: '備考（下段）',
      get: (row) => row.remarksLower,
      set: (row, value) => ({ row: { ...row, remarksLower: value } })
    },
    {
      key: 'materialCategory',
      label: '材種区分',
      get: (row) =>
        materialCategories.find((c) => c.id === row.materialCategoryId)?.name ?? '',
      set: (row, value) => {
        if (value === '') return { row: { ...row, materialCategoryId: null } }
        const found = materialCategories.find((c) => c.name === value || c.code === value)
        if (!found) return { row, error: '材種区分マスタに存在しません' }
        return { row: { ...row, materialCategoryId: found.id } }
      }
    },
    {
      key: 'estimateDisplay',
      label: '積算用表示',
      get: (row) => row.estimateDisplay,
      set: (row, value) => ({ row: { ...row, estimateDisplay: value } })
    }
  ]
}

/** 明細番号の昇順（未設定は末尾）。同値は元の並びを維持する */
/** 共通ソートキー用に画面の行を変換する（明細マスターは単一科目・部位Ⅰ/Ⅱ未使用） */
function toSortable(
  row: DraftRow,
  units: Unit[],
  materialCategories: MaterialCategory[]
): SortableDetail {
  return {
    subjectOrder: null,
    part1: '',
    part2SortOrder: null,
    part2Name: '',
    partNumber: null,
    detailNumber: row.detailNumber,
    partName: row.partName,
    name: row.name,
    unitOrder: units.find((u) => u.name === row.unit)?.id ?? null,
    descriptionLower: row.descriptionLower,
    descriptionUpper: row.descriptionUpper,
    remarksLower: row.remarksLower,
    remarksUpper: row.remarksUpper,
    materialCategoryOrder:
      materialCategories.find((c) => c.id === row.materialCategoryId)?.displayOrder ?? null
  }
}

/**
 * 明細行を昇順に並べ替える。
 * 並び順ルールは共通モジュール（core/sort/detailSortKey）に集約している。
 */
export function sortDetailRows(
  rows: DraftRow[],
  units: Unit[] = [],
  materialCategories: MaterialCategory[] = []
): DraftRow[] {
  return sortDetails(rows, (row) => toSortable(row, units, materialCategories))
}
