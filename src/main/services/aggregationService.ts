/**
 * 集計処理。
 * 部位別入力表の行→計算書（部屋別・軸組・汎用）の下段セット明細と転記入力表を読み、
 * 集計詳細データ（合算前）と集計書兼工事マスター（合算後）を作って保存する。
 * 集計をかけ直しても過去の回は消さず、実行ごとに版を残す。
 */

import { asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  projectAggregateDetails,
  projectAggregateItems,
  projectAggregateRuns,
  projectEstimateRows,
  projectFittings,
  projectFrameSheets,
  projectGeneralSheets,
  projectRoomSheets,
  projectTransferRows,
} from "../db/schema";
import {
  aggregateItems,
  entriesFromCalcSheet,
  masterKeyOf,
  type AggregateEntry,
  type AggregatedItem,
} from "../../core/aggregate/aggregate";
import { calcVariables } from "../../core/aggregate/variables";
import { inheritTransferRows } from "../../core/aggregate/transferInherit";
import { listProjectSubjects } from "./projectMasterService";
import { getDeductionLimit } from "./roomSheetService";
import {
  displayedValue,
  evaluateCalcSheet,
  type CalcSet,
} from "../../core/room/calcSheet";
import {
  roomSymbols,
  solveShape,
  type RoomFitting,
  type RoomShape,
} from "../../core/room/shape";
import {
  ceilingQuantities,
  ceilingSymbols,
  type CeilingElement,
} from "../../core/room/ceiling";
import {
  buildFrameLines,
  frameQuantities,
  frameSymbols,
  type FrameFitting,
  type FrameLineAttribute,
  type FrameManualLine,
  type FramePlacement,
} from "../../core/frame/frame";
import { computeFitting } from "../../core/fittings/fitting";
import type {
  AggregateDetail,
  AggregateItem,
  AggregateRun,
  AggregateView,
} from "../../shared/types";

function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

interface RoomFittingInput {
  symbol: string;
  multiplier: number;
  edgeId: string | null;
}

interface FrameFittingInput {
  id: string;
  symbol: string;
  multiplier: number;
  lineId: string | null;
}

/** 集計を実行して保存する。戻り値は最新の集計結果 */
export function runAggregation(
  db: AppDatabase,
  projectId: number,
): AggregateView {
  const entries = collectEntries(db, projectId);
  const skipPart2 = new Set(
    listProjectSubjects(db, projectId)
      .filter((subject) => subject.skipPart2 === 1)
      .map((subject) => subject.id),
  );
  const items = aggregateItems(entries, skipPart2);

  const run = db.transaction((tx) => {
    const created = tx
      .insert(projectAggregateRuns)
      .values({ projectId })
      .returning()
      .get();

    items.forEach((item, index) => {
      tx.insert(projectAggregateItems)
        .values({
          runId: created.id,
          displayOrder: index,
          masterKey: item.masterKey,
          part1: item.part1,
          part2: item.part2,
          part2Raw: item.part2Raw,
          subjectId: item.subjectId,
          materialCategory: item.materialCategory,
          partNumber: item.partNumber,
          partName: item.partName,
          detailNumber: item.detailNumber,
          name: item.name,
          descriptionUpper: item.descriptionUpper,
          descriptionLower: item.descriptionLower,
          unit: item.unit,
          remarksUpper: item.remarksUpper,
          remarksLower: item.remarksLower,
          estimateDisplay: item.estimateDisplay,
          formwork: item.formwork,
          quantity: item.quantity,
          roomsJson: JSON.stringify(item.rooms),
        })
        .run();
    });

    const keyOf = keyResolver(items);
    entries.forEach((entry) => {
      tx.insert(projectAggregateDetails)
        .values({
          runId: created.id,
          traceId: entry.traceId,
          masterKey: keyOf(entry),
          sourceKind: entry.sourceKind,
          estimateRowId: entry.estimateRowId,
          transferRowId: entry.transferRowId,
          part1: entry.part1,
          part2: entry.part2,
          part2Raw: entry.part2Raw,
          part2Split: entry.part2Split ? 1 : 0,
          part2Order: entry.part2Order,
          part3: entry.part3,
          formwork: entry.formwork,
          multiplier: entry.multiplier,
          subjectId: entry.subjectId,
          materialCategory: entry.materialCategory,
          partNumber: entry.partNumber,
          partName: entry.partName,
          detailNumber: entry.detailNumber,
          name: entry.name,
          descriptionUpper: entry.descriptionUpper,
          descriptionLower: entry.descriptionLower,
          unit: entry.unit,
          remarksUpper: entry.remarksUpper,
          remarksLower: entry.remarksLower,
          estimateDisplay: entry.estimateDisplay,
          coefficient: entry.coefficient,
          setTotal: entry.setTotal,
          quantity: entry.quantity,
          sourceDetailId: entry.sourceDetailId,
        })
        .run();
    });

    return created;
  });

  return getAggregate(db, projectId, run.id);
}

