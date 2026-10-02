import { useEffect, useMemo, useState } from "react";
import type {
  EstimateRow,
  SheetDrawingSource,
  TraceUnderlay,
} from "@shared/types";
import "./DrawingSourcePicker.css";

interface Props {
  /** 今開いている物件 */
  projectId: number;
  /** 呼び出し元の計算書の行（この行のこの種類の図面は一覧に出さない） */
  excludeRowId: number | null;
  /** 呼び出し元の計算書の種類（room/frame/pit） */
  excludeCalcType: string;
  /** 選んだ計算書の図面をまとめて受け取る */
  onPick: (drawings: TraceUnderlay[]) => void;
  onClose: () => void;
}

const CALC_LABEL: Record<string, string> = {
  room: "部屋計算書",
  frame: "軸組計算書",
  pit: "ピット・面積計算書",
};

/** 計算書の行の名前（部位Ⅱは空欄なら上の行から引き継ぐ。計算書の見出しと同じ出し方） */
function rowNames(rows: readonly EstimateRow[]): Map<number, string> {
  const names = new Map<number, string>();
  let part1 = "";
  let part2 = "";
  rows.forEach((row) => {
    if (row.part1.trim() !== "") part1 = row.part1.trim();
    if (row.part2.trim() !== "") part2 = row.part2.trim();
    const name = `${part2} ${row.part3}`.trim() || part1 || `行${row.id}`;
    names.set(row.id, name);
  });
  return names;
}

/**
 * 他の計算書（部屋・軸組・ピット）で置いた図面を呼び出す窓。
 * 縮尺・位置・濃さは計算書に入っているまま引き継ぐので、もう一度縮尺を合わせなくてよい。
 */
export default function DrawingSourcePicker({
  projectId,
  excludeRowId,
  excludeCalcType,
  onPick,
  onClose,
}: Props): JSX.Element {
  const [sources, setSources] = useState<SheetDrawingSource[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [list, rows] = await Promise.all([
        window.sekisan.listSheetDrawingSources(projectId),
        window.sekisan.listEstimateRows(projectId),
      ]);
      setSources(
        list.filter(
          (source) =>
            !(
              source.estimateRowId === excludeRowId &&
              source.calcType === excludeCalcType
            ),
        ),
      );
      setNames(rowNames(rows));
    })();
  }, [projectId, excludeRowId, excludeCalcType]);

  const rows = useMemo(
    () =>
      sources.map((source, index) => ({
        index,
        source,
        name: names.get(source.estimateRowId) ?? `行${source.estimateRowId}`,
      })),
    [sources, names],
  );

  const toggle = (index: number): void => {
    const next = new Set(checked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setChecked(next);
  };

  const pick = async (): Promise<void> => {
    const drawings = sources
      .filter((_, index) => checked.has(index))
      .flatMap((source) => source.drawings);
    if (drawings.length === 0) return;
    setBusy(true);
    try {
      onPick(drawings);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawing-source-backdrop" onClick={onClose}>
      <div
        className="drawing-source-picker"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="picker-bar">
          <span>
            他の計算書の図面を呼び出す（縮尺・位置・濃さごと貼ります）
          </span>
          <button type="button" onClick={onClose}>
            ✕ 閉じる
          </button>
        </div>
        <div className="picker-body">
          {rows.length === 0 && (
            <p className="picker-empty">
              図面を置いた計算書が他にありません。
              （先に別の計算書で図面を貼って縮尺を合わせてください）
            </p>
          )}
          {rows.map(({ index, source, name }) => (
            <label key={index} className="picker-row">
              <input
                type="checkbox"
                checked={checked.has(index)}
                onChange={() => toggle(index)}
              />
              <span className="picker-name">{name}</span>
              <span className="picker-kind">
                {CALC_LABEL[source.calcType] ?? source.calcType}
              </span>
              <span className="picker-count">
                図面{source.drawings.length}枚
              </span>
            </label>
          ))}
        </div>
        <div className="picker-foot">
          <button
            type="button"
            disabled={busy || checked.size === 0}
            onClick={() => void pick()}
          >
            📥 呼び出す（{checked.size}件）
          </button>
        </div>
      </div>
    </div>
  );
}
