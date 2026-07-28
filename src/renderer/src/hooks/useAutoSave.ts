import { useCallback, useEffect, useRef, useState } from 'react'

export type AutoSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface Options<T> {
  data: T
  /** 変更がある場合に呼ばれる保存処理 */
  onSave: (data: T) => Promise<void>
  /** 自動保存の間隔（ミリ秒） */
  intervalMs?: number
  enabled?: boolean
}

/**
 * 一定間隔とアンマウント時に自動保存する。
 * 保存ボタンの押し忘れによるデータロストを防ぐ。
 */
export function useAutoSave<T>({
  data,
  onSave,
  intervalMs = 15000,
  enabled = true
}: Options<T>): { status: AutoSaveStatus; markDirty: () => void; saveNow: () => Promise<void> } {
  const [status, setStatus] = useState<AutoSaveStatus>('idle')
  const dataRef = useRef(data)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const onSaveRef = useRef(onSave)

  dataRef.current = data
  onSaveRef.current = onSave

  const saveNow = useCallback(async () => {
    if (!dirtyRef.current || savingRef.current) return
    savingRef.current = true
    dirtyRef.current = false
    setStatus('saving')
    try {
      await onSaveRef.current(dataRef.current)
      setStatus('saved')
    } catch {
      dirtyRef.current = true
      setStatus('error')
    } finally {
      savingRef.current = false
    }
  }, [])

  const markDirty = useCallback(() => {
    dirtyRef.current = true
    setStatus('dirty')
  }, [])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      void saveNow()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, intervalMs, saveNow])

  // アンマウント時（画面を閉じる時）の保存
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void onSaveRef.current(dataRef.current)
    }
  }, [])

  // ウィンドウを閉じる直前の保存
  useEffect(() => {
    const handler = (): void => {
      if (dirtyRef.current) void onSaveRef.current(dataRef.current)
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  return { status, markDirty, saveNow }
}
