import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  mFormworkCategories,
  projectAggregateDetails,
  projectAggregateItems,
  projectAggregateRuns,
  projectTransferRows,
  projectTransferRules,
} from "../db/schema";
import {
  buildFormworkTransferRows,
  collectFormworkQuantities,
  type FormworkCategory,
  type FormworkSourceDetail,
  type FormworkTransferRule,
  type FormworkTransferRow,
} from "../../core/aggregate/formworkTransfer";
import type {
  FormworkSourceItem,
  FormworkTransferView,
  SaveFormworkRulesRequest,
} from "../../shared/types";

const RULE_KIND = "formwork";

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

function splitKeys(text: string): string[] {
  return text
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key !== "");
}

export function listFormworkRules(
  db: AppDatabase,
  projectId: number,
): FormworkTransferRule[] {
  return db
    .select()
    .from(projectTransferRules)
    .where(
      and(
        eq(projectTransferRules.projectId, projectId),
        eq(projectTransferRules.ruleKind, RULE_KIND),
      ),
    )
    .orderBy(asc(projectTransferRules.id))
    .all()
    .map((rule) => ({
      key: rule.masterKey,
      sourceKeys: splitKeys(rule.sourceKeys),
      coefficient: rule.coefficient,
      subjectId: rule.subjectId,
      materialCategory: rule.materialCategory,
      name: rule.name,
      description: rule.description,
      descriptionLower: rule.descriptionLower,
      unit: rule.unit,
      remarks: rule.remarks,
    }));
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

/** 型枠転記の元にできる明細（最新の集計書兼工事マスター。型枠転記で作った行は除く） */
function sourceItems(db: AppDatabase, projectId: number): FormworkSourceItem[] {
  const runId = latestRunId(db, projectId);
  if (runId === null) return [];
  const ruleKeys = new Set(
    listFormworkRules(db, projectId).map((rule) => rule.key),
  );
  return db
    .select()
    .from(projectAggregateItems)
    .where(eq(projectAggregateItems.runId, runId))
    .orderBy(asc(projectAggregateItems.displayOrder))
    .all()
    .filter((item) => !ruleKeys.has(item.masterKey))
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

/**
 * 型枠転記の画面データ。
 * 選べる元明細、元明細の型枠分類別の数量、いま決めているルール、
 * そのルールでできる行（転記入力表へ入れる行）を返す。
 */
export function getFormworkTransfer(
  db: AppDatabase,
  projectId: number,
): FormworkTransferView {
  const details = sourceDetails(db, projectId);
  const rules = listFormworkRules(db, projectId);
  const selected = new Set(rules.flatMap((rule) => rule.sourceKeys));
  return {
    rules,
    sources: sourceItems(db, projectId),
    groups: collectFormworkQuantities(details).filter((group) =>
      selected.has(group.masterKey),
    ),
    rows: buildFormworkTransferRows(details, rules, formworkCategories(db)),
  };
}

export function saveFormworkRules(
  db: AppDatabase,
  request: SaveFormworkRulesRequest,
): FormworkTransferView {
  db.transaction((tx) => {
    const keep = new Set(request.rules.map((rule) => rule.key));
    tx.select()
      .from(projectTransferRules)
      .where(
        and(
          eq(projectTransferRules.projectId, request.projectId),
          eq(projectTransferRules.ruleKind, RULE_KIND),
        ),
      )
      .all()
      .filter((rule) => !keep.has(rule.masterKey))
      .forEach((rule) => {
        tx.delete(projectTransferRules)
          .where(eq(projectTransferRules.id, rule.id))
          .run();
      });
    request.rules.forEach((rule) => {
      const values = {
        projectId: request.projectId,
        masterKey: rule.key,
        ruleKind: RULE_KIND,
        sourceKeys: rule.sourceKeys.join(","),
        formwork: "",
        part1: "",
        part2: "",
        part3: "",
        coefficient: rule.coefficient,
        subjectId: rule.subjectId,
        materialCategory: rule.materialCategory,
        partNumber: null,
        partName: "",
        detailNumber: null,
        name: rule.name,
        description: rule.description,
        descriptionLower: rule.descriptionLower,
        unit: rule.unit,
        remarks: rule.remarks,
      };
      tx.insert(projectTransferRules)
        .values(values)
        .onConflictDoUpdate({
          target: [
            projectTransferRules.projectId,
            projectTransferRules.masterKey,
            projectTransferRules.ruleKind,
          ],
          set: values,
        })
        .run();
    });
  });
  return getFormworkTransfer(db, request.projectId);
}

/**
 * 転記入力表の空き部分（入力があれば最後の行の次）へ型枠の行を自動転記する。
 * 前回この機能で作った行は作り直すので、集計をかけ直しても数量が合う。
 * 人が手で入れた行（型枠転記の印が無い行）はそのまま残す。
 */
export function runFormworkTransfer(
  db: AppDatabase,
  projectId: number,
): FormworkTransferView {
  const view = getFormworkTransfer(db, projectId);
  db.transaction((tx) => {
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
    view.rows.forEach((row: FormworkTransferRow) => {
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
          memo: "",
          formworkKey: row.formworkKey,
          displayOrder: order,
        })
        .run();
      order += 1;
    });
  });
  return getFormworkTransfer(db, projectId);
}
