/**
 * 集計ページ（部屋別集計・部位別集計）から内訳書へ転記する共通処理。
 * まとめ方を指定して、そのまとめの形で内訳書の行を作る。
 */

import type { BreakdownGrouping } from "@shared/types";
import { pick } from "../common/askDialog";

/**
 * まとめ方を指定して内訳書へ転記する。
 * 戻り値は画面に出すメッセージ（null は中止）。
 */
export async function transferToBreakdown(
  projectId: number,
  grouping: BreakdownGrouping,
  runId?: number,
): Promise<string | null> {
  // 確定していない回があるまま転記するときは、作り直しか新しい回か選ぶ
  const versions = await window.sekisan.listBreakdownVersions(projectId);
  const open = versions.find((version) => version.confirmed === 0);
  let newRound = false;
  if (open !== undefined) {
    const choice = await pick(`${open.round}回目はまだ確定していません。`, [
      `${open.round}回目を作り直す`,
      "次の回として新しく作る",
    ]);
    if (choice === -1) return null;
    newRound = choice === 1;
  }
  const next = await window.sekisan.transferBreakdown(
    projectId,
    newRound,
    grouping,
    runId,
  );
  return next.version === null
    ? "集計処理を先に実行してください。"
    : `${next.version.round}回目として転記しました（${next.rows.length}行）。内訳書で開けます`;
}
