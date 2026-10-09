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
  projectFireproofSheets,
  projectFurnitureSheets,
  projectManualAggregateItems,
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
  type EstimateRowContext,
} from "../../core/aggregate/aggregate";
import {
  isManualMasterKey,
  manualIdOf,
  mergeManualItems,
  type ManualAggregateRow,
} from "../../core/aggregate/manualItems";
import { calcVariables } from "../../core/aggregate/variables";
import {
  entriesFromMiscSheet,
  type MiscColumn,
  type MiscRow,
} from "../../core/misc/miscSheet";
import {
  applyFurnitureDetails,
  entriesFromFurnitureSheet,
  furnitureSettings,
  isFittingDetailSheet,
  type FittingSize,
  type FurnitureColumn,
  type FurnitureRow,
  type FurnitureSettings,
} from "../../core/furniture/furnitureSheet";
import { syncFittingDetailSheet } from "./furnitureSheetService";
import {
  entriesFromFireproofSheet,
  normalizeManageRows,
} from "../../core/fireproof/fireproofEstimate";
import {
  normalizeCommonRows,
  normalizeFloorList,
} from "../../core/fireproof/fireproofList";
import { inheritTransferRows } from "../../core/aggregate/transferInherit";
import { getFittingPartValues, listFittings } from "./fittingService";
import { fittingPartVariables } from "../../core/fittings/partValue";
import {
  listProjectBasicMasters,
  listProjectSubjects,
} from "./projectMasterService";
import {
  aggregationPartIdOf,
  parseNumberRanges,
} from "../../core/aggregate/checkSheet";
import { getCheckSheetPartMap } from "./checkSheetService";
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
  partOfSet,
  type CalcSet,
  type CalcSheetResult,
} from "../../core/room/calcSheet";
import {
  roomSymbols,
  solveShape,
  withFixedRoomSymbols,
  type RoomFitting,
  type RoomShape,
} from "../../core/room/shape";
import {
  beamFootprintArea,
  ceilingQuantities,
  ceilingSymbols,
  normalizeCeilingHeights,
  parseCeilingCodes,
  wallEdgeHeights,
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
  DeleteAggregateManualItemRequest,
  EstimateRowCheck,
  InsertAggregateManualItemRequest,
  MoveAggregateManualItemRequest,
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

/** 集計書へ手で挿入した明細行（登録順） */
function manualRows(db: AppDatabase, projectId: number): ManualAggregateRow[] {
  return db
    .select()
    .from(projectManualAggregateItems)
    .where(eq(projectManualAggregateItems.projectId, projectId))
    .orderBy(asc(projectManualAggregateItems.id))
    .all()
    .map(({ anchorBefore, ...row }) => ({
      ...row,
      before: anchorBefore === 1,
    }));
}

/**
 * 計算書・転記入力表からの集計結果へ、手で挿入した明細行を差し込んだもの。
 * 集計実行と「古いかどうか」の判定で同じ並びにするためここに1か所置く。
 */
function mergedAggregateItems(
  db: AppDatabase,
  projectId: number,
  entries: AggregateEntry[],
  skipPart2: ReadonlySet<number>,
): AggregatedItem[] {
  const unused = unusedMasterKeys(db, projectId);
  const items = aggregateItems(entries, skipPart2, unused);
  return mergeManualItems(items, manualRows(db, projectId), unused);
}

/**
 * 集計書へ明細行を手で挿入する（選んだ行の直後）。
 * 欄はアンカー行から写して空欄に近い形で入れ、あとで画面から直す。
 */
export function insertAggregateManualItem(
  db: AppDatabase,
  request: InsertAggregateManualItemRequest,
): AggregateView {
  const anchor = db
    .select()
    .from(projectAggregateItems)
    .where(
      and(
        eq(projectAggregateItems.runId, request.runId),
        eq(projectAggregateItems.masterKey, request.afterMasterKey),
      ),
    )
    .get();
  if (!anchor) return getAggregate(db, request.projectId);
  db.insert(projectManualAggregateItems)
    .values({
      projectId: request.projectId,
      afterMasterKey: anchor.masterKey,
      anchorBefore: request.before === true ? 1 : 0,
      subjectId: anchor.subjectId,
      materialCategory: anchor.materialCategory,
      part1: anchor.part1,
      part2: anchor.part2,
      part2Raw: anchor.part2Raw,
      estimateDisplay: anchor.estimateDisplay,
      formwork: anchor.formwork,
    })
    .run();
  return runAggregation(db, request.projectId);
}

/**
 * 手で挿入した明細行の付き先を別の明細へ付け直す。
 * 上に付く・下に付くの向きはそのまま（元の付け方を引き継ぐ）。
 */
export function moveAggregateManualItem(
  db: AppDatabase,
  request: MoveAggregateManualItemRequest,
): AggregateView {
  const id = manualIdOf(request.masterKey);
  const view = getAggregate(db, request.projectId);
  if (id === null) return view;
  const anchor = view.items.find(
    (item) => item.masterKey === request.anchorMasterKey,
  );
  if (!anchor || request.anchorMasterKey === request.masterKey) return view;
  db.update(projectManualAggregateItems)
    .set({ afterMasterKey: request.anchorMasterKey })
    .where(
      and(
        eq(projectManualAggregateItems.id, id),
        eq(projectManualAggregateItems.projectId, request.projectId),
      ),
    )
    .run();
  return runAggregation(db, request.projectId);
}

/** 集計書へ手で挿入した明細行を消す（不要の印もいっしょに消す） */
export function deleteAggregateManualItem(
  db: AppDatabase,
  request: DeleteAggregateManualItemRequest,
): AggregateView {
  const id = manualIdOf(request.masterKey);
  if (id === null) return getAggregate(db, request.projectId);
  db.transaction((tx) => {
    tx.delete(projectManualAggregateItems)
      .where(
        and(
          eq(projectManualAggregateItems.id, id),
          eq(projectManualAggregateItems.projectId, request.projectId),
        ),
      )
      .run();
    tx.delete(projectUnusedDetails)
      .where(
        and(
          eq(projectUnusedDetails.projectId, request.projectId),
          eq(projectUnusedDetails.masterKey, request.masterKey),
        ),
      )
      .run();
  });
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
  const items = mergedAggregateItems(db, projectId, entries, skipPart2);

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

/**
 * 計算書の「マスター作成」：集計実行と同じ処理を走らせて、工事マスター（集計書の内容）と
 * セット明細マスターを最新にする。集計書は見せないので数だけ返す。
 */
export function buildProjectMasters(
  db: AppDatabase,
  projectId: number,
): { aggregateCount: number; assembliesAdded: number } {
  const assembliesAdded = syncAssembliesFromSheets(db, projectId);
  const view = runAggregation(db, projectId);
  return { aggregateCount: view.items.length, assembliesAdded };
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

/** 行の計算書を集計と同じ変数で評価したもの */
interface EvaluatedSheet {
  context: EstimateRowContext;
  sets: CalcSet[];
  result: CalcSheetResult;
  /** 部屋計算書で形が決まらない（寸法が閉じない・未入力が残る）ときの説明 */
  shapeError: string | null;
}

/**
 * 部位別入力表の行ごとに計算書（部屋別・軸組・汎用・ピット）を読み、
 * 集計で使うのと同じ変数で下段の計算式を評価する。
 * 集計（entries 化）と「計算エラー」の目印で同じ評価を使うためここに1か所置く。
 */
function evaluateRowSheets(
  db: AppDatabase,
  projectId: number,
): { evaluations: EvaluatedSheet[]; part2Order: Map<string, number> } {
  const fittings = db
    .select()
    .from(projectFittings)
    .where(eq(projectFittings.projectId, projectId))
    .all();

  const deductionLimit = getDeductionLimit(db);
  // 建具記号を <記号> だけ書いたとき、セットの部位が採る数値（画面と同じ採り方）
  const partValues = getFittingPartValues(db);
  const fittingSymbols = fittings.map((fitting) => fitting.symbol);

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
  const evaluations: EvaluatedSheet[] = [];
  let inherited = { part1: "", part2: "", part2Split: 0, formwork: "" };

  rows.forEach((row) => {
    // 部位Ⅰ・部位Ⅱ・型枠は空欄なら入力のある上の行を引き継ぐ
    if (row.part1.trim() !== "") inherited = { ...inherited, part1: row.part1 };
    if (row.part2.trim() !== "")
      inherited = {
        ...inherited,
        part2: row.part2,
        part2Split: row.part2Split,
      };
    if (row.formwork.trim() !== "")
      inherited = { ...inherited, formwork: row.formwork };
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
      formwork: inherited.formwork,
      multiplier: row.multiplier,
      sourceKind:
        row.calcType === "frame"
          ? ("frame" as const)
          : row.calcType === "general"
            ? ("general" as const)
            : row.calcType === "pit"
              ? ("pit" as const)
              : row.calcType === "area"
                ? ("area" as const)
                : ("room" as const),
    };

    // 面積計算書はピット計算書と同じもの（同じ表に入る）
    if (row.calcType === "pit" || row.calcType === "area") {
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
      evaluations.push({
        context,
        sets,
        result: evaluateCalcSheet(sets, variables, (set) =>
          pitPartVariables(quantities, partOfSet(set)),
        ),
        shapeError: null,
      });
      return;
    }

    if (row.calcType === "general") {
      const sheet = generalSheets.get(row.id);
      if (!sheet) return;
      const sets = normalizeSets(parseJson<CalcSet[]>(sheet.lowerJson, []));
      // 汎用計算書は部位別入力表の天井高さを記号CHとして使う
      const variables = {
        CH: row.ceilingHeight ?? 0,
        ...calcVariables([], fittings),
      };
      evaluations.push({
        context,
        sets,
        result: evaluateCalcSheet(sets, variables),
        shapeError: null,
      });
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
      evaluations.push({
        context,
        sets,
        result: evaluateCalcSheet(sets, variables, (set) => ({
          ...linePartVariables(symbols, set.partName),
          ...fittingPartVariables(
            set,
            fittingSymbols,
            variables,
            partValues,
          ),
        })),
        shapeError: null,
      });
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
    const ceilingCodesParsed = parseCeilingCodes(sheet.ceilingCodesJson);
    const ceilingResult = ceilingQuantities(
      ceiling,
      solved,
      ceilingHeight,
      ceilingCodesParsed.heights,
    );
    // 天井面積は梁型（壁付き・天井付）が取る梁底（長さ×Ｗ幅）の分を引く
    const beamArea = beamFootprintArea(ceiling, solved, ceilingHeight);
    // まるごと低い天井の区画に面している壁は、その区画の高さで壁面積を計算する
    const edgeHeights = wallEdgeHeights(
      ceiling,
      solved,
      ceilingHeight,
      ceilingCodesParsed.heights,
    );
    const symbols = [
      ...roomSymbols(
        solved,
        ceilingHeight,
        sheetFittings,
        deductionLimit,
        beamArea,
        edgeHeights,
      ),
      ...(ceiling.length > 0 ? ceilingSymbols(ceilingResult) : []),
    ];
    // 記号表にいつも出している記号は、その部屋に無くても0として計算式で使える
    // <記号:RF> は部屋計算書では建具表の軸組横補強（施工高さを掛けない。画面と同じ採り方）
    const variables = withFixedRoomSymbols({
      ...calcVariables(symbols, fittings),
      ...Object.fromEntries(
        fittings.flatMap((fitting) => {
          const reinforcement = computeFitting(fitting).reinforcement;
          return reinforcement === null
            ? []
            : [[`<${fitting.symbol}:RF>`, reinforcement]];
        }),
      ),
    });
    evaluations.push({
      context,
      sets,
      result: evaluateCalcSheet(sets, variables, (set) =>
        fittingPartVariables(set, fittingSymbols, variables, partValues),
      ),
      // 形が決まらない部屋は壁・床の数量が出ない（画面では寸法欄が点滅する）
      shapeError:
        solved.error !== null
          ? solved.error
          : solved.missing.length > 0
            ? "寸法が足りず決められない辺があります"
            : null,
    });
  });

  return { evaluations, part2Order };
}

/** 計算書と転記入力表から集計詳細データを作る */
export function collectEntries(
  db: AppDatabase,
  projectId: number,
): AggregateEntry[] {
  const { evaluations, part2Order } = evaluateRowSheets(db, projectId);
  const entries = evaluations.flatMap(({ context, sets, result }) =>
    entriesFromCalcSheet(context, sets, result),
  );

  entries.push(...miscEntries(db, projectId, part2Order));
  entries.push(...furnitureEntries(db, projectId, part2Order));
  entries.push(...fireproofEntries(db, projectId, part2Order));
  entries.push(...transferEntries(db, projectId, part2Order));
  return entries;
}

/**
 * 計算に誤りのある計算書を持つ行と、その誤りの説明
 * （部位別入力表の備考欄「計算エラー」の目印と、何が誤りかを示す説明に使う）。
 * 誤り＝下段の計算式の誤り（式が正しくない・B記号が解けない）か、
 * 部屋計算書は上段の形が決まらないとき。
 */
export function listCalcErrors(
  db: AppDatabase,
  projectId: number,
): Map<number, string> {
  const errored = new Map<number, string>();
  evaluateRowSheets(db, projectId).evaluations.forEach(
    ({ context, result, shapeError }) => {
      if (context.estimateRowId === null) return;
      const messages = [
        ...(shapeError !== null ? [shapeError] : []),
        ...result.errors.map((error) => error.message),
      ];
      const unique = [...new Set(messages)];
      if (unique.length > 0)
        errored.set(context.estimateRowId, unique.join("／"));
    },
  );
  return errored;
}

/** 部位別雑・金物入力表（その部屋の計算書に入れたのと同じ扱いで集計する） */
function miscEntries(
  db: AppDatabase,
  projectId: number,
  part2Order: Map<string, number>,
): AggregateEntry[] {
  const sheets = db
    .select()
    .from(projectMiscSheets)
    .where(eq(projectMiscSheets.projectId, projectId))
    .orderBy(asc(projectMiscSheets.displayOrder), asc(projectMiscSheets.id))
    .all();
  return sheets.flatMap((sheet) => {
    const columns = parseJson<MiscColumn[]>(sheet.columnsJson, []);
    const rows = parseJson<MiscRow[]>(sheet.rowsJson, []);
    rows.forEach((row) => {
      if (!part2Order.has(row.part2))
        part2Order.set(row.part2, part2Order.size);
    });
    return entriesFromMiscSheet({ columns, rows }, part2Order);
  });
}

/** 耐火被覆・塗装入力表（1行＝1明細。数量は柱入力表＋梁型入力表の必要数㎡合計×倍率） */
function fireproofEntries(
  db: AppDatabase,
  projectId: number,
  part2Order: Map<string, number>,
): AggregateEntry[] {
  const sheet = db
    .select()
    .from(projectFireproofSheets)
    .where(eq(projectFireproofSheets.projectId, projectId))
    .get();
  if (!sheet) return [];
  return entriesFromFireproofSheet(
    normalizeManageRows(parseJson<unknown>(sheet.estimateJson, [])),
    normalizeFloorList(parseJson<unknown>(sheet.columnsJson, {})),
    part2Order,
    normalizeFloorList(parseJson<unknown>(sheet.beamsJson, {})),
    normalizeCommonRows(parseJson<unknown>(sheet.commonJson, [])),
  );
}

/** 建具表の記号・W・H（カーテン・ブラインドの寸法呼び出し用） */
function fittingSizes(db: AppDatabase, projectId: number): FittingSize[] {
  return listFittings(db, projectId).map((fitting) => ({
    symbol: fitting.symbol,
    width: fitting.width,
    height: fitting.height,
  }));
}

/** 家具・設備入力表（家具計算書）。部位Ⅰ〜Ⅲの計算書に入れたのと同じ扱いで集計する */
function furnitureEntries(
  db: AppDatabase,
  projectId: number,
  part2Order: Map<string, number>,
): AggregateEntry[] {
  const fittings = fittingSizes(db, projectId);
  const sheets = db
    .select()
    .from(projectFurnitureSheets)
    .where(eq(projectFurnitureSheets.projectId, projectId))
    .orderBy(
      asc(projectFurnitureSheets.displayOrder),
      asc(projectFurnitureSheets.id),
    )
    .all();
  return sheets.flatMap((raw) => {
    // 建具明細作成表は集計のたびに建具表と取り合う（建具表側で寸法を直した分も拾う）
    const sheet = isFittingDetailSheet(raw.kind)
      ? syncFittingDetailSheet(db, raw)
      : raw;
    if (!part2Order.has(sheet.part2))
      part2Order.set(sheet.part2, part2Order.size);
    const rows = parseJson<FurnitureRow[]>(sheet.rowsJson, []);
    const settings = {
      ...furnitureSettings(),
      ...parseJson<FurnitureSettings>(sheet.settingsJson, furnitureSettings()),
    };
    // 建具明細作成表に置き場所（部位Ⅰ・部位Ⅱ）は無い：集計書での根拠は各明細の部位
    const fittingDetail = isFittingDetailSheet(sheet.kind);
    return entriesFromFurnitureSheet(
      {
        sheetId: sheet.id,
        part1: fittingDetail ? "" : sheet.part1,
        part2: fittingDetail ? "" : sheet.part2,
        part2Split: fittingDetail ? false : sheet.part2Split === 1,
        part3: sheet.name,
        multiplier: sheet.multiplier,
      },
      {
        rows,
        settings,
        kind: sheet.kind,
        columns: parseJson<FurnitureColumn[]>(sheet.columnsJson, []),
        fittings,
      },
      part2Order,
    );
  });
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

  return (
    rows
      .map((row, index) => ({ row, head: inherited[index] }))
      // 部位名・名称が無くても、摘要や備考だけの行（仕様の続きなど）も計上する
      .filter(
        ({ row }) =>
          [
            row.partName,
            row.name,
            row.descriptionUpper,
            row.descriptionLower,
            row.remarks,
            row.remarksLower,
          ].some((text) => text.trim() !== "") || row.quantity !== null,
      )
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
          partNumber: head.partId,
          partName: row.partName,
          detailNumber: head.detailNumber,
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
      })
  );
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
    if (edit.estimateDisplay !== undefined) {
      detail.estimateDisplay = edit.estimateDisplay;
    }
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
  const { projectId, runId, edits } = request;
  const details = db
    .select()
    .from(projectAggregateDetails)
    .where(eq(projectAggregateDetails.runId, runId))
    .all();

  db.transaction((tx) => {
    edits.forEach((edit) => {
      // 手入力行は計算書を持たないので、手入力テーブルだけを直す
      const manualId = manualIdOf(edit.masterKey);
      if (manualId !== null) {
        tx.update(projectManualAggregateItems)
          .set({
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
            ...(edit.estimateDisplay === undefined
              ? {}
              : { estimateDisplay: edit.estimateDisplay }),
            quantity: edit.quantity ?? 0,
          })
          .where(
            and(
              eq(projectManualAggregateItems.id, manualId),
              eq(projectManualAggregateItems.projectId, projectId),
            ),
          )
          .run();
        return;
      }

      const matched = details.filter(
        (detail) => detail.masterKey === edit.masterKey,
      );
      if (matched.length === 0) return;

      // 直した結果この行の集計キーが変わるとき、
      // この行をアンカーにしている手入力行の指し先もそろえる
      const itemRow = tx
        .select()
        .from(projectAggregateItems)
        .where(
          and(
            eq(projectAggregateItems.runId, runId),
            eq(projectAggregateItems.masterKey, edit.masterKey),
          ),
        )
        .get();
      if (itemRow) {
        const nextKey = masterKeyOf({
          part1: itemRow.part1,
          part2: itemRow.part2,
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
          estimateDisplay: edit.estimateDisplay ?? itemRow.estimateDisplay,
        });
        if (nextKey !== edit.masterKey) {
          tx.update(projectManualAggregateItems)
            .set({ afterMasterKey: nextKey })
            .where(
              and(
                eq(projectManualAggregateItems.projectId, projectId),
                eq(projectManualAggregateItems.afterMasterKey, edit.masterKey),
              ),
            )
            .run();
        }
      }

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
        estimateDisplay: edit.estimateDisplay ?? head.estimateDisplay,
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

      const targets = matched;

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
        const miscSheets = tx
          .select()
          .from(projectMiscSheets)
          .where(eq(projectMiscSheets.projectId, projectId))
          .all();
        miscSheets.forEach((miscSheet) => {
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
        });
      }

      // 家具・設備入力表の明細（右側の明細欄。左の入力欄には返さない）
      const furnitureRowIds = new Set(
        targets
          .filter((target) => target.traceId.startsWith("furniture:"))
          .map((target) => target.traceId.split(":")[2]),
      );
      // タテ方向の明細（列）は列ごとに直す
      const furnitureColumnIds = new Set(
        targets
          .filter((target) => target.traceId.startsWith("furniturecol:"))
          .map((target) => target.traceId.split(":")[3]),
      );
      if (furnitureRowIds.size > 0 || furnitureColumnIds.size > 0) {
        const furnitureSheets = tx
          .select()
          .from(projectFurnitureSheets)
          .where(eq(projectFurnitureSheets.projectId, projectId))
          .all();
        const fittings = fittingSizes(tx, projectId);
        furnitureSheets.forEach((furnitureSheet) => {
          const settings = {
            ...furnitureSettings(),
            ...parseJson<FurnitureSettings>(
              furnitureSheet.settingsJson,
              furnitureSettings(),
            ),
          };
          const rows = applyFurnitureDetails(
            parseJson<FurnitureRow[]>(furnitureSheet.rowsJson, []),
            settings,
            furnitureSheet.kind,
            fittings,
          );
          let furnitureChanged = false;
          const nextRows = rows.map((row) => {
            if (!furnitureRowIds.has(row.id)) return row;
            furnitureChanged = true;
            const changed: Record<string, string> = {
              partName: edit.partName,
              name: edit.name,
              descriptionUpper: edit.descriptionUpper,
              descriptionLower: edit.descriptionLower,
              unit: edit.unit,
              remarksUpper: edit.remarksUpper,
              remarksLower: edit.remarksLower,
            };
            const edited = [...row.detail.edited];
            Object.entries(changed).forEach(([key, value]) => {
              const before: unknown = (
                row.detail as unknown as Record<string, unknown>
              )[key];
              if (before !== value && !edited.includes(key)) edited.push(key);
            });
            return {
              ...row,
              detail: {
                ...row.detail,
                ...changed,
                subjectId: edit.subjectId,
                materialCategory: edit.materialCategory,
                partNumber: edit.partNumber,
                detailNumber: edit.detailNumber,
                edited,
              },
            };
          });
          const furnitureColumns = parseJson<FurnitureColumn[]>(
            furnitureSheet.columnsJson,
            [],
          );
          let columnChanged = false;
          const nextFurnitureColumns = furnitureColumns.map((column) => {
            if (!furnitureColumnIds.has(column.id)) return column;
            columnChanged = true;
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
          if (furnitureChanged || columnChanged) {
            tx.update(projectFurnitureSheets)
              .set({
                rowsJson: JSON.stringify(nextRows),
                columnsJson: JSON.stringify(nextFurnitureColumns),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(projectFurnitureSheets.id, furnitureSheet.id))
              .run();
          }
        });
      }

      // 耐火被覆・塗装入力表の明細（入力管理表の行。汎用計算書の行はセット明細）
      const fireproofTraceIds = targets
        .filter((target) => target.traceId.startsWith("fireproof:"))
        .map((target) => target.traceId);
      // 「fireproof:行ID」＝管理表の明細、「fireproof:行ID:セットID:明細ID」＝汎用計算書の明細
      const fireproofRowIds = new Set(
        fireproofTraceIds
          .filter((traceId) => traceId.split(":").length === 2)
          .map((traceId) => traceId.split(":")[1]),
      );
      const fireproofSetTargets = new Map<string, string[]>();
      fireproofTraceIds.forEach((traceId) => {
        const parts = traceId.split(":");
        if (parts.length < 4) return;
        const list = fireproofSetTargets.get(parts[1]) ?? [];
        list.push(`${parts[2]}:${parts[3]}`);
        fireproofSetTargets.set(parts[1], list);
      });
      if (fireproofRowIds.size > 0 || fireproofSetTargets.size > 0) {
        const fireproofSheet = tx
          .select()
          .from(projectFireproofSheets)
          .where(eq(projectFireproofSheets.projectId, projectId))
          .get();
        if (fireproofSheet) {
          const manageRows = normalizeManageRows(
            parseJson<unknown>(fireproofSheet.estimateJson, []),
          );
          let fireproofChanged = false;
          const nextManageRows = manageRows.map((manageRow) => {
            const setTargets = fireproofSetTargets.get(manageRow.id);
            if (setTargets) {
              // 汎用計算書のセット明細を直す（管理表の明細欄は触らない）
              const nextJson = applyEditToSheet(
                JSON.stringify(manageRow.generalSheet),
                setTargets.map((key) => `general:${key}`),
                edit,
              );
              if (nextJson !== null) {
                fireproofChanged = true;
                return {
                  ...manageRow,
                  generalSheet: parseJson<CalcSet[]>(nextJson, []),
                };
              }
            }
            if (!fireproofRowIds.has(manageRow.id)) return manageRow;
            fireproofChanged = true;
            return {
              ...manageRow,
              detail: {
                ...manageRow.detail,
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
              },
            };
          });
          if (fireproofChanged) {
            tx.update(projectFireproofSheets)
              .set({
                estimateJson: JSON.stringify(nextManageRows),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(projectFireproofSheets.id, fireproofSheet.id))
              .run();
          }
        }
      }

      // 計算書（部屋別・軸組・汎用）の下段
      const sheetTargets = new Map<string, string[]>();
      targets.forEach((target) => {
        if (target.sourceKind === "misc") return;
        if (target.sourceKind === "furniture") return;
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
              : sourceKind === "pit" || sourceKind === "area"
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
    manual: isManualMasterKey(row.masterKey),
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
  const fresh = mergedAggregateItems(
    db,
    projectId,
    collectEntries(db, projectId),
    skipPart2,
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

/** チェック表の設定（部位番号の並び）で、その部位番号が入る列を探す */
function mappedPartId(
  partNumber: number | null,
  partMap: Record<string, string>,
): number | null {
  if (partNumber === null || !Number.isFinite(partNumber)) return null;
  const whole = Math.floor(partNumber);
  for (const [key, text] of Object.entries(partMap)) {
    const numbers = parseNumberRanges(text);
    if (numbers && numbers.has(whole)) {
      const id = Number(key);
      if (Number.isFinite(id)) return id;
    }
  }
  return null;
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
  const partMap = getCheckSheetPartMap(db);
  const byRow = new Map<
    number,
    Map<string, { name: string; quantity: number; baseQuantity: number }>
  >();

  collectEntries(db, projectId).forEach((entry) => {
    if (entry.estimateRowId === null) return;
    if (entry.materialCategory !== materialCategory) return;
    if (entry.name.trim() === "") return;
    const mapped = mappedPartId(entry.partNumber, partMap);
    const partId = mapped ?? aggregationPartIdOf(entry.partNumber);
    const part =
      parts.find((row) => row.id === partId) ??
      parts.find((row) => entry.partName.includes(row.name));
    if (!part) return;
    const cells =
      byRow.get(entry.estimateRowId) ??
      new Map<
        string,
        { name: string; quantity: number; baseQuantity: number }
      >();
    byRow.set(entry.estimateRowId, cells);
    // 倍率なしの数量（計算書そのままの数量）＝セット累計×掛け率
    const baseQuantity = displayedValue(entry.setTotal * entry.coefficient);
    const cell = cells.get(part.name);
    if (cell) {
      // 同じ部位に複数の明細があるときは、名称を並べて数量を合計する
      cells.set(part.name, {
        name: cell.name.includes(entry.name)
          ? cell.name
          : `${cell.name}／${entry.name}`,
        quantity: displayedValue(cell.quantity + entry.quantity),
        baseQuantity: displayedValue(cell.baseQuantity + baseQuantity),
      });
      return;
    }
    cells.set(part.name, {
      name: entry.name,
      quantity: displayedValue(entry.quantity),
      baseQuantity,
    });
  });

  return [...byRow.entries()].map(([estimateRowId, cells]) => ({
    estimateRowId,
    cells: [...cells.entries()].map(([partName, cell]) => ({
      partName,
      name: cell.name,
      quantity: cell.quantity,
      baseQuantity: cell.baseQuantity,
    })),
  }));
}
