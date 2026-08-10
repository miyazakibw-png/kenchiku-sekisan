import { asc, eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { mDetails, mMaterialCategories, mSubjects, mUnits } from '../db/schema'
import type { Detail, MasterOptions, SaveDetailsRequest } from '../../shared/types'
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
    units: db.select().from(mUnits).orderBy(asc(mUnits.displayOrder)).all()
  }
}

export function listDetails(db: AppDatabase, subjectId: number): Detail[] {
  return db
    .select()
    .from(mDetails)
    .where(eq(mDetails.subjectId, subjectId))
    .orderBy(asc(mDetails.displayOrder), asc(mDetails.id))
    .all()
}

/**
 * 明細マスター画面の一括保存。
 * 画面の行順をそのまま display_order として採番し、削除行を物理削除する。
 * Undoで復活した行（IDを持つが既にDBに無い行）は同じIDで再作成する。
 */
export function saveDetails(db: AppDatabase, request: SaveDetailsRequest): Detail[] {
  const { subjectId, rows, deletedIds } = request
  db.transaction((tx) => {
    if (deletedIds.length > 0) {
      tx.delete(mDetails).where(inArray(mDetails.id, deletedIds)).run()
    }
    rows.forEach((row, index) => {
      const values = {
        subjectId,
        detailNumber: normalizeDetailNumber(row.detailNumber),
        materialCategoryId: row.materialCategoryId,
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
  return listDetails(db, subjectId)
}
