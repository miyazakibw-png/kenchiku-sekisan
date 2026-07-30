/**
 * 明細番号は「A999.99」形式（小数点以下2桁の数値）で扱う。
 * 入力途中の文字列を許容しつつ、保存時は数値へ正規化する。
 */

/** 整数部の最大桁数 */
export const DETAIL_NUMBER_INTEGER_DIGITS = 4
export const DETAIL_NUMBER_DECIMALS = 2

const INPUT_PATTERN = new RegExp(
  `^\\d{0,${DETAIL_NUMBER_INTEGER_DIGITS}}(\\.\\d{0,${DETAIL_NUMBER_DECIMALS}})?$`
)

/** 入力途中として受け付けられる文字列か（空文字は許容） */
export function isValidDetailNumberInput(input: string): boolean {
  return input === '' || INPUT_PATTERN.test(input)
}

/** 表示用に小数2桁へ整形する。未設定は空文字 */
export function formatDetailNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) return ''
  return value.toFixed(DETAIL_NUMBER_DECIMALS)
}

/** 入力文字列を保存用の数値へ変換する。不正・空文字は null */
export function parseDetailNumber(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '' || !INPUT_PATTERN.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (Number.isNaN(parsed)) return null
  return Number(parsed.toFixed(DETAIL_NUMBER_DECIMALS))
}
