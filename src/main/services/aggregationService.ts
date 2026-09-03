/**
 * 集計処理。
 * 部位別入力表の行→計算書（部屋別・軸組・汎用）の下段セット明細と転記入力表を読み、
 * 集計詳細データ（合算前）と集計書兼工事マスター（合算後）を作って保存する。
 * 集計をかけ直しても過去の回は消さず、実行ごとに版を残す。
 */

import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  detailChangeLogs,
  projectAggregateDetails,
  projectAggregateItems,
  projectAggregateRuns,
  projectEstimateRows,
  projectFittings,
  projectFrameSheets,
  projectGeneralSheets,
  projectMiscSheets,
  projectPitSheets,
  projectRoomSheets,
  projectTransferRows,
  projectUnusedDetails,
} from "../db/schema";
import {
  aggregateItems,
  entriesFromCalcSheet,
  masterKeyOf,
  type AggregateEntry,
  type AggregatedItem,
} from "../../core/aggregate/aggregate";
import { calcVariables } from "../../core/aggregate/variables";
import {
  entriesFromMiscSheet,
  type MiscColumn,
  type MiscRow,
} from "../../core/misc/miscSheet";
import { inheritTransferRows } from "../../core/aggregate/transferInherit";
import {
  listProjectBasicMasters,
  listProjectSubjects,
} from "./projectMasterService";
import { aggregationPartIdOf } from "../../core/aggregate/checkSheet";
import { changedFieldsOf, snapshotOf } from "./detailService";
import { getDeductionLimit } from "./roomSheetService";
import { syncAssembliesFromSheets } from "./assemblyService";
import {
  listFormworkRules,
  runFormworkTransfer,
} from "./formworkTransferService";
import {
  displayedValue,
  evaluateCalcSheet,
  normalizeSets,
  type CalcSet,
} from "../../core/room/calcSheet";
import {
  roomSymbols,
  solveShape,
  type RoomFitting,
  type RoomShape,
} from "../../core/room/shape";
import {
  beamFootprintArea,
  ceilingQuantities,
  ceilingSymbols,
  normalizeCeilingHeights,
  type CeilingElement,
} from "../../core/room/ceiling";
import {
  buildFrameLines,
  defaultFrameKinds,
  frameQuantities,
  frameSymbols,
  linePartVariables,
  type FrameFitting,
  type FrameKind,
  type FrameLineAttribute,
  type FrameManualLine,
  type FramePlacement,
} from "../../core/frame/frame";
import {
  pitQuantities,
  pitPartVariables,
  pitVariables,
  pitWallVariables,
  defaultPitSleeveKinds,
  type PitWall,
  type PitSleeve,
  type PitSleeveKind,
  type PitBeam,
  type PitShape,
} from "../../core/pit/pit";
import { computeFitting } from "../../core/fittings/fitting";
import type {
  AggregateDetail,
  AggregateItem,
  AggregateItemEdit,
  AggregateRun,
  AggregateView,
  EstimateRowCheck,
  SaveAggregateEditsRequest,
  SetDetailUnusedRequest,
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

/** 不要明細（人が印を付けた明細）の集計キー */
function unusedMasterKeys(
  db: AppDatabase,
  projectId: number,
): ReadonlySet<string> {
  return new Set(
    db
      .select()
      .from(projectUnusedDetails)
      .where(eq(projectUnusedDetails.projectId, projectId))
      .all()
      .map((row) => row.masterKey),
  );
}

/**
 * 明細に不要の印を付ける／外す。
 * 不要明細は工種科目の最後にまとめ、内訳書へは飛ばさない（計算書はそのまま残す）。
 */
export function setDetailUnused(
  db: AppDatabase,
  request: SetDetailUnusedRequest,
): AggregateView {
  if (request.unused) {
    db.insert(projectUnusedDetails)
      .values({
        projectId: request.projectId,
        masterKey: request.masterKey,
        note: request.note ?? "",
      })
      .onConflictDoUpdate({
        target: [
          projectUnusedDetails.projectId,
          projectUnusedDetails.masterKey,
        ],
        set: { note: request.note ?? "" },
      })
      .run();
  } else {
    db.delete(projectUnusedDetails)
      .where(
        and(
          eq(projectUnusedDetails.projectId, request.projectId),
          eq(projectUnusedDetails.masterKey, request.masterKey),
        ),
      )
      .run();
  }
  return runAggregation(db, request.projectId);
}

/**
 * 集計を実行して保存する。戻り値は最新の集計結果。
 * 型枠転記を決めてあるときは、そのつど型枠数量を作り直して集計し直す
 * （計算書を直して数量が変わっても、集計をかけ直すだけで型枠数量が合う）。
 */
export function runAggregation(
  db: AppDatabase,
  projectId: number,
  options: { skipFormwork?: boolean } = {},
): AggregateView {
  // 計算書で組んだセットは、集計をかけた時点で仕上明細セットマスターへ自動登録する
  syncAssembliesFromSheets(db, projectId);
  const entries = collectEntries(db, projectId);
  const skipPart2 = new Set(
    listProjectSubjects(db, projectId)
      .filter((subject) => subject.skipPart2 === 1)
      .map((subject) => subject.id),
  );
  const items = aggregateItems(
    entries,
    skipPart2,
    unusedMasterKeys(db, projectId),
  );

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
          unused: item.unused ? 1 : 0,
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

  const view = getAggregate(db, projectId, run.id);
  if (options.skipFormwork) return view;
  const rules = listFormworkRules(db, projectId).filter(
    (rule) => rule.sourceKeys.length > 0 && rule.name.trim() !== "",
  );
  if (rules.length === 0) return view;
  // 型枠転記の行を作り直し、その行を含めてもう一度集計する
  runFormworkTransfer(db, projectId);
  return runAggregation(db, projectId, { skipFormwork: true });
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

  const pitSheets = new Map(
    db
      .select()
      .from(projectPitSheets)
      .where(eq(projectPitSheets.projectId, projectId))
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
            : row.calcType === "pit"
              ? ("pit" as const)
              : ("room" as const),
    };

    if (row.calcType === "pit") {
      const sheet = pitSheets.get(row.id);
      if (!sheet) return;
      const sets = normalizeSets(parseJson<CalcSet[]>(sheet.lowerJson, []));
      const quantities = pitQuantities(
        parseJson<PitShape[]>(sheet.pitsJson, []),
        parseJson<PitBeam[]>(sheet.beamsJson, []),
      );
      const walls = parseJson<PitWall[]>(sheet.wallsJson, []);
      const sleeves = parseJson<PitSleeve[]>(sheet.sleevesJson, []);
      const sleeveKinds = parseJson<PitSleeveKind[]>(
        sheet.sleeveKindsJson,
        defaultPitSleeveKinds(),
      );
      const variables = {
        ...calcVariables([], fittings),
        ...pitVariables(quantities),
        ...pitWallVariables(walls, sleeves, sleeveKinds, sheet.wallStep),
      };
      entries.push(
        ...entriesFromCalcSheet(
          context,
          sets,
          evaluateCalcSheet(sets, variables, (set) =>
            pitPartVariables(quantities, set.partName),
          ),
        ),
      );
      return;
    }

    if (row.calcType === "general") {
      const sheet = generalSheets.get(row.id);
      if (!sheet) return;
      const sets = normalizeSets(parseJson<CalcSet[]>(sheet.lowerJson, []));
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
      const sets = normalizeSets(parseJson<CalcSet[]>(sheet.lowerJson, []));
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
      const symbols = frameSymbols(
        quantities,
        sheet.workHeight,
        parseJson<FrameKind[]>(sheet.kindsJson, defaultFrameKinds()),
      );
      const variables = calcVariables(symbols, fittings, sheet.workHeight);
      entries.push(
        ...entriesFromCalcSheet(
          context,
          sets,
          evaluateCalcSheet(sets, variables, (set) =>
            linePartVariables(symbols, set.partName),
          ),
        ),
      );
      return;
    }

    const sheet = roomSheets.get(row.id);
    if (!sheet) return;
    const sets = normalizeSets(parseJson<CalcSet[]>(sheet.lowerJson, []));
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
    // 天井高さは部位別入力表の行の値を優先する（計算書のコピーで古い高さが残ることへの備え）
    const ceilingHeight = row.ceilingHeight ?? sheet.ceilingHeight;
    const ceiling = normalizeCeilingHeights(
      parseJson<CeilingElement[]>(sheet.ceilingJson, []),
      ceilingHeight,
    );
    const ceilingResult = ceilingQuantities(ceiling, solved, ceilingHeight);
    // 天井面積は梁型（壁付き・天井付）が取る梁底（長さ×Ｗ幅）の分を引く
    const beamArea = beamFootprintArea(ceiling, solved, ceilingHeight);
    const symbols = [
      ...roomSymbols(
        solved,
        ceilingHeight,
        sheetFittings,
        deductionLimit,
        beamArea,
      ),
      ...(ceiling.length > 0 ? ceilingSymbols(ceilingResult) : []),
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

  entries.push(...miscEntries(db, projectId, part2Order));
  entries.push(...transferEntries(db, projectId, part2Order));
  return entries;
}

/** 部位別雑・金物入力表（その部屋の計算書に入れたのと同じ扱いで集計する） */
function miscEntries(
  db: AppDatabase,
  projectId: number,
  part2Order: Map<string, number>,
): AggregateEntry[] {
  const sheet = db
    .select()
    .from(projectMiscSheets)
    .where(eq(projectMiscSheets.projectId, projectId))
    .get();
  if (!sheet) return [];
  const columns = parseJson<MiscColumn[]>(sheet.columnsJson, []);
  const rows = parseJson<MiscRow[]>(sheet.rowsJson, []);
  rows.forEach((row) => {
    if (!part2Order.has(row.part2)) part2Order.set(row.part2, part2Order.size);
  });
  return entriesFromMiscSheet({ columns, rows }, part2Order);
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
        remarksLower: row.remarksLower,
        estimateDisplay: "",
        coefficient: 1,
        setTotal: quantity,
        quantity: displayedValue(quantity),
        sourceDetailId: row.sourceDetailId,
      };
    });
}

