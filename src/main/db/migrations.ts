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
  /* 015: 軸組計算書の上段（部屋計算書で作った部屋を並べる建物レイアウトと軸組ライン）。
     数量根拠を追えるように「部屋 → 壁 → 軸組ライン → 数量」の関係をIDで保持する */ `
CREATE TABLE project_frame_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  estimate_row_id INTEGER NOT NULL REFERENCES project_estimate_rows(id) ON DELETE CASCADE,
  -- 配置した部屋（部屋計算書の平面図を1オブジェクトとして置く）
  layout_json TEXT NOT NULL DEFAULT '[]',
  -- 直接引いた軸組ライン（始点・終点）
  lines_json TEXT NOT NULL DEFAULT '[]',
  -- 軸組ラインごとの指定（壁種・サイズ種類・施工高さ・拾う／拾わない・壁の共有）
  attributes_json TEXT NOT NULL DEFAULT '{}',
  -- 軸組で拾う建具（開口の差し引きと開口部補強に使う）
  fittings_json TEXT NOT NULL DEFAULT '[]',
  lower_json TEXT NOT NULL DEFAULT '[]',
  -- 軸組の施工高さ（1か所直すと全体が再計算される）
  work_height REAL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_frame_sheet_row ON project_frame_sheets(estimate_row_id);
`,
  /* 016: 汎用計算書（上段が無く、セット明細計算表だけで自由に拾う計算書） */ `
CREATE TABLE project_general_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  estimate_row_id INTEGER NOT NULL REFERENCES project_estimate_rows(id) ON DELETE CASCADE,
  lower_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_general_sheet_row ON project_general_sheets(estimate_row_id);
`,
  /* 017: 転記入力表（集計書兼工事マスターへ直接計上する1明細入力） */ `
CREATE TABLE project_transfer_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- A〜G: 部位別入力表と同じ扱い（空欄なら入力のある上の行を引き継ぐ）
  part1 TEXT NOT NULL DEFAULT '',
  part2 TEXT NOT NULL DEFAULT '',
  part2_split INTEGER NOT NULL DEFAULT 0,
  formwork TEXT NOT NULL DEFAULT '',
  part3 TEXT NOT NULL DEFAULT '',
  -- H・I: 科目ID・仕上（材種）区分
  subject_id INTEGER REFERENCES m_subjects(id) ON DELETE SET NULL,
  material_category TEXT NOT NULL DEFAULT '',
  -- J〜N: 入力する明細（セット明細は使わず、全て1明細入力）
  part_id INTEGER,
  part_name TEXT NOT NULL DEFAULT '',
  detail_number REAL,
  name TEXT NOT NULL DEFAULT '',
  source_detail_id INTEGER,
  description_upper TEXT NOT NULL DEFAULT '',
  description_lower TEXT NOT NULL DEFAULT '',
  quantity REAL,
  unit TEXT NOT NULL DEFAULT '',
  -- O・P: 将来用（単価・金額）
  unit_price REAL,
  amount REAL,
  -- Q・R: 備考とメモ（メモはどこにも連動しない）
  remarks TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_transfer_rows_project ON project_transfer_rows(project_id, display_order);
`,
  /* 018: 集計処理（集計詳細データ・集計書兼工事マスター・型枠転記の連動記憶） */ `
CREATE TABLE project_aggregate_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_aggregate_runs_project ON project_aggregate_runs(project_id, id);

-- 集計詳細データ（合算前の1件。数量根拠を追うために残す）
CREATE TABLE project_aggregate_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES project_aggregate_runs(id) ON DELETE CASCADE,
  trace_id TEXT NOT NULL,
  master_key TEXT NOT NULL DEFAULT '',
  -- room / frame / general / transfer
  source_kind TEXT NOT NULL DEFAULT 'room',
  estimate_row_id INTEGER,
  transfer_row_id INTEGER,
  part1 TEXT NOT NULL DEFAULT '',
  part2 TEXT NOT NULL DEFAULT '',
  part2_raw TEXT NOT NULL DEFAULT '',
  part2_split INTEGER NOT NULL DEFAULT 0,
  part2_order INTEGER NOT NULL DEFAULT 0,
  part3 TEXT NOT NULL DEFAULT '',
  formwork TEXT NOT NULL DEFAULT '',
  multiplier REAL NOT NULL DEFAULT 1,
  subject_id INTEGER,
  material_category TEXT NOT NULL DEFAULT '',
  part_number REAL,
  part_name TEXT NOT NULL DEFAULT '',
  detail_number REAL,
  name TEXT NOT NULL DEFAULT '',
  description_upper TEXT NOT NULL DEFAULT '',
  description_lower TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  remarks_upper TEXT NOT NULL DEFAULT '',
  remarks_lower TEXT NOT NULL DEFAULT '',
  estimate_display TEXT NOT NULL DEFAULT '',
  coefficient REAL NOT NULL DEFAULT 1,
  set_total REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  source_detail_id INTEGER
);
CREATE INDEX idx_aggregate_details_run ON project_aggregate_details(run_id, master_key);

-- 集計書兼工事マスター（合算後の1明細＝画面では上下2行）
CREATE TABLE project_aggregate_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES project_aggregate_runs(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  master_key TEXT NOT NULL,
  part1 TEXT NOT NULL DEFAULT '',
  part2 TEXT NOT NULL DEFAULT '',
  part2_raw TEXT NOT NULL DEFAULT '',
  subject_id INTEGER,
  material_category TEXT NOT NULL DEFAULT '',
  part_number REAL,
  part_name TEXT NOT NULL DEFAULT '',
  detail_number REAL,
  name TEXT NOT NULL DEFAULT '',
  description_upper TEXT NOT NULL DEFAULT '',
  description_lower TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  remarks_upper TEXT NOT NULL DEFAULT '',
  remarks_lower TEXT NOT NULL DEFAULT '',
  estimate_display TEXT NOT NULL DEFAULT '',
  formwork TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 0,
  -- 根拠（部屋別の内訳）。転記入力表の分は入れない
  rooms_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_aggregate_items_run ON project_aggregate_items(run_id, display_order);

-- 転記用書式（打放型枠など）。明細自体が転記情報を持ち、集計をかけ直しても残る
CREATE TABLE project_transfer_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  master_key TEXT NOT NULL,
  -- 転記の種類（formwork: 型枠転記）
  rule_kind TEXT NOT NULL DEFAULT 'formwork',
  coefficient REAL NOT NULL DEFAULT 1,
  subject_id INTEGER,
  material_category TEXT NOT NULL DEFAULT '',
  part_number REAL,
  part_name TEXT NOT NULL DEFAULT '',
  detail_number REAL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX uq_transfer_rules_key ON project_transfer_rules(project_id, master_key, rule_kind);
`,
  /* 019: 内訳書（集計書兼工事マスターからの変換転記・提出回ごとの版・比較） */ `
-- 内訳書の設定（物件ごとに1件。2回目以降はこの設定を読み込んでから転記する）
CREATE TABLE project_breakdown_settings (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  -- 書式 1:2段1行 2:1段 3:エクセル転記用（2段を1行で掃き出す）
  layout INTEGER NOT NULL DEFAULT 1,
  -- 名称欄 1:そのまま 2:部位＋半角スペース＋名称
  name_pattern INTEGER NOT NULL DEFAULT 1,
  -- 名称（下段）の表示 half:半角 full:全角 raw:そのまま
  name_width TEXT NOT NULL DEFAULT 'raw',
  -- 数量の丸め（閾値以上はその桁数。0桁になって0と出る場合は数字が出る桁まで）
  round_threshold1 REAL NOT NULL DEFAULT 100,
  round_decimals1 INTEGER NOT NULL DEFAULT 0,
  round_threshold2 REAL NOT NULL DEFAULT 0,
  round_decimals2 INTEGER NOT NULL DEFAULT 1,
  round_decimals3 INTEGER NOT NULL DEFAULT 2,
  -- 工種科目の並び（科目IDの配列）と摘要の文字置き換え（[{from,to}]）
  subject_order_json TEXT NOT NULL DEFAULT '[]',
  replacements_json TEXT NOT NULL DEFAULT '[]',
  -- 単位の並び（集計書から抜き出して自動準備する）
  unit_order_json TEXT NOT NULL DEFAULT '[]',
  -- BCS・印刷で使う2層目の工事区分
  work_category TEXT NOT NULL DEFAULT '建築主体工事'
);

-- 内訳書の版（1回目・2回目…。1回目は確定するまで何度転記しても1回目）
CREATE TABLE project_breakdown_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 確定すると次は新しい回になる
  confirmed INTEGER NOT NULL DEFAULT 0,
  aggregate_run_id INTEGER REFERENCES project_aggregate_runs(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX uq_breakdown_versions_round ON project_breakdown_versions(project_id, round);

-- 内訳書の行（3層目＝科目見出し、4層目＝明細）
CREATE TABLE project_breakdown_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES project_breakdown_versions(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  -- subject:科目見出し detail:明細 note:注記 blank:比較用の空行
  row_kind TEXT NOT NULL DEFAULT 'detail',
  subject_id INTEGER,
  subject_name TEXT NOT NULL DEFAULT '',
  -- 集計書兼工事マスターの明細（数量根拠を追うため）
  master_key TEXT NOT NULL DEFAULT '',
  aggregate_item_id INTEGER,
  part_name TEXT NOT NULL DEFAULT '',
  name_upper TEXT NOT NULL DEFAULT '',
  name_lower TEXT NOT NULL DEFAULT '',
  description_upper TEXT NOT NULL DEFAULT '',
  description_lower TEXT NOT NULL DEFAULT '',
  quantity REAL,
  unit TEXT NOT NULL DEFAULT '',
  unit_price REAL,
  amount REAL,
  remarks_upper TEXT NOT NULL DEFAULT '',
  remarks_lower TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_breakdown_rows_version ON project_breakdown_rows(version_id, display_order);
`,
  /* 020: 型枠転記で作った転記入力表の行に、生成元の型枠分類を持たせる */ `
ALTER TABLE project_transfer_rows ADD COLUMN formwork_key TEXT NOT NULL DEFAULT '';
`,
  /* 021: 明細マスターを物件専用（工事マスター）にも持てるようにする */ `
ALTER TABLE m_details ADD COLUMN scope TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE m_details ADD COLUMN project_id INTEGER;
ALTER TABLE m_details ADD COLUMN source_detail_id INTEGER;
CREATE INDEX idx_m_details_scope ON m_details(scope, project_id, subject_id, display_order);
`,
  /* 022: 明細マスターの修正履歴（修正前・修正後を1件ずつ残す） */ `
CREATE TABLE detail_change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  -- basic:基本マスター project:物件専用（工事マスター）
  scope TEXT NOT NULL DEFAULT 'basic',
  project_id INTEGER,
  subject_id INTEGER NOT NULL,
  detail_id INTEGER,
  -- add:追加 edit:修正 delete:削除
  change_kind TEXT NOT NULL DEFAULT 'edit',
  before_json TEXT NOT NULL DEFAULT '',
  after_json TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_detail_change_logs ON detail_change_logs(project_id, changed_at);
`,
  /* 023: 基準マスター（科目・明細用部位・管理用部位・材種区分・単位・型枠分類）を工事ごとに持てるようにする */ `
CREATE TABLE project_masters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- subjects / pickupParts / materialCategories / units / aggregationParts / formworkCategories
  kind TEXT NOT NULL,
  -- 画面に出る番号（科目IDや部位番号。基準マスターから複製したときは同じ番号）
  number INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  -- 科目だけで使う項目
  skip_part2 INTEGER NOT NULL DEFAULT 0,
  aggregate_order INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_project_masters ON project_masters(project_id, kind, number);

-- 工事ごとに科目を足せるよう、科目への外部キーを外す（列と値はそのまま）
CREATE TABLE m_details_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  detail_number REAL,
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
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  material_category TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'basic',
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  source_detail_id INTEGER
);
INSERT INTO m_details_new (
  id, subject_id, detail_number, part_name, name, description_upper, description_lower,
  unit, remarks_upper, remarks_lower, estimate_display, display_order, is_active,
  created_at, updated_at, material_category, scope, project_id, source_detail_id
)
SELECT
  id, subject_id, detail_number, part_name, name, description_upper, description_lower,
  unit, remarks_upper, remarks_lower, estimate_display, display_order, is_active,
  created_at, updated_at, material_category, scope, project_id, source_detail_id
FROM m_details;
DROP TABLE m_details;
ALTER TABLE m_details_new RENAME TO m_details;
CREATE INDEX idx_m_details_subject_order ON m_details(subject_id, display_order);
CREATE INDEX idx_m_details_number ON m_details(detail_number);
CREATE INDEX idx_m_details_scope ON m_details(scope, project_id, subject_id, display_order);

CREATE TABLE m_finish_assembly_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id INTEGER NOT NULL REFERENCES m_finish_assemblies(id) ON DELETE CASCADE,
  source_detail_id INTEGER,
  subject_id INTEGER NOT NULL,
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
  formula TEXT NOT NULL DEFAULT '',
  coefficient REAL NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO m_finish_assembly_items_new (
  id, assembly_id, source_detail_id, subject_id, part_number, detail_number, material_category,
  part_name, name, description_upper, description_lower, unit, remarks_upper, remarks_lower,
  estimate_display, formula, coefficient, display_order
)
SELECT
  id, assembly_id, source_detail_id, subject_id, part_number, detail_number, material_category,
  part_name, name, description_upper, description_lower, unit, remarks_upper, remarks_lower,
  estimate_display, formula, coefficient, display_order
FROM m_finish_assembly_items;
DROP TABLE m_finish_assembly_items;
ALTER TABLE m_finish_assembly_items_new RENAME TO m_finish_assembly_items;
CREATE INDEX idx_m_fa_items_assembly_order ON m_finish_assembly_items(assembly_id, display_order);
CREATE INDEX idx_m_fa_items_subject ON m_finish_assembly_items(subject_id, display_order);
`,
  // 工事側マスターが基本マスターのどの番号から複製されたかを覚える
  `
ALTER TABLE project_masters ADD COLUMN source_number INTEGER;
UPDATE project_masters SET source_number = number
WHERE kind = 'subjects' AND number IN (SELECT id FROM m_subjects);
`,
  // 修正履歴に「どの画面から直したか」を残す
  `
ALTER TABLE detail_change_logs ADD COLUMN origin TEXT NOT NULL DEFAULT '';
`,
  // 基本マスターは部位を持たない（工事側から入り込んだ部位名を消す）
  `
UPDATE m_details SET part_name = '' WHERE scope = 'basic' AND part_name <> '';
`,
  // （欠番）工事側の明細マスターからも部位を消していたが、部位は工事マスターに持たせる
  `
SELECT 1;
`,
  // 部位を消してしまった工事の明細マスターへ、集計書に残っている部位を戻す
  `
UPDATE m_details SET part_name = (
  SELECT d.part_name FROM project_aggregate_details d
  WHERE d.source_detail_id = m_details.id AND d.part_name <> ''
  ORDER BY d.id DESC LIMIT 1
)
WHERE scope = 'project' AND part_name = '' AND EXISTS (
  SELECT 1 FROM project_aggregate_details d
  WHERE d.source_detail_id = m_details.id AND d.part_name <> ''
);
`,
  // 物件専用の明細マスターは基本マスターの複製のまま（部位は集計書兼工事マスターだけが持つ）
  `
UPDATE m_details SET part_name = '' WHERE part_name <> '';
`,
  // 集計書兼工事マスターから書き戻された明細を、基本マスターの内容へ戻す
  `
UPDATE m_details SET
  detail_number = (SELECT b.detail_number FROM m_details b WHERE b.id = m_details.source_detail_id),
  material_category = (SELECT b.material_category FROM m_details b WHERE b.id = m_details.source_detail_id),
  name = (SELECT b.name FROM m_details b WHERE b.id = m_details.source_detail_id),
  description_upper = (SELECT b.description_upper FROM m_details b WHERE b.id = m_details.source_detail_id),
  description_lower = (SELECT b.description_lower FROM m_details b WHERE b.id = m_details.source_detail_id),
  unit = (SELECT b.unit FROM m_details b WHERE b.id = m_details.source_detail_id),
  remarks_upper = (SELECT b.remarks_upper FROM m_details b WHERE b.id = m_details.source_detail_id),
  remarks_lower = (SELECT b.remarks_lower FROM m_details b WHERE b.id = m_details.source_detail_id),
  estimate_display = (SELECT b.estimate_display FROM m_details b WHERE b.id = m_details.source_detail_id)
WHERE scope = 'project' AND source_detail_id IS NOT NULL
  AND (
    SELECT l.origin FROM detail_change_logs l
    WHERE l.detail_id = m_details.id ORDER BY l.id DESC LIMIT 1
  ) = '集計書兼工事マスター';
`,
  // 不要明細（人が印を付けた明細。内訳書へ飛ばさず工種科目の最後にまとめる）
  `
ALTER TABLE project_aggregate_items ADD COLUMN unused INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS project_unused_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  master_key TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unused_details_key
  ON project_unused_details(project_id, master_key);
`,
  // 型枠転記：集計した明細（元明細）を選んで別の明細を算出する
  `
ALTER TABLE project_transfer_rules ADD COLUMN source_keys TEXT NOT NULL DEFAULT '';
ALTER TABLE project_transfer_rules ADD COLUMN formwork TEXT NOT NULL DEFAULT '';
ALTER TABLE project_transfer_rules ADD COLUMN part1 TEXT NOT NULL DEFAULT '';
ALTER TABLE project_transfer_rules ADD COLUMN part2 TEXT NOT NULL DEFAULT '';
ALTER TABLE project_transfer_rules ADD COLUMN part3 TEXT NOT NULL DEFAULT '';
UPDATE project_transfer_rules SET formwork = master_key WHERE formwork = '';
`,
  // 型枠転記：摘要を集計書と同じ2段にする
  `
ALTER TABLE project_transfer_rules ADD COLUMN description_lower TEXT NOT NULL DEFAULT '';
`,
  // 計算書から自動登録した物件セットの目印（使われなくなったら集計時に片付ける）
  `
ALTER TABLE m_finish_assemblies ADD COLUMN auto_registered INTEGER NOT NULL DEFAULT 0;
UPDATE m_finish_assemblies SET auto_registered = 1 WHERE scope = 'project';
`,
  // セット明細は計算式を持たない（計算式は計算書ごとに入れる）
  `
UPDATE m_finish_assembly_items SET formula = '' WHERE formula <> '';
`,
  // 天井伏図のC番号を手で動かした位置
  `
ALTER TABLE project_room_sheets ADD COLUMN ceiling_codes_json TEXT NOT NULL DEFAULT '{}';
`,
  // 内訳書：単位の置き換えと、エクセル掃き出しの1ページの明細数
  `
ALTER TABLE project_breakdown_settings ADD COLUMN unit_replacements_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_breakdown_settings ADD COLUMN details_per_page INTEGER NOT NULL DEFAULT 17;
ALTER TABLE project_breakdown_settings ADD COLUMN details_per_page_later INTEGER NOT NULL DEFAULT 16;
`,
  // 転記入力表：備考も集計書と同じ2段にする
  `
ALTER TABLE project_transfer_rows ADD COLUMN remarks_lower TEXT NOT NULL DEFAULT '';
`,
  // ピット計算書（Ｐ1・Ｐ2…の四角の平面と天井付き梁型から床・壁・天井を拾う）
  `
CREATE TABLE project_pit_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  estimate_row_id INTEGER NOT NULL REFERENCES project_estimate_rows(id) ON DELETE CASCADE,
  pits_json TEXT NOT NULL DEFAULT '[]',
  beams_json TEXT NOT NULL DEFAULT '[]',
  lower_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_pit_sheet_row ON project_pit_sheets(estimate_row_id);
INSERT INTO calc_sheet_definitions (key, name, display_order)
  SELECT 'pit', 'ピット計算書', 3
  WHERE NOT EXISTS (SELECT 1 FROM calc_sheet_definitions WHERE key = 'pit');
`,
  // 物件管理台帳の仕分け用チェック（取引先別などの表示切替に使う）
  `
ALTER TABLE projects ADD COLUMN marks TEXT NOT NULL DEFAULT '';
`,
  // 建具表のW・H・腰高を計算式で入れられるようにする
  `
ALTER TABLE project_fittings ADD COLUMN width_formula TEXT NOT NULL DEFAULT '';
ALTER TABLE project_fittings ADD COLUMN height_formula TEXT NOT NULL DEFAULT '';
ALTER TABLE project_fittings ADD COLUMN sill_height_formula TEXT NOT NULL DEFAULT '';
`,
  // 部屋計算書に図面画像を貼ってなぞれるようにする
  `
ALTER TABLE project_room_sheets ADD COLUMN trace_json TEXT NOT NULL DEFAULT '{}';
`,
  // ピット計算書にも図面画像を貼ってなぞれるようにする
  `
ALTER TABLE project_pit_sheets ADD COLUMN trace_json TEXT NOT NULL DEFAULT '{}';
`,
  // 軸組計算書にも図面画像を貼ってなぞれるようにし、軸組種類（線の色分け）を持たせる
  `
ALTER TABLE project_frame_sheets ADD COLUMN trace_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE project_frame_sheets ADD COLUMN kinds_json TEXT NOT NULL DEFAULT '[]';
`,
  // ピット計算書にピット間（基礎梁）と人通口・スリーブを持たせる
  `
ALTER TABLE project_pit_sheets ADD COLUMN walls_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_pit_sheets ADD COLUMN sleeves_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_pit_sheets ADD COLUMN sleeve_kinds_json TEXT NOT NULL DEFAULT '[]';
`,
  // ピット間の表で長さをまとめる単位（50/100/300/500mm）を選べるようにする
  `
ALTER TABLE project_pit_sheets ADD COLUMN wall_step INTEGER NOT NULL DEFAULT 50;
`,
];
