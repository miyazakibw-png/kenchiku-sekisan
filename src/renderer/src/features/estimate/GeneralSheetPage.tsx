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
import CalcPrintSheet from "../print/CalcPrintSheet";
import "./RoomSheetPage.css";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
  /** 天井高さを直したときに部位別入力表の行へも伝える */
  onCeilingHeightChange?: (height: number | null) => void;
  /** 印刷書式（A3横）で出す。入力はせず、保存もしない */
  printMode?: boolean;
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
  onCeilingHeightChange,
  printMode = false,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<GeneralSheet | null>(null);
  const [lower, setLower] = useState<CalcSet[]>([]);
  const [note, setNote] = useState("");
  const [ceilingHeight, setCeilingHeight] = useState<number | null>(
    row.ceilingHeight,
  );
  const [fittings, setFittings] = useState<Fitting[]>([]);
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [calcFocus, setCalcFocus] = useState<CalcFocus | null>(null);
  const [message, setMessage] = useState("");
  /** 既に注意した誤りの内容（同じ誤りのまま2回目を押したら閉じる） */
  const [warnedKey, setWarnedKey] = useState("");
  /** 誤りの欄へカーソルを飛ばす合図 */
  const [errorJump, setErrorJump] = useState(0);

  // 画面を閉じる・ウィンドウを閉じるときは、直した内容を自動で保存する
  const { markSaved } = useSaveOnLeave({ lower, note }, () => save());

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getGeneralSheet(row.id as number);
      const sets = trimEmptySets(parseJson<CalcSet[]>(loaded.lowerJson, []));
      setSheet(loaded);
      setLower(sets);
      setNote(loaded.note);
      markSaved({ lower: sets, note: loaded.note });
      setFittings(await window.sekisan.listFittings(project.id));
      setOptions(await window.sekisan.getMasterOptions(project.id));
    })();
  }, [markSaved, project.id, row.id]);

  /** 天井高さは部位別入力表の行と相互に連動する */
  const applyCeilingHeight = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const value = trimmed === "" ? null : Number(trimmed);
      if (value !== null && Number.isNaN(value)) return;
      setCeilingHeight(value);
      onCeilingHeightChange?.(value);
    },
    [onCeilingHeightChange],
  );

  /** 計算式に使えるのは天井高さ（CH）と建具表の記号 */
  const calcVariables = useMemo(() => {
    const values: Record<string, number> = { CH: ceilingHeight ?? 0 };
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
  }, [ceilingHeight, fittings]);

  const calcResult = useMemo(
    () => evaluateCalcSheet(lower, calcVariables),
    [calcVariables, lower],
  );

  const save = useCallback(async () => {
    // 印刷は見るだけなので、直したことにしない
    if (!sheet || printMode) return;
    // 入力の無いセット明細は保存時に取り除く（画面からも消す）
    const trimmed = trimEmptySets(lower);
    setLower(trimmed);
    markSaved({ lower: trimmed, note });
    const saved = await window.sekisan.saveGeneralSheet({
      id: sheet.id,
      lowerJson: JSON.stringify(trimmed),
      note,
    });
    setSheet(saved);
    setMessage("保存しました");
  }, [lower, markSaved, note, printMode, sheet]);

  const closePage = useCallback(() => {
    const errorKey = calcResult.errors
      .map((error) => `${error.lineId}:${error.message}`)
      .join("|");
    if (calcResult.errors.length > 0 && errorKey !== warnedKey) {
      const first = calcResult.errors[0];
      const set = lower.find((each) => each.id === first.setId);
      const found = set?.lines.findIndex((line) => line.id === first.lineId);
      const index = found === undefined || found < 0 ? 0 : found;
      const line = set?.lines[index];
      const area =
        line && line.formulaA.trim() === "" && line.formulaB.trim() !== ""
          ? "formulaB"
          : "formulaA";
      setCalcFocus({ setId: first.setId, area, index });
      setErrorJump((tick) => tick + 1);
      setWarnedKey(errorKey);
      setMessage(
        `計算式の誤りが${calcResult.errors.length}件あります（${first.message}）。誤りの計算式へカーソルを移しました。直さずに閉じるときは、もう一度押してください`,
      );
      return;
    }
    // 閉じるときは必ず自動保存する
    void (async () => {
      await save();
      onBack();
    })();
  }, [calcResult.errors, lower, onBack, warnedKey, save]);

  if (printMode)
    return (
      <CalcPrintSheet
        title={`汎用計算書　${project.managementNo} ${project.name}　${roomName || "（名称なし）"}${
          ceilingHeight === null ? "" : `　CH ${ceilingHeight.toFixed(2)}`
        }`}
        upper={null}
        sets={lower}
        result={calcResult}
      />
    );

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
        <label className="ceiling-height">
          天井高さ
          <input
            className="num"
            key={`gch-${sheet?.id ?? "new"}-${ceilingHeight === null ? "" : ceilingHeight.toFixed(2)}`}
            defaultValue={ceilingHeight === null ? "" : ceilingHeight.toFixed(2)}
            title="この計算書の天井高さ（記号CH）。直すと部位別入力表の天井高さも変わります"
            onBlur={(e) => applyCeilingHeight(e.target.value)}
          />
        </label>
        <label className="grow">
          備考
          <input
            lang="ja"
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
        jumpTick={errorJump}
        result={calcResult}
        onMessage={setMessage}
        hasUpper={false}
        windowTitle={`汎用計算書　${project.managementNo}`}
      />

      <p className="hint">
        汎用計算書は上段（図・記号）が無く、明細と計算式だけで拾います。計算式には数字と CH（天井高さ）、
        B1〜B100（他セットの累計）、&lt;SD2&gt;・&lt;SD2:W&gt;・&lt;SD2:H&gt;・&lt;SD2:HL&gt;（建具表から直接引用）が使えます。
      </p>
    </div>
  );
}
