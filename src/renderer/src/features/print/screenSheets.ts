/**
 * 今表示している画面から、印刷・エクセル掃き出し用の表を取り出す。
 * 入力欄は表示している値をそのまま文字として拾う（式は持ち出さない）。
 */

import type { ScreenSheetData } from '@shared/types'

/** 印刷・PDFの用紙（A4縦・A4横・A3横） */
export type PaperKind = 'a4-portrait' | 'a4-landscape' | 'a3-landscape'

/** 用紙（余白8mm）に入る幅の目安（96dpi） */
export const PAPER_WIDTH: Record<PaperKind, number> = {
  'a4-portrait': 733,
  'a4-landscape': 1062,
  'a3-landscape': 1527
}

/** 並べ替えつまみなど、画面操作用の記号だけのセルは空にする */
const UI_GLYPH_ONLY = /^[⠿↕✕🗑📋⧉🖨📄📊＋−+\-\s]+$/u

function cellText(cell: HTMLTableCellElement): string {
  const field = cell.querySelector('input, select, textarea')
  if (field instanceof HTMLInputElement) {
    return field.type === 'checkbox' ? (field.checked ? '✔' : '') : field.value
  }
  if (field instanceof HTMLSelectElement) {
    return field.options[field.selectedIndex]?.text ?? field.value
  }
  if (field instanceof HTMLTextAreaElement) return field.value
  const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
  return UI_GLYPH_ONLY.test(text) ? '' : text
}

function tableRows(table: HTMLTableElement): string[][] {
  return Array.from(table.rows).map((row) =>
    Array.from(row.cells).flatMap((cell) => {
      const text = cellText(cell)
      const span = Math.max(cell.colSpan, 1)
      return [text, ...Array.from({ length: span - 1 }, () => '')]
    })
  )
}

/** ファイル名・シート名に使えない文字と飾りの記号を外す */
export function cleanName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '･')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 表の名前。data-sheet があればそれ、無ければ画面名＋連番 */
function nameOf(table: HTMLTableElement, screenName: string, index: number): string {
  const given = table.dataset.sheet
  if (given !== undefined && given !== '') return given
  return index === 0 ? screenName : `${screenName}${index + 1}`
}

/** 画面の中の表を入力表ごとのシートにする */
export function collectSheets(root: HTMLElement, screenName: string): ScreenSheetData[] {
  const tables = Array.from(root.querySelectorAll('table'))
  return tables
    .map((table, index) => ({
      name: nameOf(table, screenName, index),
      rows: tableRows(table)
    }))
    .filter((sheet) => sheet.rows.length > 0)
}

/** 画面の全幅が用紙1枚に収まるよう縮小率を決める */
export function printScale(contentWidth: number, paper: PaperKind = 'a3-landscape'): number {
  if (contentWidth <= 0) return 1
  return Math.min(1, Math.round((PAPER_WIDTH[paper] / contentWidth) * 1000) / 1000)
}
