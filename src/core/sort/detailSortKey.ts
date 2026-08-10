/**
 * 明細の並び替え（共通ソートキー生成）。
 *
 * Electron・React・DBに依存しない純粋モジュールとして実装し、
 * 明細マスター／物件専用マスター／明細セットマスター／集計処理から共通で呼び出す。
 * 並び順ルールの変更はこのファイル1か所で完結する。
 */

/** 並び替えに使う1明細分の値 */
export interface SortableDetail {
  /** 工種科目の並び順（最上位） */
  subjectOrder: number | null
  /** 部位Ⅰ（常に区分する） */
  part1: string
  /** 部位Ⅱの入力順。仕分け指示がある場合のみ設定する */
  part2SortOrder: number | null
  /** 部位Ⅱ名。仕分け指示がある場合のみ設定する */
  part2Name: string
  /** 部位番号 */
  partNumber: number | null
  /** 明細番号 */
  detailNumber: number | null
  /** 部位文字（部位名称） */
  partName: string
  /** 名称文字（下段） */
  name: string
  /** 単位マスターの番号（文字順ではなく番号順で並べる） */
  unitOrder: number | null
  /** 摘要（下段） */
  descriptionLower: string
  /** 摘要（上段） */
  descriptionUpper: string
  /** 備考（下段） */
  remarksLower: string
  /** 備考（上段） */
  remarksUpper: string
  /** 材種区分の番号 */
  materialCategoryOrder: number | null
}

export type SortSegment = { kind: 'number'; value: number | null } | { kind: 'text'; value: string }

/** 未設定の数値は末尾に置く */
const UNSET = Number.POSITIVE_INFINITY

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'variant' })

export function num(value: number | null): SortSegment {
  return { kind: 'number', value }
}

export function text(value: string): SortSegment {
  return { kind: 'text', value: value.trim() }
}

/**
 * 並び替えキーを生成する。
 * 科目 → 部位Ⅰ → 部位Ⅱ（仕分けがある場合のみ）→ 部位番号 → 明細番号 →
 * 部位文字 → 名称文字 → 単位 → 摘要下 → 摘要上 → 備考下 → 備考上 → 材種区分
 */
export function buildSortKey(detail: SortableDetail): SortSegment[] {
  const hasPart2 = detail.part2Name.trim() !== '' || detail.part2SortOrder !== null
  return [
    num(detail.subjectOrder),
    text(detail.part1),
    // 仕分けが無い行はVBAと同じく部位Ⅱの判定前に置く
    num(hasPart2 ? detail.part2SortOrder : Number.NEGATIVE_INFINITY),
    text(hasPart2 ? detail.part2Name : ''),
    num(detail.partNumber),
    num(detail.detailNumber),
    text(detail.partName),
    text(detail.name),
    num(detail.unitOrder),
    text(detail.descriptionLower),
    text(detail.descriptionUpper),
    text(detail.remarksLower),
    text(detail.remarksUpper),
    num(detail.materialCategoryOrder)
  ]
}

/** 生成済みキー同士を比較する。文字は日本語の照合順（localeCompare相当）で比較する */
export function compareSortKeys(a: SortSegment[], b: SortSegment[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const left = a[i]
    const right = b[i]
    if (left.kind === 'number' && right.kind === 'number') {
      const a2 = left.value ?? UNSET
      const b2 = right.value ?? UNSET
      if (a2 < b2) return -1
      if (a2 > b2) return 1
      continue
    }
    if (left.kind === 'text' && right.kind === 'text') {
      const diff = collator.compare(left.value, right.value)
      if (diff !== 0) return diff
    }
  }
  return 0
}

/**
 * 明細を昇順に並べ替える（安定ソート）。
 * 元の並び順を保持するため、キーが完全一致する場合は入力順を維持する。
 */
export function sortDetails<T>(rows: T[], select: (row: T) => SortableDetail): T[] {
  return rows
    .map((row, index) => ({ row, index, key: buildSortKey(select(row)) }))
    .sort((a, b) => compareSortKeys(a.key, b.key) || a.index - b.index)
    .map((entry) => entry.row)
}
