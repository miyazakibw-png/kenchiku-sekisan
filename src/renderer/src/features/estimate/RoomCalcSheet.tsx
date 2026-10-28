import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Detail,
  FinishAssembly,
  MasterEntry,
  MasterOptions,
  Subject,
} from "@shared/types";
import { resolveMasterName } from "@shared/masters";
import { pickMaster, resolvePartNumberInput } from "./partNumberInput";
import { BANNER_COLORS, assemblyBandColor } from "./bannerColors";
import type { AssemblyGroup } from "../../../../core/masters/assemblyGroup";
import {
  groupAssembliesByHead,
  hideBasicDuplicates,
} from "../../../../core/masters/assemblyGroup";
import {
  addSetRow,
  calcDetail,
  calcLine,
  calcSet,
  canMoveRowAcross,
  commentSet,
  displayQuantity,
  displayedValue,
  evaluateCalcSheet,
  insertSetBefore,
  isCommentSet,
  mergeWithPreviousSet,
  moveDetailAcrossSets,
  noteNumbersFrom,
  openSetDetail,
  padLines,
  removeSet,
  removeSetLine,
  removeSheetRow,
  removeSheetRows,
  resolveDescriptionMark,
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
  hasLowerContent,
  lowerFromTemplate,
  lowerTemplateFrom,
} from "../../../../core/room/lowerTemplate";
import {
  duplicateDetail,
  duplicateLine,
  duplicateSet,
  cellsAsTsv,
  fillCells,
  fillLines,
  pasteCells,
  pasteLines,
  pasteRows,
  pasteSheet,
  rowsAsTsv,
  rowsToSets,
  type CopiedBanner,
  type CopiedPart,
} from "../../../../core/room/calcClipboard";
import { parseTsv } from "../../../../shared/tsv";
import { sortDetails } from "../../../../core/sort/detailSortKey";
import { getCalcClip, setCalcClip } from "./calcClipboardStore";
import { focusCell } from "../grid/focusCell";
import { writeClipboard } from "../grid/writeClipboard";
import { useColumnWidths } from "../../hooks/useColumnWidths";
import PickInput, { type PickEntry } from "../../components/PickInput";
import type { CalcFocus } from "@shared/calcWindow";
import { assemblyHead, assemblyItemSubjectId } from "@shared/assemblyItem";
import { fillRoomName } from "../../../../core/room/roomPartName";
import "./RoomCalcSheet.css";

export type { CalcFocus };

export interface CalcDetailJump {
  setId: CalcSet["id"];
  detailId: CalcDetail["id"];
  tick: number;
}

interface Props {
  sets: CalcSet[];
  onChange: (sets: CalcSet[]) => void;
  /** 上段の記号・建具記号（計算式で使える数量） */
  variables: Record<string, number>;
  options: MasterOptions | null;
  projectId: number;
  roomPartName?: string;
  focus: CalcFocus | null;
  onFocus: (focus: CalcFocus | null) => void;
  result: CalcSheetResult;
  /** この数が変わったら focus の計算式欄へカーソルを飛ばす（式の誤りへ移すのに使う） */
  jumpTick?: number;
  jumpDetail?: CalcDetailJump | null;
  onMessage: (message: string) => void;
  /** 上段（図・記号表）を持つ計算書か。汎用計算書は false */
  hasUpper?: boolean;
  /** 別画面（明細入力ウィンドウ）の見出し。別画面で開けないときは省く */
  windowTitle?: string;
  /** 明細入力ウィンドウの中に表示しているか */
  inWindow?: boolean;
  /**
   * 下段の初期状態（見出し行＋部位の並び）を持つ計算書だけ渡す。
   * save は今の並びを初期状態として保存、load は初期状態を返す（空なら置き換え、中身があれば下に足す）
   */
  template?: {
    save: (sets: CalcSet[]) => Promise<void>;
    load: () => Promise<CalcSet[]>;
  };
  /** この計算書を保存する（「マスター作成」が集計へ入る前に呼ぶ。別画面では渡さない） */
  saveSheet?: () => Promise<void>;
}

type CallSource = "basic" | "project" | "assembly";
type CellPosition = { row: number; col: number };
type CellRange = { anchor: CellPosition; end: CellPosition };

function cellRangeBounds(range: CellRange): {
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
} {
  return {
    rowFrom: Math.min(range.anchor.row, range.end.row),
    rowTo: Math.max(range.anchor.row, range.end.row),
    colFrom: Math.min(range.anchor.col, range.end.col),
    colTo: Math.max(range.anchor.col, range.end.col),
  };
}

function cellPositionFrom(target: EventTarget): CellPosition | null {
  if (!(target instanceof HTMLInputElement)) return null;
  if (
    target.dataset.row === undefined ||
    target.dataset.col === undefined ||
    target.dataset.rowspan !== undefined
  )
    return null;
  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);
  return Number.isFinite(row) && Number.isFinite(col) ? { row, col } : null;
}

/**
 * 摘要の欄。マスターの○○面・○○下は、欄を離れている間は置き換わった文字（上下の行の積算用表示＋面・下）で見せ、
 * 欄に入ると元の文字（○○面・○○下のまま）を直せる
 */
