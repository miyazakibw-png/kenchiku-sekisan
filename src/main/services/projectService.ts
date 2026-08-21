import { asc, eq, sql } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import {
  calcSheetEntries,
  mFinishAssemblies,
  mFinishAssemblyItems,
  mProjectFields,
  projectEstimateRows,
  projectFieldValues,
  projectFittings,
  projectFrameSheets,
  projectRoomFinishes,
  projectRoomSheets,
  projects
} from '../db/schema'
import type {
  ProjectField,
  ProjectLedger,
  ProjectSummary,
  SaveProjectRequest
} from '../../shared/types'

/** 管理番号は連番で自動採番し、以後変更しない */
function nextManagementNo(db: AppDatabase): string {
  const rows = db.select({ managementNo: projects.managementNo }).from(projects).all()
  const max = rows.reduce((acc, row) => {
    const matched = /^P-(\d+)$/.exec(row.managementNo)
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 0)
  return `P-${String(max + 1).padStart(4, '0')}`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextDisplayOrder(db: AppDatabase): number {
  const rows = db.select({ displayOrder: projects.displayOrder }).from(projects).all()
  return rows.reduce((acc, row) => Math.max(acc, row.displayOrder), 0) + 1
}

function listFieldValues(db: AppDatabase, projectId: number): Record<number, string> {
  const rows = db
    .select()
    .from(projectFieldValues)
    .where(eq(projectFieldValues.projectId, projectId))
    .all()
  const values: Record<number, string> = {}
  rows.forEach((row) => {
    values[row.fieldId] = row.value
  })
  return values
}

function toSummary(db: AppDatabase, row: typeof projects.$inferSelect): ProjectSummary {
  return {
    id: row.id,
    managementNo: row.managementNo,
    projectDate: row.projectDate,
    name: row.name,
    builderName: row.builderName,
    designerName: row.designerName,
    note: row.note ?? '',
    displayOrder: row.displayOrder,
    fieldValues: listFieldValues(db, row.id)
  }
}

export function listProjectFields(db: AppDatabase): ProjectField[] {
  return db
    .select()
    .from(mProjectFields)
    .orderBy(asc(mProjectFields.displayOrder), asc(mProjectFields.id))
    .all()
}

/** 物件管理台帳（全プロジェクトのハブ）。並びは台帳で指定した順序 */
export function listProjectLedger(db: AppDatabase): ProjectLedger {
  const rows = db
    .select()
    .from(projects)
    .orderBy(asc(projects.displayOrder), asc(projects.id))
    .all()
  return { projects: rows.map((row) => toSummary(db, row)), fields: listProjectFields(db) }
}

export function getProject(db: AppDatabase, id: number): ProjectSummary {
  const row = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!row) throw new Error(`物件が見つかりません (id=${id})`)
  return toSummary(db, row)
}

export function createProject(db: AppDatabase, name: string): ProjectSummary {
  const id = Number(
    db
      .insert(projects)
      .values({
        managementNo: nextManagementNo(db),
        projectDate: today(),
        name,
        displayOrder: nextDisplayOrder(db)
      })
      .run().lastInsertRowid
  )
  return getProject(db, id)
}

/** 軸組計算書に置いた部屋の参照（部位別入力表の行ID）をコピー先の行に付け替える */
function remapLayout(layoutJson: string, rowIdMap: Map<number, number>): string {
  try {
    const placements: unknown = JSON.parse(layoutJson)
    if (!Array.isArray(placements)) return layoutJson
    const mapped = placements.map((placement: { estimateRowId?: number }) => {
      const copiedRowId =
        placement.estimateRowId === undefined
          ? undefined
          : rowIdMap.get(placement.estimateRowId)
      return copiedRowId === undefined ? placement : { ...placement, estimateRowId: copiedRowId }
    })
    return JSON.stringify(mapped)
  } catch {
    return layoutJson
  }
}

/**
 * 既存物件をコピーして新規作成する。
 * 物件専用マスター（物件セット）と入力データも複製し、コピー元とは完全に切り離す。
 */
export function copyProject(db: AppDatabase, sourceId: number, name: string): ProjectSummary {
  return db.transaction((tx) => {
    const source = tx.select().from(projects).where(eq(projects.id, sourceId)).get()
    if (!source) throw new Error(`コピー元の物件が見つかりません (id=${sourceId})`)

    const newId = Number(
      tx
        .insert(projects)
        .values({
          managementNo: nextManagementNo(db),
          projectDate: today(),
          name,
          builderName: source.builderName,
          designerName: source.designerName,
          clientName: source.clientName,
          location: source.location,
          totalArea: source.totalArea,
          note: source.note,
          displayOrder: nextDisplayOrder(db),
          sourceProjectId: sourceId
        })
        .run().lastInsertRowid
    )

    tx.select()
      .from(projectFieldValues)
      .where(eq(projectFieldValues.projectId, sourceId))
      .all()
      .forEach((row) => {
        tx.insert(projectFieldValues)
          .values({ projectId: newId, fieldId: row.fieldId, value: row.value })
          .run()
      })

    tx.select()
      .from(projectFittings)
      .where(eq(projectFittings.projectId, sourceId))
      .all()
      .forEach(({ id: _id, projectId: _projectId, ...rest }) => {
        tx.insert(projectFittings)
          .values({ ...rest, projectId: newId })
          .run()
      })

    // 部位別入力表と、その行にぶら下がる部屋計算書（部屋形状）を一緒に複製する
    const estimateRowIdMap = new Map<number, number>()
    tx.select()
      .from(projectEstimateRows)
      .where(eq(projectEstimateRows.projectId, sourceId))
      .all()
      .forEach(({ id: oldId, projectId: _projectId, ...rest }) => {
        const copied = tx
          .insert(projectEstimateRows)
          .values({ ...rest, projectId: newId })
          .returning({ id: projectEstimateRows.id })
          .get()
        estimateRowIdMap.set(oldId, copied.id)
      })

    tx.select()
      .from(projectRoomSheets)
      .where(eq(projectRoomSheets.projectId, sourceId))
      .all()
      .forEach(({ id: _id, projectId: _projectId, estimateRowId, ...rest }) => {
        const copiedRowId = estimateRowIdMap.get(estimateRowId)
        if (copiedRowId === undefined) return
        tx.insert(projectRoomSheets)
          .values({ ...rest, projectId: newId, estimateRowId: copiedRowId })
          .run()
      })

    // 軸組計算書も一緒に複製する。置いた部屋の参照はコピー先の行に付け替える
    tx.select()
      .from(projectFrameSheets)
      .where(eq(projectFrameSheets.projectId, sourceId))
      .all()
      .forEach(({ id: _id, projectId: _projectId, estimateRowId, ...rest }) => {
        const copiedRowId = estimateRowIdMap.get(estimateRowId)
        if (copiedRowId === undefined) return
        tx.insert(projectFrameSheets)
          .values({
            ...rest,
            layoutJson: remapLayout(rest.layoutJson, estimateRowIdMap),
            projectId: newId,
            estimateRowId: copiedRowId
          })
          .run()
      })

    // 物件専用セットは物件ごとに独立させる。コピー先の入力データは新しいセットを参照する
    const assemblyIdMap = new Map<number, number>()
    tx.select()
      .from(mFinishAssemblies)
      .where(eq(mFinishAssemblies.projectId, sourceId))
      .all()
      .forEach(({ id: oldId, projectId: _projectId, ...rest }) => {
        const copiedId = Number(
          tx
            .insert(mFinishAssemblies)
            .values({ ...rest, projectId: newId, sourceAssemblyId: oldId })
            .run().lastInsertRowid
        )
        assemblyIdMap.set(oldId, copiedId)
        tx.select()
          .from(mFinishAssemblyItems)
          .where(eq(mFinishAssemblyItems.assemblyId, oldId))
          .all()
          .forEach(({ id: _itemId, assemblyId: _assemblyId, ...item }) => {
            tx.insert(mFinishAssemblyItems)
              .values({ ...item, assemblyId: copiedId })
              .run()
          })
      })

    tx.select()
      .from(projectRoomFinishes)
      .where(eq(projectRoomFinishes.projectId, sourceId))
      .all()
      .forEach(({ id: _id, projectId: _projectId, finishAssemblyId, ...rest }) => {
        tx.insert(projectRoomFinishes)
          .values({
            ...rest,
            projectId: newId,
            finishAssemblyId:
              finishAssemblyId === null
                ? null
                : (assemblyIdMap.get(finishAssemblyId) ?? finishAssemblyId)
          })
          .run()
      })

    tx.select()
      .from(calcSheetEntries)
      .where(eq(calcSheetEntries.projectId, sourceId))
      .all()
      .forEach(({ id: _id, projectId: _projectId, ...rest }) => {
        tx.insert(calcSheetEntries)
          .values({ ...rest, projectId: newId })
          .run()
      })

    return getProject(db, newId)
  })
}

/** 管理番号以外を更新する。台帳・工事概要のどちらから修正しても同じレコードを更新する */
export function saveProject(db: AppDatabase, request: SaveProjectRequest): ProjectSummary {
  return db.transaction((tx) => {
    tx.update(projects)
      .set({
        projectDate: request.projectDate,
        name: request.name,
        builderName: request.builderName,
        designerName: request.designerName,
        note: request.note,
        updatedAt: new Date().toISOString()
      })
      .where(eq(projects.id, request.id))
      .run()

    const fieldIds = new Set(listProjectFields(tx as AppDatabase).map((field) => field.id))
    Object.entries(request.fieldValues).forEach(([key, value]) => {
      const fieldId = Number(key)
      if (!fieldIds.has(fieldId)) return
      tx.insert(projectFieldValues)
        .values({ projectId: request.id, fieldId, value })
        .onConflictDoUpdate({
          target: [projectFieldValues.projectId, projectFieldValues.fieldId],
          set: { value }
        })
        .run()
    })

    return getProject(db, request.id)
  })
}

/** 作成順と関係なく、台帳で指定した順序へ並べ替える */
export function reorderProjects(db: AppDatabase, orderedIds: number[]): ProjectSummary[] {
  db.transaction((tx) => {
    orderedIds.forEach((id, index) => {
      tx.update(projects)
        .set({ displayOrder: index + 1 })
        .where(eq(projects.id, id))
        .run()
    })
  })
  return listProjectLedger(db).projects
}

/** ユーザー定義列を保存する（画面表示の桁数制限のみを持つ。入力値は制限しない） */
export function saveProjectFields(db: AppDatabase, fields: ProjectField[]): ProjectField[] {
  db.transaction((tx) => {
    const keptIds = fields.filter((field) => field.id > 0).map((field) => field.id)
    tx.select()
      .from(mProjectFields)
      .all()
      .forEach((row) => {
        if (!keptIds.includes(row.id)) {
          tx.delete(mProjectFields).where(eq(mProjectFields.id, row.id)).run()
        }
      })

    fields.forEach((field, index) => {
      const values = {
        title: field.title,
        displayWidth: field.displayWidth,
        displayOrder: index + 1
      }
      if (field.id > 0) {
        tx.update(mProjectFields).set(values).where(eq(mProjectFields.id, field.id)).run()
      } else {
        tx.insert(mProjectFields).values(values).run()
      }
    })
  })
  return listProjectFields(db)
}

/** 台帳の件数（画面のフッター表示・検証用） */
export function countProjects(db: AppDatabase): number {
  const row = db.select({ count: sql<number>`count(*)` }).from(projects).get()
  return row?.count ?? 0
}
