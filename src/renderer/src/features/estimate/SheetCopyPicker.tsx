import type { SheetOption } from "@shared/types";
import "./SheetCopyPicker.css";

interface Props {
  /** 窓の見出し（例：他の計算書から上段を写す） */
  title: string;
  /** 写し元に選べる計算書（今開いている計算書は除いてある） */
  sheets: SheetOption[];
  /** 写し元を選んだらすぐ呼ぶ */
  onPick: (sheet: SheetOption) => void;
  onClose: () => void;
}

/** 同じ工事の他の計算書を選ぶ小さな窓。行を押すとすぐ写し元に決まる */
export default function SheetCopyPicker({
  title,
  sheets,
  onPick,
  onClose,
}: Props): JSX.Element {
  return (
    <div className="sheet-copy-backdrop" onClick={onClose}>
      <div className="sheet-copy-box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-copy-head">
          <span>{title}</span>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet-copy-list">
          {sheets.length === 0 && (
            <div className="empty">
              この工事にはまだ他の計算書がありません
            </div>
          )}
          {sheets.map((sheet) => (
            <button
              key={sheet.estimateRowId}
              type="button"
              className="pick"
              onClick={() => onPick(sheet)}
            >
              {sheet.roomName}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
