import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  projectEstimateRows,
  projectFireproofSheets,
  projectFrameSheets,
  projectGeneralSheets,
  projectPitSheets,
  projectRoomSheets,
} from "../db/schema";
import type {
  CalcType,
  EstimateRow,
  SaveEstimateRowsRequest,
  SheetDrawingSource,
} from "../../shared/types";
import { normalizeSets, type CalcSet } from "../../core/room/calcSheet";
import { hasLowerContent } from "../../core/room/lowerTemplate";
import { needsScaleAdjustment, parseUnderlays } from "../../core/room/trace";
import { parseDrawing } from "../../core/fireproof/fireproofDrawing";
import type {
  FrameFitting,
  FrameKind,
  FrameLineAttribute,
  FrameManualLine,
} from "../../core/frame/frame";
import { listCalcErrors } from "./aggregationService";

/** JSON文字列を安全に読む。壊れている・空なら fallback を返す */
function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function toRow(row: typeof projectEstimateRows.$inferSelect): EstimateRow {
  return { ...row, rowType: row.rowType === "subtotal" ? "subtotal" : "room" };
}

/**
 * 計算書に縮尺未調整の図面（下敷き）が残っている行。備考欄の「縮尺調整（未）」表示に使う。
 * 行の「いま選ばれている計算書」だけを見る。昔に別の種類の計算書で置いた図面の記録が
 * 残っていても、その種類は開けないので印を残さない（種類を戻せばまた出る）。
 */
function listUnscaledUnderlayRows(
  db: AppDatabase,
  projectId: number,
): Set<number> {
  const pending = new Set<number>();
  const calcTypes = new Map<number, string>(
    db
      .select({
        id: projectEstimateRows.id,
        calcType: projectEstimateRows.calcType,
      })
      .from(projectEstimateRows)
      .where(eq(projectEstimateRows.projectId, projectId))
      .all()
      .map((row) => [row.id, row.calcType]),
  );
  const collect = (
    sheets: { estimateRowId: number; traceJson: string }[],
    matches: (calcType: string) => boolean,
  ): void => {
    for (const sheet of sheets) {
      const calcType = calcTypes.get(sheet.estimateRowId) ?? "";
      // 種類が分からない行は今までどおり全部の計算書を見て残す
      if (!matches(calcType) && calcType !== "") continue;
      if (needsScaleAdjustment(sheet.traceJson)) {
        pending.add(sheet.estimateRowId);
      }
    }
  };
  collect(
    db
      .select({
        estimateRowId: projectRoomSheets.estimateRowId,
        traceJson: projectRoomSheets.traceJson,
      })
      .from(projectRoomSheets)
      .where(eq(projectRoomSheets.projectId, projectId))
      .all(),
    (calcType) => calcType === "room",
  );
  collect(
    db
      .select({
        estimateRowId: projectFrameSheets.estimateRowId,
        traceJson: projectFrameSheets.traceJson,
      })
      .from(projectFrameSheets)
      .where(eq(projectFrameSheets.projectId, projectId))
      .all(),
    (calcType) => calcType === "frame",
  );
  collect(
    db
      .select({
        estimateRowId: projectPitSheets.estimateRowId,
        traceJson: projectPitSheets.traceJson,
      })
      .from(projectPitSheets)
      .where(eq(projectPitSheets.projectId, projectId))
      .all(),
    (calcType) => calcType === "pit" || calcType === "area",
  );
  return pending;
}

/**
 * 部位別入力表の行ごとに、計算書へ置いてある図面（縮尺・位置・濃さ）を返す。
 * 他の計算書から元図面を呼び出す一覧に使う。部屋・ピット計算書は underlays、
 * 軸組計算書は traces に入っているが、parseUnderlays が両方を読むので同じ手順で集める。
 */
