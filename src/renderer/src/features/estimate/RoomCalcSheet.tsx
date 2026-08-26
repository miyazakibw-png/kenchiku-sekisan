import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Detail,
  FinishAssembly,
  MasterEntry,
  MasterOptions,
  Subject,
} from "@shared/types";
import { resolveMasterName } from "@shared/masters";
import type { AssemblyGroup } from "../../../../core/masters/assemblyGroup";
import { groupAssembliesByHead } from "../../../../core/masters/assemblyGroup";
import {
  addSetDetailRow,
  addSetLineRow,
  addSetRow,
  calcDetail,
  calcLine,
  calcSet,
  commentSet,
  displayQuantity,
  displayedValue,
  evaluateCalcSheet,
  isCommentSet,
  mergeWithPreviousSet,
  moveSetDetail,
  openSetDetail,
  padLines,
  removeSet,
  removeSetDetail,
  removeSetLine,
  setRowCount,
  splitSetAt,
  syncLines,
  usedBSymbols,
  type CalcDetail,
  type CalcLine,
  type CalcSet,
  type CalcSheetResult,
} from "../../../../core/room/calcSheet";
import {
  detailAsTsv,
  duplicateDetail,
  duplicateLine,
  duplicateSet,
  fillLines,
  pasteLines,
  pasteRows,
  rowsAsTsv,
} from "../../../../core/room/calcClipboard";
import { sortDetails } from "../../../../core/sort/detailSortKey";
import { getCalcClip, setCalcClip } from "./calcClipboardStore";
import { useColumnWidths } from "../../hooks/useColumnWidths";
import type { CalcFocus } from "@shared/calcWindow";
import "./RoomCalcSheet.css";

export type { CalcFocus };

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
  /** 別画面（明細入力ウィンドウ）の見出し。別画面で開けないときは省く */
  windowTitle?: string;
  /** 明細入力ウィンドウの中に表示しているか */
  inWindow?: boolean;
}

type CallSource = "basic" | "project" | "assembly";

/** コメント行（※行挿入）で選べる色 */
const BANNER_COLORS: { label: string; color: string }[] = [
  { label: "緑", color: "#dcfce7" },
  { label: "桃", color: "#fce7f3" },
  { label: "青", color: "#dbeafe" },
  { label: "黄", color: "#fef9c3" },
  { label: "橙", color: "#ffedd5" },
  { label: "灰", color: "#e2e8f0" },
  { label: "紫", color: "#ede9fe" },
  { label: "水", color: "#cffafe" },
];

/** 記号はセットに1つ。先頭の計算式行に持たせ、他の行からは消す */
function setBSymbol(set: CalcSet, symbol: string): CalcSet["lines"] {
  return set.lines.map((line, index) => ({
    ...line,
    bSymbol: index === 0 ? symbol : "",
  }));
}

/** 番号でも名称でも受け付けて、マスターの番号と名称を決める */
function pickMaster(
  entries: MasterEntry[],
  input: string,
): { id: number | null; name: string } {
  const text = input.trim();
  if (text === "") return { id: null, name: "" };
  const byNumber = /^\d+$/.test(text)
    ? entries.find((entry) => entry.id === Number(text))
    : undefined;
  if (byNumber) return { id: byNumber.id, name: byNumber.name };
  const byName = entries.find((entry) => entry.name === text);
  if (byName) return { id: byName.id, name: byName.name };
  return { id: null, name: text };
}

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
function PickInput({
  value,
  listId,
  entries,
  className,
  placeholder,
  title,
  japanese = false,
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
  row: number;
  col: number;
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
      {box && shown.length > 0 && (
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
        </ul>
      )}
    </>
  );
}

