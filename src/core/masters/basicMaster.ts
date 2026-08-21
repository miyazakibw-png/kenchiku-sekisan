/**
 * その他マスター（明細用部位・材種区分・単位・管理用部位・型枠分類）の共通規則。
 * 番号はそのまま計算書や明細で入力される値なので、人が決めた番号を保持する。
 */

export type BasicMasterKind =
  | 'pickupParts'
  | 'materialCategories'
  | 'units'
  | 'aggregationParts'
  | 'formworkCategories'

export interface BasicMasterRow {
  id: number
  name: string
  note: string
}

export interface BasicMasterLimit {
  label: string
  /** 使用できる番号の上限 */
  maxId: number
  /** 登録できる件数の上限 */
  maxRows: number
  /** 名称の重複を禁止する（単位のように名称で参照するもの） */
  uniqueName: boolean
  hint: string
}

export const BASIC_MASTER_LIMITS: Record<BasicMasterKind, BasicMasterLimit> = {
  pickupParts: {
    label: '明細用部位',
    maxId: 200,
    maxRows: 200,
    uniqueName: false,
    hint: '計算書のセット明細の先頭（部位）で番号入力して使います'
  },
  materialCategories: {
    label: '材種区分',
    maxId: 20,
    maxRows: 20,
    uniqueName: true,
    hint: '仕上・軸組・下地などの区分。チェック表の区分にも使います'
  },
  units: {
    label: '単位',
    maxId: 30,
    maxRows: 30,
    uniqueName: true,
    hint: '明細・計算書・内訳書で共通に使う単位'
  },
  aggregationParts: {
    label: '管理用部位',
    maxId: 20,
    maxRows: 20,
    uniqueName: false,
    hint: 'チェック数量の読み込みに使う管理用の部位'
  },
  formworkCategories: {
    label: '型枠分類',
    maxId: 20,
    maxRows: 20,
    uniqueName: false,
    hint: '打放型枠の転記で使う分類'
  }
}

/** 番号も名称も備考も無い行。保存時に取り除く */
export function isBlankBasicMasterRow(row: BasicMasterRow): boolean {
  return (
    (!Number.isInteger(row.id) || row.id < 1) && row.name.trim() === '' && row.note.trim() === ''
  )
}

/** 何も入っていない行を除いた並び */
export function dropBlankBasicMasterRows(rows: readonly BasicMasterRow[]): BasicMasterRow[] {
  return rows.filter((row) => !isBlankBasicMasterRow(row))
}

/**
 * 保存前の検証。問題があればエラーメッセージを返す（空なら保存可）。
 * 名称が空の行は行間を空ける目的で使うため、番号さえあれば保存できる。
 */
export function validateBasicMaster(kind: BasicMasterKind, rows: readonly BasicMasterRow[]): string[] {
  const limit = BASIC_MASTER_LIMITS[kind]
  const errors: string[] = []
  const filled = dropBlankBasicMasterRows(rows)
  if (filled.length > limit.maxRows) {
    errors.push(`${limit.label}は${limit.maxRows}件までです（${filled.length}件）`)
  }
  const ids = new Set<number>()
  const names = new Set<string>()
  filled.forEach((row) => {
    if (!Number.isInteger(row.id) || row.id < 1 || row.id > limit.maxId) {
      errors.push(`番号は1〜${limit.maxId}で入力してください（${row.id || '空欄'}）`)
    } else if (ids.has(row.id)) {
      errors.push(`番号が重複しています：${row.id}`)
    }
    ids.add(row.id)
    const name = row.name.trim()
    if (name === '') return
    if (limit.uniqueName && names.has(name)) {
      errors.push(`名称が重複しています：${name}`)
    }
    names.add(name)
  })
  return [...new Set(errors)]
}

/** 未使用の一番小さい番号（行追加時の初期値） */
export function nextBasicMasterId(kind: BasicMasterKind, rows: readonly BasicMasterRow[]): number {
  const used = new Set(rows.map((row) => row.id))
  const limit = BASIC_MASTER_LIMITS[kind]
  for (let id = 1; id <= limit.maxId; id += 1) {
    if (!used.has(id)) return id
  }
  return limit.maxId
}
