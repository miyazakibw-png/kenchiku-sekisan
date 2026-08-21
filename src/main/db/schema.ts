import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/** 物件（プロジェクト）基本情報 */
export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code"),
    /** 管理番号（自動採番・変更不可） */
    managementNo: text("management_no").notNull().default(""),
    /** 台帳の日付（YYYY-MM-DD。作成日を初期値とし変更可） */
    projectDate: text("project_date").notNull().default(""),
    name: text("name").notNull(),
    /** 建設会社 */
    builderName: text("builder_name").notNull().default(""),
    /** 設計事務所 */
    designerName: text("designer_name").notNull().default(""),
    clientName: text("client_name"),
    location: text("location"),
    /** 延べ床面積（㎡）。歩掛・比率計算のベース値 */
    totalArea: real("total_area"),
    note: text("note"),
    /** 作成順とは無関係に台帳で並べ替えるための順序 */
    displayOrder: integer("display_order").notNull().default(0),
    /** コピー作成元の物件 */
    sourceProjectId: integer("source_project_id"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    managementNoUq: uniqueIndex("uq_projects_management_no").on(t.managementNo),
    displayOrderIdx: index("idx_projects_display_order").on(t.displayOrder),
  }),
);

/** 物件管理台帳のユーザー定義列 */
export const mProjectFields = sqliteTable("m_project_fields", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  /** 画面表示の桁数制限（半角換算。入力値自体は制限しない） */
  displayWidth: integer("display_width").notNull().default(30),
  displayOrder: integer("display_order").notNull().default(0),
});

/** ユーザー定義列の値 */
export const projectFieldValues = sqliteTable(
  "project_field_values",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fieldId: integer("field_id")
      .notNull()
      .references(() => mProjectFields.id, { onDelete: "cascade" }),
    value: text("value").notNull().default(""),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.fieldId] }),
  }),
);

/** 科目マスター */
export const mSubjects = sqliteTable("m_subjects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  /** 集計時に部位Ⅱの仕分けを行わない科目 */
  skipPart2: integer("skip_part2").notNull().default(0),
  /** 集計順 1:部位順 2:明細番号順 */
  aggregateOrder: integer("aggregate_order").notNull().default(1),
  note: text("note").notNull().default(""),
  spare1: text("spare1").notNull().default(""),
  spare2: text("spare2").notNull().default(""),
});

/** 部位マスター */
export const mParts = sqliteTable("m_parts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  displayOrder: integer("display_order").notNull().default(0),
});

/** 材種区分マスター */
export const mMaterialCategories = sqliteTable("m_material_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
});

/** 単位マスター */
export const mUnits = sqliteTable("m_units", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayOrder: integer("display_order").notNull().default(0),
});

/**
 * 明細マスター。
 * 1明細は上下2段で構成する（Excel準拠）。
 * 上段: 部位名 / 摘要(上段) / 備考(上段)、下段: 名称 / 摘要(下段) / 備考(下段)。
 */
export const mDetails = sqliteTable(
  "m_details",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subjectId: integer("subject_id")
      .notNull()
      .references(() => mSubjects.id, { onDelete: "cascade" }),
    /** 明細番号（小数点以下2桁の数値。例: 302.00） */
    detailNumber: real("detail_number"),
    /** 材種区分（数量チェック用の区分。マスタ番号で入力補助するが自由入力も可） */
    materialCategory: text("material_category").notNull().default(""),
    /** 部位名（上段） */
    partName: text("part_name").notNull().default(""),
    /** 名称（下段） */
    name: text("name").notNull().default(""),
    descriptionUpper: text("description_upper").notNull().default(""),
    descriptionLower: text("description_lower").notNull().default(""),
    unit: text("unit").notNull().default(""),
    remarksUpper: text("remarks_upper").notNull().default(""),
    remarksLower: text("remarks_lower").notNull().default(""),
    /** 積算用表示 */
    estimateDisplay: text("estimate_display").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    subjectOrderIdx: index("idx_m_details_subject_order").on(
      t.subjectId,
      t.displayOrder,
    ),
    detailNumberIdx: index("idx_m_details_number").on(t.detailNumber),
  }),
);

