import { useEffect, type RefObject } from 'react'
import { stickyTops } from './stickyHeader'

const TOOLBARS = '.toolbar,.grid-toolbar'

function isScrollable(el: HTMLElement): boolean {
  const overflow = getComputedStyle(el).overflowY
  return overflow === 'auto' || overflow === 'scroll'
}

function scrollParent(el: HTMLElement, root: HTMLElement): HTMLElement {
  let parent = el.parentElement
  while (parent && parent !== root) {
    if (isScrollable(parent)) return parent
    parent = parent.parentElement
  }
  return root
}

/** 表より上にあり、同じ枠の中で一緒に流れるツールバーの高さ */
function toolbarHeight(container: HTMLElement, table: HTMLElement): number {
  let height = 0
  container.querySelectorAll<HTMLElement>(TOOLBARS).forEach((toolbar) => {
    const after = toolbar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING
    if (after !== 0) height += toolbar.offsetHeight
  })
  return height
}

function setTop(cell: HTMLElement, top: number): void {
  const value = `${top}px`
  if (cell.style.top !== value) cell.style.top = value
}

/** 操作ボタンの行と表の見出し行を、画面を下げても見えるように固定する */
export function useStickyHeaders(ref: RefObject<HTMLElement>, deps: unknown[] = []): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return

    let queued = 0
    const apply = (): void => {
      queued = 0
      root.querySelectorAll('table').forEach((table) => {
        const container = scrollParent(table, root)
        const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('thead tr'))
        const tops = stickyTops(
          toolbarHeight(container, table),
          rows.map((row) => row.offsetHeight)
        )
        rows.forEach((row, index) => {
          row.querySelectorAll<HTMLElement>('th,td').forEach((cell) => setTop(cell, tops[index]))
        })
      })
    }
    const schedule = (): void => {
      if (queued === 0) queued = requestAnimationFrame(apply)
    }

    schedule()
    const mutations = new MutationObserver(schedule)
    mutations.observe(root, { childList: true, subtree: true })
    const resizes = new ResizeObserver(schedule)
    resizes.observe(root)
    return () => {
      if (queued !== 0) cancelAnimationFrame(queued)
      mutations.disconnect()
      resizes.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
}
