import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "@shared/types";
import {
  columnFloorLabels,
  normalizeCommonRows,
  normalizeFloorList,
  resolveCommonRow,
  resolveFloorHeight,
  resolveSize,
  type FireproofCommonRow,
  type FireproofFloorList,
} from "../../../../core/fireproof/fireproofList";
import {
  BEAM_HALF,
  beamLength,
  beamSlopeLength,
  columnKey,
  columnNumbers,
  dividedBeams,
  emptyFloor,
  enclosingRegion,
  GIRDER_HALF,
  type ColumnHalfOf,
  type HalfWidthOf,
  columnExists,
  auxLinePosition,
  diagEnds,
  diagGirderPosition,
  girderEndCuts,
  girderExists,
  girderKey,
  girderNumber,
  girderOffset,
  missingJointKeys,
  nudgeBeam,
  parseDrawing,
  refitBeams,
  parseSpanList,
  positions,
  spanListText,
  xGridLabel,
  yGridLabel,
  type DrawingRegion,
  type FireproofDrawing,
  type FireproofDrawingAuxLine,
  type FireproofDrawingBeam,
  type FireproofDrawingDiagGirder,
  type FireproofDrawingFloor,
} from "../../../../core/fireproof/fireproofDrawing";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { toHalfWidth } from "@shared/tsv";
import "./EstimatePartsPage.css";
import "./FireproofDrawingPage.css";

interface Props {
  project: ProjectSummary;
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

/** 画像書き出しの細かさ（1mmあたりの画素数） */
const EXPORT_PPM = 0.12;

/* 図面のレイアウト（mm）。寸法線と通し芯ラベルのぶんを余白にとる */
const MARGIN_TOP = 3000;
const MARGIN_LEFT = 3000;
const MARGIN_RIGHT = 1500;
const MARGIN_BOTTOM = 1500;
const GRID_EXT = 1000; // 柱線を外側にはみ出させる長さ
const DIM_OFFSET = 1900; // 寸法線を図形の外側に置く距離
const BUBBLE_Y = 750; // 通し芯ラベルを図形の外側に置く距離
const BUBBLE_R = 290;
const COL_HALF = 120; // 柱の四角の半幅
const FONT_DIM = 400;
const FONT_BUBBLE = 420;
const FONT_SYMBOL = 430;
const FONT_NO = 260;
const JOINT_R = 150; // 取合記号の○印の半径
const FONT_JOINT = 280;

/** 高さのmmをm表示に（整数も小数第2位まで 3000→3.00、mm精度はそのまま） */
function heightMetersText(mm: number): string {
  return (mm / 1000).toFixed(3).replace(/(\.\d\d)0$/, "$1");
}

/** 通りごとの柱の高さの1マス入力（m）。入力中は打った文字をそのまま残し、
   欄から出たときにきれいな形へ直す（直打ちだと「3.」が即座に消えるため） */
function AxisHeightInput({
  mm,
  placeholder,
  onChange,
}: {
  mm: number | undefined;
  placeholder: string;
  onChange: (mm: number | null) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() =>
    mm === undefined ? "" : heightMetersText(mm),
  );
  useEffect(() => {
    if (!editing) setText(mm === undefined ? "" : heightMetersText(mm));
  }, [mm, editing]);
  return (
    <input
      lang="en"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        setText(mm === undefined ? "" : heightMetersText(mm));
      }}
      onChange={(event) => {
        const typed = toHalfWidth(event.target.value).replaceAll(",", ".");
        setText(typed);
        const t = typed.trim();
        if (t === "") {
          onChange(null);
          return;
        }
        const meters = Number(t);
        if (Number.isFinite(meters) && meters > 0)
          onChange(Math.round(meters * 1000));
      }}
    />
  );
}

