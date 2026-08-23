import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { calcSheetDefinitions, detailChangeLogs, mDetails } from "../db/schema";
import type {
  Detail,
  DetailChangeLog,
  DetailSnapshot,
  MasterOptions,
  SaveDetailsRequest,
  SyncDetailsResult,
} from "../../shared/types";
import { DETAIL_NUMBER_DECIMALS } from "../../shared/detailNumber";
import {
  listProjectBasicMasters,
  listProjectSubjects,
} from "./projectMasterService";

/** 明細番号は小数2桁に丸めて保持する */
function normalizeDetailNumber(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) return null;
  return Number(value.toFixed(DETAIL_NUMBER_DECIMALS));
}

/** 修正履歴に残す項目だけ取り出す（並び順や更新日時は履歴に出さない） */
function snapshotOf(row: {
  detailNumber: number | null;
  materialCategory: string;
  partName: string;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  isActive: boolean;
}): DetailSnapshot {
  return {
    detailNumber: row.detailNumber,
    materialCategory: row.materialCategory,
    partName: row.partName,
    name: row.name,
    descriptionUpper: row.descriptionUpper,
    descriptionLower: row.descriptionLower,
    unit: row.unit,
    remarksUpper: row.remarksUpper,
    remarksLower: row.remarksLower,
    estimateDisplay: row.estimateDisplay,
    isActive: row.isActive,
  };
}

/** 修正前と修正後で違う項目（画面で赤文字にする欄） */
export function changedFieldsOf(
  before: DetailSnapshot | null,
  after: DetailSnapshot | null,
): (keyof DetailSnapshot)[] {
  if (before === null || after === null) return [];
  return (Object.keys(after) as (keyof DetailSnapshot)[]).filter(
    (key) => before[key] !== after[key],
  );
}

function parseSnapshot(text: string): DetailSnapshot | null {
  if (text === "") return null;
  const parsed: unknown = JSON.parse(text);
  return parsed as DetailSnapshot;
}

/** 修正履歴一覧（新しい修正が上）。物件専用は projectId、基本マスターは null */
export function listDetailChangeLogs(
  db: AppDatabase,
  projectId: number | null = null,
): DetailChangeLog[] {
  return db
    .select()
    .from(detailChangeLogs)
    .where(
      projectId === null
        ? isNull(detailChangeLogs.projectId)
        : eq(detailChangeLogs.projectId, projectId),
    )
    .orderBy(desc(detailChangeLogs.changedAt), desc(detailChangeLogs.id))
    .all()
    .map((row) => {
      const before = parseSnapshot(row.beforeJson);
      const after = parseSnapshot(row.afterJson);
      return {
        id: row.id,
        changedAt: row.changedAt,
        scope: row.scope,
        projectId: row.projectId,
        subjectId: row.subjectId,
        detailId: row.detailId,
        changeKind: row.changeKind as DetailChangeLog["changeKind"],
        before,
        after,
        changedFields: changedFieldsOf(before, after),
      };
    });
}

/** projectId を渡すと、その工事が持っているマスター（無い種類は基本マスター）を返す */
export function listMasterOptions(
  db: AppDatabase,
  projectId: number | null = null,
): MasterOptions {
  const masters = listProjectBasicMasters(db, projectId);
  return {
    subjects: listProjectSubjects(db, projectId),
    materialCategories: masters.materialCategories.map((row, index) => ({
      id: row.id,
      code: String(row.id),
      name: row.name,
      displayOrder: index,
    })),
    units: masters.units.map((row, index) => ({
      id: row.id,
      name: row.name,
      displayOrder: index,
    })),
    formworkCategories: masters.formworkCategories.map((row) => ({
      id: row.id,
      name: row.name,
    })),
    pickupParts: masters.pickupParts.map((row) => ({
      id: row.id,
      name: row.name,
    })),
    aggregationParts: masters.aggregationParts.map((row) => ({
      id: row.id,
      name: row.name,
    })),
    calcSheets: db
      .select({
        id: calcSheetDefinitions.id,
        key: calcSheetDefinitions.key,
        name: calcSheetDefinitions.name,
      })
      .from(calcSheetDefinitions)
      .orderBy(asc(calcSheetDefinitions.displayOrder))
      .all(),
  };
}

/** 物件専用（工事マスター）は projectId を渡す。基本マスターは null */
function scopeCondition(projectId: number | null) {
  return projectId === null
    ? and(eq(mDetails.scope, "basic"), isNull(mDetails.projectId))
    : and(eq(mDetails.scope, "project"), eq(mDetails.projectId, projectId));
}

export function listDetails(
  db: AppDatabase,
  subjectId: number,
  projectId: number | null = null,
): Detail[] {
  return db
    .select()
    .from(mDetails)
    .where(and(eq(mDetails.subjectId, subjectId), scopeCondition(projectId)))
    .orderBy(asc(mDetails.displayOrder), asc(mDetails.id))
    .all();
}

/**
 * 工事を作ったときに基本マスターの明細を物件専用へ複製する。
 * 物件側で自由に直せるようにコピーし、複製元IDだけ残して大元への同期に使う。
 */
