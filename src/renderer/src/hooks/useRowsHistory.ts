import { Dispatch, SetStateAction, useCallback, useRef, useState } from "react";

interface RowsHistory<T> {
  /** 行を直す（1つ前の内容を履歴へ積む） */
  edit: (next: SetStateAction<T[]>) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 読み込み・保存のあとに履歴を捨てる */
  clear: () => void;
}

/**
 * 表の行に「↶戻る・↷進む」を付けるための履歴。
 * 直前の行の内容を最大100件まで覚えておく。
 */
export function useRowsHistory<T>(
  rows: T[],
  setRows: Dispatch<SetStateAction<T[]>>,
): RowsHistory<T> {
  const past = useRef<T[][]>([]);
  const future = useRef<T[][]>([]);
  const [tick, setTick] = useState(0);

  const edit = useCallback(
    (next: SetStateAction<T[]>): void => {
      past.current = [...past.current.slice(-99), rows];
      future.current = [];
      setTick((value) => value + 1);
      setRows(next);
    },
    [rows, setRows],
  );

  const undo = useCallback((): boolean => {
    const previous = past.current[past.current.length - 1];
    if (previous === undefined) return false;
    past.current = past.current.slice(0, -1);
    future.current = [rows, ...future.current];
    setTick((value) => value + 1);
    setRows(previous);
    return true;
  }, [rows, setRows]);

  const redo = useCallback((): boolean => {
    const next = future.current[0];
    if (next === undefined) return false;
    future.current = future.current.slice(1);
    past.current = [...past.current, rows];
    setTick((value) => value + 1);
    setRows(next);
    return true;
  }, [rows, setRows]);

  const clear = useCallback((): void => {
    past.current = [];
    future.current = [];
    setTick((value) => value + 1);
  }, []);

  return {
    edit,
    undo,
    redo,
    canUndo: tick >= 0 && past.current.length > 0,
    canRedo: tick >= 0 && future.current.length > 0,
    clear,
  };
}
