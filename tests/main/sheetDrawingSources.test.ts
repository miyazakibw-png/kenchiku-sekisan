import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrations } from "../../src/main/db/migrations";
import * as schema from "../../src/main/db/schema";
import { seedInitialData } from "../../src/main/db/seed";
import type { AppDatabase } from "../../src/main/db";
import { createProject } from "../../src/main/services/projectService";
import {
  listSheetDrawingSources,
  saveEstimateRows,
} from "../../src/main/services/estimateRowService";
import {
  getRoomSheet,
  saveRoomSheet,
} from "../../src/main/services/roomSheetService";
import {
  getFrameSheet,
  saveFrameSheet,
} from "../../src/main/services/frameSheetService";
import {
  getPitSheet,
  savePitSheet,
} from "../../src/main/services/pitSheetService";
import type { EstimateRowDraft } from "../../src/shared/types";

function createDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrations.forEach((sql) => sqlite.exec(sql));
  const db = drizzle(sqlite, { schema }) as AppDatabase;
  seedInitialData(db);
  return db;
}

function row(part3: string, calcType: string): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "1階",
    part2: "内部",
    part2Split: 0,
    formwork: "",
    part3,
    ceilingHeight: null,
    multiplier: 1,
    note: "",
    calcType,
  };
}

describe("他の計算書の図面を呼び出す一覧（listSheetDrawingSources）", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb();
  });

  it("部屋計算書（underlays）・軸組計算書（traces）・ピット計算書の図面を行ごとに集める", () => {
    const project = createProject(db, "図面呼び出し");
    const [roomRow, frameRow, pitRow] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("事務室", "room"), row("軸組", "frame"), row("基礎", "pit")],
    });

    saveRoomSheet(db, {
      id: getRoomSheet(db, roomRow.id).id,
      shapeJson: "{}",
      fittingsJson: "[]",
      ceilingJson: "{}",
      lowerJson: "[]",
      ceilingHeight: 2.7,
      note: "",
      traceJson: JSON.stringify({
        underlays: [
          {
            image: "data:room",
            metersPerPixel: 0.01,
            x: 0,
            y: 0,
            opacity: 0.5,
          },
        ],
      }),
    });
    saveFrameSheet(db, {
      id: getFrameSheet(db, frameRow.id).id,
      layoutJson: "[]",
      linesJson: "[]",
      attributesJson: "{}",
      fittingsJson: "[]",
      lowerJson: "[]",
      workHeight: 3.0,
      traceJson: JSON.stringify({
        traces: [
          {
            image: "data:frame",
            metersPerPixel: 0.02,
            x: 1,
            y: 2,
            opacity: 0.7,
          },
        ],
      }),
      kindsJson: "[]",
      note: "",
    });
    savePitSheet(db, {
      id: getPitSheet(db, pitRow.id).id,
      pitsJson: "[]",
      beamsJson: "[]",
      wallsJson: "[]",
      sleevesJson: "[]",
      sleeveKindsJson: "[]",
      lowerJson: "[]",
      wallStep: 0.2,
      note: "",
      traceJson: JSON.stringify({
        underlay: {
          image: "data:pit",
          metersPerPixel: 0.01,
          x: 3,
          y: 4,
          opacity: 0.8,
          scaled: true,
        },
      }),
    });

    const sources = listSheetDrawingSources(db, project.id);
    expect(sources.map((item) => item.calcType).sort()).toEqual([
      "frame",
      "pit",
      "room",
    ]);
    const room = sources.find((item) => item.calcType === "room");
    const frame = sources.find((item) => item.calcType === "frame");
    const pit = sources.find((item) => item.calcType === "pit");
    expect(room?.estimateRowId).toBe(roomRow.id);
    expect(room?.drawings[0]?.image).toBe("data:room");
    // 軸組の traces に入った図面は縮尺済みとして読む
    expect(frame?.estimateRowId).toBe(frameRow.id);
    expect(frame?.drawings[0]?.image).toBe("data:frame");
    expect(frame?.drawings[0]?.scaled).toBe(true);
    expect(pit?.estimateRowId).toBe(pitRow.id);
    expect(pit?.drawings[0]?.image).toBe("data:pit");
  });

  it("図面を置いていない計算書は一覧に出さない", () => {
    const project = createProject(db, "図面なし");
    const [roomRow] = saveEstimateRows(db, {
      projectId: project.id,
      rows: [row("事務室", "room")],
    });
    // 計算書は存在するが図面は無い
    saveRoomSheet(db, {
      id: getRoomSheet(db, roomRow.id).id,
      shapeJson: "{}",
      fittingsJson: "[]",
      ceilingJson: "{}",
      lowerJson: "[]",
      ceilingHeight: 2.7,
      note: "",
      traceJson: "{}",
    });
    expect(listSheetDrawingSources(db, project.id)).toEqual([]);
  });
});
