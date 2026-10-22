import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { KeyboardEvent } from "react";
import type {
  AggregateDetail,
  AggregateItem,
  AggregateItemEdit,
  AggregateRun,
  AggregateView,
  MasterOptions,
  ProjectSummary,
  Subject,
} from "@shared/types";
import {
  aggregateQuantityText,
  checkQuantityUnit,
} from "../../../../core/aggregate/aggregate";
import { displayQuantity } from "../../../../core/room/calcSheet";
import { resolveMasterName } from "@shared/masters";
import PickInput, { type PickEntry } from "../../components/PickInput";
import { useColumnWidths } from "../../hooks/useColumnWidths";
import { focusCell } from "../grid/focusCell";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import { sourceLabelOf } from "./aggregateRows";
import {
  aggregateRangeTsv,
  buildAggregateGrid,
  initialEdit,
  itemsInGridRange,
  type AggregateGridLine,
  type AggregateGridRange,
} from "./aggregateGrid";
import "../estimate/EstimatePartsPage.css";
import "./AggregatePage.css";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
  /** 数量根拠の1件から、その拾いを書いた計算書（出所）を開く */
  onOpenSource?: (detail: AggregateDetail) => void;
}

const COLUMNS = [
  "科目ID",
  "科目名称",
  "材種区分",
  "部位番号／明細番号",
  "部位名／名称",
  "摘要",
  "数量",
  "単位",
  "備考",
  "積算用表示",
] as const;

const COLUMN_WIDTHS = [54, 120, 78, 120, 190, 190, 80, 46, 120, 90];

const EDGE_SPACE = /^\s|\s$/;

/** 前後に空白（全角・半角）がある欄は目印を付ける。見た目が同じでも別の明細になるため */
function spaceMark(text: string): { className?: string; title?: string } {
  return EDGE_SPACE.test(text)
    ? { className: "edge-space", title: "前後に空白があります" }
    : {};
}

/**
 * 積算用表示を持たない入力（転記入力表・部位別雑・金物入力表・家具・設備入力表・耐火被覆の管理表）から来た明細か。
 * これらは積算用表示がいつも空なので、集計書からは直せない。
 */
function lacksEstimateDisplay(detail: AggregateDetail): boolean {
  if (detail.sourceKind === "transfer") return true;
  if (detail.sourceKind === "misc") return true;
  if (detail.sourceKind === "furniture") return true;
  return (
    detail.sourceKind === "fireproof" && detail.traceId.split(":").length === 2
  );
}

/** 番号欄の入力（空欄は未入力） */
function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 明細の前に入れる見出し（科目・部位Ⅰ・部位Ⅱ） */
function buildLines(
  items: AggregateItem[],
  subjects: Subject[],
): AggregateGridLine[] {
  const lines: AggregateGridLine[] = [];
  let subjectId: number | null | undefined;
  let part1: string | undefined;
  let part2: string | undefined;
  let unused: boolean | undefined;
  items.forEach((item) => {
    if (subjectId !== item.subjectId) {
      subjectId = item.subjectId;
      part1 = undefined;
      part2 = undefined;
      unused = undefined;
      const subject = subjects.find((row) => row.id === item.subjectId);
      lines.push({
        kind: "heading",
        heading: {
          kind: "subject",
          subjectId: item.subjectId,
          text: subject ? subject.name : "",
        },
      });
    }
    // 不要明細は工種科目の最後にまとめる（内訳書へは飛ばさない）
    if (unused !== item.unused && item.unused) {
      unused = item.unused;
      part1 = undefined;
      part2 = undefined;
      lines.push({
        kind: "heading",
        heading: { kind: "part1", subjectId: null, text: "【不要明細】" },
      });
    }
    if (part1 !== item.part1) {
      part1 = item.part1;
      part2 = undefined;
      if (item.part1 !== "")
        lines.push({
          kind: "heading",
          heading: {
            kind: "part1",
            subjectId: null,
            text: `（${item.part1}）`,
          },
        });
    }
    if (part2 !== item.part2) {
      part2 = item.part2;
      if (item.part2 !== "")
        lines.push({
          kind: "heading",
          heading: {
            kind: "part2",
            subjectId: null,
            text: `＜${item.part2}＞`,
          },
        });
    }
    lines.push({ kind: "item", item });
  });
  return lines;
}

function gridCellFromTarget(
  target: EventTarget | null,
): AggregateGridRange["anchor"] | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>("td[data-grow][data-gcol]");
  if (!cell) return null;
  const row = Number(cell.dataset.grow);
  const col = Number(cell.dataset.gcol);
  return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
}

function gridCellIntersectsRange(
  range: AggregateGridRange | null,
  row: number,
  col: number,
  rowSpan = 1,
  colSpan = 1,
): boolean {
  if (!range) return false;
  const firstRow = Math.min(range.anchor.row, range.end.row);
  const lastRow = Math.max(range.anchor.row, range.end.row);
  const firstCol = Math.min(range.anchor.col, range.end.col);
  const lastCol = Math.max(range.anchor.col, range.end.col);
  return (
    row <= lastRow &&
    row + rowSpan - 1 >= firstRow &&
    col <= lastCol &&
    col + colSpan - 1 >= firstCol
  );
}