/** 詳細データがどの集計行になったかを引く（部位Ⅱ分不要の科目は部位Ⅱを外して探す） */
function keyResolver(
  items: AggregatedItem[],
): (entry: AggregateEntry) => string {
  const known = new Set(items.map((item) => item.masterKey));
  return (entry: AggregateEntry): string => {
    const withPart2 = masterKeyOf(entry);
    if (known.has(withPart2)) return withPart2;
    return masterKeyOf({ ...entry, part2: "" });
  };
}

/** 計算書と転記入力表から集計詳細データを作る */
export function collectEntries(
  db: AppDatabase,
  projectId: number,
): AggregateEntry[] {
  const fittings = db
    .select()
    .from(projectFittings)
    .where(eq(projectFittings.projectId, projectId))
    .all();

  const deductionLimit = getDeductionLimit(db);

  const rows = db
    .select()
    .from(projectEstimateRows)
    .where(eq(projectEstimateRows.projectId, projectId))
    .orderBy(asc(projectEstimateRows.displayOrder), asc(projectEstimateRows.id))
    .all();

  const roomSheets = new Map(
    db
      .select()
      .from(projectRoomSheets)
      .where(eq(projectRoomSheets.projectId, projectId))
      .all()
      .map((sheet) => [sheet.estimateRowId, sheet]),
  );
  const frameSheets = new Map(
    db
      .select()
      .from(projectFrameSheets)
      .where(eq(projectFrameSheets.projectId, projectId))
      .all()
      .map((sheet) => [sheet.estimateRowId, sheet]),
  );
  const generalSheets = new Map(
    db
      .select()
      .from(projectGeneralSheets)
      .where(eq(projectGeneralSheets.projectId, projectId))
      .all()
      .map((sheet) => [sheet.estimateRowId, sheet]),
  );

  /** 軸組計算書で置いた部屋の平面図（部屋計算書の形をそのまま使う） */
  const shapes = new Map(
    [...roomSheets.values()].map((sheet) => [
      sheet.estimateRowId,
      solveShape(parseJson<RoomShape>(sheet.shapeJson, { edges: [] })),
    ]),
  );

  const part2Order = new Map<string, number>();
  const entries: AggregateEntry[] = [];
  let inherited = { part1: "", part2: "", part2Split: 0 };

  rows.forEach((row) => {
    // 部位Ⅰ・部位Ⅱは空欄なら入力のある上の行を引き継ぐ
    if (row.part1.trim() !== "") inherited = { ...inherited, part1: row.part1 };
    if (row.part2.trim() !== "")
      inherited = {
        ...inherited,
        part2: row.part2,
        part2Split: row.part2Split,
      };
    if (row.rowType === "subtotal") return;
    if (!part2Order.has(inherited.part2))
      part2Order.set(inherited.part2, part2Order.size);

    const context = {
      estimateRowId: row.id,
      part1: inherited.part1,
      part2: inherited.part2,
      part2Split: inherited.part2Split === 1,
      part2Order: part2Order.get(inherited.part2) ?? 0,
      part3: row.part3,
      formwork: row.formwork,
      multiplier: row.multiplier,
      sourceKind:
        row.calcType === "frame"
          ? ("frame" as const)
          : row.calcType === "general"
            ? ("general" as const)
            : ("room" as const),
    };

    if (row.calcType === "general") {
      const sheet = generalSheets.get(row.id);
      if (!sheet) return;
      const sets = parseJson<CalcSet[]>(sheet.lowerJson, []);
      const variables = calcVariables([], fittings);
      entries.push(
        ...entriesFromCalcSheet(
          context,
          sets,
          evaluateCalcSheet(sets, variables),
        ),
      );
      return;
    }

    if (row.calcType === "frame") {
      const sheet = frameSheets.get(row.id);
      if (!sheet) return;
      const sets = parseJson<CalcSet[]>(sheet.lowerJson, []);
      const lines = buildFrameLines({
        placements: parseJson<FramePlacement[]>(sheet.layoutJson, []),
        shapes,
        manualLines: parseJson<FrameManualLine[]>(sheet.linesJson, []),
        attributes: parseJson<Record<string, FrameLineAttribute>>(
          sheet.attributesJson,
          {},
        ),
      });
      const sheetFittings: FrameFitting[] = parseJson<FrameFittingInput[]>(
        sheet.fittingsJson,
        [],
      ).map((item) => {
        const master = fittings.find(
          (fitting) => fitting.symbol === item.symbol,
        );
        const computed = master ? computeFitting(master) : null;
        return {
          id: item.id,
          symbol: item.symbol,
          multiplier: item.multiplier,
          lineId: item.lineId,
          area: computed?.area ?? null,
          width: master?.width ?? null,
          sillHeight: master?.sillHeight ?? null,
          baseboardDeduction: computed?.baseboardDeduction ?? null,
        };
      });
      const quantities = frameQuantities(
        lines,
        sheetFittings,
        sheet.workHeight,
      );
      const variables = calcVariables(
        frameSymbols(quantities, sheet.workHeight),
        fittings,
        sheet.workHeight,
      );
      entries.push(
        ...entriesFromCalcSheet(
          context,
          sets,
          evaluateCalcSheet(sets, variables),
        ),
      );
      return;
    }

    const sheet = roomSheets.get(row.id);
    if (!sheet) return;
    const sets = parseJson<CalcSet[]>(sheet.lowerJson, []);
    const solved = shapes.get(row.id) ?? solveShape({ edges: [] });
    const sheetFittings: RoomFitting[] = parseJson<RoomFittingInput[]>(
      sheet.fittingsJson,
      [],
    ).map((item) => {
      const master = fittings.find((fitting) => fitting.symbol === item.symbol);
      const computed = master ? computeFitting(master) : null;
      return {
        symbol: item.symbol,
        multiplier: item.multiplier,
        area: computed?.area ?? null,
        baseboardDeduction: computed?.baseboardDeduction ?? null,
        edgeId: item.edgeId,
      };
    });
    const ceiling = parseJson<CeilingElement[]>(sheet.ceilingJson, []);
    const symbols = [
      ...roomSymbols(
        solved,
        sheet.ceilingHeight,
        sheetFittings,
        deductionLimit,
      ),
      ...(ceiling.length > 0
        ? ceilingSymbols(
            ceilingQuantities(ceiling, solved, sheet.ceilingHeight),
          )
        : []),
    ];
    const variables = calcVariables(symbols, fittings);
    entries.push(
      ...entriesFromCalcSheet(
        context,
        sets,
        evaluateCalcSheet(sets, variables),
      ),
    );
  });

  entries.push(...transferEntries(db, projectId, part2Order));
  return entries;
}

