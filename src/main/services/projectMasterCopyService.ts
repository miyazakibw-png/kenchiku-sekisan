import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import {
  mAggregationParts,
  mFormworkCategories,
  mMaterialCategories,
  mPickupParts,
  mSubjects,
  mUnits,
  projectMasters,
  projects,
} from "../db/schema";

export const PROJECT_MASTER_KINDS = [
  "subjects",
  "pickupParts",
  "materialCategories",
  "units",
  "aggregationParts",
  "formworkCategories",
] as const;

export type ProjectMasterKind = (typeof PROJECT_MASTER_KINDS)[number];

interface ProjectMasterCopyRow {
  number: number;
  sourceNumber: number | null;
  name: string;
  note: string;
  skipPart2: number;
  aggregateOrder: number;
  detailFirst: number;
  displayOrder: number;
}

function replaceProjectMasterRows(
  db: AppDatabase,
  projectId: number,
  kind: ProjectMasterKind,
  rows: ProjectMasterCopyRow[],
): void {
  db.transaction((tx) => {
    tx.delete(projectMasters)
      .where(
        and(
          eq(projectMasters.projectId, projectId),
          eq(projectMasters.kind, kind),
        ),
      )
      .run();
    rows.forEach((row, index) => {
      tx.insert(projectMasters)
        .values({
          projectId,
          kind,
          number: row.number,
          sourceNumber: row.sourceNumber,
          name: row.name,
          note: row.note,
          skipPart2: row.skipPart2,
          aggregateOrder: row.aggregateOrder,
          detailFirst: row.detailFirst,
          displayOrder: index,
        })
        .run();
    });
  });
}

function basicRows(
  db: AppDatabase,
  kind: ProjectMasterKind,
): ProjectMasterCopyRow[] {
  if (kind === "subjects") {
    return db
      .select({
        id: mSubjects.id,
        name: mSubjects.name,
        note: mSubjects.note,
        skipPart2: mSubjects.skipPart2,
        aggregateOrder: mSubjects.aggregateOrder,
        detailFirst: mSubjects.detailFirst,
      })
      .from(mSubjects)
      .orderBy(asc(mSubjects.displayOrder), asc(mSubjects.id))
      .all()
      .map((row) => ({
        number: row.id,
        sourceNumber: row.id,
        name: row.name,
        note: row.note,
        skipPart2: row.skipPart2,
        aggregateOrder: row.aggregateOrder,
        detailFirst: row.detailFirst,
        displayOrder: 0,
      }));
  }

  const rows =
    kind === "pickupParts"
      ? db
          .select({
            id: mPickupParts.id,
            name: mPickupParts.name,
            note: mPickupParts.note,
          })
          .from(mPickupParts)
          .orderBy(asc(mPickupParts.displayOrder), asc(mPickupParts.id))
          .all()
      : kind === "materialCategories"
        ? db
            .select({
              id: mMaterialCategories.id,
              name: mMaterialCategories.name,
            })
            .from(mMaterialCategories)
            .orderBy(
              asc(mMaterialCategories.displayOrder),
              asc(mMaterialCategories.id),
            )
            .all()
            .map((row) => ({ ...row, note: "" }))
        : kind === "units"
          ? db
              .select({ id: mUnits.id, name: mUnits.name })
              .from(mUnits)
              .orderBy(asc(mUnits.displayOrder), asc(mUnits.id))
              .all()
              .map((row) => ({ ...row, note: "" }))
          : kind === "aggregationParts"
            ? db
                .select({
                  id: mAggregationParts.id,
                  name: mAggregationParts.name,
                })
                .from(mAggregationParts)
                .orderBy(
                  asc(mAggregationParts.displayOrder),
                  asc(mAggregationParts.id),
                )
                .all()
                .map((row) => ({ ...row, note: "" }))
            : db
                .select({
                  id: mFormworkCategories.id,
                  name: mFormworkCategories.name,
                })
                .from(mFormworkCategories)
                .orderBy(
                  asc(mFormworkCategories.displayOrder),
                  asc(mFormworkCategories.id),
                )
                .all()
                .map((row) => ({ ...row, note: "" }));

  return rows.map((row) => ({
    number: row.id,
    sourceNumber: row.id,
    name: row.name,
    note: row.note,
    skipPart2: 0,
    aggregateOrder: 1,
    detailFirst: 0,
    displayOrder: 0,
  }));
}

export function copyBasicMastersToProject(
  db: AppDatabase,
  projectId: number,
  overwrite = false,
): ProjectMasterKind[] {
  const owned = new Set(
    db
      .select({ kind: projectMasters.kind })
      .from(projectMasters)
      .where(eq(projectMasters.projectId, projectId))
      .all()
      .map((row) => row.kind),
  );
  const copied: ProjectMasterKind[] = [];

  PROJECT_MASTER_KINDS.forEach((kind) => {
    if (owned.has(kind) && !overwrite) return;
    const rows = basicRows(db, kind);
    if (rows.length === 0) return;
    replaceProjectMasterRows(db, projectId, kind, rows);
    copied.push(kind);
  });
  return copied;
}

export function ensureProjectsOwnMasters(db: AppDatabase): void {
  db.select({ id: projects.id })
    .from(projects)
    .all()
    .forEach(({ id }) => copyBasicMastersToProject(db, id, false));
}
