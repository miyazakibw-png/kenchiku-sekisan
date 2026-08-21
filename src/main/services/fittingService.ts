import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { appSettings, projectFittings } from "../db/schema";
import type { Fitting, SaveFittingsRequest } from "../../shared/types";
import {
  DEFAULT_FITTING_PART_VALUES,
  parseFittingPartValues,
  type FittingPartValue,
} from "../../core/fittings/partValue";

const PART_VALUE_KEY = "fittingPartValues";

/** 建具記号を計算式へ入れるときの、部位ごとの採用値 */
export function getFittingPartValues(db: AppDatabase): FittingPartValue[] {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, PART_VALUE_KEY))
    .get();
  return row
    ? parseFittingPartValues(row.valueJson)
    : DEFAULT_FITTING_PART_VALUES;
}

export function saveFittingPartValues(
  db: AppDatabase,
  values: FittingPartValue[],
): FittingPartValue[] {
  const json = JSON.stringify(values);
  db.insert(appSettings)
    .values({ key: PART_VALUE_KEY, valueJson: json })
    .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: json } })
    .run();
  return getFittingPartValues(db);
}

export function listFittings(db: AppDatabase, projectId: number): Fitting[] {
  return db
    .select()
    .from(projectFittings)
    .where(eq(projectFittings.projectId, projectId))
    .orderBy(
      asc(projectFittings.fromEstimate),
      asc(projectFittings.displayOrder),
      asc(projectFittings.id),
    )
    .all();
}

/**
 * 建具表の一括保存。画面の行順をそのまま display_order にする。
 * 積算入力から登録された行（fromEstimate=1）は建具表入力の後ろへまとめて並べる。
 */
export function saveFittings(
  db: AppDatabase,
  request: SaveFittingsRequest,
): Fitting[] {
  const { projectId, rows } = request;
  db.transaction((tx) => {
    const keptIds = rows
      .map((row) => row.id)
      .filter((id): id is number => id !== null);
    const existing = tx
      .select({ id: projectFittings.id })
      .from(projectFittings)
      .where(eq(projectFittings.projectId, projectId))
      .all()
      .map((row) => row.id);
    const removed = existing.filter((id) => !keptIds.includes(id));
    if (removed.length > 0) {
      tx.delete(projectFittings)
        .where(inArray(projectFittings.id, removed))
        .run();
    }

    rows.forEach((row, index) => {
      const values = {
        projectId,
        symbol: row.symbol,
        name: row.name,
        width: row.width,
        height: row.height,
        sillHeight: row.sillHeight,
        areaFormula: row.areaFormula,
        baseboardFormula: row.baseboardFormula,
        note: row.note,
        fromEstimate: row.fromEstimate,
        displayOrder: index,
      };
      if (row.id === null) {
        tx.insert(projectFittings).values(values).run();
        return;
      }
      tx.update(projectFittings)
        .set(values)
        .where(
          and(
            eq(projectFittings.id, row.id),
            eq(projectFittings.projectId, projectId),
          ),
        )
        .run();
    });
  });
  return listFittings(db, projectId);
}
