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
  getRoomSheet,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import {
  getFrameSheet,
  listFrameRooms,
  saveFrameSheet,
} from "../../src/main/services/frameSheetService";
import type { EstimateRowDraft } from "../../src/shared/types";

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
    // 行ごとに1つ（開き直しても同じ計算書）
    expect(getFrameSheet(db, frameRow.id).id).toBe(sheet.id);
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
});
