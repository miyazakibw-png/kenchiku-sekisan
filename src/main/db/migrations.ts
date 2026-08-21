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
`,
  /* 005: 材種区分を5種類に拡張（3:下地1 4:下地2 5:予備） */ `
INSERT OR IGNORE INTO m_material_categories (id, code, name, display_order) VALUES
  (3,'3','下地1',3),(4,'4','下地2',4),(5,'5','予備',5);
`,
  /* 006: 材種区分を自由入力（マスタ番号で入力補助）へ変更し、仕上明細セットを写し取り方式にする */ `
-- 材種区分は数量チェック用の区分。マスタに無い文字も入力できるようテキストで保持する
ALTER TABLE m_details ADD COLUMN material_category TEXT NOT NULL DEFAULT '';
UPDATE m_details SET material_category = COALESCE(
  (SELECT name FROM m_material_categories WHERE id = m_details.material_category_id), '');
ALTER TABLE m_details DROP COLUMN material_category_id;

-- セットは明細マスターを参照せず、呼び出した時点の内容を写し取って保持する（一方通行）
CREATE TABLE m_finish_assembly_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id INTEGER NOT NULL REFERENCES m_finish_assemblies(id) ON DELETE CASCADE,
  -- 写し取り元の明細（追跡用。連動はしない）
  source_detail_id INTEGER,
  subject_id INTEGER NOT NULL REFERENCES m_subjects(id) ON DELETE CASCADE,
  part_number REAL,
  detail_number REAL,
  material_category TEXT NOT NULL DEFAULT '',
  part_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  description_upper TEXT NOT NULL DEFAULT '',
  description_lower TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  remarks_upper TEXT NOT NULL DEFAULT '',
  remarks_lower TEXT NOT NULL DEFAULT '',
  estimate_display TEXT NOT NULL DEFAULT '',
  -- 親数量(P)を用いた展開計算式
  formula TEXT NOT NULL DEFAULT '',
  -- 掛け率（セットで拾うが計上単位が異なる場合に使用）
  coefficient REAL NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO m_finish_assembly_items_new (
  id, assembly_id, source_detail_id, subject_id, detail_number, material_category,
  part_name, name, description_upper, description_lower, unit,
  remarks_upper, remarks_lower, estimate_display, formula, coefficient, display_order
)
SELECT
  i.id, i.assembly_id, i.detail_id, d.subject_id, d.detail_number, d.material_category,
  d.part_name, d.name, d.description_upper, d.description_lower, d.unit,
  d.remarks_upper, d.remarks_lower, d.estimate_display, i.formula, i.coefficient, i.display_order
FROM m_finish_assembly_items i
JOIN m_details d ON d.id = i.detail_id;

DROP TABLE m_finish_assembly_items;
ALTER TABLE m_finish_assembly_items_new RENAME TO m_finish_assembly_items;
CREATE INDEX idx_m_fa_items_assembly_order ON m_finish_assembly_items(assembly_id, display_order);
CREATE INDEX idx_m_fa_items_subject ON m_finish_assembly_items(subject_id, display_order);
`,
  /* 007: 物件管理台帳（管理番号・日付・建設会社・設計事務所・自由並べ替え・ユーザー定義列） */ `
-- 管理番号は自動採番で変更不可。日付は作成日を初期値とし、YYYY-MM-DD の固定形式で保持する
ALTER TABLE projects ADD COLUMN management_no TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN project_date TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN builder_name TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN designer_name TEXT NOT NULL DEFAULT '';
-- 作成順とは無関係に台帳で並べ替えるための順序
ALTER TABLE projects ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN source_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

UPDATE projects SET
  management_no = 'P-' || substr('0000' || id, -4),
  project_date = COALESCE(substr(created_at, 1, 10), ''),
  builder_name = COALESCE(client_name, ''),
  display_order = id
WHERE management_no = '';

CREATE UNIQUE INDEX uq_projects_management_no ON projects(management_no);
CREATE INDEX idx_projects_display_order ON projects(display_order);

-- 物件管理台帳のユーザー定義列。display_width は画面表示の桁数制限（入力自体は制限しない）
CREATE TABLE m_project_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  display_width INTEGER NOT NULL DEFAULT 30,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_field_values (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES m_project_fields(id) ON DELETE CASCADE,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, field_id)
);
`,
  /* 008: 工種科目マスター（部位Ⅱ仕分け不要・集計順・備考・将来用の予備列） */ `
-- 部位Ⅱの仕分けが必要な物件でも、科目によっては仕分け不要にできる
ALTER TABLE m_subjects ADD COLUMN skip_part2 INTEGER NOT NULL DEFAULT 0;
-- 集計順 1:部位順 2:明細番号順
ALTER TABLE m_subjects ADD COLUMN aggregate_order INTEGER NOT NULL DEFAULT 1;
ALTER TABLE m_subjects ADD COLUMN note TEXT NOT NULL DEFAULT '';
-- 将来の項目追加用の予備列（用途が決まるまで未使用）
ALTER TABLE m_subjects ADD COLUMN spare1 TEXT NOT NULL DEFAULT '';
ALTER TABLE m_subjects ADD COLUMN spare2 TEXT NOT NULL DEFAULT '';
`,
  /* 009: 建具表メイン画面（腰高・自動計算修正用の計算式・記号重複可・積算入力からの登録） */ `
