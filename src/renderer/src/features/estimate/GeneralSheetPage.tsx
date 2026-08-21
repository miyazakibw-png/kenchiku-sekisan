import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EstimateRowDraft,
  Fitting,
  GeneralSheet,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import {
  evaluateCalcSheet,
  trimEmptySets,
  type CalcSet,
} from "../../../../core/room/calcSheet";
import { computeFitting } from "../../../../core/fittings/fitting";
import RoomCalcSheet, { type CalcFocus } from "./RoomCalcSheet";
import "./RoomSheetPage.css";

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** 汎用計算書：上段（図・記号）が無く、セット明細計算表だけで自由に拾う計算書 */
export default function GeneralSheetPage({
  project,
  row,
  roomName,
  onBack,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<GeneralSheet | null>(null);
  const [lower, setLower] = useState<CalcSet[]>([]);
  const [note, setNote] = useState("");
  const [fittings, setFittings] = useState<Fitting[]>([]);
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [calcFocus, setCalcFocus] = useState<CalcFocus | null>(null);
  const [message, setMessage] = useState("");
  const [warned, setWarned] = useState(false);

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getGeneralSheet(row.id as number);
      setSheet(loaded);
      setLower(trimEmptySets(parseJson<CalcSet[]>(loaded.lowerJson, [])));
      setNote(loaded.note);
      setFittings(await window.sekisan.listFittings(project.id));
      setOptions(await window.sekisan.getMasterOptions());
    })();
  }, [project.id, row.id]);

  /** 上段が無いので、計算式に使えるのは建具表の記号だけ */
  const calcVariables = useMemo(() => {
    const values: Record<string, number> = {};
    fittings.forEach((fitting) => {
      const computed = computeFitting(fitting);
      if (computed.area !== null) values[`<${fitting.symbol}>`] = computed.area;
      if (fitting.width !== null)
        values[`<${fitting.symbol}:W>`] = fitting.width;
      if (fitting.height !== null)
        values[`<${fitting.symbol}:H>`] = fitting.height;
      if (computed.baseboardDeduction !== null)
        values[`<${fitting.symbol}:HL>`] = computed.baseboardDeduction;
    });
    return values;
  }, [fittings]);

  const calcResult = useMemo(
    () => evaluateCalcSheet(lower, calcVariables),
    [calcVariables, lower],
  );

  const save = useCallback(async () => {
    if (!sheet) return;
    // 入力の無いセット明細は保存時に取り除く（画面からも消す）
    const trimmed = trimEmptySets(lower);
    setLower(trimmed);
    const saved = await window.sekisan.saveGeneralSheet({
      id: sheet.id,
      lowerJson: JSON.stringify(trimmed),
      note,
    });
    setSheet(saved);
    setMessage("保存しました");
  }, [lower, note, sheet]);

  const closePage = useCallback(() => {
    if (calcResult.errors.length > 0 && !warned) {
      const first = calcResult.errors[0];
      const set = lower.find((each) => each.id === first.setId);
      const index =
        set?.lines.findIndex((line) => line.id === first.lineId) ?? 0;
      setCalcFocus({ setId: first.setId, area: "formulaA", index });
      setWarned(true);
      setMessage(
        `計算式の誤りが${calcResult.errors.length}件あります（${first.message}）。もう一度押すと戻ります`,
      );
      return;
    }
    onBack();
  }, [calcResult.errors, lower, onBack, warned]);

  return (
    <div className="room-sheet-page general-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={closePage}>
          ← 部位別入力表へ
        </button>
        <h2>汎用計算書</h2>
        <span className="project">
          {project.managementNo} {roomName || "（名称なし）"}
        </span>
        <label className="grow">
          備考
          <input
            key={`note-${sheet?.id ?? "new"}`}
            defaultValue={note}
            onBlur={(e) => setNote(e.target.value)}
          />
        </label>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      <RoomCalcSheet
        sets={lower}
        onChange={setLower}
        variables={calcVariables}
        options={options}
        projectId={project.id}
        focus={calcFocus}
        onFocus={setCalcFocus}
        result={calcResult}
        onMessage={setMessage}
        hasUpper={false}
        windowTitle={`汎用計算書　${project.managementNo}`}
      />

      <p className="hint">
        汎用計算書は上段（図・記号）が無く、明細と計算式だけで拾います。計算式には数字と
        B1〜B100（他セットの累計）、&lt;SD2&gt;・&lt;SD2:W&gt;・&lt;SD2:H&gt;・&lt;SD2:HL&gt;（建具表から直接引用）が使えます。
      </p>
    </div>
  );
}
