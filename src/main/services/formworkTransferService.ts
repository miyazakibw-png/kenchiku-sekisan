import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  mFormworkCategories,
  projectAggregateDetails,
  projectAggregateItems,
  projectAggregateRuns,
  projectFormworkRuns,
  projectTransferRows,
} from "../db/schema";
import {
  buildFormworkTransferRows,
  orderFormworkRows,
  storedRowSignature,
  type FormworkCategory,
  type FormworkSourceDetail,
  type FormworkTransferRow,
} from "../../core/aggregate/formworkTransfer";
import type {
  DeleteFormworkRunRequest,
  FormworkSourceItem,
  FormworkRunView,
  FormworkTransferView,
  RunFormworkTransferRequest,
  RunFormworkTransferResult,
} from "../../shared/types";
import { runAggregation } from "./aggregationService";

function latestRunId(db: AppDatabase, projectId: number): number | null {
  const run = db
    .select({ id: projectAggregateRuns.id })
    .from(projectAggregateRuns)
    .where(eq(projectAggregateRuns.projectId, projectId))
    .orderBy(desc(projectAggregateRuns.id))
    .limit(1)
    .all();
  return run.length > 0 ? run[0].id : null;
}

/** 型枠分類マスター（転記の並びは登録番号順） */
function formworkCategories(db: AppDatabase): FormworkCategory[] {
  return db
    .select()
    .from(mFormworkCategories)
    .orderBy(asc(mFormworkCategories.displayOrder), asc(mFormworkCategories.id))
    .all()
    .map((category) => ({
      id: category.id,
      name: category.name,
      displayOrder: category.displayOrder,
    }));
}

/** 集計詳細データ（部屋ごとの拾い1行）。型枠転記の元になる数量 */
function sourceDetails(
  db: AppDatabase,
  projectId: number,
): FormworkSourceDetail[] {
  const runId = latestRunId(db, projectId);
  if (runId === null) return [];
  return db
    .select()
    .from(projectAggregateDetails)
    .where(eq(projectAggregateDetails.runId, runId))
    .all()
    .map((detail) => ({
      masterKey: detail.masterKey,
      formwork: detail.formwork,
      part1: detail.part1,
      part2: detail.part2,
      part2Split: detail.part2Split === 1,
      quantity: detail.quantity,
    }));
}

/** 型枠転記の元にできる明細（最新の集計書兼工事マスター） */
function sourceItems(db: AppDatabase, projectId: number): FormworkSourceItem[] {
  const runId = latestRunId(db, projectId);
  if (runId === null) return [];
  return db
    .select()
    .from(projectAggregateItems)
    .where(eq(projectAggregateItems.runId, runId))
    .orderBy(asc(projectAggregateItems.displayOrder))
    .all()
    .map((item) => ({
      masterKey: item.masterKey,
      part1: item.part1,
      part2: item.part2,
      subjectId: item.subjectId,
      materialCategory: item.materialCategory,
      partNumber: item.partNumber,
      partName: item.partName,
      detailNumber: item.detailNumber,
      name: item.name,
      descriptionUpper: item.descriptionUpper,
      descriptionLower: item.descriptionLower,
      unit: item.unit,
      quantity: item.quantity,
    }));
}

function formworkRuns(db: AppDatabase, projectId: number): FormworkRunView[] {
  return db
    .select()
    .from(projectFormworkRuns)
    .where(eq(projectFormworkRuns.projectId, projectId))
    .orderBy(desc(projectFormworkRuns.id))
    .all()
    .map((run) => ({
      id: run.id,
      createdAt: run.createdAt,
      search: run.search,
      current: run.current === 1,
      rows: JSON.parse(run.rowsJson) as FormworkTransferRow[],
    }));
}

/** 型枠転記の画面データ（元明細と算出結果の履歴） */
export function getFormworkTransfer(
  db: AppDatabase,
  projectId: number,
): FormworkTransferView {
  const runs = formworkRuns(db, projectId);
  return {
    sources: sourceItems(db, projectId),
    groups: [],
    runs,
    lastSearch: runs[0]?.search ?? "",
  };
}

