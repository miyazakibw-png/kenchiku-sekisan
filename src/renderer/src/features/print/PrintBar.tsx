import { useCallback, useState } from 'react'
import { cleanName, collectSheets, printScale } from './screenSheets'
import type { PaperKind } from './screenSheets'

/** 画面の名前（見出し）。無ければ工事名 */
function screenName(root: HTMLElement, projectName: string): string {
  const heading = root.querySelector('h2')
  const text = cleanName(heading?.textContent ?? '')
  return text !== '' ? text : projectName !== '' ? cleanName(projectName) : '画面'
}

function mainArea(): HTMLElement | null {
  const area = document.querySelector('.app-main')
  return area instanceof HTMLElement ? area : null
}

const PAPERS: { kind: PaperKind; label: string; pageSize: 'A4' | 'A3'; landscape: boolean }[] = [
  { kind: 'a4-portrait', label: 'A4縦', pageSize: 'A4', landscape: false },
  { kind: 'a4-landscape', label: 'A4横', pageSize: 'A4', landscape: true },
  { kind: 'a3-landscape', label: 'A3横', pageSize: 'A3', landscape: true }
]

function paperOf(kind: PaperKind): (typeof PAPERS)[number] {
  return PAPERS.find((paper) => paper.kind === kind) ?? PAPERS[1]
}

/** 印刷前に、全幅が用紙1枚に収まる縮小率と用紙の向きを決めておく */
function applyScale(area: HTMLElement, kind: PaperKind): void {
  const table = area.querySelector('table')
  const width = Math.max(area.scrollWidth, table?.scrollWidth ?? 0)
  area.style.setProperty('--print-scale', String(printScale(width, kind)))
  for (const paper of PAPERS) {
    document.body.classList.toggle(`print-${paper.kind}`, paper.kind === kind)
  }
}

const PAPER_KEY = 'printPaper'

function savedPaper(): PaperKind {
  try {
    const saved = window.localStorage.getItem(PAPER_KEY)
    const found = PAPERS.find((paper) => paper.kind === saved)
    return found ? found.kind : 'a4-portrait'
  } catch {
    return 'a4-portrait'
  }
}

/** どの画面でも使える 印刷／PDF／エクセル のボタン */
export default function PrintBar({ projectName }: { projectName: string }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [paper, setPaper] = useState(savedPaper)

  const run = useCallback(async (job: (area: HTMLElement, name: string) => Promise<void>) => {
    const area = mainArea()
    if (!area || busy) return
    setBusy(true)
    try {
      applyScale(area, paper)
      await job(area, screenName(area, projectName))
    } finally {
      setBusy(false)
    }
  }, [busy, paper, projectName])

  const changePaper = useCallback((kind: PaperKind) => {
    setPaper(kind)
    try {
      window.localStorage.setItem(PAPER_KEY, kind)
    } catch {
      // 覚えられなくてもこの画面の間は切り替えられる
    }
  }, [])

  return (
    <div className="print-bar">
      <label className="print-paper" title="印刷・PDFの用紙を選びます">
        用紙
        <select
          value={paper}
          disabled={busy}
          onChange={(event) => changePaper(event.target.value as PaperKind)}
        >
          {PAPERS.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        title="今の画面を用紙1枚の幅に収めて印刷します"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const { pageSize, landscape } = paperOf(paper)
            await window.sekisan.printPaper({ pageSize, landscape })
          })
        }
      >
        🖨 印刷
      </button>
      <button
        type="button"
        title="今の画面をPDFで保存します"
        disabled={busy}
        onClick={() =>
          void run(async (_area, name) => {
            const { pageSize, landscape } = paperOf(paper)
            await window.sekisan.printPdf(name, { pageSize, landscape })
          })
        }
      >
        📄 PDF
      </button>
      <button
        type="button"
        title="今の画面の表を、入力表ごとのシートでエクセル保存します（式なし・数字のみ）"
        disabled={busy}
        onClick={() =>
          void run(async (area, name) => {
            const sheets = collectSheets(area, name)
            if (sheets.length === 0) return
            await window.sekisan.exportScreenExcel({ defaultName: name, sheets })
          })
        }
      >
        📊 Excel
      </button>
    </div>
  )
}
