/**
 * 1物件だけの掃き出し（書き出し）と読み込み。
 * パソコン2台で同じ工事を続けるための持ち運び用で、
 * 全体バックアップ（積算データの保存・復元）とは別に、選んだ1工事分だけを1ファイルにする。
 * ファイルの中身はこのソフトと同じ形（SQLite）で、その工事の行だけが入っている。
 */
import { existsSync, rmSync } from "fs";
import Database from "better-sqlite3";
import { applyMigrations } from "../db";
import { migrations } from "../db/migrations";

/** 掃き出しファイルに入れる工事の見出し（読み込み前に画面へ出す） */
export interface ProjectFileInfo {
  ok: boolean;
  message: string;
  managementNo: string;
  name: string;
  builderName: string;
  projectDate: string;
  /** このパソコンに同じ管理番号の工事があるか */
  sameManagementNo: boolean;
}

type Row = Record<string, unknown>;

/** 工事に直接ぶら下がる表（project_id で選べるもの） */
const PROJECT_TABLES = [
  "project_masters",
  "project_fittings",
  "project_estimate_rows",
  "project_room_sheets",
  "project_frame_sheets",
  "project_general_sheets",
  "project_pit_sheets",
  "project_misc_sheets",
  "project_furniture_sheets",
  "project_transfer_rows",
  "project_room_finishes",
  "project_fireproof_sheets",
  "project_unused_details",
  "project_transfer_rules",
  "project_breakdown_settings",
  "project_breakdown_versions",
  "project_aggregate_runs",
  "calc_sheet_entries",
  "project_field_values",
] as const;

/** 親の行についてくる表（親のIDで選ぶ） */
const CHILD_TABLES: { table: string; parent: string; column: string }[] = [
  {
    table: "project_aggregate_details",
    parent: "project_aggregate_runs",
    column: "run_id",
  },
  {
    table: "project_aggregate_items",
    parent: "project_aggregate_runs",
    column: "run_id",
  },
  {
    table: "project_breakdown_rows",
    parent: "project_breakdown_versions",
    column: "version_id",
  },
  {
    table: "m_finish_assembly_items",
    parent: "m_finish_assemblies",
    column: "assembly_id",
  },
];