/** 転記入力表の行（集計書兼工事マスターへ直接計上。根拠集計には出さない） */
function transferEntries(
  db: AppDatabase,
  projectId: number,
  part2Order: Map<string, number>,
): AggregateEntry[] {
  const rows = db
    .select()
    .from(projectTransferRows)
    .where(eq(projectTransferRows.projectId, projectId))
    .orderBy(asc(projectTransferRows.displayOrder), asc(projectTransferRows.id))
    .all();
  const inherited = inheritTransferRows(rows);

  return rows
    .map((row, index) => ({ row, head: inherited[index] }))
    .filter(({ row }) => row.name.trim() !== "" || row.quantity !== null)
    .map(({ row, head }) => {
      if (!part2Order.has(head.part2))
        part2Order.set(head.part2, part2Order.size);
      const quantity = row.quantity ?? 0;
      return {
        traceId: `transfer:${row.id}`,
        sourceKind: "transfer" as const,
        estimateRowId: null,
        transferRowId: row.id,
        part1: head.part1,
        part2: head.part2Split === 1 ? head.part2 : "",
        part2Raw: head.part2,
        part2Split: head.part2Split === 1,
        part2Order: part2Order.get(head.part2) ?? 0,
        part3: head.part3,
        formwork: head.formwork,
        multiplier: 1,
        subjectId: head.subjectId,
        materialCategory: head.materialCategory,
        partNumber: row.partId,
        partName: row.partName,
        detailNumber: row.detailNumber,
        name: row.name,
        descriptionUpper: row.descriptionUpper,
        descriptionLower: row.descriptionLower,
        unit: row.unit,
        remarksUpper: row.remarks,
        remarksLower: "",
        estimateDisplay: "",
        coefficient: 1,
        setTotal: quantity,
        quantity: displayedValue(quantity),
        sourceDetailId: row.sourceDetailId,
      };
    });
}

