import { and, asc, eq, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import {
  detailChangeLogs,
  mDetails,
  mFinishAssemblies,
  mFinishAssemblyItems,
  projectFrameSheets,
  projectGeneralSheets,
  projectRoomFinishes,
  projectRoomSheets
} from '../db/schema'
import type {
  AssemblyItem,
  AssemblyMasterOptions,
  AssemblyScope,
  DetailSnapshot,
  FinishAssembly,
  SaveAssemblyRequest,
  SaveAssemblyResult
} from '../../shared/types'
import { assemblySignature } from '../../shared/assemblySignature'
import type { CalcDetail, CalcSet } from '../../core/room/calcSheet'
import { calcDetail, isEmptyDetail, normalizeSets, syncLines } from '../../core/room/calcSheet'
import { changedFieldsOf, listMasterOptions, snapshotOf } from './detailService'

/** セット明細1行を修正履歴の形にする（有効欄はセットには無いので常に有効とする） */
function itemSnapshot(item: AssemblyItem): DetailSnapshot {
  return snapshotOf({ ...item, isActive: true })
}

function toScope(value: string): AssemblyScope {
  return value === 'project' ? 'project' : 'basic'
}

export function listAssemblyMasterOptions(db: AppDatabase): AssemblyMasterOptions {
  return listMasterOptions(db)
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
  const before = request.id === null ? [] : getAssembly(db, request.id).items
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
    // セット明細で直した内容は修正履歴に残す（明細マスター画面の保存は残さない）
    const logKind = (
      item: AssemblyItem,
      changeKind: 'add' | 'edit' | 'delete',
      beforeSnapshot: DetailSnapshot | null,
      afterSnapshot: DetailSnapshot | null
    ): void => {
      tx.insert(detailChangeLogs)
        .values({
          scope: values.scope,
          projectId: values.projectId,
          subjectId: item.subjectId,
          detailId: item.sourceDetailId,
          changeKind,
          origin: 'セット明細',
          beforeJson: beforeSnapshot === null ? '' : JSON.stringify(beforeSnapshot),
          afterJson: afterSnapshot === null ? '' : JSON.stringify(afterSnapshot)
        })
        .run()
    }
    before.slice(request.items.length).forEach((item) => {
      logKind(item, 'delete', itemSnapshot(item), null)
    })
    request.items.forEach((item, index) => {
      const old = before[index]
      const after = itemSnapshot(item)
      if (!old) logKind(item, 'add', null, after)
      else if (changedFieldsOf(itemSnapshot(old), after).length > 0)
        logKind(item, 'edit', itemSnapshot(old), after)
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
  let syncedSets = 0
  if (request.propagate === true) {
    if (request.applyToAllSets === true) {
      syncedSets += applyItemChangesToOtherAssemblies(db, assembly, before, request.items)
    }
    syncedSets += propagateAssemblyToSheets(db, assembly)
  }
  return { assembly, duplicateOf: findDuplicate(db, assembly), syncedSets }
}

/** 1明細だけの照合キー（同じ明細を使っている他のセットを探すために使う） */
function itemKey(item: AssemblyItem): string {
  return assemblySignature([item])
}

/**
 * 直した明細を、その明細を使っている同じ物件の他のセットにも反映する。
 * （直したセットだけ変える場合は呼ばない）
 */
function applyItemChangesToOtherAssemblies(
  db: AppDatabase,
  assembly: FinishAssembly,
  before: AssemblyItem[],
  after: AssemblyItem[]
): number {
  const changes = new Map<string, AssemblyItem>()
  after.forEach((item, index) => {
    const old = before[index]
    if (!old) return
    const key = itemKey(old)
    if (key !== itemKey(item)) changes.set(key, item)
  })
  if (changes.size === 0) return 0

  let synced = 0
  listAssemblies(db, assembly.projectId).forEach((other) => {
    if (other.id === assembly.id) return
    let changed = false
    const items = other.items.map((item) => {
      const replacement = changes.get(itemKey(item))
      if (!replacement) return item
      changed = true
      return { ...replacement, id: item.id, sourceDetailId: item.sourceDetailId }
    })
    if (!changed) return
    const saved = saveAssembly(db, {
      id: other.id,
      scope: other.scope,
      projectId: other.projectId,
      note: other.note,
      items
    })
    synced += propagateAssemblyToSheets(db, saved.assembly)
  })
  return synced
}

/** 物件の計算書（部屋・軸組・汎用）を1つの形で扱う */
function projectSheetTables(): (
  | typeof projectRoomSheets
  | typeof projectFrameSheets
  | typeof projectGeneralSheets
)[] {
  return [projectRoomSheets, projectFrameSheets, projectGeneralSheets]
}

function parseSets(lowerJson: string): CalcSet[] {
  try {
    const parsed: unknown = JSON.parse(lowerJson)
    return Array.isArray(parsed) ? normalizeSets(parsed as CalcSet[]) : []
  } catch {
    return []
  }
}

/** セット明細マスターの1明細を、計算書の明細行の形にする */
function toCalcDetail(item: AssemblyItem, base: CalcDetail | undefined): CalcDetail {
  return calcDetail({
    ...(base ?? {}),
    sourceDetailId: item.sourceDetailId,
    subjectId: item.subjectId,
    detailNumber: item.detailNumber,
    materialCategory: item.materialCategory,
    partNumber: item.partNumber,
    partName: item.partName,
    name: item.name,
    descriptionUpper: item.descriptionUpper,
    descriptionLower: item.descriptionLower,
    unit: item.unit,
    remarksUpper: item.remarksUpper,
    remarksLower: item.remarksLower,
    estimateDisplay: item.estimateDisplay,
    coefficient: item.coefficient
  })
}

/**
 * セット明細マスターで直した内容を、そのセットを使っている計算書へ連動させる。
 * 計算式はそのまま残し、明細の文字と掛け率だけを合わせる。
 */
export function propagateAssemblyToSheets(db: AppDatabase, assembly: FinishAssembly): number {
  if (assembly.projectId === null) return 0
  let synced = 0
  projectSheetTables().forEach((table) => {
    db.select()
      .from(table)
      .where(eq(table.projectId, assembly.projectId as number))
      .all()
      .forEach((sheet) => {
        const sets = parseSets(sheet.lowerJson)
        let changed = false
        sets.forEach((set) => {
          if (set.assemblyId !== assembly.id) return
          const details = assembly.items.map((item, index) => toCalcDetail(item, set.details[index]))
          set.details = details
          set.lines = syncLines(details, set.lines)
          changed = true
          synced += 1
        })
        if (!changed) return
        db.update(table)
          .set({ lowerJson: JSON.stringify(sets), updatedAt: new Date().toISOString() })
          .where(eq(table.id, sheet.id))
          .run()
      })
  })
  return synced
}

/** 計算書の1セットを、セット明細マスターの構成明細に写し取る */
function itemsOfCalcSet(set: CalcSet): AssemblyItem[] {
  return set.details
    .filter((detail) => !isEmptyDetail(detail) && detail.subjectId !== null)
    .map((detail) => ({
      id: null,
      sourceDetailId: detail.sourceDetailId,
      subjectId: detail.subjectId as number,
      partNumber: detail.partNumber,
      detailNumber: detail.detailNumber,
      materialCategory: detail.materialCategory,
      partName: detail.partName || set.partName,
      name: detail.name,
      descriptionUpper: detail.descriptionUpper,
      descriptionLower: detail.descriptionLower,
      unit: detail.unit,
      remarksUpper: detail.remarksUpper,
      remarksLower: detail.remarksLower,
      estimateDisplay: detail.estimateDisplay,
      formula: '',
      coefficient: detail.coefficient
    }))
}

/**
 * 計算書に組まれたセットを、この物件の仕上明細セットマスターへ自動登録する。
 * 同じ構成のセットは1件にまとめ、計算書側にはマスターのIDを控えて連動できるようにする。
 */
export function syncAssembliesFromSheets(db: AppDatabase, projectId: number): number {
  const bySignature = new Map(
    listAssemblies(db, projectId).map((assembly) => [assemblySignature(assembly.items), assembly])
  )
  let added = 0
  projectSheetTables().forEach((table) => {
    db.select()
      .from(table)
      .where(eq(table.projectId, projectId))
      .all()
      .forEach((sheet) => {
        const sets = parseSets(sheet.lowerJson)
        let changed = false
        sets.forEach((set) => {
          const items = itemsOfCalcSet(set)
          if (items.length === 0) return
          const signature = assemblySignature(items)
          let assembly = bySignature.get(signature)
          if (!assembly) {
            assembly = saveAssembly(db, {
              id: null,
              scope: 'project',
              projectId,
              note: '',
              items
            }).assembly
            bySignature.set(signature, assembly)
            added += 1
          }
          if (set.assemblyId !== assembly.id) {
            set.assemblyId = assembly.id
            changed = true
          }
        })
        if (!changed) return
        db.update(table)
          .set({ lowerJson: JSON.stringify(sets), updatedAt: new Date().toISOString() })
          .where(eq(table.id, sheet.id))
          .run()
      })
  })
  return added
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