export function copyBasicDetailsToProject(
  db: AppDatabase,
  projectId: number,
): number {
  const source = db
    .select()
    .from(mDetails)
    .where(scopeCondition(null))
    .orderBy(
      asc(mDetails.subjectId),
      asc(mDetails.displayOrder),
      asc(mDetails.id),
    )
    .all();
  if (source.length === 0) return 0;
  db.transaction((tx) => {
    source.forEach((row) => {
      tx.insert(mDetails)
        .values({
          subjectId: row.subjectId,
          detailNumber: row.detailNumber,
          materialCategory: row.materialCategory,
          partName: row.partName,
          name: row.name,
          descriptionUpper: row.descriptionUpper,
          descriptionLower: row.descriptionLower,
          unit: row.unit,
          remarksUpper: row.remarksUpper,
          remarksLower: row.remarksLower,
          estimateDisplay: row.estimateDisplay,
          displayOrder: row.displayOrder,
          isActive: row.isActive,
          scope: "project",
          projectId,
          sourceDetailId: row.id,
        })
        .run();
    });
  });
  return source.length;
}

/**
 * 物件専用マスターで直した明細を大元（基本マスター）へ反映する。
 * 複製元がある行は上書き、物件で新しく作った行は基本マスターの末尾へ追加する。
 */
export function syncProjectDetailsToBasic(
  db: AppDatabase,
  projectId: number,
  subjectId: number,
): SyncDetailsResult {
  const rows = listDetails(db, subjectId, projectId);
  let updated = 0;
  let added = 0;
  db.transaction((tx) => {
    const basic = tx.select().from(mDetails).where(scopeCondition(null)).all();
    const basicById = new Map(basic.map((row) => [row.id, row]));
    let nextOrder =
      basic
        .filter((row) => row.subjectId === subjectId)
        .reduce((max, row) => Math.max(max, row.displayOrder), -1) + 1;
    rows.forEach((row) => {
      const values = {
        subjectId,
        detailNumber: row.detailNumber,
        materialCategory: row.materialCategory,
        partName: row.partName,
        name: row.name,
        descriptionUpper: row.descriptionUpper,
        descriptionLower: row.descriptionLower,
        unit: row.unit,
        remarksUpper: row.remarksUpper,
        remarksLower: row.remarksLower,
        estimateDisplay: row.estimateDisplay,
        isActive: row.isActive,
        updatedAt: new Date().toISOString(),
      };
      if (row.sourceDetailId !== null && basicById.has(row.sourceDetailId)) {
        tx.update(mDetails)
          .set(values)
          .where(eq(mDetails.id, row.sourceDetailId))
          .run();
        updated += 1;
        return;
      }
      const createdId = Number(
        tx
          .insert(mDetails)
          .values({
            ...values,
            displayOrder: nextOrder,
            scope: "basic",
            projectId: null,
          })
          .run().lastInsertRowid,
      );
      nextOrder += 1;
      tx.update(mDetails)
        .set({ sourceDetailId: createdId })
        .where(eq(mDetails.id, row.id))
        .run();
      added += 1;
    });
  });
  return { updated, added };
}

/**
 * 明細マスター画面の一括保存。
 * 画面の行順をそのまま display_order として採番し、削除行を物理削除する。
 * Undoで復活した行（IDを持つが既にDBに無い行）は同じIDで再作成する。
 */
export function saveDetails(
  db: AppDatabase,
  request: SaveDetailsRequest,
): Detail[] {
  const { subjectId, rows, deletedIds } = request;
  const projectId = request.projectId ?? null;
  const scope = projectId === null ? "basic" : "project";
  const existing = new Map(
    listDetails(db, subjectId, projectId).map((row) => [row.id, row]),
  );
  db.transaction((tx) => {
    const log = (
      detailId: number | null,
      changeKind: DetailChangeLog["changeKind"],
      before: DetailSnapshot | null,
      after: DetailSnapshot | null,
    ): void => {
      tx.insert(detailChangeLogs)
        .values({
          scope,
          projectId,
          subjectId,
          detailId,
          changeKind,
          beforeJson: before === null ? "" : JSON.stringify(before),
          afterJson: after === null ? "" : JSON.stringify(after),
        })
        .run();
    };
    if (deletedIds.length > 0) {
      deletedIds.forEach((id) => {
        const before = existing.get(id);
        if (before) log(id, "delete", snapshotOf(before), null);
      });
      tx.delete(mDetails).where(inArray(mDetails.id, deletedIds)).run();
    }
    rows.forEach((row, index) => {
      const values = {
        subjectId,
        scope: projectId === null ? "basic" : "project",
        projectId,
        detailNumber: normalizeDetailNumber(row.detailNumber),
        materialCategory: row.materialCategory,
        partName: row.partName,
        name: row.name,
        descriptionUpper: row.descriptionUpper,
        descriptionLower: row.descriptionLower,
        unit: row.unit,
        remarksUpper: row.remarksUpper,
        remarksLower: row.remarksLower,
        estimateDisplay: row.estimateDisplay,
        isActive: row.isActive,
        displayOrder: index,
      };
      const after = snapshotOf(values);
      if (row.id === null) {
        const createdId = Number(
          tx.insert(mDetails).values(values).run().lastInsertRowid,
        );
        log(createdId, "add", null, after);
        return;
      }
      const before = existing.get(row.id);
      const updated = tx
        .update(mDetails)
        .set({ ...values, updatedAt: new Date().toISOString() })
        .where(eq(mDetails.id, row.id))
        .run();
      if (updated.changes === 0) {
        tx.insert(mDetails)
          .values({ ...values, id: row.id })
          .run();
      }
      if (!before) {
        log(row.id, "add", null, after);
        return;
      }
      const beforeSnapshot = snapshotOf(before);
      if (changedFieldsOf(beforeSnapshot, after).length > 0) {
        log(row.id, "edit", beforeSnapshot, after);
      }
    });
  });
  return listDetails(db, subjectId, projectId);
}