/** 仕上明細（セット）管理ユニット。assembly_name は重複を許容する */
export const mFinishAssemblies = sqliteTable(
  "m_finish_assemblies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assemblyCode: text("assembly_code"),
    assemblyName: text("assembly_name").notNull(),
    partId: integer("part_id").references(() => mParts.id, {
      onDelete: "set null",
    }),
    /** 外部/内部などの用途区分 */
    usageCategory: text("usage_category"),
    /** basic: 全物件共通の基本セット / project: 物件固有セット */
    scope: text("scope").notNull().default("basic"),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    sourceAssemblyId: integer("source_assembly_id"),
    note: text("note").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    partIdx: index("idx_m_finish_assemblies_part").on(t.partId, t.displayOrder),
    scopeIdx: index("idx_m_finish_assemblies_scope").on(
      t.scope,
      t.projectId,
      t.displayOrder,
    ),
  }),
);

/**
 * 仕上明細セットの構成明細。
 * 明細マスターは「呼び出して入力するための一方通行」なので、
 * 参照ではなく呼び出した時点の内容を写し取って保持する（マスター修正は連動しない）。
 */
export const mFinishAssemblyItems = sqliteTable(
  "m_finish_assembly_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assemblyId: integer("assembly_id")
      .notNull()
      .references(() => mFinishAssemblies.id, { onDelete: "cascade" }),
    /** 写し取り元の明細（追跡用。連動はしない） */
    sourceDetailId: integer("source_detail_id"),
    subjectId: integer("subject_id")
      .notNull()
      .references(() => mSubjects.id, { onDelete: "cascade" }),
    /** 部位番号（上段） */
    partNumber: real("part_number"),
    /** 明細番号（下段） */
    detailNumber: real("detail_number"),
    materialCategory: text("material_category").notNull().default(""),
    partName: text("part_name").notNull().default(""),
    name: text("name").notNull().default(""),
    descriptionUpper: text("description_upper").notNull().default(""),
    descriptionLower: text("description_lower").notNull().default(""),
    unit: text("unit").notNull().default(""),
    remarksUpper: text("remarks_upper").notNull().default(""),
    remarksLower: text("remarks_lower").notNull().default(""),
    estimateDisplay: text("estimate_display").notNull().default(""),
    /** 親数量(P)を用いた展開計算式。空なら親数量をそのまま継承 */
    formula: text("formula").notNull().default(""),
    /** 掛け率（セットで拾うが計上単位が異なる場合に使用） */
    coefficient: real("coefficient").notNull().default(1),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => ({
    assemblyOrderIdx: index("idx_m_fa_items_assembly_order").on(
      t.assemblyId,
      t.displayOrder,
    ),
    subjectIdx: index("idx_m_fa_items_subject").on(t.subjectId, t.displayOrder),
  }),
);

/** 建具・控除情報（プロジェクト固有） */
export const projectFittings = sqliteTable("project_fittings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** 建具記号。重複は許し、画面で赤文字にして知らせる */
  symbol: text("symbol").notNull(),
  /** 記号ごとの詳細拾い（硝子・額縁など）を後から足すための名称欄 */
  name: text("name").notNull().default(""),
  width: real("width"),
  height: real("height"),
  /** 腰高（FLから建具下端まで）。値がある場合は巾木の差し引きをしない */
  sillHeight: real("sill_height"),
  /** 面積計算（自動計算修正用）の計算式 */
  areaFormula: text("area_formula").notNull().default(""),
  /** 巾木長さ（自動計算修正用）の計算式 */
  baseboardFormula: text("baseboard_formula").notNull().default(""),
  note: text("note").notNull().default(""),
  /** 1: 建具表に無いものを積算入力から登録した行 */
  fromEstimate: integer("from_estimate").notNull().default(0),
  displayOrder: integer("display_order").notNull().default(0),
});