/** 計算書の下段（セット明細計算表）の1明細を、集計書で直した内容に書き換える */
function applyEditToSheet(
  lowerJson: string,
  traceIds: readonly string[],
  edit: AggregateItemEdit,
): string | null {
  const sets = parseJson<CalcSet[]>(lowerJson, []);
  let changed = false;
  traceIds.forEach((traceId) => {
    const [, setId, detailId] = traceId.split(":");
    const set = sets.find((current) => current.id === setId);
    const detail = set?.details.find((current) => current.id === detailId);
    if (!set || !detail) return;
    changed = true;
    detail.subjectId = edit.subjectId;
    detail.materialCategory = edit.materialCategory;
    detail.partNumber = edit.partNumber;
    detail.partName = edit.partName;
    detail.detailNumber = edit.detailNumber;
    detail.name = edit.name;
    detail.descriptionUpper = edit.descriptionUpper;
    detail.descriptionLower = edit.descriptionLower;
    detail.unit = edit.unit;
    detail.remarksUpper = edit.remarksUpper;
    detail.remarksLower = edit.remarksLower;
  });
  return changed ? JSON.stringify(sets) : null;
}

/**
 * 集計書兼工事マスターで直した内容を保存する。
 * 元の計算書（部屋別・軸組・汎用）と転記入力表だけを直す。
 * 物件専用の明細マスターは基本マスターの複製のままにするので書き戻さない。
 * 保存したあと集計をかけ直した結果を返す。
 */
