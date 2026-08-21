import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EstimateRowDraft,
  Fitting,
  FrameRoomOption,
  FrameSheet,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import {
  buildFrameLines,
  findSharedWalls,
  frameLineAttribute,
  frameQuantities,
  frameSymbols,
  isPickedUp,
  reinforcementKind,
  reinforcementLength,
  snapPlacement,
  type FrameFitting,
  type FrameLineAttribute,
  type FrameManualLine,
  type FramePlacement,
} from "../../../../core/frame/frame";
import {
  solveShape,
  type RoomShape,
  type SolvedShape,
} from "../../../../core/room/shape";
import {
  evaluateCalcSheet,
  trimEmptySets,
  type CalcSet,
} from "../../../../core/room/calcSheet";
import { computeFitting } from "../../../../core/fittings/fitting";
import {
  DEFAULT_FITTING_PART_VALUES,
  fittingSymbolForPart,
  type FittingPartValue,
} from "../../../../core/fittings/partValue";
import RoomCalcSheet, { type CalcFocus } from "./RoomCalcSheet";
import { formatNumber } from "./estimateRows";
import "./RoomSheetPage.css";
import "./FrameSheetPage.css";

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
}

/** レイアウト：部屋を並べる／軸組：線を引く／確認：拾う線と数量根拠を見る */
type FrameMode = "layout" | "frame" | "check";

const MODE_LABEL: Record<FrameMode, string> = {
  layout: "レイアウト",
  frame: "軸組",
  check: "確認",
};

const REINFORCEMENT_LABEL: Record<string, string> = {
  door: "①ドア類",
  window: "②窓類",
  mixed: "③窓＋ドア等",
};

const PLACEMENT_COLORS = [
  "#1d4ed8",
  "#b45309",
  "#0f766e",
  "#7c3aed",
  "#be123c",
  "#4d7c0f",
];

