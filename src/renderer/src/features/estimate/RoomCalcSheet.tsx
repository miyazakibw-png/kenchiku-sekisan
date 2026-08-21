import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Detail,
  FinishAssembly,
  MasterOptions,
  Subject,
} from "@shared/types";
import { resolveMasterName } from "@shared/masters";
import {
  calcDetail,
  calcLine,
  calcSet,
  displayQuantity,
  displayedValue,
  evaluateCalcSheet,
  nextBSymbol,
  padLines,
  setRowCount,
  syncLines,
  usedBSymbols,
  type CalcDetail,
  type CalcSet,
  type CalcSheetResult,
} from "../../../../core/room/calcSheet";
import {
  detailAsTsv,
  duplicateDetail,
  duplicateSet,
  fillLines,
  pasteDetails,
  pasteLines,
  setAsTsv,
} from "../../../../core/room/calcClipboard";
import { getCalcClip, setCalcClip } from "./calcClipboardStore";
import { useColumnWidths } from "../../hooks/useColumnWidths";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import "./RoomCalcSheet.css";

/** いま入力しているセル（記号クリックの差し込み先・呼出の位置に使う） */
export interface CalcFocus {
  setId: string;
  /** detail: 明細欄 / formulaA・formulaB: 計算式欄 */
  area: "detail" | "formulaA" | "formulaB";
  index: number;
}

interface Props {
  sets: CalcSet[];
  onChange: (sets: CalcSet[]) => void;
  /** 上段の記号・建具記号（計算式で使える数量） */
  variables: Record<string, number>;
  options: MasterOptions | null;
  projectId: number;
  focus: CalcFocus | null;
  onFocus: (focus: CalcFocus | null) => void;
  result: CalcSheetResult;
  onMessage: (message: string) => void;
  /** 上段（図・記号表）を持つ計算書か。汎用計算書は false */
  hasUpper?: boolean;
}

type CallSource = "basic" | "project" | "assembly";

/** 記号はセットに1つ。先頭の計算式行に持たせ、他の行からは消す */
function setBSymbol(set: CalcSet, symbol: string): CalcSet["lines"] {
  return set.lines.map((line, index) => ({
    ...line,
    bSymbol: index === 0 ? symbol : "",
  }));
}

/** 部位名から部位マスターの番号を引く（番号欄の表示用） */
function partNumberOf(
  parts: { id: number; name: string }[],
  partName: string,
): string {
  const found = parts.find((part) => part.name === partName.trim());
  return found ? String(found.id) : "";
}

/** 番号欄の入力から、番号と名称を同時に決める */
function partByNumber(
  parts: { id: number; name: string }[],
  input: string,
  currentName: string,
): { partNumber: number | null; partName: string } {
  const text = input.trim();
  if (text === "") return { partNumber: null, partName: "" };
  const found = parts.find((part) => String(part.id) === text);
  if (found) return { partNumber: found.id, partName: found.name };
  return {
    partNumber: /^\d+$/.test(text) ? Number(text) : null,
    partName: currentName,
  };
}

/** セット明細計算表の列（列幅はドラッグで変えられます） */
const CALC_COLUMNS: { label: string; title: string; width: number }[] = [
  { label: "部位", title: "部位マスターの番号で入力します", width: 90 },
  { label: "科目ID", title: "工種科目のID（番号で入力します）", width: 46 },
  { label: "材種区分", title: "材種区分マスター", width: 66 },
  { label: "明細番号", title: "呼び出した明細の番号", width: 56 },
  {
    label: "部位名／名称",
    title: "上段に部位名、下段に名称（1明細＝上下2行）",
    width: 200,
  },
  { label: "摘要", title: "上段・下段の摘要", width: 200 },
  { label: "単位", title: "単位マスター", width: 50 },
  {
    label: "掛け率",
    title: "セットで拾うが計上単位が異なるときに使います",
    width: 50,
  },
  {
    label: "部位合計",
    title: "このセットの累計×掛け率（集計に出る数量）",
    width: 72,
  },
  { label: "コメント", title: "計算式のコメント", width: 120 },
  { label: "計算式Ａ", title: "計算式Ａ", width: 200 },
  {
    label: "Ｂ",
    title: "ＡとＢの両方に入力すると Ａ×Ｂ になります",
    width: 80,
  },
  { label: "結果", title: "計算式の結果", width: 70 },
  { label: "累計", title: "このセットの累計", width: 70 },
  {
    label: "記号",
    title: "セット全体で1つ（このセットの累計を他で使う記号）",
    width: 58,
  },
  { label: "備考", title: "上段・下段の備考", width: 120 },
  { label: "積算用表示", title: "内訳書へ出すときの表示", width: 90 },
  { label: "操作", title: "明細の並べ替え・削除", width: 92 },
];

const CALC_COLUMN_WIDTHS = CALC_COLUMNS.map((column) => column.width);

const SOURCE_LABEL: Record<CallSource, string> = {
  basic: "基本マスター（明細）",
  project: "工事マスター（明細）",
  assembly: "セット明細マスター",
};