export function listSheetDrawingSources(
  db: AppDatabase,
  projectId: number,
): SheetDrawingSource[] {
  const sources: SheetDrawingSource[] = [];
  const collect = (
    sheets: { estimateRowId: number; traceJson: string }[],
    calcType: CalcType,
  ): void => {
    for (const sheet of sheets) {
      // 呼出元の計算書が縮尺未調整のとき、その図面も未調整として扱う
      // （呼び出した側の計算書にも「縮尺調整（未）」が出る）
      const unscaled = needsScaleAdjustment(sheet.traceJson);
      const drawings = parseUnderlays(sheet.traceJson)
        .filter((item) => item.image !== "")
        .map((item) =>
          unscaled ? { ...item, scaled: false } : item,
        );
      if (drawings.length > 0) {
        sources.push({
          estimateRowId: sheet.estimateRowId,
          calcType,
          drawings,
        });
      }
    }
  };
  collect(
    db
      .select({
        estimateRowId: projectRoomSheets.estimateRowId,
        traceJson: projectRoomSheets.traceJson,
      })
      .from(projectRoomSheets)
      .where(eq(projectRoomSheets.projectId, projectId))
      .all(),
    "room",
  );
  // 軸組計算書は引いた線（＋指定・建具・種類）も一緒に返す。線だけの呼び出しに使う
  for (const sheet of db
    .select({
      estimateRowId: projectFrameSheets.estimateRowId,
      traceJson: projectFrameSheets.traceJson,
      linesJson: projectFrameSheets.linesJson,
      attributesJson: projectFrameSheets.attributesJson,
      fittingsJson: projectFrameSheets.fittingsJson,
      kindsJson: projectFrameSheets.kindsJson,
    })
    .from(projectFrameSheets)
    .where(eq(projectFrameSheets.projectId, projectId))
    .all()) {
    const unscaled = needsScaleAdjustment(sheet.traceJson);
    const drawings = parseUnderlays(sheet.traceJson)
      .filter((item) => item.image !== "")
      .map((item) => (unscaled ? { ...item, scaled: false } : item));
    const lines = parseJson<FrameManualLine[]>(sheet.linesJson, []);
    if (drawings.length > 0 || lines.length > 0) {
      sources.push({
        estimateRowId: sheet.estimateRowId,
        calcType: "frame",
        drawings,
        frame: {
          lines,
          attributes: parseJson<Record<string, FrameLineAttribute>>(
            sheet.attributesJson,
            {},
          ),
          fittings: parseJson<FrameFitting[]>(sheet.fittingsJson, []),
          kinds: parseJson<FrameKind[]>(sheet.kindsJson, []),
        },
      });
    }
  }
  collect(
    db
      .select({
        estimateRowId: projectPitSheets.estimateRowId,
        traceJson: projectPitSheets.traceJson,
      })
      .from(projectPitSheets)
      .where(eq(projectPitSheets.projectId, projectId))
      .all(),
    "pit",
  );
  // 耐火被覆・塗装積算入力の鉄骨伏図（階ごとに書き出した図面）。
  // 計算書の行に結び付かないので estimateRowId は負の仮番号にする
  const fireproof = db
    .select({ drawingJson: projectFireproofSheets.drawingJson })
    .from(projectFireproofSheets)
    .where(eq(projectFireproofSheets.projectId, projectId))
    .get();
  if (fireproof !== undefined) {
    Object.entries(parseDrawing(fireproof.drawingJson).floors).forEach(
      ([name, floor], index) => {
        if (floor.image === "" || floor.pixelsPerMm <= 0) return;
        sources.push({
          estimateRowId: -(index + 1),
          calcType: "fireproof",
          name: `鉄骨伏図 ${name === "R" ? "R" : `${name}F`}`,
          drawings: [
            {
              image: floor.image,
              metersPerPixel: 1 / (floor.pixelsPerMm * 1000),
              x: 0,
              y: 0,
              opacity: 0.9,
              scaled: true,
            },
          ],
        });
      },
    );
  }
  return sources;
}