export function saveAggregateEdits(
  db: AppDatabase,
  request: SaveAggregateEditsRequest,
): AggregateView {
  const { projectId, runId, edits, applyToSameDetail = false } = request;
  const details = db
    .select()
    .from(projectAggregateDetails)
    .where(eq(projectAggregateDetails.runId, runId))
    .all();

  db.transaction((tx) => {
    edits.forEach((edit) => {
      const matched = details.filter(
        (detail) => detail.masterKey === edit.masterKey,
      );
      if (matched.length === 0) return;
      // 同じ明細マスターから拾った行（摘要などが古いまま別行に分かれている分）もそろえる
      const sameDetailIds = new Set(
        matched
          .map((detail) => detail.sourceDetailId)
          .filter((id): id is number => id !== null),
      );
      // 修正履歴（明細マスター変更履歴）に、直した前後を1件残す
      const head = matched[0];
      const before = snapshotOf({
        detailNumber: head.detailNumber,
        materialCategory: head.materialCategory,
        partName: head.partName,
        name: head.name,
        descriptionUpper: head.descriptionUpper,
        descriptionLower: head.descriptionLower,
        unit: head.unit,
        remarksUpper: head.remarksUpper,
        remarksLower: head.remarksLower,
        estimateDisplay: head.estimateDisplay,
        isActive: true,
      });
      const after = snapshotOf({
        detailNumber: edit.detailNumber,
        materialCategory: edit.materialCategory,
        partName: edit.partName,
        name: edit.name,
        descriptionUpper: edit.descriptionUpper,
        descriptionLower: edit.descriptionLower,
        unit: edit.unit,
        remarksUpper: edit.remarksUpper,
        remarksLower: edit.remarksLower,
        estimateDisplay: head.estimateDisplay,
        isActive: true,
      });
      const subjectId = edit.subjectId ?? head.subjectId;
      if (changedFieldsOf(before, after).length > 0 && subjectId !== null) {
        tx.insert(detailChangeLogs)
          .values({
            scope: "project",
            projectId,
            subjectId,
            detailId: head.sourceDetailId,
            changeKind: "edit",
            origin: "集計書兼工事マスター",
            beforeJson: JSON.stringify(before),
            afterJson: JSON.stringify(after),
          })
          .run();
      }

      const targets =
        applyToSameDetail && sameDetailIds.size > 0
          ? details.filter(
              (detail) =>
                detail.masterKey === edit.masterKey ||
                (detail.sourceDetailId !== null &&
                  sameDetailIds.has(detail.sourceDetailId)),
            )
          : matched;

      // 転記入力表の行
      targets.forEach((target) => {
        if (target.transferRowId === null) return;
        tx.update(projectTransferRows)
          .set({
            subjectId: edit.subjectId,
            materialCategory: edit.materialCategory,
            partId: edit.partNumber,
            partName: edit.partName,
            detailNumber: edit.detailNumber,
            name: edit.name,
            descriptionUpper: edit.descriptionUpper,
            descriptionLower: edit.descriptionLower,
            unit: edit.unit,
            remarks: edit.remarksUpper,
            remarksLower: edit.remarksLower,
          })
          .where(eq(projectTransferRows.id, target.transferRowId))
          .run();
      });

      // 部位別雑・金物入力表の明細（タテ1列）
      const miscColumnIds = new Set(
        targets
          .filter((target) => target.sourceKind === "misc")
          .map((target) => target.traceId.split(":")[2]),
      );
      if (miscColumnIds.size > 0) {
        const miscSheet = tx
          .select()
          .from(projectMiscSheets)
          .where(eq(projectMiscSheets.projectId, projectId))
          .get();
        if (miscSheet) {
          const columns = parseJson<MiscColumn[]>(miscSheet.columnsJson, []);
          let miscChanged = false;
          const nextColumns = columns.map((column) => {
            if (!miscColumnIds.has(column.id)) return column;
            miscChanged = true;
            return {
              ...column,
              subjectId: edit.subjectId,
              materialCategory: edit.materialCategory,
              partNumber: edit.partNumber,
              partName: edit.partName,
              detailNumber: edit.detailNumber,
              name: edit.name,
              descriptionUpper: edit.descriptionUpper,
              descriptionLower: edit.descriptionLower,
              unit: edit.unit,
              remarksUpper: edit.remarksUpper,
              remarksLower: edit.remarksLower,
            };
          });
          if (miscChanged) {
            tx.update(projectMiscSheets)
              .set({
                columnsJson: JSON.stringify(nextColumns),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(projectMiscSheets.id, miscSheet.id))
              .run();
          }
        }
      }

      // 計算書（部屋別・軸組・汎用）の下段
      const sheetTargets = new Map<string, string[]>();
      targets.forEach((target) => {
        if (target.sourceKind === "misc") return;
        if (target.estimateRowId === null) return;
        const key = `${target.sourceKind}:${target.estimateRowId}`;
        const list = sheetTargets.get(key) ?? [];
        list.push(target.traceId);
        sheetTargets.set(key, list);
      });
      sheetTargets.forEach((traceIds, key) => {
        const [sourceKind, rowId] = key.split(":");
        const estimateRowId = Number(rowId);
        const table =
          sourceKind === "frame"
            ? projectFrameSheets
            : sourceKind === "general"
              ? projectGeneralSheets
              : sourceKind === "pit"
                ? projectPitSheets
                : projectRoomSheets;
        const sheet = tx
          .select()
          .from(table)
          .where(eq(table.estimateRowId, estimateRowId))
          .get();
        if (!sheet) return;
        const lowerJson = applyEditToSheet(sheet.lowerJson, traceIds, edit);
        if (lowerJson === null) return;
        tx.update(table)
          .set({ lowerJson, updatedAt: new Date().toISOString() })
          .where(eq(table.id, sheet.id))
          .run();
      });
    });
  });

  return runAggregation(db, projectId);
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
    unused: row.unused === 1,
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

/** 集計結果と今の計算書の中身が同じかを見るための並び（明細と数量） */
function itemsSignature(
  items: readonly {
    masterKey: string;
    quantity: number;
    rooms: readonly { roomName: string; quantity: number }[];
  }[],
): string {
  return items
    .map(
      (item) =>
        `${item.masterKey}\t${item.quantity}\t${item.rooms
          .map((room) => `${room.roomName}=${room.quantity}`)
          .join(",")}`,
    )
    .join("\n");
}

/** 保存してある集計結果が、今の計算書・転記入力表と食い違っているか */
function isStale(db: AppDatabase, projectId: number, runId: number): boolean {
  const skipPart2 = new Set(
    listProjectSubjects(db, projectId)
      .filter((subject) => subject.skipPart2 === 1)
      .map((subject) => subject.id),
  );
  const fresh = aggregateItems(
    collectEntries(db, projectId),
    skipPart2,
    unusedMasterKeys(db, projectId),
  );
  const saved = db
    .select()
    .from(projectAggregateItems)
    .where(eq(projectAggregateItems.runId, runId))
    .orderBy(asc(projectAggregateItems.displayOrder))
    .all()
    .map(toItem);
  return itemsSignature(fresh) !== itemsSignature(saved);
}

/**
 * 集計結果を読む（回を指定しなければ最新）。
 * 計算書を直したあとで集計をかけ忘れていると古い数量が出てしまうので、
 * 最新の回が今の計算書と食い違っていれば自動でかけ直す。
 */
export function getAggregate(
  db: AppDatabase,
  projectId: number,
  runId?: number,
): AggregateView {
  const runs = listAggregateRuns(db, projectId);
  const run = runId ? runs.find((item) => item.id === runId) : runs[0];
  if (!run) return { run: null, items: [], details: [] };
  if (runId === undefined && isStale(db, projectId, run.id))
    return runAggregation(db, projectId);

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

/**
 * 部位別入力表のチェック列（1部位＝名称＋数量の2列）。
 * 各行の計算書で拾った明細を、管理用部位（床・巾木・壁…）ごとにまとめる。
 * 材種区分は画面で選んだもの（既定は仕上）だけを合計する。
 */
export function collectEstimateRowChecks(
  db: AppDatabase,
  projectId: number,
  materialCategory: string,
): EstimateRowCheck[] {
  const parts = listProjectBasicMasters(db, projectId).aggregationParts;
  const byRow = new Map<
    number,
    Map<string, { name: string; quantity: number }>
  >();

  collectEntries(db, projectId).forEach((entry) => {
    if (entry.estimateRowId === null) return;
    if (entry.materialCategory !== materialCategory) return;
    if (entry.name.trim() === "") return;
    const partId = aggregationPartIdOf(entry.partNumber);
    const part =
      parts.find((row) => row.id === partId) ??
      parts.find((row) => entry.partName.includes(row.name));
    if (!part) return;
    const cells =
      byRow.get(entry.estimateRowId) ??
      new Map<string, { name: string; quantity: number }>();
    byRow.set(entry.estimateRowId, cells);
    const cell = cells.get(part.name);
    if (cell) {
      // 同じ部位に複数の明細があるときは、名称を並べて数量を合計する
      cells.set(part.name, {
        name: cell.name.includes(entry.name)
          ? cell.name
          : `${cell.name}／${entry.name}`,
        quantity: displayedValue(cell.quantity + entry.quantity),
      });
      return;
    }
    cells.set(part.name, {
      name: entry.name,
      quantity: displayedValue(entry.quantity),
    });
  });

  return [...byRow.entries()].map(([estimateRowId, cells]) => ({
    estimateRowId,
    cells: [...cells.entries()].map(([partName, cell]) => ({
      partName,
      name: cell.name,
      quantity: cell.quantity,
    })),
  }));
}
