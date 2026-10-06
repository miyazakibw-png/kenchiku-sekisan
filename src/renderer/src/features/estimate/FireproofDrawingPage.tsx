import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "@shared/types";
import {
  columnFloorLabels,
  normalizeFloorList,
  resolveSize,
  SHAPE_LABEL,
  type FireproofFloorList,
} from "../../../../core/fireproof/fireproofList";
import {
  beamLength,
  columnKey,
  columnNumbers,
  dividedBeams,
  emptyFloor,
  enclosingRegion,
  girderKey,
  girderNumber,
  nudgeBeam,
  parseDrawing,
  parseSpanList,
  positions,
  spanListText,
  xGridLabel,
  yGridLabel,
  type DrawingRegion,
  type FireproofDrawing,
  type FireproofDrawingFloor,
} from "../../../../core/fireproof/fireproofDrawing";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
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
const GIRDER_HALF = 75; // 大梁の2本線の半間隔
const FONT_DIM = 400;
const FONT_BUBBLE = 420;
const FONT_SYMBOL = 430;
const FONT_NO = 260;

/** X軸方向の寸法線（上側） */
function XDimension({ xs }: { xs: number[] }): JSX.Element {
  const first = xs[0];
  const last = xs[xs.length - 1];
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
    </g>
  );
}

