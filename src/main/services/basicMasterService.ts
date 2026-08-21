import { asc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import {
  mAggregationParts,
  mFormworkCategories,
  mMaterialCategories,
  mPickupParts,
  mUnits
} from '../db/schema'
import type { BasicMasterKind, BasicMasterRow } from '../../core/masters/basicMaster'
import { dropBlankBasicMasterRows, validateBasicMaster } from '../../core/masters/basicMaster'
import type { BasicMasters, SaveBasicMasterResult } from '../../shared/types'

export function listBasicMasters(db: AppDatabase): BasicMasters {
  return {
    pickupParts: db
      .select({ id: mPickupParts.id, name: mPickupParts.name, note: mPickupParts.note })
      .from(mPickupParts)
      .orderBy(asc(mPickupParts.id))
      .all(),
    materialCategories: db
      .select({ id: mMaterialCategories.id, name: mMaterialCategories.name })
      .from(mMaterialCategories)
      .orderBy(asc(mMaterialCategories.id))
      .all()
      .map((row) => ({ ...row, note: '' })),
    units: db
      .select({ id: mUnits.id, name: mUnits.name })
      .from(mUnits)
      .orderBy(asc(mUnits.id))
      .all()
      .map((row) => ({ ...row, note: '' })),
    aggregationParts: db
      .select({ id: mAggregationParts.id, name: mAggregationParts.name })
      .from(mAggregationParts)
      .orderBy(asc(mAggregationParts.id))
      .all()
      .map((row) => ({ ...row, note: '' })),
    formworkCategories: db
      .select({ id: mFormworkCategories.id, name: mFormworkCategories.name })
      .from(mFormworkCategories)
      .orderBy(asc(mFormworkCategories.id))
      .all()
      .map((row) => ({ ...row, note: '' }))
  }
}

/**
 * 1種類分の一括保存。番号は人が決めた値をそのまま主キーとして保持し、
 * 画面から消えた番号は削除、残った番号は名称を更新する。
 */
export function saveBasicMaster(
  db: AppDatabase,
  kind: BasicMasterKind,
  rows: BasicMasterRow[]
): SaveBasicMasterResult {
  const errors = validateBasicMaster(kind, rows)
  if (errors.length > 0) return { masters: listBasicMasters(db), errors }

  const trimmed = dropBlankBasicMasterRows(rows).map((row) => ({
    id: row.id,
    name: row.name.trim(),
    note: row.note
  }))
  const keptIds = new Set(trimmed.map((row) => row.id))

  db.transaction((tx) => {
    if (kind === 'pickupParts') {
      tx.select({ id: mPickupParts.id })
        .from(mPickupParts)
        .all()
        .filter((row) => !keptIds.has(row.id))
        .forEach((row) => tx.delete(mPickupParts).where(eq(mPickupParts.id, row.id)).run())
      trimmed.forEach((row, index) => {
        tx.insert(mPickupParts)
          .values({ id: row.id, name: row.name, note: row.note, displayOrder: index })
          .onConflictDoUpdate({
            target: mPickupParts.id,
            set: { name: row.name, note: row.note, displayOrder: index }
          })
          .run()
      })
      return
    }
    if (kind === 'materialCategories') {
      tx.select({ id: mMaterialCategories.id })
        .from(mMaterialCategories)
        .all()
        .filter((row) => !keptIds.has(row.id))
        .forEach((row) =>
          tx.delete(mMaterialCategories).where(eq(mMaterialCategories.id, row.id)).run()
        )
      trimmed.forEach((row, index) => {
        tx.insert(mMaterialCategories)
          .values({ id: row.id, code: String(row.id), name: row.name, displayOrder: index })
          .onConflictDoUpdate({
            target: mMaterialCategories.id,
            set: { code: String(row.id), name: row.name, displayOrder: index }
          })
          .run()
      })
      return
    }
    if (kind === 'units') {
      tx.select({ id: mUnits.id })
        .from(mUnits)
        .all()
        .filter((row) => !keptIds.has(row.id))
        .forEach((row) => tx.delete(mUnits).where(eq(mUnits.id, row.id)).run())
      trimmed.forEach((row, index) => {
        tx.insert(mUnits)
          .values({ id: row.id, name: row.name, displayOrder: index })
          .onConflictDoUpdate({
            target: mUnits.id,
            set: { name: row.name, displayOrder: index }
          })
          .run()
      })
      return
    }
    if (kind === 'aggregationParts') {
      tx.select({ id: mAggregationParts.id })
        .from(mAggregationParts)
        .all()
        .filter((row) => !keptIds.has(row.id))
        .forEach((row) =>
          tx.delete(mAggregationParts).where(eq(mAggregationParts.id, row.id)).run()
        )
      trimmed.forEach((row, index) => {
        tx.insert(mAggregationParts)
          .values({ id: row.id, name: row.name, displayOrder: index })
          .onConflictDoUpdate({
            target: mAggregationParts.id,
            set: { name: row.name, displayOrder: index }
          })
          .run()
      })
      return
    }
    tx.select({ id: mFormworkCategories.id })
      .from(mFormworkCategories)
      .all()
      .filter((row) => !keptIds.has(row.id))
      .forEach((row) =>
        tx.delete(mFormworkCategories).where(eq(mFormworkCategories.id, row.id)).run()
      )
    trimmed.forEach((row, index) => {
      tx.insert(mFormworkCategories)
        .values({ id: row.id, name: row.name, displayOrder: index })
        .onConflictDoUpdate({
          target: mFormworkCategories.id,
          set: { name: row.name, displayOrder: index }
        })
        .run()
    })
  })

  return { masters: listBasicMasters(db), errors: [] }
}
