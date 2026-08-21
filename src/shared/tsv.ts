/**
 * Excelのクリップボード形式（TSV）の相互変換。
 * セル内改行・タブはダブルクォートで囲まれるExcelの仕様に対応する。
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
      i += 1
      continue
    }
    if (ch === '\t') {
      row.push(cell)
      cell = ''
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }
    cell += ch
    i += 1
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export function toTsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          /[\t\r\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
        )
        .join('\t')
    )
    .join('\r\n')
}

/** 全角英数記号を半角へ変換する */
export function toHalfWidth(value: string): string {
  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

/**
 * Excelから貼り付けられた値を正規化する。
 * 先頭のアポストロフィ（文字列化）、桁区切りカンマ、前後空白を除去する。
 */
export function normalizePastedCell(value: string): string {
  let result = toHalfWidth(value).trim()
  if (result.startsWith("'")) result = result.slice(1)
  if (/^-?[\d,]+(\.\d+)?$/.test(result)) result = result.replace(/,/g, '')
  return result
}

export function normalizePastedMatrix(rows: string[][]): string[][] {
  return rows.map((row) => row.map(normalizePastedCell))
}
