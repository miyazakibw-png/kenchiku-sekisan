import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrations } from '../../src/main/db/migrations'
import * as schema from '../../src/main/db/schema'
import { seedInitialData } from '../../src/main/db/seed'
import type { AppDatabase } from '../../src/main/db'
import {
  deleteAssembly,
  listAssemblies,
  listAssemblyMasterOptions,
  promoteAssemblyToBasic,
  saveAssembly
} from '../../src/main/services/assemblyService'
import { listMasterOptions, saveDetails } from '../../src/main/services/detailService'
import type { DetailDraft } from '../../src/shared/types'

function createDb(): AppDatabase {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrations.forEach((sql) => sqlite.exec(sql))
  const db = drizzle(sqlite, { schema }) as AppDatabase
  seedInitialData(db)
  return db
}

function draft(name: string): DetailDraft {
  return {
    id: null,
    detailNumber: null,
    materialCategoryId: null,
    partName: '',
    name,
    descriptionUpper: '',
    descriptionLower: '',
    unit: 'm2',
    remarksUpper: '',
    remarksLower: '',
    estimateDisplay: '',
    isActive: true
  }
}

let db: AppDatabase
let detailIds: number[]

beforeEach(() => {
  db = createDb()
  const subjectId = listMasterOptions(db).subjects[0].id
  detailIds = saveDetails(db, {
    subjectId,
    rows: [draft('軽鉄下地'), draft('グラスウール')],
    deletedIds: []
  }).map((d) => d.id)
  const projectId = Number(
    db.insert(schema.projects).values({ name: 'テスト物件' }).run().lastInsertRowid
  )
  projectIdRef = projectId
})

let projectIdRef = 0

describe('仕上明細セットマスター', () => {
  it('基本セットを構成明細付きで保存・取得する', () => {
    const saved = saveAssembly(db, {
      id: null,
      assemblyCode: 'W-6',
      assemblyName: '地下二重壁軸組',
      partId: null,
      usageCategory: '内部',
      scope: 'basic',
      projectId: null,
      note: '',
      items: [
        { id: null, detailId: detailIds[0], role: 'base1', formula: 'P', coefficient: 1 },
        { id: null, detailId: detailIds[1], role: 'base2', formula: 'P*1.1', coefficient: 1.1 }
      ]
    })
    expect(saved.items.map((i) => i.role)).toEqual(['base1', 'base2'])
    expect(saved.items[1].formula).toBe('P*1.1')
    expect(saved.items[0].detailName).toBe('軽鉄下地')
    expect(listAssemblies(db, null).length).toBe(1)
  })

  it('構成明細を洗い替えで更新する', () => {
    const saved = saveAssembly(db, {
      id: null,
      assemblyCode: null,
      assemblyName: 'C-1 天井',
      partId: null,
      usageCategory: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [{ id: null, detailId: detailIds[0], role: 'finish', formula: '', coefficient: 1 }]
    })
    const updated = saveAssembly(db, {
      id: saved.id,
      assemblyCode: null,
      assemblyName: 'C-1 天井',
      partId: null,
      usageCategory: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [{ id: null, detailId: detailIds[1], role: 'finish', formula: '', coefficient: 1 }]
    })
    expect(updated.items.length).toBe(1)
    expect(updated.items[0].detailId).toBe(detailIds[1])
  })

  it('物件セットは基本セット一覧に混ざらない', () => {
    saveAssembly(db, {
      id: null,
      assemblyCode: null,
      assemblyName: '物件用セット',
      partId: null,
      usageCategory: null,
      scope: 'project',
      projectId: projectIdRef,
      note: '',
      items: [{ id: null, detailId: detailIds[0], role: 'finish', formula: '', coefficient: 1 }]
    })
    expect(listAssemblies(db, null)).toEqual([])
    expect(listAssemblies(db, projectIdRef).map((a) => a.assemblyName)).toEqual(['物件用セット'])
  })

  it('物件セットを基本セットへ昇格できる', () => {
    const projectAssembly = saveAssembly(db, {
      id: null,
      assemblyCode: 'P-1',
      assemblyName: '現場で組んだセット',
      partId: null,
      usageCategory: '外部',
      scope: 'project',
      projectId: projectIdRef,
      note: '',
      items: [{ id: null, detailId: detailIds[0], role: 'finish', formula: 'P', coefficient: 1 }]
    })
    const promoted = promoteAssemblyToBasic(db, projectAssembly.id)
    expect(promoted.scope).toBe('basic')
    expect(promoted.projectId).toBeNull()
    expect(promoted.items.length).toBe(1)
    expect(listAssemblies(db, null).map((a) => a.assemblyName)).toEqual(['現場で組んだセット'])
  })

  it('セット削除で構成明細も削除される', () => {
    const saved = saveAssembly(db, {
      id: null,
      assemblyCode: null,
      assemblyName: '削除対象',
      partId: null,
      usageCategory: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [{ id: null, detailId: detailIds[0], role: 'finish', formula: '', coefficient: 1 }]
    })
    deleteAssembly(db, saved.id)
    expect(listAssemblies(db, null)).toEqual([])
    expect(db.select().from(schema.mFinishAssemblyItems).all()).toEqual([])
  })

  it('セット編集用のマスター選択肢を返す', () => {
    const options = listAssemblyMasterOptions(db)
    expect(options.parts.length).toBeGreaterThan(0)
    expect(options.usageCategories).toContain('内部')
    expect(options.details.map((d) => d.name)).toEqual(['軽鉄下地', 'グラスウール'])
  })
})