/** Y軸方向の寸法線（左側） */
function YDimension({ ys }: { ys: number[] }): JSX.Element {
  const first = ys[0];
  const last = ys[ys.length - 1];
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
}: {
  rows: SymbolRow[];
  values: Record<string, string>;
  onValues: (next: Record<string, string>) => void;
  emptyHint: string;
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

  const pick = (index: number) => {
    dragSel.current = true;
    setSel({ from: index, to: index });
    boxRef.current?.focus();
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
          className={`symbol-row${row.gap ? " gap" : ""}${inSel(index) ? " sel" : ""}`}
          key={row.key}
        >
          <span
            className="row-label"
            onMouseDown={(event) => {
              event.preventDefault();
              pick(index);
            }}
            onMouseEnter={() => extend(index)}
          >
            <span className="no">{row.no}</span>
            <span className="at">{row.at}</span>
          </span>
          <input
            data-row={index}
            value={values[row.key] ?? ""}
            placeholder={row.key.startsWith("x:") || row.key.startsWith("y:") ? "G1" : "C1"}
            onFocus={() => setSel(null)}
            onChange={(event) =>
              onValues({ ...values, [row.key]: event.target.value })
            }
          />
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

/** 柱がある交点なら true */
function hasColumn(
  floor: FireproofDrawingFloor,
  xi: number,
  yi: number,
): boolean {
  return (floor.columns[columnKey(xi, yi)] ?? "").trim() !== "";
}

/**
 * 1階分の鉄骨伏図（SVG）。座標はmm。
 * 柱線（一点鎖線）→ 交点の柱 → 柱間の大梁 → 区画の小梁 と、リストの番号を薄く添える。
 * 大梁の端は柱の四角の端（柱面中心）。柱が無い交点は格子線の点で終わる。
 */
function FloorSvg({
  floor,
  region,
  selectedBeam,
  onRegionClick,
  onBeamPointerDown,
  onPointerMove,
  onPointerUp,
  columnSizes,
  beamSizes,
  displaySize,
  svgRef,
}: {
  floor: FireproofDrawingFloor;
  region: DrawingRegion | null;
  selectedBeam: number | null;
  onRegionClick: (x: number, y: number) => void;
  onBeamPointerDown: (index: number, event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  /** 柱記号→「□-500*500」、梁記号→「300」（リストから読んだ寸法） */
  columnSizes: Map<string, string>;
  beamSizes: Map<string, string>;
  /** 表示サイズ（px）。画面に収める大きさ×拡大率を外から渡す */
  displaySize?: { width: number; height: number };
  svgRef: React.Ref<SVGSVGElement>;
}): JSX.Element {
  const xs = positions(floor.xSpans);
  const ys = positions(floor.ySpans);
  const totalX = xs[xs.length - 1] ?? 0;
  const totalY = ys[ys.length - 1] ?? 0;
  const width = totalX + MARGIN_LEFT + MARGIN_RIGHT;
  const height = totalY + MARGIN_TOP + MARGIN_BOTTOM;
  const numbers = columnNumbers(floor);

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
      {floor.xSpans.length > 0 && <XDimension xs={xs} />}
      {floor.ySpans.length > 0 && <YDimension ys={ys} />}
      {/* 通し芯ラベル（Xは①②③…・YはABC…） */}
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
              {yGridLabel(yi)}
            </text>
          </g>
        ))}
      </g>
      {/* 選んだ区画の色付け（画像への書き出しには含めない） */}
      {region !== null && (
        <rect
          className="selection"
          x={region.x}
          y={region.y}
          width={region.width}
          height={region.height}
        />
      )}
      {/* 大梁（柱間の区間。2本線で描く。端は柱面中心＝柱の四角の端） */}
      <g className="girder">
        {Object.entries(floor.girders).map(([key, symbol]) => {
          const [axis, point] = key.split(":");
          const [xi, yi] = point.split(",").map(Number);
          if (axis === "x" && xi >= 0 && xi < xs.length - 1 && yi >= 0 && yi < ys.length) {
            const x1 = xs[xi] + (hasColumn(floor, xi, yi) ? COL_HALF : 0);
            const x2 = xs[xi + 1] - (hasColumn(floor, xi + 1, yi) ? COL_HALF : 0);
            const y = ys[yi];
            const mx = (x1 + x2) / 2;
            const size = beamSizes.get(symbol.trim());
            return (
              <g key={key}>
                <line x1={x1} y1={y - GIRDER_HALF} x2={x2} y2={y - GIRDER_HALF} />
                <line x1={x1} y1={y + GIRDER_HALF} x2={x2} y2={y + GIRDER_HALF} />
                <text x={mx} y={y - GIRDER_HALF - 120} textAnchor="middle" fontSize={FONT_SYMBOL}>
                  {symbol}
                  {size !== undefined && (
                    <tspan className="size" dx="220">{size}</tspan>
                  )}
                </text>
              </g>
            );
          }
          if (axis === "y" && yi >= 0 && yi < ys.length - 1 && xi >= 0 && xi < xs.length) {
            const y1 = ys[yi] + (hasColumn(floor, xi, yi) ? COL_HALF : 0);
            const y2 = ys[yi + 1] - (hasColumn(floor, xi, yi + 1) ? COL_HALF : 0);
            const x = xs[xi];
            const my = (y1 + y2) / 2;
            const size = beamSizes.get(symbol.trim());
            return (
              <g key={key}>
                <line x1={x - GIRDER_HALF} y1={y1} x2={x - GIRDER_HALF} y2={y2} />
                <line x1={x + GIRDER_HALF} y1={y1} x2={x + GIRDER_HALF} y2={y2} />
                <text
                  x={x + GIRDER_HALF + 160}
                  y={my}
                  textAnchor="middle"
                  fontSize={FONT_SYMBOL}
                  transform={`rotate(-90 ${x + GIRDER_HALF + 160} ${my})`}
                >
                  {symbol}
                  {size !== undefined && (
                    <tspan className="size" dx="220">{size}</tspan>
                  )}
                </text>
              </g>
            );
          }
          return null;
        })}
      </g>
      {/* 小梁（区画を分割する2本線。つかんで動かせる） */}
      <g className="beam">
        {floor.beams.map((beam, index) => {
          const vertical = beam.x1 === beam.x2;
          const mx = (beam.x1 + beam.x2) / 2;
          const my = (beam.y1 + beam.y2) / 2;
          return (
            <g
              key={index}
              className={index === selectedBeam ? "on" : ""}
              onPointerDown={(event) => {
                event.stopPropagation();
                onBeamPointerDown(index, event);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {vertical ? (
                <>
                  <line x1={beam.x1 - 60} y1={beam.y1} x2={beam.x2 - 60} y2={beam.y2} />
                  <line x1={beam.x1 + 60} y1={beam.y1} x2={beam.x2 + 60} y2={beam.y2} />
                  <text
                    x={mx + 140}
                    y={my}
                    textAnchor="middle"
                    fontSize={FONT_SYMBOL * 0.85}
                    transform={`rotate(-90 ${mx + 140} ${my})`}
                  >
                    {beam.symbol}
                    {beamSizes.get(beam.symbol.trim()) !== undefined && (
                      <tspan className="size" dx="180">
                        {beamSizes.get(beam.symbol.trim())}
                      </tspan>
                    )}
                  </text>
                </>
              ) : (
                <>
                  <line x1={beam.x1} y1={beam.y1 - 60} x2={beam.x2} y2={beam.y2 - 60} />
                  <line x1={beam.x1} y1={beam.y1 + 60} x2={beam.x2} y2={beam.y2 + 60} />
                  <text x={mx} y={my - 140} textAnchor="middle" fontSize={FONT_SYMBOL * 0.85}>
                    {beam.symbol}
                    {beamSizes.get(beam.symbol.trim()) !== undefined && (
                      <tspan className="size" dx="180">
                        {beamSizes.get(beam.symbol.trim())}
                      </tspan>
                    )}
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
          const x = xs[xi];
          const y = ys[yi];
          const size = columnSizes.get(symbol.trim());
          return (
            <g key={key}>
              <rect x={x - COL_HALF} y={y - COL_HALF} width={COL_HALF * 2} height={COL_HALF * 2} />
              <text x={x + COL_HALF + 90} y={y + FONT_SYMBOL * 0.38} fontSize={FONT_SYMBOL}>
                {symbol}
              </text>
              {size !== undefined && (
                <text
                  className="size"
                  x={x + COL_HALF + 90}
                  y={y + FONT_SYMBOL * 0.38 + FONT_SYMBOL * 0.85}
                  fontSize={FONT_SYMBOL * 0.72}
                >
                  {size}
                </text>
              )}
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
            return (
              <text key={`gnx${xi},${yi}`} x={(x + xs[xi + 1]) / 2} y={y + GIRDER_HALF + FONT_NO + 120} textAnchor="middle" fontSize={FONT_NO}>
                {no}
              </text>
            );
          }),
        )}
        {xs.map((x, xi) =>
          ys.slice(0, -1).map((y, yi) => {
            const no = girderNumber("y", xi, yi, floor);
            return (
              <text key={`gny${xi},${yi}`} x={x + GIRDER_HALF + 140} y={(y + ys[yi + 1]) / 2 - GIRDER_HALF - 60} fontSize={FONT_NO}>
                {no}
              </text>
            );
          }),
        )}
      </g>
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
        const svg = event.currentTarget;
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const matrix = svg.getScreenCTM();
        if (matrix === null) return;
        const at = point.matrixTransform(matrix.inverse());
        onRegionClick(at.x - MARGIN_LEFT, at.y - MARGIN_TOP);
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
  /** ④小梁：選んだ区画・選んだ小梁・入力する記号と分割の仕方 */
  const [region, setRegion] = useState<DrawingRegion | null>(null);
  const [selBeam, setSelBeam] = useState<number | null>(null);
  const [beamSymbol, setBeamSymbol] = useState("B40");
  const [beamAxis, setBeamAxis] = useState<"v" | "h">("v");
  const [beamParts, setBeamParts] = useState(3);
  const [clipBeams, setClipBeams] = useState<
    { dx1: number; dy1: number; dx2: number; dy2: number; symbol: string }[]
  >([]);
  /** 小梁をつかんでいる最中の持ち場 */
  const dragRef = useRef<{
    index: number;
    start: FireproofDrawingFloor["beams"][number];
    originX: number;
    originY: number;
    applied: number;
  } | null>(null);
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
  }>({ columns: { floors: [], members: [] }, beams: { floors: [], members: [] } });
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

  const updateFloor = useCallback(
    (patch: Partial<FireproofDrawingFloor>) => {
      setDrawing((before) => ({
        floors: {
          ...before.floors,
          [floor]: { ...(before.floors[floor] ?? emptyFloor()), ...patch },
        },
      }));
    },
    [floor],
  );

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
    setRegion(null);
    setSelBeam(null);
    dragRef.current = null;
  }, [floor]);

  /** ④小梁：図をクリック → まわりの線で囲まれた区画を選ぶ */
  const handleRegionClick = useCallback(
    (x: number, y: number) => {
      if (dragRef.current !== null) return; // ドラッグの離しクリックは区画変更にしない
      setRegion(enclosingRegion(current, x, y));
      setSelBeam(null);
    },
    [current],
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
      };
      setSelBeam(index);
      setRegion(null);
    },
    [current],
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
    // つかんで離すと発生するクリックで区画選択に化けないよう、少しの間だけ持ち場を残す
    window.setTimeout(() => {
      dragRef.current = null;
    }, 0);
  }, []);

  /** ④小梁：選んだ区画へ分割配置・区画の中身をコピー＆貼付 */
  const placeBeams = useCallback(() => {
    if (region === null) return;
    const placed = dividedBeams(region, beamAxis, beamParts, beamSymbol.trim());
    if (placed.length === 0) return;
    updateFloor({ beams: [...current.beams, ...placed] });
  }, [region, beamAxis, beamParts, beamSymbol, current, updateFloor]);

  const copyRegion = useCallback(() => {
    if (region === null) return;
    const inside = current.beams.filter(
      (beam) =>
        beam.x1 >= region.x - 1 &&
        beam.x2 <= region.x + region.width + 1 &&
        beam.y1 >= region.y - 1 &&
        beam.y2 <= region.y + region.height + 1,
    );
    setClipBeams(
      inside.map((beam) => ({
        dx1: beam.x1 - region.x,
        dy1: beam.y1 - region.y,
        dx2: beam.x2 - region.x,
        dy2: beam.y2 - region.y,
        symbol: beam.symbol,
      })),
    );
    if (inside.length > 0) setMessage(`区画の小梁${inside.length}本をコピーしました`);
  }, [region, current]);

  const pasteBeams = useCallback(() => {
    if (region === null || clipBeams.length === 0) return;
    const placed = clipBeams.map((clip) => ({
      x1: region.x + clip.dx1,
      y1: region.y + clip.dy1,
      x2: region.x + clip.dx2,
      y2: region.y + clip.dy2,
      symbol: clip.symbol,
    }));
    updateFloor({ beams: [...current.beams, ...placed] });
  }, [region, clipBeams, current, updateFloor]);

  const deleteBeam = useCallback(
    (index: number) => {
      updateFloor({ beams: current.beams.filter((_, i) => i !== index) });
      setSelBeam(null);
    },
    [current, updateFloor],
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

  /* 階タブは左から 1F・2F…の順、数字でない階（Rなど）は後ろ */
  const floorTabs = [...floors].sort((a, b) => {
    const an = /^\d+$/.test(a) ? Number(a) : null;
    const bn = /^\d+$/.test(b) ? Number(b) : null;
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return 0;
  });

  /* 柱・大梁のリストは横の通り優先。通りが替わるところで少し間を空ける */
  const columnRows: { no: number; at: string; key: string; gap: boolean }[] = [];
  numbers.forEach((row, yi) =>
    row.forEach((no, xi) =>
      columnRows.push({
        no,
        at: `${yGridLabel(yi)}-${xGridLabel(xi)}`,
        key: columnKey(xi, yi),
        gap: xi === 0 && yi > 0,
      }),
    ),
  );
  const girderRows: { no: number; at: string; key: string; gap: boolean }[] = [];
  for (let yi = 0; yi <= ny; yi += 1)
    for (let xi = 0; xi < nx; xi += 1)
      girderRows.push({
        no: girderNumber("x", xi, yi, current),
        at: `${yGridLabel(yi)}／${xGridLabel(xi)}〜${xGridLabel(xi + 1)}`,
        key: girderKey("x", xi, yi),
        gap: xi === 0,
      });
  for (let xi = 0; xi <= nx; xi += 1)
    for (let yi = 0; yi < ny; yi += 1)
      girderRows.push({
        no: girderNumber("y", xi, yi, current),
        at: `${xGridLabel(xi)}／${yGridLabel(yi)}〜${yGridLabel(yi + 1)}`,
        key: girderKey("y", xi, yi),
        gap: yi === 0,
      });

  /* 記号→図に出す寸法の文字。柱は「□-500*500」、梁は「500*300」の後ろの数字「300」 */
  const sizeTexts = useMemo(() => {
    const columnAt = memberLists.columns.floors.findIndex(
      (f) => f.label === floor,
    );
    const col = new Map<string, string>();
    memberLists.columns.members.forEach((member) => {
      const symbol = member.symbol.trim();
      if (symbol === "") return;
      const size = resolveSize(
        member,
        memberLists.columns.floors,
        Math.max(0, columnAt),
        "column",
      );
      const dims = [size.first, size.second].filter(
        (v): v is number => v !== null,
      );
      if (dims.length > 0) col.set(symbol, `${SHAPE_LABEL[size.shape]}-${dims.join("*")}`);
    });
    const beamAt = memberLists.beams.floors.findIndex((f) => f.label === floor);
    const bem = new Map<string, string>();
    memberLists.beams.members.forEach((member) => {
      const symbol = member.symbol.trim();
      if (symbol === "") return;
      const size = resolveSize(
        member,
        memberLists.beams.floors,
        Math.max(0, beamAt),
        "beam",
      );
      const value = size.second ?? size.first;
      if (value !== null) bem.set(symbol, String(value));
    });
    return { column: col, beam: bem };
  }, [memberLists, floor]);

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
          {floorTabs.map((name) => (
            <button
              key={name}
              type="button"
              className={name === floor ? "tab on" : "tab"}
              onClick={() => setFloor(name)}
            >
              {name === "R" ? "R" : `${name}F`}
            </button>
          ))}
        </span>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

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
            />
          </section>

          <section className="drawing-section">
            <div className="section-bar">
              <h3>③ 大梁（柱間の番号に記号）</h3>
            </div>
            <SymbolList
              rows={girderRows}
              values={current.girders}
              onValues={(next) => updateFloor({ girders: next })}
              emptyHint="先にX軸・Y軸の寸法を入れてください"
            />
          </section>

          <section className="drawing-section">
            <div className="section-bar">
              <h3>④ 小梁（区画を分割して配置）</h3>
            </div>
            <div className="beam-form">
              <p className="hint">
                図の中をクリックすると、まわりの線で囲まれた区画が色付きます
                （小梁でできた小さい区画も選べます）
              </p>
              <div className="beam-inputs">
                <label>
                  記号
                  <input
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
                  disabled={region === null || beamSymbol.trim() === ""}
                  onClick={placeBeams}
                >
                  配置
                </button>
              </div>
              <p className="hint">
                分割数は「でき上がる区画の数」です（3分割→線2本）
              </p>
              <div className="beam-ops">
                <button
                  type="button"
                  disabled={region === null}
                  onClick={copyRegion}
                >
                  区画コピー
                </button>
                <button
                  type="button"
                  disabled={region === null || clipBeams.length === 0}
                  onClick={pasteBeams}
                >
                  区画へ貼り付け{clipBeams.length > 0 ? `（${clipBeams.length}本）` : ""}
                </button>
              </div>
              {current.beams.length > 0 && (
                <div className="beam-list">
                  {current.beams.map((beam, index) => (
                    <button
                      key={index}
                      type="button"
                      className={index === selBeam ? "beam-row on" : "beam-row"}
                      onClick={() => {
                        setSelBeam(index);
                        setRegion(null);
                      }}
                    >
                      <span className="no">{index + 1}</span>
                      <span className="at">{beam.symbol}</span>
                      <span className="len">
                        {beam.x1 === beam.x2 ? "縦" : "横"}{" "}
                        {Math.round(beamLength(beam)).toLocaleString("ja-JP")}mm
                      </span>
                      {index === selBeam && (
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
                小梁はつかんで動かせます。選んで←→（横の梁は↑↓）で10mm・Shiftで1mmずつ動きます
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
                region={region}
                selectedBeam={selBeam}
                onRegionClick={handleRegionClick}
                onBeamPointerDown={handleBeamPointerDown}
                onPointerMove={handleBeamPointerMove}
                onPointerUp={endBeamDrag}
                columnSizes={sizeTexts.column}
                beamSizes={sizeTexts.beam}
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
