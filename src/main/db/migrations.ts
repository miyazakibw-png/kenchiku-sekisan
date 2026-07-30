/**
 * オフライン動作のため、マイグレーションは SQL を同梱し user_version で管理する。
 * 追加時は配列末尾に push すること（既存要素は変更しない）。
 */
export const migrations: string[] = [
  /* 001: 初期スキーマ */ `
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name TEXT NOT NULL,
  client_name TEXT,
  location TEXT,
  total_area REAL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE m_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE m_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES m_parts(id) ON DELETE SET NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE m_material_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE m_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE m_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES m_subjects(id) ON DELETE CASCADE,
  detail_number TEXT,
  material_category_id INTEGER REFERENCES m_material_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_m_details_subject_order ON m_details(subject_id, display_order);
CREATE INDEX idx_m_details_number ON m_details(detail_number);

CREATE TABLE m_finish_assemblies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_code TEXT,
  assembly_name TEXT NOT NULL,
  part_id INTEGER REFERENCES m_parts(id) ON DELETE SET NULL,
  usage_category TEXT,
  note TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_m_finish_assemblies_part ON m_finish_assemblies(part_id, display_order);

CREATE TABLE m_finish_assembly_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id INTEGER NOT NULL REFERENCES m_finish_assemblies(id) ON DELETE CASCADE,
  detail_id INTEGER NOT NULL REFERENCES m_details(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'finish',
  formula TEXT NOT NULL DEFAULT '',
  coefficient REAL NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_m_fa_items_assembly_order ON m_finish_assembly_items(assembly_id, display_order);

CREATE TABLE project_fittings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  width REAL,
  height REAL,
  quantity REAL NOT NULL DEFAULT 1,
  area_override REAL,
  baseboard_deduction_override REAL,
  reinforcement_width REAL,
  note TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_project_fittings_symbol ON project_fittings(project_id, symbol);

CREATE TABLE project_room_finishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL DEFAULT '',
  room_name TEXT NOT NULL DEFAULT '',
  part_id INTEGER REFERENCES m_parts(id) ON DELETE SET NULL,
  finish_assembly_id INTEGER REFERENCES m_finish_assemblies(id) ON DELETE SET NULL,
  formula TEXT NOT NULL DEFAULT '',
  quantity REAL,
  unit TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_prf_project_room ON project_room_finishes(project_id, room_number);

CREATE TABLE calc_sheet_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL DEFAULT '{}',
  formula_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE calc_sheet_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  definition_id INTEGER NOT NULL REFERENCES calc_sheet_definitions(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL DEFAULT '{}',
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cse_project_def ON calc_sheet_entries(project_id, definition_id, display_order);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL DEFAULT '{}'
);
`,
  /* 002: 明細を上下2段構成にし、明細番号を数値（小数2桁）へ変更 */ `
CREATE TABLE m_details_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES m_subjects(id) ON DELETE CASCADE,
  detail_number REAL,
  material_category_id INTEGER REFERENCES m_material_categories(id) ON DELETE SET NULL,
  part_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  description_upper TEXT NOT NULL DEFAULT '',
  description_lower TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  remarks_upper TEXT NOT NULL DEFAULT '',
  remarks_lower TEXT NOT NULL DEFAULT '',
  estimate_display TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO m_details_new (
  id, subject_id, detail_number, material_category_id, part_name, name,
  description_upper, unit, remarks_upper, display_order, is_active, created_at, updated_at
)
SELECT
  id, subject_id,
  CASE
    WHEN detail_number IS NULL OR trim(detail_number) = '' THEN NULL
    WHEN trim(detail_number) GLOB '*[!0-9.]*' THEN NULL
    ELSE CAST(detail_number AS REAL)
  END,
  material_category_id, '', name, description, unit, remarks,
  display_order, is_active, created_at, updated_at
FROM m_details;

DROP TABLE m_details;
ALTER TABLE m_details_new RENAME TO m_details;
CREATE INDEX idx_m_details_subject_order ON m_details(subject_id, display_order);
CREATE INDEX idx_m_details_number ON m_details(detail_number);
`,
  /* 003: 基本マスター群の追加（集計分類・型枠分類・入力拾い用部位・集計部位表示）と単位/材種区分の刷新 */ `
CREATE TABLE m_aggregation_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE m_formwork_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- 入力拾い用の部位マスタ（部位ID・部位名・備考）
CREATE TABLE m_pickup_parts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0
);

-- 集計部位（部位番号・部位名・視覚的判別用のカラー）
CREATE TABLE m_aggregation_parts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  background_color TEXT,
  text_color TEXT,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- 集計部位表示（科目内訳タイトルの階層カッコ書式）
CREATE TABLE m_part_bracket_formats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level INTEGER NOT NULL UNIQUE,
  left_bracket TEXT NOT NULL DEFAULT '',
  right_bracket TEXT NOT NULL DEFAULT ''
);

DELETE FROM m_units;
INSERT INTO m_units (id, name, display_order) VALUES
  (1,'m',1),(2,'m2',2),(3,'m3',3),(4,'ヶ所',4),(5,'枚',5),(7,'kg',7),(9,'式',9);

UPDATE m_details SET material_category_id = NULL;
DELETE FROM m_finish_assembly_items;
DELETE FROM m_material_categories;
INSERT INTO m_material_categories (id, code, name, display_order) VALUES
  (1,'1','仕上',1),(2,'2','軸組',2);
`,
  /* 004: 仕上明細セットに 基本セット / 物件セット の区分を追加 */ `
ALTER TABLE m_finish_assemblies ADD COLUMN scope TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE m_finish_assemblies ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
-- 物件セットを基本セットへ昇格した場合の由来を保持する
ALTER TABLE m_finish_assemblies ADD COLUMN source_assembly_id INTEGER REFERENCES m_finish_assemblies(id) ON DELETE SET NULL;
CREATE INDEX idx_m_finish_assemblies_scope ON m_finish_assemblies(scope, project_id, display_order);
`
]