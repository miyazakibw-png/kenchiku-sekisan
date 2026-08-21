import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import {
  calcSheetDefinitions,
  mDetails,
  mFormworkCategories,
  mMaterialCategories,
  mPickupParts,
  mSubjects,
  mUnits
} from '../db/schema'
import type {
  Detail,
  MasterOptions,
  SaveDetailsRequest,
  SyncDetailsResult
} from '../../shared/types'
import { DETAIL_NUMBER_DECIMALS } from '../../shared/detailNumber'

/** 明細番号は小数2桁に丸めて保持する */
function normalizeDetailNumber(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) return null
  return Number(value.toFixed(DETAIL_NUMBER_DECIMALS))
}

export function listMasterOptions(db: AppDatabase): MasterOptions {
  return {
    subjects: db.select().from(mSubjects).orderBy(asc(mSubjects.displayOrder)).all(),
    materialCategories: db
      .select()
      .from(mMaterialCategories)
      .orderBy(asc(mMaterialCategories.displayOrder))
      .all(),
    units: db.select().from(mUnits).orderBy(asc(mUnits.displayOrder)).all(),
    formworkCategories: db
      .select({ id: mFormworkCategories.id, name: mFormworkCategories.name })
      .from(mFormworkCategories)
      .orderBy(asc(mFormworkCategories.displayOrder))
      .all(),
    pickupParts: db
      .select({ id: mPickupParts.id, name: mPickupParts.name })
      .from(mPickupParts)
      .orderBy(asc(mPickupParts.displayOrder), asc(mPickupParts.id))
      .all(),
    calcSheets: db
      .select({
        id: calcSheetDefinitions.id,
        key: calcSheetDefinitions.key,
        name: calcSheetDefinitions.name
      })
      .from(calcSheetDefinitions)
      .orderBy(asc(calcSheetDefinitions.displayOrder))
      .all()
  }
}

/** 物件専用（工事マスター）は projectId を渡す。基本マスターは null */
function scopeCondition(projectId: number | null) {
  return projectId === null
    ? and(eq(mDetails.scope, 'basic'), isNull(mDetails.projectId))
    : and(eq(mDetails.scope, 'project'), eq(mDetails.projectId, projectId))
}

export function listDetails(
  db: AppDatabase,
  subjectId: number,
  projectId: number | null = null
): Detail[] {
  return db
    .select()
    .from(mDetails)
    .where(and(eq(mDetails.subjectId, subjectId), scopeCondition(projectId)))
    .orderBy(asc(mDetails.displayOrder), asc(mDetails.id))
    .all()
}

/**
 * 工事を作ったときに基本マスターの明細を物件専用へ複製する。
 * 物件側で自由に直せるようにコピーし、複製元IDだけ残して大元への同期に使う。
 */
export function copyBasicDetailsToProject(db: AppDatabase, projectId: number): number {
  const source = db
    .select()
    .from(mDetails)
    .where(scopeCondition(null))
    .orderBy(asc(mDetails.subjectId), asc(mDetails.displayOrder), asc(mDetails.id))
    .all()
  if (source.length === 0) return 0
  db.transaction((tx) => {
    source.forEach((row) => {
      tx.insert(mDetails)
        .values({
          subjectId: row.subjectId,
          detailNumber: row.detailNumber,
          materialCategory: row.materialCategory,
          partName: row.partName,
          name: row.name,
          descriptionUpper: row.descriptionUpper,
          descriptionLower: row.descriptionLower,
          unit: row.unit,
          remarksUpper: row.remarksUpper,
          remarksLower: row.remarksLower,
          estimateDisplay: row.estimateDisplay,
          displayOrder: row.displayOrder,
          isActive: row.isActive,
          scope: 'project',
          projectId,
          sourceDetailId: row.id
        })
        .run()
    })
  })
  return source.length
}

/**
 * 物件専用マスターで直した明細を大元（基本マスター）へ反映する。
 * 複製元がある行は上書き、物件で新しく作った行は基本マスターの末尾へ追加する。
 */
export function syncProjectDetailsToBasic(
  db: AppDatabase,
  projectId: number,
  subjectId: number
): SyncDetailsResult {
  const rows = listDetails(db, subjectId, projectId)
  let updated = 0
  let added = 0
  db.transaction((tx) => {
    const basic = tx.select().from(mDetails).where(scopeCondition(null)).all()
    const basicById = new Map(basic.map((row) => [row.id, row]))
    let nextOrder =
      basic
        .filter((row) => row.subjectId === subjectId)
        .reduce((max, row) => Math.max(max, row.displayOrder), -1) + 1
    rows.forEach((row) => {
      const values = {
        subjectId,
        detailNumber: row.detailNumber,
        materialCategory: row.materialCategory,
        partName: row.partName,
        name: row.name,
        descriptionUpper: row.descriptionUpper,
        descriptionLower: row.descriptionLower,
        unit: row.unit,
        remarksUpper: row.remarksUpper,
        remarksLower: row.remarksLower,
        estimateDisplay: row.estimateDisplay,
        isActive: row.isActive,
        updatedAt: new Date().toISOString()
      }
      if (row.sourceDetailId !== null && basicById.has(row.sourceDetailId)) {
        tx.update(mDetails).set(values).where(eq(mDetails.id, row.sourceDetailId)).run()
        updated += 1
        return
      }
      const createdId = Number(
        tx
          .insert(mDetails)
          .values({ ...values, displayOrder: nextOrder, scope: 'basic', projectId: null })
          .run().lastInsertRowid
      )
      nextOrder += 1
      tx.update(mDetails)
        .set({ sourceDetailId: createdId })
        .where(eq(mDetails.id, row.id))
        .run()
      added += 1
    })
  })
  return { updated, added }
}

/**
 * 明細マスター画面の一括保存。
 * 画面の行順をそのまま display_order として採番し、削除行を物理削除する。
 * Undoで復活した行（IDを持つが既にDBに無い行）は同じIDで再作成する。
 */
export function saveDetails(db: AppDatabase, request: SaveDetailsRequest): Detail[] {
  const { subjectId, rows, deletedIds } = request
  const projectId = request.projectId ?? null
  db.transaction((tx) => {
    if (deletedIds.length > 0) {
      tx.delete(mDetails).where(inArray(mDetails.id, deletedIds)).run()
    }
    rows.forEach((row, index) => {
      const values = {
        subjectId,
        scope: projectId === null ? 'basic' : 'project',
        projectId,
        detailNumber: normalizeDetailNumber(row.detailNumber),
        materialCategory: row.materialCategory,
        partName: row.partName,
        name: row.name,
        descriptionUpper: row.descriptionUpper,
        descriptionLower: row.descriptionLower,
        unit: row.unit,
        remarksUpper: row.remarksUpper,
        remarksLower: row.remarksLower,
        estimateDisplay: row.estimateDisplay,
        isActive: row.isActive,
        displayOrder: index
      }
      if (row.id === null) {
        tx.insert(mDetails).values(values).run()
        return
      }
      const updated = tx
        .update(mDetails)
        .set({ ...values, updatedAt: new Date().toISOString() })
        .where(eq(mDetails.id, row.id))
        .run()
      if (updated.changes === 0) {
        tx.insert(mDetails)
          .values({ ...values, id: row.id })
          .run()
      }
    })
  })
  return listDetails(db, subjectId, projectId)
}
