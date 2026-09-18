import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { appSettings } from "../db/schema";
import type { LineStyleSettings } from "../../shared/types";

/**
 * 画面の罫線（細い線＝表のマス目、太い線＝まとまりの区切り）の設定。
 * 全物件共通で app_settings に保存する（キー lineStyles）。
 */
const LINE_STYLES_KEY = "lineStyles";

export function getLineStyles(db: AppDatabase): LineStyleSettings | null {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, LINE_STYLES_KEY))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.valueJson) as LineStyleSettings;
  } catch {
    return null;
  }
}

export function saveLineStyles(
  db: AppDatabase,
  settings: LineStyleSettings,
): void {
  const json = JSON.stringify(settings);
  db.insert(appSettings)
    .values({ key: LINE_STYLES_KEY, valueJson: json })
    .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: json } })
    .run();
}