function columnsOf(conn: Database.Database, table: string): string[] {
  const rows = conn.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

function selectRows(
  conn: Database.Database,
  table: string,
  where: string,
  params: unknown[],
): Row[] {
  return conn
    .prepare(`SELECT * FROM ${table} WHERE ${where}`)
    .all(...params) as Row[];
}

/** 行を入れる。id は入れ直して新しい番号にする */
function insertRow(
  conn: Database.Database,
  table: string,
  row: Row,
  columns: string[],
): number {
  const used = columns.filter((name) => name !== "id" && name in row);
  const sql = `INSERT INTO ${table} (${used.join(", ")}) VALUES (${used
    .map(() => "?")
    .join(", ")})`;
  const values = used.map((name) => row[name] ?? null);
  return Number(conn.prepare(sql).run(...values).lastInsertRowid);
}

/** 軸組計算書に置いた部屋の参照（部位別入力表の行ID）を読み込み先の行に付け替える */
function remapLayoutJson(
  layoutJson: unknown,
  rowIdMap: Map<number, number>,
): string {
  if (typeof layoutJson !== "string") return "[]";
  try {
    const placements: unknown = JSON.parse(layoutJson);
    if (!Array.isArray(placements)) return layoutJson;
    return JSON.stringify(
      placements.map((placement: { estimateRowId?: number }) => {
        const mapped =
          placement.estimateRowId === undefined
            ? undefined
            : rowIdMap.get(placement.estimateRowId);
        return mapped === undefined
          ? placement
          : { ...placement, estimateRowId: mapped };
      }),
    );
  } catch {
    return layoutJson;
  }
}

/**
 * 選んだ1工事を1ファイルに書き出す。
 * ファイルはこのソフトと同じ形で作り、その工事の行だけを写す。
 */
export function exportProjectFile(
  source: Database.Database,
  projectId: number,
  destPath: string,
): { managementNo: string; name: string } {
  const project = source
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as Row | undefined;
  if (!project) throw new Error(`工事が見つかりません (id=${projectId})`);

  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${destPath}${suffix}`, { force: true });
  }
  const dest = new Database(destPath);
  try {
    dest.pragma("journal_mode = DELETE");
    dest.pragma("foreign_keys = OFF");
    applyMigrations(dest);
    // 工事の行と、その工事にぶら下がる行だけを写す（IDはそのまま写す）
    dest.exec("BEGIN");
    const copy = (table: string, rows: Row[]): void => {
      if (rows.length === 0) return;
      const columns = columnsOf(dest, table);
      const used = columns.filter((name) => name in rows[0]);
      const sql = `INSERT OR REPLACE INTO ${table} (${used.join(
        ", ",
      )}) VALUES (${used.map(() => "?").join(", ")})`;
      const statement = dest.prepare(sql);
      rows.forEach((row) => {
        statement.run(...used.map((name) => row[name] ?? null));
      });
    };

    copy("projects", [project]);
    // 台帳のユーザー定義列・計算書の定義は、値を読めるようにするため定義もいっしょに入れる
    copy(
      "m_project_fields",
      source.prepare("SELECT * FROM m_project_fields").all() as Row[],
    );
    copy(
      "calc_sheet_definitions",
      source.prepare("SELECT * FROM calc_sheet_definitions").all() as Row[],
    );
    for (const table of PROJECT_TABLES) {
      copy(table, selectRows(source, table, "project_id = ?", [projectId]));
    }
    // 工事専用の明細マスター・仕上明細セット
    copy(
      "m_details",
      selectRows(source, "m_details", "project_id = ?", [projectId]),
    );
    const assemblies = selectRows(
      source,
      "m_finish_assemblies",
      "project_id = ?",
      [projectId],
    );
    copy("m_finish_assemblies", assemblies);
    for (const child of CHILD_TABLES) {
      const parentIds = (
        child.parent === "m_finish_assemblies"
          ? assemblies
          : selectRows(source, child.parent, "project_id = ?", [projectId])
      )
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id));
      if (parentIds.length === 0) continue;
      copy(
        child.table,
        selectRows(
          source,
          child.table,
          `${child.column} IN (${parentIds.map(() => "?").join(", ")})`,
          parentIds,
        ),
      );
    }
    dest.exec("COMMIT");
  } catch (error) {
    try {
      dest.exec("ROLLBACK");
    } catch {
      /* 巻き戻せないときはファイルを消して知らせる */
    }
    dest.close();
    rmSync(destPath, { force: true });
    throw error;
  }
  dest.close();
  return {
    managementNo: String(project.management_no ?? ""),
    name: String(project.name ?? ""),
  };
}

/** 読み込もうとしているファイルが1物件の掃き出しファイルか調べる */
export function checkProjectFile(
  current: Database.Database,
  filePath: string,
): ProjectFileInfo {
  const fail = (message: string): ProjectFileInfo => ({
    ok: false,
    message,
    managementNo: "",
    name: "",
    builderName: "",
    projectDate: "",
    sameManagementNo: false,
  });
  if (!existsSync(filePath)) return fail("ファイルが見つかりません。");
  let conn: Database.Database | null = null;
  try {
    conn = new Database(filePath, { readonly: true, fileMustExist: true });
    const table = conn
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'",
      )
      .get() as { name: string } | undefined;
    if (!table) return fail("このファイルは積算データではありません。");
    const version = conn.pragma("user_version", { simple: true }) as number;
    if (version > migrations.length)
      return fail(
        `新しい版のデータです（版 ${version}）。ソフトを更新してから読み込んでください。`,
      );
    const rows = conn.prepare("SELECT * FROM projects").all() as Row[];
    if (rows.length === 0) return fail("工事が入っていません。");
    if (rows.length > 1)
      return fail(
        `工事が ${rows.length} 件入っています（1物件の掃き出しファイルではありません）。全体の復元は「データ復元」をお使いください。`,
      );
    const row = rows[0];
    const managementNo = String(row.management_no ?? "");
    const same = current
      .prepare("SELECT id FROM projects WHERE management_no = ?")
      .get(managementNo) as { id: number } | undefined;
    return {
      ok: true,
      message: `${managementNo} ${String(row.name ?? "")}`,
      managementNo,
      name: String(row.name ?? ""),
      builderName: String(row.builder_name ?? ""),
      projectDate: String(row.project_date ?? ""),
      sameManagementNo: same !== undefined,
    };
  } catch {
    return fail("ファイルを読めませんでした。");
  } finally {
    conn?.close();
  }
}

/**
 * 工事をまるごと消す。
 * 工事にぶら下がる行は外部キーの決まりでいっしょに消えるが、
 * 外部キーを持たない表（明細の変更履歴など）は個別に消す。
 */
const DELETE_ORDER: { table: string; where: string }[] = [
  {
    table: "project_breakdown_rows",
    where:
      "version_id IN (SELECT id FROM project_breakdown_versions WHERE project_id = ?)",
  },
  {
    table: "project_aggregate_items",
    where:
      "run_id IN (SELECT id FROM project_aggregate_runs WHERE project_id = ?)",
  },
  {
    table: "project_aggregate_details",
    where:
      "run_id IN (SELECT id FROM project_aggregate_runs WHERE project_id = ?)",
  },
  {
    table: "m_finish_assembly_items",
    where:
      "assembly_id IN (SELECT id FROM m_finish_assemblies WHERE project_id = ?)",
  },
];

export function deleteProjectFully(
  conn: Database.Database,
  projectId: number,
): void {
  conn.transaction(() => {
    DELETE_ORDER.forEach(({ table, where }) => {
      conn.prepare(`DELETE FROM ${table} WHERE ${where}`).run(projectId);
    });
    conn
      .prepare("DELETE FROM detail_change_logs WHERE project_id = ?")
      .run(projectId);
    conn.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

/** 同じ管理番号の工事があったときの入れ方 */
export type ImportMode = "replace" | "add";

export interface ImportProjectResult {
  projectId: number;
  managementNo: string;
  name: string;
  /** 置き換えたときは true */
  replaced: boolean;
}

/**
 * 1物件の掃き出しファイルをこのパソコンに読み込む。
 * mode が replace なら同じ管理番号の工事を消してから入れ直し、add なら別の工事として足す。
 * 中のIDはこのパソコンで付け直し、計算書・集計・内訳のつながりも付け替える。
 */
export function importProjectFile(
  target: Database.Database,
  filePath: string,
  mode: ImportMode,
  nextManagementNo: () => string,
): ImportProjectResult {
  const source = new Database(filePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const project = source.prepare("SELECT * FROM projects").get() as
      Row | undefined;
    if (!project) throw new Error("ファイルに工事が入っていません。");
    const fileManagementNo = String(project.management_no ?? "");

    const run = target.transaction((): ImportProjectResult => {
      const existing = target
        .prepare("SELECT id FROM projects WHERE management_no = ?")
        .get(fileManagementNo) as { id: number } | undefined;
      let replaced = false;
      if (existing && mode === "replace") {
        deleteProjectFully(target, existing.id);
        replaced = true;
      }
      const managementNo =
        existing && mode === "add" ? nextManagementNo() : fileManagementNo;
      const orderRow = target
        .prepare("SELECT COALESCE(MAX(display_order), 0) AS n FROM projects")
        .get() as { n: number };

      const projectColumns = columnsOf(target, "projects");
      const newProjectId = insertRow(
        target,
        "projects",
        {
          ...project,
          management_no: managementNo,
          display_order: orderRow.n + 1,
        },
        projectColumns,
      );

      /** 表ごとに、この工事の行を読み込み先へ入れる（IDは付け直す） */
      const put = (
        table: string,
        where: string,
        params: unknown[],
        patch: (row: Row) => Row | null,
      ): Map<number, number> => {
        const map = new Map<number, number>();
        const columns = columnsOf(target, table);
        selectRows(source, table, where, params).forEach((row) => {
          const next = patch(row);
          if (next === null) return;
          const id = insertRow(target, table, next, columns);
          if (typeof row.id === "number") map.set(row.id, id);
        });
        return map;
      };
      const fileProjectId = Number(project.id);
      const byProject = (
        table: string,
        patch: (row: Row) => Row | null = (row) => row,
      ): Map<number, number> =>
        put(table, "project_id = ?", [fileProjectId], (row) => {
          const next = patch(row);
          return next === null ? null : { ...next, project_id: newProjectId };
        });

      // 台帳のユーザー定義列は、このパソコンの列に名前で突き合わせる（無い列は作る）
      const fieldIdMap = new Map<number, number>();
      selectRows(source, "m_project_fields", "1 = 1", []).forEach((field) => {
        const title = String(field.title ?? "");
        const found = target
          .prepare("SELECT id FROM m_project_fields WHERE title = ?")
          .get(title) as { id: number } | undefined;
        const id =
          found?.id ??
          insertRow(
            target,
            "m_project_fields",
            field,
            columnsOf(target, "m_project_fields"),
          );
        if (typeof field.id === "number") fieldIdMap.set(field.id, id);
      });
      byProject("project_field_values", (row) => {
        const fieldId = fieldIdMap.get(Number(row.field_id));
        return fieldId === undefined ? null : { ...row, field_id: fieldId };
      });

      byProject("project_masters");

      // 工事専用の明細マスター
      byProject("m_details", (row) => ({ ...row, scope: "project" }));

      // 工事専用の仕上明細セットと、その中の明細
      const assemblyIdMap = byProject("m_finish_assemblies");
      assemblyIdMap.forEach((newId, oldId) => {
        put("m_finish_assembly_items", "assembly_id = ?", [oldId], (row) => ({
          ...row,
          assembly_id: newId,
        }));
      });

      // 部位別入力表と、その行にぶら下がる計算書
      const rowIdMap = byProject("project_estimate_rows");
      const remapRowId = (row: Row): Row | null => {
        const id = rowIdMap.get(Number(row.estimate_row_id));
        return id === undefined ? null : { ...row, estimate_row_id: id };
      };
      byProject("project_room_sheets", remapRowId);
      byProject("project_frame_sheets", (row) => {
        const next = remapRowId(row);
        return next === null
          ? null
          : {
              ...next,
              layout_json: remapLayoutJson(row.layout_json, rowIdMap),
            };
      });
      byProject("project_general_sheets", remapRowId);
      byProject("project_pit_sheets", remapRowId);

      byProject("project_fittings", (row) => ({
        ...row,
        source_estimate_row_id:
          row.source_estimate_row_id === null
            ? null
            : (rowIdMap.get(Number(row.source_estimate_row_id)) ?? null),
      }));
      byProject("project_room_finishes", (row) => ({
        ...row,
        finish_assembly_id:
          row.finish_assembly_id === null
            ? null
            : (assemblyIdMap.get(Number(row.finish_assembly_id)) ?? null),
      }));
      byProject("project_misc_sheets");
      byProject("project_furniture_sheets");
      const transferRowIdMap = byProject("project_transfer_rows");
      byProject("project_fireproof_sheets");
      byProject("project_unused_details");
      byProject("project_transfer_rules");
      byProject("project_breakdown_settings");

      // 計算書の定義は、このパソコンの定義に目印（key）で突き合わせる
      byProject("calc_sheet_entries", (row) => {
        const definition = source
          .prepare("SELECT key FROM calc_sheet_definitions WHERE id = ?")
          .get(row.definition_id) as { key: string } | undefined;
        if (!definition) return null;
        const here = target
          .prepare("SELECT id FROM calc_sheet_definitions WHERE key = ?")
          .get(definition.key) as { id: number } | undefined;
        return here === undefined ? null : { ...row, definition_id: here.id };
      });

      // 集計（数量根拠）と内訳書の版
      const runIdMap = byProject("project_aggregate_runs");
      runIdMap.forEach((newRunId, oldRunId) => {
        put("project_aggregate_details", "run_id = ?", [oldRunId], (row) => ({
          ...row,
          run_id: newRunId,
          estimate_row_id:
            row.estimate_row_id === null
              ? null
              : (rowIdMap.get(Number(row.estimate_row_id)) ?? null),
          transfer_row_id:
            row.transfer_row_id === null
              ? null
              : (transferRowIdMap.get(Number(row.transfer_row_id)) ?? null),
        }));
        put("project_aggregate_items", "run_id = ?", [oldRunId], (row) => ({
          ...row,
          run_id: newRunId,
        }));
      });
      const versionIdMap = byProject("project_breakdown_versions", (row) => ({
        ...row,
        aggregate_run_id:
          row.aggregate_run_id === null
            ? null
            : (runIdMap.get(Number(row.aggregate_run_id)) ?? null),
      }));
      versionIdMap.forEach((newVersionId, oldVersionId) => {
        put(
          "project_breakdown_rows",
          "version_id = ?",
          [oldVersionId],
          (row) => ({ ...row, version_id: newVersionId }),
        );
      });

      return {
        projectId: newProjectId,
        managementNo,
        name: String(project.name ?? ""),
        replaced,
      };
    });

    return run();
  } finally {
    source.close();
  }
}
