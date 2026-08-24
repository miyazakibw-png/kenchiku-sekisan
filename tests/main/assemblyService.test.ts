import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrations } from '../../src/main/db/migrations'
import * as schema from '../../src/main/db/schema'
import { seedInitialData } from '../../src/main/db/seed'
import type { AppDatabase } from '../../src/main/db'
import {
  buildItemFromDetail,
  listAssemblies,
  listAssemblyMasterOptions,
  mergeAssemblies,
  promoteAssemblyToBasic,
  saveAssembly
} from '../../src/main/services/assemblyService'
import {
  listDetailChangeLogs,
  listDetails,
  listMasterOptions,
  saveDetails
} from '../../src/main/services/detailService'
import type { AssemblyItem, DetailDraft } from '../../src/shared/types'

function createDb(): AppDatabase {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrations.forEach((sql) => sqlite.exec(sql))
  const db = drizzle(sqlite, { schema }) as AppDatabase
  seedInitialData(db)
  return db
}

function draft(name: string, materialCategory = '仕上'): DetailDraft {
  return {
    id: null,
    detailNumber: null,
    materialCategory,
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
let subjectId = 0
let detailIds: number[]
let projectIdRef = 0

beforeEach(() => {
  db = createDb()
  subjectId = listMasterOptions(db).subjects[0].id
  detailIds = saveDetails(db, {
    subjectId,
    rows: [draft('軽鉄下地', '下地1'), draft('グラスウール', '下地2')],
    deletedIds: []
  }).map((d) => d.id)
  projectIdRef = Number(
    db.insert(schema.projects).values({ name: 'テスト物件' }).run().lastInsertRowid
  )
})

function itemOf(detailId: number, patch: Partial<AssemblyItem> = {}): AssemblyItem {
  return { ...buildItemFromDetail(db, detailId), ...patch }
}

describe('仕上明細セットマスター', () => {
  it('基本セットを構成明細付きで保存・取得する', () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [
        itemOf(detailIds[0], { formula: 'P' }),
        itemOf(detailIds[1], { formula: 'P*1.1', coefficient: 1.1 })
      ]
    })
    expect(assembly.items.map((i) => i.name)).toEqual(['軽鉄下地', 'グラスウール'])
    expect(assembly.items.map((i) => i.materialCategory)).toEqual(['下地1', '下地2'])
    expect(assembly.items[1].coefficient).toBe(1.1)
    expect(listAssemblies(db, null).length).toBe(1)
  })

  it('セット明細で直した内容は修正履歴に残る', () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [itemOf(detailIds[0])]
    })
    saveAssembly(db, {
      id: assembly.id,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [{ ...assembly.items[0], name: '軽鉄下地（セットで修正）' }]
    })

    const logs = listDetailChangeLogs(db)
    expect(logs.map((log) => log.origin)).toEqual(['セット明細', 'セット明細'])
    expect(logs[0].changeKind).toBe('edit')
    expect(logs[0].before?.name).toBe('軽鉄下地')
    expect(logs[0].after?.name).toBe('軽鉄下地（セットで修正）')
  })

  it('明細マスターを後から直してもセットの内容は変わらない（一方通行）', () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [itemOf(detailIds[0])]
    })
    const rows = listDetails(db, subjectId).map((detail) => ({
      id: detail.id,
      detailNumber: detail.detailNumber,
      materialCategory: detail.materialCategory,
      partName: detail.partName,
      name: detail.id === detailIds[0] ? '軽鉄下地（改称）' : detail.name,
      descriptionUpper: detail.descriptionUpper,
      descriptionLower: detail.descriptionLower,
      unit: detail.unit,
      remarksUpper: detail.remarksUpper,
      remarksLower: detail.remarksLower,
      estimateDisplay: detail.estimateDisplay,
      isActive: detail.isActive
    }))
    saveDetails(db, { subjectId, rows, deletedIds: [] })

    expect(listAssemblies(db, null)[0].items[0].name).toBe('軽鉄下地')
    expect(assembly.items[0].sourceDetailId).toBe(detailIds[0])
  })

  it('セット側の修正は明細マスターに反映されない', () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [itemOf(detailIds[0])]
    })
    saveAssembly(db, {
      id: assembly.id,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [{ ...assembly.items[0], name: 'セット内だけの名称' }]
    })
    expect(listDetails(db, subjectId).map((d) => d.name)).toEqual(['軽鉄下地', 'グラスウール'])
  })

  it('行を入れ替えると一覧の表示行（1行目）も変わる', () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [itemOf(detailIds[0]), itemOf(detailIds[1])]
    })
    const { assembly: swapped } = saveAssembly(db, {
      id: assembly.id,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [assembly.items[1], assembly.items[0]]
    })
    expect(swapped.items[0].name).toBe('グラスウール')
    expect(listAssemblies(db, null)[0].items[0].name).toBe('グラスウール')
  })

  it('同じ内容のセットができた場合は統合候補を返し、統合できる', () => {
    const first = saveAssembly(db, {
      id: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [itemOf(detailIds[0])]
    })
    expect(first.duplicateOf).toBeNull()

    const second = saveAssembly(db, {
      id: null,
      scope: 'basic',
      projectId: null,
      note: '',
      items: [itemOf(detailIds[0])]
    })
    expect(second.duplicateOf?.id).toBe(first.assembly.id)

    mergeAssemblies(db, first.assembly.id, second.assembly.id)
    expect(listAssemblies(db, null).map((a) => a.id)).toEqual([first.assembly.id])
  })

  it('構成明細が空の保存は拒否する（最低1明細）', () => {
    expect(() =>
      saveAssembly(db, { id: null, scope: 'basic', projectId: null, note: '', items: [] })
    ).toThrow()
  })

  it('物件セットは基本セット一覧に混ざらない', () => {
    saveAssembly(db, {
      id: null,
      scope: 'project',
      projectId: projectIdRef,
      note: '',
      items: [itemOf(detailIds[0])]
    })
    expect(listAssemblies(db, null)).toEqual([])
    expect(listAssemblies(db, projectIdRef).map((a) => a.items[0].name)).toEqual(['軽鉄下地'])
  })

  it('物件セットを基本セットへ昇格できる', () => {
    const { assembly } = saveAssembly(db, {
      id: null,
      scope: 'project',
      projectId: projectIdRef,
      note: '現場で組んだセット',
      items: [itemOf(detailIds[0], { formula: 'P' })]
    })
    const promoted = promoteAssemblyToBasic(db, assembly.id)
    expect(promoted.scope).toBe('basic')
    expect(promoted.projectId).toBeNull()
    expect(promoted.items.map((i) => i.name)).toEqual(['軽鉄下地'])
    expect(listAssemblies(db, null).map((a) => a.note)).toEqual(['現場で組んだセット'])
  })

  it('セット編集用のマスター選択肢を返す', () => {
    const options = listAssemblyMasterOptions(db)
    expect(options.subjects.length).toBeGreaterThan(0)
    expect(options.units.length).toBeGreaterThan(0)
    expect(options.materialCategories.map((c) => c.name)).toEqual([
      '仕上',
      '軸組',
      '下地1',
      '下地2',
      '予備'
    ])
  })
})
