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
import { listMasterOptions } from "../../src/main/services/detailService";
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

function draft(patch: Partial<EstimateRowDraft>): EstimateRowDraft {
  return {
    id: null,
    rowType: "room",
    part1: "",
    part2: "",
    part2Split: 0,
    formwork: "",
    part3: "",
    ceilingHeight: null,
    multiplier: 1,
    note: "",
    calcType: "room",
    ...patch,
  };
}

let db: AppDatabase;
let projectId: number;

beforeEach(() => {
  db = createDb();
  projectId = createProject(db, "テスト工事").id;
});

function setRoomLower(
  estimateRowId: number,
  lowerJson: string,
  note?: string,
): void {
  const sheet = getRoomSheet(db, estimateRowId);
  saveRoomSheet(db, {
    id: sheet.id,
    shapeJson: sheet.shapeJson,
    fittingsJson: sheet.fittingsJson,
    ceilingJson: sheet.ceilingJson,
    lowerJson,
    ceilingHeight: sheet.ceilingHeight,
    traceJson: sheet.traceJson,
    note: note ?? sheet.note,
  });
}

describe("部位別入力表", () => {
  it("画面の行順で保存し、同じ順で読み出せる", () => {
    const saved = saveEstimateRows(db, {
      projectId,
      rows: [
        draft({
          part1: "内部",
          part2: "1階",
          part3: "風除室",
          ceilingHeight: 2.5,
        }),
        draft({ part3: "玄関ホール", ceilingHeight: 2.7 }),
        draft({ rowType: "subtotal", part3: "小計", multiplier: 0 }),
      ],
    });
    expect(saved.map((row) => row.part3)).toEqual([
      "風除室",
      "玄関ホール",
      "小計",
    ]);
    expect(saved.map((row) => row.displayOrder)).toEqual([0, 1, 2]);
    expect(saved[2].rowType).toBe("subtotal");
    expect(listEstimateRows(db, projectId)).toEqual(saved);
  });

  it("部位Ⅱ別仕訳・型枠・計算タイプを保持する", () => {
    const [row] = saveEstimateRows(db, {
      projectId,
      rows: [
        draft({
          part2: "1階",
          part2Split: 1,
          formwork: "地上階",
          calcType: "frame",
        }),
      ],
    });
    expect(row).toMatchObject({
      part2Split: 1,
      formwork: "地上階",
      calcType: "frame",
    });
  });

  it("画面から消えた行は削除する", () => {
    const saved = saveEstimateRows(db, {
      projectId,
      rows: [draft({ part3: "A" }), draft({ part3: "B" })],
    });
    const kept = saveEstimateRows(db, {
      projectId,
      rows: [{ ...saved[1], id: saved[1].id }],
    });
    expect(kept.map((row) => row.part3)).toEqual(["B"]);
  });

  it("消した行の計算書も一緒に消える（読み直しで戻らない）", () => {
    const saved = saveEstimateRows(db, {
      projectId,
      rows: [draft({ part3: "風除室" }), draft({ part3: "玄関ホール" })],
    });
    const sheet = getRoomSheet(db, saved[0].id);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: sheet.shapeJson,
      fittingsJson: sheet.fittingsJson,
      ceilingJson: sheet.ceilingJson,
      lowerJson: '[{"id":"set-1","detail":"床仕上"}]',
      ceilingHeight: 2.5,
      note: "消す部屋の計算書",
    });

    saveEstimateRows(db, { projectId, rows: [{ ...saved[1] }] });
    expect(listEstimateRows(db, projectId).map((row) => row.part3)).toEqual([
      "玄関ホール",
    ]);
    expect(getRoomSheet(db, saved[1].id).note).not.toBe("消す部屋の計算書");
  });

  it("物件ごとに独立している", () => {
    const other = createProject(db, "別工事").id;
    saveEstimateRows(db, { projectId, rows: [draft({ part3: "風除室" })] });
    expect(listEstimateRows(db, other)).toEqual([]);
  });

  it("行コピーの貼付は計算書の中身も複製し、コピー元とは切り離す", () => {
    const [source] = saveEstimateRows(db, {
      projectId,
      rows: [draft({ part3: "風除室", ceilingHeight: 2.5 })],
    });
    const sheet = getRoomSheet(db, source.id);
    saveRoomSheet(db, {
      id: sheet.id,
      shapeJson: sheet.shapeJson,
      fittingsJson: sheet.fittingsJson,
      ceilingJson: sheet.ceilingJson,
      lowerJson: '[{"id":"set-1","detail":"床仕上"}]',
      ceilingHeight: 2.5,
      traceJson: '{"underlays":[{"image":"data:png","x":1}]}',
      note: "もとの計算書",
    });

    const saved = saveEstimateRows(db, {
      projectId,
      rows: [
        { ...source },
        draft({
          part3: "風除室（コピー）",
          ceilingHeight: 2.5,
          copySourceId: source.id,
        }),
      ],
    });
    const copiedSheet = getRoomSheet(db, saved[1].id);
    expect(copiedSheet.lowerJson).toBe('[{"id":"set-1","detail":"床仕上"}]');
    expect(copiedSheet.note).toBe("もとの計算書");
    // 下図（貼り付けた図面）も一緒に写る
    expect(copiedSheet.traceJson).toBe(
      '{"underlays":[{"image":"data:png","x":1}]}',
    );
    expect(copiedSheet.id).not.toBe(sheet.id);

    saveRoomSheet(db, {
      id: copiedSheet.id,
      shapeJson: copiedSheet.shapeJson,
      fittingsJson: copiedSheet.fittingsJson,
      ceilingJson: copiedSheet.ceilingJson,
      lowerJson: "[]",
      ceilingHeight: 2.5,
      note: "直した計算書",
    });
    expect(getRoomSheet(db, source.id).note).toBe("もとの計算書");
  });

  it("行コピーの貼付はピット計算書の下図も複製する", () => {
    const [source] = saveEstimateRows(db, {
      projectId,
      rows: [draft({ part3: "基礎階ピット", calcType: "pit" })],
    });
    const sheet = getPitSheet(db, source.id);
    savePitSheet(db, {
      id: sheet.id,
      pitsJson: sheet.pitsJson,
      beamsJson: sheet.beamsJson,
      wallsJson: sheet.wallsJson,
      sleevesJson: sheet.sleevesJson,
      sleeveKindsJson: sheet.sleeveKindsJson,
      wallStep: sheet.wallStep,
      lowerJson: '[{"id":"set-1","detail":"床仕上"}]',
      traceJson: '{"underlays":[{"image":"data:png","x":-17.4}]}',
      note: "ピット計算書",
    });

    const saved = saveEstimateRows(db, {
      projectId,
      rows: [
        { ...source },
        draft({ part3: "コピー", calcType: "pit", copySourceId: source.id }),
      ],
    });
    const copiedSheet = getPitSheet(db, saved[1].id);
    expect(copiedSheet.traceJson).toBe(
      '{"underlays":[{"image":"data:png","x":-17.4}]}',
    );
    expect(copiedSheet.note).toBe("ピット計算書");
    expect(copiedSheet.id).not.toBe(sheet.id);
  });

  it("入力済み行への貼付は既存の計算書を置き換え、行の天井高さを保つ", () => {
    const [source, target] = saveEstimateRows(db, {
      projectId,
      rows: [
        draft({ part3: "コピー元", ceilingHeight: 2.5 }),
        draft({ part3: "入力済み", ceilingHeight: 2.7, calcType: "pit" }),
      ],
    });
    const originalTargetRoom = getRoomSheet(db, target.id);
    setRoomLower(source.id, '[{"id":"source-sheet"}]', "コピー元計算書");
    saveRoomSheet(db, {
      id: originalTargetRoom.id,
      shapeJson: originalTargetRoom.shapeJson,
      fittingsJson: originalTargetRoom.fittingsJson,
      ceilingJson: originalTargetRoom.ceilingJson,
      lowerJson: '[{"id":"old-target-sheet"}]',
      ceilingHeight: 2.7,
      traceJson: originalTargetRoom.traceJson,
      note: "古い部屋計算書",
    });
    const targetPit = getPitSheet(db, target.id);
    savePitSheet(db, {
      id: targetPit.id,
      pitsJson: targetPit.pitsJson,
      beamsJson: targetPit.beamsJson,
      wallsJson: targetPit.wallsJson,
      sleevesJson: targetPit.sleevesJson,
      sleeveKindsJson: targetPit.sleeveKindsJson,
      wallStep: targetPit.wallStep,
      lowerJson: '[{"id":"old-pit-sheet"}]',
      traceJson: targetPit.traceJson,
      note: "古いピット計算書",
    });

    const saved = saveEstimateRows(db, {
      projectId,
      rows: [
        source,
        { ...target, calcType: source.calcType, copySourceId: source.id },
      ],
    });

    const savedTarget = saved[1];
    const replacement = getRoomSheet(db, savedTarget.id);
    expect(savedTarget).toMatchObject({
      id: target.id,
      ceilingHeight: 2.7,
    });
    expect(replacement.lowerJson).toBe('[{"id":"source-sheet"}]');
    expect(replacement.ceilingHeight).toBe(2.7);
    expect(replacement.note).toBe("コピー元計算書");
    expect(replacement.id).not.toBe(originalTargetRoom.id);
    expect(
      db
        .select()
        .from(schema.projectPitSheets)
        .all()
        .some((sheet) => sheet.estimateRowId === target.id),
    ).toBe(false);
    expect(getRoomSheet(db, source.id).lowerJson).toBe(
      '[{"id":"source-sheet"}]',
    );
  });

  it("重なる行範囲を上書きしても後続行には元の計算書を複製する", () => {
    const [source1, source2, target3] = saveEstimateRows(db, {
      projectId,
      rows: [
        draft({ part3: "1行目", ceilingHeight: 2.5 }),
        draft({ part3: "2行目", ceilingHeight: 2.6 }),
        draft({ part3: "3行目", ceilingHeight: 2.7 }),
      ],
    });
    setRoomLower(source1.id, '[{"id":"original-row-1"}]');
    setRoomLower(source2.id, '[{"id":"original-row-2"}]');
    setRoomLower(target3.id, '[{"id":"original-row-3"}]');

    const saved = saveEstimateRows(db, {
      projectId,
      rows: [
        source1,
        { ...source2, copySourceId: source1.id },
        { ...target3, copySourceId: source2.id },
      ],
    });

    expect(getRoomSheet(db, saved[1].id).lowerJson).toBe(
      '[{"id":"original-row-1"}]',
    );
    expect(getRoomSheet(db, saved[2].id).lowerJson).toBe(
      '[{"id":"original-row-2"}]',
    );
    expect(getRoomSheet(db, source1.id).lowerJson).toBe(
      '[{"id":"original-row-1"}]',
    );
  });

  it("同じ保存で削除されるコピー元からも計算書を複製できる", () => {
    const [source] = saveEstimateRows(db, {
      projectId,
      rows: [draft({ part3: "コピー元", ceilingHeight: 2.5 })],
    });
    setRoomLower(source.id, '[{"id":"deleted-source-sheet"}]');

    const [copy] = saveEstimateRows(db, {
      projectId,
      rows: [
        draft({
          part3: "コピー先",
          ceilingHeight: 2.5,
          copySourceId: source.id,
        }),
      ],
    });

    expect(copy.id).not.toBe(source.id);
    expect(getRoomSheet(db, copy.id).lowerJson).toBe(
      '[{"id":"deleted-source-sheet"}]',
    );
    expect(listEstimateRows(db, projectId).map((row) => row.part3)).toEqual([
      "コピー先",
    ]);
  });

  it("物件コピーで部位別入力表も複製し、コピー元とは切り離す", () => {
    saveEstimateRows(db, {
      projectId,
      rows: [draft({ part3: "風除室", ceilingHeight: 2.5 })],
    });
    const copied = copyProject(db, projectId, "コピー工事");
    const copiedRows = listEstimateRows(db, copied.id);
    expect(copiedRows.map((row) => row.part3)).toEqual(["風除室"]);

    saveEstimateRows(db, {
      projectId: copied.id,
      rows: [{ ...copiedRows[0], part3: "倉庫" }],
    });
    expect(listEstimateRows(db, projectId)[0].part3).toBe("風除室");
  });
});