export function listEstimateRows(
  db: AppDatabase,
  projectId: number,
): EstimateRow[] {
  const unscaled = listUnscaledUnderlayRows(db, projectId);
  const errored = listCalcErrors(db, projectId);
  return db
    .select()
    .from(projectEstimateRows)
    .where(eq(projectEstimateRows.projectId, projectId))
    .orderBy(asc(projectEstimateRows.displayOrder), asc(projectEstimateRows.id))
    .all()
    .map((row) => ({
      ...toRow(row),
      ...(unscaled.has(row.id) ? { scalePending: true } : {}),
      ...(errored.has(row.id) ? { calcError: errored.get(row.id) } : {}),
    }));
}

/** 部位別入力表の一括保存。画面の行順をそのまま display_order にする */
export function saveEstimateRows(
  db: AppDatabase,
  request: SaveEstimateRowsRequest,
): EstimateRow[] {
  const { projectId, rows } = request;
  db.transaction((tx) => {
    const keptIds = rows
      .map((row) => row.id)
      .filter((id): id is number => id !== null);
    const removed = tx
      .select({ id: projectEstimateRows.id })
      .from(projectEstimateRows)
      .where(eq(projectEstimateRows.projectId, projectId))
      .all()
      .map((row) => row.id)
      .filter((id) => !keptIds.includes(id));
    if (removed.length > 0) {
      tx.delete(projectEstimateRows)
        .where(inArray(projectEstimateRows.id, removed))
        .run();
    }

    rows.forEach((row, index) => {
      const values = {
        projectId,
        rowType: row.rowType,
        part1: row.part1,
        part2: row.part2,
        part2Split: row.part2Split,
        formwork: row.formwork,
        part3: row.part3,
        ceilingHeight: row.ceilingHeight,
        multiplier: row.multiplier,
        note: row.note,
        calcType: row.calcType,
        displayOrder: index,
      };
      if (row.id === null) {
        const inserted = tx
          .insert(projectEstimateRows)
          .values(values)
          .returning({ id: projectEstimateRows.id })
          .all();
        const newId = inserted[0]?.id;
        if (newId !== undefined && row.copySourceId != null) {
          copyCalcSheets(tx, projectId, row.copySourceId, newId);
        }
        return;
      }
      tx.update(projectEstimateRows)
        .set(values)
        .where(
          and(
            eq(projectEstimateRows.id, row.id),
            eq(projectEstimateRows.projectId, projectId),
          ),
        )
        .run();
    });
  });
  return listEstimateRows(db, projectId);
}

/** 部屋計算書の下段に中身があるか（初期状態の見出し行＋部位だけなら空と見る） */
function hasRoomLowerContent(lowerJson: string): boolean {
  try {
    const parsed: unknown = JSON.parse(lowerJson);
    if (!Array.isArray(parsed)) return false;
    return hasLowerContent(normalizeSets(parsed as CalcSet[]));
  } catch {
    return false;
  }
}

/** 空の計算書（初期値だけ）かどうかを見る。配列は要素数、部屋形状は辺の数で判断する */
function hasContent(...jsons: string[]): boolean {
  return jsons.some((json) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return false;
    }
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed !== null && typeof parsed === "object") {
      const edges = (parsed as { edges?: unknown }).edges;
      if (Array.isArray(edges)) return edges.length > 0;
      return Object.keys(parsed).length > 0;
    }
    return false;
  });
}

/**
 * 行ごとに、中身の入っている計算書の種類を返す。
 * 種類を変えると集計から外れるので、画面で確認メッセージを出すために使う。
 */
