import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrations } from '../../src/main/db/migrations'
import * as schema from '../../src/main/db/schema'
import { seedInitialData } from '../../src/main/db/seed'
import type { AppDatabase } from '../../src/main/db'
import { copyProject, createProject } from '../../src/main/services/projectService'
import {
  listEstimateRows,
  saveEstimateRows
} from '../../src/main/services/estimateRowService'
import { listMasterOptions } from '../../src/main/services/detailService'
import type { EstimateRowDraft } from '../../src/shared/types'

function createDb(): AppDatabase {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrations.forEach((sql) => sqlite.exec(sql))
  const db = drizzle(sqlite, { schema }) as AppDatabase
  seedInitialData(db)
  return db
}

function draft(patch: Partial<EstimateRowDraft>): EstimateRowDraft {
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
    calcType: 'room',
    ...patch
  }
}

let db: AppDatabase
let projectId: number

beforeEach(() => {
  db = createDb()
  projectId = createProject(db, 'テスト工事').id
})

describe('部位別入力表', () => {
  it('画面の行順で保存し、同じ順で読み出せる', () => {
    const saved = saveEstimateRows(db, {
      projectId,
      rows: [
        draft({ part1: '内部', part2: '1階', part3: '風除室', ceilingHeight: 2.5 }),
        draft({ part3: '玄関ホール', ceilingHeight: 2.7 }),
        draft({ rowType: 'subtotal', part3: '小計', multiplier: 0 })
      ]
    })
    expect(saved.map((row) => row.part3)).toEqual(['風除室', '玄関ホール', '小計'])
    expect(saved.map((row) => row.displayOrder)).toEqual([0, 1, 2])
    expect(saved[2].rowType).toBe('subtotal')
    expect(listEstimateRows(db, projectId)).toEqual(saved)
  })

  it('部位Ⅱ別仕訳・型枠・計算タイプを保持する', () => {
    const [row] = saveEstimateRows(db, {
      projectId,
      rows: [draft({ part2: '1階', part2Split: 1, formwork: '地上階', calcType: 'frame' })]
    })
    expect(row).toMatchObject({ part2Split: 1, formwork: '地上階', calcType: 'frame' })
  })

  it('画面から消えた行は削除する', () => {
    const saved = saveEstimateRows(db, {
      projectId,
      rows: [draft({ part3: 'A' }), draft({ part3: 'B' })]
    })
    const kept = saveEstimateRows(db, {
      projectId,
      rows: [{ ...saved[1], id: saved[1].id }]
    })
    expect(kept.map((row) => row.part3)).toEqual(['B'])
  })

  it('物件ごとに独立している', () => {
    const other = createProject(db, '別工事').id
    saveEstimateRows(db, { projectId, rows: [draft({ part3: '風除室' })] })
    expect(listEstimateRows(db, other)).toEqual([])
  })

  it('物件コピーで部位別入力表も複製し、コピー元とは切り離す', () => {
    saveEstimateRows(db, { projectId, rows: [draft({ part3: '風除室', ceilingHeight: 2.5 })] })
    const copied = copyProject(db, projectId, 'コピー工事')
    const copiedRows = listEstimateRows(db, copied.id)
    expect(copiedRows.map((row) => row.part3)).toEqual(['風除室'])

    saveEstimateRows(db, {
      projectId: copied.id,
      rows: [{ ...copiedRows[0], part3: '倉庫' }]
    })
    expect(listEstimateRows(db, projectId)[0].part3).toBe('風除室')
  })
})

describe('計算書の書式', () => {
  it('3書式（部屋別・軸組・汎用）を選べる', () => {
    expect(listMasterOptions(db).calcSheets.map((sheet) => sheet.key)).toEqual([
      'room',
      'frame',
      'general'
    ])
  })

  it('型枠分類は番号入力用にIDと名称を返す', () => {
    expect(listMasterOptions(db).formworkCategories).toEqual([
      { id: 1, name: '基礎階' },
      { id: 2, name: '地下階' },
      { id: 3, name: '地上階' }
    ])
  })
})