/** 部位別入力表（積算管理）の1行 */
export const projectEstimateRows = sqliteTable("project_estimate_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** room: 部屋の行 / subtotal: 小計行 */
  rowType: text("row_type").notNull().default("room"),
  /** 空欄の場合は入力のある上の行を引き継ぐ */
  part1: text("part1").notNull().default(""),
  part2: text("part2").notNull().default(""),
  /** 1: 集計時に部位Ⅱ別で仕分ける */
  part2Split: integer("part2_split").notNull().default(0),
  /** 型枠分類（ID入力で種類名に変換。マスターに無い文字も可） */
  formwork: text("formwork").notNull().default(""),
  /** 部位Ⅲ（部屋名）。記号を含め自由入力 */
  part3: text("part3").notNull().default(""),
  ceilingHeight: real("ceiling_height"),
  multiplier: real("multiplier").notNull().default(1),
  note: text("note").notNull().default(""),
  /** room:部屋別計算書 frame:軸組計算書 general:汎用計算書 */
  calcType: text("calc_type").notNull().default("room"),
  displayOrder: integer("display_order").notNull().default(0),
});

/** 部位別入力（部屋別仕上） */
export const projectRoomFinishes = sqliteTable(
  "project_room_finishes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    roomNumber: text("room_number").notNull().default(""),
    roomName: text("room_name").notNull().default(""),
    partId: integer("part_id").references(() => mParts.id, {
      onDelete: "set null",
    }),
    finishAssemblyId: integer("finish_assembly_id").references(
      () => mFinishAssemblies.id,
      {
        onDelete: "set null",
      },
    ),
    formula: text("formula").notNull().default(""),
    quantity: real("quantity"),
    unit: text("unit").notNull().default(""),
    note: text("note").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => ({
    projectRoomIdx: index("idx_prf_project_room").on(t.projectId, t.roomNumber),
  }),
);

/** 部屋計算書の上段（部屋形状の単線図・天井高さ）。1行の部位別入力表に1つ対応する */
export const projectRoomSheets = sqliteTable("project_room_sheets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  estimateRowId: integer("estimate_row_id")
    .notNull()
    .references(() => projectEstimateRows.id, { onDelete: "cascade" }),
  /** 部屋形状（辺の並び）。辺のIDを保持して数量根拠を追えるようにする */
  shapeJson: text("shape_json").notNull().default('{"edges":[]}'),
  /** 上段の自動計算に使う建具（記号・数・取り付く壁）。寸法は建具表から引用する */
  fittingsJson: text("fittings_json").notNull().default("[]"),
  /** 天井伏図の線（梁型・下がり壁・下がり天井）。線ごとに範囲の天井高さを持つ */
  ceilingJson: text("ceiling_json").notNull().default("[]"),
  /** 下段のセット明細計算表（部位ごとのセット・明細・計算式） */
  lowerJson: text("lower_json").notNull().default("[]"),
  ceilingHeight: real("ceiling_height"),
  note: text("note").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(now),
});

/** 軸組計算書の上段（建物レイアウト・軸組ライン）。1行の部位別入力表に1つ対応する */
export const projectFrameSheets = sqliteTable("project_frame_sheets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  estimateRowId: integer("estimate_row_id")
    .notNull()
    .references(() => projectEstimateRows.id, { onDelete: "cascade" }),
  /** 配置した部屋（FramePlacementの配列） */
  layoutJson: text("layout_json").notNull().default("[]"),
  /** 直接引いた軸組ライン（FrameManualLineの配列） */
  linesJson: text("lines_json").notNull().default("[]"),
  /** 軸組ラインごとの指定（壁種・サイズ種類・拾う／拾わない・壁の共有） */
  attributesJson: text("attributes_json").notNull().default("{}"),
  /** 軸組で拾う建具（記号・数・付く軸組ライン） */
  fittingsJson: text("fittings_json").notNull().default("[]"),
  /** 下段のセット明細計算表 */
  lowerJson: text("lower_json").notNull().default("[]"),
  /** 軸組の施工高さ（1か所直すと全体が再計算される） */
  workHeight: real("work_height"),
  note: text("note").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(now),
});

/** 汎用計算書（上段が無く、セット明細計算表だけで拾う計算書） */
export const projectGeneralSheets = sqliteTable("project_general_sheets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  estimateRowId: integer("estimate_row_id")
    .notNull()
    .references(() => projectEstimateRows.id, { onDelete: "cascade" }),
  /** セット明細計算表 */
  lowerJson: text("lower_json").notNull().default("[]"),
  note: text("note").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(now),
});

/**
 * 転記入力表の1行（1明細）。
 * 集計書兼工事マスターへ直接計上する入力で、根拠集計（計算書の数量根拠）には含めない。
 */
