import { useCallback, useState } from 'react'
import { cleanName, collectSheets, printScale } from './screenSheets'

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

/** 印刷前に、全幅がA3（横／縦）1枚に収まる縮小率を決めておく */
function applyScale(area: HTMLElement, landscape: boolean): void {
  const table = area.querySelector('table')
  const width = Math.max(area.scrollWidth, table?.scrollWidth ?? 0)
  area.style.setProperty('--print-scale', String(printScale(width, landscape)))
  document.body.classList.toggle('print-portrait', !landscape)
}

const PAPER_KEY = 'printPaperLandscape'

function savedLandscape(): boolean {
  try {
    return window.localStorage.getItem(PAPER_KEY) !== 'portrait'
  } catch {
    return true
  }
}

/** どの画面でも使える 印刷／PDF／エクセル のボタン */
export default function PrintBar({ projectName }: { projectName: string }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [landscape, setLandscape] = useState(savedLandscape)

  const run = useCallback(async (job: (area: HTMLElement, name: string) => Promise<void>) => {
    const area = mainArea()
    if (!area || busy) return
    setBusy(true)
    try {
      applyScale(area, landscape)
      await job(area, screenName(area, projectName))
    } finally {
      setBusy(false)
    }
  }, [busy, landscape, projectName])

  const switchPaper = useCallback(() => {
    setLandscape((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(PAPER_KEY, next ? 'landscape' : 'portrait')
      } catch {
        // 覚えられなくてもこの画面の間は切り替えられる
      }
      return next
    })
  }, [])

  return (
    <div className="print-bar">
      <button
        type="button"
        title="印刷・PDFの用紙の向き（A3）を切り替えます"
        disabled={busy}
        onClick={switchPaper}
      >
        {landscape ? '用紙：横' : '用紙：縦'}
      </button>
      <button
        type="button"
        title="今の画面をA3 1枚の幅に収めて印刷します"
        disabled={busy}
        onClick={() =>
          void run(async () => void (await window.sekisan.printPaper(landscape)))
        }
      >
        🖨 印刷
      </button>
      <button
        type="button"
        title="今の画面をA3のPDFで保存します"
        disabled={busy}
        onClick={() =>
          void run(
            async (_area, name) => void (await window.sekisan.printPdf(name, landscape))
          )
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
