import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { appSettings } from "../db/schema";

/**
 * チェック表で「どの部位番号がどの列に入るか」の設定。
 * 管理用部位の番号 → 番号の並び文字（例 "10-19" "10,12-15"）。
 * 設定が無い列は従来どおり「番号÷10の整数部」の区切りで入る。
 * 全物件共通で app_settings に保存する（キー checkSheetPartMap）。
 */
const PART_MAP_KEY = "checkSheetPartMap";

export function getCheckSheetPartMap(db: AppDatabase): Record<string, string> {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, PART_MAP_KEY))
    .get();
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.valueJson);
    if (parsed !== null && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveCheckSheetPartMap(
  db: AppDatabase,
  map: Record<string, string>,
): void {
  const json = JSON.stringify(map);
  db.insert(appSettings)
    .values({ key: PART_MAP_KEY, valueJson: json })
    .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: json } })
    .run();
}