function DescriptionInput({
  value,
  resolved,
  onFocus,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> & {
  value: string;
  resolved: string;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  return (
    <input
      {...props}
      value={editing ? value : resolved}
      title={resolved !== value ? `マスター：${value}` : undefined}
      onFocus={(e) => {
        setEditing(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setEditing(false);
        props.onBlur?.(e);
      }}
    />
  );
}

/** カーソルを欄へ移し、文字を全部選んでおく */
function focusInput(input: HTMLInputElement): void {
  focusCell(input);
  input.select();
}

/** 記号はセットに1つ。先頭の計算式行に持たせ、他の行からは消す */
function setBSymbol(set: CalcSet, symbol: string): CalcSet["lines"] {
  return set.lines.map((line, index) => ({
    ...line,
    bSymbol: index === 0 ? symbol : "",
  }));
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
  {
    label: "操作",
    title: "明細の並べ替え・削除",
    width: 84,
    className: "ops",
  },
];

const CALC_COLUMN_WIDTHS = CALC_COLUMNS.map((column) => column.width);
const CALC_COLUMN_WIDTHS_KEY = "calc-sheet-columns-v2";

function migrateLegacyOpsColumnWidth(): void {
  try {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(CALC_COLUMN_WIDTHS_KEY);
    if (saved === null) return;
    const widths: unknown = JSON.parse(saved);
    const opsIndex = CALC_COLUMNS.findIndex(
      (column) => column.className === "ops",
    );
    if (
      opsIndex < 0 ||
      !Array.isArray(widths) ||
      widths.length !== CALC_COLUMNS.length ||
      widths[opsIndex] !== 108
    )
      return;
    const next = [...widths];
    next[opsIndex] = CALC_COLUMNS[opsIndex].width;
    window.localStorage.setItem(
      CALC_COLUMN_WIDTHS_KEY,
      JSON.stringify(next),
    );
  } catch {
    // 保存幅を読めない場合は既定幅を使う
  }
}

migrateLegacyOpsColumnWidth();

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
  roomPartName,
  focus,
  onFocus,
  result,
  jumpTick,
  jumpDetail,
  onMessage,
  hasUpper = true,
  windowTitle,
  inWindow = false,
  template,
  saveSheet,
}: Props): JSX.Element {
  const [callOpen, setCallOpen] = useState(false);
  const [callPos, setCallPos] = useState<{ x: number; y: number } | null>(null);
  const [source, setSource] = useState<CallSource>("basic");
  const [insertMode, setInsertMode] = useState(false);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [subjectNumber, setSubjectNumber] = useState("");
  const [details, setDetails] = useState<Detail[]>([]);
  /** マスター作成したあと呼出画面の一覧を読み直すための合図 */
  const [detailsVersion, setDetailsVersion] = useState(0);
  const [bannerOpen, setBannerOpen] = useState(false);
  /** コメント行（※行）にカーソルがあるときの、そのコメント行のセットID */
  const [bannerSetId, setBannerSetId] = useState<string | null>(null);
  const [assemblies, setAssemblies] = useState<FinishAssembly[]>([]);
  /** 明細番号欄の一覧候補（選んだ科目の明細。for はどの科目の候補かの目印） */
  const [numberOptions, setNumberOptions] = useState<{
    for: number | null;
    items: Detail[];
  }>({ for: null, items: [] });
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
  const [cellRange, setCellRange] = useState<CellRange | null>(null);
  const [jumpedDetail, setJumpedDetail] = useState<
    (CalcDetailJump & { gridRow: number }) | null
  >(null);
  const jumpedTick = useRef<number | null>(null);
  const cellDragAnchor = useRef<CellPosition | null>(null);
  const pasteEventCount = useRef(0);
  /** Shift+クリック中は範囲の先頭を動かさないための目印 */
  const shiftClicking = useRef(false);
  /** 最後にカーソルがあった欄の列（貼付ボタンを押しても残る） */
  const lastColumn = useRef<number | null>(null);
  /** 最後にカーソルがあった表の行（通し番号）。ボタンを押しても残るので、行追加・行挿入の先に使う */
  const lastGridRow = useRef<number | null>(null);
  /** 元に戻す・やり直しのための履歴 */
  const [past, setPast] = useState<CalcSet[][]>([]);
  const [future, setFuture] = useState<CalcSet[][]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const clearCellDrag = (): void => {
      cellDragAnchor.current = null;
    };
    window.addEventListener("mouseup", clearCellDrag);
    return () => window.removeEventListener("mouseup", clearCellDrag);
  }, []);
  const { widths, startResize } = useColumnWidths(
    CALC_COLUMN_WIDTHS_KEY,
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
      const head = assemblyHead(assembly.items);
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
  /** 先頭の通常明細が同じセットをまとめて選ぶための一覧（空なら閉じている） */
  const [pickGroup, setPickGroup] = useState<FinishAssembly[]>([]);
  /** 呼出画面に出すセット（工種科目を選んでいればその科目のセットだけ） */
  const calledAssemblies: FinishAssembly[] = useMemo(
    () =>
      subjectId === null
        ? sortedAssemblies
        : sortedAssemblies.filter(
            (assembly) => assemblyHead(assembly.items)?.subjectId === subjectId,
          ),
    [sortedAssemblies, subjectId],
  );
  /** 先頭の通常明細が同じセットは1行にまとめて見せる */
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
      numberOptions.items.map((item) => ({
        value: item.detailNumber?.toFixed(2) ?? "",
        label: `${item.partName} ${item.name} ${item.descriptionLower}`.trim(),
      })),
    [numberOptions.items],
  );
  const unitEntries: PickEntry[] = useMemo(
    () =>
      (options?.units ?? []).map((unit) => ({
        value: unit.name,
        label: `${unit.id}　${unit.name}`,
      })),
    [options],
  );

  /** 入力の変更（履歴に残す）。中身が変わらないときは履歴に残さない */
  const commit = useCallback(
    (next: CalcSet[]): void => {
      // 欄を離れただけなどの変わらない入力で履歴が埋まると、「戻る」が効かなくなる
      if (JSON.stringify(next) === JSON.stringify(sets)) {
        onChange(next);
        return;
      }
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
      roomPartName,
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
    roomPartName,
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
        setAssemblies(hideBasicDuplicates([...basic, ...project]));
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
  }, [callOpen, projectId, source, subjectId, detailsVersion]);

  // 呼出先や科目を変えたら、セットを選ぶ画面は閉じる
  useEffect(() => {
    setPickGroup([]);
  }, [callOpen, source, subjectId]);

  /** 明細番号欄に入ったとき、その科目の明細を一覧候補として読み込む */
  const loadNumberOptions = useCallback(
    async (detailSubjectId: number | null): Promise<void> => {
      // 先に科目の目印を入れて中身を空にする（読み込み中に前の科目の候補を選べないように）
      setNumberOptions({ for: detailSubjectId, items: [] });
      if (detailSubjectId === null) return;
      const project = await window.sekisan.listDetails(
        detailSubjectId,
        projectId,
      );
      const basic = await window.sekisan.listDetails(detailSubjectId, null);
      const numbers = new Set(project.map((row) => row.detailNumber));
      setNumberOptions((current) =>
        current.for === detailSubjectId
          ? {
              for: detailSubjectId,
              items: [
                ...project,
                ...basic.filter((row) => !numbers.has(row.detailNumber)),
              ],
            }
          : current,
      );
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
          // コメント行（※行）は明細も計算式も持たない。行を足すと空の明細行が出てしまう
          if (
            next.banner != null &&
            next.details.length === 0 &&
            next.lines.length === 0
          )
            return next;
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
   * セットを分けたり前のセットにつなげたりすると行の目印が変わり、
   * 入力欄が作り直されてカーソルが消える。組み替えた後の並びで、
   * 入れていた行（明細・計算式のIDで探す）の部位欄へカーソルを戻す。
   */
  const refocusSetPart = useCallback(
    (next: CalcSet[], detailId?: string, lineId?: string): void => {
      if (detailId === undefined && lineId === undefined) return;
      let row = 0;
      for (const set of next) {
        const count = setRowCount(set);
        for (let index = 0; index < count; index += 1) {
          const hit =
            (detailId !== undefined && set.details[index]?.id === detailId) ||
            (lineId !== undefined && set.lines[index]?.id === lineId);
          if (!hit) continue;
          const target = row + index;
          requestAnimationFrame(() => {
            const input = gridRef.current?.querySelector<HTMLInputElement>(
              `input[data-row="${target}"][data-col="0"]`,
            );
            if (input) focusInput(input);
          });
          return;
        }
        row += count;
      }
    },
    [],
  );

  /**
   * 部位欄の入力。セットの先頭の行なら、そのセットの部位を変える。
   * 途中の行に入れると、その行から下を別のセットに分ける（空にすると上のセットにつなげる）。
   */
  const commitSetPart = useCallback(
    (setId: string, rowIndex: number, text: string): void => {
      const picked = pickMaster(aggregationParts, text);
      const target = sets.find((set) => set.id === setId);
      const detailId = target?.details[rowIndex]?.id;
      const lineId = target?.lines[rowIndex]?.id;
      if (rowIndex === 0) {
        const at = sets.findIndex((set) => set.id === setId);
        if (picked.name === "" && at > 0) {
          const next = mergeWithPreviousSet(sets, setId);
          commit(next);
          refocusSetPart(next, detailId, lineId);
          return;
        }
        updateSet(setId, { partNumber: picked.id, partName: picked.name });
        return;
      }
      if (picked.name === "") return;
      const next = splitSetAt(sets, setId, rowIndex, {
        partNumber: picked.id,
        partName: picked.name,
      });
      commit(next);
      refocusSetPart(next, detailId, lineId);
      onMessage("この行から別のセット明細に分けました");
    },
    [aggregationParts, commit, onMessage, refocusSetPart, sets, updateSet],
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
        // 部位IDは工事マスター（明細）の通りに入れる（部位名から探さない）
        partNumber: keepPart ? row.partNumber : (found.partNumber ?? null),
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

  /** その行（明細と計算式の1組）をまとめて削除する */
  const removeDetail = useCallback(
    (setId: string, index: number): void => {
      // 消したのが最後の1行ならセットごと消す（半分の行が残らないように）
      commit(removeSheetRow(sets, setId, index));
      onFocus(null);
    },
    [commit, onFocus, sets],
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

  /** 明細を上下へ動かす（セットの端では隣のセットの端へ） */
  const moveDetail = useCallback(
    (setId: string, index: number, step: number): void => {
      // セットの端では隣のセット（※行はまたぐ）の端へ移す
      const moved = moveDetailAcrossSets(sets, setId, index, step);
      if (!moved) return;
      commit(moved.sets);
      onFocus({ setId: moved.setId, area: "detail", index: moved.index });
    },
    [commit, onFocus, sets],
  );

  // 明細・計算式の欄へカーソルを移したら、コメント行のカーソルは外す
  useEffect(() => {
    setBannerSetId(null);
  }, [focus?.setId, focus?.area, focus?.index]);

  /**
   * 明細・計算式の欄へカーソルが入ったときの処理。
   * 同じ欄へ戻ったときは上のカーソル記録が変わらず外れないので、ここでも外す。
   */
  const focusHere = useCallback(
    (next: CalcFocus): void => {
      setBannerSetId(null);
      onFocus(next);
    },
    [onFocus],
  );

  /** 直前に処理した「飛べ」の合図。合図が変わったときだけ画面を送る */
  const lastJumpTick = useRef(jumpTick);
  // 式の誤りなどで外から指された計算式欄へ、実際にカーソルを移して画面も送る
  useEffect(() => {
    if (jumpTick === undefined || jumpTick === lastJumpTick.current) return;
    lastJumpTick.current = jumpTick;
    if (!focus || focus.area === "detail") return;
    const input = gridRef.current?.querySelector<HTMLInputElement>(
      `input[data-jump="${focus.setId}|${focus.area}|${focus.index}"]`,
    );
    if (!input) return;
    input.focus();
    input.select();
    input.scrollIntoView({ block: "center", inline: "center" });
  }, [jumpTick, focus]);

  /** マスター呼出の書込先。呼出画面を触ってカーソルが外れても最後の明細行を覚えておく */
  const keptTarget = useRef<{ setId: string; index: number } | null>(null);
  if (focus && focus.area === "detail") {
    keptTarget.current = { setId: focus.setId, index: focus.index };
  }
  const writeFocus = useMemo(() => {
    if (
      focus &&
      focus.area === "detail" &&
      sets.some((set) => set.id === focus.setId)
    ) {
      return { setId: focus.setId, index: focus.index };
    }
    const kept = keptTarget.current;
    return kept && sets.some((set) => set.id === kept.setId) ? kept : null;
  }, [focus, sets]);

  /** カーソルのあるセット（無ければ最後のセット） */
  const currentSet = useMemo(
    () =>
      sets.find((set) => set.id === (focus?.setId ?? writeFocus?.setId)) ??
      sets[sets.length - 1] ??
      null,
    [focus?.setId, sets, writeFocus],
  );

  /** 呼び出した明細が書き込まれる行（呼出画面を開いている間、色で示す） */
  const callRow = useMemo(() => {
    if (bannerSetId !== null || !currentSet) return null;
    const at =
      writeFocus && writeFocus.setId === currentSet.id
        ? writeFocus.index
        : currentSet.details.findIndex((row) => row.name.trim() === "");
    return {
      setId: currentSet.id,
      index: at < 0 ? currentSet.details.length : at,
    };
  }, [bannerSetId, currentSet, writeFocus]);

  /** 書込先の行に入っている科目ID（呼出画面の工種科目はこれに合わせる） */
  const callRowSubject = useMemo(() => {
    if (!callRow) return null;
    const set = sets.find((item) => item.id === callRow.setId);
    return set?.details[callRow.index]?.subjectId ?? null;
  }, [callRow, sets]);

  // 計算書の行に科目IDが入っていれば、呼出画面の工種科目をその科目にする（選び直し可）
  useEffect(() => {
    if (!callOpen || callRowSubject === null) return;
    setSubjectId(callRowSubject);
    setSubjectNumber(String(callRowSubject));
  }, [callOpen, callRowSubject]);

  /**
   * マスター作成：この計算書を保存してから集計実行と同じ処理を走らせ、
   * 工事マスター（集計書の内容）とセット明細マスターを最新にする。
   * マスター呼出の「工事マスター（明細）」「セット明細」にすぐ出るようになる。
   */
  const buildMasters = async (): Promise<void> => {
    if (saveSheet === undefined) return;
    await saveSheet();
    const built = await window.sekisan.buildProjectMasters(projectId);
    setDetailsVersion((version) => version + 1);
    onMessage(
      `工事マスター・セット明細マスターを更新しました（集計${built.aggregateCount}行・新しいセット${built.assembliesAdded}件。「マスター呼出」に最新が出ます）`,
    );
  };

  /** 明細を1つ呼び出す（上書き基準・空きが無ければ自動で挿入） */
  const callDetail = useCallback(
    (detail: Detail) => {
      const target = currentSet;
      const item = calcDetail({
        sourceDetailId: detail.id,
        subjectId: detail.subjectId,
        detailNumber: detail.detailNumber,
        // 部位・材種区分・単位などすべてマスターの登録通りに入れる
        // （空欄は空欄のまま。書き込み先の行の値は引き継がない）
        materialCategory: detail.materialCategory,
        partNumber: detail.partNumber,
        partName: fillRoomName(detail.partName, roomPartName),
        name: detail.name,
        descriptionUpper: detail.descriptionUpper,
        descriptionLower: detail.descriptionLower,
        unit: detail.unit,
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
        writeFocus && writeFocus.setId === target.id
          ? writeFocus.index
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
      insertMode,
      onFocus,
      onMessage,
      pickupParts,
      roomPartName,
      sets,
      updateSet,
      writeFocus,
    ],
  );

  /** セット明細をまとめて呼び出す（元の行数に関わらず1セット＝1回分） */
  const callAssembly = useCallback(
    (assembly: FinishAssembly) => {
      const created = calcSet(0);
      const at = sets.findIndex((set) => set.id === currentSet?.id);
      const bannerAt =
        bannerSetId === null
          ? -1
          : sets.findIndex((set) => set.id === bannerSetId);
      const head = assemblyHead(assembly.items);
      // 上書き呼出は計算書に入れてあるセットの部位を残す（空のときだけ先頭の通常明細から入れる）。
      // 挿入呼出や※行の下への追加は新しいセットなので、呼び出したセットの部位をそのまま使う
      const underBanner = bannerAt >= 0 && isCommentSet(sets[bannerAt]);
      const overwrites =
        !underBanner && !insertMode && at >= 0 && !isCommentSet(sets[at]);
      const keptPart =
        overwrites && sets[at].partName.trim() !== "" ? sets[at] : null;
      const assemblyPart =
        assembly.setPartName.trim() === ""
          ? null
          : {
              partNumber: assembly.setPartNumber,
              partName: assembly.setPartName,
            };
      const selectedPart =
        keptPart ??
        assemblyPart ??
        (head
          ? { partNumber: head.partNumber, partName: head.partName }
          : null);
      created.partName = selectedPart?.partName ?? "";
      created.partNumber = selectedPart?.partNumber ?? null;
      created.details = assembly.items.map((item) =>
        calcDetail({
          sourceDetailId: item.sourceDetailId,
          subjectId: assemblyItemSubjectId(item),
          detailNumber: item.detailNumber,
          materialCategory: item.materialCategory,
          partNumber: item.partNumber ?? null,
          partName: fillRoomName(item.partName, roomPartName),
          name: item.name,
          descriptionUpper: item.descriptionUpper,
          descriptionLower: item.descriptionLower,
          unit: item.unit,
          remarksUpper: item.remarksUpper,
          remarksLower: item.remarksLower,
          estimateDisplay: item.estimateDisplay,
          coefficient: item.coefficient,
          note: item.note === true,
        }),
      );
      created.lines = syncLines(created.details, []);
      const next = [...sets];
      // ※行にカーソルがあるときは、その※行の下へ新しいセットとして入れる
      if (bannerAt >= 0 && isCommentSet(sets[bannerAt])) {
        commit(insertSetBefore(sets, bannerAt + 1, created));
        onFocus({ setId: created.id, area: "detail", index: 0 });
        onMessage(`${head?.name ?? "セット明細"} を呼び出しました`);
        return;
      }
      if (insertMode || at < 0 || isCommentSet(sets[at])) {
        // ※行は上に残し、その下へ入れる
        commit(insertSetBefore(sets, at, created));
      } else {
        // 上書きは元のセット1つ分を丸ごと置き換える（計算式と※行は残す）
        created.lines = syncLines(created.details, sets[at].lines);
        created.banner = sets[at].banner ?? null;
        next[at] = created;
        commit(next);
      }
      onFocus({ setId: created.id, area: "detail", index: 0 });
      onMessage(
        `${head?.name ?? "セット明細"} を${insertMode ? "挿入" : "上書き"}呼出しました`,
      );
    },
    [
      bannerSetId,
      commit,
      currentSet?.id,
      insertMode,
      onFocus,
      onMessage,
      roomPartName,
      sets,
    ],
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
      // カーソルの行を表から拾う。部位・コメント・記号などカーソルの記録が乗らない欄や、
      // セットの分け直しで記録が消えたあとでも、最後に触った行が入るセットを足し先にする
      const gridRow = lastGridRow.current;
      let target = currentSet;
      let targetIndex: number | undefined;
      if (gridRow !== null) {
        let start = 0;
        for (const set of sets) {
          const count = setRowCount(set);
          if (gridRow >= start && gridRow < start + count) {
            target = set;
            targetIndex = gridRow - start;
            break;
          }
          start += count;
        }
      }
      if (!target) {
        commit([...sets, calcSet()]);
        return;
      }
      // どの欄で押しても、明細と計算式を1組（1行分）足す
      const at = insert ? (targetIndex ?? focus?.index ?? 0) : undefined;
      const next = addSetRow(target, at);
      updateSet(target.id, { details: next.details, lines: next.lines });
    },
    [bannerSetId, commit, currentSet, focus, sets, updateSet],
  );

  /**
   * カーソルのあるセット明細の上へ、空の明細（1明細）を1行入れる。
   * 左端の部位が入っている行はその行の上、入っていない行（複数明細セットの途中）は
   * そのセットの上、※行（コメント行）はその行の上へ入る。
   */
  const insertSet = useCallback(() => {
    const bannerAt =
      bannerSetId === null
        ? -1
        : sets.findIndex((set) => set.id === bannerSetId);
    const at =
      bannerAt >= 0
        ? bannerAt
        : sets.findIndex((set) => set.id === currentSet?.id);
    const created = calcSet(1);
    commit(insertSetBefore(sets, at, created));
    onFocus({ setId: created.id, area: "detail", index: 0 });
    onMessage("上に空の明細（1明細）を入れました");
  }, [bannerSetId, commit, currentSet?.id, onFocus, onMessage, sets]);

  /**
   * カーソルのある明細行を説明行（計算しない文字だけの行）にする／明細に戻す。
   * 説明行は集計で数量0になり、集計書では説明用の行として並ぶ。
   */
  const toggleNote = useCallback(() => {
    if (!focus || focus.area !== "detail") return;
    const targetIndex = sets.findIndex((set) => set.id === focus.setId);
    const target = sets[targetIndex];
    const detail = target?.details[focus.index];
    if (!target || !detail) return;
    let patch: Partial<CalcDetail> = {};
    if (detail.note !== true) {
      const prev =
        focus.index > 0
          ? target.details[focus.index - 1]
          : sets
              .slice(0, targetIndex)
              .reverse()
              .find((set) => !isCommentSet(set) && set.details.length > 0)
              ?.details.at(-1);
      patch = noteNumbersFrom(prev, detail);
    }
    updateDetail(target.id, focus.index, {
      note: detail.note !== true,
      ...patch,
    });
    onMessage(
      detail.note === true
        ? "明細に戻しました"
        : "説明行にしました（数量は入りません。名称・摘要を入れて使います）",
    );
    requestAnimationFrame(() => {
      const root = gridRef.current;
      if (!root) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement &&
        active.dataset.row !== undefined &&
        active.dataset.col !== undefined &&
        root.contains(active)
      )
        return;
      const row = lastGridRow.current;
      if (row === null) return;
      const rowSelector = `input[data-row="${row}"][data-col]`;
      const column = lastColumn.current;
      const input =
        (column === null
          ? null
          : root.querySelector<HTMLInputElement>(
              `input[data-row="${row}"][data-col="${column}"]`,
            )) ?? root.querySelector<HTMLInputElement>(rowSelector);
      if (input) focusInput(input);
    });
  }, [focus, onMessage, sets, updateDetail]);

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

  /** 1行コピー（カーソルの行を明細・計算式ごと）。Excelへも貼れるようTSVにする */
  const copyRow = useCallback(async () => {
    if (!currentDetail || !currentSet || !focus) {
      onMessage("コピーする明細の欄を選んでください");
      return;
    }
    const line = currentSet.lines[focus.index] ?? calcLine();
    const text = rowsAsTsv([currentDetail], [line]);
    writeClipboard(text);
    setCalcClip({
      kind: "rows",
      text,
      details: [currentDetail],
      lines: [line],
      // 写し元のセットの部位（一番左）も一緒に持っていく
      partNumber: currentSet.partNumber,
      partName: currentSet.partName,
      banners: [],
      parts: [
        {
          at: 0,
          partNumber: currentSet.partNumber,
          partName: currentSet.partName,
        },
      ],
    });
    onMessage(
      `明細「${currentDetail.name || "（名称なし）"}」を計算式ごとコピーしました`,
    );
  }, [currentDetail, currentSet, focus, onMessage]);

  /** 表の行を上から順に並べたもの（Shift+クリックの範囲を数えるため。※行も含む） */
  const flatRows = useMemo(() => {
    const list: { setId: string; index: number }[] = [];
    sets.forEach((set) => {
      if (isCommentSet(set)) {
        list.push({ setId: set.id, index: 0 });
        return;
      }
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
    const banners: CopiedBanner[] = [];
    const parts: CopiedPart[] = [];
    let lastSetId = "";
    rangeRows.forEach((row) => {
      const set = sets.find((item) => item.id === row.setId);
      if (!set) return;
      // ※行（コメント行）は、何行目の上にあったかを覚えて一緒にコピーする
      if (isCommentSet(set)) {
        banners.push({
          at: details.length,
          text: set.banner?.text ?? "",
          color: set.banner?.color ?? "#e2e8f0",
          text2: set.banner?.text2,
        });
        lastSetId = "";
        return;
      }
      // セットの区切りと左端の部位も覚えておく（貼り付けで同じ形に戻す）
      if (row.setId !== lastSetId) {
        parts.push({
          at: details.length,
          partNumber: set.partNumber,
          partName: set.partName,
        });
        lastSetId = row.setId;
      }
      details.push(set.details[row.index] ?? calcDetail());
      lines.push(set.lines[row.index] ?? calcLine());
    });
    const source = sets.find(
      (item) =>
        !isCommentSet(item) && rangeRows.some((row) => row.setId === item.id),
    );
    const textRows =
      details.length === 0 ? [] : rowsAsTsv(details, lines).split(/\r?\n/);
    [...banners]
      .sort((a, b) => b.at - a.at)
      .forEach((banner) => textRows.splice(banner.at, 0, banner.text));
    const text = textRows.join("\r\n");
    writeClipboard(text);
    setCalcClip({
      kind: "rows",
      text,
      details,
      lines,
      partNumber: source?.partNumber ?? null,
      partName: source?.partName ?? "",
      banners,
      parts,
    });
    onMessage(
      `${rangeRows.length}行をコピーしました（貼り付けたい行にカーソルを置いて上書貼付／挿入貼付）`,
    );
  }, [onMessage, rangeRows, sets]);

  /** 行コピー（Shift+クリックで複数行を選んでいればその範囲、無ければカーソルの1明細） */
  const copySelection = useCallback(async () => {
    if (rangeRows.length > 0) {
      await copyRows();
      return;
    }
    await copyRow();
  }, [copyRow, copyRows, rangeRows]);

  const cutSelection = useCallback(async () => {
    const messageSuffix =
      "（貼り付けたい行にカーソルを置いて上書貼付／挿入貼付。元に戻すで戻せます）";
    if (rangeRows.length > 0) {
      const rows = rangeRows;
      await copyRows();
      commit(removeSheetRows(sets, rows));
      setRangeEnd(null);
      onFocus(null);
      onMessage(`${rows.length}行を切り取りました${messageSuffix}`);
      return;
    }
    if (currentDetail && currentSet && focus) {
      const name = currentDetail.name || "（名称なし）";
      await copyRow();
      commit(
        removeSheetRows(sets, [{ setId: focus.setId, index: focus.index }]),
      );
      onFocus(null);
      onMessage(`明細「${name}」を計算式ごと切り取りました${messageSuffix}`);
      return;
    }
    onMessage("切り取る明細の欄を選んでください");
  }, [
    commit,
    copyRow,
    copyRows,
    currentDetail,
    currentSet,
    focus,
    onFocus,
    onMessage,
    rangeRows,
    sets,
  ]);

  /**
   * 貼り付け。この画面でコピーしたセット・明細ならそのまま写し、
   * Excelなど他から持ってきた表なら、カーソルの欄（明細／計算式）へ取り込む。
   * mode が insert なら差し込み、append なら最後の行へ足し、overwrite ならその位置に上書きする。
   */
  const pasteText = useCallback(
    async (text: string, mode: "overwrite" | "insert" | "append") => {
      if (text.trim() === "") return;
      const clip = getCalcClip(text);
      // カーソルのある列（この列から画面の並びどおりに貼り付ける）。
      // 貼付ボタンを押すと欄から離れるので、最後にいた列を覚えておいて使う
      const active = document.activeElement;
      const activeColumn =
        active instanceof HTMLElement &&
        active.dataset.col !== undefined &&
        active.dataset.rowspan === undefined
          ? Number(active.dataset.col)
          : null;
      const cursorColumn = activeColumn ?? lastColumn.current;
      const byColumn = cursorColumn !== null && Number.isFinite(cursorColumn);
      // コメント行（※行）にカーソルがあるときは、その行が貼り付け先
      const bannerAt =
        bannerSetId === null
          ? -1
          : sets.findIndex((set) => set.id === bannerSetId);

      if (clip?.kind === "set") {
        const created = duplicateSet(clip.set);
        const at =
          mode === "append"
            ? sets.length
            : bannerAt >= 0
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
            : mode === "append"
              ? "コピーしたセットを最後に足しました"
              : "コピーしたセットを差し込みました",
        );
        return;
      }

      if (
        clip?.kind === "rows" &&
        ((clip.banners?.length ?? 0) > 0 || (clip.parts?.length ?? 0) > 1)
      ) {
        // ※行や複数のセットを含むコピーは、その並びのままセットとして差し込む
        const copiedDetails = clip.details.map(duplicateDetail);
        const copiedLines = clip.lines.map(duplicateLine);
        const created = rowsToSets(
          copiedDetails,
          copiedLines,
          clip.banners ?? [],
          clip.parts ?? [
            { at: 0, partNumber: clip.partNumber, partName: clip.partName },
          ],
        );
        let base = sets;
        let at = mode === "append" ? sets.length : bannerAt;
        if (at < 0) {
          const target = currentSet;
          const setAt = target
            ? sets.findIndex((set) => set.id === target.id)
            : -1;
          const cursor = focus ? focus.index : 0;
          if (!target || setAt < 0) at = sets.length;
          else if (cursor > 0 && cursor < target.details.length) {
            // セットの途中に貼るときは、その行でセットを分けて間へ入れる
            base = splitSetAt(sets, target.id, cursor, {
              partNumber: null,
              partName: "",
            });
            at = setAt + 1;
          } else at = setAt;
        }
        const next = [...base];
        next.splice(at, 0, ...created);
        commit(next);
        const head = created.find((set) => !isCommentSet(set));
        if (head) onFocus({ setId: head.id, area: "detail", index: 0 });
        onMessage(
          mode === "append"
            ? `コピーした${copiedDetails.length}行を部位・※行ごと最後に足しました`
            : `コピーした${copiedDetails.length}行を部位・※行ごとカーソルの行の上へ差し込みました`,
        );
        return;
      }

      if (
        mode !== "append" &&
        bannerAt >= 0 &&
        (clip?.kind === "detail" || clip?.kind === "rows")
      ) {
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

      if (mode === "overwrite" && clip === null && byColumn) {
        const bounds = cellRange ? cellRangeBounds(cellRange) : null;
        const matrix = parseTsv(text);
        if (bounds && matrix.length === 1 && (matrix[0]?.length ?? 0) === 1) {
          commit(
            fillCells(
              sets,
              bounds.rowFrom,
              bounds.rowTo,
              bounds.colFrom,
              bounds.colTo,
              text,
            ),
          );
        } else {
          const activeRow =
            active instanceof HTMLElement && active.dataset.row !== undefined
              ? Number(active.dataset.row)
              : null;
          const startRow =
            bounds?.rowFrom ??
            (activeRow !== null && Number.isFinite(activeRow)
              ? activeRow
              : (lastGridRow.current ?? 0));
          commit(
            pasteCells(sets, startRow, bounds?.colFrom ?? cursorColumn, text),
          );
        }
        onMessage(
          "Excelの表を、カーソルのある列から画面の並びどおりに貼り付けました（部位合計・Ａ*Ｂ・累計・記号の列は飛ばします）",
        );
        return;
      }

      if (!currentSet) {
        if (clip) {
          onMessage("貼り付ける場所を選んでください");
          return;
        }
        // 汎用計算書などでセットが無いときは、新しいセットを作って取り込む
        const created = calcSet(1);
        const pasted = pasteRows(created.details, created.lines, 0, text);
        commit([
          ...sets,
          {
            ...created,
            details: pasted.details,
            lines: fillLines(pasted.details, pasted.lines),
          },
        ]);
        onFocus({ setId: created.id, area: "detail", index: 0 });
        onMessage(
          `エクセルの表を${pasted.details.length}行の明細として貼り付けました`,
        );
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
          mode === "append"
            ? details.length
            : mode === "overwrite"
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
            : mode === "append"
              ? `コピーした${copiedDetails.length}行を最後の行に足しました`
              : `コピーした${copiedDetails.length}行をカーソルの行の上へ差し込みました`,
        );
        return;
      }

      // 列の多いエクセルの表は、カーソルが明細に無くても明細へ取り込む
      const wideTable = (text.split(/\r?\n/)[0]?.split("\t").length ?? 1) >= 4;
      if (byColumn || focus?.area === "detail" || (!focus && wideTable)) {
        const at =
          mode === "append" ? currentSet.details.length : (focus?.index ?? 0);
        const base =
          mode !== "overwrite"
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
          mode !== "overwrite"
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
        const pasted =
          byColumn && cursorColumn !== null
            ? pasteSheet(base, baseLines, at, cursorColumn, text)
            : pasteRows(base, baseLines, at, text);
        updateSet(currentSet.id, {
          details: pasted.details,
          lines: fillLines(pasted.details, pasted.lines),
        });
        onMessage(
          byColumn
            ? "Excelの表を、カーソルのある列から画面の並びどおりに貼り付けました（部位合計・Ａ*Ｂ・累計・記号の列は飛ばします）"
            : "Excelの表を明細へ貼り付けました（部位名／名称／摘要（上）／摘要（下）／単位／掛け率／備考（上）／備考（下）／積算用表示の順。後ろにコメント／計算式Ａ／計算式Ｂがあれば計算式へも入ります）",
        );
        return;
      }

      const lines = pasteLines(
        currentSet.lines,
        mode === "append" ? currentSet.lines.length : (focus?.index ?? 0),
        text,
      );
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
      cellRange,
      sets,
      updateSet,
    ],
  );
  const paste = useCallback(
    async (mode: "overwrite" | "insert" | "append") => {
      const text = await navigator.clipboard.readText();
      await pasteText(text, mode);
    },
    [pasteText],
  );

  /** 記号のように何行分かをまとめて受け持つ欄（エクセルの結合セルと同じ） */
  const rowsOf = (cell: HTMLInputElement): number =>
    Number(cell.dataset.rowspan ?? 1) || 1;
  /** 結合された欄へ入ってきた行。出るときはこの行へ戻す */
  const cameFromRow = useRef<number | null>(null);

  const onCellMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return;
      const cell = cellPositionFrom(e.target);
      if (!cell || cell.col === 17) return;
      cellDragAnchor.current = cell;
      setCellRange(null);
    },
    [],
  );

  const onCellMouseOver = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      const anchor = cellDragAnchor.current;
      const cell = cellPositionFrom(e.target);
      if (
        !anchor ||
        !cell ||
        cell.col === 17 ||
        e.buttons !== 1 ||
        (cell.row === anchor.row && cell.col === anchor.col)
      )
        return;
      setCellRange({ anchor, end: cell });
      window.getSelection()?.removeAllRanges();
    },
    [],
  );

  /** Enter・矢印キーで隣の欄へ移る（表の中を行き来する） */
  const moveFocus = useCallback(
    (from: HTMLInputElement, stepRow: number, stepCol: number): void => {
      const root = gridRef.current;
      if (!root) return;
      const cells = Array.from(
        root.querySelectorAll<HTMLInputElement>("input[data-row][data-col]"),
      );
      const covers = (cell: HTMLInputElement, r: number): boolean => {
        const top = Number(cell.dataset.row);
        return top <= r && r < top + rowsOf(cell);
      };
      const top = Number(from.dataset.row);
      const rows = rowsOf(from);
      const col = Number(from.dataset.col);
      const row = rows > 1 ? (cameFromRow.current ?? top) : top;
      if (stepRow !== 0) {
        const start = stepRow > 0 ? top + rows : top - 1;
        for (let r = start; r >= 0 && r <= 9999; r += stepRow) {
          const found = cells.find(
            (cell) => covers(cell, r) && Number(cell.dataset.col) === col,
          );
          if (found) {
            cameFromRow.current = null;
            focusInput(found);
            return;
          }
          if (!cells.some((cell) => covers(cell, r))) return;
        }
        return;
      }
      const go = (target: HTMLInputElement, fromRow: number): void => {
        cameFromRow.current = rowsOf(target) > 1 ? fromRow : null;
        focusInput(target);
      };
      const sameRow = cells
        .filter((cell) => covers(cell, row))
        .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
      const next =
        stepCol > 0
          ? sameRow.find((cell) => Number(cell.dataset.col) > col)
          : [...sameRow]
              .reverse()
              .find((cell) => Number(cell.dataset.col) < col);
      if (next) {
        go(next, row);
        return;
      }
      // 行の端では、次（前）の行の先頭（末尾）へ移る
      const otherAt = row + (stepCol > 0 ? 1 : -1);
      const otherRow = cells
        .filter((cell) => covers(cell, otherAt))
        .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
      const edge = stepCol > 0 ? otherRow[0] : otherRow[otherRow.length - 1];
      if (edge) go(edge, otherAt);
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
      const shiftStep =
        e.shiftKey &&
        (e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          (e.key === "ArrowLeft" &&
            el.selectionStart === 0 &&
            el.selectionEnd === 0) ||
          (e.key === "ArrowRight" &&
            el.selectionStart === el.value.length &&
            el.selectionEnd === el.value.length))
          ? e.key === "ArrowUp"
            ? { row: -1, col: 0 }
            : e.key === "ArrowDown"
              ? { row: 1, col: 0 }
              : e.key === "ArrowLeft"
                ? { row: 0, col: -1 }
                : { row: 0, col: 1 }
          : null;
      if (shiftStep) {
        e.preventDefault();
        const anchor = cellRange?.anchor ?? { row, col };
        if (anchor.col === 17) return;
        const end = cellRange?.end ?? { row, col };
        const lastRow = Math.max(
          0,
          sets.reduce((total, set) => total + setRowCount(set), 0) - 1,
        );
        const nextCol = Math.min(20, Math.max(0, end.col + shiftStep.col));
        setCellRange({
          anchor,
          end: {
            row: Math.min(lastRow, Math.max(0, end.row + shiftStep.row)),
            col:
              nextCol === 17
                ? Math.min(20, Math.max(0, nextCol + shiftStep.col))
                : nextCol,
          },
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        setCellRange(null);
        moveFocus(el, 0, 1);
      } else if (e.key === "Tab") {
        e.preventDefault();
        setCellRange(null);
        moveFocus(el, 0, e.shiftKey ? -1 : 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCellRange(null);
        moveFocus(el, -1, 0);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCellRange(null);
        moveFocus(el, 1, 0);
      } else if (
        e.key === "ArrowLeft" &&
        el.selectionStart === 0 &&
        el.selectionEnd === 0
      ) {
        e.preventDefault();
        setCellRange(null);
        moveFocus(el, 0, -1);
      } else if (
        e.key === "ArrowRight" &&
        el.selectionStart === el.value.length &&
        el.selectionEnd === el.value.length
      ) {
        e.preventDefault();
        setCellRange(null);
        moveFocus(el, 0, 1);
      }
    },
    [cellRange, moveFocus, sets],
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

  useEffect(() => {
    if (jumpDetail === null || jumpDetail === undefined) return;
    if (jumpedTick.current === jumpDetail.tick) return;
    setJumpedDetail(null);
    if (sets.length === 0) return;
    const setIndex = sets.findIndex((set) => set.id === jumpDetail.setId);
    const detailIndex =
      setIndex < 0
        ? -1
        : sets[setIndex].details.findIndex(
            (detail) => detail.id === jumpDetail.detailId,
          );
    if (setIndex < 0 || detailIndex < 0) {
      jumpedTick.current = jumpDetail.tick;
      onMessage(
        "出所の行が見つかりません（集計のあとで計算書から消えています）",
      );
      return;
    }
    jumpedTick.current = jumpDetail.tick;
    setJumpedDetail({
      ...jumpDetail,
      gridRow: rowStarts[setIndex] + detailIndex,
    });
  }, [jumpDetail, onMessage, rowStarts, sets]);

  useLayoutEffect(() => {
    if (!jumpedDetail) return;
    const input = gridRef.current?.querySelector<HTMLInputElement>(
      `input[data-row="${jumpedDetail.gridRow}"][data-col="6"]`,
    );
    if (!input) return;
    input.closest("tr")?.scrollIntoView({ block: "center" });
    focusInput(input);
  }, [jumpedDetail]);

  useLayoutEffect(() => {
    const bounds = cellRange ? cellRangeBounds(cellRange) : null;
    gridRef.current
      ?.querySelectorAll<HTMLInputElement>("input[data-row][data-col]")
      .forEach((input) => {
        const row = Number(input.dataset.row);
        const col = Number(input.dataset.col);
        const selected =
          bounds !== null &&
          input.dataset.rowspan === undefined &&
          row >= bounds.rowFrom &&
          row <= bounds.rowTo &&
          col >= bounds.colFrom &&
          col <= bounds.colTo;
        input.closest("td")?.classList.toggle("cell-selected", selected);
      });
  });

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
      onFocusCapture={(e) => {
        const el = e.target;
        if (!(el instanceof HTMLElement)) return;
        const col = el.dataset.col;
        if (col !== undefined && el.dataset.rowspan === undefined)
          lastColumn.current = Number(col);
        const row = el.dataset.row;
        if (row !== undefined) lastGridRow.current = Number(row);
      }}
      onCopy={(e) => {
        const target = e.target;
        if (
          !(target instanceof HTMLInputElement) ||
          target.dataset.row === undefined ||
          target.dataset.col === undefined ||
          target.dataset.rowspan !== undefined ||
          !gridRef.current?.contains(target) ||
          !cellRange
        )
          return;
        const bounds = cellRangeBounds(cellRange);
        const rows = bounds.rowTo - bounds.rowFrom + 1;
        const cols = bounds.colTo - bounds.colFrom + 1;
        if (rows * cols <= 1) return;
        e.preventDefault();
        e.clipboardData.setData(
          "text/plain",
          cellsAsTsv(
            sets,
            bounds.rowFrom,
            bounds.rowTo,
            bounds.colFrom,
            bounds.colTo,
          ),
        );
        onMessage(
          `${rows}行×${cols}列をコピーしました（エクセルにも貼れます）`,
        );
      }}
      onPaste={(e) => {
        pasteEventCount.current += 1;
        const text = e.clipboardData.getData("text");
        const singleTrailingNewlineRemoved = text.replace(/\r?\n$/, "");
        if (
          !cellRange &&
          !/[\t\n]/.test(singleTrailingNewlineRemoved) &&
          getCalcClip(text) === null
        )
          return;
        e.preventDefault();
        void pasteText(text, "overwrite");
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete" && cellRange) {
          const bounds = cellRangeBounds(cellRange);
          const rows = bounds.rowTo - bounds.rowFrom + 1;
          const cols = bounds.colTo - bounds.colFrom + 1;
          if (rows * cols > 1) {
            e.preventDefault();
            commit(
              fillCells(
                sets,
                bounds.rowFrom,
                bounds.rowTo,
                bounds.colFrom,
                bounds.colTo,
                "",
              ),
            );
            onMessage(`${rows}行×${cols}列を消去しました`);
            return;
          }
        }
        if (!e.ctrlKey) return;
        const letter = e.code.startsWith("Key")
          ? e.code.slice(3).toLowerCase()
          : e.key.toLowerCase();
        if (letter === "c") {
          if (cellRange) {
            const bounds = cellRangeBounds(cellRange);
            const rows = bounds.rowTo - bounds.rowFrom + 1;
            const cols = bounds.colTo - bounds.colFrom + 1;
            if (rows * cols > 1) {
              e.preventDefault();
              writeClipboard(
                cellsAsTsv(
                  sets,
                  bounds.rowFrom,
                  bounds.rowTo,
                  bounds.colFrom,
                  bounds.colTo,
                ),
              );
              onMessage(
                `${rows}行×${cols}列をコピーしました（エクセルにも貼れます）`,
              );
              return;
            }
          }
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
          void copySelection();
        } else if (letter === "v" && e.shiftKey) {
          e.preventDefault();
          void paste("insert").catch(() =>
            onMessage("クリップボードを読み取れませんでした"),
          );
        } else if (letter === "v" && e.key === "Process") {
          const eventCount = pasteEventCount.current;
          let clipboardText: Promise<string | null>;
          try {
            clipboardText = navigator.clipboard.readText().then(
              (text) => text,
              () => null,
            );
          } catch {
            clipboardText = Promise.resolve(null);
          }
          window.setTimeout(() => {
            if (pasteEventCount.current !== eventCount) return;
            void clipboardText.then((text) => {
              if (text === null) {
                onMessage("クリップボードを読み取れませんでした");
                return;
              }
              void pasteText(text, "overwrite");
            });
          }, 100);
        } else if (letter === "z") {
          e.preventDefault();
          undo();
        } else if (letter === "y") {
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
        <button
          type="button"
          title="カーソルのあるセット明細の上に、空の明細（1明細）を1行入れます（複数明細セットの途中の行やコメント行にカーソルがあるときも、そのセット・その行の上に入ります）"
          onClick={insertSet}
        >
          ↑ 明細（1明細）挿入
        </button>
        <button
          type="button"
          disabled={focus?.area !== "detail"}
          title="カーソルのある明細行を「説明行」にします／明細に戻します。空の科目ID・部位番号・明細番号は上の行から入り（明細番号は＋0.01）、説明行は計算しません"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleNote}
        >
          説 説明行⇄明細
        </button>
        <button type="button" onClick={() => addRow(false)}>
          ＋ 行追加
        </button>
        <button type="button" onClick={() => addRow(true)}>
          ↥ 行挿入
        </button>
        <button
          type="button"
          title="カーソルのある明細1件をコピーします。先頭の行にカーソルを置いて最後の行を Shift+クリックすると、その範囲の行（明細と計算式。※行も一緒に）をまとめてコピーします（Ctrl+C）"
          onClick={() => void copySelection()}
        >
          ⧉ 行コピー（複数可）
        </button>
        <button
          type="button"
          title="カーソルのある明細1件を切り取ります。先頭の行にカーソルを置いて最後の行を Shift+クリックすると、その範囲の行（明細と計算式。※行も一緒に）をまとめて切り取ります。貼り付けは上書貼付／挿入貼付で行います"
          onClick={() => void cutSelection()}
        >
          ✂ 行切取（複数可）
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
          title="カーソルのある行の上へ差し込みます（元の行は下へずれます）"
          onClick={() => void paste("insert")}
        >
          📋 挿入貼付
        </button>
        <button
          type="button"
          title="カーソルのあるセット明細のいちばん下の行に足します（※行の手前まで）"
          onClick={() => void paste("append")}
        >
          📋 追加貼付（ｾｯﾄ明細行↓）
        </button>
        <button
          type="button"
          className={callOpen ? "on" : ""}
          onClick={() => setCallOpen(!callOpen)}
        >
          📂 マスター呼出
        </button>
        {saveSheet !== undefined && (
          <button
            type="button"
            title="この計算書を保存してから、工事マスターとセット明細マスターを最新にします（集計実行と同じ。「マスター呼出」に最新が出ます）"
            onClick={() => void buildMasters()}
          >
            📝 マスター作成
          </button>
        )}
        {template && (
          <>
            <button
              type="button"
              title="初期状態（見出し行＋部位の並び。全物件共通）をこの計算書に入れます。明細・計算式がまだ何も入っていなければ置き換え、入っていればいちばん下に足します（ↆ 戻るで戻せます）"
              onClick={() =>
                void (async () => {
                  const loaded = lowerFromTemplate(await template.load());
                  if (loaded.length === 0) {
                    onMessage(
                      "初期状態は空です（見出し行と部位を入れて「初期状態として保存」してください）",
                    );
                    return;
                  }
                  if (!hasLowerContent(sets)) {
                    commit(loaded);
                    onMessage("下段を初期状態にしました（ↆ 戻るで戻せます）");
                  } else {
                    commit([...sets, ...loaded]);
                    onMessage("初期状態を下に足しました（ↆ 戻るで戻せます）");
                  }
                })()
              }
            >
              ☰ 初期状態を入れる
            </button>
            <button
              type="button"
              title="この計算書の下段の並び（見出し行の色・文字とセットの部位だけ。明細・計算式は入りません）を、新しい部屋計算書の初期状態として保存します（全物件共通）"
              onClick={() =>
                void (async () => {
                  const next = lowerTemplateFrom(sets);
                  if (
                    !window.confirm(
                      `この計算書の並び（見出し行${next.filter(isCommentSet).length}行・セット${next.length - next.filter(isCommentSet).length}件）を、新しい部屋計算書の初期状態にします（全物件共通。今ある計算書は変わりません）。よろしいですか？`,
                    )
                  )
                    return;
                  await template.save(next);
                  onMessage(
                    "下段の初期状態を保存しました（次に新しく開く部屋計算書からこの並びで始まります）",
                  );
                })()
              }
            >
              💾 初期状態として保存
            </button>
          </>
        )}
        {!hasUpper && (
          <span className="hint">
            建具記号は建具表から直接引用します（例 &lt;SD2&gt;）
          </span>
        )}
      </div>

      <div
        className="calc-body"
        ref={gridRef}
        onKeyDown={onGridKeyDown}
        onMouseDownCapture={(e) => {
          setJumpedDetail(null);
          onCellMouseDown(e);
        }}
        onMouseOverCapture={onCellMouseOver}
      >
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
                  <tr
                    className={`banner-row${
                      isSelectedRow(set.id, 0) ? " row-selected" : ""
                    }`}
                    onMouseDownCapture={(e) => {
                      shiftClicking.current = e.shiftKey;
                    }}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setRangeEnd({ setId: set.id, index: 0 });
                      } else {
                        setRangeStart({ setId: set.id, index: 0 });
                        setRangeEnd(null);
                      }
                      shiftClicking.current = false;
                    }}
                  >
                    <td
                      className="banner-left"
                      colSpan={12}
                      style={{ background: set.banner.color }}
                    >
                      <input
                        lang="ja"
                        title="見出しの文字"
                        value={set.banner.text}
                        onFocus={() => setBannerSetId(set.id)}
                        onChange={(e) =>
                          updateSet(set.id, {
                            banner: {
                              text: e.target.value,
                              text2: set.banner?.text2,
                              color: set.banner?.color ?? "#e2e8f0",
                            },
                          })
                        }
                      />
                    </td>
                    <td
                      className="banner-right"
                      colSpan={CALC_COLUMNS.length - 12}
                      style={{ background: set.banner.color }}
                    >
                      <input
                        lang="ja"
                        title="コメント列の位置から書く文字"
                        value={set.banner.text2 ?? ""}
                        onFocus={() => setBannerSetId(set.id)}
                        onChange={(e) =>
                          updateSet(set.id, {
                            banner: {
                              text: set.banner?.text ?? "",
                              text2: e.target.value,
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
                    focusHere({
                      setId: set.id,
                      area: "detail",
                      index: rowIndex,
                    });
                  return (
                    <tr
                      // 行の目印は行番号ではなくIDにする（行を差し込んでも入力中の欄がずれない）
                      key={`${set.id}-${detail?.id ?? line?.id ?? `r${rowIndex}`}`}
                      className={[
                        detail?.note === true ? "note-row" : "",
                        jumpedDetail?.setId === set.id &&
                        jumpedDetail.detailId === detail?.id
                          ? "jump-row"
                          : "",
                        isSelectedRow(set.id, rowIndex) ? "row-selected" : "",
                        callOpen &&
                        callRow &&
                        callRow.setId === set.id &&
                        callRow.index === rowIndex
                          ? "call-row"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
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
                          popupSide="right"
                          popupAnchorCol={5}
                          row={gridRow}
                          col={0}
                          entries={aggregationPartEntries}
                          halfWidth
                          commitOnBlur
                          value={rowIndex === 0 ? set.partName : ""}
                          title="管理用部位。番号を打つと名称に変わります。途中の行に入れると、その行から別のセットになります"
                          onFocus={detail ? focusDetail : undefined}
                          onCommit={(text) =>
                            commitSetPart(set.id, rowIndex, text)
                          }
                        />
                      </td>
                      {detail ? (
                        <>
                          <td className="material">
                            {detail.note === true && (
                              <span
                                className="note-mark"
                                title="説明行（数量は入りません）"
                              >
                                説
                              </span>
                            )}
                            <PickInput
                          popupSide="right"
                              popupAnchorCol={5}
                              row={gridRow}
                              col={1}
                              entries={materialEntries}
                              halfWidth
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
                          popupSide="right"
                              popupAnchorCol={5}
                              row={gridRow}
                              col={2}
                              entries={subjectEntries}
                              halfWidth
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
                          popupSide="right"
                              popupAnchorCol={5}
                              row={gridRow}
                              col={3}
                              entries={pickupPartEntries}
                              halfWidth
                              commitOnBlur
                              value={
                                detail.partNumber === null
                                  ? ""
                                  : String(detail.partNumber)
                              }
                              title="明細用部位のID。登録済みの番号を入れると右の部位名にマスターの文字が入ります"
                              onFocus={focusDetail}
                              onCommit={(text) => {
                                const resolved = resolvePartNumberInput(
                                  pickupParts,
                                  text,
                                  detail.partName,
                                );
                                updateDetail(
                                  set.id,
                                  rowIndex,
                                  {
                                    ...resolved,
                                    partName: fillRoomName(
                                      resolved.partName,
                                      roomPartName,
                                    ),
                                  },
                                )
                              }}
                            />
                          </td>
                          <td className="id">
                            <PickInput
                          popupSide="right"
                              popupAnchorCol={5}
                              row={gridRow}
                              col={4}
                              entries={
                                numberOptions.for === detail.subjectId
                                  ? numberEntries
                                  : []
                              }
                              halfWidth
                              commitOnBlur
                              value={detail.detailNumber?.toFixed(2) ?? ""}
                              title="明細番号を入れるとマスターの明細を呼び出します（科目IDを入れると一覧から選べます）"
                              onFocus={() => {
                                focusDetail();
                                void loadNumberOptions(detail.subjectId);
                              }}
                              onCommit={(text, picked) => {
                                if (
                                  picked !== true &&
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
                              onBlur={(e) => {
                                const partName = fillRoomName(
                                  e.currentTarget.value,
                                  roomPartName,
                                );
                                if (partName !== e.currentTarget.value)
                                  updateDetail(set.id, rowIndex, { partName });
                              }}
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
                            <DescriptionInput
                              lang="ja"
                              data-row={gridRow}
                              data-col={7}
                              value={detail.descriptionLower}
                              resolved={resolveDescriptionMark(
                                detail.descriptionLower,
                                set.details[rowIndex - 1]?.estimateDisplay ??
                                  "",
                                set.details[rowIndex + 1]?.estimateDisplay ??
                                  "",
                              )}
                              onFocus={focusDetail}
                              onChange={(e) =>
                                updateDetail(set.id, rowIndex, {
                                  descriptionLower: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <DescriptionInput
                              lang="ja"
                              data-row={gridRow}
                              data-col={8}
                              value={detail.descriptionUpper}
                              resolved={resolveDescriptionMark(
                                detail.descriptionUpper,
                                set.details[rowIndex - 1]?.estimateDisplay ??
                                  "",
                                set.details[rowIndex + 1]?.estimateDisplay ??
                                  "",
                              )}
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
                          popupSide="right"
                              row={gridRow}
                              col={9}
                              entries={unitEntries}
                              halfWidth
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
                              data-jump={`${set.id}|formulaA|${rowIndex}`}
                              value={line.formulaA}
                              onFocus={() =>
                                focusHere({
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
                              data-jump={`${set.id}|formulaB|${rowIndex}`}
                              value={line.formulaB}
                              title="ＡとＢの両方に入力すると Ａ×Ｂ になります"
                              onFocus={() =>
                                focusHere({
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
                            data-row={gridRow}
                            data-col={17}
                            data-rowspan={rowCount}
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
                              title="この明細を1つ上へ移動します（先頭では前のセットの最後へ）"
                              disabled={
                                !canMoveRowAcross(sets, setIndex, rowIndex, -1)
                              }
                              onClick={() => moveDetail(set.id, rowIndex, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              title="この明細を1つ下へ移動します（最後では次のセットの先頭へ）"
                              disabled={
                                !canMoveRowAcross(sets, setIndex, rowIndex, 1)
                              }
                              onClick={() => moveDetail(set.id, rowIndex, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              title="この行（明細と計算式）を削除します"
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
            <span
              className="call-target"
              title="呼び出した明細が入る行（計算書で青く光っている行）"
            >
              書込先：
              {callRow ? `${callRow.index + 1}行目` : "（新しいセット）"}
            </span>
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
            <table
              className={`call-table ${source === "assembly" ? "asm" : ""}`}
            >
              {/* 部位名／名称・摘要は他の自由幅の列の1.5倍（広げたい分だけ表は横スクロールする） */}
              <colgroup>
                {source === "assembly" && <col className="scope" />}
                <col className="no" />
                <col className="no" />
                <col className="name" />
                <col className="desc" />
                <col className="unit" />
                <col className="flex" />
                {source === "assembly" && <col className="unit" />}
              </colgroup>
              <thead>
                <tr>
                  {source === "assembly" && <th className="scope">区分</th>}
                  <th className="no">部位ID</th>
                  <th className="no">番号</th>
                  <th>部位名／名称</th>
                  <th>摘要</th>
                  <th className="unit">単位</th>
                  <th>備考</th>
                  {source === "assembly" && <th className="unit">セット</th>}
                </tr>
              </thead>
              <tbody>
                {source === "assembly"
                  ? assemblyGroups.map((group) => {
                      const assembly = group.list[0];
                      const head = assemblyHead(assembly.items);
                      const band = assemblyBandColor(head?.partNumber);
                      // 同じ通常明細のセットが複数あるときだけ、中身を見て選ぶ
                      const pick = (): void => {
                        if (group.list.length === 1) callAssembly(assembly);
                        else setPickGroup(group.list);
                      };
                      return (
                        <tr
                          key={group.key}
                          className={band ? "banded" : undefined}
                          style={band ? { backgroundColor: band } : undefined}
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
                          <td className="unit">{head?.unit ?? ""}</td>
                          <td>
                            <div className="upper">
                              {head?.remarksUpper ?? ""}
                            </div>
                            <div className="lower">
                              {head?.remarksLower ?? ""}
                            </div>
                          </td>
                          <td className="unit">
                            {group.list.length === 1
                              ? `${assembly.items.filter((item) => item.note !== true).length}明細`
                              : `${group.list.length}種類`}
                          </td>
                        </tr>
                      );
                    })
                  : details.map((detail, detailIndex) => {
                      const band =
                        source === "project"
                          ? assemblyBandColor(detail.partNumber)
                          : null;
                      return (
                        <tr
                          key={`${detail.id}-${detailIndex}`}
                          className={band ? "banded" : undefined}
                          style={band ? { backgroundColor: band } : undefined}
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
                            <div className="upper">
                              {detail.descriptionUpper}
                            </div>
                            <div className="lower">
                              {detail.descriptionLower}
                            </div>
                          </td>
                          <td className="unit">{detail.unit}</td>
                          <td>
                            <div className="upper">{detail.remarksUpper}</div>
                            <div className="lower">{detail.remarksLower}</div>
                          </td>
                        </tr>
                      );
                    })}
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
                {pickGroup.map((assembly, groupIndex) => {
                  const band = assemblyBandColor(
                    assemblyHead(assembly.items)?.partNumber,
                  );
                  return (
                  <table
                    className="call-table pick"
                    key={`${assembly.scope}-${assembly.id}`}
                  >
                    {/* 1行目が全幅の見出しなので、列幅は一覧と同じ決め方でここで与える */}
                    <colgroup>
                      <col className="no" />
                      <col className="no" />
                      <col className="name" />
                      <col className="desc" />
                      <col className="unit" />
                      <col className="flex" />
                      <col className="unit" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th colSpan={7}>
                          {groupIndex + 1}．
                          {
                            assembly.items.filter((item) => item.note !== true)
                              .length
                          }
                          明細のセット
                        </th>
                      </tr>
                      <tr>
                        <th className="no">部位ID</th>
                        <th className="no">番号</th>
                        <th>部位名／名称</th>
                        <th>摘要</th>
                        <th className="unit">単位</th>
                        <th>備考</th>
                        <th className="unit">掛け率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assembly.items.map((item, itemIndex) => (
                        <tr
                          key={`${assembly.id}-${itemIndex}`}
                          className={`${item.note === true ? "note-row" : band ? "banded" : ""}`}
                          style={item.note !== true && band ? { backgroundColor: band } : undefined}
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
                            <div className="lower">
                              {item.note === true && (
                                <span className="note-mark">説</span>
                              )}
                              {item.name}
                            </div>
                          </td>
                          <td>
                            <div className="upper">{item.descriptionUpper}</div>
                            <div className="lower">{item.descriptionLower}</div>
                          </td>
                          <td className="unit">{item.unit}</td>
                          <td>
                            <div className="upper">{item.remarksUpper}</div>
                            <div className="lower">{item.remarksLower}</div>
                          </td>
                          <td className="unit">{item.coefficient}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export { evaluateCalcSheet };