function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** 図の表示範囲（線が無いときは10m四方） */
function viewBox(points: { x: number; y: number }[]): {
  box: string;
  span: number;
} {
  if (points.length === 0) return { box: "-1 -1 12 12", span: 12 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(width, height, 1);
  const margin = size * 0.12;
  const left = Math.min(...xs) - (size - width) / 2 - margin;
  const top = Math.min(...ys) - (size - height) / 2 - margin;
  const span = size + margin * 2;
  return { box: `${left} ${top} ${span} ${span}`, span };
}

export default function FrameSheetPage({
  project,
  row,
  roomName,
  onBack,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<FrameSheet | null>(null);
  const [mode, setMode] = useState<FrameMode>("layout");
  const [placements, setPlacements] = useState<FramePlacement[]>([]);
  const [manualLines, setManualLines] = useState<FrameManualLine[]>([]);
  const [attributes, setAttributes] = useState<
    Record<string, FrameLineAttribute>
  >({});
  const [frameFittings, setFrameFittings] = useState<
    { id: string; symbol: string; multiplier: number; lineId: string | null }[]
  >([]);
  const [lower, setLower] = useState<CalcSet[]>([]);
  const [workHeight, setWorkHeight] = useState<number | null>(null);
  const [rooms, setRooms] = useState<FrameRoomOption[]>([]);
  const [fittings, setFittings] = useState<Fitting[]>([]);
  /** 建具記号を計算式へ入れるときの、部位ごとの採用値 */
  const [partValues, setPartValues] = useState<FittingPartValue[]>(
    DEFAULT_FITTING_PART_VALUES,
  );
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [calcFocus, setCalcFocus] = useState<CalcFocus | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(
    null,
  );
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    placementId: string;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getFrameSheet(row.id as number);
      setSheet(loaded);
      setPlacements(parseJson<FramePlacement[]>(loaded.layoutJson, []));
      setManualLines(parseJson<FrameManualLine[]>(loaded.linesJson, []));
      setAttributes(
        parseJson<Record<string, FrameLineAttribute>>(
          loaded.attributesJson,
          {},
        ),
      );
      setFrameFittings(
        parseJson<
          {
            id: string;
            symbol: string;
            multiplier: number;
            lineId: string | null;
          }[]
        >(loaded.fittingsJson, []),
      );
      setLower(trimEmptySets(parseJson<CalcSet[]>(loaded.lowerJson, [])));
      setWorkHeight(loaded.workHeight);
      setRooms(await window.sekisan.listFrameRooms(project.id));
      setFittings(await window.sekisan.listFittings(project.id));
      setPartValues(await window.sekisan.getFittingPartValues());
      setOptions(await window.sekisan.getMasterOptions());
    })();
  }, [project.id, row.id]);

  /** 置いた部屋の平面図（部屋計算書の形をそのまま使う） */
  const shapes = useMemo(() => {
    const map = new Map<number, SolvedShape>();
    rooms.forEach((room) => {
      map.set(
        room.estimateRowId,
        solveShape(parseJson<RoomShape>(room.shapeJson, { edges: [] })),
      );
    });
    return map;
  }, [rooms]);

  const lines = useMemo(
    () => buildFrameLines({ placements, shapes, manualLines, attributes }),
    [attributes, manualLines, placements, shapes],
  );

  /** 建具表から寸法を引用した、この軸組の建具 */
  const resolvedFittings = useMemo<FrameFitting[]>(
    () =>
      frameFittings.map((item) => {
        const master = fittings.find(
          (fitting) => fitting.symbol === item.symbol,
        );
        const computed = master ? computeFitting(master) : null;
        return {
          id: item.id,
          symbol: item.symbol,
          multiplier: item.multiplier,
          lineId: item.lineId,
          area: computed?.area ?? null,
          width: master?.width ?? null,
          sillHeight: master?.sillHeight ?? null,
          baseboardDeduction: computed?.baseboardDeduction ?? null,
        };
      }),
    [fittings, frameFittings],
  );

  const quantities = useMemo(
    () => frameQuantities(lines, resolvedFittings, workHeight),
    [lines, resolvedFittings, workHeight],
  );
  const symbols = useMemo(
    () => frameSymbols(quantities, workHeight),
    [quantities, workHeight],
  );
  const shared = useMemo(() => findSharedWalls(lines), [lines]);

  /** 記号表は横に2組並べて高さを半分にする（下段の表示行を増やすため） */
  const symbolPairs = useMemo(() => {
    const half = Math.ceil(symbols.length / 2);
    return symbols
      .slice(0, half)
      .map(
        (item, index) =>
          [item, symbols[half + index] ?? null] as [
            (typeof symbols)[number],
            (typeof symbols)[number] | null,
          ],
      );
  }, [symbols]);

  const points = useMemo(
    () =>
      lines.flatMap((line) => [
        { x: line.x1, y: line.y1 },
        { x: line.x2, y: line.y2 },
      ]),
    [lines],
  );
  const view = useMemo(() => viewBox(points), [points]);

  /** 計算式に使える数量（軸組の記号＋建具表の記号） */
  const calcVariables = useMemo(() => {
    const values: Record<string, number> = {};
    symbols.forEach((item) => {
      if (item.value !== null) values[item.symbol] = item.value;
    });
    fittings.forEach((fitting) => {
      const computed = computeFitting(fitting);
      if (computed.area !== null) values[`<${fitting.symbol}>`] = computed.area;
      if (fitting.width !== null)
        values[`<${fitting.symbol}:W>`] = fitting.width;
      if (fitting.height !== null)
        values[`<${fitting.symbol}:H>`] = fitting.height;
      if (computed.baseboardDeduction !== null)
        values[`<${fitting.symbol}:HL>`] = computed.baseboardDeduction;
      // 開口部補強（施工高さを使うので軸組計算書だけの記号）
      const reinforcement = reinforcementLength(
        {
          width: fitting.width,
          sillHeight: fitting.sillHeight,
          baseboardDeduction: computed.baseboardDeduction,
        },
        workHeight,
      );
      if (reinforcement !== null)
        values[`<${fitting.symbol}:RF>`] = reinforcement;
    });
    return values;
  }, [fittings, symbols, workHeight]);

  const calcResult = useMemo(
    () => evaluateCalcSheet(lower, calcVariables),
    [calcVariables, lower],
  );

  const save = useCallback(async () => {
    if (!sheet) return;
    // 入力の無いセット明細は保存時に取り除く（画面からも消す）
    const trimmed = trimEmptySets(lower);
    setLower(trimmed);
    const saved = await window.sekisan.saveFrameSheet({
      id: sheet.id,
      layoutJson: JSON.stringify(placements),
      linesJson: JSON.stringify(manualLines),
      attributesJson: JSON.stringify(attributes),
      fittingsJson: JSON.stringify(frameFittings),
      lowerJson: JSON.stringify(trimmed),
      workHeight,
      note: sheet.note,
    });
    setSheet(saved);
    setMessage("保存しました");
  }, [
    attributes,
    frameFittings,
    lower,
    manualLines,
    placements,
    sheet,
    workHeight,
  ]);

  const updateAttribute = useCallback(
    (lineId: string, patch: Partial<FrameLineAttribute>) =>
      setAttributes((current) => ({
        ...current,
        [lineId]: { ...frameLineAttribute(current[lineId]), ...patch },
      })),
    [],
  );

  /** レイアウトへ部屋を置く（重ならないように少しずらして置く） */
  const addPlacement = useCallback(
    (room: FrameRoomOption) => {
      const offset = placements.length * 0.5;
      setPlacements((current) => [
        ...current,
        {
          id: newId("p"),
          estimateRowId: room.estimateRowId,
          roomName: room.roomName,
          x: offset,
          y: offset,
          color: PLACEMENT_COLORS[current.length % PLACEMENT_COLORS.length],
        },
      ]);
      setMessage(`${room.roomName} を置きました（ドラッグで移動できます）`);
    },
    [placements.length],
  );

  /** 画面の位置を図の座標（m）に直す */
  const toModel = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height) || 1;
      const [left, top] = view.box.split(" ").map(Number);
      return {
        x: left + ((clientX - rect.left) / size) * view.span,
        y: top + ((clientY - rect.top) / size) * view.span,
      };
    },
    [view.box, view.span],
  );

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    // 近い壁に吸着させて壁位置を合わせる
    setPlacements((current) =>
      current.map((placement) => {
        if (placement.id !== drag.placementId) return placement;
        const solved = shapes.get(placement.estimateRowId);
        if (!solved) return placement;
        const others = lines.filter(
          (line) => line.placementId !== placement.id,
        );
        const snapped = snapPlacement(
          { x: placement.x, y: placement.y, solved },
          others,
        );
        return { ...placement, ...snapped };
      }),
    );
  }, [lines, shapes]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height) || 1;
      const scale = view.span / size;
      const x = drag.x + (event.clientX - drag.clientX) * scale;
      const y = drag.y + (event.clientY - drag.clientY) * scale;
      setPlacements((current) =>
        current.map((placement) =>
          placement.id === drag.placementId
            ? {
                ...placement,
                x: Math.round(x * 20) / 20,
                y: Math.round(y * 20) / 20,
              }
            : placement,
        ),
      );
    },
    [view.span],
  );

  /** 軸組モード：始点クリック → 終点クリックで1本引く */
  const onCanvasClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (mode !== "frame") return;
      const point = toModel(event.clientX, event.clientY);
      if (!point) return;
      const snap = (value: number): number => Math.round(value * 20) / 20;
      const next = { x: snap(point.x), y: snap(point.y) };
      if (drawStart === null) {
        setDrawStart(next);
        setMessage("終点をクリックしてください");
        return;
      }
      // 直交で引く（長い方の向きに合わせる）
      const dx = Math.abs(next.x - drawStart.x);
      const dy = Math.abs(next.y - drawStart.y);
      const end =
        dx >= dy
          ? { x: next.x, y: drawStart.y }
          : { x: drawStart.x, y: next.y };
      if (dx < 0.05 && dy < 0.05) {
        setDrawStart(null);
        return;
      }
      setManualLines((current) => [
        ...current,
        {
          id: newId("l"),
          x1: drawStart.x,
          y1: drawStart.y,
          x2: end.x,
          y2: end.y,
        },
      ]);
      setDrawStart(null);
      setMessage("軸組ラインを1本追加しました");
    },
    [drawStart, mode, toModel],
  );

  /** 壁の共有：共有された側は拾わない1本にまとめる */
  const shareWall = useCallback(
    (keepId: string, dropId: string, share: boolean) => {
      updateAttribute(dropId, { sharedWithId: share ? keepId : null });
      setMessage(
        share ? "壁を共有しました（1本として拾います）" : "壁を別々に拾います",
      );
    },
    [updateAttribute],
  );

  /** 記号クリック：計算式にカーソルがあればそこへ入れる。無ければコピーする */
  const useSymbol = useCallback(
    (symbol: string) => {
      const target = calcFocus;
      if (!target || target.area === "detail") {
        void navigator.clipboard.writeText(symbol);
        setMessage(`${symbol} をコピーしました`);
        return;
      }
      setLower((current) =>
        current.map((set) =>
          set.id !== target.setId
            ? set
            : {
                ...set,
                lines: set.lines.map((line, index) =>
                  index !== target.index
                    ? line
                    : target.area === "formulaA"
                      ? { ...line, formulaA: line.formulaA + symbol }
                      : { ...line, formulaB: line.formulaB + symbol },
                ),
              },
        ),
      );
      setMessage(`${symbol} を計算式に入れました`);
    },
    [calcFocus],
  );

  /** 建具表クリック：入れる先のセットの部位に合わせて採る数値を変える */
  const insertFittingSymbol = useCallback(
    (symbol: string) => {
      const set = lower.find((each) => each.id === calcFocus?.setId);
      useSymbol(fittingSymbolForPart(symbol, set?.partName ?? "", partValues));
    },
    [calcFocus, lower, partValues, useSymbol],
  );

  const [warned, setWarned] = useState(false);
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
    <div className="room-sheet-page frame-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={closePage}>
          ← 部位別入力表へ
        </button>
        <h2>軸組計算書</h2>
        <span className="project">
          {project.managementNo} {roomName || "（名称なし）"}
        </span>
        {(Object.keys(MODE_LABEL) as FrameMode[]).map((key) => (
          <button
            key={key}
            type="button"
            className={mode === key ? "on" : ""}
            onClick={() => {
              setMode(key);
              setDrawStart(null);
            }}
          >
            {mode === key ? "■" : "□"} {MODE_LABEL[key]}
          </button>
        ))}
        <label>
          施工高さ
          <input
            className="num"
            defaultValue={formatNumber(workHeight, 2)}
            key={`wh-${sheet?.id ?? "new"}`}
            title="軸組の施工高さ。ここを直すと全体が再計算されます"
            onBlur={(e) => {
              const value = e.target.value.trim();
              setWorkHeight(value === "" ? null : Number(value));
            }}
          />
        </label>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      <div className="upper">
        <section className="drawing">
          <div className="section-bar">
            <span>建物レイアウト（{MODE_LABEL[mode]}）</span>
            <button
              type="button"
              onClick={() => setZoom(Math.min(zoom * 1.25, 8))}
            >
              ＋
            </button>
            <button
              type="button"
              onClick={() => setZoom(Math.max(zoom / 1.25, 0.25))}
            >
              －
            </button>
            <button type="button" onClick={() => setZoom(1)}>
              全体
            </button>
          </div>
          <div className="canvas">
            <svg
              ref={svgRef}
              viewBox={view.box}
              style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
              onPointerMove={onPointerMove}
              onPointerUp={finishDrag}
              onPointerLeave={finishDrag}
              onClick={onCanvasClick}
            >
              {mode === "layout" &&
                placements.map((placement) => {
                  const solved = shapes.get(placement.estimateRowId);
                  if (!solved || solved.points.length === 0) return null;
                  const points = solved.points
                    .map(
                      (point) =>
                        `${point.x + placement.x},${point.y + placement.y}`,
                    )
                    .join(" ");
                  const center = solved.points.reduce(
                    (total, point) => ({
                      x: total.x + point.x / solved.points.length,
                      y: total.y + point.y / solved.points.length,
                    }),
                    { x: 0, y: 0 },
                  );
                  return (
                    <g key={`p-${placement.id}`}>
                      <polygon
                        points={points}
                        className={[
                          "frame-room",
                          selectedPlacementId === placement.id
                            ? "selected"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        fill={placement.color}
                        onPointerDown={(event) => {
                          setSelectedPlacementId(placement.id);
                          dragRef.current = {
                            placementId: placement.id,
                            clientX: event.clientX,
                            clientY: event.clientY,
                            x: placement.x,
                            y: placement.y,
                          };
                        }}
                      />
                      <text
                        className="frame-room-name"
                        x={center.x + placement.x}
                        y={center.y + placement.y}
                        fontSize={view.span * 0.035}
                      >
                        {placement.roomName}
                      </text>
                    </g>
                  );
                })}
              {lines.map((line) => {
                const picked = isPickedUp(line);
                const placement = placements.find(
                  (each) => each.id === line.placementId,
                );
                return (
                  <line
                    key={line.id}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke={
                      line.sharedWithId !== null
                        ? "#ea580c"
                        : !picked
                          ? "#94a3b8"
                          : (placement?.color ?? "#111827")
                    }
                    className={[
                      "frame-line",
                      picked ? "" : "skip",
                      selectedLineId === line.id ? "selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onPointerDown={(event) => {
                      setSelectedLineId(line.id);
                      if (mode !== "layout" || !placement) return;
                      setSelectedPlacementId(placement.id);
                      dragRef.current = {
                        placementId: placement.id,
                        clientX: event.clientX,
                        clientY: event.clientY,
                        x: placement.x,
                        y: placement.y,
                      };
                    }}
                  />
                );
              })}
              {shared.map((pair) => {
                const line = lines.find((each) => each.id === pair.dropId);
                if (!line) return null;
                return (
                  <line
                    key={`s-${pair.keepId}-${pair.dropId}`}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    className="frame-line shared-mark"
                  />
                );
              })}
              {drawStart && (
                <circle
                  cx={drawStart.x}
                  cy={drawStart.y}
                  r={view.span * 0.01}
                  className="draw-start"
                />
              )}
            </svg>
            {lines.length === 0 && (
              <p className="empty">
                「置ける部屋」から部屋を選ぶと、部屋計算書の平面図をそのまま置けます。
              </p>
            )}
          </div>
        </section>

        <section className="rooms">
          <div className="section-bar">
            <span>置ける部屋（部屋計算書を作った部屋）</span>
          </div>
          <table className="grid">
            <tbody>
              {rooms.map((room) => (
                <tr key={room.estimateRowId}>
                  <td>{room.roomName || "（部屋名なし）"}</td>
                  <td className="num">{formatNumber(room.ceilingHeight, 2)}</td>
                  <td>
                    <button type="button" onClick={() => addPlacement(room)}>
                      ＋ 置く
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {placements.length > 0 && (
            <table className="grid">
              <thead>
                <tr>
                  <th>配置した部屋</th>
                  <th className="num">X</th>
                  <th className="num">Y</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {placements.map((placement) => (
                  <tr
                    key={placement.id}
                    className={
                      selectedPlacementId === placement.id ? "selected" : ""
                    }
                    onClick={() => setSelectedPlacementId(placement.id)}
                  >
                    <td style={{ color: placement.color }}>
                      {placement.roomName}
                    </td>
                    {(["x", "y"] as const).map((axis) => (
                      <td key={axis}>
                        <input
                          className="num"
                          key={`${axis}-${placement[axis]}`}
                          defaultValue={formatNumber(placement[axis], 2)}
                          onBlur={(e) => {
                            const value = Number(e.target.value);
                            if (!Number.isFinite(value)) return;
                            setPlacements((current) =>
                              current.map((each) =>
                                each.id === placement.id
                                  ? { ...each, [axis]: value }
                                  : each,
                              ),
                            );
                          }}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        title="レイアウトから外します（部屋計算書は消えません）"
                        onClick={() =>
                          setPlacements((current) =>
                            current.filter((each) => each.id !== placement.id),
                          )
                        }
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">
            レイアウトでは部屋をドラッグで移動でき、離すと近くの壁に吸着します。軸組モードでは始点→終点のクリックで1本引きます。
          </p>
        </section>

        <section className="symbols">
          <div className="section-bar">
            <span>記号（クリックでコピー：計算式に使えます）</span>
          </div>
          <table className="grid two-up">
            <tbody>
              {symbolPairs.map(([left, right]) => (
                <tr key={left.symbol}>
                  <td className="symbol" onClick={() => useSymbol(left.symbol)}>
                    {left.symbol}
                  </td>
                  <td className="label" onClick={() => useSymbol(left.symbol)}>
                    {left.label}
                  </td>
                  <td className="num" onClick={() => useSymbol(left.symbol)}>
                    {formatNumber(left.value, 2)}
                  </td>
                  <td
                    className="symbol"
                    onClick={() => right && useSymbol(right.symbol)}
                  >
                    {right?.symbol ?? ""}
                  </td>
                  <td
                    className="label"
                    onClick={() => right && useSymbol(right.symbol)}
                  >
                    {right?.label ?? ""}
                  </td>
                  <td
                    className="num"
                    onClick={() => right && useSymbol(right.symbol)}
                  >
                    {right ? formatNumber(right.value, 2) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="frame-lines">
          <div className="section-bar">
            <span>軸組寸法表（拾わない線はチェックを外します）</span>
            {shared.length > 0 && (
              <span className="shared-note">
                重なっている壁が{shared.length}
                か所あります（確認モードで共有を決められます）
              </span>
            )}
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th className="no">No</th>
                <th>部屋・壁</th>
                <th className="num">長さ</th>
                <th>壁種</th>
                <th>サイズ種類</th>
                <th className="num">施工高さ</th>
                <th className="num">面積</th>
                <th className="pick">拾う</th>
                <th>備考</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {quantities.lines.map((result, index) => {
                const line = result.line;
                return (
                  <tr
                    key={line.id}
                    className={[
                      selectedLineId === line.id ? "selected" : "",
                      isPickedUp(line) ? "" : "skip",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setSelectedLineId(line.id)}
                  >
                    <td className="no">{index + 1}</td>
                    <td>
                      {line.label}
                      {line.perimeter ? "（外周）" : ""}
                      {line.sharedWithId !== null ? "（共有）" : ""}
                    </td>
                    <td className="num">{formatNumber(line.length, 2)}</td>
                    <td>
                      <input
                        defaultValue={line.wallKind}
                        onBlur={(e) =>
                          updateAttribute(line.id, {
                            wallKind: e.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={line.sizeKind}
                        onBlur={(e) =>
                          updateAttribute(line.id, {
                            sizeKind: e.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        defaultValue={
                          line.workHeight === null
                            ? ""
                            : formatNumber(line.workHeight, 2)
                        }
                        placeholder={formatNumber(workHeight, 2)}
                        title="空欄なら全体の施工高さを使います"
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          updateAttribute(line.id, {
                            workHeight: text === "" ? null : Number(text),
                          });
                        }}
                      />
                    </td>
                    <td className="num">{formatNumber(result.area, 2)}</td>
                    <td className="pick">
                      <input
                        type="checkbox"
                        checked={line.pickup}
                        onChange={(e) =>
                          updateAttribute(line.id, {
                            pickup: e.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={line.note}
                        onBlur={(e) =>
                          updateAttribute(line.id, { note: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      {line.source === "manual" && (
                        <button
                          type="button"
                          onClick={() =>
                            setManualLines((current) =>
                              current.filter((each) => each.id !== line.id),
                            )
                          }
                        >
                          🗑
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="totals">
            軸組長さ {formatNumber(quantities.length, 2)}／軸組面積{" "}
            {formatNumber(quantities.area, 2)}／建具面積（減）{" "}
            {formatNumber(quantities.fittingArea, 2)}／開口補強{" "}
            {formatNumber(quantities.reinforcement, 2)}
          </p>
        </section>

        <section className="frame-fittings">
          <div className="section-bar">
            <span>この軸組の建具（開口の差し引きと開口部補強に使います）</span>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>記号</th>
                <th className="num">数</th>
                <th>付く軸組ライン</th>
                <th className="num">面積</th>
                <th>補強種類</th>
                <th className="num">横補強</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {frameFittings.map((item, index) => {
                const resolved = resolvedFittings[index];
                const height =
                  lines.find((line) => line.id === item.lineId)?.workHeight ??
                  workHeight;
                return (
                  <tr key={item.id}>
                    <td>
                      <input
                        list="frame-fitting-symbols"
                        defaultValue={item.symbol}
                        onBlur={(e) =>
                          setFrameFittings((current) =>
                            current.map((each) =>
                              each.id === item.id
                                ? { ...each, symbol: e.target.value.trim() }
                                : each,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        defaultValue={String(item.multiplier)}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (!Number.isFinite(value)) return;
                          setFrameFittings((current) =>
                            current.map((each) =>
                              each.id === item.id
                                ? { ...each, multiplier: value }
                                : each,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={item.lineId ?? ""}
                        onChange={(e) =>
                          setFrameFittings((current) =>
                            current.map((each) =>
                              each.id === item.id
                                ? {
                                    ...each,
                                    lineId:
                                      e.target.value === ""
                                        ? null
                                        : e.target.value,
                                  }
                                : each,
                            ),
                          )
                        }
                      >
                        <option value="">指定なし（合計から減）</option>
                        {lines.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      {formatNumber(resolved?.area ?? null, 2)}
                    </td>
                    <td>
                      {resolved
                        ? REINFORCEMENT_LABEL[reinforcementKind(resolved)]
                        : ""}
                    </td>
                    <td className="num">
                      {formatNumber(
                        resolved ? reinforcementLength(resolved, height) : null,
                        2,
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setFrameFittings((current) =>
                            current.filter((each) => each.id !== item.id),
                          )
                        }
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="frame-fitting-symbols">
            {fittings.map((fitting) => (
              <option key={fitting.id} value={fitting.symbol} />
            ))}
          </datalist>
          <p className="note">
            開口部補強は
            ①ドア類＝W＋施工高さ×2／②窓類＝W×2＋施工高さ×2／③窓＋ドア等＝W×2−巾木差し引き＋施工高さ×2＋腰高×2
            で自動判別します（タテ補強筋は施工高さで変わるため算出しません）。計算式では
            &lt;SD2:RF&gt; で補強長さを使えます。
          </p>
        </section>

        <section className="fittings">
          <div className="section-bar">
            <span>建具表（クリックで &lt;記号&gt; をコピー）</span>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>記号</th>
                <th className="num">W</th>
                <th className="num">H</th>
                <th className="num">腰高</th>
                <th className="num">面積</th>
                <th className="num">横補強</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fittings.map((fitting) => {
                const computed = computeFitting(fitting);
                return (
                  <tr
                    key={fitting.id}
                    onClick={() => insertFittingSymbol(fitting.symbol)}
                  >
                    <td>{fitting.symbol}</td>
                    <td className="num">{formatNumber(fitting.width, 2)}</td>
                    <td className="num">{formatNumber(fitting.height, 2)}</td>
                    <td className="num">
                      {formatNumber(fitting.sillHeight, 2)}
                    </td>
                    <td className="num">{formatNumber(computed.area, 2)}</td>
                    <td className="num">
                      {formatNumber(
                        reinforcementLength(
                          {
                            width: fitting.width,
                            sillHeight: fitting.sillHeight,
                            baseboardDeduction: computed.baseboardDeduction,
                          },
                          workHeight,
                        ),
                        2,
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        title="この軸組の建具へ加える"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFrameFittings((current) => [
                            ...current,
                            {
                              id: newId("ff"),
                              symbol: fitting.symbol,
                              multiplier: 1,
                              lineId: selectedLineId,
                            },
                          ]);
                        }}
                      >
                        ＋軸組
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {mode === "check" && (
          <section className="check">
            <div className="section-bar">
              <span>確認（壁の共有・数量根拠）</span>
            </div>
            <table className="grid">
              <thead>
                <tr>
                  <th>重なっている壁</th>
                  <th className="num">長さ</th>
                  <th>壁を共有しますか？</th>
                </tr>
              </thead>
              <tbody>
                {shared.map((pair) => {
                  const keep = lines.find((line) => line.id === pair.keepId);
                  const drop = lines.find((line) => line.id === pair.dropId);
                  const isShared = drop?.sharedWithId === pair.keepId;
                  return (
                    <tr key={`${pair.keepId}-${pair.dropId}`}>
                      <td>
                        {keep?.label} ／ {drop?.label}
                      </td>
                      <td className="num">{formatNumber(pair.length, 2)}</td>
                      <td>
                        <label>
                          <input
                            type="radio"
                            name={`share-${pair.keepId}-${pair.dropId}`}
                            checked={isShared}
                            onChange={() =>
                              shareWall(pair.keepId, pair.dropId, true)
                            }
                          />
                          はい
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`share-${pair.keepId}-${pair.dropId}`}
                            checked={!isShared}
                            onChange={() =>
                              shareWall(pair.keepId, pair.dropId, false)
                            }
                          />
                          いいえ
                        </label>
                      </td>
                    </tr>
                  );
                })}
                {shared.length === 0 && (
                  <tr>
                    <td colSpan={3}>重なっている壁はありません</td>
                  </tr>
                )}
              </tbody>
            </table>
            <table className="grid">
              <thead>
                <tr>
                  <th>数量根拠（部屋 → 壁 → 軸組ライン → 数量）</th>
                  <th className="num">長さ</th>
                  <th className="num">面積</th>
                </tr>
              </thead>
              <tbody>
                {quantities.lines
                  .filter((result) => isPickedUp(result.line))
                  .map((result) => (
                    <tr key={result.line.id}>
                      <td>
                        {result.line.roomName || "（直接入力）"} →{" "}
                        {result.line.edgeId ?? result.line.id} →{" "}
                        {result.line.label}
                      </td>
                      <td className="num">
                        {formatNumber(result.line.length, 2)}
                      </td>
                      <td className="num">{formatNumber(result.area, 2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}
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
        windowTitle={`軸組・梁計算書　${project.managementNo}`}
      />

      <p className="hint">
        軸組は部屋計算書の平面図を並べて拾います。外周に乗っている線には（外周）と印を付けるので、拾わない線はチェックを外します。
        部屋の壁は表面の壁なので、施工高さを直すと全体が再計算されます。下段の計算式では
        AL・AA（軸組長さ・面積）、AL1・AA1（線ごと）、&lt;SD2&gt;（建具面積）、&lt;SD2:RF&gt;（開口補強）が使えます。
      </p>
    </div>
  );
}
