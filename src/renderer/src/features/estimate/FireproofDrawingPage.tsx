import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@shared/types";
import {
  columnFloorLabels,
  normalizeFloorList,
} from "../../../../core/fireproof/fireproofList";
import {
  columnKey,
  columnNumbers,
  emptyFloor,
  girderKey,
  girderNumber,
  parseDrawing,
  parseSpanList,
  positions,
  spanListText,
  xGridLabel,
  yGridLabel,
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

/**
 * 1階分の鉄骨伏図（SVG）。座標はmm。
 * 柱線（一点鎖線）→ 交点の柱 → 柱間の大梁 と、リストの番号を薄く添える。
 */
function FloorSvg({
  floor,
  svgRef,
}: {
  floor: FireproofDrawingFloor;
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
      {/* 大梁（柱間の区間。2本線で描く） */}
      <g className="girder">
        {Object.entries(floor.girders).map(([key, symbol]) => {
          const [axis, point] = key.split(":");
          const [xi, yi] = point.split(",").map(Number);
          if (axis === "x" && xi >= 0 && xi < xs.length - 1 && yi >= 0 && yi < ys.length) {
            const x1 = xs[xi];
            const x2 = xs[xi + 1];
            const y = ys[yi];
            const mx = (x1 + x2) / 2;
            return (
              <g key={key}>
                <line x1={x1} y1={y - GIRDER_HALF} x2={x2} y2={y - GIRDER_HALF} />
                <line x1={x1} y1={y + GIRDER_HALF} x2={x2} y2={y + GIRDER_HALF} />
                <text x={mx} y={y - GIRDER_HALF - 120} textAnchor="middle" fontSize={FONT_SYMBOL}>
                  {symbol}
                </text>
              </g>
            );
          }
          if (axis === "y" && yi >= 0 && yi < ys.length - 1 && xi >= 0 && xi < xs.length) {
            const y1 = ys[yi];
            const y2 = ys[yi + 1];
            const x = xs[xi];
            const my = (y1 + y2) / 2;
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
                </text>
              </g>
            );
          }
          return null;
        })}
      </g>
      {/* 柱（交点の四角） */}
      <g className="column">
        {Object.entries(floor.columns).map(([key, symbol]) => {
          const [xi, yi] = key.split(",").map(Number);
          if (xi < 0 || yi < 0 || xi >= xs.length || yi >= ys.length) return null;
          const x = xs[xi];
          const y = ys[yi];
          return (
            <g key={key}>
              <rect x={x - COL_HALF} y={y - COL_HALF} width={COL_HALF * 2} height={COL_HALF * 2} />
              <text x={x + COL_HALF + 90} y={y + FONT_SYMBOL * 0.38} fontSize={FONT_SYMBOL}>
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
  /** この画面では触らない他の欄（保存時にそのまま戻す） */
  const baseRef = useRef({
    floorCount: 0,
    columnsJson: "{}",
    beamsJson: "{}",
    commonJson: "[]",
    estimateJson: "[]",
    note: "",
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

  const columnRows: { no: number; at: string; key: string }[] = [];
  numbers.forEach((row, yi) =>
    row.forEach((no, xi) =>
      columnRows.push({
        no,
        at: `${xGridLabel(xi)}-${yGridLabel(yi)}`,
        key: columnKey(xi, yi),
      }),
    ),
  );
  const girderRows: { no: number; at: string; key: string }[] = [];
  for (let yi = 0; yi <= ny; yi += 1)
    for (let xi = 0; xi < nx; xi += 1)
      girderRows.push({
        no: girderNumber("x", xi, yi, current),
        at: `${xGridLabel(xi)}〜${xGridLabel(xi + 1)}／${yGridLabel(yi)}`,
        key: girderKey("x", xi, yi),
      });
  for (let xi = 0; xi <= nx; xi += 1)
    for (let yi = 0; yi < ny; yi += 1)
      girderRows.push({
        no: girderNumber("y", xi, yi, current),
        at: `${yGridLabel(yi)}〜${yGridLabel(yi + 1)}／${xGridLabel(xi)}`,
        key: girderKey("y", xi, yi),
      });

  return (
    <div className="estimate-page fireproof-drawing-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>鉄骨伏図の作成</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <span className="floor-tabs">
          {floors.map((name) => (
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
            <div className="symbol-list">
              {columnRows.length === 0 && (
                <p className="hint">先にX軸・Y軸の寸法を入れてください</p>
              )}
              {columnRows.map((row) => (
                <div className="symbol-row" key={row.key}>
                  <span className="no">{row.no}</span>
                  <span className="at">{row.at}</span>
                  <input
                    value={current.columns[row.key] ?? ""}
                    placeholder="C1"
                    onChange={(event) =>
                      updateFloor({
                        columns: {
                          ...current.columns,
                          [row.key]: event.target.value,
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="drawing-section">
            <div className="section-bar">
              <h3>③ 大梁（柱間の番号に記号）</h3>
            </div>
            <div className="symbol-list">
              {girderRows.length === 0 && (
                <p className="hint">先にX軸・Y軸の寸法を入れてください</p>
              )}
              {girderRows.map((row) => (
                <div className="symbol-row" key={row.key}>
                  <span className="no">{row.no}</span>
                  <span className="at">{row.at}</span>
                  <input
                    value={current.girders[row.key] ?? ""}
                    placeholder="G1"
                    onChange={(event) =>
                      updateFloor({
                        girders: {
                          ...current.girders,
                          [row.key]: event.target.value,
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="drawing-canvas">
          {nx === 0 || ny === 0 ? (
            <p className="empty">
              X軸・Y軸の寸法を入れると、ここに伏図ができます
            </p>
          ) : (
            <FloorSvg floor={current} svgRef={svgRef} />
          )}
        </div>
      </div>
    </div>
  );
}
