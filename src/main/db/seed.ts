import type { AppDatabase } from './index'
import {
  calcSheetDefinitions,
  mMaterialCategories,
  mParts,
  mSubjects,
  mUnits
} from './schema'

const SUBJECTS = [
  { code: '01', name: '仮設工事' },
  { code: '02', name: '土工事' },
  { code: '03', name: '地業工事' },
  { code: '04', name: '鉄筋工事' },
  { code: '05', name: 'コンクリート工事' },
  { code: '06', name: '型枠工事' },
  { code: '07', name: '鉄骨工事' },
  { code: '08', name: '組積・ALC工事' },
  { code: '09', name: '防水工事' },
  { code: '10', name: '石工事' },
  { code: '11', name: 'タイル工事' },
  { code: '12', name: '木工事' },
  { code: '13', name: '屋根・板金工事' },
  { code: '14', name: '金属工事' },
  { code: '15', name: '左官工事' },
  { code: '16', name: '建具工事' },
  { code: '17', name: '塗装工事' },
  { code: '18', name: '内外装工事' },
  { code: '19', name: '雑工事' }
]

const PARTS = [
  { code: 'EXT', name: '外部' },
  { code: 'INT', name: '内部' },
  { code: 'FLR', name: '床' },
  { code: 'WAL', name: '壁' },
  { code: 'CEL', name: '天井' },
  { code: 'BSE', name: '巾木' },
  { code: 'ROF', name: '屋根' },
  { code: 'OTH', name: 'その他' }
]

const MATERIAL_CATEGORIES = [
  { code: 'F', name: '仕上' },
  { code: 'B1', name: '下地1' },
  { code: 'B2', name: '下地2' },
  { code: 'R', name: '補強' },
  { code: 'O', name: 'その他' }
]

const UNITS = ['㎡', 'm', 'm3', '箇所', '本', '枚', '個', '式', 'kg', 't', '人工']

const CALC_SHEETS = [
  { key: 'room', name: '部屋別拾い' },
  { key: 'frame', name: '軸組拾い' },
  { key: 'simple', name: '簡易拾い' }
]

/** 初回起動時のみ基礎マスターを投入する（既存データがある場合は何もしない） */
export function seedInitialData(db: AppDatabase): void {
  if (db.select().from(mSubjects).limit(1).all().length === 0) {
    db.insert(mSubjects)
      .values(SUBJECTS.map((s, i) => ({ ...s, displayOrder: i })))
      .run()
  }
  if (db.select().from(mParts).limit(1).all().length === 0) {
    db.insert(mParts)
      .values(PARTS.map((p, i) => ({ ...p, displayOrder: i })))
      .run()
  }
  if (db.select().from(mMaterialCategories).limit(1).all().length === 0) {
    db.insert(mMaterialCategories)
      .values(MATERIAL_CATEGORIES.map((c, i) => ({ ...c, displayOrder: i })))
      .run()
  }
  if (db.select().from(mUnits).limit(1).all().length === 0) {
    db.insert(mUnits)
      .values(UNITS.map((name, i) => ({ name, displayOrder: i })))
      .run()
  }
  if (db.select().from(calcSheetDefinitions).limit(1).all().length === 0) {
    db.insert(calcSheetDefinitions)
      .values(CALC_SHEETS.map((s, i) => ({ ...s, isBuiltin: true, displayOrder: i })))
      .run()
  }
}
