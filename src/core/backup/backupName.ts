/** バックアップ（データ保存）ファイル名の組み立て */

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** 積算データ_20260821_0930.db のような既定名を返す */
export function backupFileName(now: Date): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}_${pad(
    now.getHours(),
    2
  )}${pad(now.getMinutes(), 2)}`
  return `積算データ_${stamp}.db`
}

/** 復元前に作る自動退避ファイル名 */
export function rollbackFileName(now: Date): string {
  return `復元前_${backupFileName(now)}`
}
