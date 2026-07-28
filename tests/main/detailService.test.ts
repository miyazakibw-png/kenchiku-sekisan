import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrations } from '../../src/main/db/migrations'
import * as schema from '../../src/main/db/schema'
import { seedInitialData } from '../../src/main/db/seed'
import type { AppDatabase } from '../../src/main/db'
import {
  listDetails,
  listMasterOptions,
  saveDetails
} from '../../src/main/services/detailService'
import type { DetailDraft } from '../../src/shared/types'

function createDb(): AppDatabase {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrations.forEach((sql) => sqlite.exec(sql))
  const db = drizzle(sqlite, { schema }) as AppDatabase
  seedInitialData(db)
  return db
}

function draft(name: string, overrides: Partial<DetailDraft> = {}): DetailDraft {
  return {
    id: null,
    detailNumber: null,
    materialCategoryId: null,
    name,
    description: '',
    unit: '㎡',
    remarks: '',
    isActive: true,
    ...overrides
  }
}

let db: AppDatabase
let subjectId: number

beforeEach(() => {
  db = createDb()
  subjectId = listMasterOptions(db).subjects[0].id
})

describe('明細マスターの保存', () => {
  it('初期マスター（科目・材種・単位）が投入される', () => {
    const options = listMasterOptions(db)
    expect(options.subjects.length).toBeGreaterThan(0)
    expect(options.materialCategories.map((c) => c.name)).toContain('下地1')
    expect(options.units.map((u) => u.name)).toContain('㎡')
  })

  it('新規行を採番順に登録する', () => {
    const saved = saveDetails(db, {
      subjectId,
      rows: [draft('コンクリート'), draft('型枠')],
      deletedIds: []
    })
    expect(saved.map((d) => d.name)).toEqual(['コンクリート', '型枠'])
    expect(saved.map((d) => d.displayOrder)).toEqual([0, 1])
  })

  it('並び替えた順序が display_order に反映される', () => {
    const saved = saveDetails(db, {
      subjectId,
      rows: [draft('A'), draft('B')],
      deletedIds: []
    })
    const reordered = saveDetails(db, {
      subjectId,
      rows: [
        { ...draft('B'), id: saved[1].id },
        { ...draft('A'), id: saved[0].id }
      ],
      deletedIds: []
    })
    expect(reordered.map((d) => d.name)).toEqual(['B', 'A'])
  })

  it('削除指定した行を除去する', () => {
    const saved = saveDetails(db, {
      subjectId,
      rows: [draft('A'), draft('B')],
      deletedIds: []
    })
    const after = saveDetails(db, {
      subjectId,
      rows: [{ ...draft('A'), id: saved[0].id }],
      deletedIds: [saved[1].id]
    })
    expect(after.map((d) => d.name)).toEqual(['A'])
  })

  it('科目ごとに明細を分離して取得する', () => {
    const options = listMasterOptions(db)
    saveDetails(db, { subjectId: options.subjects[0].id, rows: [draft('A')], deletedIds: [] })
    saveDetails(db, { subjectId: options.subjects[1].id, rows: [draft('B')], deletedIds: [] })
    expect(listDetails(db, options.subjects[1].id).map((d) => d.name)).toEqual(['B'])
  })
})