CREATE TABLE project_fittings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 建具記号は重複を許し、画面で赤文字にして知らせる
  symbol TEXT NOT NULL,
  -- 記号ごとの詳細拾い（硝子・額縁など）を後から足せるように名称欄を残す
  name TEXT NOT NULL DEFAULT '',
  width REAL,
  height REAL,
  -- 腰高（FLから建具下端まで）。値がある場合は巾木の差し引きをしない
  sill_height REAL,
  -- 面積計算（自動計算修正用）。式は残したまま結果を面積に使う
  area_formula TEXT NOT NULL DEFAULT '',
  -- 巾木長さ（自動計算修正用）
  baseboard_formula TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  -- 1: 建具表に無いものを積算入力から登録した行（末尾へまとめる）
  from_estimate INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO project_fittings_new (
  id, project_id, symbol, name, width, height, note, display_order
)
SELECT id, project_id, symbol, name, width, height, note, display_order
FROM project_fittings;

DROP INDEX IF EXISTS uq_project_fittings_symbol;
DROP TABLE project_fittings;
ALTER TABLE project_fittings_new RENAME TO project_fittings;
CREATE INDEX idx_project_fittings_order ON project_fittings(project_id, from_estimate, display_order);
`,
  /* 010: 部位別入力表（積算管理）。集計分類マスターは廃止し、部位Ⅱ別仕訳のチェックに置き換える */ `
DROP TABLE IF EXISTS m_aggregation_categories;

CREATE TABLE project_estimate_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- room: 部屋の行 / subtotal: 小計行（チェック用）
  row_type TEXT NOT NULL DEFAULT 'room',
  -- 空欄の場合は入力のある上の行を引き継ぐ
  part1 TEXT NOT NULL DEFAULT '',
  part2 TEXT NOT NULL DEFAULT '',
  -- 1: 集計時に部位Ⅱ別で仕分ける
  part2_split INTEGER NOT NULL DEFAULT 0,
  -- 型枠分類（IDを入力すると種類名に変換。マスターに無い文字も可）
  formwork TEXT NOT NULL DEFAULT '',
  -- 部位Ⅲ（部屋名）。記号を含め自由入力
  part3 TEXT NOT NULL DEFAULT '',
  ceiling_height REAL,
  multiplier REAL NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  -- 計算タイプ room:部屋別計算書 frame:軸組計算書 general:汎用計算書
  calc_type TEXT NOT NULL DEFAULT 'room',
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_per_project_order ON project_estimate_rows(project_id, display_order);

-- 計算書は当面この3書式。将来はこのマスターに追加すれば計算タイプの選択肢が増える
UPDATE calc_sheet_definitions SET name = '部屋別計算書' WHERE key = 'room';
UPDATE calc_sheet_definitions SET name = '軸組計算書' WHERE key = 'frame';
UPDATE calc_sheet_definitions SET key = 'general', name = '汎用計算書' WHERE key = 'simple';
`,
  /* 011: 部屋計算書の上段（部屋形状の単線図・天井高さ）。数量根拠を追えるように辺のIDごと保持する */ `
CREATE TABLE project_room_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 部位別入力表の行（1行＝1部屋＝1計算書）
  estimate_row_id INTEGER NOT NULL REFERENCES project_estimate_rows(id) ON DELETE CASCADE,
  -- 部屋形状（辺の並び）。辺は作成時のIDを保持し、集計・印刷から図面位置を追える
  shape_json TEXT NOT NULL DEFAULT '{"edges":[]}',
  -- 天井高さ（部位別入力表と相互連動）
  ceiling_height REAL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_room_sheet_row ON project_room_sheets(estimate_row_id);

-- 取り合いの欠除：この面積以下は差し引かない（設定画面で変更する）
INSERT OR IGNORE INTO app_settings(key, value_json) VALUES ('deductionLimit', '0.5');
`,
  /* 012: 部屋計算書の上段で使う建具（上段の自動計算用）。
     記号・数・取り付く壁だけを持ち、W/H/面積/巾木減は常に建具表から引用する */ `
ALTER TABLE project_room_sheets ADD COLUMN fittings_json TEXT NOT NULL DEFAULT '[]';
`,
  /* 013: 天井伏図（平面図に足す梁型・下がり壁・下がり天井の線）。
     線ごとに範囲の天井高さを持ち、部屋の天井高さとの差から下がり高さを自動算出する */ `
ALTER TABLE project_room_sheets ADD COLUMN ceiling_json TEXT NOT NULL DEFAULT '[]';
`,
  /* 014: 下段のセット明細計算表（部位ごとのセット・明細・計算式A/B・B1〜B100） */ `
ALTER TABLE project_room_sheets ADD COLUMN lower_json TEXT NOT NULL DEFAULT '[]';
`,
];