function toItem(row: typeof projectAggregateItems.$inferSelect): AggregateItem {
  return {
    id: row.id,
    runId: row.runId,
    displayOrder: row.displayOrder,
    masterKey: row.masterKey,
    part1: row.part1,
    part2: row.part2,
    part2Raw: row.part2Raw,
    subjectId: row.subjectId,
    materialCategory: row.materialCategory,
    partNumber: row.partNumber,
    partName: row.partName,
    detailNumber: row.detailNumber,
    name: row.name,
    descriptionUpper: row.descriptionUpper,
    descriptionLower: row.descriptionLower,
    unit: row.unit,
    remarksUpper: row.remarksUpper,
    remarksLower: row.remarksLower,
    estimateDisplay: row.estimateDisplay,
    formwork: row.formwork,
    quantity: row.quantity,
    rooms: parseJson<{ roomName: string; quantity: number }[]>(
      row.roomsJson,
      [],
    ),
  };
}

function toDetail(
  row: typeof projectAggregateDetails.$inferSelect,
): AggregateDetail {
  return {
    id: row.id,
    runId: row.runId,
    traceId: row.traceId,
    masterKey: row.masterKey,
    sourceKind: row.sourceKind,
    estimateRowId: row.estimateRowId,
    transferRowId: row.transferRowId,
    part1: row.part1,
    part2: row.part2,
    part2Raw: row.part2Raw,
    part2Split: row.part2Split,
    part2Order: row.part2Order,
    part3: row.part3,
    formwork: row.formwork,
    multiplier: row.multiplier,
    subjectId: row.subjectId,
    materialCategory: row.materialCategory,
    partNumber: row.partNumber,
    partName: row.partName,
    detailNumber: row.detailNumber,
    name: row.name,
    descriptionUpper: row.descriptionUpper,
    descriptionLower: row.descriptionLower,
    unit: row.unit,
    remarksUpper: row.remarksUpper,
    remarksLower: row.remarksLower,
    estimateDisplay: row.estimateDisplay,
    coefficient: row.coefficient,
    setTotal: row.setTotal,
    quantity: row.quantity,
    sourceDetailId: row.sourceDetailId,
  };
}

/** 集計の実行履歴（新しい順） */
export function listAggregateRuns(
  db: AppDatabase,
  projectId: number,
): AggregateRun[] {
  return db
    .select()
    .from(projectAggregateRuns)
    .where(eq(projectAggregateRuns.projectId, projectId))
    .orderBy(desc(projectAggregateRuns.id))
    .all();
}

/** 集計結果を読む（回を指定しなければ最新） */
export function getAggregate(
  db: AppDatabase,
  projectId: number,
  runId?: number,
): AggregateView {
  const runs = listAggregateRuns(db, projectId);
  const run = runId ? runs.find((item) => item.id === runId) : runs[0];
  if (!run) return { run: null, items: [], details: [] };

  const items = db
    .select()
    .from(projectAggregateItems)
    .where(eq(projectAggregateItems.runId, run.id))
    .orderBy(asc(projectAggregateItems.displayOrder))
    .all()
    .map(toItem);
  const details = db
    .select()
    .from(projectAggregateDetails)
    .where(eq(projectAggregateDetails.runId, run.id))
    .orderBy(asc(projectAggregateDetails.id))
    .all()
    .map(toDetail);

  return { run, items, details };
}