/** X軸方向の寸法線（上側）。extra は補助線の位置・離れ寸法（そこまで寸法線を伸ばす） */
function XDimension({
  xs,
  extra,
}: {
  xs: number[];
  extra?: { pos: number; offset: number }[];
}): JSX.Element {
  const first = xs[0];
  const last = Math.max(xs[xs.length - 1] ?? 0, ...(extra ?? []).map((e) => e.pos));
  const y = -DIM_OFFSET;
  return (
    <g className="dim">
      <line x1={first - 700} y1={y} x2={last + 700} y2={y} />
      {xs.map((x) => (
        <g key={x}>
          <line x1={x} y1={y - 300} x2={x} y2={-BUBBLE_Y - BUBBLE_R - 80} />
          <line x1={x - 90} y1={y + 90} x2={x + 90} y2={y - 90} />
        </g>
      ))}
      {xs.slice(0, -1).map((x, i) => {
        const span = xs[i + 1] - x;
        return (
          <text
            key={i}
            x={(x + xs[i + 1]) / 2}
            y={y - 140}
            textAnchor="middle"
            fontSize={FONT_DIM}
          >
            {span.toLocaleString("ja-JP")}
          </text>
        );
      })}
      {(extra ?? []).map((e, i) => (
        <g key={`ex${i}`}>
          <line x1={e.pos} y1={y - 300} x2={e.pos} y2={-BUBBLE_Y - BUBBLE_R - 80} />
          <line x1={e.pos - 90} y1={y + 90} x2={e.pos + 90} y2={y - 90} />
          <text
            x={e.pos}
            y={y - 140}
            textAnchor="middle"
            fontSize={FONT_DIM}
          >
            {Math.abs(e.offset).toLocaleString("ja-JP")}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Y軸方向の寸法線（左側）。extra は補助線の位置・離れ寸法（そこまで寸法線を伸ばす） */
function YDimension({
  ys,
  extra,
}: {
  ys: number[];
  extra?: { pos: number; offset: number }[];
}): JSX.Element {
  const first = ys[0];
  const last = Math.max(ys[ys.length - 1] ?? 0, ...(extra ?? []).map((e) => e.pos));
  const x = -DIM_OFFSET;
  return (
    <g className="dim">
      <line x1={x} y1={first - 700} x2={x} y2={last + 700} />
      {ys.map((y) => (
        <g key={y}>
          <line x1={x - 300} y1={y} x2={-BUBBLE_Y - BUBBLE_R - 80} y2={y} />
          <line x1={x - 90} y1={y + 90} x2={x + 90} y2={y - 90} />
        </g>
      ))}
      {ys.slice(0, -1).map((y, i) => {
        const span = ys[i + 1] - y;
        return (
          <text
            key={i}
            x={x - 200}
            y={(y + ys[i + 1]) / 2}
            textAnchor="middle"
            fontSize={FONT_DIM}
            transform={`rotate(-90 ${x - 200} ${(y + ys[i + 1]) / 2})`}
          >
            {span.toLocaleString("ja-JP")}
          </text>
        );
      })}
      {(extra ?? []).map((e, i) => (
        <g key={`ey${i}`}>
          <line x1={x - 300} y1={e.pos} x2={-BUBBLE_Y - BUBBLE_R - 80} y2={e.pos} />
          <line x1={x - 90} y1={e.pos + 90} x2={x + 90} y2={e.pos - 90} />
          <text
            x={x - 200}
            y={e.pos}
            textAnchor="middle"
            fontSize={FONT_DIM}
            transform={`rotate(-90 ${x - 200} ${e.pos})`}
          >
            {Math.abs(e.offset).toLocaleString("ja-JP")}
          </text>
        </g>
      ))}
    </g>
  );
}

/** 記号リストの1行（通りが替わるところは gap で少し間を空ける） */
interface SymbolRow {
  no: number;
  at: string;
  key: string;
  gap: boolean;
}

/** クリップボードへ書き出す（Electron環境で確実な textarea+execCommand 方式） */
function copyToClipboard(text: string): void {
  if (navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

/**
 * 記号の入力欄（柱・大梁共通）。
 * 番号・通りのラベルをドラッグするとエクセルのように範囲選択でき、
 * Ctrl+Cで写し・貼る欄でCtrl+V（複数行は下へ続けて入る）・Deleteで消せる。
 */
function SymbolList({
  rows,
  values,
  onValues,
  emptyHint,
  onActiveRow,
  known,
  onSelChange,
  none,
  onToggleNone,
  selectedKey,
}: {
  rows: SymbolRow[];
  values: Record<string, string>;
  onValues: (next: Record<string, string>) => void;
  emptyHint: string;
  /** 入力欄・行を触ったとき、図のどこかを教えるための呼び出し */
  onActiveRow?: (row: SymbolRow) => void;
  /** リストに登録済みの記号。これに無い記号は入力欄を赤くする */
  known?: ReadonlySet<string>;
  /** 範囲指定の変化を外へ知らせる（図に点線の範囲を出す用） */
  onSelChange?: (sel: { from: number; to: number } | null) => void;
  /** 「無し」チェックの行のキー（記号は残るがその場所に部材は置かない） */
  none?: ReadonlySet<string>;
  /** 「無し」チェックの切替 */
  onToggleNone?: (key: string, on: boolean) => void;
  /** 図で選んだ行（その行までスクロールして入力欄に移る） */
  selectedKey?: string | null;
}): JSX.Element {
  const [sel, setSel] = useState<{ from: number; to: number } | null>(null);
  const dragSel = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const up = () => {
      dragSel.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  useEffect(() => {
    onSelChange?.(sel);
  }, [sel, onSelChange]);

  /* 図で部材をクリックしたとき、その行が見える位置まで動き・入力欄に移る */
  useEffect(() => {
    if (selectedKey === undefined || selectedKey === null) return;
    const index = rows.findIndex((row) => row.key === selectedKey);
    if (index < 0) return;
    const input = boxRef.current?.querySelector<HTMLInputElement>(
      `input[data-row="${index}"]`,
    );
    input?.scrollIntoView({ block: "nearest" });
    input?.focus({ preventScroll: true });
    input?.select();
  }, [selectedKey]);

  const inSel = (index: number): boolean =>
    sel !== null &&
    index >= Math.min(sel.from, sel.to) &&
    index <= Math.max(sel.from, sel.to);

  const selRows = (): SymbolRow[] => {
    if (sel === null) return [];
    const a = Math.min(sel.from, sel.to);
    const b = Math.max(sel.from, sel.to);
    return rows.slice(a, b + 1);
  };

  /* まとめて選ぶときの基準（ふつうに押した行。Shift+クリックはここから先までを選ぶ） */
  const anchorRef = useRef(0);

  const pick = (index: number, shift: boolean) => {
    dragSel.current = true;
    if (shift) {
      setSel({ from: anchorRef.current, to: index });
    } else {
      anchorRef.current = index;
      setSel({ from: index, to: index });
    }
    boxRef.current?.focus();
    const row = rows[index];
    if (row !== undefined) onActiveRow?.(row);
  };

  const extend = (index: number) => {
    if (!dragSel.current) return;
    setSel((before) =>
      before === null ? { from: index, to: index } : { ...before, to: index },
    );
  };

  const pasteAt = (start: number, text: string) => {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (lines[lines.length - 1] === "") lines.pop(); // エクセル由来の末尾改行
    if (lines.length === 0) return;
    const next = { ...values };
    if (lines.length === 1 && sel !== null && sel.from !== sel.to) {
      // 選択範囲へ1つの値を一括で入れる（エクセルと同じ）
      const only = (lines[0] ?? "").split("\t")[0] ?? "";
      selRows().forEach((row) => {
        next[row.key] = only.trim();
      });
    } else {
      lines.forEach((line, i) => {
        const row = rows[start + i];
        if (row === undefined) return;
        next[row.key] = line.split("\t")[0].trim();
      });
    }
    onValues(next);
    setSel(null);
  };

  const handleKey = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || sel === null) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      copyToClipboard(
        selRows()
          .map((row) => values[row.key] ?? "")
          .join("\n"),
      );
      event.preventDefault();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      const next = { ...values };
      selRows().forEach((row) => {
        delete next[row.key];
      });
      onValues(next);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      setSel(null);
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const d = event.key === "ArrowDown" ? 1 : -1;
      if (event.shiftKey) {
        setSel({
          ...sel,
          to: Math.min(rows.length - 1, Math.max(0, sel.to + d)),
        });
      } else {
        const i = Math.min(rows.length - 1, Math.max(0, sel.to + d));
        setSel({ from: i, to: i });
      }
      event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      const i = Math.min(rows.length - 1, sel.to + 1);
      setSel({ from: i, to: i });
      event.preventDefault();
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const text = event.clipboardData.getData("text");
    if (text === "") return;
    let start = sel?.from ?? 0;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT") {
      const index = Number((target as HTMLInputElement).dataset.row ?? -1);
      if (index >= 0) start = index;
    }
    event.preventDefault();
    pasteAt(start, text);
  };

  return (
    <div
      className="symbol-list"
      ref={boxRef}
      tabIndex={-1}
      onKeyDown={handleKey}
      onPaste={handlePaste}
    >
      {rows.length === 0 && <p className="hint">{emptyHint}</p>}
      {rows.map((row, index) => (
        <div
          className={`symbol-row${row.gap ? " gap" : ""}${inSel(index) ? " sel" : ""}${row.key === selectedKey ? " pick" : ""}`}
          key={row.key}
        >
          <span
            className="row-label"
            onMouseDown={(event) => {
              event.preventDefault();
              pick(index, event.shiftKey);
            }}
            onMouseEnter={() => extend(index)}
          >
            <span className="no">{row.no}</span>
            <span className="at">{row.at}</span>
          </span>
          <input
            data-row={index}
            className={
              known !== undefined &&
              (values[row.key] ?? "").trim() !== "" &&
              !known.has((values[row.key] ?? "").trim())
                ? "bad"
                : undefined
            }
            value={values[row.key] ?? ""}
            placeholder={row.key.startsWith("x:") || row.key.startsWith("y:") ? "G1" : "C1"}
            onFocus={() => {
              setSel(null);
              onActiveRow?.(row);
            }}
            onChange={(event) =>
              onValues({ ...values, [row.key]: event.target.value })
            }
          />
          {onToggleNone !== undefined && (
            <label
              className={`none${none?.has(row.key) === true ? " on" : ""}`}
              title="この場所には部材を置きません（記号は残ります）"
            >
              <input
                type="checkbox"
                checked={none?.has(row.key) === true}
                onChange={(event) =>
                  onToggleNone(row.key, event.target.checked)
                }
              />
              無
            </label>
          )}
        </div>
      ))}
      {rows.length > 0 && (
        <p className="hint">
          番号のところをドラッグすると範囲を選べます（Ctrl+Cで写す・Ctrl+Vで入れる・Deleteで消す）
        </p>
      )}
    </div>
  );
}

/** 区画が同じ場所か（Shift+クリックで選んだものの重複判定用） */
const sameRegion = (a: DrawingRegion, b: DrawingRegion): boolean =>
  Math.abs(a.x - b.x) <= 1 &&
  Math.abs(a.y - b.y) <= 1 &&
  Math.abs(a.width - b.width) <= 1 &&
  Math.abs(a.height - b.height) <= 1;

/** 柱がある交点なら true */
function hasColumn(
  floor: FireproofDrawingFloor,
  xi: number,
  yi: number,
): boolean {
  return columnExists(floor, xi, yi);
}

/**
 * 1階分の鉄骨伏図（SVG）。座標はmm。
 * 柱線（一点鎖線）→ 交点の柱 → 柱間の大梁 → 区画の小梁 と、リストの番号を薄く添える。
 * 大梁の端は柱の四角の端（柱面中心）。柱が無い交点は格子線の点で終わる。
 */
function FloorSvg({
  floor,
  regions,
  focus,
  selectedBeams,
  girderSel,
  onRegionClick,
  onBeamPointerDown,
  onPointerMove,
  onPointerUp,
  onColumnPick,
  onGirderPick,
  onDiagPick,
  diagMode,
  diagStart,
  onIntersectionPick,
  onLinePick,
  auxMode,
  onAuxBasePick,
  knownColumns,
  knownBeams,
  halfWidthOf,
  columnHalfOf,
  girderOffsetOf,
  onJointClick,
  jointMissing,
  displaySize,
  svgRef,
}: {
  floor: FireproofDrawingFloor;
  regions: DrawingRegion[];
  /** ③大梁リストで範囲指定した梁（点線で図に出す） */
  girderSel?: ReadonlySet<string>;
  focus: { x: number; y: number; width: number; height: number } | null;
  selectedBeams: ReadonlySet<number>;
  onRegionClick: (x: number, y: number, additive: boolean) => void;
  onBeamPointerDown: (index: number, event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  /** 図の柱をクリックしたとき（柱のキー "xi,yi"） */
  onColumnPick?: (key: string) => void;
  /** 図の大梁をクリックしたとき（大梁のキー "x:0,0" など） */
  onGirderPick?: (key: string) => void;
  /** 図の斜梁をクリックしたとき（斜梁の行番号） */
  onDiagPick?: (index: number) => void;
  /** 「斜梁を足す」モード中（交点をクリックして2点を選ぶ） */
  diagMode?: boolean;
  /** 斜梁の始点に選んだ点（交点、または線上の点 mm） */
  diagStart?: { xi: number; yi: number } | { pt: { x: number; y: number } } | null;
  /** 斜梁モードで交点をクリックしたとき */
  onIntersectionPick?: (xi: number, yi: number) => void;
  /** 斜梁モードで引いた梁・柱の線上の点をクリックしたとき（mm） */
  onLinePick?: (x: number, y: number) => void;
  /** 「寸法線を足す」モード中（寸法線をクリックして基になる線を選ぶ） */
  auxMode?: boolean;
  /** 寸法線を足すモードで柱線をクリックしたとき（向きとその通りの番号） */
  onAuxBasePick?: (axis: "x" | "y", base: number) => void;
  /** リストに登録済みの記号（無い記号は赤で示す） */
  knownColumns: ReadonlySet<string>;
  knownBeams: ReadonlySet<string>;
  /** 記号→部材幅の半分（mm）。梁を実際の幅で2本線に描き、内内寸法にも使う */
  halfWidthOf?: HalfWidthOf;
  /** 柱記号→柱の四角の半分（横×縦 mm）。大梁の端を柱の面に合わせる */
  columnHalfOf?: (symbol: string) => { hw: number; hd: number } | null;
  /** 大梁キー→芯からのずらし量（mm。端寄せした梁の位置） */
  girderOffsetOf?: (key: string) => number;
  /** 取合記号の○印をクリックしたとき（キー "c:柱キー"・"g:大梁キー"・"b:小梁番号"） */
  onJointClick?: (key: string) => void;
  /** 取合記号が入っていない部材のキー（未入力表示のときだけ入れる。該当部材を点滅させる） */
  jointMissing?: ReadonlySet<string>;
  /** 表示サイズ（px）。画面に収める大きさ×拡大率を外から渡す */
  displaySize?: { width: number; height: number };
  svgRef: React.Ref<SVGSVGElement>;
}): JSX.Element {
  const xs = positions(floor.xSpans);
  const ys = positions(floor.ySpans);
  const auxX = (floor.auxLines ?? [])
    .filter((line) => line.axis === "x")
    .map((line) => ({ line, pos: auxLinePosition(floor, line) }))
    .filter(
      (e): e is { line: FireproofDrawingAuxLine; pos: number } =>
        e.pos !== null,
    );
  const auxY = (floor.auxLines ?? [])
    .filter((line) => line.axis === "y")
    .map((line) => ({ line, pos: auxLinePosition(floor, line) }))
    .filter(
      (e): e is { line: FireproofDrawingAuxLine; pos: number } =>
        e.pos !== null,
    );
  const totalX = Math.max(
    xs[xs.length - 1] ?? 0,
    ...auxX.map((e) => e.pos),
  );
  const totalY = Math.max(
    ys[ys.length - 1] ?? 0,
    ...auxY.map((e) => e.pos),
  );
  const width = totalX + MARGIN_LEFT + MARGIN_RIGHT;
  const height = totalY + MARGIN_TOP + MARGIN_BOTTOM;
  const numbers = columnNumbers(floor);
  /* 「無し」の柱を挟んで十字になる大梁：負けた側の区間端の詰め（優先側の面までで止める） */
  const gCuts = girderEndCuts(floor, halfWidthOf);

  /* 取合記号の○印（梁の端のそばに出す。クリックで記号を入れ直せる） */
  const Joint = ({
    jointKey,
    x,
    y,
  }: {
    jointKey: string;
    x: number;
    y: number;
  }) => {
    const symbol = floor.jointSymbols?.[jointKey] ?? "";
    return (
      <g
        className={`joint${symbol !== "" ? " on" : ""}`}
        onPointerDown={(event) => {
          event.stopPropagation();
          onJointClick?.(jointKey);
        }}
      >
        <circle cx={x} cy={y} r={JOINT_R} />
        {symbol !== "" && (
          <text
            x={x}
            y={y + FONT_JOINT * 0.36}
            textAnchor="middle"
            fontSize={FONT_JOINT}
          >
            {symbol}
          </text>
        )}
      </g>
    );
  };

  const content = (
    <g transform={`translate(${MARGIN_LEFT} ${MARGIN_TOP})`}>
      {/* 柱線（一点鎖線） */}
      <g className="grid">
        {xs.map((x) => (
          <line key={`gx${x}`} x1={x} y1={-GRID_EXT} x2={x} y2={totalY + GRID_EXT} />
        ))}
        {ys.map((y) => (
          <line key={`gy${y}`} x1={-GRID_EXT} y1={y} x2={totalX + GRID_EXT} y2={y} />
        ))}
      </g>
      {/* 補助寸法線（柱線とは別。直行する寸法線・柱線はこの線まで伸ばす） */}
      <g className="aux">
        {auxX.map((e, i) => (
          <line
            key={`aux${i}`}
            x1={e.pos}
            y1={-GRID_EXT}
            x2={e.pos}
            y2={totalY + GRID_EXT}
          />
        ))}
        {auxY.map((e, i) => (
          <line
            key={`auy${i}`}
            x1={-GRID_EXT}
            y1={e.pos}
            x2={totalX + GRID_EXT}
            y2={e.pos}
          />
        ))}
      </g>
      {floor.xSpans.length > 0 && (
        <XDimension
          xs={xs}
          extra={auxX.map((e) => ({ pos: e.pos, offset: e.line.offset }))}
        />
      )}
      {floor.ySpans.length > 0 && (
        <YDimension
          ys={ys}
          extra={auxY.map((e) => ({ pos: e.pos, offset: e.line.offset }))}
        />
      )}
      {/* 通し芯ラベル（Xは左から1,2,3…・Yは下からA,B,C…） */}
      <g className="axis">
        {xs.map((x, xi) => (
          <g key={`ax${x}`}>
            <circle cx={x} cy={-BUBBLE_Y} r={BUBBLE_R} />
            <text x={x} y={-BUBBLE_Y + FONT_BUBBLE * 0.36} textAnchor="middle" fontSize={FONT_BUBBLE}>
              {xGridLabel(xi)}
            </text>
          </g>
        ))}
        {ys.map((y, yi) => (
          <g key={`ay${y}`}>
            <circle cx={-BUBBLE_Y} cy={y} r={BUBBLE_R} />
            <text x={-BUBBLE_Y} y={y + FONT_BUBBLE * 0.36} textAnchor="middle" fontSize={FONT_BUBBLE}>
              {yGridLabel(ys.length - 1 - yi)}
            </text>
          </g>
        ))}
      </g>
      {/* 選んだ区画（Shift+クリックで複数）と入力欄に対応する場所の色付け */}
      {regions.map((part, index) => (
        <rect
          key={`sel${index}`}
          className="selection"
          x={part.x}
          y={part.y}
          width={part.width}
          height={part.height}
        />
      ))}
      {focus !== null && (
        <rect
          className="selection focus"
          x={focus.x}
          y={focus.y}
          width={focus.width}
          height={focus.height}
        />
      )}
      {/* ③大梁リストで範囲指定した分を点線で示す */}
      {girderSel !== undefined &&
        [...girderSel].map((key) => {
          const [axis, point] = key.split(":");
          const [xi, yi] = point.split(",").map(Number);
          const off = girderOffsetOf?.(key) ?? 0;
          if (
            axis === "x" &&
            xi >= 0 &&
            xi < xs.length - 1 &&
            yi >= 0 &&
            yi < ys.length
          )
            return (
              <rect
                key={`gs${key}`}
                className="selection girder-sel"
                x={xs[xi]}
                y={ys[yi] + off - 500}
                width={xs[xi + 1] - xs[xi]}
                height={1000}
              />
            );
          if (
            axis === "y" &&
            yi >= 0 &&
            yi < ys.length - 1 &&
            xi >= 0 &&
            xi < xs.length
          )
            return (
              <rect
                key={`gs${key}`}
                className="selection girder-sel"
                x={xs[xi] + off - 500}
                y={ys[yi]}
                width={1000}
                height={ys[yi + 1] - ys[yi]}
              />
            );
          return null;
        })}
      {/* ④小梁の入力行で選んだ分を点線で囲む */}
      {[...selectedBeams].map((index) => {
        const beam = floor.beams[index];
        if (beam === undefined) return null;
        const x = Math.min(beam.x1, beam.x2) - 500;
        const y = Math.min(beam.y1, beam.y2) - 500;
        return (
          <rect
            key={`bs${index}`}
            className="selection girder-sel"
            x={x}
            y={y}
            width={Math.abs(beam.x2 - beam.x1) + 1000}
            height={Math.abs(beam.y2 - beam.y1) + 1000}
          />
        );
      })}
      {/* 大梁（柱間の区間。2本線で描く。端は柱の面＝柱の四角の端。
          柱の大きさはリストの寸法で、無いときは決まった大きさ） */}
      <g className="girder">
        {Object.entries(floor.girders).map(([key, symbol]) => {
          if (!girderExists(floor, key)) return null;
          const [axis, point] = key.split(":");
          const [xi, yi] = point.split(",").map(Number);
          const cut = gCuts[key];
          const colAt = (ax: number, ay: number) => {
            if (!hasColumn(floor, ax, ay)) return 0;
            const sym = (floor.columns[columnKey(ax, ay)] ?? "").trim();
            return columnHalfOf?.(sym) ?? { hw: COL_HALF, hd: COL_HALF };
          };
          if (axis === "x" && xi >= 0 && xi < xs.length - 1 && yi >= 0 && yi < ys.length) {
            const c1 = colAt(xi, yi);
            const c2 = colAt(xi + 1, yi);
            const x1 = xs[xi] + (c1 === 0 ? 0 : c1.hw) + (cut?.start ?? 0);
            const x2 = xs[xi + 1] - (c2 === 0 ? 0 : c2.hw) - (cut?.end ?? 0);
            const y = ys[yi] + (girderOffsetOf?.(key) ?? 0);
            const mx = (x1 + x2) / 2;
            const bad = symbol.trim() !== "" && !knownBeams.has(symbol.trim());
            const gh = halfWidthOf?.(symbol.trim()) ?? GIRDER_HALF;
            const miss = jointMissing?.has(`g:${key}`) === true;
            return (
              <g
                key={key}
                className={`${bad ? "bad" : ""}${miss ? " miss" : ""}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onGirderPick?.(key);
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <line x1={x1} y1={y - gh} x2={x2} y2={y - gh} />
                <line x1={x1} y1={y + gh} x2={x2} y2={y + gh} />
                <text x={mx} y={y - gh - 120} textAnchor="middle" fontSize={FONT_SYMBOL}>
                  {symbol}
                </text>
                {/* つかみやすくするための太い透明な線 */}
                <line className="hit" x1={x1} y1={y} x2={x2} y2={y} />
              </g>
            );
          }
          if (axis === "y" && yi >= 0 && yi < ys.length - 1 && xi >= 0 && xi < xs.length) {
            const c1 = colAt(xi, yi);
            const c2 = colAt(xi, yi + 1);
            const y1 = ys[yi] + (c1 === 0 ? 0 : c1.hd) + (cut?.start ?? 0);
            const y2 = ys[yi + 1] - (c2 === 0 ? 0 : c2.hd) - (cut?.end ?? 0);
            const x = xs[xi] + (girderOffsetOf?.(key) ?? 0);
            const my = (y1 + y2) / 2;
            const bad = symbol.trim() !== "" && !knownBeams.has(symbol.trim());
            const gh = halfWidthOf?.(symbol.trim()) ?? GIRDER_HALF;
            const miss = jointMissing?.has(`g:${key}`) === true;
            return (
              <g
                key={key}
                className={`${bad ? "bad" : ""}${miss ? " miss" : ""}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onGirderPick?.(key);
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <line x1={x - gh} y1={y1} x2={x - gh} y2={y2} />
                <line x1={x + gh} y1={y1} x2={x + gh} y2={y2} />
                <text
                  x={x + gh + 160}
                  y={my}
                  textAnchor="middle"
                  fontSize={FONT_SYMBOL}
                  transform={`rotate(-90 ${x + gh + 160} ${my})`}
                >
                  {symbol}
                </text>
                {/* つかみやすくするための太い透明な線 */}
                <line className="hit" x1={x} y1={y1} x2={x} y2={y2} />
              </g>
            );
          }
          return null;
        })}
        {/* 斜梁（2つの交点どうしを結ぶ大梁。端は柱の面） */}
        {(floor.diagGirders ?? []).map((g, index) => {
          const ends = diagEnds(xs, ys, g);
          if (ends === null) return null;
          const { x1, y1, x2, y2 } = ends;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const plan = Math.hypot(dx, dy);
          if (plan <= 0) return null;
          const ux = dx / plan;
          const uy = dy / plan;
          const nx = -uy;
          const ny = ux;
          const gh = halfWidthOf?.(g.symbol.trim()) ?? GIRDER_HALF;
          const off = g.offset ?? 0;
          const ox = nx * off;
          const oy = ny * off;
          /** 両端の柱の、斜め方向の面ぶん。線上の点を端にしたときはその場所が端 */
          const faceAt = (
            xi: number,
            yi: number,
            free?: { x: number; y: number },
          ): number => {
            if (free !== undefined) return 0;
            if (!hasColumn(floor, xi, yi)) return 0;
            const sym = (floor.columns[columnKey(xi, yi)] ?? "").trim();
            const h = columnHalfOf?.(sym) ?? { hw: COL_HALF, hd: COL_HALF };
            return h.hw * Math.abs(ux) + h.hd * Math.abs(uy);
          };
          const ax1 = x1 + ux * faceAt(g.fx, g.fy, g.fromMm);
          const ay1 = y1 + uy * faceAt(g.fx, g.fy, g.fromMm);
          const ax2 = x2 - ux * faceAt(g.tx, g.ty, g.toMm);
          const ay2 = y2 - uy * faceAt(g.tx, g.ty, g.toMm);
          const mx = (ax1 + ax2) / 2;
          const my = (ay1 + ay2) / 2;
          const bad = g.symbol.trim() !== "" && !knownBeams.has(g.symbol.trim());
          const miss =
            jointMissing?.has(`d:${g.id ?? `#${index}`}`) === true;
          return (
            <g
              key={`d${index}`}
              className={`diag${bad ? " bad" : ""}${miss ? " miss" : ""}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onDiagPick?.(index);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <line
                x1={ax1 + nx * gh + ox}
                y1={ay1 + ny * gh + oy}
                x2={ax2 + nx * gh + ox}
                y2={ay2 + ny * gh + oy}
              />
              <line
                x1={ax1 - nx * gh + ox}
                y1={ay1 - ny * gh + oy}
                x2={ax2 - nx * gh + ox}
                y2={ay2 - ny * gh + oy}
              />
              <text
                x={mx + nx * (gh + 260) + ox}
                y={my + ny * (gh + 260) + oy}
                textAnchor="middle"
                fontSize={FONT_SYMBOL}
              >
                {g.symbol}
              </text>
              {/* つかみやすくするための太い透明な線 */}
              <line
                className="hit"
                x1={ax1 + ox}
                y1={ay1 + oy}
                x2={ax2 + ox}
                y2={ay2 + oy}
              />
            </g>
          );
        })}
      </g>
      {/* 小梁（区画を分割する2本線。つかんで動かせる） */}
      <g className="beam">
        {floor.beams.map((beam, index) => {
          const vertical = beam.x1 === beam.x2;
          const mx = (beam.x1 + beam.x2) / 2;
          const my = (beam.y1 + beam.y2) / 2;
          const bad =
            beam.symbol.trim() !== "" && !knownBeams.has(beam.symbol.trim());
          const bh = halfWidthOf?.(beam.symbol.trim()) ?? BEAM_HALF;
          const miss =
            jointMissing?.has(`b:${beam.id ?? `#${index}`}`) === true;
          return (
            <g
              key={index}
              className={`${selectedBeams.has(index) ? "on" : ""}${bad ? " bad" : ""}${miss ? " miss" : ""}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onBeamPointerDown(index, event);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {vertical ? (
                <>
                  <line x1={beam.x1 - bh} y1={beam.y1} x2={beam.x2 - bh} y2={beam.y2} />
                  <line x1={beam.x1 + bh} y1={beam.y1} x2={beam.x2 + bh} y2={beam.y2} />
                  <text
                    x={mx + bh + 60}
                    y={my}
                    textAnchor="middle"
                    fontSize={FONT_SYMBOL * 0.85}
                    transform={`rotate(-90 ${mx + bh + 60} ${my})`}
                  >
                    {beam.symbol}
                  </text>
                </>
              ) : (
                <>
                  <line x1={beam.x1} y1={beam.y1 - bh} x2={beam.x2} y2={beam.y2 - bh} />
                  <line x1={beam.x1} y1={beam.y1 + bh} x2={beam.x2} y2={beam.y2 + bh} />
                  <text x={mx} y={my - bh - 60} textAnchor="middle" fontSize={FONT_SYMBOL * 0.85}>
                    {beam.symbol}
                  </text>
                </>
              )}
              {/* つかみやすくするための太い透明な線 */}
              <line
                className="hit"
                x1={beam.x1}
                y1={beam.y1}
                x2={beam.x2}
                y2={beam.y2}
              />
            </g>
          );
        })}
      </g>
      {/* 柱（交点の四角） */}
      <g className="column">
        {Object.entries(floor.columns).map(([key, symbol]) => {
          const [xi, yi] = key.split(",").map(Number);
          if (xi < 0 || yi < 0 || xi >= xs.length || yi >= ys.length) return null;
          if (floor.noColumns?.[key] === true) return null;
          const x = xs[xi];
          const y = ys[yi];
          const bad = symbol.trim() !== "" && !knownColumns.has(symbol.trim());
          const half = columnHalfOf?.(symbol.trim()) ?? {
            hw: COL_HALF,
            hd: COL_HALF,
          };
          const miss = jointMissing?.has(`c:${key}`) === true;
          return (
            <g
              key={key}
              className={`${bad ? "bad" : ""}${miss ? " miss" : ""}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onColumnPick?.(key);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <rect
                x={x - half.hw}
                y={y - half.hd}
                width={half.hw * 2}
                height={half.hd * 2}
              />
              <text x={x + half.hw + 90} y={y + FONT_SYMBOL * 0.38} fontSize={FONT_SYMBOL}>
                {symbol}
              </text>
            </g>
          );
        })}
      </g>
      {/* リストの番号（交点と区間に薄く振る） */}
      <g className="number">
        {numbers.map((row, yi) =>
          row.map((no, xi) => (
            <text key={`n${xi},${yi}`} x={xs[xi] - 240} y={ys[yi] - 240} fontSize={FONT_NO}>
              {no}
            </text>
          )),
        )}
        {ys.map((y, yi) =>
          xs.slice(0, -1).map((x, xi) => {
            const no = girderNumber("x", xi, yi, floor);
            const gh = halfWidthOf?.((floor.girders[`x:${xi},${yi}`] ?? "").trim()) ?? GIRDER_HALF;
            return (
              <text key={`gnx${xi},${yi}`} x={(x + xs[xi + 1]) / 2} y={y + gh + FONT_NO + 120} textAnchor="middle" fontSize={FONT_NO}>
                {no}
              </text>
            );
          }),
        )}
        {xs.map((x, xi) =>
          ys.slice(0, -1).map((y, yi) => {
            const no = girderNumber("y", xi, yi, floor);
            const gh = halfWidthOf?.((floor.girders[`y:${xi},${yi}`] ?? "").trim()) ?? GIRDER_HALF;
            return (
              <text key={`gny${xi},${yi}`} x={x + gh + 140} y={(y + ys[yi + 1]) / 2 - gh - 60} fontSize={FONT_NO}>
                {no}
              </text>
            );
          }),
        )}
      </g>
      {/* 取合記号（いちばん手前に描いて、文字と重なってもクリックできるようにする） */}
      <g className="joints">
        {Object.entries(floor.columns).map(([key, symbol]) => {
          const [xi, yi] = key.split(",").map(Number);
          if (xi < 0 || yi < 0 || xi >= xs.length || yi >= ys.length) return null;
          if (floor.noColumns?.[key] === true) return null;
          const half = columnHalfOf?.(symbol.trim()) ?? {
            hw: COL_HALF,
            hd: COL_HALF,
          };
          return (
            <Joint
              key={`jc${key}`}
              jointKey={`c:${key}`}
              x={xs[xi] + half.hw + JOINT_R + 60}
              y={ys[yi] - half.hd - JOINT_R - 60}
            />
          );
        })}
        {Object.keys(floor.girders).map((key) => {
          if (!girderExists(floor, key)) return null;
          const [axis, coord] = key.split(":");
          const [xi, yi] = (coord ?? "").split(",").map(Number);
          if (axis === "x" && yi >= 0 && yi < ys.length && xi >= 0 && xi < xs.length - 1) {
            const colAt = (ax: number, ay: number) => {
              const symbol = floor.columns[`${ax},${ay}`];
              return symbol !== undefined && columnExists(floor, ax, ay)
                ? (columnHalfOf?.(symbol.trim())?.hw ?? COL_HALF)
                : 0;
            };
            const x1 = xs[xi] + colAt(xi, yi);
            const x2 = xs[xi + 1] - colAt(xi + 1, yi);
            const gh = halfWidthOf?.(floor.girders[key].trim()) ?? GIRDER_HALF;
            return (
              <Joint
                key={`jg${key}`}
                jointKey={`g:${key}`}
                x={(x1 + x2) / 2}
                y={ys[yi] + gh + 110}
              />
            );
          }
          if (axis === "y" && yi >= 0 && yi < ys.length - 1 && xi >= 0 && xi < xs.length) {
            const colAt = (ax: number, ay: number) => {
              const symbol = floor.columns[`${ax},${ay}`];
              return symbol !== undefined && columnExists(floor, ax, ay)
                ? (columnHalfOf?.(symbol.trim())?.hd ?? COL_HALF)
                : 0;
            };
            const y1 = ys[yi] + colAt(xi, yi);
            const y2 = ys[yi + 1] - colAt(xi, yi + 1);
            const gh = halfWidthOf?.(floor.girders[key].trim()) ?? GIRDER_HALF;
            const x = xs[xi] + (girderOffsetOf?.(key) ?? 0);
            return (
              <Joint
                key={`jg${key}`}
                jointKey={`g:${key}`}
                x={x - gh - 110}
                y={(y1 + y2) / 2}
              />
            );
          }
          return null;
        })}
        {floor.beams.map((beam, index) => {
          const vertical = beam.x1 === beam.x2;
          const bh = halfWidthOf?.(beam.symbol.trim()) ?? BEAM_HALF;
          const mx = (beam.x1 + beam.x2) / 2;
          const my = (beam.y1 + beam.y2) / 2;
          return (
            <Joint
              key={`jb${beam.id ?? index}`}
              jointKey={`b:${beam.id ?? `#${index}`}`}
              x={vertical ? mx - bh - 120 : mx}
              y={vertical ? my : my + bh + 120}
            />
          );
        })}
        {(floor.diagGirders ?? []).map((g, index) => {
          const ends = diagEnds(xs, ys, g);
          if (ends === null) return null;
          const { x1, y1, x2, y2 } = ends;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const plan = Math.hypot(dx, dy);
          if (plan <= 0) return null;
          const off = g.offset ?? 0;
          const nx = (-dy / plan) * off;
          const ny = (dx / plan) * off;
          return (
            <Joint
              key={`jd${index}`}
              jointKey={`d:${g.id ?? `#${index}`}`}
              x={(x1 + x2) / 2 + nx}
              y={(y1 + y2) / 2 - 140 + ny}
            />
          );
        })}
      </g>
      {/* 斜梁モード：交点・引いた線の上をクリックして始点→終点を選ぶ（いちばん手前に置いて確実に押せる） */}
      {diagMode === true && (
        <g className="diag-pick">
          {/* 引いてある線（大梁・小梁・引き梁）と柱の線上の点を端にできる */}
          {(() => {
            const pickAt = (
              event: React.PointerEvent<SVGLineElement>,
              x1: number,
              y1: number,
              x2: number,
              y2: number,
            ): void => {
              event.stopPropagation();
              const svg = event.currentTarget.ownerSVGElement;
              if (svg === null) return;
              const point = svg.createSVGPoint();
              point.x = event.clientX;
              point.y = event.clientY;
              const matrix = svg.getScreenCTM();
              if (matrix === null) return;
              const at = point.matrixTransform(matrix.inverse());
              const px = at.x - MARGIN_LEFT;
              const py = at.y - MARGIN_TOP;
              const dx = x2 - x1;
              const dy = y2 - y1;
              const len2 = dx * dx + dy * dy;
              const t =
                len2 <= 0
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        1,
                        ((px - x1) * dx + (py - y1) * dy) / len2,
                      ),
                    );
              onLinePick?.(x1 + dx * t, y1 + dy * t);
            };
            const HitLine = (p: {
              x1: number;
              y1: number;
              x2: number;
              y2: number;
              k: string;
            }) => (
              <line
                key={p.k}
                x1={p.x1}
                y1={p.y1}
                x2={p.x2}
                y2={p.y2}
                onPointerDown={(event) =>
                  pickAt(event, p.x1, p.y1, p.x2, p.y2)
                }
                onClick={(event) => event.stopPropagation()}
              />
            );
            const lines: JSX.Element[] = [];
            Object.entries(floor.girders).forEach(([key]) => {
              if (!girderExists(floor, key)) return;
              const [axis, point] = key.split(":");
              const [xi, yi] = point.split(",").map(Number);
              const off = girderOffsetOf?.(key) ?? 0;
              if (axis === "x" && xs[xi] !== undefined && xs[xi + 1] !== undefined && ys[yi] !== undefined)
                lines.push(
                  <HitLine
                    k={`h${key}`}
                    x1={xs[xi]}
                    y1={ys[yi] + off}
                    x2={xs[xi + 1]}
                    y2={ys[yi] + off}
                  />,
                );
              if (axis === "y" && xs[xi] !== undefined && ys[yi] !== undefined && ys[yi + 1] !== undefined)
                lines.push(
                  <HitLine
                    k={`h${key}`}
                    x1={xs[xi] + off}
                    y1={ys[yi]}
                    x2={xs[xi] + off}
                    y2={ys[yi + 1]}
                  />,
                );
            });
            floor.beams.forEach((beam, index) =>
              lines.push(
                <HitLine
                  k={`hb${index}`}
                  x1={beam.x1}
                  y1={beam.y1}
                  x2={beam.x2}
                  y2={beam.y2}
                />,
              ),
            );
            (floor.diagGirders ?? []).forEach((g, index) => {
              const ends = diagEnds(xs, ys, g);
              if (ends === null) return;
              const dx = ends.x2 - ends.x1;
              const dy = ends.y2 - ends.y1;
              const plan = Math.hypot(dx, dy);
              if (plan <= 0) return;
              const off = g.offset ?? 0;
              lines.push(
                <HitLine
                  k={`hd${index}`}
                  x1={ends.x1 + (-dy / plan) * off}
                  y1={ends.y1 + (dx / plan) * off}
                  x2={ends.x2 + (-dy / plan) * off}
                  y2={ends.y2 + (dx / plan) * off}
                />,
              );
            });
            /* 補助寸法線 */
            auxX.forEach((e, i) =>
              lines.push(
                <HitLine
                  k={`hax${i}`}
                  x1={e.pos}
                  y1={0}
                  x2={e.pos}
                  y2={totalY}
                />,
              ),
            );
            auxY.forEach((e, i) =>
              lines.push(
                <HitLine
                  k={`hay${i}`}
                  x1={0}
                  y1={e.pos}
                  x2={totalX}
                  y2={e.pos}
                />,
              ),
            );
            /* 柱の四角の辺 */
            Object.entries(floor.columns).forEach(([key, symbol]) => {
              const [xi, yi] = key.split(",").map(Number);
              if (!columnExists(floor, xi, yi)) return;
              const x = xs[xi];
              const y = ys[yi];
              if (x === undefined || y === undefined) return;
              const half = columnHalfOf?.(symbol.trim()) ?? {
                hw: COL_HALF,
                hd: COL_HALF,
              };
              const edges: [number, number, number, number][] = [
                [x - half.hw, y - half.hd, x + half.hw, y - half.hd],
                [x + half.hw, y - half.hd, x + half.hw, y + half.hd],
                [x + half.hw, y + half.hd, x - half.hw, y + half.hd],
                [x - half.hw, y + half.hd, x - half.hw, y - half.hd],
              ];
              edges.forEach(([x1, y1, x2, y2], ei) =>
                lines.push(
                  <HitLine
                    k={`hc${key}-${ei}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                  />,
                ),
              );
            });
            return lines;
          })()}
          {xs.map((x, xi) =>
            ys.map((y, yi) => (
              <circle
                key={`dp${xi},${yi}`}
                cx={x}
                cy={y}
                r={450}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onIntersectionPick?.(xi, yi);
                }}
                onClick={(event) => event.stopPropagation()}
              />
            )),
          )}
          {diagStart !== null &&
            diagStart !== undefined &&
            (() => {
              const at =
                "pt" in diagStart
                  ? diagStart.pt
                  : { x: xs[diagStart.xi], y: ys[diagStart.yi] };
              if (at.x === undefined || at.y === undefined) return null;
              return (
                <circle
                  className="start"
                  cx={at.x}
                  cy={at.y}
                  r={600}
                />
              );
            })()}
        </g>
      )}
      {/* 寸法線を足すモード：柱線をクリックして基になる線を選ぶ */}
      {auxMode === true && (
        <g className="diag-pick">
          {xs.map((x, xi) => (
            <line
              key={`apx${xi}`}
              x1={x}
              y1={0}
              x2={x}
              y2={totalY}
              onPointerDown={(event) => {
                event.stopPropagation();
                onAuxBasePick?.("x", xi);
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ))}
          {ys.map((y, yi) => (
            <line
              key={`apy${yi}`}
              x1={0}
              y1={y}
              x2={totalX}
              y2={y}
              onPointerDown={(event) => {
                event.stopPropagation();
                onAuxBasePick?.("y", yi);
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ))}
        </g>
      )}
    </g>
  );

  return (
    <svg
      ref={svgRef}
      className="fireproof-drawing-svg"
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      data-width={width}
      data-height={height}
      style={
        displaySize !== undefined
          ? { width: displaySize.width, height: displaySize.height }
          : undefined
      }
      onClick={(event) => {
        // 梁・柱・寸法・芯記号など部品の上のクリックは区画選びにしない
        // （区画を選ぶ途中でうっかり線を触っても選択が消えないように）
        const hit = event.target as Element;
        if (hit.closest(".beam, .girder, .column, .axis, .dim, .joint, .diag-pick")) return;
        const svg = event.currentTarget;
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const matrix = svg.getScreenCTM();
        if (matrix === null) return;
        const at = point.matrixTransform(matrix.inverse());
        onRegionClick(at.x - MARGIN_LEFT, at.y - MARGIN_TOP, event.shiftKey);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {content}
    </svg>
  );
}

/** 描いたSVGをPNG（データURL）にする（他の計算書へ呼び出せるようにするため） */
async function renderPng(
  svg: SVGSVGElement,
): Promise<{ image: string; width: number; height: number } | null> {
  const width = Number(svg.dataset.width);
  const height = Number(svg.dataset.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(Math.round(width * EXPORT_PPM)));
  clone.setAttribute("height", String(Math.round(height * EXPORT_PPM)));
  // 区画の色付けなど表示用の飾りは画像に写さない
  clone.querySelectorAll(".selection").forEach((node) => node.remove());
  const markup = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  const bitmap = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  if (bitmap === null) return null;
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  return { image: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/** 階の中身のうち、描き直し・画像化の元になる部分だけの合印 */
function floorSignature(floor: FireproofDrawingFloor): string {
  return JSON.stringify({
    x: floor.xSpans,
    y: floor.ySpans,
    c: floor.columns,
    g: floor.girders,
    b: floor.beams,
    d: floor.diagGirders,
  });
}

/**
 * 鉄骨伏図の作成（耐火被覆・塗装積算入力）。
 * 柱線寸法線 → 交点の番号に記号で柱 → 柱間の番号に記号で大梁。
 * 階は耐火被覆のリスト（柱・梁）の階と同じ並び。
 */
export default function FireproofDrawingPage({
  project,
  onBack,
}: Props): JSX.Element {
  const [recordId, setRecordId] = useState<number | null>(null);
  const [drawing, setDrawing] = useState<FireproofDrawing>({ floors: {} });
  const [floors, setFloors] = useState<string[]>([]);
  const [floor, setFloor] = useState("");
  const [message, setMessage] = useState("");
  /** ④小梁：選んだ区画（Shift+クリックで複数）・選んだ小梁・入力する記号と分割の仕方 */
  const [regions, setRegions] = useState<DrawingRegion[]>([]);
  const [selBeam, setSelBeam] = useState<number | null>(null);
  /* 小梁の一覧で範囲指定（番号のところを押して動かす・Shift+クリックで広げる）。
     fromが押した基点・toが広げた先 */
  const [selBeamRange, setSelBeamRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  /* 最後に触ったのが「区画」か「小梁」か。Ctrl+Cでどちらを写すかの目安にする */
  const selFocusRef = useRef<"region" | "beam">("region");
  /* ③大梁リストで範囲指定した分。図に点線の範囲を出す */
  const [girderSelRange, setGirderSelRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  /* 図でクリックした柱・大梁・斜梁（左の記号欄のその行に飛ぶ） */
  const [selColumn, setSelColumn] = useState<string | null>(null);
  const [selGirder, setSelGirder] = useState<string | null>(null);
  const [selDiag, setSelDiag] = useState<number | null>(null);
  /* 斜梁の入力モード（交点を2か所クリックして入れる）と始点 */
  const [diagMode, setDiagMode] = useState(false);
  const [diagStart, setDiagStart] = useState<
    { xi: number; yi: number } | { pt: { x: number; y: number } } | null
  >(null);
  /* 補助寸法線：柱線とは別に寸法線からずらして引く線。モード中に柱線を押して基の線を選ぶ */
  const [auxMode, setAuxMode] = useState(false);
  const [auxBase, setAuxBase] = useState<
    { axis: "x" | "y"; base: number } | null
  >(null);
  const [auxDist, setAuxDist] = useState("");
  const [auxDir, setAuxDir] = useState<1 | -1>(1);
  const beamAnchorRef = useRef<number | null>(null);
  const beamRowDragRef = useRef(false);
  const rowClickSuppressRef = useRef(false);
  const [beamSymbol, setBeamSymbol] = useState("B40");
  /* 取合記号：選んでいる記号（""＝消す）。図の梁の端の○印をクリックで入れ直す */
  const [jointSymbol, setJointSymbol] = useState("3");
  /* 取合記号の未入力表示：入っていない部材を図の中で点滅させる */
  const [showMissing, setShowMissing] = useState(false);
  const [beamAxis, setBeamAxis] = useState<"v" | "h">("v");
  const [beamParts, setBeamParts] = useState(3);
  /** 入力欄・一覧で触った行に対応する図の場所（色付け用） */
  const [focusTarget, setFocusTarget] = useState<
    | { kind: "column" | "girder"; key: string }
    | { kind: "beam"; index: number }
    | null
  >(null);
  /** 区画コピーした小梁。xEdge/yEdgeは「その端が区画のどの辺（の内側）に付いているか」の印で、貼る側の辺へ合わせる */
  const [clipBeams, setClipBeams] = useState<
    {
      dx1: number;
      dy1: number;
      dx2: number;
      dy2: number;
      symbol: string;
      xEdge1: "left" | "right" | null;
      xEdge2: "left" | "right" | null;
      yEdge1: "top" | "bottom" | null;
      yEdge2: "top" | "bottom" | null;
    }[]
  >([]);
  /** 小梁をつかんでいる最中の持ち場 */
  const dragRef = useRef<{
    index: number;
    start: FireproofDrawingFloor["beams"][number];
    originX: number;
    originY: number;
    applied: number;
    before: FireproofDrawing;
  } | null>(null);
  /* 戻る・進む：書き換える前の図面を積む（他の計算書と同じく50件まで） */
  const [past, setPast] = useState<FireproofDrawing[]>([]);
  const [future, setFuture] = useState<FireproofDrawing[]>([]);
  /* 区画コピーで読み取った「分割条件」（写し元の小梁が同じ向き・記号で等間隔のとき）。
     あれば貼る先の大きさに合わせて同じ分割で入れ直す */
  const [clipRule, setClipRule] = useState<{
    axis: "v" | "h";
    symbol: string;
    parts: number;
  } | null>(null);
  /* 階まるごとのコピー：記号だけが写るので、貼った先の階の鉄骨リストの寸法で描かれる */
  const [clipFloor, setClipFloor] = useState<FireproofDrawingFloor | null>(
    null,
  );
  /* 階の貼り付け先をまとめて選ぶ欄。開いているときだけ見せる */
  const [floorPasteOpen, setFloorPasteOpen] = useState(false);
  const [floorPastePick, setFloorPastePick] = useState<Set<string>>(new Set());
  /** この画面では触らない他の欄（保存時にそのまま戻す） */
  const baseRef = useRef({
    floorCount: 0,
    columnsJson: "{}",
    beamsJson: "{}",
    commonJson: "[]",
    estimateJson: "[]",
    note: "",
  });
  /** 柱・梁リスト（図に寸法を出すために読む。この画面では書き換えない） */
  const [memberLists, setMemberLists] = useState<{
    columns: FireproofFloorList;
    beams: FireproofFloorList;
    common: FireproofCommonRow[];
  }>({
    columns: { floors: [], members: [] },
    beams: { floors: [], members: [] },
    common: [],
  });
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const renderedSignatureRef = useRef("");

  useEffect(() => {
    void (async () => {
      const record = await window.sekisan.getFireproofSheet(project.id);
      setRecordId(record.id);
      baseRef.current = {
        floorCount: record.floorCount,
        columnsJson: record.columnsJson,
        beamsJson: record.beamsJson,
        commonJson: record.commonJson,
        estimateJson: record.estimateJson,
        note: record.note,
      };
      const labels: string[] = [];
      const push = (label: string) => {
        if (label !== "" && !labels.includes(label)) labels.push(label);
      };
      normalizeFloorList(parseJson(record.columnsJson, {})).floors.forEach(
        (row) => push(row.label),
      );
      normalizeFloorList(parseJson(record.beamsJson, {})).floors.forEach(
        (row) => push(row.label),
      );
      if (labels.length === 0)
        columnFloorLabels(record.floorCount).forEach(push);
      if (labels.length === 0) labels.push("1");
      setFloors(labels);
      setFloor(labels[0]);
      setMemberLists({
        columns: normalizeFloorList(parseJson(record.columnsJson, {})),
        beams: normalizeFloorList(parseJson(record.beamsJson, {})),
        common: normalizeCommonRows(parseJson(record.commonJson, [])),
      });
      const loaded = parseDrawing(record.drawingJson);
      setDrawing(loaded);
      markSaved(loaded);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const save = useCallback(
    async (silent = false): Promise<void> => {
      if (recordId === null) return;
      const base = baseRef.current;
      await window.sekisan.saveFireproofSheet({
        id: recordId,
        floorCount: base.floorCount,
        columnsJson: base.columnsJson,
        beamsJson: base.beamsJson,
        commonJson: base.commonJson,
        estimateJson: base.estimateJson,
        drawingJson: JSON.stringify(drawingRef.current),
        note: base.note,
      });
      markSaved(drawingRef.current);
      if (!silent) setMessage("保存しました");
    },
    [recordId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { markSaved } = useSaveOnLeave(drawing, () => save(true));

  const current = drawing.floors[floor] ?? emptyFloor();
  /** 取合記号が入っていない部材（未入力表示中は点滅させるキー、階ボタンには階ごとの有無を出す） */
  const missingNow = useMemo(
    () => (showMissing ? new Set(missingJointKeys(current)) : undefined),
    [current, showMissing],
  );
  const missingByFloor = useMemo(() => {
    const set = new Set<string>();
    Object.entries(drawing.floors).forEach(([name, each]) => {
      if (missingJointKeys(each).length > 0) set.add(name);
    });
    return set;
  }, [drawing]);

  /* 小梁一覧の範囲指定。選んだ行番号の集まり（図の色付けにも使う） */
  const selBeamSet = useMemo(() => {
    const set = new Set<number>();
    if (selBeamRange !== null) {
      const lo = Math.min(selBeamRange.from, selBeamRange.to);
      const hi = Math.max(selBeamRange.from, selBeamRange.to);
      for (let i = lo; i <= hi; i += 1) set.add(i);
    } else if (selBeam !== null) set.add(selBeam);
    return set;
  }, [selBeamRange, selBeam]);

  const updateFloor = useCallback(
    (patch: Partial<FireproofDrawingFloor>) => {
      const target = drawing.floors[floor] ?? emptyFloor();
      const next: FireproofDrawing = {
        floors: { ...drawing.floors, [floor]: { ...target, ...patch } },
      };
      // 欄を離れただけなどの変わらない入力で履歴が埋まると、「戻る」が効かなくなる
      if (JSON.stringify(next) === JSON.stringify(drawing)) {
        setDrawing(next);
        return;
      }
      setPast((rows) => [...rows.slice(-49), drawing]);
      setFuture([]);
      setDrawing(next);
    },
    [drawing, floor],
  );

  /* ②柱の「無し」チェック（その交点に柱を置かない。大梁はまたいでつなぐ） */
  const toggleNoColumn = useCallback(
    (key: string, on: boolean) => {
      const next = { ...(current.noColumns ?? {}) };
      if (on) next[key] = true;
      else delete next[key];
      updateFloor({
        noColumns: Object.keys(next).length > 0 ? next : undefined,
      });
    },
    [current, updateFloor],
  );
  /* ③大梁の「無し」チェック（その区間に大梁を置かない） */
  const toggleNoGirder = useCallback(
    (key: string, on: boolean) => {
      const next = { ...(current.noGirders ?? {}) };
      if (on) next[key] = true;
      else delete next[key];
      updateFloor({
        noGirders: Object.keys(next).length > 0 ? next : undefined,
      });
    },
    [current, updateFloor],
  );
  const noColumnSet = useMemo(
    () => new Set(Object.keys(current.noColumns ?? {})),
    [current],
  );
  const noGirderSet = useMemo(
    () => new Set(Object.keys(current.noGirders ?? {})),
    [current],
  );

  /* 斜梁：モード中に交点・線上の点を押す→始点、もう1か所→終点で1本入る */
  const pickDiag = useCallback(
    (pick: { xi: number; yi: number } | { pt: { x: number; y: number } }) => {
      if (diagStart === null) {
        setDiagStart(pick);
        return;
      }
      const sameGrid =
        !("pt" in diagStart) &&
        !("pt" in pick) &&
        diagStart.xi === pick.xi &&
        diagStart.yi === pick.yi;
      const samePt =
        "pt" in diagStart &&
        "pt" in pick &&
        Math.hypot(diagStart.pt.x - pick.pt.x, diagStart.pt.y - pick.pt.y) < 1;
      if (sameGrid || samePt) {
        setDiagStart(null);
        return;
      }
      const xsNow = positions(current.xSpans);
      const ysNow = positions(current.ySpans);
      /* 線上の点は一番近い交点の番号をグリッドにして位置の実座標を持つ */
      const endOf = (
        p: { xi: number; yi: number } | { pt: { x: number; y: number } },
      ): {
        xi: number;
        yi: number;
        mm?: { x: number; y: number };
        label: string;
      } => {
        if (!("pt" in p))
          return {
            xi: p.xi,
            yi: p.yi,
            label: `${xGridLabel(p.xi)}-${yGridLabel(ysNow.length - 1 - p.yi)}`,
          };
        let xi = 0;
        let xDist = Number.POSITIVE_INFINITY;
        xsNow.forEach((x, i) => {
          const d = Math.abs(x - p.pt.x);
          if (d < xDist) {
            xDist = d;
            xi = i;
          }
        });
        let yi = 0;
        let yDist = Number.POSITIVE_INFINITY;
        ysNow.forEach((y, i) => {
          const d = Math.abs(y - p.pt.y);
          if (d < yDist) {
            yDist = d;
            yi = i;
          }
        });
        return { xi, yi, mm: p.pt, label: "線上" };
      };
      const from = endOf(diagStart);
      const to = endOf(pick);
      const next: FireproofDrawingDiagGirder[] = [
        ...(current.diagGirders ?? []),
        {
          fx: from.xi,
          fy: from.yi,
          tx: to.xi,
          ty: to.yi,
          symbol: "",
          id: `d${Date.now().toString(36)}${(current.diagGirders ?? []).length}`,
          ...(from.mm !== undefined ? { fromMm: from.mm } : {}),
          ...(to.mm !== undefined ? { toMm: to.mm } : {}),
        },
      ];
      updateFloor({ diagGirders: next });
      setSelDiag(next.length - 1);
      setDiagStart(null);
      setMessage(
        `梁を入れました（${from.label}〜${to.label}）。左の引き梁の欄に記号を入れてください`,
      );
    },
    [current, diagStart, updateFloor],
  );
  const pickIntersection = useCallback(
    (xi: number, yi: number) => pickDiag({ xi, yi }),
    [pickDiag],
  );
  const pickLinePoint = useCallback(
    (x: number, y: number) => pickDiag({ pt: { x, y } }),
    [pickDiag],
  );
  /* 補助寸法線：基の柱線を選ぶ */
  const pickAuxBase = useCallback((axis: "x" | "y", base: number) => {
    setAuxBase({ axis, base });
    setAuxDir(1);
    setAuxDist("");
  }, []);
  /* 補助寸法線：向き・離れ寸法を決めて線を足す */
  const addAuxLine = useCallback(() => {
    if (auxBase === null) return;
    const dist = Math.round(Number(toHalfWidth(auxDist).replaceAll(",", ".")));
    if (!Number.isFinite(dist) || dist <= 0) return;
    const line: FireproofDrawingAuxLine = {
      axis: auxBase.axis,
      base: auxBase.base,
      offset: dist * auxDir,
      id: `a${Date.now().toString(36)}${(current.auxLines ?? []).length}`,
    };
    updateFloor({ auxLines: [...(current.auxLines ?? []), line] });
    setAuxBase(null);
    setAuxDist("");
    setMessage("補助線を入れました。必要なだけ繰り返せます。閉じるときは「やめる」");
  }, [auxBase, auxDist, auxDir, current.auxLines, updateFloor]);

  /* 斜梁の行：記号の書き換え・行の消去 */
  const changeDiagSymbol = useCallback(
    (index: number, symbol: string) => {
      updateFloor({
        diagGirders: (current.diagGirders ?? []).map((g, i) =>
          i === index ? { ...g, symbol } : g,
        ),
      });
    },
    [current, updateFloor],
  );
  const deleteDiag = useCallback(
    (index: number) => {
      const next = (current.diagGirders ?? []).filter((_, i) => i !== index);
      updateFloor({ diagGirders: next.length > 0 ? next : undefined });
      setSelDiag(null);
    },
    [current, updateFloor],
  );


  /* 階コピーした図面を、選んだ階ぜんぶに貼り付ける（戻るでもまとめて戻せるよう1回分の履歴にする） */
  const pasteFloorTo = useCallback(
    (names: string[]) => {
      if (clipFloor === null || names.length === 0) return;
      const next: FireproofDrawing = { floors: { ...drawing.floors } };
      names.forEach((name) => {
        next.floors[name] = JSON.parse(JSON.stringify(clipFloor));
      });
      if (JSON.stringify(next) === JSON.stringify(drawing)) {
        setFloorPasteOpen(false);
        return;
      }
      setPast((rows) => [...rows.slice(-49), drawing]);
      setFuture([]);
      setDrawing(next);
      setRegions([]);
      setSelBeam(null);
      setSelBeamRange(null);
      setFocusTarget(null);
      dragRef.current = null;
      setFloorPasteOpen(false);
      setMessage(
        `${names.length}か所の階に貼り付けました（それぞれの階の鉄骨リストの寸法で描きます）`,
      );
    },
    [clipFloor, drawing],
  );

  /* 取合記号：図の梁の端の○印をクリック。選んだ記号を入れる。同じ記号か「消す」なら外す */
  const clickJoint = useCallback(
    (key: string) => {
      const next = { ...(current.jointSymbols ?? {}) };
      if (jointSymbol === "" || next[key] === jointSymbol) delete next[key];
      else next[key] = jointSymbol;
      updateFloor({
        jointSymbols: Object.keys(next).length > 0 ? next : undefined,
      });
    },
    [current, jointSymbol, updateFloor],
  );

  /* 取合記号のまとめて指定：柱・大梁・小梁のどれか全部に同じ記号を入れる */
  const fillJoints = useCallback(
    (target: "column" | "girder" | "beam") => {
      const next = { ...(current.jointSymbols ?? {}) };
      const keys: string[] = [];
      if (target === "column")
        Object.keys(current.columns).forEach((key) => keys.push(`c:${key}`));
      else if (target === "girder") {
        Object.keys(current.girders).forEach((key) => keys.push(`g:${key}`));
        (current.diagGirders ?? []).forEach((g, index) =>
          keys.push(`d:${g.id ?? `#${index}`}`),
        );
      } else
        current.beams.forEach((beam, index) =>
          keys.push(`b:${beam.id ?? `#${index}`}`),
        );
      keys.forEach((key) => {
        if (jointSymbol === "") delete next[key];
        else next[key] = jointSymbol;
      });
      updateFloor({
        jointSymbols: Object.keys(next).length > 0 ? next : undefined,
      });
      setMessage(
        jointSymbol === ""
          ? "記号を消しました"
          : `${target === "column" ? "柱" : target === "girder" ? "大梁" : "小梁"}全部に「${jointSymbol}」を入れました（違うところだけ図で直せます）`,
      );
    },
    [current, jointSymbol, updateFloor],
  );

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (previous === undefined) return;
    setPast((rows) => rows.slice(0, -1));
    setFuture((rows) => [...rows, drawing]);
    setDrawing(previous);
    setRegions([]);
    setSelBeam(null);
    setSelBeamRange(null);
    setFocusTarget(null);
    dragRef.current = null;
  }, [drawing, past]);

  const redo = useCallback(() => {
    const next = future[future.length - 1];
    if (next === undefined) return;
    setFuture((rows) => rows.slice(0, -1));
    setPast((rows) => [...rows, drawing]);
    setDrawing(next);
    setRegions([]);
    setSelBeam(null);
    setSelBeamRange(null);
    setFocusTarget(null);
    dragRef.current = null;
  }, [drawing, future]);

  /* 表示倍率（1＝画面内に図形がぜんたい入る大きさ）と画面の計り方 */
  const [zoom, setZoom] = useState(1);
  const [viewSize, setViewSize] = useState<{ width: number; height: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (el === null) return;
    const measure = () =>
      setViewSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom((z) =>
        Math.min(8, Math.max(0.2, z * (event.deltaY < 0 ? 1.15 : 1 / 1.15))),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  /* 入力欄共通：Enterは次の欄、↑↓は上下の欄へ（←→はカーソル移動のまま） */
  const handleNavKey = useCallback((event: React.KeyboardEvent) => {
    const el = event.target as HTMLElement;
    if (el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
    if (
      event.key !== "Enter" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    )
      return;
    const root = pageRef.current;
    if (root === null) return;
    const fields = Array.from(
      root.querySelectorAll<HTMLElement>(
        "input:not([disabled]), select:not([disabled])",
      ),
    ).filter((f) => f.offsetParent !== null);
    const i = fields.indexOf(el);
    if (i < 0) return;
    const next = event.key === "ArrowUp" ? fields[i - 1] : fields[i + 1];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  }, []);

  /** 階を移るときは選んでいるものを外す */
  useEffect(() => {
    setRegions([]);
    setSelBeam(null);
    setSelBeamRange(null);
    setFocusTarget(null);
    dragRef.current = null;
  }, [floor]);

  /* 階タブは左から 1F・2F…の順（数字でない階＝Rは伏図では一番上の階の梁なのでタブには出さない）。
     柱は1Fから・梁は2Fからの対応なので、タブは「1F(梁2F)」のように隣の階を添える */
  const sortedFloors = [...floors].sort((a, b) => {
    const an = /^\d+$/.test(a) ? Number(a) : null;
    const bn = /^\d+$/.test(b) ? Number(b) : null;
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return 0;
  });
  const floorTabs =
    sortedFloors.filter((label) => label !== "R").length > 0
      ? sortedFloors.filter((label) => label !== "R")
      : sortedFloors;
  /** その階の図で使う梁の階（柱はその階・梁はひとつ上。一番上はRF） */
  const beamFloorLabel =
    floorTabs[floorTabs.indexOf(floor) + 1] ?? "R";

  /* この階の階高（mm）。通りごとの柱の高さの空欄・勾配の計算に使う */
  const floorHeight = useMemo(() => {
    const at = memberLists.columns.floors.findIndex((f) => f.label === floor);
    return resolveFloorHeight(memberLists.columns.floors, Math.max(0, at));
  }, [memberLists, floor]);

  /* 記号→部材幅の半分（mm）。梁リストの後ろの数字（幅）の半分。
     小梁を囲む線の内側に止める量（内内寸法）と、2本線の開きに使う */
  const beamHalfWidths = useMemo(() => {
    const beamAt = memberLists.beams.floors.findIndex(
      (f) => f.label === beamFloorLabel,
    );
    const map = new Map<string, number>();
    memberLists.beams.members.forEach((member) => {
      const symbol = member.symbol.trim();
      if (symbol === "") return;
      const size = resolveSize(
        member,
        memberLists.beams.floors,
        Math.max(0, beamAt),
        "beam",
      );
      const width = size.second ?? size.first;
      if (width !== null && width > 0) map.set(symbol, width / 2);
    });
    memberLists.common.forEach((row) => {
      const symbol = row.symbol.trim();
      if (symbol === "" || map.has(symbol)) return;
      const size = resolveCommonRow(row);
      const width = size.second ?? size.first;
      if (width !== null && width > 0) map.set(symbol, width / 2);
    });
    return map;
  }, [memberLists, beamFloorLabel]);
  const halfWidthOf = useCallback<HalfWidthOf>(
    (symbol) => beamHalfWidths.get(symbol.trim()) ?? null,
    [beamHalfWidths],
  );

  /* 柱記号→柱の四角の半分（横×縦 mm）。柱リストの寸法（Ｗ×Ｄの半分）。
     柱の四角を実際の大きさで描き、大梁の端をその面に合わせる */
  const columnHalfOf = useCallback<ColumnHalfOf>(
    (symbol: string): { hw: number; hd: number } | null => {
      const columnAt = memberLists.columns.floors.findIndex(
        (f) => f.label === floor,
      );
      const member = memberLists.columns.members.find(
        (m) => m.symbol.trim() === symbol.trim(),
      );
      if (member === undefined) {
        const row = memberLists.common.find(
          (r) => r.symbol.trim() === symbol.trim(),
        );
        if (row === undefined) return null;
        const size = resolveCommonRow(row);
        const w = size.first;
        const d = size.second ?? size.first;
        if (w === null || w <= 0) return null;
        return { hw: w / 2, hd: (d ?? w) / 2 };
      }
      const size = resolveSize(
        member,
        memberLists.columns.floors,
        Math.max(0, columnAt),
        "column",
      );
      const w = size.first;
      const d = size.second ?? size.first;
      if (w === null || w <= 0) return null;
      return { hw: w / 2, hd: (d ?? w) / 2 };
    },
    [memberLists, floor],
  );

  /* 大梁キー→芯からのずらし量（端寄せ。区画・小梁の内内・点線も同じ位置） */
  const girderOffsetOf = useCallback(
    (key: string): number =>
      girderOffset(current, key, halfWidthOf, columnHalfOf),
    [current, halfWidthOf, columnHalfOf],
  );

  /* 引き梁の行：柱の面への寄せ（法線方向に部材をずらす。両端の柱の小さいほうの面に合わせる） */
  const diagAlign = useCallback(
    (
      g: FireproofDrawingDiagGirder,
    ): { minus: string; plus: string; proj: number } | null => {
      const xsNow = positions(current.xSpans);
      const ysNow = positions(current.ySpans);
      const ends = diagEnds(xsNow, ysNow, g);
      if (ends === null) return null;
      const dx = ends.x2 - ends.x1;
      const dy = ends.y2 - ends.y1;
      const plan = Math.hypot(dx, dy);
      if (plan <= 0) return null;
      const nx = -dy / plan;
      const ny = dx / plan;
      let proj = Infinity;
      (
        [
          [g.fx, g.fy, g.fromMm],
          [g.tx, g.ty, g.toMm],
        ] as [number, number, { x: number; y: number } | undefined][]
      ).forEach(([xi, yi, free]) => {
        /* 線上の点を端にしたとき：その点が柱の四角の中ならその柱の面に合わせる */
        if (free !== undefined) {
          Object.keys(current.columns).forEach((key) => {
            if (!columnExists(current, ...key.split(",").map(Number) as [number, number]))
              return;
            const [cxi, cyi] = key.split(",").map(Number);
            const cx = xsNow[cxi];
            const cy = ysNow[cyi];
            if (cx === undefined || cy === undefined) return;
            const sym = (
              current.columns[columnKey(cxi, cyi)] ?? ""
            ).trim();
            const h = columnHalfOf(sym) ?? { hw: COL_HALF, hd: COL_HALF };
            if (
              free.x >= cx - h.hw &&
              free.x <= cx + h.hw &&
              free.y >= cy - h.hd &&
              free.y <= cy + h.hd
            ) {
              const p =
                h.hw * Math.abs(nx) + h.hd * Math.abs(ny);
              if (p < proj) proj = p;
            }
          });
          return;
        }
        if (!columnExists(current, xi, yi)) return;
        const sym = (current.columns[columnKey(xi, yi)] ?? "").trim();
        const h = columnHalfOf(sym) ?? { hw: COL_HALF, hd: COL_HALF };
        const p = h.hw * Math.abs(nx) + h.hd * Math.abs(ny);
        if (p < proj) proj = p;
      });
      if (!Number.isFinite(proj)) return null;
      const dirLabel = (vx: number, vy: number): string =>
        Math.abs(vx) >= Math.abs(vy)
          ? vx < 0
            ? "左寄"
            : "右寄"
          : vy < 0
            ? "上寄"
            : "下寄";
      return {
        minus: dirLabel(-nx, -ny),
        plus: dirLabel(nx, ny),
        proj,
      };
    },
    [current, columnHalfOf],
  );
  const alignDiag = useCallback(
    (index: number, offset: number) => {
      updateFloor({
        diagGirders: (current.diagGirders ?? []).map((g, i) =>
          i === index ? { ...g, offset: offset === 0 ? undefined : offset } : g,
        ),
      });
    },
    [current, updateFloor],
  );

  /* 寸法・大梁の記号・鉄骨リストの幅・大梁の端寄せが変わったら、置いてある小梁の端を
     その区画の内内寸法に入れ直す（長さ表示が図面に連動する） */
  useEffect(() => {
    const target = drawingRef.current.floors[floor];
    if (target === undefined || target.beams.length === 0) return;
    const refit = refitBeams(target, halfWidthOf, columnHalfOf);
    if (JSON.stringify(refit) === JSON.stringify(target.beams)) return;
    updateFloor({ beams: refit });
    setMessage("寸法に合わせて小梁を入れ直しました");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, memberLists, current.xSpans, current.ySpans, current.girders, current.girderAlign]);

  /** ④小梁：図をクリック → まわりの線で囲まれた区画を選ぶ（Shift+クリックで追加・再押しで外す） */
  const handleRegionClick = useCallback(
    (x: number, y: number, additive: boolean) => {
      if (dragRef.current !== null) return; // ドラッグの離しクリックは区画変更にしない
      const part = enclosingRegion(
        current,
        x,
        y,
        halfWidthOf,
        true,
        columnHalfOf,
      );
      setRegions((before) => {
        if (!additive) return part === null ? [] : [part];
        if (part === null) return before;
        return before.some((picked) => sameRegion(picked, part))
          ? before.filter((picked) => !sameRegion(picked, part))
          : [...before, part];
      });
      setSelBeam(null);
      setSelBeamRange(null);
      selFocusRef.current = "region";
      setFocusTarget(null);
    },
    [current, halfWidthOf, columnHalfOf],
  );

  const svgPoint = (
    svg: SVGSVGElement,
    event: { clientX: number; clientY: number },
  ): { x: number; y: number } | null => {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (matrix === null) return null;
    return point.matrixTransform(matrix.inverse());
  };

  /** ④小梁：つかみ始め（このまま動かすと梁が軸と直角方向にずれる） */
  const handleBeamPointerDown = useCallback(
    (index: number, event: React.PointerEvent) => {
      const beam = current.beams[index];
      const svg = (event.currentTarget as SVGGElement).ownerSVGElement;
      if (beam === undefined || svg === null) return;
      const at = svgPoint(svg, event);
      if (at === null) return;
      dragRef.current = {
        index,
        start: beam,
        originX: at.x - MARGIN_LEFT,
        originY: at.y - MARGIN_TOP,
        applied: 0,
        before: drawing,
      };
      setSelBeam(index);
      setSelBeamRange(null);
      selFocusRef.current = "beam"; // 区画を選んでいる途中でも小梁を触れる（区画の選択は残す）
      setFocusTarget({ kind: "beam", index });
    },
    [current, drawing],
  );

  /** ④小梁：つかんで動かす（縦の梁は左右・横の梁は上下へ） */
  const handleBeamPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      const svg = svgRef.current;
      if (drag === null || svg === null) return;
      const at = svgPoint(svg, event);
      if (at === null) return;
      const vertical = drag.start.x1 === drag.start.x2;
      const delta = vertical
        ? at.x - MARGIN_LEFT - drag.originX
        : at.y - MARGIN_TOP - drag.originY;
      if (delta === drag.applied) return;
      drag.applied = delta;
      setDrawing((before) => {
        const target = before.floors[floor] ?? emptyFloor();
        const beams = target.beams.map((beam, i) =>
          i === drag.index ? nudgeBeam(drag.start, delta) : beam,
        );
        return { floors: { ...before.floors, [floor]: { ...target, beams } } };
      });
    },
    [floor],
  );

  const endBeamDrag = useCallback(() => {
    // つかんで動かしたときは、動かす前の図面を履歴に残す（戻るで元に戻せる）
    const drag = dragRef.current;
    if (drag !== null && drag.applied !== 0) {
      setPast((rows) => [...rows.slice(-49), drag.before]);
      setFuture([]);
    }
    // つかんで離すと発生するクリックで区画選択に化けないよう、少しの間だけ持ち場を残す
    window.setTimeout(() => {
      dragRef.current = null;
    }, 0);
  }, []);

  /** 新しい小梁の取合記号用の番号 */
  const newBeamId = useCallback(
    () => `b${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  /** ④小梁：選んだ区画（複数も可）へ分割配置・区画の中身をコピー＆貼付 */
  const placeBeams = useCallback(() => {
    if (regions.length === 0) return;
    const symbol = beamSymbol.trim();
    const placed = regions
      .flatMap((part) => dividedBeams(part, beamAxis, beamParts, symbol))
      .map((beam) => ({ ...beam, id: newBeamId() }));
    if (placed.length === 0) return;
    updateFloor({ beams: [...current.beams, ...placed] });
    setMessage(`${regions.length}か所に入れました`);
  }, [regions, beamAxis, beamParts, beamSymbol, current, updateFloor, newBeamId]);

  /** 区画とその中の小梁から「貼り付けの種」を覚える（区画コピー・入力行コピーの共通） */
  const learnFromBeams = useCallback(
    (part: DrawingRegion, inside: FireproofDrawingBeam[]) => {
    // 端が区画の辺（その内側＝梁の内内の面）に付いているか。貼る側でも内内に合わせる目印。
    // 端ごとに「左辺・右辺・上辺・下辺」のどれに付いているかを覚える
    // （片端だけ見ると、辺に沿った梁が斜めに化けるので同じ辺の端は両方に付ける）
    const edgeX = (value: number): "left" | "right" | null => {
      const left = part.x + (part.insetLeft ?? 0);
      const right = part.x + part.width - (part.insetRight ?? 0);
      if (Math.abs(value - left) <= 1.5 || Math.abs(value - part.x) <= 1.5)
        return "left";
      if (
        Math.abs(value - right) <= 1.5 ||
        Math.abs(value - (part.x + part.width)) <= 1.5
      )
        return "right";
      return null;
    };
    const edgeY = (value: number): "top" | "bottom" | null => {
      const top = part.y + (part.insetTop ?? 0);
      const bottom = part.y + part.height - (part.insetBottom ?? 0);
      if (Math.abs(value - top) <= 1.5 || Math.abs(value - part.y) <= 1.5)
        return "top";
      if (
        Math.abs(value - bottom) <= 1.5 ||
        Math.abs(value - (part.y + part.height)) <= 1.5
      )
        return "bottom";
      return null;
    };
    setClipBeams(
      inside.map((beam) => ({
        dx1: beam.x1 - part.x,
        dy1: beam.y1 - part.y,
        dx2: beam.x2 - part.x,
        dy2: beam.y2 - part.y,
        symbol: beam.symbol,
        xEdge1: edgeX(beam.x1),
        xEdge2: edgeX(beam.x2),
        yEdge1: edgeY(beam.y1),
        yEdge2: edgeY(beam.y2),
      })),
    );
    /* 写し元の小梁が「同じ向き・同じ記号で等間隔」なら分割条件として覚える。
       貼る先の区画の大きさに合わせて同じ条件で入れ直せる（大きさが違っても等分になる） */
    const verticals = inside.every((beam) => beam.x1 === beam.x2);
    const horizontals = inside.every((beam) => beam.y1 === beam.y2);
    const symbols = new Set(inside.map((beam) => beam.symbol));
    let rule: { axis: "v" | "h"; symbol: string; parts: number } | null = null;
    if (
      inside.length > 0 &&
      symbols.size === 1 &&
      (verticals || horizontals)
    ) {
      const along = inside
        .map((beam) => (verticals ? beam.x1 : beam.y1))
        .sort((a, b) => a - b);
      const span = verticals ? part.width : part.height;
      const step = span / (inside.length + 1);
      const evenly = along.every(
        (value, i) =>
          Math.abs(value - (verticals ? part.x : part.y) - step * (i + 1)) <= 2,
      );
      if (evenly)
        rule = {
          axis: verticals ? "v" : "h",
          symbol: inside[0].symbol,
          parts: inside.length + 1,
        };
    }
    setClipRule(rule);
    if (inside.length > 0)
      setMessage(
        rule !== null
          ? `区画の小梁をコピーしました（${rule.axis === "v" ? "縦" : "横"}${rule.parts}分割の${rule.symbol}。貼る先の大きさに合わせて入れます）`
          : `区画の小梁${inside.length}本をコピーしました`,
      );
    else
      setMessage("その区画には小梁が入っていません（中に小梁がある区画でコピーしてください）");
    },
    [],
  );

  const copyRegion = useCallback(() => {
    const picked = regions[regions.length - 1];
    if (picked === undefined) return;
    /* 小梁で分かれた小区画をクリックしていても、大梁で囲まれた区画全体の
       「入力条件」を読み取る（小区画の辺に付いた小梁は境界で、内容ではない） */
    const part =
      enclosingRegion(
        current,
        picked.x + picked.width / 2,
        picked.y + picked.height / 2,
        halfWidthOf,
        false,
        columnHalfOf,
      ) ?? picked;
    const inside = current.beams.filter(
      (beam) =>
        beam.x1 >= part.x - 1 &&
        beam.x2 <= part.x + part.width + 1 &&
        beam.y1 >= part.y - 1 &&
        beam.y2 <= part.y + part.height + 1 &&
        // 区画の辺のうえに乗っている小梁は境界なので写す内容に含めない
        (beam.x1 !== beam.x2 ||
          (beam.x1 > part.x + 1 && beam.x1 < part.x + part.width - 1)) &&
        (beam.y1 !== beam.y2 ||
          (beam.y1 > part.y + 1 && beam.y1 < part.y + part.height - 1)),
    );
    learnFromBeams(part, inside);
  }, [regions, current, halfWidthOf, columnHalfOf, learnFromBeams]);

  /** 入力行側：一覧で選んだ小梁をまとめてコピー（その行を囲む大梁区画の条件で覚える） */
  const copySelBeams = useCallback(() => {
    const indices = [...selBeamSet].filter(
      (index) => index >= 0 && index < current.beams.length,
    );
    if (indices.length === 0) return;
    const beams = indices.map((index) => current.beams[index]);
    const mx =
      beams.reduce((sum, beam) => sum + (beam.x1 + beam.x2) / 2, 0) /
      beams.length;
    const my =
      beams.reduce((sum, beam) => sum + (beam.y1 + beam.y2) / 2, 0) /
      beams.length;
    const cell = enclosingRegion(
      current,
      mx,
      my,
      halfWidthOf,
      false,
      columnHalfOf,
    );
    const part: DrawingRegion =
      cell ?? {
        x: Math.min(...beams.map((beam) => Math.min(beam.x1, beam.x2))),
        y: Math.min(...beams.map((beam) => Math.min(beam.y1, beam.y2))),
        width:
          Math.max(...beams.map((beam) => Math.max(beam.x1, beam.x2))) -
          Math.min(...beams.map((beam) => Math.min(beam.x1, beam.x2))),
        height:
          Math.max(...beams.map((beam) => Math.max(beam.y1, beam.y2))) -
          Math.min(...beams.map((beam) => Math.min(beam.y1, beam.y2))),
      };
    learnFromBeams(part, beams);
  }, [current, selBeamSet, halfWidthOf, columnHalfOf, learnFromBeams]);

  const pasteBeams = useCallback(() => {
    if (regions.length === 0) return;
    let placed: FireproofDrawingBeam[] = [];
    if (clipRule !== null) {
      // 分割条件で入れ直す（貼る先の区画の大きさに合わせて等分）
      placed = regions.flatMap((part) =>
        dividedBeams(part, clipRule.axis, clipRule.parts, clipRule.symbol),
      );
    } else if (clipBeams.length > 0) {
      // 条件が読めない（向き・記号が混ざる、等間隔でない）ときは、写し元の位置のまま貼る
      placed = regions.flatMap((part) => {
        const left = part.x + (part.insetLeft ?? 0);
        const right = part.x + part.width - (part.insetRight ?? 0);
        const top = part.y + (part.insetTop ?? 0);
        const bottom = part.y + part.height - (part.insetBottom ?? 0);
        return clipBeams.map((clip) => ({
          x1: clip.xEdge1 === "left" ? left : clip.xEdge1 === "right" ? right : part.x + clip.dx1,
          x2: clip.xEdge2 === "left" ? left : clip.xEdge2 === "right" ? right : part.x + clip.dx2,
          y1: clip.yEdge1 === "top" ? top : clip.yEdge1 === "bottom" ? bottom : part.y + clip.dy1,
          y2: clip.yEdge2 === "top" ? top : clip.yEdge2 === "bottom" ? bottom : part.y + clip.dy2,
          symbol: clip.symbol,
        }));
      });
    }
    if (placed.length === 0) return;
    updateFloor({
      beams: [
        ...current.beams,
        ...placed.map((beam) => ({ ...beam, id: newBeamId() })),
      ],
    });
    setMessage(`${regions.length}か所に貼り付けました`);
  }, [regions, clipBeams, clipRule, current, updateFloor, newBeamId]);

  /* 区画を選んでいるあいだは Ctrl+C（最後の区画の形をコピー）・Ctrl+V（選んだ全部の区画へ貼り付け）も効く。
     入力欄の中の操作はそのまま（input/textareaのときは動かさない） */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        // 最後に触ったほうを写す（入力行を範囲指定したあとは小梁を写す）
        if (selFocusRef.current === "beam" && selBeamSet.size > 0) {
          copySelBeams();
          event.preventDefault();
        } else if (regions.length > 0) {
          copyRegion();
          event.preventDefault();
        } else if (selBeamSet.size > 0) {
          copySelBeams();
          event.preventDefault();
        }
      }
      if (key === "v" && regions.length > 0 && clipBeams.length > 0) {
        pasteBeams();
        event.preventDefault();
      }
      if (key === "z") {
        undo();
        event.preventDefault();
      }
      if (key === "y") {
        redo();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [regions, clipBeams, selBeamSet, copyRegion, copySelBeams, pasteBeams, undo, redo]);

  /* 小梁一覧の番号欄を押したまま動かす範囲指定の終わり（ボタンを離したとき） */
  useEffect(() => {
    const up = () => {
      beamRowDragRef.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const deleteBeam = useCallback(
    (index: number) => {
      /* 範囲指定の中の行を消すときは、選んだ全部をまとめて消す */
      if (selBeamRange !== null && selBeamSet.has(index)) {
        updateFloor({
          beams: current.beams.filter((_, i) => !selBeamSet.has(i)),
        });
        setMessage(`${selBeamSet.size}本消しました`);
      } else {
        updateFloor({ beams: current.beams.filter((_, i) => i !== index) });
      }
      setSelBeam(null);
      setSelBeamRange(null);
      setFocusTarget(null);
    },
    [current, updateFloor, selBeamRange, selBeamSet],
  );

  /** ④小梁：矢印キーで微調整（10mm。Shiftで1mm）、Delete/Backspaceで消す */
  useEffect(() => {
    if (selBeam === null) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const beam = current.beams[selBeam];
      if (beam === undefined) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteBeam(selBeam);
        event.preventDefault();
        return;
      }
      const vertical = beam.x1 === beam.x2;
      let delta = 0;
      if (vertical && event.key === "ArrowLeft") delta = -1;
      else if (vertical && event.key === "ArrowRight") delta = 1;
      else if (!vertical && event.key === "ArrowUp") delta = -1;
      else if (!vertical && event.key === "ArrowDown") delta = 1;
      if (delta === 0) return;
      updateFloor({
        beams: current.beams.map((item, i) =>
          i === selBeam
            ? nudgeBeam(item, delta * (event.shiftKey ? 1 : 10))
            : item,
        ),
      });
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selBeam, current, updateFloor, deleteBeam]);

  /* 図の中身が変わったら画像を書き直して保存する（呼び出せるようにするため） */
  useEffect(() => {
    if (floor === "") return;
    const signature = floorSignature(current);
    if (signature === renderedSignatureRef.current) return;
    const timer = window.setTimeout(() => {
      const svg = svgRef.current;
      if (svg === null) return;
      renderedSignatureRef.current = signature;
      void (async () => {
        const png = await renderPng(svg);
        if (png === null) return;
        setDrawing((before) => ({
          floors: {
            ...before.floors,
            [floor]: {
              ...(before.floors[floor] ?? emptyFloor()),
              image: png.image,
              pixelsPerMm: EXPORT_PPM,
              imageWidth: png.width,
              imageHeight: png.height,
            },
          },
        }));
        void save(true);
      })();
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, drawing, save]);

  const nx = current.xSpans.length;
  const ny = current.ySpans.length;
  const numbers = columnNumbers(current);

  /* 柱・大梁のリストは横の通り優先（A-1 の形・今までの並びのまま）。

     縦の通りは下の線から A,B,C… とふるので、下の線側（A）から順に並べる。
     通りが替わるところで少し間を空ける */
  const columnRows: { no: number; at: string; key: string; gap: boolean }[] = [];
  for (let yi = numbers.length - 1; yi >= 0; yi -= 1)
    numbers[yi].forEach((no, xi) =>
      columnRows.push({
        no,
        at: `${yGridLabel(ny - yi)}-${xGridLabel(xi)}`,
        key: columnKey(xi, yi),
        gap: xi === 0 && yi !== numbers.length - 1,
      }),
    );
  const girderRows: { no: number; at: string; key: string; gap: boolean }[] = [];
  for (let yi = ny; yi >= 0; yi -= 1)
    for (let xi = 0; xi < nx; xi += 1)
      girderRows.push({
        no: girderNumber("x", xi, yi, current),
        at: `${yGridLabel(ny - yi)}／${xGridLabel(xi)}〜${xGridLabel(xi + 1)}`,
        key: girderKey("x", xi, yi),
        gap: xi === 0,
      });
  for (let xi = 0; xi <= nx; xi += 1)
    for (let yi = ny - 1; yi >= 0; yi -= 1)
      girderRows.push({
        no: girderNumber("y", xi, yi, current),
        at: `${xGridLabel(xi)}／${yGridLabel(ny - yi - 1)}〜${yGridLabel(ny - yi)}`,
        key: girderKey("y", xi, yi),
        gap: yi === ny - 1,
      });

  /* ③大梁リストで範囲指定した行のキー（図に点線の範囲を出す） */
  const girderSel =
    girderSelRange === null
      ? new Set<string>()
      : new Set(
          girderRows
            .slice(
              Math.min(girderSelRange.from, girderSelRange.to),
              Math.max(girderSelRange.from, girderSelRange.to) + 1,
            )
            .map((row) => row.key),
        );

  /* ③大梁：行で範囲指定した大梁をまとめて動かす（上・左へ寄せ／中央／下・右へ寄せ）。
     梁の面が柱の面（両端で小さいほうの柱）に付く位置へ */
  const alignGirders = useCallback(
    (mode: "min" | "center" | "max") => {
      if (girderSel.size === 0) return;
      const next = { ...(current.girderAlign ?? {}) };
      girderSel.forEach((key) => {
        if (mode === "center") delete next[key];
        else next[key] = mode;
      });
      updateFloor({ girderAlign: next });
      const place =
        mode === "center"
          ? "中央（柱芯どおり）"
          : mode === "min"
            ? "上・左端"
            : "下・右端";
      setMessage(
        `${girderSel.size}本の大梁を${place}に動かしました（梁の面が小さいほうの柱の面に付きます）`,
      );
    },
    [girderSel, current, updateFloor],
  );


  /* リストにある記号（入った記号がリストに無いとき赤で示すため） */
  const knownColumns = useMemo(
    () =>
      new Set(
        memberLists.columns.members
          .map((member) => member.symbol.trim())
          .concat(memberLists.common.map((row) => row.symbol.trim()))
          .filter((symbol) => symbol !== ""),
      ),
    [memberLists],
  );
  const knownBeams = useMemo(
    () =>
      new Set(
        memberLists.beams.members
          .map((member) => member.symbol.trim())
          .concat(memberLists.common.map((row) => row.symbol.trim()))
          .filter((symbol) => symbol !== ""),
      ),
    [memberLists],
  );

  /* 入力欄・一覧で触った行に対応する図の場所（同じ色の枠で色付け） */
  const xsNow = positions(current.xSpans);
  const ysNow = positions(current.ySpans);
  const focusRect = useMemo(():
    | { x: number; y: number; width: number; height: number }
    | null => {
    if (focusTarget === null) return null;
    const pad = 700;
    if (focusTarget.kind === "beam") return null; // 小梁は選んだ全部を点線で囲む
    if (focusTarget.kind === "column") {
      const [xi, yi] = focusTarget.key.split(",").map(Number);
      const x = xsNow[xi];
      const y = ysNow[yi];
      if (x === undefined || y === undefined) return null;
      return { x: x - pad, y: y - pad, width: pad * 2, height: pad * 2 };
    }
    const [axis, point] = focusTarget.key.split(":");
    const [xi, yi] = point.split(",").map(Number);
    const off = girderOffset(current, focusTarget.key, halfWidthOf, columnHalfOf);
    if (axis === "x" && xi < xsNow.length - 1 && yi < ysNow.length) {
      const x1 = xsNow[xi] + (hasColumn(current, xi, yi) ? COL_HALF : 0);
      const x2 =
        xsNow[xi + 1] - (hasColumn(current, xi + 1, yi) ? COL_HALF : 0);
      const y = ysNow[yi] + off;
      return {
        x: x1,
        y: y - 450,
        width: x2 - x1,
        height: 900,
      };
    }
    if (axis === "y" && xi < xsNow.length && yi < ysNow.length - 1) {
      const y1 = ysNow[yi] + (hasColumn(current, xi, yi) ? COL_HALF : 0);
      const y2 =
        ysNow[yi + 1] - (hasColumn(current, xi, yi + 1) ? COL_HALF : 0);
      const x = xsNow[xi] + off;
      return {
        x: x - 450,
        y: y1,
        width: 900,
        height: y2 - y1,
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget, current]);

  /* 図形の全体（mm）→ 画面に収まる大きさ（px）×倍率 */
  const xs = positions(current.xSpans);
  const ys = positions(current.ySpans);
  const drawingW = (xs[xs.length - 1] ?? 0) + MARGIN_LEFT + MARGIN_RIGHT;
  const drawingH = (ys[ys.length - 1] ?? 0) + MARGIN_TOP + MARGIN_BOTTOM;
  const pad = 48;
  const availW = Math.max(160, (viewSize?.width ?? 1100) - pad);
  const availH = Math.max(160, (viewSize?.height ?? 620) - pad);
  const fitW = Math.min(availW, availH * (drawingW / Math.max(1, drawingH)));
  const displaySize =
    drawingW > 0 && drawingH > 0
      ? { width: fitW * zoom, height: (fitW * zoom * drawingH) / drawingW }
      : undefined;

  return (
    <div
      className="estimate-page fireproof-drawing-page"
      ref={pageRef}
      onKeyDown={handleNavKey}
    >
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>鉄骨伏図の作成</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <span className="floor-tabs">
          {floorTabs.map((name, index) => {
            const beamAtTab = floorTabs[index + 1] ?? "R";
            const label =
              name === "R"
                ? "RF"
                : `${name}F(${beamAtTab === "R" ? "RF" : `梁${beamAtTab}F`})`;
            return (
              <button
                key={name}
                type="button"
                className={name === floor ? "tab on" : "tab"}
                onClick={() => {
                  setFloor(name);
                  setGirderSelRange(null);
                }}
              >
                {label}
                {missingByFloor.has(name) && (
                  <span className="joint-warn">取合(未)</span>
                )}
              </button>
            );
          })}
        </span>
        <button
          type="button"
          title="表示中の階の図面をまるごとコピーします"
          onClick={() => {
            setClipFloor(JSON.parse(JSON.stringify(current)));
            setMessage(`${floor === "R" ? "RF" : `${floor}F`}の図面をコピーしました`);
          }}
        >
          階コピー
        </button>
        <button
          type="button"
          disabled={clipFloor === null}
          title="コピーした階の図面を、選んだ階に貼り付けます（貼り先の階の鉄骨リストの寸法で描きます）"
          onClick={() => {
            if (clipFloor === null) return;
            setFloorPastePick((pick) =>
              pick.size === 0 ? new Set([floor]) : pick,
            );
            setFloorPasteOpen((open) => !open);
          }}
        >
          指定階に貼付
        </button>
        <button
          type="button"
          disabled={past.length === 0}
          title="ひとつ前に戻す（Ctrl+Z）"
          onClick={undo}
        >
          ↶ 戻る
        </button>
        <button
          type="button"
          disabled={future.length === 0}
          title="戻したものをやり直す（Ctrl+Y）"
          onClick={redo}
        >
          ↷ 進む
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      {floorPasteOpen && clipFloor !== null && (
        <div className="floor-paste">
          <span>貼り付け先：</span>
          {floorTabs.map((name, index) => {
            const beamAtTab = floorTabs[index + 1] ?? "R";
            const label =
              name === "R"
                ? "RF"
                : `${name}F(${beamAtTab === "R" ? "RF" : `梁${beamAtTab}F`})`;
            const on = floorPastePick.has(name);
            return (
              <button
                key={name}
                type="button"
                className={on ? "tab on" : "tab"}
                onClick={() =>
                  setFloorPastePick((pick) => {
                    const next = new Set(pick);
                    if (next.has(name)) next.delete(name);
                    else next.add(name);
                    return next;
                  })
                }
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            disabled={floorPastePick.size === 0}
            onClick={() =>
              pasteFloorTo(
                floorTabs.filter((name) => floorPastePick.has(name)),
              )
            }
          >
            まとめて貼り付け
          </button>
          <button type="button" onClick={() => setFloorPasteOpen(false)}>
            やめる
          </button>
        </div>
      )}

      <div className="fireproof-drawing-body">
        <div className="drawing-side">
          <section className="drawing-section">
            <div className="section-bar">
              <h3>① 柱線寸法線</h3>
            </div>
            <div className="span-inputs">
              <label>
                X軸
                <input
                  value={spanListText(current.xSpans)}
                  placeholder="7300,7650,7300"
                  onChange={(event) =>
                    updateFloor({ xSpans: parseSpanList(event.target.value) })
                  }
                />
              </label>
              <label>
                Y軸
                <input
                  value={spanListText(current.ySpans)}
                  placeholder="7350,6650"
                  onChange={(event) =>
                    updateFloor({ ySpans: parseSpanList(event.target.value) })
                  }
                />
              </label>
              <p className="hint">
                寸法を「,」区切りで入れると一点鎖線の柱線ができます（全角の「、」や空白でも切れます）
              </p>
            </div>
            {/* 補助寸法線（柱線寸法線とは別。梁を引くための線をずらして引く） */}
            <div className="span-inputs">
              <div className="list-buttons">
                <button
                  type="button"
                  className={auxMode ? "on" : ""}
                  onClick={() => {
                    setAuxMode(!auxMode);
                    setAuxBase(null);
                  }}
                >
                  {auxMode ? "やめる" : "寸法線を足す"}
                </button>
              </div>
              {auxMode && auxBase === null && (
                <p className="hint">
                  図の柱線をクリックすると基の線になります（縦の線→縦にずらした線、横の線→横にずらした線ができます）
                </p>
              )}
              {auxMode && auxBase !== null && (
                <div className="aux-add">
                  <span>
                    {auxBase.axis === "x"
                      ? xGridLabel(auxBase.base)
                      : yGridLabel(current.ySpans.length - auxBase.base)}
                    の線から
                  </span>
                  <select
                    value={auxDir}
                    onChange={(event) =>
                      setAuxDir(Number(event.target.value) === -1 ? -1 : 1)
                    }
                  >
                    <option value={1}>
                      {auxBase.axis === "x" ? "右" : "下"}
                    </option>
                    <option value={-1}>
                      {auxBase.axis === "x" ? "左" : "上"}
                    </option>
                  </select>
                  <span>に</span>
                  <input
                    className="dist"
                    value={auxDist}
                    placeholder="1500"
                    inputMode="decimal"
                    onChange={(event) =>
                      setAuxDist(
                        toHalfWidth(event.target.value).replaceAll(",", "."),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addAuxLine();
                    }}
                  />
                  <span>mm</span>
                  <button type="button" onClick={addAuxLine}>
                    線を引く
                  </button>
                  <button
                    type="button"
                    className="flat"
                    onClick={() => setAuxBase(null)}
                  >
                    選び直す
                  </button>
                </div>
              )}
              {(current.auxLines ?? []).length > 0 && (
                <div className="aux-list">
                  {(current.auxLines ?? []).map((line, index) => {
                    const pos = auxLinePosition(current, line);
                    if (pos === null) return null;
                    const baseLabel =
                      line.axis === "x"
                        ? xGridLabel(line.base)
                        : yGridLabel(current.ySpans.length - line.base);
                    const dir =
                      line.offset > 0
                        ? line.axis === "x"
                          ? "右"
                          : "下"
                        : line.axis === "x"
                          ? "左"
                          : "上";
                    return (
                      <div key={line.id ?? `a${index}`} className="aux-row">
                        <span>
                          {baseLabel}の{dir}に
                          {Math.abs(line.offset).toLocaleString("ja-JP")}
                          （{line.axis === "x" ? "縦" : "横"}の線）
                        </span>
                        <button
                          type="button"
                          className="flat"
                          onClick={() =>
                            updateFloor({
                              auxLines: (current.auxLines ?? []).filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          消す
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {current.ySpans.length > 0 && (
              <div className="span-inputs axis-heights">
                <p className="hint">
                  通りごとの柱の高さ（m。屋根勾配など高さが違うときだけ入れます。空欄は鉄骨リストの階高
                  {floorHeight !== null
                    ? `（${heightMetersText(floorHeight)}）`
                    : ""}
                  ）
                </p>
                {current.xSpans.length > 0 && (
                  <div className="axis-height-list">
                    {positions(current.xSpans).map((_, xi) => {
                      const value = current.axisHeightsX?.[String(xi)];
                      return (
                        <label key={xi}>
                          {xGridLabel(xi)}
                          <AxisHeightInput
                            mm={value}
                            placeholder={
                              floorHeight !== null
                                ? heightMetersText(floorHeight)
                                : ""
                            }
                            onChange={(mm) => {
                              const next = { ...(current.axisHeightsX ?? {}) };
                              if (mm === null) delete next[String(xi)];
                              else next[String(xi)] = mm;
                              updateFloor({ axisHeightsX: next });
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="axis-height-list">
                  {positions(current.ySpans).map((_, yi) => {
                    const label = yGridLabel(
                      current.ySpans.length - yi,
                    );
                    const value = current.axisHeights?.[String(yi)];
                    return (
                      <label key={yi}>
                        {label}
                        <AxisHeightInput
                          mm={value}
                          placeholder={
                            floorHeight !== null
                              ? heightMetersText(floorHeight)
                              : ""
                          }
                          onChange={(mm) => {
                            const next = { ...(current.axisHeights ?? {}) };
                            if (mm === null) delete next[String(yi)];
                            else next[String(yi)] = mm;
                            updateFloor({ axisHeights: next });
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="drawing-section">
            <div className="section-bar">
              <h3>② 柱（交点の番号に記号）</h3>
            </div>
            <SymbolList
              rows={columnRows}
              values={current.columns}
              onValues={(next) => updateFloor({ columns: next })}
              emptyHint="先にX軸・Y軸の寸法を入れてください"
              onActiveRow={(row) =>
                setFocusTarget({ kind: "column", key: row.key })
              }
              known={knownColumns}
              none={noColumnSet}
              onToggleNone={toggleNoColumn}
              selectedKey={selColumn}
            />
          </section>

          <section className="drawing-section">
            <div className="section-bar">
              <h3>③ 大梁（柱間の番号に記号）</h3>
              <div className="beam-ops">
                <span className="hint">位置：</span>
                <button
                  type="button"
                  disabled={girderSel.size === 0}
                  title="行で選んだ大梁をまとめて動かします：横の梁は上端、縦の梁は左端に、梁の面が柱の面（小さいほうの柱）に付く位置へ"
                  onClick={() => alignGirders("min")}
                >
                  上・左へ寄せ
                </button>
                <button
                  type="button"
                  disabled={girderSel.size === 0}
                  title="行で選んだ大梁を柱芯どおり（中央）に戻します"
                  onClick={() => alignGirders("center")}
                >
                  中央
                </button>
                <button
                  type="button"
                  disabled={girderSel.size === 0}
                  title="行で選んだ大梁をまとめて動かします：横の梁は下端、縦の梁は右端に、梁の面が柱の面（小さいほうの柱）に付く位置へ"
                  onClick={() => alignGirders("max")}
                >
                  下・右へ寄せ
                </button>
              </div>
            </div>
            <SymbolList
              rows={girderRows}
              values={current.girders}
              onValues={(next) => updateFloor({ girders: next })}
              emptyHint="先にX軸・Y軸の寸法を入れてください"
              onActiveRow={(row) =>
                setFocusTarget({ kind: "girder", key: row.key })
              }
              onSelChange={setGirderSelRange}
              known={knownBeams}
              none={noGirderSet}
              onToggleNone={toggleNoGirder}
              selectedKey={selGirder}
            />
            <div className="diag-block">
              <div className="diag-head">
                <span>引き梁（交点2か所を押して引く線。斜め・縦・横）</span>
                <button
                  type="button"
                  className={diagMode ? "on" : ""}
                  disabled={nx === 0 || ny === 0}
                  onClick={() => {
                    setDiagMode((on) => !on);
                    setDiagStart(null);
                  }}
                >
                  {diagMode ? "やめる" : "梁を足す"}
                </button>
              </div>
              {diagMode && (
                <p className="hint">
                  図の交点・引いてある梁や柱の線上を2か所クリック（始点→終点）すると梁が入ります（斜め・縦・横どこでも）
                </p>
              )}
              {(current.diagGirders ?? []).map((g, index) => {
                const align = diagAlign(g);
                return (
                  <div
                    key={g.id ?? index}
                    className={`diag-row${index === selDiag ? " on" : ""}`}
                    onClick={() => setSelDiag(index)}
                  >
                    <span className="at">{diagGirderPosition(current, g)}</span>
                    <input
                      className={
                        g.symbol.trim() !== "" &&
                        !knownBeams.has(g.symbol.trim())
                          ? "bad"
                          : undefined
                      }
                      value={g.symbol}
                      placeholder="G1"
                      onFocus={() => setSelDiag(index)}
                      onChange={(event) =>
                        changeDiagSymbol(index, event.target.value)
                      }
                    />
                    {align !== null && (
                      <span className="diag-align">
                        <button
                          type="button"
                          className={
                            (g.offset ?? 0) === -align.proj ? "on" : ""
                          }
                          title={`柱の面に合わせる（${align.minus}）`}
                          onClick={(event) => {
                            event.stopPropagation();
                            alignDiag(index, -align.proj);
                          }}
                        >
                          {align.minus}
                        </button>
                        <button
                          type="button"
                          className={(g.offset ?? 0) === 0 ? "on" : ""}
                          title="中央"
                          onClick={(event) => {
                            event.stopPropagation();
                            alignDiag(index, 0);
                          }}
                        >
                          中
                        </button>
                        <button
                          type="button"
                          className={(g.offset ?? 0) === align.proj ? "on" : ""}
                          title={`柱の面に合わせる（${align.plus}）`}
                          onClick={(event) => {
                            event.stopPropagation();
                            alignDiag(index, align.proj);
                          }}
                        >
                          {align.plus}
                        </button>
                      </span>
                    )}
                    <button
                      type="button"
                      className="diag-del"
                      title="この梁を消す"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteDiag(index);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="drawing-section">
            <div className="section-bar">
              <h3>④ 小梁（区画を分割して配置）</h3>
            </div>
            <div className="beam-form">
              <p className="hint">
                図の中をクリックすると、まわりの線で囲まれた区画が色付きます
                （小梁でできた小さい区画も選べます。Shift+クリックで複数まとめて選べます）
              </p>
              <div className="beam-inputs">
                <label>
                  記号
                  <input
                    className={
                      beamSymbol.trim() !== "" &&
                      !knownBeams.has(beamSymbol.trim())
                        ? "bad"
                        : undefined
                    }
                    value={beamSymbol}
                    onChange={(event) => setBeamSymbol(event.target.value)}
                  />
                </label>
                <label>
                  向き
                  <select
                    value={beamAxis}
                    onChange={(event) =>
                      setBeamAxis(event.target.value === "h" ? "h" : "v")
                    }
                  >
                    <option value="v">縦</option>
                    <option value="h">横</option>
                  </select>
                </label>
                <label>
                  分割数
                  <input
                    type="number"
                    min={2}
                    value={beamParts}
                    onChange={(event) =>
                      setBeamParts(Math.max(2, Number(event.target.value) || 2))
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={regions.length === 0 || beamSymbol.trim() === ""}
                  onClick={placeBeams}
                >
                  配置
                </button>
              </div>
              <p className="hint">
                分割数は「でき上がる区画の数」です（3分割→線2本）。小梁の端は囲む線の内側（内内）で止まります
              </p>
              <div className="beam-ops">
                <button
                  type="button"
                  disabled={regions.length === 0}
                  onClick={copyRegion}
                >
                  区画コピー
                </button>
                <button
                  type="button"
                  disabled={selBeamSet.size === 0}
                  title="一覧で選んだ行の小梁をコピーします（貼る先の区画を選んで「区画へ貼り付け」）"
                  onClick={copySelBeams}
                >
                  行をコピー
                  {selBeamSet.size > 1 ? `（${selBeamSet.size}本）` : ""}
                </button>
                <button
                  type="button"
                  disabled={regions.length === 0 || (clipRule === null && clipBeams.length === 0)}
                  onClick={pasteBeams}
                >
                  区画へ貼り付け
                  {clipRule !== null
                    ? `（${clipRule.axis === "v" ? "縦" : "横"}${clipRule.parts}分割 ${clipRule.symbol}）`
                    : clipBeams.length > 0
                      ? `（${clipBeams.length}本）`
                      : ""}
                </button>
              </div>
              {regions.length > 1 && (
                <p className="hint">
                  {regions.length}か所選んでいます（配置・貼り付けは全部の区画に入ります）
                </p>
              )}
              {current.beams.length > 0 && (
                <div className="beam-list">
                  {current.beams.map((beam, index) => (
                    <button
                      key={index}
                      type="button"
                      className={`beam-row${index === selBeam ? " on" : ""}${selBeamSet.has(index) && selBeamRange !== null ? " sel" : ""}`}
                      onMouseEnter={() => {
                        if (beamRowDragRef.current)
                          setSelBeamRange((before) =>
                            before === null
                              ? { from: index, to: index }
                              : { ...before, to: index },
                          );
                      }}
                      onClick={(event) => {
                        if (rowClickSuppressRef.current) {
                          rowClickSuppressRef.current = false;
                          return;
                        }
                        selFocusRef.current = "beam";
                        if (event.shiftKey) {
                          setSelBeamRange({
                            from: beamAnchorRef.current ?? selBeam ?? index,
                            to: index,
                          });
                          setSelBeam(index);
                          setFocusTarget({ kind: "beam", index });
                        } else {
                          setSelBeam(index);
                          setSelBeamRange(null);
                          beamAnchorRef.current = index;
                          setFocusTarget({ kind: "beam", index });
                        }
                      }}
                    >
                      <span
                        className="no"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          rowClickSuppressRef.current = true;
                          beamRowDragRef.current = true;
                          beamAnchorRef.current = index;
                          setSelBeam(index);
                          setSelBeamRange({ from: index, to: index });
                          selFocusRef.current = "beam";
                          setFocusTarget({ kind: "beam", index });
                        }}
                      >
                        {index + 1}
                      </span>
                      <span className="at">{beam.symbol}</span>
                      <span className="len">
                        {beam.x1 === beam.x2 ? "縦" : "横"}{" "}
                        {Math.round(
                          beamSlopeLength(beam, current, floorHeight ?? 0),
                        ).toLocaleString("ja-JP")}
                        mm
                        {Math.round(
                          beamSlopeLength(beam, current, floorHeight ?? 0) -
                            beamLength(beam),
                        ) > 0 &&
                          `（勾配＋${Math.round(
                            beamSlopeLength(beam, current, floorHeight ?? 0) -
                              beamLength(beam),
                          ).toLocaleString("ja-JP")}）`}
                      </span>
                      {(index === selBeam || selBeamSet.has(index)) && (
                        <span
                          className="del"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteBeam(index);
                          }}
                        >
                          消す
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <p className="hint">
                行の番号を押して動かすかShift+クリックで範囲指定（選んだ行はCtrl+Cでコピー・消すでまとめて消せます）。
                小梁はつかんで動かせます。選んで←→（横の梁は↑↓）で10mm・Shiftで1mmずつ動きます
              </p>
            </div>
          </section>

          <section className="drawing-section">
            <div className="section-bar">
              <h3>⑤ 取合記号</h3>
            </div>
            <div className="joint-form">
              <div className="joint-picks">
                {["2", "3", "4"].map((pick) => (
                  <button
                    key={pick}
                    type="button"
                    className={jointSymbol === pick ? "on" : ""}
                    onClick={() => setJointSymbol(pick)}
                  >
                    {pick}
                  </button>
                ))}
                <input
                  value={jointSymbol === "" ? "" : jointSymbol}
                  placeholder="その他"
                  title="2・3・4以外の記号を入れるときはここに打ってください"
                  onChange={(event) => setJointSymbol(event.target.value)}
                />
                <button
                  type="button"
                  className={jointSymbol === "" ? "on" : ""}
                  onClick={() => setJointSymbol("")}
                >
                  消す
                </button>
              </div>
              <div className="joint-ops">
                <button
                  type="button"
                  disabled={Object.keys(current.columns).length === 0}
                  onClick={() => fillJoints("column")}
                >
                  柱に全部
                </button>
                <button
                  type="button"
                  disabled={Object.keys(current.girders).length === 0}
                  onClick={() => fillJoints("girder")}
                >
                  大梁に全部
                </button>
                <button
                  type="button"
                  disabled={current.beams.length === 0}
                  onClick={() => fillJoints("beam")}
                >
                  小梁に全部
                </button>
                <button
                  type="button"
                  className={showMissing ? "on" : ""}
                  title="取合記号が入っていない柱・大梁・小梁を図の中で点滅させます（もう一度押すと消えます）"
                  onClick={() => setShowMissing((on) => !on)}
                >
                  未入力表示
                </button>
              </div>
              <p className="hint">
                耐火被覆の断面積算出用の記号を、柱・大梁・小梁のそれぞれに1つずつ入れます。
                図の○印をクリックすると、いま選んでいる記号になります。
                同じ記号をもう一度押すか「消す」を選んで押すと記号が消えます。
                いちばん多い記号を全部に入れてから、違うところだけ図で直す入れ方が早いです
              </p>
            </div>
          </section>
        </div>

        <div
          className="drawing-canvas"
          ref={canvasRef}
          style={{
            justifyContent:
              displaySize !== undefined && displaySize.width >= availW
                ? "flex-start"
                : "center",
          }}
        >
          {nx === 0 || ny === 0 ? (
            <p className="empty">
              X軸・Y軸の寸法を入れると、ここに伏図ができます
            </p>
          ) : (
            <>
              <FloorSvg
                floor={current}
                regions={regions}
                focus={focusRect}
                selectedBeams={selBeamSet}
                girderSel={girderSel}
                onRegionClick={handleRegionClick}
                onBeamPointerDown={handleBeamPointerDown}
                onPointerMove={handleBeamPointerMove}
                onPointerUp={endBeamDrag}
                onColumnPick={setSelColumn}
                onGirderPick={setSelGirder}
                onDiagPick={setSelDiag}
                diagMode={diagMode}
                diagStart={diagStart}
                onIntersectionPick={pickIntersection}
                onLinePick={pickLinePoint}
                auxMode={auxMode}
                onAuxBasePick={pickAuxBase}
                knownColumns={knownColumns}
                knownBeams={knownBeams}
                halfWidthOf={halfWidthOf}
                columnHalfOf={columnHalfOf}
                girderOffsetOf={girderOffsetOf}
                onJointClick={clickJoint}
                jointMissing={missingNow}
                displaySize={displaySize}
                svgRef={svgRef}
              />
              <div className="zoom-bar">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))}
                >
                  図面−
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
                >
                  図面＋
                </button>
                <button type="button" onClick={() => setZoom(1)}>
                  全体
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
