import { useCallback, useRef, useState } from 'react'

export const UNDO_HISTORY_LIMIT = 100

interface UndoRedo<T> {
  /** 変更前の状態を履歴へ積む */
  push: (snapshot: T) => void
  undo: (current: T) => T | null
  redo: (current: T) => T | null
  canUndo: boolean
  canRedo: boolean
  clear: () => void
  /**
   * 履歴中のすべてのスナップショットを変換する。
   * 保存でIDが振られた等、履歴が現在のデータと食い違うのを防ぐために使う。
   */
  map: (transform: (snapshot: T) => T) => void
}

/**
 * 直前の状態を履歴に保持し、1つ戻る/1つ進むを提供する。
 * 履歴は既定で100件まで保持する。
 */
export function useUndoRedo<T>(limit: number = UNDO_HISTORY_LIMIT): UndoRedo<T> {
  const undoStack = useRef<T[]>([])
  const redoStack = useRef<T[]>([])
  const [, forceUpdate] = useState(0)
  const refresh = useCallback(() => forceUpdate((n) => n + 1), [])

  const push = useCallback(
    (snapshot: T) => {
      undoStack.current.push(snapshot)
      if (undoStack.current.length > limit) undoStack.current.shift()
      redoStack.current = []
      refresh()
    },
    [limit, refresh]
  )

  const undo = useCallback(
    (current: T): T | null => {
      const previous = undoStack.current.pop()
      if (previous === undefined) return null
      redoStack.current.push(current)
      if (redoStack.current.length > limit) redoStack.current.shift()
      refresh()
      return previous
    },
    [limit, refresh]
  )

  const redo = useCallback(
    (current: T): T | null => {
      const next = redoStack.current.pop()
      if (next === undefined) return null
      undoStack.current.push(current)
      if (undoStack.current.length > limit) undoStack.current.shift()
      refresh()
      return next
    },
    [limit, refresh]
  )

  const clear = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    refresh()
  }, [refresh])

  const map = useCallback((transform: (snapshot: T) => T) => {
    undoStack.current = undoStack.current.map(transform)
    redoStack.current = redoStack.current.map(transform)
  }, [])

  return {
    push,
    undo,
    redo,
    map,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    clear
  }
}
