import type { AppDatabase } from './index'
import {
  calcSheetDefinitions,
  mAggregationCategories,
  mAggregationParts,
  mFormworkCategories,
  mMaterialCategories,
  mPartBracketFormats,
  mParts,
  mPickupParts,
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
  { id: 1, code: '1', name: '仕上' },
  { id: 2, code: '2', name: '軸組' }
]

/** 単位はIDに欠番があるため明示的に採番する */
const UNITS = [
  { id: 1, name: 'm' },
  { id: 2, name: 'm2' },
  { id: 3, name: 'm3' },
  { id: 4, name: 'ヶ所' },
  { id: 5, name: '枚' },
  { id: 7, name: 'kg' },
  { id: 9, name: '式' }
]

const AGGREGATION_CATEGORIES = [{ id: 2, name: '部位Ⅱ科目内区分' }]

const FORMWORK_CATEGORIES = [
  { id: 1, name: '基礎階' },
  { id: 2, name: '地下階' },
  { id: 3, name: '地上階' }
]

/** 入力拾い用の部位（Excel「部位ID/部位名」より） */
const PICKUP_PARTS = [
  { id: 10, name: '床' },
  { id: 11, name: '室名床' },
  { id: 12, name: '床段差小口' },
  { id: 13, name: '階段踏面' },
  { id: 14, name: '階段踊り場' },
  { id: 15, name: '階段蹴込み' },
  { id: 16, name: '浮き床' },
  { id: 17, name: '浮き床壁際' },
  { id: 20, name: '巾木' },
  { id: 21, name: '室名巾木' },
  { id: 22, name: 'サッシ巾木' },
  { id: 23, name: 'イナズマ巾木' },
  { id: 24, name: 'たたみ寄せ' },
  { id: 25, name: '雑巾摺' },
  { id: 30, name: '壁' },
  { id: 31, name: '室名壁' },
  { id: 32, name: 'フカシ壁' },
  { id: 33, name: '下り壁' },
  { id: 34, name: 'ライニング壁' },
  { id: 37, name: '地中部二重壁' },
  { id: 38, name: '壁抜き（額縁）' },
  { id: 40, name: '柱型' },
  { id: 41, name: '室名柱型' },
  { id: 45, name: '柱型-壁隙間塞ぎ' },
  { id: 50, name: '梁型' },
  { id: 51, name: '室名梁天端' },
  { id: 52, name: '梁天端' },
  { id: 53, name: '梁側面' },
  { id: 54, name: '梁底' },
  { id: 56, name: '梁型-壁隙間塞ぎ' }
]

/** 集計部位（部位番号と視覚的判別用カラー） */
const AGGREGATION_PARTS = [
  { id: 1, name: '床', textColor: 'RGB(0, 51, 0)' },
  { id: 11, name: '床', textColor: 'RGB(51, 102, 102)' },
  { id: 2, name: '巾木', textColor: 'RGB(51, 51, 10)' },
  { id: 12, name: '巾木', textColor: 'RGB(30, 74, 120)' },
  { id: 4, name: '柱型', textColor: 'RGB(153, 51, 0)' },
  { id: 14, name: '柱型', textColor: 'RGB(255, 102, 0)' },
  { id: 3, name: '壁', textColor: 'RGB(122, 0, 122)' },
  { id: 13, name: '壁', textColor: 'RGB(70, 0, 60)' },
  { id: 5, name: '梁型', textColor: 'RGB(31, 73, 125)' },
  { id: 15, name: '梁型', textColor: 'RGB(112, 48, 160)' },
  { id: 6, name: '天井', textColor: 'RGB(0, 102, 0)' },
  { id: 16, name: '天井', textColor: 'RGB(20, 60, 0)' },
  { id: 7, name: '廻り縁', textColor: 'RGB(0, 112, 192)' },
  { id: 17, name: '廻り縁', textColor: 'RGB(0, 51, 102)' },
  { id: 8, name: 'その他', textColor: 'RGB(0, 32, 96)' },
  { id: 18, name: 'その他', textColor: 'RGB(0, 112, 192)' },
  { id: 9, name: 'その他', textColor: 'RGB(0, 176, 240)' },
  { id: 19, name: 'その他', textColor: 'RGB(255, 102, 10)' },
  { id: 10, name: '補強', textColor: 'RGB(65, 65, 65)' },
  { id: 20, name: '仕様', textColor: 'RGB(190, 190, 190)' }
]

/** 集計部位表示（階層ごとのカッコ書式） */
const PART_BRACKET_FORMATS = [
  { level: 1, leftBracket: '（', rightBracket: '）' },
  { level: 2, leftBracket: '＜', rightBracket: '＞' }
]

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
      .values(MATERIAL_CATEGORIES.map((c) => ({ ...c, displayOrder: c.id })))
      .run()
  }
  if (db.select().from(mUnits).limit(1).all().length === 0) {
    db.insert(mUnits)
      .values(UNITS.map((u) => ({ ...u, displayOrder: u.id })))
      .run()
  }
  if (db.select().from(mAggregationCategories).limit(1).all().length === 0) {
    db.insert(mAggregationCategories)
      .values(AGGREGATION_CATEGORIES.map((c) => ({ ...c, displayOrder: c.id })))
      .run()
  }
  if (db.select().from(mFormworkCategories).limit(1).all().length === 0) {
    db.insert(mFormworkCategories)
      .values(FORMWORK_CATEGORIES.map((c) => ({ ...c, displayOrder: c.id })))
      .run()
  }
  if (db.select().from(mPickupParts).limit(1).all().length === 0) {
    db.insert(mPickupParts)
      .values(PICKUP_PARTS.map((p) => ({ ...p, displayOrder: p.id })))
      .run()
  }
  if (db.select().from(mAggregationParts).limit(1).all().length === 0) {
    db.insert(mAggregationParts)
      .values(AGGREGATION_PARTS.map((p) => ({ ...p, displayOrder: p.id })))
      .run()
  }
  if (db.select().from(mPartBracketFormats).limit(1).all().length === 0) {
    db.insert(mPartBracketFormats).values(PART_BRACKET_FORMATS).run()
  }
  if (db.select().from(calcSheetDefinitions).limit(1).all().length === 0) {
    db.insert(calcSheetDefinitions)
      .values(CALC_SHEETS.map((s, i) => ({ ...s, isBuiltin: true, displayOrder: i })))
      .run()
  }
}
