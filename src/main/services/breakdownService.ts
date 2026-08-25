/**
 * 内訳書。
 * 集計書兼工事マスター（最新の集計）から変換転記して内訳書の行を作り、提出の回ごとに保存する。
 * 1回目は確定するまで何度転記しても1回目。確定すると次の転記は2回目になる。
 */

import { asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  projectBreakdownRows,
  projectBreakdownSettings,
  projectBreakdownVersions,
} from "../db/schema";
import {
  buildBreakdownRows,
  collectSubjectOrder,
  collectUnits,
  DEFAULT_BREAKDOWN_SETTINGS,
  type BreakdownSettings,
  type BreakdownSourceItem,
  type BreakdownSubject,
  type TextReplacement,
} from "../../core/breakdown/breakdown";
import { getAggregate } from "./aggregationService";
import { listProjectSubjects } from "./projectMasterService";
import type {
  BreakdownRowRecord,
  BreakdownSettingsRecord,
  BreakdownVersion,
  BreakdownView,
} from "../../shared/types";

function parseReplacements(json: string): TextReplacement[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as { from?: unknown; to?: unknown };
    if (typeof record.from !== "string" || typeof record.to !== "string")
      return [];
    return [{ from: record.from, to: record.to }];
  });
}

function parseNumbers(json: string): number[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((value): value is number => typeof value === "number");
}

function parseStrings(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((value): value is string => typeof value === "string");
}

/** 内訳書の設定。無ければ既定値で作る */
export function getBreakdownSettings(
  db: AppDatabase,
  projectId: number,
): BreakdownSettingsRecord {
  const row = db
    .select()
    .from(projectBreakdownSettings)
    .where(eq(projectBreakdownSettings.projectId, projectId))
    .get();
  if (!row) {
    db.insert(projectBreakdownSettings).values({ projectId }).run();
    return {
      projectId,
      layout: DEFAULT_BREAKDOWN_SETTINGS.layout,
      namePattern: DEFAULT_BREAKDOWN_SETTINGS.namePattern,
      nameWidth: DEFAULT_BREAKDOWN_SETTINGS.nameWidth,
      roundThreshold1: DEFAULT_BREAKDOWN_SETTINGS.roundThreshold1,
      roundDecimals1: DEFAULT_BREAKDOWN_SETTINGS.roundDecimals1,
      roundThreshold2: DEFAULT_BREAKDOWN_SETTINGS.roundThreshold2,
      roundDecimals2: DEFAULT_BREAKDOWN_SETTINGS.roundDecimals2,
      roundDecimals3: DEFAULT_BREAKDOWN_SETTINGS.roundDecimals3,
      subjectOrder: [],
      replacements: [],
      unitOrder: [],
      workCategory: "建築主体工事",
    };
  }
  return {
    projectId,
    layout: row.layout,
    namePattern: row.namePattern,
    nameWidth: row.nameWidth,
    roundThreshold1: row.roundThreshold1,
    roundDecimals1: row.roundDecimals1,
    roundThreshold2: row.roundThreshold2,
    roundDecimals2: row.roundDecimals2,
    roundDecimals3: row.roundDecimals3,
    subjectOrder: parseNumbers(row.subjectOrderJson),
    replacements: parseReplacements(row.replacementsJson),
    unitOrder: parseStrings(row.unitOrderJson),
    workCategory: row.workCategory,
  };
}

export function saveBreakdownSettings(
  db: AppDatabase,
  settings: BreakdownSettingsRecord,
): BreakdownSettingsRecord {
  getBreakdownSettings(db, settings.projectId);
  db.update(projectBreakdownSettings)
    .set({
      layout: settings.layout,
      namePattern: settings.namePattern,
      nameWidth: settings.nameWidth,
      roundThreshold1: settings.roundThreshold1,
      roundDecimals1: settings.roundDecimals1,
      roundThreshold2: settings.roundThreshold2,
      roundDecimals2: settings.roundDecimals2,
      roundDecimals3: settings.roundDecimals3,
      subjectOrderJson: JSON.stringify(settings.subjectOrder),
      replacementsJson: JSON.stringify(settings.replacements),
      unitOrderJson: JSON.stringify(settings.unitOrder),
      workCategory: settings.workCategory,
    })
    .where(eq(projectBreakdownSettings.projectId, settings.projectId))
    .run();
  return getBreakdownSettings(db, settings.projectId);
}

function toCoreSettings(record: BreakdownSettingsRecord): BreakdownSettings {
  return {
    layout: record.layout,
    namePattern: record.namePattern,
    nameWidth: record.nameWidth,
    roundThreshold1: record.roundThreshold1,
    roundDecimals1: record.roundDecimals1,
    roundThreshold2: record.roundThreshold2,
    roundDecimals2: record.roundDecimals2,
    roundDecimals3: record.roundDecimals3,
    subjectOrder: record.subjectOrder,
    replacements: record.replacements,
    unitOrder: record.unitOrder,
  };
}

export function listBreakdownVersions(
  db: AppDatabase,
  projectId: number,
): BreakdownVersion[] {
  return db
    .select()
    .from(projectBreakdownVersions)
    .where(eq(projectBreakdownVersions.projectId, projectId))
    .orderBy(desc(projectBreakdownVersions.round))
    .all();
}

function listRows(db: AppDatabase, versionId: number): BreakdownRowRecord[] {
  return db
    .select()
    .from(projectBreakdownRows)
    .where(eq(projectBreakdownRows.versionId, versionId))
    .orderBy(asc(projectBreakdownRows.displayOrder))
    .all();
}

