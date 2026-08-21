import { and, asc, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  projectAggregateDetails,
  projectAggregateRuns,
  projectTransferRows,
  projectTransferRules,
} from "../db/schema";
import {
  buildFormworkTransferRows,
  collectFormworkQuantities,
  type FormworkTransferRule,
  type FormworkTransferRow,
} from "../../core/aggregate/formworkTransfer";
import type {
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

function listRules(db: AppDatabase, projectId: number): FormworkTransferRule[] {
  return db
    .select()
    .from(projectTransferRules)
    .where(
      and(
        eq(projectTransferRules.projectId, projectId),
        eq(projectTransferRules.ruleKind, RULE_KIND),
      ),
    )
    .orderBy(asc(projectTransferRules.masterKey))
    .all()
    .map((rule) => ({
      formwork: rule.masterKey,
      coefficient: rule.coefficient,
      subjectId: rule.subjectId,
      materialCategory: rule.materialCategory,
      partNumber: rule.partNumber,
      partName: rule.partName,
      detailNumber: rule.detailNumber,
      name: rule.name,
      description: rule.description,
      unit: rule.unit,
      remarks: rule.remarks,
    }));
}

function sourceDetails(
  db: AppDatabase,
  projectId: number,
): {
  formwork: string;
  part1: string;
  part2: string;
  part2Split: boolean;
  quantity: number;
}[] {
  const runId = latestRunId(db, projectId);
  if (runId === null) return [];
  return db
    .select()
    .from(projectAggregateDetails)
    .where(eq(projectAggregateDetails.runId, runId))
    .all()
    .map((detail) => ({
      formwork: detail.formwork,
      part1: detail.part1,
      part2: detail.part2,
      part2Split: detail.part2Split === 1,
      quantity: detail.quantity,
    }));
}

/**
 * 型枠転記の画面データ。
 * 集計した明細のうち型枠分類が付いているものを分類別に集計し、
 * 分類ごとの転記先（未設定なら空欄）と、転記したときにできる行を返す。
 */
export function getFormworkTransfer(
  db: AppDatabase,
  projectId: number,
): FormworkTransferView {
  const details = sourceDetails(db, projectId);
  const rules = listRules(db, projectId);
  const groups = collectFormworkQuantities(details);
  const found = [...new Set(groups.map((group) => group.formwork))];
  const merged = found.map(
    (formwork) =>
      rules.find((rule) => rule.formwork === formwork) ?? {
        formwork,
        coefficient: 1,
        subjectId: null,
        materialCategory: "",
        partNumber: null,
        partName: "",
        detailNumber: null,
        name: "",
        description: "",
        unit: "",
        remarks: "",
      },
  );
  return {
    rules: merged,
    groups,
    rows: buildFormworkTransferRows(details, merged),
  };
}

export function saveFormworkRules(
  db: AppDatabase,
  request: SaveFormworkRulesRequest,
): FormworkTransferView {
  db.transaction((tx) => {
    request.rules.forEach((rule) => {
      const values = {
        projectId: request.projectId,
        masterKey: rule.formwork,
        ruleKind: RULE_KIND,
        coefficient: rule.coefficient,
        subjectId: rule.subjectId,
        materialCategory: rule.materialCategory,
        partNumber: rule.partNumber,
        partName: rule.partName,
        detailNumber: rule.detailNumber,
        name: rule.name,
        description: rule.description,
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
 * 転記入力表の最終行へ型枠の行を追記する。
 * 前回この機能で作った行は作り直すので、集計をかけ直しても数量が合う。
 * 人が手で直した行（型枠分類の印が無い行）はそのまま残す。
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
          part3: "",
          subjectId: row.subjectId,
          materialCategory: row.materialCategory,
          partId: row.partNumber,
          partName: row.partName,
          detailNumber: row.detailNumber,
          name: row.name,
          sourceDetailId: null,
          descriptionUpper: row.description,
          descriptionLower: "",
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
