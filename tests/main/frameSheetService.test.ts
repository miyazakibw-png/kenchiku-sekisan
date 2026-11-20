import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import {
  copyProject,
  createProject,
} from "../../src/main/services/projectService";
import {
  listEstimateRows,
  saveEstimateRows,
} from "../../src/main/services/estimateRowService";
import {
  getLowerTemplate,
  getRoomSheet,
  saveLowerTemplate,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import {
  getFrameSheet,
  listFrameRooms,
  listFrameSheets,
  saveFrameSheet,
} from "../../src/main/services/frameSheetService";
import type { EstimateRowDraft } from "../../src/shared/types";
import {
  calcSet,
  commentSet,
  isCommentSet,
  type CalcSet,
} from "../../src/core/room/calcSheet";
import { lowerTemplateFrom } from "../../src/core/room/lowerTemplate";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function row(
  part3: string,
  calcType: string,
  ceilingHeight: number | null,
): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "1階",
    part2: "内部",
    part2Split: 0,
    formwork: "",
    part3,
    ceilingHeight,
    multiplier: 1,
    note: "",
    calcType,
  };
}

describe("軸組計算書", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("部位別入力表の行から作り、施工高さに天井高さを引き継ぐ", () => {
    const project = createProject(db, "軸組テスト");
    const [frameRow] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("1階軸組", "frame", 2.7)],
    });

    const sheet = getFrameSheet(db, frameRow.id);
    expect(sheet.estimateRowId).toBe(frameRow.id);
    expect(sheet.workHeight).toBe(2.7);
    expect(sheet.layoutJson).toBe("[]");
    expect(sheet.lowerJson).toBe("[]");
    // 行ごとに1つ（開き直しても同じ計算書）
    expect(getFrameSheet(db, frameRow.id).id).toBe(sheet.id);
  });

  it("新しい軸組計算書は軸組用の初期状態を使い、明細とIDを作り直す", () => {
    const project = createProject(db, "軸組初期状態");
    const [frameRow] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("軸組A", "frame", 2.7)],
    });

    const part = calcSet(1);
    part.partName = "壁";
    part.details[0].name = "旧明細";
    part.lines[0].formulaA = "3*2";
    const template = lowerTemplateFrom([
      commentSet("軸組見出し", "#dbeafe"),
      part,
    ]);
    const templateJson = JSON.stringify(template);
    saveLowerTemplate(db, "frame", templateJson);

    const sheet = getFrameSheet(db, frameRow.id);
    const sets = JSON.parse(sheet.lowerJson) as CalcSet[];
    expect(sets.map((set) => set.banner?.text ?? set.partName)).toEqual([
      "軸組見出し",
      "壁",
    ]);
    expect(sets[1].details[0].name).toBe("");
    expect(sets[1].lines[0].formulaA).toBe("");
    const templateIds = new Set(
      template.flatMap((set) => [
        set.id,
        ...set.details.map((detail) => detail.id),
        ...set.lines.map((line) => line.id),
      ]),
    );
    const createdIds = sets.flatMap((set) => [
      set.id,
      ...set.details.map((detail) => detail.id),
      ...set.lines.map((line) => line.id),
    ]);
    expect(new Set(createdIds).size).toBe(createdIds.length);
    expect(createdIds.some((id) => templateIds.has(id))).toBe(false);
    expect(isCommentSet(sets[0])).toBe(true);
    expect(getLowerTemplate(db, "frame")).toBe(templateJson);
  });

  it("レイアウト・軸組ライン・下段を保存して開き直せる", () => {
    const project = createProject(db, "保存テスト");
    const [frameRow] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("1階軸組", "frame", null)],
    });
    const sheet = getFrameSheet(db, frameRow.id);

    saveFrameSheet(db, {
      id: sheet.id,
      layoutJson: '[{"id":"p1","estimateRowId":9,"roomName":"内部 事務室"}]',
      linesJson: '[{"id":"m1","x1":0,"y1":0,"x2":3,"y2":0}]',
      attributesJson: '{"m1":{"wallKind":"LGS65"}}',
      fittingsJson: '[{"id":"f1","symbol":"SD-2","multiplier":1}]',
      lowerJson: '[{"id":"s1"}]',
      workHeight: 3.2,
      traceJson: "{}",
      kindsJson: "[]",
      note: "",
    });

    const reopened = getFrameSheet(db, frameRow.id);
    expect(reopened.workHeight).toBe(3.2);
    expect(reopened.linesJson).toContain('"m1"');
    expect(reopened.attributesJson).toContain("LGS65");
    expect(reopened.fittingsJson).toContain("SD-2");
    expect(reopened.lowerJson).toContain('"s1"');
  });

  it("施工高さを保存すると部位別入力表の天井高さへも書き戻す", () => {
    const project = createProject(db, "高さ連動");
    const [frameRow] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("1階軸組", "frame", 2.7)],
    });
    const sheet = getFrameSheet(db, frameRow.id);

    saveFrameSheet(db, {
      id: sheet.id,
      layoutJson: "[]",
      linesJson: "[]",
      attributesJson: "{}",
      fittingsJson: "[]",
      lowerJson: "[]",
      workHeight: 3.5,
      traceJson: "{}",
      kindsJson: "[]",
      note: "",
    });

    const saved = listEstimateRows(db, project.id).find(
      (each) => each.id === frameRow.id,
    );
    expect(saved?.ceilingHeight).toBe(3.5);
  });

  it("置ける部屋は部屋計算書を作った行だけで、部屋名は部位Ⅱ＋部位Ⅲ", () => {
    const project = createProject(db, "部屋一覧");
    const rows = saveEstimateRows(db, {
      projectId: project.id,
      rows: [
        row("事務室", "room", 2.5),
        row("倉庫", "room", 2.4),
        row("1階軸組", "frame", null),
      ],
    });
    getRoomSheet(db, rows[0].id);

    const rooms = listFrameRooms(db, project.id);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].roomName).toBe("内部 事務室");
    expect(rooms[0].estimateRowId).toBe(rows[0].id);
  });

  it("物件をコピーすると軸組計算書も複製され、置いた部屋の参照が付け替わる", () => {
    const project = createProject(db, "コピー元");
    const rows = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("事務室", "room", 2.5), row("1階軸組", "frame", 2.5)],
    });
    const roomSheet = getRoomSheet(db, rows[0].id);
    saveRoomSheet(db, {
      id: roomSheet.id,
      shapeJson:
        '{"edges":[{"id":"a","direction":"E","length":4,"kind":"wall"}]}',
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: "[]",
      ceilingHeight: 2.5,
      note: "",
    });
    const frameSheet = getFrameSheet(db, rows[1].id);
    saveFrameSheet(db, {
      id: frameSheet.id,
      layoutJson: `[{"id":"p1","estimateRowId":${rows[0].id},"roomName":"内部 事務室","x":0,"y":0,"color":"#1d4ed8"}]`,
      linesJson: "[]",
      attributesJson: "{}",
      fittingsJson: "[]",
      lowerJson: "[]",
      workHeight: 2.9,
      traceJson: "{}",
      kindsJson: "[]",
      note: "",
    });

    const copied = copyProject(db, project.id, "コピー先");
    const copiedRows = listEstimateRows(db, copied.id);
    const copiedFrame = getFrameSheet(
      db,
      copiedRows.find((each) => each.calcType === "frame")?.id as number,
    );
    const copiedRoomRowId = copiedRows.find(
      (each) => each.calcType === "room",
    )?.id;

    expect(copiedFrame.workHeight).toBe(2.9);
    expect(copiedFrame.layoutJson).toContain(
      `"estimateRowId":${copiedRoomRowId}`,
    );
    // コピー元の行は参照しない（完全に切り離す）
    expect(copiedFrame.layoutJson).not.toContain(
      `"estimateRowId":${rows[0].id}`,
    );
  });

  it("計算書一覧は作ってある計算書だけを、部位Ⅱ＋部位Ⅲの名前で出す", () => {
    const project = createProject(db, "一覧テスト");
    const rows = saveEstimateRows(db, {
      projectId: project.id,
      rows: [
        row("1階軸組", "frame", 2.7),
        row("2階軸組", "frame", 2.7),
        row("未作成", "frame", null),
      ],
    });
    getFrameSheet(db, rows[0].id);
    getFrameSheet(db, rows[1].id);

    const sheets = listFrameSheets(db, project.id);
    expect(sheets.map((one) => one.roomName)).toEqual([
      "内部 1階軸組",
      "内部 2階軸組",
    ]);
    expect(sheets.map((one) => one.estimateRowId)).toEqual([
      rows[0].id,
      rows[1].id,
    ]);
  });
});