export const projectTransferRows = sqliteTable(
  "project_transfer_rows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** A〜G: 空欄なら入力のある上の行を引き継ぐ */
    part1: text("part1").notNull().default(""),
    part2: text("part2").notNull().default(""),
    part2Split: integer("part2_split").notNull().default(0),
    formwork: text("formwork").notNull().default(""),
    part3: text("part3").notNull().default(""),
    /** H: 科目ID */
    subjectId: integer("subject_id").references(() => mSubjects.id, {
      onDelete: "set null",
    }),
    /** I: 仕上（材種）区分 */
    materialCategory: text("material_category").notNull().default(""),
    /** J〜N: 明細（セット明細は使わず、全て1明細入力） */
    partId: integer("part_id"),
    partName: text("part_name").notNull().default(""),
    detailNumber: real("detail_number"),
    name: text("name").notNull().default(""),
    /** 呼び出し元の明細レコードID（名称変更で切り離さないための内部ID） */
    sourceDetailId: integer("source_detail_id"),
    descriptionUpper: text("description_upper").notNull().default(""),
    descriptionLower: text("description_lower").notNull().default(""),
    quantity: real("quantity"),
    unit: text("unit").notNull().default(""),
    /** O・P: 将来用（単価・金額） */
    unitPrice: real("unit_price"),
    amount: real("amount"),
    /** Q・R: 備考とメモ（メモはどこにも連動しない） */
    remarks: text("remarks").notNull().default(""),
    memo: text("memo").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => ({
    projectIdx: index("idx_transfer_rows_project").on(
      t.projectId,
      t.displayOrder,
    ),
  }),
);

/**
 * 動的計算書スキーマ。
 * 計算書（シート）のUIレイアウトと計算式定義をJSONで保持し、
 * コア改修なしに新しい計算書を追加できるようにする。
 */
export const calcSheetDefinitions = sqliteTable("calc_sheet_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  layoutJson: text("layout_json").notNull().default("{}"),
  formulaJson: text("formula_json").notNull().default("{}"),
  version: integer("version").notNull().default(1),
  isBuiltin: integer("is_builtin", { mode: "boolean" })
    .notNull()
    .default(false),
  displayOrder: integer("display_order").notNull().default(0),
});

/** 計算書のデータ行（定義に従う可変スキーマ） */
export const calcSheetEntries = sqliteTable(
  "calc_sheet_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    definitionId: integer("definition_id")
      .notNull()
      .references(() => calcSheetDefinitions.id, { onDelete: "cascade" }),
    dataJson: text("data_json").notNull().default("{}"),
    displayOrder: integer("display_order").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    projectDefIdx: index("idx_cse_project_def").on(
      t.projectId,
      t.definitionId,
      t.displayOrder,
    ),
  }),
);

/** アプリ設定（内訳書フォーマット設定・テーマ等） */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull().default("{}"),
});

/** 型枠分類マスタ（左官の打放補修から型枠を算出する際の仕様決定に使用） */
export const mFormworkCategories = sqliteTable("m_formwork_categories", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
});

/** 入力拾い用の部位マスタ */
export const mPickupParts = sqliteTable("m_pickup_parts", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  note: text("note").notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
});

/** 集計部位マスタ（視覚的判別用のカラーを保持） */
export const mAggregationParts = sqliteTable("m_aggregation_parts", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  backgroundColor: text("background_color"),
  textColor: text("text_color"),
  displayOrder: integer("display_order").notNull().default(0),
});

/** 集計部位表示マスタ（部位階層ごとのカッコ書式） */
export const mPartBracketFormats = sqliteTable("m_part_bracket_formats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** 1=部位Ⅰ, 2=部位Ⅱ, 3=部位Ⅲ */
  level: integer("level").notNull().unique(),
  leftBracket: text("left_bracket").notNull().default(""),
  rightBracket: text("right_bracket").notNull().default(""),
});

/** 集計を実行した回（集計書兼工事マスターと集計詳細データの版） */
export const projectAggregateRuns = sqliteTable("project_aggregate_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(now),
  note: text("note").notNull().default(""),
});

