import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

/** 物件（プロジェクト）基本情報 */
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code'),
  name: text('name').notNull(),
  clientName: text('client_name'),
  location: text('location'),
  /** 延べ床面積（㎡）。歩掛・比率計算のベース値 */
  totalArea: real('total_area'),
  note: text('note'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now)
})

/** 科目マスター */
export const mSubjects = sqliteTable('m_subjects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull().default(0)
})

/** 部位マスター */
export const mParts = sqliteTable('m_parts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  parentId: integer('parent_id'),
  displayOrder: integer('display_order').notNull().default(0)
})

/** 材種区分マスター */
export const mMaterialCategories = sqliteTable('m_material_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull().default(0)
})

/** 単位マスター */
export const mUnits = sqliteTable('m_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  displayOrder: integer('display_order').notNull().default(0)
})

/**
 * 明細マスター。
 * Excelの「名称・摘要・備考（上段/下段）」は name/description/remarks に統合し、
 * 改行や上下段分割は帳票フォーマッター側で制御する。
 */
export const mDetails = sqliteTable(
  'm_details',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    subjectId: integer('subject_id')
      .notNull()
      .references(() => mSubjects.id, { onDelete: 'cascade' }),
    detailNumber: text('detail_number'),
    materialCategoryId: integer('material_category_id').references(() => mMaterialCategories.id, {
      onDelete: 'set null'
    }),
    name: text('name').notNull().default(''),
    description: text('description').notNull().default(''),
    unit: text('unit').notNull().default(''),
    remarks: text('remarks').notNull().default(''),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  },
  (t) => ({
    subjectOrderIdx: index('idx_m_details_subject_order').on(t.subjectId, t.displayOrder),
    detailNumberIdx: index('idx_m_details_number').on(t.detailNumber)
  })
)

/** 仕上明細（セット）管理ユニット。assembly_name は重複を許容する */
export const mFinishAssemblies = sqliteTable(
  'm_finish_assemblies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assemblyCode: text('assembly_code'),
    assemblyName: text('assembly_name').notNull(),
    partId: integer('part_id').references(() => mParts.id, { onDelete: 'set null' }),
    /** 外部/内部などの用途区分 */
    usageCategory: text('usage_category'),
    note: text('note').notNull().default(''),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  },
  (t) => ({
    partIdx: index('idx_m_finish_assemblies_part').on(t.partId, t.displayOrder)
  })
)

/** 仕上明細セットの構成アイテム（仕上/下地1/下地2/補強 …） */
export const mFinishAssemblyItems = sqliteTable(
  'm_finish_assembly_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assemblyId: integer('assembly_id')
      .notNull()
      .references(() => mFinishAssemblies.id, { onDelete: 'cascade' }),
    detailId: integer('detail_id')
      .notNull()
      .references(() => mDetails.id, { onDelete: 'restrict' }),
    /** 構成上の役割: finish / base1 / base2 / reinforce / other */
    role: text('role').notNull().default('finish'),
    /** 親数量(P)を用いた展開計算式。空なら親数量をそのまま継承 */
    formula: text('formula').notNull().default(''),
    coefficient: real('coefficient').notNull().default(1),
    displayOrder: integer('display_order').notNull().default(0)
  },
  (t) => ({
    assemblyOrderIdx: index('idx_m_fa_items_assembly_order').on(t.assemblyId, t.displayOrder)
  })
)

/** 建具・控除情報（プロジェクト固有） */
export const projectFittings = sqliteTable(
  'project_fittings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 建具記号（予約語・重複禁止） */
    symbol: text('symbol').notNull(),
    name: text('name').notNull().default(''),
    width: real('width'),
    height: real('height'),
    quantity: real('quantity').notNull().default(1),
    /** 自動計算(W×H)の手動補正値。設定時はこちらを優先 */
    areaOverride: real('area_override'),
    /** 巾木減(W)の手動補正値 */
    baseboardDeductionOverride: real('baseboard_deduction_override'),
    /** 軸組計算用「横補強」等の派生パラメーター */
    reinforcementWidth: real('reinforcement_width'),
    note: text('note').notNull().default(''),
    displayOrder: integer('display_order').notNull().default(0)
  },
  (t) => ({
    symbolUq: uniqueIndex('uq_project_fittings_symbol').on(t.projectId, t.symbol)
  })
)

/** 部位別入力（部屋別仕上） */
export const projectRoomFinishes = sqliteTable(
  'project_room_finishes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    roomNumber: text('room_number').notNull().default(''),
    roomName: text('room_name').notNull().default(''),
    partId: integer('part_id').references(() => mParts.id, { onDelete: 'set null' }),
    finishAssemblyId: integer('finish_assembly_id').references(() => mFinishAssemblies.id, {
      onDelete: 'set null'
    }),
    formula: text('formula').notNull().default(''),
    quantity: real('quantity'),
    unit: text('unit').notNull().default(''),
    note: text('note').notNull().default(''),
    displayOrder: integer('display_order').notNull().default(0)
  },
  (t) => ({
    projectRoomIdx: index('idx_prf_project_room').on(t.projectId, t.roomNumber)
  })
)

/**
 * 動的計算書スキーマ。
 * 計算書（シート）のUIレイアウトと計算式定義をJSONで保持し、
 * コア改修なしに新しい計算書を追加できるようにする。
 */
export const calcSheetDefinitions = sqliteTable('calc_sheet_definitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  layoutJson: text('layout_json').notNull().default('{}'),
  formulaJson: text('formula_json').notNull().default('{}'),
  version: integer('version').notNull().default(1),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  displayOrder: integer('display_order').notNull().default(0)
})

/** 計算書のデータ行（定義に従う可変スキーマ） */
export const calcSheetEntries = sqliteTable(
  'calc_sheet_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    definitionId: integer('definition_id')
      .notNull()
      .references(() => calcSheetDefinitions.id, { onDelete: 'cascade' }),
    dataJson: text('data_json').notNull().default('{}'),
    displayOrder: integer('display_order').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(now)
  },
  (t) => ({
    projectDefIdx: index('idx_cse_project_def').on(t.projectId, t.definitionId, t.displayOrder)
  })
)

/** アプリ設定（内訳書フォーマット設定・テーマ等） */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull().default('{}')
})

export type MDetail = typeof mDetails.$inferSelect
export type MDetailInsert = typeof mDetails.$inferInsert
export type MSubject = typeof mSubjects.$inferSelect
