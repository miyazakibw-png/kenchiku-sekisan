import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "../../src/main/db";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import { createProject } from "../../src/main/services/projectService";
import {
  createMiscSheet,
  deleteMiscSheet,
  getMiscSheet,
  listMiscSheets,
  pasteMiscSheets,
  copyMiscSheetsFromProject,
  saveMiscSheet,
  saveMiscSheetList,
} from "../../src/main/services/miscSheetService";
import {
  miscColumn,
  miscRow,
  type MiscColumn,
  type MiscRow,
} from "../../src/core/misc/miscSheet";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

describe("部位別雑・金物入力表の管理表", () => {
  let db: AppDatabase;
  let projectId: number;

  beforeEach(() => {
    db = createDb();
    projectId = createProject(db, "雑・金物テスト").id;
  });

  it("はじめは1枚（前からある入力がそのまま1行目に出る）", () => {
    const sheets = listMiscSheets(db, projectId);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("部位別雑・金物入力表");
  });

  it("何枚でも作れて、それぞれ別の入力を持つ", () => {
    const first = listMiscSheets(db, projectId)[0];
    saveMiscSheet(db, {
      id: first.id,
      name: first.name,
      columnsJson: JSON.stringify([{ id: "mc1" }]),
      rowsJson: "[]",
      note: "",
    });
    const second = createMiscSheet(db, projectId, "2階 雑");

    const sheets = listMiscSheets(db, projectId);
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "部位別雑・金物入力表",
      "2階 雑",
    ]);
    expect(sheets[0].columnCount).toBe(1);
    expect(getMiscSheet(db, second.id).columnsJson).toBe("[]");
  });

  it("表をコピーして貼り付けると中の入力ごと写り、明細のidは新しくなる", () => {
    const first = listMiscSheets(db, projectId)[0];
    const column = miscColumn({ name: "消火器" });
    const row = miscRow({ part3: "廊下", values: { [column.id]: "4" } });
    saveMiscSheet(db, {
      id: first.id,
      name: first.name,
      columnsJson: JSON.stringify([column]),
      rowsJson: JSON.stringify([row]),
      note: "",
    });

    const pasted = pasteMiscSheets(db, projectId, [first.id], 0);
    expect(pasted).toHaveLength(2);
    expect(pasted[0].name).toBe("部位別雑・金物入力表 の写し");

    const copy = getMiscSheet(db, pasted[0].id);
    const columns = JSON.parse(copy.columnsJson) as MiscColumn[];
    const rows = JSON.parse(copy.rowsJson) as MiscRow[];
    expect(columns[0].name).toBe("消火器");
    expect(columns[0].id).not.toBe(column.id);
    expect(rows[0].values[columns[0].id]).toBe("4");
  });

  it("他の物件の表を写すと末尾に入り、部屋の行は元の物件の部位別入力表との結び付きを外して手で足した行にする", () => {
    const other = createProject(db, "元の物件").id;
    const source = listMiscSheets(db, other)[0];
    const column = miscColumn({ name: "消火器" });
    const rowA = miscRow({
      part3: "廊下",
      estimateRowId: 999,
      values: { [column.id]: "4" },
    });
    const rowB = miscRow({
      part3: "事務室",
      anchorRowId: rowA.id,
      values: { [column.id]: "2" },
    });
    saveMiscSheet(db, {
      id: source.id,
      name: source.name,
      columnsJson: JSON.stringify([column]),
      rowsJson: JSON.stringify([rowA, rowB]),
      note: "元のメモ",
    });
    const second = createMiscSheet(db, other, "2枚目");

    expect(listMiscSheets(db, projectId)).toHaveLength(1);
    const result = copyMiscSheetsFromProject(db, projectId, [
      second.id,
      source.id,
    ]);
    expect(result.map((sheet) => sheet.name)).toEqual([
      "部位別雑・金物入力表",
      "2枚目",
      "部位別雑・金物入力表",
    ]);
    expect(result[2].note).toBe("元のメモ");

    const copy = getMiscSheet(db, result[2].id);
    const columns = JSON.parse(copy.columnsJson) as MiscColumn[];
    const rows = JSON.parse(copy.rowsJson) as MiscRow[];
    expect(columns[0].name).toBe("消火器");
    expect(columns[0].id).not.toBe(column.id);
    expect(rows.map((row) => row.part3)).toEqual(["廊下", "事務室"]);
    expect(rows.map((row) => row.estimateRowId)).toEqual([null, null]);
    expect(rows[0].anchorRowId).toBeNull();
    expect(rows[1].anchorRowId).toBe(rows[0].id);
    expect(rows[0].values[columns[0].id]).toBe("4");
    expect(rows[1].values[columns[0].id]).toBe("2");

    // 元の物件はそのまま
    expect(listMiscSheets(db, other)).toHaveLength(2);
  });

  it("自分の物件の表や無い表は他の物件からの写しには含めない", () => {
    const own = listMiscSheets(db, projectId)[0];
    const result = copyMiscSheetsFromProject(db, projectId, [own.id, 9999]);
    expect(result).toHaveLength(1);
    expect(copyMiscSheetsFromProject(db, projectId, [])).toHaveLength(1);
  });

  it("名前と並び順を保存でき、消した表だけ消える", () => {
    const first = listMiscSheets(db, projectId)[0];
    const second = createMiscSheet(db, projectId, "2枚目");

    const swapped = saveMiscSheetList(db, projectId, [
      { ...second, name: "先に見る表" },
      first,
    ]);
    expect(swapped.map((sheet) => sheet.name)).toEqual([
      "先に見る表",
      "部位別雑・金物入力表",
    ]);

    deleteMiscSheet(db, second.id);
    const rest = listMiscSheets(db, projectId);
    expect(rest).toHaveLength(1);
    expect(rest[0].id).toBe(first.id);
  });
});