export function listFilledCalcSheets(
  db: AppDatabase,
  projectId: number,
): Record<number, CalcType[]> {
  const filled: Record<number, CalcType[]> = {};
  const add = (rowId: number, calcType: CalcType): void => {
    const list = filled[rowId] ?? [];
    if (!list.includes(calcType)) filled[rowId] = [...list, calcType];
  };

  db.select()
    .from(projectRoomSheets)
    .where(eq(projectRoomSheets.projectId, projectId))
    .all()
    .forEach((sheet) => {
      if (
        hasContent(sheet.shapeJson, sheet.ceilingJson, sheet.fittingsJson) ||
        hasRoomLowerContent(sheet.lowerJson)
      ) {
        add(sheet.estimateRowId, "room");
      }
    });

  db.select()
    .from(projectFrameSheets)
    .where(eq(projectFrameSheets.projectId, projectId))
    .all()
    .forEach((sheet) => {
      if (
        hasContent(
          sheet.layoutJson,
          sheet.linesJson,
          sheet.lowerJson,
          sheet.fittingsJson,
        )
      ) {
        add(sheet.estimateRowId, "frame");
      }
    });

  db.select()
    .from(projectGeneralSheets)
    .where(eq(projectGeneralSheets.projectId, projectId))
    .all()
    .forEach((sheet) => {
      if (hasContent(sheet.lowerJson)) add(sheet.estimateRowId, "general");
    });

  db.select()
    .from(projectPitSheets)
    .where(eq(projectPitSheets.projectId, projectId))
    .all()
    .forEach((sheet) => {
      if (hasContent(sheet.pitsJson, sheet.beamsJson, sheet.lowerJson)) {
        // 面積計算書はピット計算書と同じ表に入るので、どちらの種類にも内容がある扱いにする
        add(sheet.estimateRowId, "pit");
        add(sheet.estimateRowId, "area");
      }
    });

  return filled;
}

/**
 * 行コピーで作った行に、コピー元の計算書（部屋別・軸組・汎用）の中身をそのまま複製する。
 * コピー元に計算書が無ければ何もしない。
 */
function copyCalcSheets(
  tx: AppDatabase,
  projectId: number,
  sourceRowId: number,
  targetRowId: number,
): void {
  const room = tx
    .select()
    .from(projectRoomSheets)
    .where(eq(projectRoomSheets.estimateRowId, sourceRowId))
    .get();
  if (room) {
    tx.insert(projectRoomSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        shapeJson: room.shapeJson,
        fittingsJson: room.fittingsJson,
        ceilingJson: room.ceilingJson,
        lowerJson: room.lowerJson,
        ceilingHeight: room.ceilingHeight,
        traceJson: room.traceJson,
        note: room.note,
      })
      .run();
  }

  const frame = tx
    .select()
    .from(projectFrameSheets)
    .where(eq(projectFrameSheets.estimateRowId, sourceRowId))
    .get();
  if (frame) {
    tx.insert(projectFrameSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        layoutJson: frame.layoutJson,
        linesJson: frame.linesJson,
        attributesJson: frame.attributesJson,
        fittingsJson: frame.fittingsJson,
        lowerJson: frame.lowerJson,
        workHeight: frame.workHeight,
        traceJson: frame.traceJson,
        kindsJson: frame.kindsJson,
        note: frame.note,
      })
      .run();
  }

  const general = tx
    .select()
    .from(projectGeneralSheets)
    .where(eq(projectGeneralSheets.estimateRowId, sourceRowId))
    .get();
  if (general) {
    tx.insert(projectGeneralSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        lowerJson: general.lowerJson,
        note: general.note,
      })
      .run();
  }

  const pit = tx
    .select()
    .from(projectPitSheets)
    .where(eq(projectPitSheets.estimateRowId, sourceRowId))
    .get();
  if (pit) {
    tx.insert(projectPitSheets)
      .values({
        projectId,
        estimateRowId: targetRowId,
        pitsJson: pit.pitsJson,
        beamsJson: pit.beamsJson,
        wallsJson: pit.wallsJson,
        sleevesJson: pit.sleevesJson,
        sleeveKindsJson: pit.sleeveKindsJson,
        wallStep: pit.wallStep,
        lowerJson: pit.lowerJson,
        traceJson: pit.traceJson,
        note: pit.note,
      })
      .run();
  }
}