export default function RoomCalcSheet({
  sets,
  onChange,
  variables,
  options,
  projectId,
  focus,
  onFocus,
  result,
  onMessage,
  hasUpper = true,
}: Props): JSX.Element {
  const [callOpen, setCallOpen] = useState(false);
  const [source, setSource] = useState<CallSource>("basic");
  const [insertMode, setInsertMode] = useState(false);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [subjectNumber, setSubjectNumber] = useState("");
  const [details, setDetails] = useState<Detail[]>([]);
  /** 明細番号を打っている途中の文字（確定するまで表示に使う） */
  const [numberEdit, setNumberEdit] = useState<{
    key: string;
    text: string;
  } | null>(null);
  const [assemblies, setAssemblies] = useState<FinishAssembly[]>([]);
  /** 明細番号欄の一覧候補（選んだ科目の明細） */
  const [numberOptions, setNumberOptions] = useState<Detail[]>([]);
  const {
    widths,
    startResize,
    reset: resetWidths,
  } = useColumnWidths("calc-sheet-columns", CALC_COLUMN_WIDTHS);

  const subjects: Subject[] = options?.subjects ?? [];

  // 明細入力だけを切り離して、図や寸法を見ながら入力できる小窓にする
  const calcWindow = useFloatingWindow("calc-sheet-window", {
    x: 60,
    y: 90,
    w: 1100,
    h: 420,
  });

  useEffect(() => {
    if (!callOpen) return;
    void (async () => {
      if (source === "assembly") {
        const basic = await window.sekisan.listAssemblies(null);
        const project = await window.sekisan.listAssemblies(projectId);
        setAssemblies([...basic, ...project]);
        return;
      }
      if (subjectId === null) {
        setDetails([]);
        return;
      }
      setDetails(
        await window.sekisan.listDetails(
          subjectId,
          source === "project" ? projectId : null,
        ),
      );
    })();
  }, [callOpen, projectId, source, subjectId]);

  /** 明細番号欄に入ったとき、その科目の明細を一覧候補として読み込む */
  const loadNumberOptions = useCallback(
    async (detailSubjectId: number | null): Promise<void> => {
      if (detailSubjectId === null) {
        setNumberOptions([]);
        return;
      }
      const project = await window.sekisan.listDetails(
        detailSubjectId,
        projectId,
      );
      const basic = await window.sekisan.listDetails(detailSubjectId, null);
      const numbers = new Set(project.map((row) => row.detailNumber));
      setNumberOptions([
        ...project,
        ...basic.filter((row) => !numbers.has(row.detailNumber)),
      ]);
    },
    [projectId],
  );

  const used = useMemo(() => usedBSymbols(sets), [sets]);

  // 保存済みのデータで明細に対して計算式行が足りない場合に足す（3明細目以降が入力できるように）
  useEffect(() => {
    const short = sets.some(
      (set) => set.lines.length < Math.max(set.details.length * 2, 2),
    );
    if (!short) return;
    onChange(
      sets.map((set) => ({ ...set, lines: padLines(set.details, set.lines) })),
    );
  }, [onChange, sets]);

  /** セットを書き換える（明細の数に計算式行を合わせてから反映する） */
  const updateSet = useCallback(
    (setId: string, patch: Partial<CalcSet>): void =>
      onChange(
        sets.map((set) => {
          if (set.id !== setId) return set;
          const next = { ...set, ...patch };
          return { ...next, lines: padLines(next.details, next.lines) };
        }),
      ),
    [onChange, sets],
  );

  /** 明細1件（上下2段）の一部を書き換える */
  const updateDetail = useCallback(
    (setId: string, index: number, patch: Partial<CalcDetail>): void => {
      const target = sets.find((set) => set.id === setId);
      if (!target) return;
      updateSet(setId, {
        details: target.details.map((row, rowIndex) =>
          rowIndex === index ? { ...row, ...patch } : row,
        ),
      });
    },
    [sets, updateSet],
  );

  /**
   * 明細番号を入れたら、その番号の明細をマスターから呼び出して差し込む。
   * 科目IDが入っていればその科目から、空欄なら全科目から探す。
   * 工事マスターを先に見て、無ければ基本マスターを見る。
   */
  const applyDetailNumber = useCallback(
    async (setId: string, index: number, text: string): Promise<void> => {
      const target = sets.find((set) => set.id === setId);
      const row = target?.details[index];
      if (!row) return;
      const value = text.trim();
      if (value === "") {
        updateDetail(setId, index, { detailNumber: null });
        return;
      }
      const number = Number.parseFloat(value);
      if (Number.isNaN(number)) {
        onMessage("明細番号は数字で入れてください");
        return;
      }
      updateDetail(setId, index, { detailNumber: number });
      const targets =
        row.subjectId === null
          ? subjects.map((subject) => subject.id)
          : [row.subjectId];
      let found: Detail | undefined;
      for (const subjectKey of targets) {
        for (const scope of [projectId, null]) {
          const list = await window.sekisan.listDetails(subjectKey, scope);
          found = list.find(
            (item) =>
              item.detailNumber !== null &&
              Math.abs(item.detailNumber - number) < 0.005,
          );
          if (found) break;
        }
        if (found) break;
      }
      if (!found) {
        onMessage(`明細番号 ${value} の明細が見つかりません`);
        return;
      }
      updateDetail(setId, index, {
        sourceDetailId: found.id,
        subjectId: found.subjectId,
        detailNumber: found.detailNumber,
        materialCategory: found.materialCategory,
        partName: found.partName,
        name: found.name,
        descriptionUpper: found.descriptionUpper,
        descriptionLower: found.descriptionLower,
        unit: found.unit,
        remarksUpper: found.remarksUpper,
        remarksLower: found.remarksLower,
        estimateDisplay: found.estimateDisplay,
      });
      onMessage(`${found.name} を呼び出しました`);
    },
    [onMessage, projectId, sets, subjects, updateDetail],
  );

  /** セットの中の明細を1件だけ削除する（他の明細と計算式は残す） */
  const removeDetail = useCallback(
    (setId: string, index: number): void => {
      const target = sets.find((set) => set.id === setId);
      if (!target) return;
      const details = target.details.filter(
        (_, rowIndex) => rowIndex !== index,
      );
      // 明細を消したぶん、末尾の空いた計算式行も詰める
      updateSet(setId, { details, lines: syncLines(details, target.lines) });
      onFocus(null);
    },
    [onFocus, sets, updateSet],
  );

  /** セットの中の明細を上下に入れ替える */
  const moveDetail = useCallback(
    (setId: string, index: number, step: number): void => {
      const target = sets.find((set) => set.id === setId);
      if (!target) return;
      const to = index + step;
      if (to < 0 || to >= target.details.length) return;
      const details = [...target.details];
      [details[index], details[to]] = [details[to], details[index]];
      updateSet(setId, { details });
      onFocus({ setId, area: "detail", index: to });
    },
    [onFocus, sets, updateSet],
  );

  /** カーソルのあるセット（無ければ最後のセット） */
  const currentSet = useMemo(
    () =>
      sets.find((set) => set.id === focus?.setId) ??
      sets[sets.length - 1] ??
      null,
    [focus?.setId, sets],
  );

  /** 明細を1つ呼び出す（上書き基準・空きが無ければ自動で挿入） */
  const callDetail = useCallback(
    (detail: Detail) => {
      const target = currentSet;
      const item = calcDetail({
        sourceDetailId: detail.id,
        subjectId: detail.subjectId,
        detailNumber: detail.detailNumber,
        materialCategory: detail.materialCategory,
        partName: detail.partName,
        name: detail.name,
        descriptionUpper: detail.descriptionUpper,
        descriptionLower: detail.descriptionLower,
        unit: detail.unit,
        remarksUpper: detail.remarksUpper,
        remarksLower: detail.remarksLower,
        estimateDisplay: detail.estimateDisplay,
      });
      if (!target) {
        const created = calcSet(1);
        created.details = [item];
        onChange([...sets, created]);
        onFocus({ setId: created.id, area: "detail", index: 1 });
        return;
      }
      const at =
        focus && focus.setId === target.id && focus.area === "detail"
          ? focus.index
          : target.details.findIndex((row) => row.name.trim() === "");
      const details2 = [...target.details];
      if (insertMode || at < 0 || at >= details2.length) {
        const position = at < 0 ? details2.length : at;
        details2.splice(position, 0, item);
        onFocus({ setId: target.id, area: "detail", index: position + 1 });
      } else {
        details2[at] = item;
        onFocus({ setId: target.id, area: "detail", index: at + 1 });
      }
      updateSet(target.id, { details: details2 });
      onMessage(`${detail.name} を呼び出しました`);
    },
    [
      currentSet,
      focus,
      insertMode,
      onChange,
      onFocus,
      onMessage,
      sets,
      updateSet,
    ],
  );

  /** セット明細をまとめて呼び出す（元の行数に関わらず1セット＝1回分） */
  const callAssembly = useCallback(
    (assembly: FinishAssembly) => {
      const created = calcSet(0);
      created.partName = assembly.items[0]?.partName ?? "";
      created.partNumber = assembly.items[0]?.partNumber ?? null;
      created.details = assembly.items.map((item) =>
        calcDetail({
          sourceDetailId: item.sourceDetailId,
          subjectId: item.subjectId,
          detailNumber: item.detailNumber,
          materialCategory: item.materialCategory,
          partName: item.partName,
          name: item.name,
          descriptionUpper: item.descriptionUpper,
          descriptionLower: item.descriptionLower,
          unit: item.unit,
          remarksUpper: item.remarksUpper,
          remarksLower: item.remarksLower,
          estimateDisplay: item.estimateDisplay,
          coefficient: item.coefficient,
        }),
      );
      created.lines = syncLines(created.details, []);
      const at = sets.findIndex((set) => set.id === currentSet?.id);
      const next = [...sets];
      if (insertMode || at < 0) {
        next.splice(at < 0 ? next.length : at, 0, created);
      } else {
        // 上書きは元のセット1つ分を丸ごと置き換える（計算式は残す）
        created.lines = syncLines(created.details, sets[at].lines);
        next[at] = created;
      }
      onChange(next);
      onFocus({ setId: created.id, area: "detail", index: 0 });
      onMessage(
        `${assembly.items[0]?.name ?? "セット明細"} を${insertMode ? "挿入" : "上書き"}呼出しました`,
      );
    },
    [currentSet?.id, insertMode, onChange, onFocus, onMessage, sets],
  );

  /** カーソルの位置で判断して行を足す（明細欄なら明細、計算式欄なら計算行） */
  const addRow = useCallback(
    (insert: boolean) => {
      const target = currentSet;
      if (!target) {
        onChange([...sets, calcSet()]);
        return;
      }
      const area = focus?.area ?? "detail";
      if (area === "detail") {
        const details2 = [...target.details];
        const position = insert ? (focus?.index ?? 0) : details2.length;
        details2.splice(position, 0, calcDetail());
        updateSet(target.id, { details: details2 });
      } else {
        const lines = [...target.lines];
        const position = insert ? (focus?.index ?? 0) : lines.length;
        lines.splice(position, 0, calcLine());
        updateSet(target.id, { lines });
      }
    },
    [currentSet, focus, onChange, sets, updateSet],
  );

  /** いま選んでいる明細（明細欄にカーソルがあるときだけ） */
  const currentDetail = useMemo(() => {
    if (!focus || focus.area !== "detail" || !currentSet) return null;
    return currentSet.details[focus.index] ?? null;
  }, [currentSet, focus]);

  /**
   * コピー。明細欄にカーソルがあれば明細1件、それ以外はセット1つ。
   * Excelへも貼れるようクリップボードへは表形式（TSV）で入れる。
   */
  const copy = useCallback(async () => {
    if (!currentSet) return;
    if (currentDetail) {
      const text = detailAsTsv(currentDetail);
      await navigator.clipboard.writeText(text);
      setCalcClip({ kind: "detail", text, detail: currentDetail });
      onMessage(
        `明細「${currentDetail.name || "（名称なし）"}」をコピーしました`,
      );
      return;
    }
    const text = setAsTsv(currentSet);
    await navigator.clipboard.writeText(text);
    setCalcClip({ kind: "set", text, set: currentSet });
    onMessage(
      `セット「${currentSet.partName || "（部位なし）"}」をコピーしました`,
    );
  }, [currentDetail, currentSet, onMessage]);

  /**
   * 貼り付け。この画面でコピーしたセット・明細ならそのまま写し、
   * Excelなど他から持ってきた表なら、カーソルの欄（明細／計算式）へ取り込む。
   */
  const paste = useCallback(async () => {
    const text = await navigator.clipboard.readText();
    if (text.trim() === "") return;
    const clip = getCalcClip(text);

    if (clip?.kind === "set") {
      const created = duplicateSet(clip.set);
      const at = sets.findIndex((set) => set.id === currentSet?.id);
      const next = [...sets];
      next.splice(at < 0 ? next.length : at + 1, 0, created);
      onChange(next);
      onFocus({ setId: created.id, area: "detail", index: 0 });
      onMessage("コピーしたセットを貼り付けました");
      return;
    }

    if (!currentSet) {
      onMessage("貼り付ける場所を選んでください");
      return;
    }

    if (clip?.kind === "detail") {
      const details = [...currentSet.details];
      const at = focus?.area === "detail" ? focus.index + 1 : details.length;
      details.splice(at, 0, duplicateDetail(clip.detail));
      updateSet(currentSet.id, {
        details,
        lines: fillLines(details, currentSet.lines),
      });
      onMessage("コピーした明細を貼り付けました");
      return;
    }

    if (focus?.area === "detail") {
      const details = pasteDetails(currentSet.details, focus.index, text);
      updateSet(currentSet.id, {
        details,
        lines: fillLines(details, currentSet.lines),
      });
      onMessage(
        `Excelの表を明細へ貼り付けました（部位名／名称／摘要（上）／摘要（下）／単位／掛け率／備考（上）／備考（下）／積算用表示の順）`,
      );
      return;
    }

    const lines = pasteLines(currentSet.lines, focus?.index ?? 0, text);
    updateSet(currentSet.id, { lines });
    onMessage(
      "Excelの数量表を計算式へ貼り付けました（コメント／計算式Ａ／計算式Ｂの順。1列だけなら計算式Ａ）",
    );
  }, [currentSet, focus, onChange, onFocus, onMessage, sets, updateSet]);

  return (
    <div
      className={
        calcWindow.floating ? "room-calc-sheet floating" : "room-calc-sheet"
      }
      style={
        calcWindow.floating
          ? {
              left: `${calcWindow.rect.x}px`,
              top: `${calcWindow.rect.y}px`,
              width: `${calcWindow.rect.w}px`,
              height: `${calcWindow.rect.h}px`,
            }
          : undefined
      }
      onKeyDown={(e) => {
        if (!e.ctrlKey) return;
        if (e.key === "c") {
          // 文字を選んでいるときは通常の文字コピーを邪魔しない
          if ((window.getSelection()?.toString() ?? "") !== "") return;
          const active = document.activeElement;
          if (
            active instanceof HTMLInputElement &&
            active.selectionStart !== active.selectionEnd
          )
            return;
          e.preventDefault();
          void copy();
        } else if (e.key === "v") {
          e.preventDefault();
          void paste();
        }
      }}
    >
      <div
        className="section-bar"
        onMouseDown={(e) => {
          // 小窓のときは見出しをつかんで動かせる（ボタンや入力は普通に押せる）
          if (!calcWindow.floating) return;
          if (
            e.target instanceof HTMLElement &&
            e.target.closest("button,input")
          )
            return;
          calcWindow.startMove(e);
        }}
      >
        <span className={calcWindow.floating ? "grip" : ""}>
          セット明細計算表（部位のある行がセットの先頭です）
        </span>
        <button
          type="button"
          className={calcWindow.floating ? "on" : ""}
          title="明細入力だけを切り離して、動かせる小窓にします（図や寸法を見ながら入力できます）"
          onClick={() => calcWindow.setFloating(!calcWindow.floating)}
        >
          {calcWindow.floating ? "⤡ 元の位置へ戻す" : "⧉ 切り離す"}
        </button>
        {calcWindow.floating && (
          <button
            type="button"
            title="小窓を画面いっぱいに広げます（もう一度押すと元の大きさ）"
            onClick={calcWindow.toggleMaximize}
          >
            ⬜ 画面いっぱい
          </button>
        )}
        <button type="button" onClick={() => onChange([...sets, calcSet()])}>
          ＋ セット明細（2明細）
        </button>
        <button type="button" onClick={() => addRow(false)}>
          ＋ 行追加
        </button>
        <button type="button" onClick={() => addRow(true)}>
          ↥ 行挿入
        </button>
        <button
          type="button"
          title="明細欄にカーソルがあれば明細1件、それ以外はセット1つをコピーします（Ctrl+C）"
          onClick={() => void copy()}
        >
          ⧉ コピー
        </button>
        <button
          type="button"
          title="コピーしたセット・明細、またはExcelの表を貼り付けます（Ctrl+V）"
          onClick={() => void paste()}
        >
          📋 貼り付け
        </button>
        <button
          type="button"
          className={callOpen ? "on" : ""}
          onClick={() => setCallOpen(!callOpen)}
        >
          📂 マスター呼出
        </button>
        <button
          type="button"
          title="見出しの境目をドラッグすると列幅を変えられます。押すと元の幅に戻します"
          onClick={resetWidths}
        >
          ↔ 列幅リセット
        </button>
        <span className="hint">
          {hasUpper
            ? "記号は上段の表をクリックすると計算式へ入ります"
            : "建具記号は建具表から直接引用します（例 <SD2>）"}
        </span>
      </div>

      <div className="calc-body">
        <table className="grid calc">
          <colgroup>
            {CALC_COLUMNS.map((column, index) => (
              <col key={column.label} style={{ width: `${widths[index]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {CALC_COLUMNS.map((column, index) => (
                <th key={column.label} title={column.title}>
                  {column.label}
                  <span
                    className="col-resize"
                    title="ドラッグで列幅を変えられます"
                    onMouseDown={(e) => startResize(index, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          {sets.map((set, setIndex) => (
            <tbody
              key={set.id}
              className={setIndex % 2 === 0 ? "set even" : "set odd"}
            >
              {Array.from({ length: setRowCount(set) }, (_, rowIndex) => {
                const rowCount = setRowCount(set);
                // 記号は行ごとではなくセット全体で1つ（先頭の計算式行に持たせる）
                const setSymbol =
                  set.lines.find((row) => row.bSymbol.trim() !== "")?.bSymbol ??
                  "";
                const setTotal = result.setTotals.get(set.id) ?? null;
                // 明細1件は上下2行セット（偶数行＝上段、奇数行＝下段）
                const detailIndex = Math.floor(rowIndex / 2);
                const isUpper = rowIndex % 2 === 0;
                const detail = set.details[detailIndex];
                const line = set.lines[rowIndex];
                const lineResult = line ? result.lines.get(line.id) : undefined;
                return (
                  <tr
                    key={`${set.id}-${rowIndex}`}
                    className={isUpper ? "detail-upper" : "detail-lower"}
                  >
                    {rowIndex === 0 && (
                      <td className="part dcell" rowSpan={rowCount}>
                        <div className="part-pair">
                          <input
                            className="part-no"
                            list="calc-part-numbers"
                            value={
                              set.partNumber === null
                                ? ""
                                : String(set.partNumber)
                            }
                            placeholder="番号"
                            title="管理用部位の番号。選ぶと部位名称も同時に入ります"
                            onChange={(e) =>
                              updateSet(
                                set.id,
                                partByNumber(
                                  options?.aggregationParts ?? [],
                                  e.target.value,
                                  set.partName,
                                ),
                              )
                            }
                          />
                          <input
                            list="calc-parts"
                            value={set.partName}
                            placeholder="番号／一覧"
                            title="部位マスターの番号を入力するか一覧から選びます。空欄にすると上のセットに含まれます"
                            onChange={(e) => {
                              const parts = options?.aggregationParts ?? [];
                              const name = resolveMasterName(
                                parts,
                                e.target.value,
                              );
                              updateSet(set.id, {
                                partName: name,
                                partNumber:
                                  parts.find((part) => part.name === name)
                                    ?.id ?? null,
                              });
                            }}
                          />
                        </div>
                      </td>
                    )}
                    {detail ? (
                      <>
                        {isUpper && (
                          <td className="subject dcell" rowSpan={2}>
                            <input
                              list="calc-subjects"
                              value={
                                detail.subjectId === null
                                  ? ""
                                  : String(detail.subjectId)
                              }
                              placeholder="番号"
                              title={
                                subjects.find(
                                  (item) => item.id === detail.subjectId,
                                )?.name ?? "工種科目のID（一覧から選べます）"
                              }
                              onChange={(e) => {
                                const value = e.target.value.trim();
                                const id = Number.parseInt(value, 10);
                                updateDetail(set.id, detailIndex, {
                                  subjectId: Number.isNaN(id) ? null : id,
                                });
                              }}
                            />
                          </td>
                        )}
                        <td className="material dcell">
                          {!isUpper && (
                            <input
                              list="calc-materials"
                              value={detail.materialCategory}
                              onChange={(e) =>
                                updateDetail(set.id, detailIndex, {
                                  materialCategory: resolveMasterName(
                                    (options?.materialCategories ?? []).map(
                                      (item) => ({
                                        id: item.id,
                                        name: item.name,
                                      }),
                                    ),
                                    e.target.value,
                                  ),
                                })
                              }
                            />
                          )}
                        </td>
                        <td className="no dcell">
                          {!isUpper && (
                            <input
                              value={
                                numberEdit?.key === `${set.id}:${detailIndex}`
                                  ? numberEdit.text
                                  : (detail.detailNumber?.toFixed(2) ?? "")
                              }
                              list="calc-detail-numbers"
                              placeholder="番号／一覧"
                              title="明細番号を入れるとマスターの明細を呼び出します（科目IDを入れると一覧から選べます）"
                              onFocus={() => {
                                onFocus({
                                  setId: set.id,
                                  area: "detail",
                                  index: detailIndex,
                                });
                                void loadNumberOptions(detail.subjectId);
                              }}
                              onChange={(e) =>
                                setNumberEdit({
                                  key: `${set.id}:${detailIndex}`,
                                  text: e.target.value,
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.currentTarget.blur();
                              }}
                              onBlur={(e) => {
                                const text = e.target.value;
                                setNumberEdit(null);
                                if (
                                  text.trim() ===
                                  (detail.detailNumber?.toFixed(2) ?? "")
                                )
                                  return;
                                void applyDetailNumber(
                                  set.id,
                                  detailIndex,
                                  text,
                                );
                              }}
                            />
                          )}
                        </td>
                        <td className="dcell">
                          <div className={isUpper ? "part-pair" : undefined}>
                            {isUpper && (
                              <input
                                className="part-no"
                                list="calc-detail-part-numbers"
                                value={partNumberOf(
                                  options?.pickupParts ?? [],
                                  detail.partName,
                                )}
                                placeholder="番号"
                                title="明細用部位の番号。選ぶと部位名称も同時に入ります"
                                onFocus={() =>
                                  onFocus({
                                    setId: set.id,
                                    area: "detail",
                                    index: detailIndex,
                                  })
                                }
                                onChange={(e) =>
                                  updateDetail(set.id, detailIndex, {
                                    partName: partByNumber(
                                      options?.pickupParts ?? [],
                                      e.target.value,
                                      detail.partName,
                                    ).partName,
                                  })
                                }
                              />
                            )}
                            <input
                              lang={isUpper ? undefined : "ja"}
                              list={isUpper ? "calc-detail-parts" : undefined}
                              value={isUpper ? detail.partName : detail.name}
                              placeholder={isUpper ? "番号／一覧" : "名称"}
                              title={
                                isUpper
                                  ? "明細用部位の番号を入力するか一覧から選びます"
                                  : undefined
                              }
                              onFocus={() =>
                                onFocus({
                                  setId: set.id,
                                  area: "detail",
                                  index: detailIndex,
                                })
                              }
                              onChange={(e) =>
                                updateDetail(
                                  set.id,
                                  detailIndex,
                                  isUpper
                                    ? {
                                        partName: resolveMasterName(
                                          options?.pickupParts ?? [],
                                          e.target.value,
                                        ),
                                      }
                                    : { name: e.target.value },
                                )
                              }
                            />
                          </div>
                        </td>
                        <td className="dcell">
                          <input
                            lang="ja"
                            value={
                              isUpper
                                ? detail.descriptionUpper
                                : detail.descriptionLower
                            }
                            onChange={(e) =>
                              updateDetail(
                                set.id,
                                detailIndex,
                                isUpper
                                  ? { descriptionUpper: e.target.value }
                                  : { descriptionLower: e.target.value },
                              )
                            }
                          />
                        </td>
                        <td className="unit dcell">
                          {!isUpper && (
                            <input
                              list="calc-units"
                              value={detail.unit}
                              onChange={(e) =>
                                updateDetail(set.id, detailIndex, {
                                  unit: resolveMasterName(
                                    (options?.units ?? []).map((unit) => ({
                                      id: unit.id,
                                      name: unit.name,
                                    })),
                                    e.target.value,
                                  ),
                                })
                              }
                            />
                          )}
                        </td>
                        <td className="coef dcell">
                          {!isUpper && (
                            <input
                              key={detail.id}
                              className="num"
                              defaultValue={String(detail.coefficient)}
                              title="集計時にこの掛け率を掛けます"
                              onBlur={(e) => {
                                const value = Number(e.target.value);
                                if (!Number.isFinite(value)) return;
                                updateDetail(set.id, detailIndex, {
                                  coefficient: value,
                                });
                              }}
                            />
                          )}
                        </td>
                        <td className="num total dcell">
                          {!isUpper && setTotal !== null
                            ? displayQuantity(
                                displayedValue(
                                  setTotal * (detail.coefficient || 1),
                                ),
                              )
                            : ""}
                        </td>
                      </>
                    ) : (
                      <td className="empty" colSpan={8} />
                    )}
                    {line ? (
                      <>
                        <td className="comment">
                          <input
                            lang="ja"
                            maxLength={20}
                            value={line.comment}
                            onChange={(e) =>
                              updateSet(set.id, {
                                lines: set.lines.map((row, index) =>
                                  index === rowIndex
                                    ? { ...row, comment: e.target.value }
                                    : row,
                                ),
                              })
                            }
                          />
                        </td>
                        <td className="formula">
                          <input
                            value={line.formulaA}
                            onFocus={() =>
                              onFocus({
                                setId: set.id,
                                area: "formulaA",
                                index: rowIndex,
                              })
                            }
                            onChange={(e) =>
                              updateSet(set.id, {
                                lines: set.lines.map((row, index) =>
                                  index === rowIndex
                                    ? { ...row, formulaA: e.target.value }
                                    : row,
                                ),
                              })
                            }
                          />
                        </td>
                        <td className="formula-b">
                          <input
                            value={line.formulaB}
                            title="ＡとＢの両方に入力すると Ａ×Ｂ になります"
                            onFocus={() =>
                              onFocus({
                                setId: set.id,
                                area: "formulaB",
                                index: rowIndex,
                              })
                            }
                            onChange={(e) =>
                              updateSet(set.id, {
                                lines: set.lines.map((row, index) =>
                                  index === rowIndex
                                    ? { ...row, formulaB: e.target.value }
                                    : row,
                                ),
                              })
                            }
                          />
                        </td>
                        <td
                          className={[
                            "num",
                            (lineResult?.value ?? 0) < 0 ? "minus" : "",
                            lineResult?.error ? "error" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          title={lineResult?.error}
                        >
                          {lineResult?.error !== ""
                            ? lineResult?.error
                            : lineResult?.text}
                        </td>
                        <td className="num">{lineResult?.totalText ?? ""}</td>
                      </>
                    ) : (
                      <td className="empty" colSpan={5} />
                    )}
                    {rowIndex === 0 && (
                      <td className="bsym" rowSpan={rowCount}>
                        <div className="cell">
                          <input
                            value={setSymbol}
                            placeholder="B1"
                            title="このセットの累計を他のセットで使うための記号（セットに1つ）"
                            onChange={(e) => {
                              const symbol = e.target.value
                                .trim()
                                .toUpperCase();
                              if (
                                symbol !== "" &&
                                symbol !== setSymbol &&
                                used.has(symbol)
                              ) {
                                onMessage(`${symbol} は既に使われています`);
                                return;
                              }
                              updateSet(set.id, {
                                lines: setBSymbol(set, symbol),
                              });
                            }}
                          />
                          <button
                            type="button"
                            title="空いている番号を割り当てます"
                            onClick={() =>
                              updateSet(set.id, {
                                lines: setBSymbol(set, nextBSymbol(sets)),
                              })
                            }
                          >
                            B
                          </button>
                        </div>
                      </td>
                    )}
                    {detail ? (
                      <>
                        <td className="dcell">
                          <input
                            lang="ja"
                            value={
                              isUpper
                                ? detail.remarksUpper
                                : detail.remarksLower
                            }
                            onChange={(e) =>
                              updateDetail(
                                set.id,
                                detailIndex,
                                isUpper
                                  ? { remarksUpper: e.target.value }
                                  : { remarksLower: e.target.value },
                              )
                            }
                          />
                        </td>
                        <td className="estimate dcell">
                          {!isUpper && (
                            <input
                              lang="ja"
                              value={detail.estimateDisplay}
                              title="内訳書へ出すときの表示（明細マスターと同じ欄）"
                              onChange={(e) =>
                                updateDetail(set.id, detailIndex, {
                                  estimateDisplay: e.target.value,
                                })
                              }
                            />
                          )}
                        </td>
                      </>
                    ) : (
                      <td className="empty" colSpan={2} />
                    )}
                    {detail ? (
                      isUpper && (
                        <td
                          className="ops"
                          rowSpan={rowIndex + 1 < rowCount ? 2 : 1}
                        >
                          <button
                            type="button"
                            title="この明細を1つ上へ移動します"
                            disabled={detailIndex === 0}
                            onClick={() => moveDetail(set.id, detailIndex, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            title="この明細を1つ下へ移動します"
                            disabled={detailIndex === set.details.length - 1}
                            onClick={() => moveDetail(set.id, detailIndex, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            title="この明細1件だけを削除します"
                            onClick={() => removeDetail(set.id, detailIndex)}
                          >
                            ✕
                          </button>
                          {detailIndex === 0 && (
                            <button
                              type="button"
                              title="このセット明細をまるごと削除します"
                              onClick={() =>
                                onChange(
                                  sets.filter((each) => each.id !== set.id),
                                )
                              }
                            >
                              🗑
                            </button>
                          )}
                        </td>
                      )
                    ) : (
                      <td className="ops">
                        {rowIndex === 0 && (
                          <button
                            type="button"
                            title="このセット明細をまるごと削除します"
                            onClick={() =>
                              onChange(
                                sets.filter((each) => each.id !== set.id),
                              )
                            }
                          >
                            🗑
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {calcWindow.floating && (
        <>
          <span
            className="resize-edge east"
            title="ドラッグで横幅を変えられます"
            onMouseDown={(e) => calcWindow.startResize(e, "e")}
          />
          <span
            className="resize-edge south"
            title="ドラッグで高さを変えられます"
            onMouseDown={(e) => calcWindow.startResize(e, "s")}
          />
          <span
            className="resize-grip"
            title="ドラッグで小窓の大きさを変えられます"
            onMouseDown={(e) => calcWindow.startResize(e, "se")}
          />
        </>
      )}

      <datalist id="calc-detail-numbers">
        {numberOptions.map((item) => (
          <option key={item.id} value={item.detailNumber?.toFixed(2) ?? ""}>
            {`${item.partName} ${item.name}`.trim()}
          </option>
        ))}
      </datalist>
      <datalist id="calc-detail-parts">
        {(options?.pickupParts ?? []).map((part) => (
          <option key={part.id} value={part.name}>
            {part.id}
          </option>
        ))}
      </datalist>
      <datalist id="calc-detail-part-numbers">
        {(options?.pickupParts ?? []).map((part) => (
          <option key={part.id} value={String(part.id)}>
            {part.name}
          </option>
        ))}
      </datalist>
      <datalist id="calc-part-numbers">
        {(options?.aggregationParts ?? []).map((part) => (
          <option key={part.id} value={String(part.id)}>
            {part.name}
          </option>
        ))}
      </datalist>
      <datalist id="calc-parts">
        {(options?.aggregationParts ?? []).map((part) => (
          <option key={part.id} value={part.name}>
            {part.id}
          </option>
        ))}
      </datalist>
      <datalist id="calc-subjects">
        {subjects.map((subject) => (
          <option key={subject.id} value={String(subject.id)}>
            {subject.name}
          </option>
        ))}
      </datalist>
      <datalist id="calc-materials">
        {(options?.materialCategories ?? []).map((item) => (
          <option key={item.id} value={item.name}>
            {item.id}
          </option>
        ))}
      </datalist>
      <datalist id="calc-units">
        {(options?.units ?? []).map((unit) => (
          <option key={unit.id} value={unit.name}>
            {unit.id}
          </option>
        ))}
      </datalist>

      {callOpen && (
        <div className="call-window">
          <div className="section-bar">
            <span>マスター呼出</span>
            {(Object.keys(SOURCE_LABEL) as CallSource[]).map((key) => (
              <button
                key={key}
                type="button"
                className={source === key ? "on" : ""}
                onClick={() => setSource(key)}
              >
                {SOURCE_LABEL[key]}
              </button>
            ))}
            <label>
              <input
                type="checkbox"
                checked={!insertMode}
                onChange={() => setInsertMode(false)}
              />
              上書き呼出
            </label>
            <label>
              <input
                type="checkbox"
                checked={insertMode}
                onChange={() => setInsertMode(true)}
              />
              挿入呼出
            </label>
            <button type="button" onClick={() => setCallOpen(false)}>
              ✕ 閉じる
            </button>
          </div>
          {source === "assembly" ? (
            <ul className="call-list">
              {assemblies.map((assembly) => (
                <li
                  key={`${assembly.scope}-${assembly.id}`}
                  tabIndex={0}
                  onDoubleClick={() => callAssembly(assembly)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") callAssembly(assembly);
                  }}
                >
                  <span className="scope">
                    {assembly.scope === "basic" ? "基準" : "工事"}
                  </span>
                  <span className="part">
                    {assembly.items[0]?.partName ?? ""}
                  </span>
                  <span className="name">{assembly.items[0]?.name ?? ""}</span>
                  <span className="count">{assembly.items.length}明細</span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <div className="call-subject">
                <span>工種科目</span>
                <input
                  className="num"
                  placeholder="番号"
                  value={subjectNumber}
                  title="工種科目の番号を入れると、その科目の明細を出します"
                  onChange={(e) => {
                    const text = e.target.value.trim();
                    setSubjectNumber(e.target.value);
                    const found = subjects.find(
                      (subject) => String(subject.id) === text,
                    );
                    setSubjectId(found?.id ?? null);
                  }}
                />
                <select
                  value={subjectId === null ? "" : String(subjectId)}
                  title="一覧から選び直せます（何回でも選べます）"
                  onChange={(e) => {
                    const id = Number.parseInt(e.target.value, 10);
                    setSubjectId(Number.isNaN(id) ? null : id);
                    setSubjectNumber(Number.isNaN(id) ? "" : String(id));
                  }}
                >
                  <option value="">（工種科目を選ぶ）</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.id}：{subject.name}
                    </option>
                  ))}
                </select>
                <span className="count">{details.length}件</span>
              </div>
              <table className="call-table">
                <thead>
                  <tr>
                    <th className="no">番号</th>
                    <th>部位名／名称</th>
                    <th>摘要</th>
                    <th className="unit">単位</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((detail) => (
                    <tr
                      key={detail.id}
                      tabIndex={0}
                      onDoubleClick={() => callDetail(detail)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") callDetail(detail);
                      }}
                    >
                      <td className="no">
                        {detail.detailNumber?.toFixed(2) ?? ""}
                      </td>
                      <td>
                        <div className="upper">{detail.partName}</div>
                        <div className="lower">{detail.name}</div>
                      </td>
                      <td>
                        <div className="upper">{detail.descriptionUpper}</div>
                        <div className="lower">{detail.descriptionLower}</div>
                      </td>
                      <td className="unit">{detail.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="note">
            選んでダブルクリック（またはEnter）で呼び出します。呼出画面は閉じないので続けて呼び出せます。
          </p>
        </div>
      )}

      <p className="note">
        計算式には{hasUpper ? "上段の記号（FA・WA1 など）、" : "数字と"}
        建具記号（&lt;AW1&gt;
        …建具表から直接引用）、他セットの累計（B1〜B100）が使えます。結果は小数2桁で四捨五入し、累計は表示されている数字を合計します。マイナスは赤、式の誤りは紫で表示します。
      </p>
      <p className="note dim">
        コピー・貼り付け（Ctrl+C／Ctrl+V）：明細欄にカーソルがあれば明細1件、計算式欄なら
        セット1つを写します。Excelの表は、明細欄にカーソルがあれば
        部位名／名称／摘要（上）／摘要（下）／単位／掛け率／備考（上）／備考（下）／積算用表示の順、
        計算式欄なら コメント／計算式Ａ／計算式Ｂ
        の順（1列だけなら計算式Ａ）で取り込みます。
      </p>
      <CalcVariablesHint variables={variables} hasUpper={hasUpper} />
    </div>
  );
}

function CalcVariablesHint({
  variables,
  hasUpper,
}: {
  variables: Record<string, number>;
  hasUpper: boolean;
}): JSX.Element {
  const count = Object.keys(variables).length;
  return (
    <p className="note dim">
      計算式に使える記号：{count}件（{hasUpper ? "上段の表と建具表" : "建具表"}
      ）
    </p>
  );
}

export { evaluateCalcSheet };
