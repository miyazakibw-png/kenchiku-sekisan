import { useCallback, useEffect, useRef, useState } from 'react'

export const MIN_COLUMN_WIDTH = 32
export const MAX_COLUMN_WIDTH = 800

/** 列幅の最小・最大に収める */
function clampWidth(px: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(px)))
}

function load(storageKey: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const result: Record<string, number> = {}
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = clampWidth(value)
    })
    return result
  } catch {
    return {}
  }
}

/** 文字列の描画幅を測る（内容に合わせた自動調整用） */
export function measureTextWidth(text: string, font: string): number {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return 0
  context.font = font
  return context.measureText(text).width
}

export interface ColumnWidths {
  /** 列キー → 幅(px) */
  widths: Record<string, number>
  /** ドラッグでの伸縮を開始する（列境界の mousedown で呼ぶ） */
  startResize: (key: string, event: { clientX: number; preventDefault: () => void }) => void
  /** 内容に合わせて自動調整する（見出しとセルの文字列を渡す） */
  fitWidth: (key: string, texts: string[]) => void
  /** 既定幅に戻す */
  resetWidth: (key: string) => void
  /** すべての列を既定幅に戻す */
  resetAll: () => void
}

/**
 * 表の列幅をユーザーが伸縮し、次回起動時も復元するための共通フック。
 * 画面ごとに storageKey を分けるだけで、どのグリッドでも再利用できる。
 */
export function useColumnWidths(
  storageKey: string,
  defaults: Record<string, number>,
  font = '13px sans-serif'
): ColumnWidths {
  const [stored, setStored] = useState<Record<string, number>>(() => load(storageKey))
  const dragRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const widths: Record<string, number> = { ...defaults, ...stored }
  const widthsRef = useRef(widths)
  widthsRef.current = widths

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(stored))
  }, [storageKey, stored])

  const setWidth = useCallback((key: string, px: number) => {
    setStored((prev) => ({ ...prev, [key]: clampWidth(px) }))
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      setWidth(drag.key, drag.startWidth + (e.clientX - drag.startX))
    }
    const onUp = (): void => {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.classList.remove('col-resizing')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setWidth])

  const startResize = useCallback<ColumnWidths['startResize']>((key, event) => {
    event.preventDefault()
    dragRef.current = {
      key,
      startX: event.clientX,
      startWidth: widthsRef.current[key] ?? MIN_COLUMN_WIDTH
    }
    document.body.classList.add('col-resizing')
  }, [])

  const fitWidth = useCallback(
    (key: string, texts: string[]) => {
      const widest = texts.reduce((max, text) => Math.max(max, measureTextWidth(text, font)), 0)
      setWidth(key, widest + 18)
    },
    [font, setWidth]
  )

  const resetWidth = useCallback((key: string) => {
    setStored((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const resetAll = useCallback(() => setStored({}), [])

  return { widths, startResize, fitWidth, resetWidth, resetAll }
}