/**
 * 集計書兼工事マスター。
 * 計算書（部屋別・軸組・汎用）と転記入力表から集計した明細を、科目→部位Ⅰ→部位Ⅱの順に並べる。
 * 行をクリックすると数量根拠（部屋別の内訳）を表示する。
 */
export default function AggregatePage({
  project,
  onBack,
  onOpenSource,
}: Props): JSX.Element {
  const [view, setView] = useState<AggregateView>({
    run: null,
    items: [],
    details: [],
  });
  const [runs, setRuns] = useState<AggregateRun[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<MasterOptions["units"]>([]);
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<AggregateItem | null>(null);
  const [edits, setEdits] = useState<Record<string, AggregateItemEdit>>({});
  const history = useUndoRedo<Record<string, AggregateItemEdit>>();
  const editsRef = useRef(edits);
  const lastEditKeyRef = useRef<string | null>(null);
  const [cellRange, setCellRange] = useState<AggregateGridRange | null>(null);
  const cellDragAnchorRef =
    useRef<AggregateGridRange["anchor"] | null>(null);
  const lastCellRef = useRef<AggregateGridRange["anchor"] | null>(null);
  const [bulkSubjectOpen, setBulkSubjectOpen] = useState(false);
  const [bulkSubjectId, setBulkSubjectId] = useState<number | "">("");
  const [message, setMessage] = useState("");
  /** 手入力行の付け直しモード（次にクリックした明細が新しい付き先） */
  const [moving, setMoving] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const basisRef = useRef<HTMLElement>(null);
  /** 数量根拠を出す高さ（選んだ明細の行に合わせる） */
  const [basisTop, setBasisTop] = useState(0);
  const replaceEdits = useCallback(
    (next: Record<string, AggregateItemEdit>) => {
      editsRef.current = next;
      setEdits(next);
    },
    [],
  );
  useEffect(() => {
    history.clear();
    lastEditKeyRef.current = null;
    setCellRange(null);
    cellDragAnchorRef.current = null;
    lastCellRef.current = null;
  }, [history.clear, view]);
  const { widths, startResize } = useColumnWidths(
    "aggregate-columns-v2",
    COLUMN_WIDTHS,
  );

  const { markSaved } = useSaveOnLeave(edits, () => saveEdits(true));

  const reload = useCallback(
    async (runId?: number) => {
      setView(await window.sekisan.getAggregate(project.id, runId));
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      replaceEdits({});
      setRawNums({});
      markSaved({});
    },
    [markSaved, project.id, replaceEdits],
  );

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects(project.id));
      setUnits((await window.sekisan.getMasterOptions(project.id)).units);
      await reload();
    })();
  }, [project.id, reload]);

  const run = useCallback(async () => {
    const result = await window.sekisan.runAggregation(project.id);
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    replaceEdits({});
    setRawNums({});
    markSaved({});
    setMessage(`集計しました（明細 ${result.items.length} 件）`);
  }, [markSaved, project.id, replaceEdits]);

  /** 集計書の欄を直す（保存を押すまでは画面の中だけ） */
  const editItem = useCallback(
    (item: AggregateItem, patch: Partial<AggregateItemEdit>) => {
      const key = `${item.masterKey}|${Object.keys(patch).sort().join(",")}`;
      const current = editsRef.current;
      if (lastEditKeyRef.current !== key) history.push({ ...current });
      lastEditKeyRef.current = key;
      replaceEdits({
        ...current,
        [item.masterKey]: {
          ...(current[item.masterKey] ?? initialEdit(item)),
          ...patch,
        },
      });
    },
    [history.push, replaceEdits],
  );

  /**
   * 数字欄の打ち途中の文字。「30.」と打ったとき直ぐに30へ整うと
   * 小数点が消えて続きが打てないので、欄を離れるまで打ったままを見せる
   */
  const [rawNums, setRawNums] = useState<Record<string, string>>({});
  const undoEdits = useCallback(() => {
    const previous = history.undo(editsRef.current);
    lastEditKeyRef.current = null;
    if (previous !== null) {
      replaceEdits(previous);
      setRawNums({});
    }
  }, [history.undo, replaceEdits]);
  const redoEdits = useCallback(() => {
    const next = history.redo(editsRef.current);
    lastEditKeyRef.current = null;
    if (next !== null) {
      replaceEdits(next);
      setRawNums({});
    }
  }, [history.redo, replaceEdits]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setCellRange(null);
        cellDragAnchorRef.current = null;
        return;
      }
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoEdits();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoEdits();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redoEdits, undoEdits]);
  const onCellMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLTableElement>) => {
      if (event.button !== 0) return;
      const cell = gridCellFromTarget(event.target);
      if (!cell) return;
      const anchor =
        event.shiftKey
          ? (cellRange?.anchor ?? lastCellRef.current ?? cell)
          : cell;
      if (!event.shiftKey) lastCellRef.current = cell;
      cellDragAnchorRef.current = anchor;
      setCellRange(
        anchor.row === cell.row && anchor.col === cell.col
          ? null
          : { anchor, end: cell },
      );
    },
    [cellRange],
  );
  const onCellMouseOver = useCallback(
    (event: ReactMouseEvent<HTMLTableElement>) => {
      const anchor = cellDragAnchorRef.current;
      if (!anchor || event.buttons !== 1) return;
      const cell = gridCellFromTarget(event.target);
      if (!cell || (anchor.row === cell.row && anchor.col === cell.col)) return;
      setCellRange({ anchor, end: cell });
      window.getSelection()?.removeAllRanges();
    },
    [],
  );
  const onCellMouseUp = useCallback(() => {
    cellDragAnchorRef.current = null;
  }, []);

  const numKey = (item: AggregateItem, field: string): string =>
    `${item.masterKey}\u0000${field}`;

  const numText = (
    item: AggregateItem,
    field: string,
    parsed: number | null,
  ): string =>
    rawNums[numKey(item, field)] ??
    (parsed === null ? "" : String(parsed));

  const numEvents = (
    item: AggregateItem,
    field: string,
    apply: (text: string) => void,
  ): {
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
  } => ({
    onChange: (event) => {
      const text = event.target.value;
      setRawNums((map) => ({ ...map, [numKey(item, field)]: text }));
      apply(text);
    },
    onBlur: () =>
      setRawNums((map) => {
        const key = numKey(item, field);
        if (!(key in map)) return map;
        const next = { ...map };
        delete next[key];
        return next;
      }),
  });

  /** 直した内容を計算書・工事の明細マスターへ書き戻し、集計をかけ直す */
  const saveEdits = useCallback(
    async (quiet = false) => {
      const list = Object.values(edits);
      if (view.run === null || list.length === 0) return;
      const result = await window.sekisan.saveAggregateEdits({
        projectId: project.id,
        runId: view.run.id,
        edits: list,
      });
      setView(result);
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      replaceEdits({});
      setRawNums({});
      markSaved({});
      setSelected(null);
      if (quiet) return;
      setMessage(
        `${list.length}件を直して計算書・明細マスターへ反映し、集計し直しました`,
      );
    },
    [edits, markSaved, project.id, replaceEdits, view.run],
  );

  /** 選んだ明細の上下に、手入力の明細行を挿入する（集計をかけ直しても残る） */
  const insertManual = useCallback(
    async (before: boolean) => {
      if (selected === null || view.run === null) return;
      const result = await window.sekisan.insertAggregateManualItem({
        projectId: project.id,
        runId: view.run.id,
        afterMasterKey: selected.masterKey,
        before,
      });
      setView(result);
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      setMessage(
        `選んだ明細の${before ? "上" : "下"}に明細行を挿入しました（集計をかけ直しても残ります。摘要・名称・数量などを直接入れられます）`,
      );
    },
    [project.id, selected, view.run],
  );

  /** 手で挿入した明細行の付け直し（次にクリックした明細へ付き替える） */
  const moveManual = useCallback(
    async (anchor: AggregateItem) => {
      if (selected === null || !selected.manual) return;
      if (anchor.masterKey === selected.masterKey) {
        setMoving(false);
        setMessage("付け直しをやめました");
        return;
      }
      const result = await window.sekisan.moveAggregateManualItem({
        projectId: project.id,
        masterKey: selected.masterKey,
        anchorMasterKey: anchor.masterKey,
      });
      setView(result);
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      setMoving(false);
      setSelected(
        result.items.find((item) => item.masterKey === selected.masterKey) ??
          null,
      );
      setMessage(
        "明細行を付け直しました（選んだ明細の上付き・下付きはそのままです）",
      );
    },
    [project.id, selected],
  );

  /** 行クリック：付け直しモードなら付き替え、ふだんは選択 */
  const clickRow = useCallback(
    (item: AggregateItem) => {
      if (moving) {
        void moveManual(item);
        return;
      }
      setSelected(item);
    },
    [moveManual, moving],
  );

  /** 手で挿入した明細行を消す（手入力行を選んだときだけ押せる） */
  const deleteManual = useCallback(async () => {
    if (selected === null || !selected.manual) return;
    if (
      !window.confirm(
        "手で挿入した明細行を消します。元に戻せません。よいですか？",
      )
    )
      return;
    const result = await window.sekisan.deleteAggregateManualItem({
      projectId: project.id,
      masterKey: selected.masterKey,
    });
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    setSelected(null);
    setMessage("手で挿入した明細行を消しました");
  }, [project.id, selected]);

  /** 不要明細の印を付ける／外す（内訳書へ飛ばさなくなる） */
  const toggleUnused = useCallback(async () => {
    if (selected === null) return;
    const result = await window.sekisan.setDetailUnused({
      projectId: project.id,
      masterKey: selected.masterKey,
      unused: !selected.unused,
    });
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    setSelected(
      result.items.find((item) => item.masterKey === selected.masterKey) ??
        null,
    );
    setMessage(
      selected.unused
        ? "不要の印を外しました（内訳書へ飛びます）"
        : "不要明細にしました（工種科目の最後にまとめ、内訳書へは飛ばしません）",
    );
  }, [project.id, selected]);

  const lines = useMemo(
    () => buildLines(view.items, subjects),
    [subjects, view.items],
  );
  const bulkSubjectTargets = useMemo(
    () =>
      cellRange
        ? itemsInGridRange(lines, cellRange)
        : selected
          ? [selected]
          : [],
    [cellRange, lines, selected],
  );
  const lineGridRows = useMemo(() => {
    let row = 0;
    return lines.map((line) => {
      const position =
        line.kind === "item"
          ? { upper: row, lower: row + 1 }
          : { upper: row, lower: null };
      row += line.kind === "item" ? 2 : 1;
      return position;
    });
  }, [lines]);
  const aggregateGrid = useMemo(
    () => buildAggregateGrid(lines, edits, subjects),
    [edits, lines, subjects],
  );
  const rangeBounds = useMemo(() => {
    if (!cellRange) return null;
    return {
      firstRow: Math.min(cellRange.anchor.row, cellRange.end.row),
      lastRow: Math.max(cellRange.anchor.row, cellRange.end.row),
      firstCol: Math.min(cellRange.anchor.col, cellRange.end.col),
      lastCol: Math.max(cellRange.anchor.col, cellRange.end.col),
    };
  }, [cellRange]);
  const rangeHeight = rangeBounds
    ? rangeBounds.lastRow - rangeBounds.firstRow + 1
    : 0;
  const rangeWidth = rangeBounds
    ? rangeBounds.lastCol - rangeBounds.firstCol + 1
    : 0;
  const canCopyRange = rangeHeight * rangeWidth > 1;
  const rangeCellClass = (
    row: number,
    col: number,
    rowSpan = 1,
    colSpan = 1,
    baseClass?: string,
  ): string | undefined => {
    const className = [
      baseClass,
      gridCellIntersectsRange(cellRange, row, col, rowSpan, colSpan)
        ? "in-range"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    return className || undefined;
  };
  const copyRangeMessage = `${rangeHeight}行×${rangeWidth}列をコピーしました（エクセルに貼れます）`;
  const onTableCopy = useCallback(
    (event: ReactClipboardEvent<HTMLTableElement>) => {
      if (!cellRange || !canCopyRange) return;
      event.preventDefault();
      event.clipboardData.setData(
        "text/plain",
        aggregateRangeTsv(aggregateGrid, cellRange),
      );
      setMessage(copyRangeMessage);
    },
    [aggregateGrid, canCopyRange, cellRange, copyRangeMessage],
  );
  const copyRange = useCallback(async () => {
    if (!cellRange || !canCopyRange) return;
    try {
      await navigator.clipboard.writeText(
        aggregateRangeTsv(aggregateGrid, cellRange),
      );
      setMessage(copyRangeMessage);
    } catch {
      setMessage("範囲をコピーできませんでした");
    }
  }, [aggregateGrid, canCopyRange, cellRange, copyRangeMessage]);
  const changeBulkSubject = useCallback(() => {
    if (bulkSubjectTargets.length === 0) return;
    const subjectId = bulkSubjectId === "" ? null : bulkSubjectId;
    const current = editsRef.current;
    history.push({ ...current });
    lastEditKeyRef.current = null;
    const next = { ...current };
    for (const item of bulkSubjectTargets) {
      next[item.masterKey] = {
        ...(current[item.masterKey] ?? initialEdit(item)),
        subjectId,
      };
    }
    replaceEdits(next);
    setBulkSubjectOpen(false);
    const subjectName =
      subjects.find((row) => row.id === subjectId)?.name ?? "（科目なし）";
    setMessage(
      `${bulkSubjectTargets.length}件の科目を「${subjectName}」に変えました（💾 修正を保存で確定します）`,
    );
  }, [
    bulkSubjectId,
    bulkSubjectTargets,
    history.push,
    replaceEdits,
    subjects,
  ]);

  /** 単位マスターの呼び出し一覧（計算書の単位欄と同じ並び） */
  const unitEntries: PickEntry[] = useMemo(
    () =>
      units.map((unit) => ({
        value: unit.name,
        label: `${unit.id}　${unit.name}`,
      })),
    [units],
  );

  /** 選んだ明細の数量根拠（合算前の1件ずつ） */
  const basis = useMemo(
    () =>
      selected === null
        ? []
        : view.details.filter(
            (detail) => detail.masterKey === selected.masterKey,
          ),
    [selected, view.details],
  );

  /** 積算用表示を直せない明細（集計キー） */
  const fixedEstimateDisplay = useMemo(
    () =>
      new Set(
        view.details
          .filter(lacksEstimateDisplay)
          .map((detail) => detail.masterKey),
      ),
    [view.details],
  );

  /**
   * 積算用表示欄まわりのカーソル移動（2行組＋縦結合セルなので専用に処理）。
   * ・積算用表示で↑↓＝上下の明細の積算用表示へ
   * ・備考（下段）から→＝積算用表示へ（積算用表示から←は備考欄下へ）
   * ・積算用表示から→は既定のまま（全体共通の移動に任せる）
   */
  const onTableKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const all =
      field.value.length > 0 && start === 0 && end === field.value.length;
    const atStart =
      start === null || end === null ? true : all || (start === 0 && end === 0);
    const atEnd =
      start === null || end === null
        ? true
        : all || (start === field.value.length && start === end);

    const columnMark =
      field.dataset.unit !== undefined
        ? "data-unit"
        : field.dataset.materialCategory !== undefined
          ? "data-material-category"
          : null;
    if (columnMark !== null) {
      // 単位欄・材種区分欄の↑↓は同じ欄の上下の明細へ移る
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const inputs = Array.from(
          field
            .closest("table")
            ?.querySelectorAll<HTMLInputElement>(`input[${columnMark}]`) ?? [],
        );
        const target =
          inputs[inputs.indexOf(field) + (event.key === "ArrowDown" ? 1 : -1)];
        if (!target) return;
        event.preventDefault();
        focusCell(target);
        target.select();
      }
      return;
    }
    if (field.dataset.estimateDisplay !== undefined) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const inputs = Array.from(
          field
            .closest("table")
            ?.querySelectorAll<HTMLInputElement>(
              "input[data-estimate-display]",
            ) ?? [],
        );
        const target =
          inputs[inputs.indexOf(field) + (event.key === "ArrowDown" ? 1 : -1)];
        if (!target) return;
        event.preventDefault();
        focusCell(target);
        target.select();
        return;
      }
      if (event.key === "ArrowLeft" && atStart) {
        const target = field
          .closest("tbody")
          ?.querySelector<HTMLInputElement>("input[data-remarks-lower]");
        if (!target) return;
        event.preventDefault();
        focusCell(target);
        target.select();
      }
      return;
    }
    if (
      field.dataset.remarksLower !== undefined &&
      event.key === "ArrowRight" &&
      atEnd
    ) {
      const target = field
        .closest("tbody")
        ?.querySelector<HTMLInputElement>("input[data-estimate-display]");
      if (!target) return;
      event.preventDefault();
      focusCell(target);
      target.select();
    }
  }, []);

  /** 左端の科目ボタン（計上された工種科目だけを出す） */
  const usedSubjects = useMemo(() => {
    const ids: number[] = [];
    view.items.forEach((item) => {
      if (item.subjectId !== null && !ids.includes(item.subjectId))
        ids.push(item.subjectId);
    });
    return ids.map((id) => ({
      id,
      name: subjects.find((row) => row.id === id)?.name ?? "",
    }));
  }, [subjects, view.items]);

  /** 科目ボタンを押すと、その科目の先頭明細まで表を送る */
  const jumpToSubject = useCallback((subjectId: number) => {
    const body = bodyRef.current;
    if (!body) return;
    const target = body.querySelector<HTMLElement>(
      `[data-subject-head="${subjectId}"]`,
    );
    if (!target) return;
    body.scrollTop +=
      target.getBoundingClientRect().top - body.getBoundingClientRect().top;
  }, []);

  const errorCount = useMemo(
    () =>
      view.items.filter(
        (item) => checkQuantityUnit(item.quantity, item.unit) !== "",
      ).length,
    [view.items],
  );

  /**
   * 数量根拠は選んだ明細の右隣に出す。
   * 画面から外れないよう、表を送ったときは見えている範囲に寄せる。
   */
  const placeBasis = useCallback(() => {
    const body = bodyRef.current;
    const panel = basisRef.current;
    if (!body || !panel) return;
    if (selected === null) {
      setBasisTop(0);
      return;
    }
    const row = body.querySelector<HTMLElement>(
      `[data-master-key="${CSS.escape(selected.masterKey)}"]`,
    );
    if (!row) return;
    const rowTop =
      row.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop;
    const lowest = Math.max(
      body.scrollTop,
      body.scrollTop + body.clientHeight - panel.offsetHeight - 8,
    );
    setBasisTop(Math.max(body.scrollTop, Math.min(rowTop, lowest)));
  }, [selected]);

  useEffect(() => {
    placeBasis();
    const body = bodyRef.current;
    if (!body) return;
    body.addEventListener("scroll", placeBasis);
    return () => body.removeEventListener("scroll", placeBasis);
  }, [basis, placeBasis]);

  return (
    <div className="estimate-page aggregate-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>集計書兼工事マスター</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => void run()}>
          🧮 集計実行
        </button>
        <button
          type="button"
          title="この画面を開いたまま、内訳書を別の窓で開きます（内訳書を見ながらこちらを直すときに使います）"
          onClick={() =>
            void window.sekisan.openProjectWindow(project.id, "statement")
          }
        >
          📑 内訳書を開く
        </button>
        <button
          type="button"
          disabled={Object.keys(edits).length === 0}
          onClick={() => void saveEdits()}
          title="直した内容を元の計算書と工事の明細マスターへ書き戻し、集計をかけ直します"
        >
          💾 修正を保存（{Object.keys(edits).length}件）
        </button>
        <button
          type="button"
          disabled={!history.canUndo}
          title="保存する前の直しを1つ戻します（Ctrl+Z）"
          onClick={undoEdits}
        >
          ↶ 戻る
        </button>
        <button
          type="button"
          disabled={!history.canRedo}
          title="戻した直しをやり直します（Ctrl+Y）"
          onClick={redoEdits}
        >
          ↷ 進む
        </button>
        <button
          type="button"
          disabled={!canCopyRange}
          onClick={() => void copyRange()}
        >
          ⧉ 範囲をコピー
        </button>
        <button
          type="button"
          disabled={bulkSubjectTargets.length === 0}
          title="範囲で選んだ明細の科目をまとめて変えます。保存するまでは ↶ 戻る で戻せます"
          onClick={() => {
            setBulkSubjectId(selected?.subjectId ?? "");
            setBulkSubjectOpen(true);
          }}
        >
          🔀 科目をまとめて変える
        </button>
        {bulkSubjectOpen && bulkSubjectTargets.length > 0 && (
          <span className="aggregate-bulk-subject">
            <select
              aria-label="変更後の科目"
              value={bulkSubjectId}
              onChange={(event) =>
                setBulkSubjectId(
                  event.target.value === "" ? "" : Number(event.target.value),
                )
              }
            >
              <option value="">（科目なし）</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.id} {subject.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={changeBulkSubject}>
              変える
            </button>
            <button
              type="button"
              onClick={() => setBulkSubjectOpen(false)}
            >
              やめる
            </button>
          </span>
        )}
        <button
          type="button"
          disabled={selected === null}
          onClick={() => void toggleUnused()}
          title="不要になった明細に印を付けます。印を付けた明細は工種科目の最後にまとめ、内訳書へは飛ばしません（計算書はそのまま残ります）"
        >
          {selected?.unused ? "↩ 不要を外す" : "🚫 不要明細にする"}
        </button>
        <button
          type="button"
          disabled={selected === null || view.run === null}
          onClick={() => void insertManual(false)}
          title="選んだ明細の下に新しい明細行を挿入します。計算書を持たない手入力の行なので、集計をかけ直しても消えずに残ります（摘要・名称・数量などを直接入れ、修正を保存で登録します）"
        >
          ＋ 下に明細行を挿入
        </button>
        <button
          type="button"
          disabled={selected === null || view.run === null}
          onClick={() => void insertManual(true)}
          title="選んだ明細の上に新しい明細行を挿入します。同じ明細が並ぶ場面で、その前に＜共通仕様＞のような説明行を付けたいときに使います"
        >
          ＋ 上に明細行を挿入
        </button>
        <button
          type="button"
          className={moving ? "on" : ""}
          disabled={selected?.manual !== true}
          onClick={() => {
            if (moving) {
              setMoving(false);
              setMessage("付け直しをやめました");
              return;
            }
            setMoving(true);
            setMessage(
              "付け直す先の明細をクリックしてください（同じ行を押すとやめます）",
            );
          }}
          title="選んだ手入力行を別の明細の上下に付け直します。明細の順番が変わったときに、説明行を付け替えるのに使います（上付き・下付きはそのまま）"
        >
          ⇅ 行を付け直す
        </button>
        <button
          type="button"
          disabled={selected?.manual !== true}
          onClick={() => void deleteManual()}
          title="手で挿入した明細行を消します（緑色の「手」印が付いた行を選んだときだけ押せます）"
        >
          🗑 手入力行を消す
        </button>
        <button
          type="button"
          className={checking ? "on" : ""}
          onClick={() => setChecking(!checking)}
        >
          🎨 数量・単位チェック（{errorCount}件）
        </button>
        <select
          value={view.run?.id ?? ""}
          onChange={(e) => void reload(Number(e.target.value))}
        >
          {runs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.createdAt} の集計
            </option>
          ))}
          {runs.length === 0 && <option value="">未集計</option>}
        </select>
        <span className="message">{message}</span>
      </div>

      <div className="aggregate-body" ref={bodyRef}>
        <nav className="subject-jump">
          {usedSubjects.map((subject) => (
            <button
              key={subject.id}
              type="button"
              title={`${subject.id} ${subject.name} の先頭へ`}
              onClick={() => jumpToSubject(subject.id)}
            >
              {subject.id} {subject.name}
            </button>
          ))}
          {usedSubjects.length === 0 && <span className="note">未集計</span>}
        </nav>
        <table
          className="parts aggregate"
          onKeyDown={onTableKeyDown}
          onMouseDownCapture={onCellMouseDown}
          onMouseOverCapture={onCellMouseOver}
          onMouseUpCapture={onCellMouseUp}
          onCopy={onTableCopy}
        >
          <colgroup>
            {COLUMNS.map((label, index) => (
              <col key={label} style={{ width: `${widths[index]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((label, index) => (
                <th key={label} className={index === 0 ? "no" : undefined}>
                  {label}
                  <span
                    className="col-resize"
                    title="ドラッグで列幅を変えられます"
                    onMouseDown={(e) => startResize(index, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          {lines.map((line, index) => {
            const gridRows = lineGridRows[index];
            if (line.kind === "heading") {
              const subject = subjects.find(
                (row) => row.id === line.heading.subjectId,
              );
              return (
                <tbody
                  key={`h${index}`}
                  className={`heading ${line.heading.kind}`}
                >
                  <tr
                    data-subject-head={
                      line.heading.kind === "subject" && subject
                        ? subject.id
                        : undefined
                    }
                  >
                    <td
                      className={rangeCellClass(gridRows.upper, 0, 1, 1, "no")}
                      data-grow={gridRows.upper}
                      data-gcol={0}
                    >
                      {line.heading.kind === "subject"
                        ? (subject?.id ?? "")
                        : ""}
                    </td>
                    <td
                      colSpan={COLUMNS.length - 1}
                      className={rangeCellClass(
                        gridRows.upper,
                        1,
                        1,
                        COLUMNS.length - 1,
                      )}
                      data-grow={gridRows.upper}
                      data-gcol={1}
                    >
                      {line.heading.text}
                    </td>
                  </tr>
                </tbody>
              );
            }
            const item = line.item;
            const check = checking
              ? checkQuantityUnit(item.quantity, item.unit)
              : "";
            const isSelected = selected?.masterKey === item.masterKey;
            const unusedClass = item.unused ? "unused" : "";
            const manualClass = item.manual ? "manual" : "";
            const upperGridRow = gridRows.upper;
            const lowerGridRow = gridRows.lower ?? upperGridRow + 1;
            const draft = edits[item.masterKey] ?? initialEdit(item);
            return (
              <tbody
                key={item.id}
                className={`row ${check} ${unusedClass} ${manualClass} ${isSelected ? "selected" : ""}`}
                data-master-key={item.masterKey}
                onClick={() => clickRow(item)}
              >
                <tr className="detail-upper">
                  <td
                    className={rangeCellClass(upperGridRow, 0, 2, 1, "no")}
                    data-grow={upperGridRow}
                    data-gcol={0}
                    rowSpan={2}
                  >
                    {draft.subjectId ?? ""}
                    {item.manual && (
                      <span
                        className="manual-mark"
                        title="手で挿入した明細行（計算書を持たない手入力の行）"
                      >
                        手
                      </span>
                    )}
                  </td>
                  <td
                    className={rangeCellClass(upperGridRow, 1, 2)}
                    data-grow={upperGridRow}
                    data-gcol={1}
                    rowSpan={2}
                  >
                    <select
                      value={draft.subjectId ?? ""}
                      title="工種科目を選び直せます"
                      onChange={(e) =>
                        editItem(item, { subjectId: toNumber(e.target.value) })
                      }
                    >
                      <option value="">（科目なし）</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.id} {subject.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td
                    className={rangeCellClass(upperGridRow, 2, 2)}
                    data-grow={upperGridRow}
                    data-gcol={2}
                    rowSpan={2}
                  >
                    <input
                      lang="ja"
                      data-material-category
                      value={draft.materialCategory}
                      {...spaceMark(draft.materialCategory)}
                      onChange={(e) =>
                        editItem(item, { materialCategory: e.target.value })
                      }
                    />
                  </td>
                  <td
                    className={rangeCellClass(upperGridRow, 3)}
                    data-grow={upperGridRow}
                    data-gcol={3}
                  >
                    <input
                      className="number"
                      value={numText(item, "partNumber", draft.partNumber)}
                      {...numEvents(item, "partNumber", (text) =>
                        editItem(item, { partNumber: toNumber(text) }),
                      )}
                    />
                  </td>
                  <td
                    className={rangeCellClass(upperGridRow, 4)}
                    data-grow={upperGridRow}
                    data-gcol={4}
                  >
                    <input
                      lang="ja"
                      value={draft.partName}
                      {...spaceMark(draft.partName)}
                      onChange={(e) =>
                        editItem(item, { partName: e.target.value })
                      }
                    />
                  </td>
                  <td
                    className={rangeCellClass(upperGridRow, 5)}
                    data-grow={upperGridRow}
                    data-gcol={5}
                  >
                    <input
                      lang="ja"
                      value={draft.descriptionUpper}
                      {...spaceMark(draft.descriptionUpper)}
                      onChange={(e) =>
                        editItem(item, { descriptionUpper: e.target.value })
                      }
                    />
                  </td>
                  <td
                    className={rangeCellClass(upperGridRow, 6)}
                    data-grow={upperGridRow}
                    data-gcol={6}
                  />
                  <td
                    className={rangeCellClass(upperGridRow, 7)}
                    data-grow={upperGridRow}
                    data-gcol={7}
                  />
                  <td
                    className={rangeCellClass(upperGridRow, 8)}
                    data-grow={upperGridRow}
                    data-gcol={8}
                  >
                    <input
                      lang="ja"
                      value={draft.remarksUpper}
                      {...spaceMark(draft.remarksUpper)}
                      onChange={(e) =>
                        editItem(item, { remarksUpper: e.target.value })
                      }
                    />
                  </td>
                  <td
                    className={rangeCellClass(
                      upperGridRow,
                      9,
                      2,
                      1,
                      "estimate-display",
                    )}
                    data-grow={upperGridRow}
                    data-gcol={9}
                    rowSpan={2}
                    title={
                      fixedEstimateDisplay.has(item.masterKey)
                        ? "積算用表示。転記入力表などから来た明細は積算用表示を持たないので直せません"
                        : "積算用表示。違うと同じ明細でも別の行になります"
                    }
                  >
                    {fixedEstimateDisplay.has(item.masterKey) ? (
                      <span {...spaceMark(item.estimateDisplay)}>
                        {item.estimateDisplay}
                      </span>
                    ) : (
                      <input
                        lang="ja"
                        data-estimate-display
                        value={draft.estimateDisplay ?? ""}
                        {...spaceMark(draft.estimateDisplay ?? "")}
                        onChange={(e) =>
                          editItem(item, { estimateDisplay: e.target.value })
                        }
                      />
                    )}
                  </td>
                </tr>
                <tr className="detail-lower">
                  <td
                    className={rangeCellClass(lowerGridRow, 3)}
                    data-grow={lowerGridRow}
                    data-gcol={3}
                  >
                    <input
                      className="number"
                      value={numText(item, "detailNumber", draft.detailNumber)}
                      {...numEvents(item, "detailNumber", (text) =>
                        editItem(item, { detailNumber: toNumber(text) }),
                      )}
                    />
                  </td>
                  <td
                    className={rangeCellClass(lowerGridRow, 4)}
                    data-grow={lowerGridRow}
                    data-gcol={4}
                  >
                    <input
                      lang="ja"
                      value={draft.name}
                      {...spaceMark(draft.name)}
                      onChange={(e) => editItem(item, { name: e.target.value })}
                    />
                  </td>
                  <td
                    className={rangeCellClass(lowerGridRow, 5)}
                    data-grow={lowerGridRow}
                    data-gcol={5}
                  >
                    <input
                      lang="ja"
                      value={draft.descriptionLower}
                      {...spaceMark(draft.descriptionLower)}
                      onChange={(e) =>
                        editItem(item, { descriptionLower: e.target.value })
                      }
                    />
                  </td>
                  <td
                    className={rangeCellClass(lowerGridRow, 6, 1, 1, "number")}
                    data-grow={lowerGridRow}
                    data-gcol={6}
                  >
                    {item.manual ? (
                      <input
                        className="number"
                        title="数量。手入力行は計算書を持たないので直接入れます"
                        value={numText(
                          item,
                          "quantity",
                          draft.quantity ?? item.quantity,
                        )}
                        {...numEvents(item, "quantity", (text) =>
                          editItem(item, { quantity: toNumber(text) ?? 0 }),
                        )}
                      />
                    ) : (
                      aggregateQuantityText(item.quantity, draft.unit)
                    )}
                  </td>
                  <td
                    className={rangeCellClass(lowerGridRow, 7)}
                    data-grow={lowerGridRow}
                    data-gcol={7}
                  >
                    <PickInput
                      entries={unitEntries}
                      halfWidth
                      popupSide="right"
                      dataAttrs={{ "data-unit": "" }}
                      value={draft.unit}
                      title="単位。一覧から選べます。番号を打つと単位の文字に変わります"
                      onCommit={(text) =>
                        editItem(item, {
                          unit: resolveMasterName(units, text),
                        })
                      }
                    />
                  </td>
                  <td
                    className={rangeCellClass(lowerGridRow, 8)}
                    data-grow={lowerGridRow}
                    data-gcol={8}
                  >
                    <input
                      lang="ja"
                      data-remarks-lower
                      value={draft.remarksLower}
                      {...spaceMark(draft.remarksLower)}
                      onChange={(e) =>
                        editItem(item, { remarksLower: e.target.value })
                      }
                    />
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>

        <aside
          className="basis"
          ref={basisRef}
          style={{ transform: `translateY(${basisTop}px)` }}
        >
          <div className="section-bar">
            <span>数量根拠（部屋ごとの拾い）</span>
          </div>
          {selected === null && (
            <p className="note">明細をクリックしてください。</p>
          )}
          {selected !== null && (
            <>
              <p className="title">
                {selected.partName} {selected.name}　合計{" "}
                {displayQuantity(selected.quantity)} {selected.unit}
              </p>
              <table className="parts">
                <thead>
                  <tr>
                    <th>部屋（部位Ⅱ：部位Ⅲ）</th>
                    <th>数量</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.rooms.map((room) => (
                    <tr key={room.roomName}>
                      <td>{room.roomName}</td>
                      <td className="number">
                        {displayQuantity(room.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="section-bar">
                <span>計算書の拾い1件ごと</span>
              </div>
              <table className="parts">
                <thead>
                  <tr>
                    <th>出所</th>
                    <th>部屋</th>
                    <th>累計</th>
                    <th>掛け率</th>
                    <th>倍率</th>
                    <th>計上</th>
                  </tr>
                </thead>
                <tbody>
                  {basis.map((detail) => (
                    <tr key={detail.id}>
                      <td className="source">
                        {onOpenSource ? (
                          <button
                            type="button"
                            className="link"
                            title={`${sourceLabelOf(detail.sourceKind)} を開く`}
                            onClick={() => onOpenSource(detail)}
                          >
                            📐 {sourceLabelOf(detail.sourceKind)}
                          </button>
                        ) : (
                          sourceLabelOf(detail.sourceKind)
                        )}
                      </td>
                      <td>{`${detail.part2Raw} ${detail.part3}`.trim()}</td>
                      <td className="number">
                        {displayQuantity(detail.setTotal)}
                      </td>
                      <td className="number">{detail.coefficient}</td>
                      <td className="number">{detail.multiplier}</td>
                      <td className="number">
                        {displayQuantity(detail.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note">
                転記入力表の分は集計書には計上しますが、根拠集計（部屋別）には出しません。
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