export function getBreakdown(
  db: AppDatabase,
  projectId: number,
  versionId?: number,
): BreakdownView {
  const settings = getBreakdownSettings(db, projectId);
  const versions = listBreakdownVersions(db, projectId);
  const version = versionId
    ? versions.find((item) => item.id === versionId)
    : versions[0];
  if (!version) return { version: null, rows: [], settings };
  return { version, rows: listRows(db, version.id), settings };
}

/** 工事専用の科目マスター（無ければ基本マスター）を使う */
function subjectList(db: AppDatabase, projectId: number): BreakdownSubject[] {
  return listProjectSubjects(db, projectId).map((subject) => ({
    id: subject.id,
    name: subject.name,
    displayOrder: subject.displayOrder,
  }));
}

/**
 * 集計書兼工事マスターから内訳書へ変換転記する。
 * 未確定の回があればその回を作り直し、無ければ次の回を作る。
 */
export function transferBreakdown(
  db: AppDatabase,
  projectId: number,
): BreakdownView {
  const aggregate = getAggregate(db, projectId);
  const subjects = subjectList(db, projectId);
  // 不要明細（人が印を付けた明細）は内訳書へ飛ばさない
  const items: BreakdownSourceItem[] = aggregate.items
    .filter((item) => !item.unused)
    .map((item) => ({
      id: item.id,
      masterKey: item.masterKey,
      subjectId: item.subjectId,
      partName: item.partName,
      name: item.name,
      descriptionUpper: item.descriptionUpper,
      descriptionLower: item.descriptionLower,
      quantity: item.quantity,
      unit: item.unit,
      remarksUpper: item.remarksUpper,
      remarksLower: item.remarksLower,
    }));

  // 集計書で使っている工種科目・単位を自動的に用意する（並びは前回の設定を優先）
  const stored = getBreakdownSettings(db, projectId);
  const used = collectSubjectOrder(items, subjects);
  const subjectOrder = [
    ...stored.subjectOrder.filter((id) => used.includes(id)),
    ...used.filter((id) => !stored.subjectOrder.includes(id)),
  ];
  const units = collectUnits(items);
  const unitOrder = [
    ...stored.unitOrder.filter((unit) => units.includes(unit)),
    ...units.filter((unit) => !stored.unitOrder.includes(unit)),
  ];
  const settings = saveBreakdownSettings(db, {
    ...stored,
    subjectOrder,
    unitOrder,
  });

  const versions = listBreakdownVersions(db, projectId);
  const open = versions.find((version) => version.confirmed === 0);
  let versionId: number;
  if (open) {
    versionId = open.id;
    db.delete(projectBreakdownRows)
      .where(eq(projectBreakdownRows.versionId, versionId))
      .run();
    db.update(projectBreakdownVersions)
      .set({ aggregateRunId: aggregate.run?.id ?? null })
      .where(eq(projectBreakdownVersions.id, versionId))
      .run();
  } else {
    const round = versions.length === 0 ? 1 : versions[0].round + 1;
    const created = db
      .insert(projectBreakdownVersions)
      .values({ projectId, round, aggregateRunId: aggregate.run?.id ?? null })
      .returning()
      .get();
    versionId = created.id;
  }

  const rows = buildBreakdownRows(items, subjects, toCoreSettings(settings));
  rows.forEach((row, index) => {
    db.insert(projectBreakdownRows)
      .values({
        versionId,
        displayOrder: index,
        rowKind: row.rowKind,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        masterKey: row.masterKey,
        aggregateItemId: row.aggregateItemId,
        partName: row.partName,
        nameUpper: row.nameUpper,
        nameLower: row.nameLower,
        descriptionUpper: row.descriptionUpper,
        descriptionLower: row.descriptionLower,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.unitPrice,
        amount: row.amount,
        remarksUpper: row.remarksUpper,
        remarksLower: row.remarksLower,
      })
      .run();
  });

  return getBreakdown(db, projectId, versionId);
}

/** 画面の並びをそのまま保存する（比較のための行挿入・上下移動を含む） */
export function saveBreakdownRows(
  db: AppDatabase,
  versionId: number,
  rows: BreakdownRowRecord[],
): BreakdownRowRecord[] {
  db.delete(projectBreakdownRows)
    .where(eq(projectBreakdownRows.versionId, versionId))
    .run();
  rows.forEach((row, index) => {
    db.insert(projectBreakdownRows)
      .values({
        versionId,
        displayOrder: index,
        rowKind: row.rowKind,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        masterKey: row.masterKey,
        aggregateItemId: row.aggregateItemId,
        partName: row.partName,
        nameUpper: row.nameUpper,
        nameLower: row.nameLower,
        descriptionUpper: row.descriptionUpper,
        descriptionLower: row.descriptionLower,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.unitPrice,
        amount: row.amount,
        remarksUpper: row.remarksUpper,
        remarksLower: row.remarksLower,
      })
      .run();
  });
  return listRows(db, versionId);
}

/** 提出した回を確定する（次の転記は新しい回になる） */
export function confirmBreakdownVersion(
  db: AppDatabase,
  versionId: number,
): BreakdownVersion | null {
  db.update(projectBreakdownVersions)
    .set({ confirmed: 1 })
    .where(eq(projectBreakdownVersions.id, versionId))
    .run();
  return (
    db
      .select()
      .from(projectBreakdownVersions)
      .where(eq(projectBreakdownVersions.id, versionId))
      .get() ?? null
  );
}
