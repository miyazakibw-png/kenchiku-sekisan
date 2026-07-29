import { and, asc, eq, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { mDetails, mFinishAssemblies, mFinishAssemblyItems, mParts } from '../db/schema'
import type {
  AssemblyItem,
  AssemblyItemRole,
  AssemblyMasterOptions,
  AssemblyScope,
  FinishAssembly,
  SaveAssemblyRequest
} from '../../shared/types'

/** 左ツリーの用途区分。部位マスタと組み合わせてセットを分類する */
export const USAGE_CATEGORIES = ['外部', '内部', '共通']

const ROLES: AssemblyItemRole[] = ['finish', 'base1', 'base2', 'reinforce', 'other']

function toRole(value: string): AssemblyItemRole {
  return ROLES.includes(value as AssemblyItemRole) ? (value as AssemblyItemRole) : 'other'
}

function toScope(value: string): AssemblyScope {
  return value === 'project' ? 'project' : 'basic'
}

export function listAssemblyMasterOptions(db: AppDatabase): AssemblyMasterOptions {
  return {
    parts: db.select().from(mParts).orderBy(asc(mParts.displayOrder)).all(),
    usageCategories: USAGE_CATEGORIES,
    details: db.select().from(mDetails).orderBy(asc(mDetails.displayOrder), asc(mDetails.id)).all()
  }
}

/**
 * 仕上明細セットの一覧。
 * projectId を指定すると当該物件のセットのみ、省略時は基本セットのみを返す。
 */
export function listAssemblies(db: AppDatabase, projectId: number | null = null): FinishAssembly[] {
  const rows = db
    .select()
    .from(mFinishAssemblies)
    .where(
      projectId === null
        ? and(eq(mFinishAssemblies.scope, 'basic'), isNull(mFinishAssemblies.projectId))
        : eq(mFinishAssemblies.projectId, projectId)
    )
    .orderBy(asc(mFinishAssemblies.displayOrder), asc(mFinishAssemblies.id))
    .all()

  return rows.map((row) => ({
    id: row.id,
    assemblyCode: row.assemblyCode,
    assemblyName: row.assemblyName,
    partId: row.partId,
    usageCategory: row.usageCategory,
    scope: toScope(row.scope),
    projectId: row.projectId,
    note: row.note,
    displayOrder: row.displayOrder,
    items: listItems(db, row.id)
  }))
}

function listItems(db: AppDatabase, assemblyId: number): AssemblyItem[] {
  return db
    .select({
      id: mFinishAssemblyItems.id,
      detailId: mFinishAssemblyItems.detailId,
      role: mFinishAssemblyItems.role,
      formula: mFinishAssemblyItems.formula,
      coefficient: mFinishAssemblyItems.coefficient,
      detailName: mDetails.name,
      detailUnit: mDetails.unit
    })
    .from(mFinishAssemblyItems)
    .innerJoin(mDetails, eq(mDetails.id, mFinishAssemblyItems.detailId))
    .where(eq(mFinishAssemblyItems.assemblyId, assemblyId))
    .orderBy(asc(mFinishAssemblyItems.displayOrder), asc(mFinishAssemblyItems.id))
    .all()
    .map((item) => ({ ...item, role: toRole(item.role) }))
}

/** セット1件の保存。構成アイテムは画面の並び順で洗い替えする */
export function saveAssembly(db: AppDatabase, request: SaveAssemblyRequest): FinishAssembly {
  const values = {
    assemblyCode: request.assemblyCode,
    assemblyName: request.assemblyName,
    partId: request.partId,
    usageCategory: request.usageCategory,
    scope: request.scope,
    projectId: request.scope === 'project' ? request.projectId : null,
    note: request.note
  }

  const id = db.transaction((tx) => {
    let assemblyId = request.id
    if (assemblyId === null) {
      const maxOrder = tx
        .select({ displayOrder: mFinishAssemblies.displayOrder })
        .from(mFinishAssemblies)
        .orderBy(asc(mFinishAssemblies.displayOrder))
        .all()
        .reduce((max, r) => Math.max(max, r.displayOrder), -1)
      const result = tx
        .insert(mFinishAssemblies)
        .values({ ...values, displayOrder: maxOrder + 1 })
        .run()
      assemblyId = Number(result.lastInsertRowid)
    } else {
      tx.update(mFinishAssemblies)
        .set({ ...values, updatedAt: new Date().toISOString() })
        .where(eq(mFinishAssemblies.id, assemblyId))
        .run()
      tx.delete(mFinishAssemblyItems)
        .where(eq(mFinishAssemblyItems.assemblyId, assemblyId))
        .run()
    }
    request.items.forEach((item, index) => {
      tx.insert(mFinishAssemblyItems)
        .values({
          assemblyId,
          detailId: item.detailId,
          role: item.role,
          formula: item.formula,
          coefficient: item.coefficient,
          displayOrder: index
        })
        .run()
    })
    return assemblyId
  })

  return getAssembly(db, id)
}

export function getAssembly(db: AppDatabase, id: number): FinishAssembly {
  const row = db.select().from(mFinishAssemblies).where(eq(mFinishAssemblies.id, id)).get()
  if (!row) throw new Error(`仕上明細セットが見つかりません: id=${id}`)
  return {
    id: row.id,
    assemblyCode: row.assemblyCode,
    assemblyName: row.assemblyName,
    partId: row.partId,
    usageCategory: row.usageCategory,
    scope: toScope(row.scope),
    projectId: row.projectId,
    note: row.note,
    displayOrder: row.displayOrder,
    items: listItems(db, row.id)
  }
}

export function deleteAssembly(db: AppDatabase, id: number): void {
  db.delete(mFinishAssemblies).where(eq(mFinishAssemblies.id, id)).run()
}

/**
 * 積算入力時に組まれた物件セットを、全物件共通の基本セットへ昇格（複製）する。
 */
export function promoteAssemblyToBasic(db: AppDatabase, id: number): FinishAssembly {
  const source = getAssembly(db, id)
  const created = saveAssembly(db, {
    id: null,
    assemblyCode: source.assemblyCode,
    assemblyName: source.assemblyName,
    partId: source.partId,
    usageCategory: source.usageCategory,
    scope: 'basic',
    projectId: null,
    note: source.note,
    items: source.items.map((item) => ({ ...item, id: null }))
  })
  db.update(mFinishAssemblies)
    .set({ sourceAssemblyId: source.id })
    .where(eq(mFinishAssemblies.id, created.id))
    .run()
  return getAssembly(db, created.id)
}