/** 転記入力表に入っている型枠転記の行の並び（④で並び替えた順を覚えるため） */
function storedRowOrder(db: AppDatabase, projectId: number): string[] {
  return db
    .select()
    .from(projectTransferRows)
    .where(eq(projectTransferRows.projectId, projectId))
    .orderBy(asc(projectTransferRows.displayOrder))
    .all()
    .filter((row) => row.formworkKey !== "")
    .map((row) => storedRowSignature(row));
}

/** 型枠転記で作った行を消して、渡された順で入れ直す */
function replaceFormworkRows(
  tx: AppDatabase,
  projectId: number,
  rows: readonly FormworkTransferRow[],
): void {
  const existing = tx
    .select()
    .from(projectTransferRows)
    .where(eq(projectTransferRows.projectId, projectId))
    .all();
  existing
    .filter((row) => row.formworkKey !== "")
    .forEach((row) => {
      tx.delete(projectTransferRows)
        .where(eq(projectTransferRows.id, row.id))
        .run();
    });
  let order =
    existing
      .filter((row) => row.formworkKey === "")
      .reduce((max, row) => Math.max(max, row.displayOrder), -1) + 1;
  rows.forEach((row) => {
    tx.insert(projectTransferRows)
      .values({
        projectId,
        part1: row.part1,
        part2: row.part2,
        part2Split: row.part2Split ? 1 : 0,
        formwork: row.formwork,
        part3: row.part3,
        subjectId: row.subjectId,
        materialCategory: row.materialCategory,
        partId: row.partNumber,
        partName: row.partName,
        detailNumber: row.detailNumber,
        name: row.name,
        sourceDetailId: null,
        descriptionUpper: row.description,
        descriptionLower: row.descriptionLower,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: null,
        amount: null,
        remarks: row.remarks,
        remarksLower: "",
        memo: "",
        formworkKey: row.formworkKey,
        displayOrder: order,
      })
      .run();
    order += 1;
  });
}

function formworkRunTimestamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * 集計し直してから型枠転記の結果を作り、結果の履歴と転記入力表へ保存する。
 */
export function runFormworkTransfer(
  db: AppDatabase,
  request: RunFormworkTransferRequest,
): RunFormworkTransferResult {
  const { projectId, rules, search } = request;
  runAggregation(db, projectId);
  const rows = orderFormworkRows(
    buildFormworkTransferRows(
      sourceDetails(db, projectId),
      rules,
      formworkCategories(db),
    ),
    storedRowOrder(db, projectId),
  );
  if (rows.length === 0)
    return { ...getFormworkTransfer(db, projectId), created: false };

  db.transaction((tx) => {
    replaceFormworkRows(tx, projectId, rows);
    tx.update(projectFormworkRuns)
      .set({ current: 0 })
      .where(eq(projectFormworkRuns.projectId, projectId))
      .run();
    tx.insert(projectFormworkRuns)
      .values({
        projectId,
        createdAt: formworkRunTimestamp(),
        search,
        rowsJson: JSON.stringify(rows),
        current: 1,
      })
      .run();
  });
  runAggregation(db, projectId);
  return { ...getFormworkTransfer(db, projectId), created: true };
}

/**
 * ④の表で並び替えた順を転記入力表へ反映する。
 * 作った行を全部消して並び替えた順に入れ直す（手入力の行はそのまま残す）。
 */
export function reorderFormworkTransfer(
  db: AppDatabase,
  projectId: number,
  rows: readonly FormworkTransferRow[],
): FormworkTransferView {
  db.transaction((tx) => {
    replaceFormworkRows(tx, projectId, rows);
    tx.update(projectFormworkRuns)
      .set({ rowsJson: JSON.stringify(rows) })
      .where(
        and(
          eq(projectFormworkRuns.projectId, projectId),
          eq(projectFormworkRuns.current, 1),
        ),
      )
      .run();
  });
  return getFormworkTransfer(db, projectId);
}

export function deleteFormworkRun(
  db: AppDatabase,
  request: DeleteFormworkRunRequest,
): FormworkTransferView {
  db.delete(projectFormworkRuns)
    .where(
      and(
        eq(projectFormworkRuns.projectId, request.projectId),
        eq(projectFormworkRuns.id, request.runId),
      ),
    )
    .run();
  return getFormworkTransfer(db, request.projectId);
}
