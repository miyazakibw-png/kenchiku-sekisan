import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrations } from '../../src/main/db/migrations'
import * as schema from '../../src/main/db/schema'
import { seedInitialData } from '../../src/main/db/seed'
import type { AppDatabase } from '../../src/main/db'
import { createProject } from '../../src/main/services/projectService'
import { listFittings, saveFittings } from '../../src/main/services/fittingService'
import type { FittingDraft } from '../../src/shared/types'

function createDb(): AppDatabase {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrations.forEach((sql) => sqlite.exec(sql))
  const db = drizzle(sqlite, { schema }) as AppDatabase
  seedInitialData(db)
  return db
}

function draft(patch: Partial<FittingDraft>): FittingDraft {
  return {
    id: null,
    symbol: 'AW1',
    name: '',
    width: null,
    height: null,
    sillHeight: null,
    areaFormula: '',
    baseboardFormula: '',
    note: '',
    fromEstimate: 0,
    ...patch
  }
}

let db: AppDatabase
let projectId: number

beforeEach(() => {
  db = createDb()
  projectId = createProject(db, 'テスト物件').id
})

describe('建具表', () => {
  it('画面の行順で保存する', () => {
    const saved = saveFittings(db, {
      projectId,
      rows: [
        draft({ symbol: 'SD1', width: 3.5, height: 3.5 }),
        draft({ symbol: 'AW1', width: 1.5, height: 1.76, sillHeight: 0.9 })
      ]
    })
    expect(saved.map((row) => row.symbol)).toEqual(['SD1', 'AW1'])
    expect(saved[1].sillHeight).toBe(0.9)
  })

  it('同じ建具記号を重複して登録できる（画面で赤文字にして知らせる）', () => {
    const saved = saveFittings(db, {
      projectId,
      rows: [draft({ symbol: 'AW1' }), draft({ symbol: 'AW1' })]
    })
    expect(saved).toHaveLength(2)
  })

  it('積算入力から登録した行は建具表入力の後ろへまとめる', () => {
    saveFittings(db, {
      projectId,
      rows: [
        draft({ symbol: 'X1', fromEstimate: 1 }),
        draft({ symbol: 'AW1' }),
        draft({ symbol: 'AW2' })
      ]
    })
    expect(listFittings(db, projectId).map((row) => row.symbol)).toEqual(['AW1', 'AW2', 'X1'])
  })

  it('行を削除して保存すると消える', () => {
    const saved = saveFittings(db, {
      projectId,
      rows: [draft({ symbol: 'AW1' }), draft({ symbol: 'AW2' })]
    })
    const kept = saved
      .filter((row) => row.symbol === 'AW2')
      .map(({ id, projectId: _projectId, displayOrder: _displayOrder, ...rest }) => ({
        id,
        ...rest
      }))
    expect(saveFittings(db, { projectId, rows: kept }).map((row) => row.symbol)).toEqual(['AW2'])
  })

  it('物件が違えば別の建具表になる', () => {
    const other = createProject(db, '別物件').id
    saveFittings(db, { projectId, rows: [draft({ symbol: 'AW1' })] })
    expect(listFittings(db, other)).toHaveLength(0)
  })
})