/** 計算表の列（画像の並び。列幅はドラッグで変えられ、全物件で共通に使う） */
const CALC_COLUMNS: {
  label: string;
  title: string;
  width: number;
  className?: string;
}[] = [
  {
    label: "部位",
    title:
      "管理用部位。1行に1つ入れられます（途中の行に入れると、その行から別のセットになります）",
    width: 80,
    className: "set-part",
  },
  {
    label: "区分",
    title: "材種区分マスター",
    width: 56,
    className: "material",
  },
  { label: "科目", title: "工種科目のID（数字）", width: 42, className: "id" },
  {
    label: "部位ID",
    title: "明細用部位のID（数字）。入れると右の部位名が入ります",
    width: 48,
    className: "id",
  },
  {
    label: "名称ID",
    title: "明細番号。入れると名称・摘要がマスターの文字になります",
    width: 54,
    className: "id",
  },
  { label: "部位", title: "明細の部位名（自由に直せます）", width: 90 },
  { label: "名称", title: "明細の名称（自由に直せます）", width: 190 },
  { label: "摘要（下段）", title: "摘要（下段）", width: 170 },
  { label: "摘要（上段）", title: "摘要（上段）", width: 140 },
  { label: "単位", title: "単位マスター", width: 44, className: "unit" },
  {
    label: "掛け率",
    title: "セットで拾うが計上単位が異なるときに使います（最大9999.99）",
    width: 48,
    className: "coef",
  },
  {
    label: "部位合計",
    title: "このセットの累計×掛け率（集計に出る数量）",
    width: 68,
    className: "total",
  },
  {
    label: "コメント",
    title: "計算式のコメント",
    width: 96,
    className: "comment",
  },
  { label: "計算式Ａ", title: "計算式Ａ", width: 200, className: "formula" },
  {
    label: "計算式Ｂ",
    title: "ＡとＢの両方に入力すると Ａ×Ｂ になります",
    width: 80,
    className: "formula-b",
  },
  { label: "Ａ*Ｂ", title: "計算式の結果", width: 66 },
  { label: "Ａ*Ｂ累計", title: "このセットの累計", width: 66 },
  {
    label: "記号",
    title: "セット全体で1つ（B1〜B99。このセットの累計を他で使う記号）",
    width: 48,
    className: "bsym",
  },
  { label: "備考（下段）", title: "備考（下段）", width: 90 },
  { label: "備考（上段）", title: "備考（上段）", width: 90 },
  {
    label: "仕上・下地摘要",
    title: "内訳書へ出すときの表示（積算用表示）",
    width: 100,
    className: "estimate",
  },
  { label: "操作", title: "明細の並べ替え・削除", width: 92, className: "ops" },
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
  windowTitle,
  inWindow = false,
}: Props): JSX.Element {
  const [callOpen, setCallOpen] = useState(false);
  const [callPos, setCallPos] = useState<{ x: number; y: number } | null>(null);
  const [source, setSource] = useState<CallSource>("basic");
  const [insertMode, setInsertMode] = useState(false);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [subjectNumber, setSubjectNumber] = useState("");
  const [details, setDetails] = useState<Detail[]>([]);
  const [bannerOpen, setBannerOpen] = useState(false);
  /** コメント行（※行）にカーソルがあるときの、そのコメント行のセットID */
  const [bannerSetId, setBannerSetId] = useState<string | null>(null);
  const [assemblies, setAssemblies] = useState<FinishAssembly[]>([]);
  /** 明細番号欄の一覧候補（選んだ科目の明細） */
  const [numberOptions, setNumberOptions] = useState<Detail[]>([]);
  /** 複数行コピーの範囲（Shift+クリックで選んだ最後の行） */
  const [rangeEnd, setRangeEnd] = useState<{
    setId: string;
    index: number;
  } | null>(null);
  /** 複数行コピーの範囲の先頭（Shift+クリックでは動かさない） */
  const [rangeStart, setRangeStart] = useState<{
    setId: string;
    index: number;
  } | null>(null);
  /** Shift+クリック中は範囲の先頭を動かさないための目印 */
  const shiftClicking = useRef(false);
  /** 元に戻す・やり直しのための履歴 */
  const [past, setPast] = useState<CalcSet[][]>([]);
  const [future, setFuture] = useState<CalcSet[][]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const { widths, startResize } = useColumnWidths(
    "calc-sheet-columns-v2",
    CALC_COLUMN_WIDTHS,
  );

  const subjects: Subject[] = useMemo(() => options?.subjects ?? [], [options]);
  const pickupParts: MasterEntry[] = useMemo(
    () => options?.pickupParts ?? [],
    [options],
  );
  /** セット明細マスターの並び（他のマスターと同じ 科目→部位→明細） */
  const sortedAssemblies: FinishAssembly[] = useMemo(() => {
    const subjectOrder = new Map<number, number>(
      subjects.map((subject, index) => [subject.id, index]),
    );
    return sortDetails(assemblies, (assembly) => {
      const head = assembly.items[0];
      return {
        subjectOrder: subjectOrder.get(head?.subjectId ?? -1) ?? null,
        part1: "",
        part2SortOrder: null,
        part2Name: "",
        partNumber: head?.partNumber ?? null,
        detailNumber: head?.detailNumber ?? null,
        partName: head?.partName ?? "",
        name: head?.name ?? "",
        unitOrder: null,
        descriptionLower: head?.descriptionLower ?? "",
        descriptionUpper: head?.descriptionUpper ?? "",
        remarksLower: head?.remarksLower ?? "",
        remarksUpper: head?.remarksUpper ?? "",
        materialCategoryOrder: null,
      };
    });
  }, [assemblies, subjects]);
  /** 1行目が同じセットをまとめて選ぶための一覧（空なら閉じている） */
  const [pickGroup, setPickGroup] = useState<FinishAssembly[]>([]);
  /** 呼出画面に出すセット（工種科目を選んでいればその科目のセットだけ） */
  const calledAssemblies: FinishAssembly[] = useMemo(
    () =>
      subjectId === null
        ? sortedAssemblies
        : sortedAssemblies.filter(
            (assembly) => assembly.items[0]?.subjectId === subjectId,
          ),
    [sortedAssemblies, subjectId],
  );
  /** 1行目が同じセットは1行にまとめて見せる（選ぶと中のセットを全部出す） */
  const assemblyGroups: AssemblyGroup[] = useMemo(
    () => groupAssembliesByHead(calledAssemblies),
    [calledAssemblies],
  );
  const aggregationParts: MasterEntry[] = useMemo(
    () => options?.aggregationParts ?? [],
    [options],
  );

  /** 候補一覧（マスターの並びのまま全件） */
  const subjectEntries: PickEntry[] = useMemo(
    () =>
      subjects.map((subject) => ({
        value: String(subject.id),
        label: subject.name,
      })),
    [subjects],
  );
  const pickupPartEntries: PickEntry[] = useMemo(
    () =>
      pickupParts.map((part) => ({
        value: String(part.id),
        label: `${part.name}${part.note ? `　${part.note}` : ""}`,
      })),
    [pickupParts],
  );
  const aggregationPartEntries: PickEntry[] = useMemo(
    () =>
      aggregationParts.map((part) => ({
        value: part.name,
        label: `${part.id}　${part.name}`,
      })),
    [aggregationParts],
  );
  const materialEntries: PickEntry[] = useMemo(
    () =>
      (options?.materialCategories ?? []).map((item) => ({
        value: item.name,
        label: `${item.id}　${item.name}`,
      })),
    [options],
  );
  const numberEntries: PickEntry[] = useMemo(
    () =>
      numberOptions.map((item) => ({
        value: item.detailNumber?.toFixed(2) ?? "",
        label: `${item.partName} ${item.name} ${item.descriptionLower}`.trim(),
      })),
    [numberOptions],
  );
  const unitEntries: PickEntry[] = useMemo(
    () =>
      (options?.units ?? []).map((unit) => ({
        value: unit.name,
        label: `${unit.id}　${unit.name}`,
      })),
    [options],
  );

  /** 入力の変更（履歴に残す） */
  const commit = useCallback(
    (next: CalcSet[]): void => {
      setPast((rows) => [...rows.slice(-49), sets]);
      setFuture([]);
      onChange(next);
    },
    [onChange, sets],
  );

  const undo = useCallback((): void => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((rows) => rows.slice(0, -1));
    setFuture((rows) => [...rows, sets]);
    onChange(previous);
  }, [onChange, past, sets]);

  const redo = useCallback((): void => {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    setFuture((rows) => rows.slice(0, -1));
    setPast((rows) => [...rows, sets]);
    onChange(next);
  }, [future, onChange, sets]);

  // 明細入力を別画面（独立したウィンドウ）で開いている間は、ここには案内だけを出す
  const [inOtherWindow, setInOtherWindow] = useState(false);
  /** 別画面から最後に受け取った入力の版 */
  const calcRev = useRef(0);

  useEffect(() => {
    if (!inOtherWindow) return;
    const state = {
      title: windowTitle ?? "セット明細計算表",
      projectId,
      hasUpper,
      variables,
      result,
      sets,
      echo: calcRev.current,
    };
    void window.sekisan.pushCalcWindow(state);
    const offReady = window.sekisan.onCalcWindowReady(() => {
      void window.sekisan.pushCalcWindow(state);
    });
    return offReady;
  }, [
    hasUpper,
    inOtherWindow,
    projectId,
    result,
    sets,
    variables,
    windowTitle,
  ]);

  useEffect(() => {
    if (!inOtherWindow) return;
    const offInput = window.sekisan.onCalcWindowInput((input) => {
      calcRev.current = input.rev;
      onChange(input.sets);
      onFocus(input.focus);
    });
    const offClosed = window.sekisan.onCalcWindowClosed(() =>
      setInOtherWindow(false),
    );
    return () => {
      offInput();
      offClosed();
    };
  }, [inOtherWindow, onChange, onFocus]);

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
        source === "project"
          ? await window.sekisan.listProjectDetailsInUse(subjectId, projectId)
          : await window.sekisan.listDetails(subjectId, projectId),
      );
    })();
  }, [callOpen, projectId, source, subjectId]);

  // 呼出先や科目を変えたら、セットを選ぶ画面は閉じる
  useEffect(() => {
    setPickGroup([]);
  }, [callOpen, source, subjectId]);

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

  // 保存済みのデータで明細に対して計算式行が足りない場合に足す
  useEffect(() => {
    const short = sets.some((set) => set.lines.length < set.details.length);
    if (!short) return;
    onChange(
      sets.map((set) => ({ ...set, lines: padLines(set.details, set.lines) })),
    );
  }, [onChange, sets]);

  /** セットを書き換える（明細の数に計算式行を合わせてから反映する） */
  const updateSet = useCallback(
    (setId: string, patch: Partial<CalcSet>): void =>
      commit(
        sets.map((set) => {
          if (set.id !== setId) return set;
          const next = { ...set, ...patch };
          return { ...next, lines: padLines(next.details, next.lines) };
        }),
      ),
    [commit, sets],
  );

  /** 明細1件の一部を書き換える */
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
   * 部位欄の入力。セットの先頭の行なら、そのセットの部位を変える。
   * 途中の行に入れると、その行から下を別のセットに分ける（空にすると上のセットにつなげる）。
   */
  const commitSetPart = useCallback(
    (setId: string, rowIndex: number, text: string): void => {
      const picked = pickMaster(aggregationParts, text);
      if (rowIndex === 0) {
        const at = sets.findIndex((set) => set.id === setId);
        if (picked.name === "" && at > 0) {
          commit(mergeWithPreviousSet(sets, setId));
          return;
        }
        updateSet(setId, { partNumber: picked.id, partName: picked.name });
        return;
      }
      if (picked.name === "") return;
      commit(
        splitSetAt(sets, setId, rowIndex, {
          partNumber: picked.id,
          partName: picked.name,
        }),
      );
      onMessage("この行から別のセット明細に分けました");
    },
    [aggregationParts, commit, onMessage, sets, updateSet],
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
          const hits = list.filter(
            (item) =>
              item.detailNumber !== null &&
              Math.abs(item.detailNumber - number) < 0.005,
          );
          if (hits.length === 0) continue;
          // 同じ明細番号が複数あるときは、今入っている部位と同じ明細を選ぶ
          const part = row.partName.trim();
          found =
            (part === ""
              ? undefined
              : hits.find((item) => item.partName.trim() === part)) ?? hits[0];
          break;
        }
        if (found) break;
      }
      if (!found) {
        onMessage(`明細番号 ${value} の明細が見つかりません`);
        return;
      }
      // 先に入れてある部位は書き換えない（空欄のときだけマスターの部位を入れる）
      const keepPart = row.partNumber !== null || row.partName.trim() !== "";
      updateDetail(setId, index, {
        sourceDetailId: found.id,
        subjectId: found.subjectId,
        detailNumber: found.detailNumber,
        materialCategory: found.materialCategory || row.materialCategory,
        partNumber: keepPart
          ? row.partNumber
          : (pickupParts.find((part) => part.name === found.partName)?.id ??
            null),
        partName: keepPart ? row.partName : found.partName,
        name: found.name,
        descriptionUpper: found.descriptionUpper,
        descriptionLower: found.descriptionLower,
        unit: found.unit || row.unit,
        remarksUpper: found.remarksUpper,
        remarksLower: found.remarksLower,
        estimateDisplay: found.estimateDisplay,
      });
      onMessage(`${found.name} を呼び出しました`);
    },
    [onMessage, pickupParts, projectId, sets, subjects, updateDetail],
  );

  /** セットの中の明細を1件だけ削除する（他の明細と計算式は残す） */
  const removeDetail = useCallback(
    (setId: string, index: number): void => {
      const target = sets.find((set) => set.id === setId);
      if (!target) return;
      const next = removeSetDetail(target, index);
      updateSet(setId, { details: next.details, lines: next.lines });
      onFocus(null);
    },
    [onFocus, sets, updateSet],
  );

  /** 明細の無い行に空の明細を用意して、名称や摘要を入れられるようにする */
  const openDetail = useCallback(
    (setId: string, index: number): void => {
      const target = sets.find((set) => set.id === setId);
      if (!target) return;
      const next = openSetDetail(target, index);
      updateSet(setId, { details: next.details, lines: next.lines });
      onFocus({ setId, area: "detail", index });
    },
    [onFocus, sets, updateSet],
  );

  /** 明細の無い計算式だけの行を消す（入力も削除もできない行が残らないように） */
  const removeLine = useCallback(
    (setId: string, index: number): void => {
      const target = sets.find((set) => set.id === setId);
      if (!target) return;
      updateSet(setId, { lines: removeSetLine(target, index).lines });
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
      const next = moveSetDetail(target, index, step);
      updateSet(setId, { details: next.details, lines: next.lines });
      onFocus({ setId, area: "detail", index: to });
    },
    [onFocus, sets, updateSet],
  );

  // 明細・計算式の欄へカーソルを移したら、コメント行のカーソルは外す
  useEffect(() => {
    setBannerSetId(null);
  }, [focus?.setId, focus?.area, focus?.index]);

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
      // 上書きする行に先に入れてある部位・区分・単位は、マスターが空欄なら残す
      const at0 =
        focus && focus.setId === target?.id && focus.area === "detail"
          ? focus.index
          : -1;
      const kept =
        !insertMode && at0 >= 0 ? (target?.details[at0] ?? null) : null;
      const item = calcDetail({
        sourceDetailId: detail.id,
        subjectId: detail.subjectId,
        detailNumber: detail.detailNumber,
        materialCategory:
          detail.materialCategory || (kept?.materialCategory ?? ""),
        partNumber:
          detail.partName.trim() === ""
            ? (kept?.partNumber ?? null)
            : (detail.partNumber ??
              pickupParts.find((part) => part.name === detail.partName)?.id ??
              null),
        partName: detail.partName || (kept?.partName ?? ""),
        name: detail.name,
        descriptionUpper: detail.descriptionUpper,
        descriptionLower: detail.descriptionLower,
        unit: detail.unit || (kept?.unit ?? ""),
        remarksUpper: detail.remarksUpper,
        remarksLower: detail.remarksLower,
        estimateDisplay: detail.estimateDisplay,
      });
      // ※行にカーソルがあるときは、その※行の下に新しいセットとして入れる
      const bannerAt =
        bannerSetId === null
          ? -1
          : sets.findIndex((set) => set.id === bannerSetId);
      if (bannerAt >= 0 && isCommentSet(sets[bannerAt])) {
        const created = calcSet(1);
        created.details = [item];
        const next2 = [...sets];
        next2.splice(bannerAt + 1, 0, created);
        commit(next2);
        onFocus({ setId: created.id, area: "detail", index: 0 });
        onMessage(`${detail.name} を呼び出しました`);
        return;
      }
      // 呼び出し先のセットが無い（消えている）ときは、末尾に1セット作って入れる
      if (!target || !sets.some((set) => set.id === target.id)) {
        const created = calcSet(1);
        created.details = [item];
        commit([...sets, created]);
        onFocus({ setId: created.id, area: "detail", index: 0 });
        onMessage(`${detail.name} を呼び出しました`);
        return;
      }
      const at =
        focus && focus.setId === target.id && focus.area === "detail"
          ? focus.index
          : target.details.findIndex((row) => row.name.trim() === "");
      const details2 = [...target.details];
      let next = 0;
      if (insertMode || at < 0 || at >= details2.length) {
        const position = at < 0 ? details2.length : at;
        details2.splice(position, 0, item);
        next = position + 1;
      } else {
        details2[at] = item;
        next = at + 1;
      }
      updateSet(target.id, { details: details2 });
      onFocus({ setId: target.id, area: "detail", index: next });
      onMessage(`${detail.name} を呼び出しました`);
    },
    [
      bannerSetId,
      commit,
      currentSet,
      focus,
      insertMode,
      onFocus,
      onMessage,
      pickupParts,
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
          partNumber: item.partNumber ?? null,
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
      const bannerAt =
        bannerSetId === null
          ? -1
          : sets.findIndex((set) => set.id === bannerSetId);
      const next = [...sets];
      // ※行にカーソルがあるときは、その※行の下へ新しいセットとして入れる
      if (bannerAt >= 0 && isCommentSet(sets[bannerAt])) {
        next.splice(bannerAt + 1, 0, created);
        commit(next);
        onFocus({ setId: created.id, area: "detail", index: 0 });
        onMessage(
          `${assembly.items[0]?.name ?? "セット明細"} を呼び出しました`,
        );
        return;
      }
      const at = sets.findIndex((set) => set.id === currentSet?.id);
      if (insertMode || at < 0 || isCommentSet(sets[at])) {
        // ※行の上に入れる（※行そのものは上書きしない）
        next.splice(at < 0 ? next.length : at, 0, created);
      } else {
        // 上書きは元のセット1つ分を丸ごと置き換える（計算式と※行は残す）
        created.lines = syncLines(created.details, sets[at].lines);
        created.banner = sets[at].banner ?? null;
        next[at] = created;
      }
      commit(next);
      onFocus({ setId: created.id, area: "detail", index: 0 });
      onMessage(
        `${assembly.items[0]?.name ?? "セット明細"} を${insertMode ? "挿入" : "上書き"}呼出しました`,
      );
    },
    [bannerSetId, commit, currentSet?.id, insertMode, onFocus, onMessage, sets],
  );

  /** カーソルの位置で判断して行を足す（明細欄なら明細、計算式欄なら計算行） */
  const addRow = useCallback(
    (insert: boolean) => {
      // コメント行にカーソルがあるとき。行挿入はその行の上、行追加はその行の下
      const bannerAt =
        bannerSetId === null
          ? -1
          : sets.findIndex((set) => set.id === bannerSetId);
      if (bannerAt >= 0) {
        const next = [...sets];
        next.splice(insert ? bannerAt : bannerAt + 1, 0, calcSet());
        commit(next);
        return;
      }
      const target = currentSet;
      if (!target) {
        commit([...sets, calcSet()]);
        return;
      }
      // カーソルのある欄だけに行を入れる（明細を差し込んでも計算式はずれない）
      const at = insert ? (focus?.index ?? 0) : undefined;
      const next =
        focus === null
          ? addSetRow(target, at)
          : focus.area === "detail"
            ? addSetDetailRow(target, at)
            : addSetLineRow(target, at);
      updateSet(target.id, { details: next.details, lines: next.lines });
    },
    [bannerSetId, commit, currentSet, focus, sets, updateSet],
  );

  /** コメント行を入れる（明細とは別の独立した1行。何行でも続けて入れられる） */
  const insertBanner = useCallback(
    (color: string) => {
      setBannerOpen(false);
      // カーソルの行の上へ入れる（※行にカーソルがあれば※行だけを続けて並べられる）
      const bannerAt =
        bannerSetId === null
          ? -1
          : sets.findIndex((set) => set.id === bannerSetId);
      const at =
        bannerAt >= 0
          ? bannerAt
          : sets.findIndex((set) => set.id === currentSet?.id);
      const created = commentSet("", color);
      const next = [...sets];
      next.splice(at < 0 ? next.length : at, 0, created);
      commit(next);
      setBannerSetId(created.id);
      onMessage("コメント行を入れました");
    },
    [bannerSetId, commit, currentSet?.id, onMessage, sets],
  );

  /** いま選んでいる明細（明細欄にカーソルがあるときだけ） */
  const currentDetail = useMemo(() => {
    if (!focus || focus.area !== "detail" || !currentSet) return null;
    return currentSet.details[focus.index] ?? null;
  }, [currentSet, focus]);

  /** 1行コピー（カーソルの明細1件）。Excelへも貼れるようTSVにする */
  const copyRow = useCallback(async () => {
    if (!currentDetail) {
      onMessage("コピーする明細の欄を選んでください");
      return;
    }
    const text = detailAsTsv(currentDetail);
    await navigator.clipboard.writeText(text);
    setCalcClip({ kind: "detail", text, detail: currentDetail });
    onMessage(
      `明細「${currentDetail.name || "（名称なし）"}」をコピーしました`,
    );
  }, [currentDetail, onMessage]);

  /** 表の行を上から順に並べたもの（Shift+クリックの範囲を数えるため） */
  const flatRows = useMemo(() => {
    const list: { setId: string; index: number }[] = [];
    sets.forEach((set) => {
      for (let index = 0; index < setRowCount(set); index += 1) {
        list.push({ setId: set.id, index });
      }
    });
    return list;
  }, [sets]);

  // Shift+クリック以外でカーソルが動いたら、範囲の先頭もそこへ合わせる
  useEffect(() => {
    if (shiftClicking.current) return;
    setRangeStart(focus ? { setId: focus.setId, index: focus.index } : null);
    setRangeEnd(null);
  }, [focus]);

  /** カーソルの行から Shift+クリックした行までの範囲（通し番号） */
  const rangeRows = useMemo(() => {
    const start = rangeStart ?? focus;
    if (!start || !rangeEnd) return [];
    const from = flatRows.findIndex(
      (row) => row.setId === start.setId && row.index === start.index,
    );
    const to = flatRows.findIndex(
      (row) => row.setId === rangeEnd.setId && row.index === rangeEnd.index,
    );
    if (from < 0 || to < 0) return [];
    return flatRows.slice(Math.min(from, to), Math.max(from, to) + 1);
  }, [flatRows, focus, rangeEnd, rangeStart]);

  /** 選んでいる行かどうか（背景色をつける） */
  const isSelectedRow = useCallback(
    (setId: string, index: number): boolean =>
      rangeRows.some((row) => row.setId === setId && row.index === index),
    [rangeRows],
  );

  /** 複数行コピー（Shift+クリックで選んだ範囲の行を明細・計算式ごと） */
  const copyRows = useCallback(async () => {
    if (rangeRows.length === 0) {
      onMessage(
        "コピーする先頭の行にカーソルを置き、最後の行を Shift+クリックしてください",
      );
      return;
    }
    const details: CalcDetail[] = [];
    const lines: CalcLine[] = [];
    rangeRows.forEach((row) => {
      const set = sets.find((item) => item.id === row.setId);
      if (!set) return;
      details.push(set.details[row.index] ?? calcDetail());
      lines.push(set.lines[row.index] ?? calcLine());
    });
    const source = sets.find((item) => item.id === rangeRows[0].setId);
    const text = rowsAsTsv(details, lines);
    await navigator.clipboard.writeText(text);
    setCalcClip({
      kind: "rows",
      text,
      details,
      lines,
      partNumber: source?.partNumber ?? null,
      partName: source?.partName ?? "",
    });
    onMessage(
      `${rangeRows.length}行をコピーしました（貼り付けたい行にカーソルを置いて上書貼付／挿入貼付）`,
    );
  }, [onMessage, rangeRows, sets]);

  /**
   * 貼り付け。この画面でコピーしたセット・明細ならそのまま写し、
   * Excelなど他から持ってきた表なら、カーソルの欄（明細／計算式）へ取り込む。
   * mode が insert なら差し込み、overwrite ならその位置に上書きする。
   */
  const paste = useCallback(
    async (mode: "overwrite" | "insert") => {
      const text = await navigator.clipboard.readText();
      if (text.trim() === "") return;
      const clip = getCalcClip(text);
      // コメント行（※行）にカーソルがあるときは、その行が貼り付け先
      const bannerAt =
        bannerSetId === null
          ? -1
          : sets.findIndex((set) => set.id === bannerSetId);

      if (clip?.kind === "set") {
        const created = duplicateSet(clip.set);
        const at =
          bannerAt >= 0
            ? bannerAt
            : sets.findIndex((set) => set.id === currentSet?.id);
        const next = [...sets];
        if (
          mode === "overwrite" &&
          at >= 0 &&
          bannerAt < 0 &&
          !isCommentSet(sets[at])
        )
          // 上書きしても、そのセットに付いている※行は残す
          next[at] = { ...created, banner: sets[at].banner ?? null };
        else next.splice(at < 0 ? next.length : at, 0, created);
        commit(next);
        onFocus({ setId: created.id, area: "detail", index: 0 });
        onMessage(
          mode === "overwrite"
            ? "コピーしたセットで上書きしました"
            : "コピーしたセットを差し込みました",
        );
        return;
      }

      if (bannerAt >= 0 && (clip?.kind === "detail" || clip?.kind === "rows")) {
        // コメント行の上へ、コピーした行を新しいセットとして差し込む
        const copiedDetails =
          clip.kind === "detail"
            ? [duplicateDetail(clip.detail)]
            : clip.details.map(duplicateDetail);
        const copiedLines =
          clip.kind === "rows" ? clip.lines.map(duplicateLine) : [];
        const created: CalcSet = {
          ...calcSet(0),
          // 写し元のセットの部位も一緒に写す
          partNumber: clip.kind === "rows" ? clip.partNumber : null,
          partName: clip.kind === "rows" ? clip.partName : "",
          details: copiedDetails,
          lines: fillLines(copiedDetails, copiedLines),
        };
        const next = [...sets];
        next.splice(bannerAt, 0, created);
        commit(next);
        onFocus({ setId: created.id, area: "detail", index: 0 });
        onMessage(
          `コピーした${copiedDetails.length}行をコメント行の上へ差し込みました`,
        );
        return;
      }

      if (!currentSet) {
        onMessage("貼り付ける場所を選んでください");
        return;
      }

      if (clip?.kind === "detail" || clip?.kind === "rows") {
        // カーソルのある行が貼り付け先。上書貼付はその行から、挿入貼付はその行の上へ
        const copiedDetails =
          clip.kind === "detail"
            ? [duplicateDetail(clip.detail)]
            : clip.details.map(duplicateDetail);
        const copiedLines =
          clip.kind === "rows" ? clip.lines.map(duplicateLine) : [];
        const details = [...currentSet.details];
        const lines = [...currentSet.lines];
        // 計算式の欄にカーソルがあるときも、その行が貼り付け先（明細1件＝計算式1行）
        const cursor = focus ? focus.index : details.length - 1;
        const at =
          mode === "overwrite"
            ? Math.max(cursor, 0)
            : Math.min(Math.max(cursor, 0), details.length);

        copiedDetails.forEach((copied, offset) => {
          const line = copiedLines[offset];
          if (mode === "overwrite") {
            const index = at + offset;
            if (index < details.length) details[index] = copied;
            else details.push(copied);
            if (line) {
              if (index < lines.length) lines[index] = line;
              else lines.push(line);
            }
          } else {
            details.splice(at + offset, 0, copied);
            lines.splice(at + offset, 0, line ?? calcLine());
          }
        });

        // 貼り付け先のセットに部位が入っていなければ、写し元の部位を入れる
        const emptyPart =
          currentSet.partNumber === null && currentSet.partName.trim() === "";
        updateSet(currentSet.id, {
          details,
          lines: fillLines(details, lines),
          ...(clip.kind === "rows" && emptyPart
            ? { partNumber: clip.partNumber, partName: clip.partName }
            : {}),
        });
        onMessage(
          mode === "overwrite"
            ? `コピーした${copiedDetails.length}行でカーソルの行から上書きしました`
            : `コピーした${copiedDetails.length}行をカーソルの行の上へ差し込みました`,
        );
        return;
      }

      if (focus?.area === "detail") {
        const at = focus.index;
        const base =
          mode === "insert"
            ? [
                ...currentSet.details.slice(0, at),
                ...Array.from(
                  {
                    length: (text.split(/\r?\n/).filter(Boolean) ?? []).length,
                  },
                  () => calcDetail(),
                ),
                ...currentSet.details.slice(at),
              ]
            : currentSet.details;
        const baseLines =
          mode === "insert"
            ? [
                ...currentSet.lines.slice(0, at),
                ...Array.from(
                  {
                    length: base.length - currentSet.details.length,
                  },
                  () => calcLine(),
                ),
                ...currentSet.lines.slice(at),
              ]
            : currentSet.lines;
        const pasted = pasteRows(base, baseLines, at, text);
        updateSet(currentSet.id, {
          details: pasted.details,
          lines: fillLines(pasted.details, pasted.lines),
        });
        onMessage(
          "Excelの表を明細へ貼り付けました（部位名／名称／摘要（上）／摘要（下）／単位／掛け率／備考（上）／備考（下）／積算用表示の順。後ろにコメント／計算式Ａ／計算式Ｂがあれば計算式へも入ります）",
        );
        return;
      }

      const lines = pasteLines(currentSet.lines, focus?.index ?? 0, text);
      updateSet(currentSet.id, { lines });
      onMessage(
        "Excelの数量表を計算式へ貼り付けました（コメント／計算式Ａ／計算式Ｂの順。1列だけなら計算式Ａ）",
      );
    },
    [
      bannerSetId,
      commit,
      currentSet,
      focus,
      onFocus,
      onMessage,
      sets,
      updateSet,
    ],
  );

  /** Enter・矢印キーで隣の欄へ移る（表の中を行き来する） */
  const moveFocus = useCallback(
    (row: number, col: number, stepRow: number, stepCol: number): void => {
      const root = gridRef.current;
      if (!root) return;
      const cells = Array.from(
        root.querySelectorAll<HTMLInputElement>("input[data-row][data-col]"),
      );
      const at = (r: number, c: number): HTMLInputElement | undefined =>
        cells.find(
          (cell) =>
            Number(cell.dataset.row) === r && Number(cell.dataset.col) === c,
        );
      if (stepRow !== 0) {
        for (let r = row + stepRow; r >= 0 && r <= 9999; r += stepRow) {
          const found = at(r, col);
          if (found) {
            found.focus();
            found.select();
            return;
          }
          if (!cells.some((cell) => Number(cell.dataset.row) === r)) return;
        }
        return;
      }
      const sameRow = cells
        .filter((cell) => Number(cell.dataset.row) === row)
        .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
      const next =
        stepCol > 0
          ? sameRow.find((cell) => Number(cell.dataset.col) > col)
          : [...sameRow]
              .reverse()
              .find((cell) => Number(cell.dataset.col) < col);
      if (next) {
        next.focus();
        next.select();
        return;
      }
      // 行の端では、次（前）の行の先頭（末尾）へ移る
      const otherRow = cells
        .filter(
          (cell) => Number(cell.dataset.row) === row + (stepCol > 0 ? 1 : -1),
        )
        .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
      const edge = stepCol > 0 ? otherRow[0] : otherRow[otherRow.length - 1];
      edge?.focus();
      edge?.select();
    },
    [],
  );

  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      const row = Number(el.dataset.row);
      const col = Number(el.dataset.col);
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        moveFocus(row, col, 0, 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveFocus(row, col, -1, 0);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveFocus(row, col, 1, 0);
      } else if (
        e.key === "ArrowLeft" &&
        el.selectionStart === 0 &&
        el.selectionEnd === 0
      ) {
        e.preventDefault();
        moveFocus(row, col, 0, -1);
      } else if (
        e.key === "ArrowRight" &&
        el.selectionStart === el.value.length &&
        el.selectionEnd === el.value.length
      ) {
        e.preventDefault();
        moveFocus(row, col, 0, 1);
      }
    },
    [moveFocus],
  );

  /** セットごとの表示開始行（キー移動のための通し番号） */
  const rowStarts = useMemo(() => {
    const starts: number[] = [];
    let total = 0;
    sets.forEach((set) => {
      starts.push(total);
      total += setRowCount(set);
    });
    return starts;
  }, [sets]);

  if (inOtherWindow)
    return (
      <div className="room-calc-sheet in-other-window">
        <div className="section-bar">
          <span>セット明細計算表は別画面で開いています</span>
          <button
            type="button"
            title="別画面を前へ出します"
            onClick={() =>
              void window.sekisan.openCalcWindow(
                windowTitle ?? "セット明細計算表",
              )
            }
          >
            ⌷ 別画面を前へ
          </button>
        </div>
        <p className="note">
          別画面で入力した内容はこの画面にそのまま入ります（保存はこの画面の「保存」です）。
          別画面を閉じると、ここに表が戻ります。
        </p>
      </div>
    );

  return (
    <div
      className="room-calc-sheet"
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
          // Shift+クリックで範囲を選んでいればその範囲、無ければカーソルの1行
          void (rangeRows.length > 0 ? copyRows() : copyRow());
        } else if (e.key === "v") {
          e.preventDefault();
          void paste("overwrite");
        } else if (e.key === "z") {
          e.preventDefault();
          undo();
        } else if (e.key === "y") {
          e.preventDefault();
          redo();
        }
      }}
    >
      <div className="section-bar">
        {inWindow && (
          <button
            type="button"
            title="このウィンドウを閉じて、元の画面で入力します"
            onClick={() => void window.sekisan.closeWindow()}
          >
            ✕ このウィンドウを閉じる
          </button>
        )}
        {!inWindow && (
          <button
            type="button"
            title="明細入力だけを独立したウィンドウで開きます（図や寸法を見ながら入力できます）"
            onClick={() => {
              void window.sekisan.openCalcWindow(
                windowTitle ?? "セット明細計算表",
              );
              setInOtherWindow(true);
            }}
          >
            ⧉ 別画面で開く
          </button>
        )}
        <button
          type="button"
          title="直前の入力を元に戻します（Ctrl+Z）"
          disabled={past.length === 0}
          onClick={undo}
        >
          ↶ 戻る
        </button>
        <button
          type="button"
          title="元に戻した入力をやり直します（Ctrl+Y）"
          disabled={future.length === 0}
          onClick={redo}
        >
          ↷ 進む
        </button>
        <span className="banner-menu">
          <button
            type="button"
            className={bannerOpen ? "on" : ""}
            title="カーソルの行の上に、色の付いたコメント行を1行入れます（何行でも続けて入れられます）"
            onClick={() => setBannerOpen(!bannerOpen)}
          >
            ※ 行挿入
          </button>
          {bannerOpen && (
            <span className="banner-colors">
              {BANNER_COLORS.map((item) => (
                <button
                  key={item.color}
                  type="button"
                  title={`${item.label}で見出し行を入れます`}
                  style={{ background: item.color }}
                  onClick={() => insertBanner(item.color)}
                >
                  {item.label}
                </button>
              ))}
            </span>
          )}
        </span>
        <button type="button" onClick={() => commit([...sets, calcSet(1)])}>
          ＋ 明細（1明細）
        </button>
        <button type="button" onClick={() => addRow(false)}>
          ＋ 行追加
        </button>
        <button type="button" onClick={() => addRow(true)}>
          ↥ 行挿入
        </button>
        <button
          type="button"
          title="カーソルのある明細1件をコピーします（Ctrl+C）"
          onClick={() => void copyRow()}
        >
          ⧉ 1行コピー
        </button>
        <button
          type="button"
          title="先頭の行にカーソルを置き、最後の行を Shift+クリックしてから押すと、その範囲の行（明細と計算式）をコピーします"
          onClick={() => void copyRows()}
        >
          ⧉ 複数行コピー
        </button>
        <button
          type="button"
          title="カーソルのある行から上書きします（Ctrl+V）"
          onClick={() => void paste("overwrite")}
        >
          📋 上書貼付
        </button>
        <button
          type="button"
          title="カーソルのある行の下へ差し込みます"
          onClick={() => void paste("insert")}
        >
          📋 挿入貼付
        </button>
        <button
          type="button"
          className={callOpen ? "on" : ""}
          onClick={() => setCallOpen(!callOpen)}
        >
          📂 マスター呼出
        </button>
        <span className="hint">
          {hasUpper
            ? "記号は上段の表をクリックすると計算式へ入ります"
            : "建具記号は建具表から直接引用します（例 <SD2>）"}
        </span>
      </div>

      <div className="calc-body" ref={gridRef} onKeyDown={onGridKeyDown}>
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
                    title="ドラッグで列幅を変えられます（全物件で共通です）"
                    onMouseDown={(e) => startResize(index, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          {sets.map((set, setIndex) => {
            const rowCount = setRowCount(set);
            // 記号は行ごとではなくセット全体で1つ（先頭の計算式行に持たせる）
            const setSymbol =
              set.lines.find((row) => row.bSymbol.trim() !== "")?.bSymbol ?? "";
            const setTotal = result.setTotals.get(set.id) ?? null;
            return (
              <tbody key={set.id} className="set">
                {set.banner && (
                  <tr className="banner-row">
                    <td
                      colSpan={CALC_COLUMNS.length}
                      style={{ background: set.banner.color }}
                    >
                      <input
                        lang="ja"
                        value={set.banner.text}
                        onFocus={() => setBannerSetId(set.id)}
                        onChange={(e) =>
                          updateSet(set.id, {
                            banner: {
                              text: e.target.value,
                              color: set.banner?.color ?? "#e2e8f0",
                            },
                          })
                        }
                      />
                      <button
                        type="button"
                        title="このコメント行を消します"
                        onClick={() =>
                          isCommentSet(set)
                            ? commit(removeSet(sets, set.id))
                            : updateSet(set.id, { banner: null })
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )}
                {Array.from({ length: rowCount }, (_, rowIndex) => {
                  const detail = set.details[rowIndex];
                  const line = set.lines[rowIndex];
                  const lineResult = line
                    ? result.lines.get(line.id)
                    : undefined;
                  const gridRow = rowStarts[setIndex] + rowIndex;
                  const focusDetail = (): void =>
                    onFocus({
                      setId: set.id,
                      area: "detail",
                      index: rowIndex,
                    });
                  return (
                    <tr
                      // 行の目印は行番号ではなくIDにする（行を差し込んでも入力中の欄がずれない）
                      key={`${set.id}-${detail?.id ?? line?.id ?? `r${rowIndex}`}`}
                      className={
                        isSelectedRow(set.id, rowIndex) ? "row-selected" : ""
                      }
                      onMouseDownCapture={(e) => {
                        shiftClicking.current = e.shiftKey;
                      }}
                      onClick={(e) => {
                        // Shift+クリックで範囲の終わりを決める。ふつうのクリックは選び直し
                        if (e.shiftKey) {
                          setRangeEnd({ setId: set.id, index: rowIndex });
                        } else {
                          setRangeStart({ setId: set.id, index: rowIndex });
                          setRangeEnd(null);
                        }
                        shiftClicking.current = false;
                      }}
                    >
                      <td className="set-part">
                        <PickInput
                          row={gridRow}
                          col={0}
                          entries={aggregationPartEntries}
                          japanese
                          commitOnBlur
                          value={rowIndex === 0 ? set.partName : ""}
                          title="管理用部位。番号を打つと名称に変わります。途中の行に入れると、その行から別のセットになります"
                          onCommit={(text) =>
                            commitSetPart(set.id, rowIndex, text)
                          }
                        />
                      </td>
                      {detail ? (
                        <>
                          <td className="material">
                            <PickInput
                              row={gridRow}
                              col={1}
                              entries={materialEntries}
                              japanese
                              value={detail.materialCategory}
                              title="材種区分。番号を打つと名称に変わります"
                              onFocus={focusDetail}
                              onCommit={(text) =>
                                updateDetail(set.id, rowIndex, {
                                  materialCategory: resolveMasterName(
                                    (options?.materialCategories ?? []).map(
                                      (item) => ({
                                        id: item.id,
                                        name: item.name,
                                      }),
                                    ),
                                    text,
                                  ),
                                })
                              }
                            />
                          </td>
                          <td className="id">
                            <PickInput
                              row={gridRow}
                              col={2}
                              entries={subjectEntries}
                              value={
                                detail.subjectId === null
                                  ? ""
                                  : String(detail.subjectId)
                              }
                              title={
                                subjects.find(
                                  (item) => item.id === detail.subjectId,
                                )?.name ?? "工種科目のID（一覧から選べます）"
                              }
                              onFocus={focusDetail}
                              onCommit={(text) => {
                                const id = Number.parseInt(text.trim(), 10);
                                updateDetail(set.id, rowIndex, {
                                  subjectId: Number.isNaN(id) ? null : id,
                                });
                              }}
                            />
                          </td>
                          <td className="id">
                            <PickInput
                              row={gridRow}
                              col={3}
                              entries={pickupPartEntries}
                              value={
                                detail.partNumber === null
                                  ? ""
                                  : String(detail.partNumber)
                              }
                              title="明細用部位のID。入れると右の部位名にマスターの文字が入ります"
                              onFocus={focusDetail}
                              onCommit={(text) => {
                                const picked = pickMaster(pickupParts, text);
                                updateDetail(set.id, rowIndex, {
                                  partNumber: picked.id,
                                  partName:
                                    picked.id === null
                                      ? detail.partName
                                      : picked.name,
                                });
                              }}
                            />
                          </td>
                          <td className="id">
                            <PickInput
                              row={gridRow}
                              col={4}
                              entries={numberEntries}
                              commitOnBlur
                              value={detail.detailNumber?.toFixed(2) ?? ""}
                              title="明細番号を入れるとマスターの明細を呼び出します（科目IDを入れると一覧から選べます）"
                              onFocus={() => {
                                focusDetail();
                                void loadNumberOptions(detail.subjectId);
                              }}
                              onCommit={(text) => {
                                if (
                                  text.trim() ===
                                  (detail.detailNumber?.toFixed(2) ?? "")
                                )
                                  return;
                                void applyDetailNumber(set.id, rowIndex, text);
                              }}
                            />
                          </td>
                          <td>
                            <input
                              lang="ja"
                              data-row={gridRow}
                              data-col={5}
                              value={detail.partName}
                              onFocus={focusDetail}
                              onChange={(e) =>
                                updateDetail(set.id, rowIndex, {
                                  partName: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              lang="ja"
                              data-row={gridRow}
                              data-col={6}
                              value={detail.name}
                              onFocus={focusDetail}
                              onChange={(e) =>
                                updateDetail(set.id, rowIndex, {
                                  name: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              lang="ja"
                              data-row={gridRow}
                              data-col={7}
                              value={detail.descriptionLower}
                              onFocus={focusDetail}
                              onChange={(e) =>
                                updateDetail(set.id, rowIndex, {
                                  descriptionLower: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              lang="ja"
                              data-row={gridRow}
                              data-col={8}
                              value={detail.descriptionUpper}
                              onFocus={focusDetail}
                              onChange={(e) =>
                                updateDetail(set.id, rowIndex, {
                                  descriptionUpper: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="unit">
                            <PickInput
                              row={gridRow}
                              col={9}
                              entries={unitEntries}
                              value={detail.unit}
                              title="単位。番号を打つと単位の文字に変わります"
                              onFocus={focusDetail}
                              onCommit={(text) =>
                                updateDetail(set.id, rowIndex, {
                                  unit: resolveMasterName(
                                    (options?.units ?? []).map((unit) => ({
                                      id: unit.id,
                                      name: unit.name,
                                    })),
                                    text,
                                  ),
                                })
                              }
                            />
                          </td>
                          <td className="coef">
                            <input
                              key={detail.id}
                              className="num"
                              data-row={gridRow}
                              data-col={10}
                              defaultValue={String(detail.coefficient)}
                              title="集計時にこの掛け率を掛けます（最大9999.99）"
                              onFocus={focusDetail}
                              onBlur={(e) => {
                                const value = Number(e.target.value);
                                if (!Number.isFinite(value)) return;
                                const limited = Math.min(
                                  Math.max(value, -9999.99),
                                  9999.99,
                                );
                                updateDetail(set.id, rowIndex, {
                                  coefficient: limited,
                                });
                              }}
                            />
                          </td>
                          <td className="num total">
                            {setTotal !== null
                              ? displayQuantity(
                                  displayedValue(
                                    setTotal * (detail.coefficient || 1),
                                  ),
                                )
                              : ""}
                          </td>
                        </>
                      ) : (
                        <td className="empty" colSpan={11} />
                      )}
                      {line ? (
                        <>
                          <td className="comment">
                            <input
                              lang="ja"
                              data-row={gridRow}
                              data-col={12}
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
                              data-row={gridRow}
                              data-col={13}
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
                              data-row={gridRow}
                              data-col={14}
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
                          <input
                            value={setSymbol}
                            title="このセットの累計を他のセットで使うための記号（B1〜B99。セットに1つ）"
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
                        </td>
                      )}
                      {detail ? (
                        <>
                          <td>
                            <input
                              lang="ja"
                              data-row={gridRow}
                              data-col={18}
                              value={detail.remarksLower}
                              onFocus={focusDetail}
                              onChange={(e) =>
                                updateDetail(set.id, rowIndex, {
                                  remarksLower: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              lang="ja"
                              data-row={gridRow}
                              data-col={19}
                              value={detail.remarksUpper}
                              onFocus={focusDetail}
                              onChange={(e) =>
                                updateDetail(set.id, rowIndex, {
                                  remarksUpper: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="estimate">
                            <input
                              lang="ja"
                              data-row={gridRow}
                              data-col={20}
                              value={detail.estimateDisplay}
                              title="内訳書へ出すときの表示（明細マスターと同じ欄）"
                              onFocus={focusDetail}
                              onChange={(e) =>
                                updateDetail(set.id, rowIndex, {
                                  estimateDisplay: e.target.value,
                                })
                              }
                            />
                          </td>
                        </>
                      ) : (
                        <td className="empty" colSpan={3} />
                      )}
                      <td className="ops">
                        {detail && (
                          <>
                            <button
                              type="button"
                              title="この明細を1つ上へ移動します"
                              disabled={rowIndex === 0}
                              onClick={() => moveDetail(set.id, rowIndex, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              title="この明細を1つ下へ移動します"
                              disabled={rowIndex === set.details.length - 1}
                              onClick={() => moveDetail(set.id, rowIndex, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              title="この明細1件だけを削除します"
                              onClick={() => removeDetail(set.id, rowIndex)}
                            >
                              ✕
                            </button>
                          </>
                        )}
                        {!detail && line && (
                          <>
                            <button
                              type="button"
                              title="この行に明細（名称・摘要など）を入れられるようにします"
                              onClick={() => openDetail(set.id, rowIndex)}
                            >
                              ＋
                            </button>
                            <button
                              type="button"
                              title="この行を削除します"
                              onClick={() => removeLine(set.id, rowIndex)}
                            >
                              ✕
                            </button>
                          </>
                        )}
                        {rowIndex === 0 && (
                          <button
                            type="button"
                            title="このセット明細をまるごと削除します（コメント行は残ります）"
                            onClick={() => commit(removeSet(sets, set.id))}
                          >
                            🗑
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      {callOpen && (
        <div
          className="call-window"
          style={
            callPos === null
              ? undefined
              : { left: `${callPos.x}px`, top: `${callPos.y}px`, right: "auto" }
          }
        >
          <div
            className="section-bar drag"
            onMouseDown={(e) => {
              if (e.target !== e.currentTarget) return;
              const box = e.currentTarget.parentElement;
              if (!box) return;
              const rect = box.getBoundingClientRect();
              const offsetX = e.clientX - rect.left;
              const offsetY = e.clientY - rect.top;
              const move = (event: MouseEvent): void =>
                setCallPos({
                  x: event.clientX - offsetX,
                  y: event.clientY - offsetY,
                });
              const up = (): void => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
            }}
            title="この見出しをドラッグすると呼出画面を動かせます"
          >
            <span>マスター呼出（見出しをドラッグで移動）</span>
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
          <div className="call-subject">
            <span>工種科目</span>
            <input
              className="num"
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
              <option value="">
                {source === "assembly"
                  ? "（すべての工種科目）"
                  : "（工種科目を選ぶ）"}
              </option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.id}：{subject.name}
                </option>
              ))}
            </select>
            <span className="count">
              {source === "assembly"
                ? `${assemblyGroups.length}件（セット${calledAssemblies.length}）`
                : `${details.length}件`}
            </span>
          </div>
          <div className="call-scroll">
            <table className="call-table">
              <thead>
                <tr>
                  {source === "assembly" && <th className="scope">区分</th>}
                  <th className="no">部位ID</th>
                  <th className="no">番号</th>
                  <th>部位名／名称</th>
                  <th>摘要</th>
                  <th>備考</th>
                  <th className="unit">単位</th>
                  {source === "assembly" && <th className="unit">セット</th>}
                </tr>
              </thead>
              <tbody>
                {source === "assembly"
                  ? assemblyGroups.map((group) => {
                      const assembly = group.list[0];
                      const head = assembly.items[0];
                      // 1行目が同じセットが複数あるときだけ、中身を見て選ぶ
                      const pick = (): void => {
                        if (group.list.length === 1) callAssembly(assembly);
                        else setPickGroup(group.list);
                      };
                      return (
                        <tr
                          key={group.key}
                          tabIndex={0}
                          onDoubleClick={pick}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") pick();
                          }}
                        >
                          <td className="scope">
                            {assembly.scope === "basic" ? "基準" : "工事"}
                          </td>
                          <td className="no">{head?.partNumber ?? ""}</td>
                          <td className="no">
                            {head?.detailNumber?.toFixed(2) ?? ""}
                          </td>
                          <td>
                            <div className="upper">{head?.partName ?? ""}</div>
                            <div className="lower">{head?.name ?? ""}</div>
                          </td>
                          <td>
                            <div className="upper">
                              {head?.descriptionUpper ?? ""}
                            </div>
                            <div className="lower">
                              {head?.descriptionLower ?? ""}
                            </div>
                          </td>
                          <td>
                            <div className="upper">
                              {head?.remarksUpper ?? ""}
                            </div>
                            <div className="lower">
                              {head?.remarksLower ?? ""}
                            </div>
                          </td>
                          <td className="unit">{head?.unit ?? ""}</td>
                          <td className="unit">
                            {group.list.length === 1
                              ? `${assembly.items.length}明細`
                              : `${group.list.length}種類`}
                          </td>
                        </tr>
                      );
                    })
                  : details.map((detail, detailIndex) => (
                      <tr
                        key={`${detail.id}-${detailIndex}`}
                        tabIndex={0}
                        onDoubleClick={() => callDetail(detail)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") callDetail(detail);
                        }}
                      >
                        <td className="no">{detail.partNumber ?? ""}</td>
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
                        <td>
                          <div className="upper">{detail.remarksUpper}</div>
                          <div className="lower">{detail.remarksLower}</div>
                        </td>
                        <td className="unit">{detail.unit}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            選んでダブルクリック（またはEnter）で呼び出します。呼出画面は閉じないので続けて呼び出せます。
          </p>
          {pickGroup.length > 0 && (
            <div className="assembly-pick">
              <div className="section-bar">
                <span>
                  セット明細を選ぶ（どの行をダブルクリックでも構いません）
                </span>
                <button type="button" onClick={() => setPickGroup([])}>
                  ✕ 閉じる
                </button>
              </div>
              <div className="assembly-pick-scroll">
                {pickGroup.map((assembly, groupIndex) => (
                  <table
                    className="call-table"
                    key={`${assembly.scope}-${assembly.id}`}
                  >
                    <thead>
                      <tr>
                        <th colSpan={7}>
                          {groupIndex + 1}．{assembly.items.length}明細のセット
                        </th>
                      </tr>
                      <tr>
                        <th className="no">部位ID</th>
                        <th className="no">番号</th>
                        <th>部位名／名称</th>
                        <th>摘要</th>
                        <th>備考</th>
                        <th className="unit">単位</th>
                        <th className="unit">掛け率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assembly.items.map((item, itemIndex) => (
                        <tr
                          key={`${assembly.id}-${itemIndex}`}
                          tabIndex={0}
                          onDoubleClick={() => {
                            callAssembly(assembly);
                            setPickGroup([]);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            callAssembly(assembly);
                            setPickGroup([]);
                          }}
                        >
                          <td className="no">{item.partNumber ?? ""}</td>
                          <td className="no">
                            {item.detailNumber?.toFixed(2) ?? ""}
                          </td>
                          <td>
                            <div className="upper">{item.partName}</div>
                            <div className="lower">{item.name}</div>
                          </td>
                          <td>
                            <div className="upper">{item.descriptionUpper}</div>
                            <div className="lower">{item.descriptionLower}</div>
                          </td>
                          <td>
                            <div className="upper">{item.remarksUpper}</div>
                            <div className="lower">{item.remarksLower}</div>
                          </td>
                          <td className="unit">{item.unit}</td>
                          <td className="unit">{item.coefficient}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { evaluateCalcSheet };
