import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrations } from '../../src/main/db/migrations'
import * as schema from '../../src/main/db/schema'
import { seedInitialData } from '../../src/main/db/seed'
import type { AppDatabase } from '../../src/main/db'
import {
  listBasicMasters,
  saveBasicMaster
} from '../../src/main/services/basicMasterService'
import {
  BASIC_MASTER_LIMITS,
  nextBasicMasterId,
  validateBasicMaster
} from '../../src/core/masters/basicMaster'

function createDb(): AppDatabase {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrations.forEach((sql) => sqlite.exec(sql))
  const db = drizzle(sqlite, { schema }) as AppDatabase
  seedInitialData(db)
  return db
}

describe('その他マスター', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = createDb()
  })

  it('初期データを5種類とも読み出せる', () => {
    const masters = listBasicMasters(db)
    expect(masters.materialCategories[0]).toEqual({ id: 1, name: '仕上', note: '' })
    expect(masters.units.length).toBeGreaterThan(0)
    expect(masters.pickupParts.length).toBeGreaterThan(0)
    expect(masters.aggregationParts.length).toBeGreaterThan(0)
    expect(masters.formworkCategories.length).toBeGreaterThan(0)
  })

  it('番号を保ったまま追加・名称変更・削除ができる', () => {
    const before = listBasicMasters(db).materialCategories
    const rows = [
      ...before.filter((row) => row.id !== 5).map((row) => ({ ...row })),
      { id: 10, name: '仮設', note: '' }
    ]
    rows[0] = { ...rows[0], name: '仕上げ' }
    const result = saveBasicMaster(db, 'materialCategories', rows)
    expect(result.errors).toEqual([])
    const after = result.masters.materialCategories
    expect(after.map((row) => row.id)).toEqual([1, 2, 3, 4, 10])
    expect(after[0].name).toBe('仕上げ')
    expect(after[4].name).toBe('仮設')
  })

  it('明細用部位は備考も保存する', () => {
    const rows = [{ id: 1, name: '床', note: '仕上' }]
    const result = saveBasicMaster(db, 'pickupParts', rows)
    expect(result.errors).toEqual([])
    expect(result.masters.pickupParts).toEqual([{ id: 1, name: '床', note: '仕上' }])
  })

  it('番号重複・名称空欄は保存せずエラーを返す', () => {
    const before = listBasicMasters(db).units
    const result = saveBasicMaster(db, 'units', [
      { id: 1, name: 'm', note: '' },
      { id: 1, name: '', note: '' }
    ])
    expect(result.errors.length).toBe(2)
    expect(result.masters.units).toEqual(before)
  })

  it('上限を超える件数・番号は保存しない', () => {
    const rows = Array.from({ length: 31 }, (_, i) => ({
      id: i + 1,
      name: `u${i + 1}`,
      note: ''
    }))
    expect(saveBasicMaster(db, 'units', rows).errors[0]).toContain('30件まで')
    expect(
      saveBasicMaster(db, 'pickupParts', [{ id: 201, name: '床', note: '' }]).errors[0]
    ).toContain('1〜200')
  })
})

describe('その他マスターの共通規則', () => {
  it('マスターごとの上限', () => {
    expect(BASIC_MASTER_LIMITS.pickupParts.maxId).toBe(200)
    expect(BASIC_MASTER_LIMITS.units.maxRows).toBe(30)
    expect(BASIC_MASTER_LIMITS.aggregationParts.maxRows).toBe(20)
  })

  it('未使用の最小番号を採番する', () => {
    const rows = [
      { id: 1, name: 'a', note: '' },
      { id: 3, name: 'b', note: '' }
    ]
    expect(nextBasicMasterId('units', rows)).toBe(2)
  })

  it('名称の重複は単位・材種区分だけ禁止する', () => {
    const rows = [
      { id: 1, name: 'm', note: '' },
      { id: 2, name: 'm', note: '' }
    ]
    expect(validateBasicMaster('units', rows)).toHaveLength(1)
    expect(validateBasicMaster('pickupParts', rows)).toEqual([])
  })
})
