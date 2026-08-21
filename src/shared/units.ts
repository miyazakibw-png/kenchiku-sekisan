import { resolveMasterName } from './masters'
import type { Unit } from './types'

/**
 * 単位欄の入力値を解決する。
 * 数字のみの入力は単位マスタのIDとして扱い、対応する単位名へ変換する。
 * 該当IDが無い場合や単位名の直接入力はそのまま返す。
 */
export function resolveUnitName(units: Unit[], input: string): string {
  return resolveMasterName(units, input)
}
