import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { projectTransferRows } from "../db/schema";
import type { SaveTransferRowsRequest, TransferRow } from "../../shared/types";

export function listTransferRows(
  db: AppDatabase,
  projectId: number,
): TransferRow[] {
  return db
    .select()
    .from(projectTransferRows)
    .where(eq(projectTransferRows.projectId, projectId))
    .orderBy(asc(projectTransferRows.displayOrder), asc(projectTransferRows.id))
    .all();
}

/** 転記入力表の一括保存。画面の行順をそのまま display_order にする */
export function saveTransferRows(
  db: AppDatabase,
  request: SaveTransferRowsRequest,
): TransferRow[] {
  const { projectId, rows } = request;
  db.transaction((tx) => {
    const keptIds = rows
      .map((row) => row.id)
      .filter((id): id is number => id !== null);
    const removed = tx
      .select({ id: projectTransferRows.id })
      .from(projectTransferRows)
      .where(eq(projectTransferRows.projectId, projectId))
      .all()
      .map((row) => row.id)
      .filter((id) => !keptIds.includes(id));
    if (removed.length > 0) {
      tx.delete(projectTransferRows)
        .where(inArray(projectTransferRows.id, removed))
        .run();
    }

    rows.forEach((row, index) => {
      const { id, ...rest } = row;
      const values = { ...rest, projectId, displayOrder: index };
      if (id === null) {
        tx.insert(projectTransferRows).values(values).run();
        return;
      }
      tx.update(projectTransferRows)
        .set(values)
        .where(
          and(
            eq(projectTransferRows.id, id),
            eq(projectTransferRows.projectId, projectId),
          ),
        )
        .run();
    });
  });
  return listTransferRows(db, projectId);
}
