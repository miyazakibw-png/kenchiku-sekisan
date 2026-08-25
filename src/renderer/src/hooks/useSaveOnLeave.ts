import { useCallback, useEffect, useRef } from "react";

/**
 * 画面を閉じる（別の画面へ移る・ウィンドウを閉じる）ときに、
 * 読み込んだ内容から変わっていれば自動で保存する。
 * 読み込み直後と保存直後に markSaved を呼んで基準を更新する。
 */
export function useSaveOnLeave<T>(
  data: T,
  save: () => Promise<void> | void,
): { markSaved: (value: T) => void; isDirty: () => boolean } {
  const dataRef = useRef(data);
  const savedRef = useRef<string | null>(null);
  const saveRef = useRef(save);

  dataRef.current = data;
  saveRef.current = save;

  const markSaved = useCallback((value: T) => {
    savedRef.current = JSON.stringify(value);
  }, []);

  const isDirty = useCallback(
    () =>
      savedRef.current !== null &&
      JSON.stringify(dataRef.current) !== savedRef.current,
    [],
  );

  const leave = useCallback(() => {
    if (!isDirty()) return;
    savedRef.current = JSON.stringify(dataRef.current);
    void saveRef.current();
  }, [isDirty]);

  useEffect(() => {
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      leave();
    };
  }, [leave]);

  return { markSaved, isDirty };
}
