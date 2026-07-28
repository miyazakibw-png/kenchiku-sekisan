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
`
]
