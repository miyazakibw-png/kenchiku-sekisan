import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./PickInput.css";

/** 候補一覧に出す1行（value＝欄に入る文字、label＝一覧に見せる文字） */
export interface PickEntry {
  value: string;
  label: string;
}

/**
 * 一覧から選ぶ入力欄。
 * entries を渡すと、マスターの並びのまま全件を出す候補一覧（下までスクロールできます）を表示します。
 * 入力済みのときも、欄を選ぶと一度空にして候補を全件出す（現在の値は薄字で見えます）。
 * commitOnBlur を付けると、打ち終わって欄を離れたときにだけ反映します。
 */
export function PickInput({
  value,
  listId,
  entries,
  className,
  placeholder,
  title,
  japanese = false,
  halfWidth = false,
  row,
  col,
  commitOnBlur = false,
  onCommit,
  onFocus,
}: {
  value: string;
  listId?: string;
  entries?: PickEntry[];
  className?: string;
  placeholder?: string;
  title?: string;
  /** 日本語で入れる欄（半角へ自動変換しない） */
  japanese?: boolean;
  /** 番号でも名前でも入れる欄（全角の英数字だけ半角へ直す） */
  halfWidth?: boolean;
  /** 表のマス目の位置（矢印キーで動ける表だけ使う） */
  row?: number;
  col?: number;
  commitOnBlur?: boolean;
  onCommit: (text: string) => void;
  onFocus?: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const openList = (): void => {
    if (!entries || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    // 画面の下に入りきらないときは欄の上に出す（一覧の中はスクロールできる）
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const up = below < 160 && above > below;
    const height = Math.min(320, up ? above : below);
    setBox({
      left: Math.min(rect.left, window.innerWidth - 240),
      top: up ? rect.top - height : rect.bottom,
      width: Math.max(rect.width, 220),
      height,
    });
  };

  const typed = editing ?? "";
  const shown = (entries ?? []).filter(
    (entry) =>
      typed.trim() === "" ||
      entry.value.startsWith(typed.trim()) ||
      entry.label.includes(typed.trim()),
  );

  const commit = (text: string): void => {
    setEditing(null);
    setBox(null);
    onCommit(text);
  };

  return (
    <>
      <input
        ref={ref}
        lang={japanese ? "ja" : undefined}
        data-half={halfWidth ? "1" : undefined}
        className={className}
        list={entries ? undefined : listId}
        data-row={row}
        data-col={col}
        value={editing ?? value}
        placeholder={editing !== null && value !== "" ? value : placeholder}
        title={title}
        onFocus={() => {
          setEditing("");
          openList();
          onFocus?.();
        }}
        onChange={(e) => {
          setEditing(e.target.value);
          openList();
          if (!commitOnBlur) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setBox(null);
            return;
          }
          // 空のときに Delete・BackSpace を押すと、入っている値を消します
          if (e.key !== "Delete" && e.key !== "Backspace") return;
          if ((editing ?? value) !== "") return;
          onCommit("");
        }}
        onBlur={() => {
          const text = editing;
          setEditing(null);
          setBox(null);
          if (!commitOnBlur || text === null) return;
          // 空のまま離れたときは、入っている値をそのまま残す
          if (text.trim() === "" && value !== "") return;
          if (text === value) return;
          onCommit(text);
        }}
      />
      {box &&
        shown.length > 0 &&
        // 表の固定した列・行の上に出すため、画面（body）の一番上へ置く
        createPortal(
          <ul
            className="pick-list"
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              maxHeight: box.height,
            }}
          >
            {shown.map((entry, index) => (
              <li key={`${entry.value}-${index}`}>
                <button
                  type="button"
                  // クリックで欄から離れる前に選べるよう mousedown で決める
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(entry.value);
                  }}
                >
                  <span className="key">{entry.value}</span>
                  <span className="label">{entry.label}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}

export default PickInput;