/** 集計詳細データ（合算前の1件。数量根拠を追うために残す） */
export const projectAggregateDetails = sqliteTable(
  "project_aggregate_details",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => projectAggregateRuns.id, { onDelete: "cascade" }),
    traceId: text("trace_id").notNull(),
    masterKey: text("master_key").notNull().default(""),
    /** room / frame / general / transfer */
    sourceKind: text("source_kind").notNull().default("room"),
    estimateRowId: integer("estimate_row_id"),
    transferRowId: integer("transfer_row_id"),
    part1: text("part1").notNull().default(""),
    part2: text("part2").notNull().default(""),
    part2Raw: text("part2_raw").notNull().default(""),
    part2Split: integer("part2_split").notNull().default(0),
    part2Order: integer("part2_order").notNull().default(0),
    part3: text("part3").notNull().default(""),
    formwork: text("formwork").notNull().default(""),
    multiplier: real("multiplier").notNull().default(1),
    subjectId: integer("subject_id"),
    materialCategory: text("material_category").notNull().default(""),
    partNumber: real("part_number"),
    partName: text("part_name").notNull().default(""),
    detailNumber: real("detail_number"),
    name: text("name").notNull().default(""),
    descriptionUpper: text("description_upper").notNull().default(""),
    descriptionLower: text("description_lower").notNull().default(""),
    unit: text("unit").notNull().default(""),
    remarksUpper: text("remarks_upper").notNull().default(""),
    remarksLower: text("remarks_lower").notNull().default(""),
    estimateDisplay: text("estimate_display").notNull().default(""),
    coefficient: real("coefficient").notNull().default(1),
    setTotal: real("set_total").notNull().default(0),
    quantity: real("quantity").notNull().default(0),
    sourceDetailId: integer("source_detail_id"),
  },
  (t) => ({
    runIdx: index("idx_aggregate_details_run").on(t.runId, t.masterKey),
  }),
);

/** 集計書兼工事マスター（合算後の1明細＝画面では上下2行） */
export const projectAggregateItems = sqliteTable(
  "project_aggregate_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => projectAggregateRuns.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull().default(0),
    masterKey: text("master_key").notNull(),
    part1: text("part1").notNull().default(""),
    part2: text("part2").notNull().default(""),
    part2Raw: text("part2_raw").notNull().default(""),
    subjectId: integer("subject_id"),
    materialCategory: text("material_category").notNull().default(""),
    partNumber: real("part_number"),
    partName: text("part_name").notNull().default(""),
    detailNumber: real("detail_number"),
    name: text("name").notNull().default(""),
    descriptionUpper: text("description_upper").notNull().default(""),
    descriptionLower: text("description_lower").notNull().default(""),
    unit: text("unit").notNull().default(""),
    remarksUpper: text("remarks_upper").notNull().default(""),
    remarksLower: text("remarks_lower").notNull().default(""),
    estimateDisplay: text("estimate_display").notNull().default(""),
    formwork: text("formwork").notNull().default(""),
    quantity: real("quantity").notNull().default(0),
    /** 根拠（部屋別の内訳）。転記入力表の分は入れない */
    roomsJson: text("rooms_json").notNull().default("[]"),
  },
  (t) => ({
    runIdx: index("idx_aggregate_items_run").on(t.runId, t.displayOrder),
  }),
);

/** 転記用書式（打放型枠など）。明細自体が転記情報を持ち、集計をかけ直しても残る */
export const projectTransferRules = sqliteTable(
  "project_transfer_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    masterKey: text("master_key").notNull(),
    /** formwork: 型枠転記 */
    ruleKind: text("rule_kind").notNull().default("formwork"),
    coefficient: real("coefficient").notNull().default(1),
    subjectId: integer("subject_id"),
    materialCategory: text("material_category").notNull().default(""),
    partNumber: real("part_number"),
    partName: text("part_name").notNull().default(""),
    detailNumber: real("detail_number"),
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    unit: text("unit").notNull().default(""),
    remarks: text("remarks").notNull().default(""),
  },
  (t) => ({
    keyUq: uniqueIndex("uq_transfer_rules_key").on(
      t.projectId,
      t.masterKey,
      t.ruleKind,
    ),
  }),
);

export type MDetail = typeof mDetails.$inferSelect;
export type MDetailInsert = typeof mDetails.$inferInsert;
export type MSubject = typeof mSubjects.$inferSelect;
