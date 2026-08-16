import { and, asc, eq, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import {
  mDetails,
  mFinishAssemblies,
  mFinishAssemblyItems,
  mMaterialCategories,
  mSubjects,
  mUnits,
  projectRoomFinishes
} from '../db/schema'
import type {
  AssemblyItem,
  AssemblyMasterOptions,
  AssemblyScope,
  FinishAssembly,
  SaveAssemblyRequest,
  SaveAssemblyResult
} from '../../shared/types'
import { assemblySignature } from '../../shared/assemblySignature'

function toScope(value: string): AssemblyScope {
  return value === 'project' ? 'project' : 'basic'
}

export function listAssemblyMasterOptions(db: AppDatabase): AssemblyMasterOptions {
  return {
    subjects: db.select().from(mSubjects).orderBy(asc(mSubjects.displayOrder)).all(),
    materialCategories: db
      .select()
      .from(mMaterialCategories)
      .orderBy(asc(mMaterialCategories.displayOrder))
      .all(),
    units: db.select().from(mUnits).orderBy(asc(mUnits.displayOrder)).all()
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
    scope: toScope(row.scope),
    projectId: row.projectId,
    note: row.note,
    displayOrder: row.displayOrder,
    items: listItems(db, row.id)
  }))
}

function listItems(db: AppDatabase, assemblyId: number): AssemblyItem[] {
  return db
    .select()
    .from(mFinishAssemblyItems)
    .where(eq(mFinishAssemblyItems.assemblyId, assemblyId))
    .orderBy(asc(mFinishAssemblyItems.displayOrder), asc(mFinishAssemblyItems.id))
    .all()
    .map((item) => ({
      id: item.id,
      sourceDetailId: item.sourceDetailId,
      subjectId: item.subjectId,
      partNumber: item.partNumber,
      detailNumber: item.detailNumber,
      materialCategory: item.materialCategory,
      partName: item.partName,
      name: item.name,
      descriptionUpper: item.descriptionUpper,
      descriptionLower: item.descriptionLower,
      unit: item.unit,
      remarksUpper: item.remarksUpper,
      remarksLower: item.remarksLower,
      estimateDisplay: item.estimateDisplay,
      formula: item.formula,
      coefficient: item.coefficient
    }))
}

/**
 * 明細マスターから1明細を写し取ってセットの構成明細を作る。
 * 明細マスターは呼び出して入力するための一方通行なので、参照ではなく内容を複製する。
 */
export function buildItemFromDetail(db: AppDatabase, detailId: number): AssemblyItem {
  const detail = db.select().from(mDetails).where(eq(mDetails.id, detailId)).get()
  if (!detail) throw new Error(`明細が見つかりません: id=${detailId}`)
  return {
    id: null,
    sourceDetailId: detail.id,
    subjectId: detail.subjectId,
    partNumber: null,
    detailNumber: detail.detailNumber,
    materialCategory: detail.materialCategory,
    partName: detail.partName,
    name: detail.name,
    descriptionUpper: detail.descriptionUpper,
    descriptionLower: detail.descriptionLower,
    unit: detail.unit,
    remarksUpper: detail.remarksUpper,
    remarksLower: detail.remarksLower,
    estimateDisplay: detail.estimateDisplay,
    formula: '',
    coefficient: 1
  }
}

/**
 * セット1件の保存。構成明細は画面の並び順で洗い替えする。
 * 保存後に内容が完全一致する別セットがある場合は統合候補として返す（統合するかは利用者が決める）。
 */
export function saveAssembly(db: AppDatabase, request: SaveAssemblyRequest): SaveAssemblyResult {
  if (request.items.length === 0) {
    throw new Error('セットには最低1明細が必要です')
  }
  const id = db.transaction((tx) => {
    let assemblyId = request.id
    const values = {
      // 一覧・参照用にセット名としてセット1行目の名称を保持する
      assemblyName: request.items[0].name,
      scope: request.scope,
      projectId: request.scope === 'project' ? request.projectId : null,
      note: request.note
    }
    if (assemblyId === null) {
      const maxOrder = tx
        .select({ displayOrder: mFinishAssemblies.displayOrder })
        .from(mFinishAssemblies)
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
      tx.delete(mFinishAssemblyItems).where(eq(mFinishAssemblyItems.assemblyId, assemblyId)).run()
    }
    request.items.forEach((item, index) => {
      tx.insert(mFinishAssemblyItems)
        .values({
          assemblyId,
          sourceDetailId: item.sourceDetailId,
          subjectId: item.subjectId,
          partNumber: item.partNumber,
          detailNumber: item.detailNumber,
          materialCategory: item.materialCategory,
          partName: item.partName,
          name: item.name,
          descriptionUpper: item.descriptionUpper,
          descriptionLower: item.descriptionLower,
          unit: item.unit,
          remarksUpper: item.remarksUpper,
          remarksLower: item.remarksLower,
          estimateDisplay: item.estimateDisplay,
          formula: item.formula,
          coefficient: item.coefficient,
          displayOrder: index
        })
        .run()
    })
    return assemblyId
  })

  const assembly = getAssembly(db, id)
  return { assembly, duplicateOf: findDuplicate(db, assembly) }
}

/** 内容（構成明細の並びと文字）が完全一致する別セットを探す */
function findDuplicate(db: AppDatabase, assembly: FinishAssembly): FinishAssembly | null {
  const signature = assemblySignature(assembly.items)
  return (
    listAssemblies(db, assembly.projectId).find(
      (other) => other.id !== assembly.id && assemblySignature(other.items) === signature
    ) ?? null
  )
}

export function getAssembly(db: AppDatabase, id: number): FinishAssembly {
  const row = db.select().from(mFinishAssemblies).where(eq(mFinishAssemblies.id, id)).get()
  if (!row) throw new Error(`仕上明細セットが見つかりません: id=${id}`)
  return {
    id: row.id,
    scope: toScope(row.scope),
    projectId: row.projectId,
    note: row.note,
    displayOrder: row.displayOrder,
    items: listItems(db, row.id)
  }
}

/**
 * 内容が同じになった2つのセットを1つへ統合する。
 * 計算書など参照している側を残す側へ付け替えてから、重複したセットを取り除く。
 * （マスターからの任意削除は誤操作防止のため設けない）
 */
export function mergeAssemblies(db: AppDatabase, keepId: number, mergedId: number): FinishAssembly {
  if (keepId === mergedId) return getAssembly(db, keepId)
  db.transaction((tx) => {
    tx.update(projectRoomFinishes)
      .set({ finishAssemblyId: keepId })
      .where(eq(projectRoomFinishes.finishAssemblyId, mergedId))
      .run()
    tx.delete(mFinishAssemblies).where(eq(mFinishAssemblies.id, mergedId)).run()
  })
  return getAssembly(db, keepId)
}

/**
 * 積算入力時に組まれた物件セットを、全物件共通の基本セットへ昇格（複製）する。
 */
export function promoteAssemblyToBasic(db: AppDatabase, id: number): FinishAssembly {
  const source = getAssembly(db, id)
  const { assembly } = saveAssembly(db, {
    id: null,
    scope: 'basic',
    projectId: null,
    note: source.note,
    items: source.items.map((item) => ({ ...item, id: null }))
  })
  db.update(mFinishAssemblies)
    .set({ sourceAssemblyId: source.id })
    .where(eq(mFinishAssemblies.id, assembly.id))
    .run()
  return getAssembly(db, assembly.id)
}
