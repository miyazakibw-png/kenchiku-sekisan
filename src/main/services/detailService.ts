import { asc, eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { mDetails, mMaterialCategories, mSubjects, mUnits } from '../db/schema'
import type { Detail, MasterOptions, SaveDetailsRequest } from '../../shared/types'

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
        detailNumber: row.detailNumber,
        materialCategoryId: row.materialCategoryId,
        name: row.name,
        description: row.description,
        unit: row.unit,
        remarks: row.remarks,
        isActive: row.isActive,
        displayOrder: index
      }
      if (row.id === null) {
        tx.insert(mDetails).values(values).run()
      } else {
        tx.update(mDetails)
          .set({ ...values, updatedAt: new Date().toISOString() })
          .where(eq(mDetails.id, row.id))
          .run()
      }
    })
  })
  return listDetails(db, subjectId)
}
