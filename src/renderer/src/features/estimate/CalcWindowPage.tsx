import { useCallback, useEffect, useRef, useState } from "react";
import type { MasterOptions } from "@shared/types";
import type { CalcFocus, CalcWindowState } from "@shared/calcWindow";
import type { CalcSet } from "../../../../core/room/calcSheet";
import RoomCalcSheet from "./RoomCalcSheet";

interface Props {
  /** 入力を返す元の画面（webContents ID） */
  parentId: number;
}

/**
 * 明細入力（セット明細計算表）だけの独立したウィンドウ。
 * 表示する内容は元の画面から受け取り、入力した内容はそのつど元の画面へ返す。
 */
export default function CalcWindowPage({ parentId }: Props): JSX.Element {
  const [state, setState] = useState<CalcWindowState | null>(null);
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [focus, setFocus] = useState<CalcFocus | null>(null);
  const [message, setMessage] = useState("");
  /** 自分が送った入力の版（元の画面から戻ってきた分で上書きしないため） */
  const rev = useRef(0);
  const sent = useRef(0);

  useEffect(() => {
    void window.sekisan.getMasterOptions().then(setOptions);
    const off = window.sekisan.onCalcWindowState((next) => {
      setState((prev) => {
        // 自分の入力が戻ってきただけのときは、入力中の明細を上書きしない
        if (prev && sent.current > 0 && next.echo !== sent.current)
          return { ...next, sets: prev.sets };
        return next;
      });
    });
    void window.sekisan.readyCalcWindow(parentId);
    return off;
  }, [parentId]);

  useEffect(() => {
    if (state) document.title = state.title;
  }, [state]);

  const onChange = useCallback(
    (sets: CalcSet[]) => {
      setState((prev) => (prev ? { ...prev, sets } : prev));
      rev.current += 1;
      sent.current = rev.current;
      void window.sekisan.applyCalcWindow(parentId, {
        sets,
        focus,
        rev: rev.current,
      });
    },
    [focus, parentId],
  );

  const onFocus = useCallback(
    (next: CalcFocus | null) => {
      setFocus(next);
      setState((prev) => {
        if (prev)
          void window.sekisan.applyCalcWindow(parentId, {
            sets: prev.sets,
            focus: next,
            rev: rev.current,
          });
        return prev;
      });
    },
    [parentId],
  );

  if (!state) return <div className="placeholder">読み込み中…</div>;

  return (
    <div className="calc-window-page">
      {message && <p className="message">{message}</p>}
      <RoomCalcSheet
        sets={state.sets}
        onChange={onChange}
        variables={state.variables}
        options={options}
        projectId={state.projectId}
        focus={focus}
        onFocus={onFocus}
        result={state.result}
        onMessage={setMessage}
        hasUpper={state.hasUpper}
        inWindow
      />
    </div>
  );
}