describe("計算書の書式", () => {
  it("5書式（部屋別・軸組・汎用・ピット・面積）を選べる", () => {
    expect(listMasterOptions(db).calcSheets.map((sheet) => sheet.key)).toEqual([
      "room",
      "frame",
      "general",
      "pit",
      "area",
    ]);
  });

  it("型枠分類は番号入力用にIDと名称を返す", () => {
    expect(listMasterOptions(db).formworkCategories).toEqual([
      { id: 1, name: "基礎階" },
      { id: 2, name: "地下階" },
      { id: 3, name: "地上階" },
    ]);
  });
});

describe("縮尺調整（未）の印", () => {
  it("行のいまの計算書種類だけを見る（別種類に残った印は出さない）", () => {
    const [row] = saveEstimateRows(db, {
      projectId,
      rows: [draft({ part3: "部屋A", calcType: "room" })],
    });
    // 部屋計算書の図面は縮尺合わせ済み（scaled:true・印なし）
    const roomSheet = getRoomSheet(db, row.id);
    saveRoomSheet(db, {
      id: roomSheet.id,
      shapeJson: '{"edges":[]}',
      fittingsJson: "[]",
      ceilingJson: "[]",
      lowerJson: "[]",
      ceilingHeight: 2.4,
      traceJson: JSON.stringify({
        underlays: [
          {
            image: "data:image/png;base64,AA==",
            metersPerPixel: 0.01,
            x: 0,
            y: 0,
            opacity: 0.75,
            scaled: true,
          },
        ],
      }),
      note: "",
    });
    // 前に軸組計算書で置いた図面の「縮尺合わせがまだ」の印が残っている
    const frame = getFrameSheet(db, row.id);
    saveFrameSheet(db, {
      id: frame.id,
      layoutJson: "[]",
      linesJson: "[]",
      attributesJson: "{}",
      fittingsJson: "[]",
      lowerJson: "[]",
      workHeight: 2.4,
      traceJson: JSON.stringify({ traces: [], scalePending: true }),
      kindsJson: "[]",
      note: "",
    });
    // 行の種類は部屋別のまま → 軸組の印は出ない
    expect(listEstimateRows(db, projectId)[0].scalePending).toBeUndefined();
    // 種類を軸組に戻すとその計算書の印が出る
    saveEstimateRows(db, {
      projectId,
      rows: [{ ...draft({ part3: "部屋A", calcType: "frame" }), id: row.id }],
    });
    expect(listEstimateRows(db, projectId)[0].scalePending).toBe(true);
  });
});
