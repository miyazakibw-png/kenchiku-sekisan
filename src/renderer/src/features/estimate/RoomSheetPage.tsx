import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EstimateRowDraft,
  Fitting,
  MasterOptions,
  ProjectSummary,
  RoomSheet,
  RoomSheetFitting,
} from "@shared/types";
import {
  edge,
  lShape,
  rectangleShape,
  roomQuantities,
  roomSymbols,
  solveShape,
  splitEdge,
  updateEdge,
  uShape,
  type EdgeDirection,
  type EdgeKind,
  type RoomFitting,
  type RoomShape,
  type SolvedShape,
} from "../../../../core/room/shape";
import {
  ceilingElement,
  ceilingQuantities,
  ceilingSymbols,
  type CeilingElement,
  type CeilingElementKind,
} from "../../../../core/room/ceiling";
import {
  evaluateCalcSheet,
  quantityByPart,
  type CalcSet,
} from "../../../../core/room/calcSheet";
import RoomCalcSheet, { type CalcFocus } from "./RoomCalcSheet";
import { computeFitting } from "../../../../core/fittings/fitting";
import { formatNumber } from "./estimateRows";
import "./RoomSheetPage.css";

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
}

const DIRECTION_LABEL: Record<EdgeDirection, string> = {
  E: "→ 右",
  S: "↓ 下",
  W: "← 左",
  N: "↑ 上",
};

const KIND_LABEL: Record<EdgeKind, string> = {
  wall: "壁",
  opening: "開口（壁なし）",
  column: "柱",
};

function parseRoomFittings(json: string): RoomSheetFitting[] {
  try {
    const parsed = JSON.parse(json) as RoomSheetFitting[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function newRoomFittingId(): string {
  return `f${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const CEILING_KIND_LABEL: Record<CeilingElementKind, string> = {
  wallBeam: "壁付き梁型",
  ceilingBeam: "天井付梁型",
  dropWall: "下がり壁",
  dropCeiling: "下がり天井",
};

function parseCeiling(json: string): CeilingElement[] {
  try {
    const parsed = JSON.parse(json) as CeilingElement[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseLower(json: string): CalcSet[] {
  try {
    const parsed = JSON.parse(json) as CalcSet[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseShape(json: string): RoomShape {
  try {
    const parsed = JSON.parse(json) as RoomShape;
    return Array.isArray(parsed.edges) ? parsed : { edges: [] };
  } catch {
    return { edges: [] };
  }
}

/** 表示スペースいっぱいに、縦横の大きい方に合わせて描く（1m角も100m角も同じ大きさで見える） */
function viewBox(solved: SolvedShape): { box: string; span: number } {
  if (solved.points.length === 0) return { box: "0 0 100 100", span: 100 };
  const xs = solved.points.map((point) => point.x);
  const ys = solved.points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(width, height, 0.001);
  const margin = size * 0.18;
  const left = Math.min(...xs) - (size - width) / 2 - margin;
  const top = Math.min(...ys) - (size - height) / 2 - margin;
  const span = size + margin * 2;
  return { box: `${left} ${top} ${span} ${span}`, span };
}

export default function RoomSheetPage({
  project,
  row,
  roomName,
  onBack,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<RoomSheet | null>(null);
  const [shape, setShape] = useState<RoomShape>({ edges: [] });
  const [ceilingHeight, setCeilingHeight] = useState<number | null>(
    row.ceilingHeight,
  );
  const [fittings, setFittings] = useState<Fitting[]>([]);
  const [roomFittings, setRoomFittings] = useState<RoomSheetFitting[]>([]);
  const [newFitting, setNewFitting] = useState({
    symbol: "",
    width: "",
    height: "",
    sill: "",
  });
  const [ceiling, setCeiling] = useState<CeilingElement[]>([]);
  const [showCeiling, setShowCeiling] = useState(false);
  const [lower, setLower] = useState<CalcSet[]>([]);
  const [calcFocus, setCalcFocus] = useState<CalcFocus | null>(null);
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [showCheck, setShowCheck] = useState(false);
  const [deductionLimit, setDeductionLimit] = useState(0.5);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  /** 図の実寸（寸法文字を表と同じ大きさで出すために測る） */
  const [canvasSize, setCanvasSize] = useState(200);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getRoomSheet(row.id as number);
      setSheet(loaded);
      setShape(parseShape(loaded.shapeJson));
      setRoomFittings(parseRoomFittings(loaded.fittingsJson));
      setCeiling(parseCeiling(loaded.ceilingJson));
      setLower(parseLower(loaded.lowerJson));
      setOptions(await window.sekisan.getMasterOptions());
      setCeilingHeight(loaded.ceilingHeight);
      setFittings(await window.sekisan.listFittings(project.id));
      setDeductionLimit(await window.sekisan.getDeductionLimit());
    })();
  }, [project.id, row.id]);

  const solved = useMemo(() => solveShape(shape), [shape]);
  const view = useMemo(() => viewBox(solved), [solved]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    // 図は正方形のviewBoxを枠に収めて描くので、短い辺が実際の縮尺を決める
    const measure = (): void =>
      setCanvasSize(Math.min(element.clientWidth, element.clientHeight));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  /** 寸法文字の大きさ（画面上で表と同じ12px相当になるようにする） */
  const dimFontSize = useMemo(() => {
    const drawnSize = Math.max(canvasSize * zoom, 1);
    return (view.span / drawnSize) * 12;
  }, [canvasSize, view.span, zoom]);

  /** 上段の建具は寸法を保持せず、常に建具表から引用する */
  const resolvedFittings = useMemo<RoomFitting[]>(
    () =>
      roomFittings.map((item) => {
        const master = fittings.find(
          (fitting) => fitting.symbol === item.symbol,
        );
        const computed = master ? computeFitting(master) : null;
        return {
          symbol: item.symbol,
          multiplier: item.multiplier,
          area: computed?.area ?? null,
          baseboardDeduction: computed?.baseboardDeduction ?? null,
          edgeId: item.edgeId,
        };
      }),
    [fittings, roomFittings],
  );

  const quantities = useMemo(
    () => roomQuantities(solved, ceilingHeight, resolvedFittings),
    [solved, ceilingHeight, resolvedFittings],
  );
  const ceilingResult = useMemo(
    () => ceilingQuantities(ceiling, solved, ceilingHeight),
    [ceiling, solved, ceilingHeight],
  );
  const symbols = useMemo(
    () => [
      ...roomSymbols(solved, ceilingHeight, resolvedFittings),
      ...(ceiling.length > 0 ? ceilingSymbols(ceilingResult) : []),
    ],
    [solved, ceilingHeight, resolvedFittings, ceiling.length, ceilingResult],
  );

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

  /** 天井伏図の線を描く位置（平面図の辺から内側へ離す） */
  const ceilingLines = useMemo(() => {
    if (solved.points.length === 0) return [];
    const area = solved.points.reduce((sum, point, index) => {
      const next = solved.points[(index + 1) % solved.points.length];
      return sum + (point.x * next.y - next.x * point.y);
    }, 0);
    const inward = area >= 0 ? 1 : -1;
    const count = ceilingResult.items.length;
    return ceilingResult.items.flatMap((item, itemIndex) => {
      const index = solved.edges.findIndex(
        (line) => line.id === item.element.edgeId,
      );
      if (index < 0) return [];
      const from = solved.points[index];
      const to = solved.points[(index + 1) % solved.points.length];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const size = Math.hypot(dx, dy) || 1;
      const nx = (-dy / size) * inward;
      const ny = (dx / size) * inward;
      const width = item.element.width ?? 0;
      const offset =
        item.element.kind === "wallBeam" || item.element.kind === "dropWall"
          ? 0
          : (item.element.offset ?? 0);
      const distances =
        item.element.kind === "ceilingBeam"
          ? [offset, offset + width]
          : item.element.kind === "dropCeiling"
            ? [offset]
            : [width];
      // 同じ壁に何本も線を置いても天井高さの文字が重ならないように、線の上で位置をずらす
      const at = (itemIndex + 1) / (count + 1);
      return distances.map((distance, no) => ({
        key: `${item.element.id}-${no}`,
        elementId: item.element.id,
        kind: item.element.kind,
        x1: from.x + nx * distance,
        y1: from.y + ny * distance,
        x2: to.x + nx * distance,
        y2: to.y + ny * distance,
        labelX: from.x + dx * at + nx * distance,
        labelY: from.y + dy * at + ny * distance,
        label:
          no === 0 && item.element.ceilingHeight !== null
            ? formatNumber(item.element.ceilingHeight, 2)
            : "",
      }));
    });
  }, [ceilingResult.items, solved.edges, solved.points]);

  /** 壁の辺だけ（建具の取付先の選択肢） */
  const wallEdges = useMemo(
    () => solved.edges.filter((line) => line.kind === "wall"),
    [solved.edges],
  );

  const save = useCallback(async () => {
    if (!sheet) return;
    const saved = await window.sekisan.saveRoomSheet({
      id: sheet.id,
      shapeJson: JSON.stringify(shape),
      fittingsJson: JSON.stringify(roomFittings),
      ceilingJson: JSON.stringify(ceiling),
      lowerJson: JSON.stringify(lower),
      ceilingHeight,
      note: sheet.note,
    });
    setSheet(saved);
    setMessage("保存しました（天井高さは部位別入力表にも反映します）");
  }, [ceiling, ceilingHeight, lower, roomFittings, shape, sheet]);

  const updateCeiling = useCallback(
    (id: string, patch: Partial<CeilingElement>): void =>
      setCeiling((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      ),
    [],
  );

  /** 建具表の行をこの部屋の自動計算へ加える */
  const addRoomFitting = useCallback((symbol: string) => {
    setRoomFittings((current) => [
      ...current,
      { id: newRoomFittingId(), symbol, multiplier: 1, edgeId: null },
    ]);
  }, []);

  /** 建具表に無い建具をここで入力して登録する（建具表へ自動転記） */
  const registerFitting = useCallback(async () => {
    const symbol = newFitting.symbol.trim();
    if (symbol === "") {
      setMessage("建具記号を入力してください");
      return;
    }
    const toNumber = (text: string): number | null => {
      const value = Number(text.trim());
      return text.trim() === "" || !Number.isFinite(value) ? null : value;
    };
    setFittings(
      await window.sekisan.registerRoomFitting(project.id, {
        symbol,
        width: toNumber(newFitting.width),
        height: toNumber(newFitting.height),
        sillHeight: toNumber(newFitting.sill),
      }),
    );
    addRoomFitting(symbol);
    setNewFitting({ symbol: "", width: "", height: "", sill: "" });
    setMessage(`${symbol} を建具表へ登録してこの部屋へ追加しました`);
  }, [addRoomFitting, newFitting, project.id]);

  /** 記号は計算式にそのまま入力できる。クリックでコピーする */
  const copySymbol = useCallback(async (symbol: string) => {
    await navigator.clipboard.writeText(symbol);
    setMessage(`${symbol} をコピーしました（計算式に貼り付けられます）`);
  }, []);

  /** 計算式に使える数量（上段の記号＋建具表の記号） */
  const calcVariables = useMemo(() => {
    const values: Record<string, number> = {};
    symbols.forEach((item) => {
      if (item.value !== null) values[item.symbol] = item.value;
    });
    fittings.forEach((fitting) => {
      const computed = computeFitting(fitting);
      // 下段の建具記号は上段に書かなくても建具表から引用する
      if (computed.area !== null) values[`<${fitting.symbol}>`] = computed.area;
      if (fitting.width !== null)
        values[`<${fitting.symbol}:W>`] = fitting.width;
      if (fitting.height !== null)
        values[`<${fitting.symbol}:H>`] = fitting.height;
      if (computed.baseboardDeduction !== null)
        values[`<${fitting.symbol}:HL>`] = computed.baseboardDeduction;
    });
    return values;
  }, [fittings, symbols]);

  const calcResult = useMemo(
    () => evaluateCalcSheet(lower, calcVariables),
    [calcVariables, lower],
  );

  /** 記号クリック：計算式にカーソルがあればそこへ入れる。無ければコピーする */
  const useSymbol = useCallback(
    (symbol: string) => {
      const target = calcFocus;
      if (!target || target.area === "detail") {
        void copySymbol(symbol);
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
    [calcFocus, copySymbol],
  );

  /** 画面を閉じるとき、式の誤りがあれば注意して該当箇所へ飛ぶ */
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

  /** チェック表：上段の自動計算と下段の計算式合計を見比べる */
  const checkRows = useMemo(() => {
    const byPart = quantityByPart(lower, calcResult);
    const auto: { partName: string; quantity: number | null }[] = [
      { partName: "床", quantity: quantities.floorArea },
      { partName: "天井", quantity: quantities.ceilingArea },
      { partName: "壁", quantity: quantities.wallArea },
      { partName: "巾木", quantity: quantities.baseboardLength },
    ];
    return auto.map((item) => {
      const manual = byPart
        .filter((each) => each.partName.startsWith(item.partName))
        .reduce((sum, each) => sum + each.quantity, 0);
      return {
        partName: item.partName,
        auto: item.quantity,
        manual,
        diff: item.quantity === null ? null : manual - item.quantity,
      };
    });
  }, [calcResult, lower, quantities]);

  const startShape = (next: RoomShape): void => {
    setShape(next);
    setSelectedEdge(null);
  };

  return (
    <div className="room-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={closePage}>
          ← 部位別入力表へ
        </button>
        <h2>部屋別計算書</h2>
        <span className="project">
          {project.managementNo} {roomName || "（部屋名なし）"}
        </span>
        <label>
          天井高さ
          <input
            className="num"
            defaultValue={formatNumber(ceilingHeight, 2)}
            key={`ch-${sheet?.id ?? "new"}`}
            onBlur={(e) => {
              const value = e.target.value.trim();
              setCeilingHeight(value === "" ? null : Number(value));
            }}
          />
        </label>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <button type="button" onClick={() => setShowCheck(!showCheck)}>
          ✓ チェック表
        </button>
        <span className="status">{message}</span>
      </div>

      <div className="upper">
        <section className="drawing">
          <div className="section-bar">
            <span>
              部屋形状イメージ（{showCeiling ? "天井伏図" : "平面図"}）
            </span>
            <button
              type="button"
              className={showCeiling ? "on" : ""}
              onClick={() => setShowCeiling(!showCeiling)}
            >
              {showCeiling ? "□ 平面図へ" : "▤ 天井伏図へ"}
            </button>
            <button
              type="button"
              onClick={() => startShape(rectangleShape(4, 3))}
            >
              □ 四角
            </button>
            <button
              type="button"
              onClick={() => startShape(lShape(5, 4, 2, 1))}
            >
              L型
            </button>
            <button
              type="button"
              onClick={() => startShape(uShape(6, 4, 2, 1, 1))}
            >
              コ型
            </button>
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
          <div className="canvas" ref={canvasRef}>
            <svg
              viewBox={view.box}
              style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
            >
              {solved.points.map((point, index) => {
                const line = solved.edges[index];
                const next = solved.points[(index + 1) % solved.points.length];
                const middle = {
                  x: (point.x + next.x) / 2,
                  y: (point.y + next.y) / 2,
                };
                const vertical = point.x === next.x;
                return (
                  <g key={line.id} onClick={() => setSelectedEdge(line.id)}>
                    <line
                      x1={point.x}
                      y1={point.y}
                      x2={next.x}
                      y2={next.y}
                      className={[
                        "edge",
                        line.kind,
                        selectedEdge === line.id ? "selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <text
                      x={vertical ? middle.x + dimFontSize * 0.8 : middle.x}
                      y={vertical ? middle.y : middle.y - dimFontSize * 0.6}
                      className={line.auto ? "dim auto" : "dim"}
                      fontSize={dimFontSize}
                      transform={
                        vertical
                          ? `rotate(-90 ${middle.x + dimFontSize * 0.8} ${middle.y})`
                          : undefined
                      }
                    >
                      {formatNumber(line.resolved, 2)}
                    </text>
                  </g>
                );
              })}
              {showCeiling &&
                ceilingLines.map((line) => (
                  <g key={line.key}>
                    <line
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      className={`ceiling-line ${line.kind}`}
                    />
                    {line.label !== "" && (
                      <text
                        x={line.labelX}
                        y={line.labelY + dimFontSize * 0.9}
                        className="dim ceiling"
                        fontSize={dimFontSize}
                      >
                        CH {line.label}
                      </text>
                    )}
                  </g>
                ))}
            </svg>
            {solved.points.length === 0 && (
              <p className="empty">
                {solved.missing.length > 0
                  ? "寸法が足りません（同じ方向に未入力が2辺あります）。点滅している行に寸法を入れてください。"
                  : "□・L型・コ型から始めて、寸法を入れてください。"}
              </p>
            )}
          </div>
          {solved.error && <p className="error">{solved.error}</p>}
        </section>

        <section className="edges">
          <div className="section-bar">
            <span>寸法入力（空欄は自動算出）</span>
            <button
              type="button"
              onClick={() =>
                setShape({ edges: [...shape.edges, edge("E", null)] })
              }
            >
              ＋ 辺追加
            </button>
            <button
              type="button"
              disabled={selectedEdge === null}
              onClick={() => {
                if (selectedEdge === null) return;
                const target = shape.edges.find(
                  (item) => item.id === selectedEdge,
                );
                const half =
                  target?.length === null ? 1 : (target?.length ?? 2) / 2;
                setShape(
                  splitEdge(shape, selectedEdge, Number(half.toFixed(2))),
                );
              }}
            >
              ✂ 線分割
            </button>
            <button
              type="button"
              disabled={selectedEdge === null}
              onClick={() =>
                selectedEdge !== null &&
                setShape({
                  edges: shape.edges.filter((item) => item.id !== selectedEdge),
                })
              }
            >
              🗑 辺削除
            </button>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th className="no">No</th>
                <th>向き</th>
                <th className="num">寸法</th>
                <th>種別</th>
              </tr>
            </thead>
            <tbody>
              {solved.edges.map((line, index) => (
                <tr
                  key={line.id}
                  className={[
                    selectedEdge === line.id ? "selected" : "",
                    solved.missing.includes(line.id) ? "missing" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setSelectedEdge(line.id)}
                >
                  <td className="no">{index + 1}</td>
                  <td>
                    <select
                      value={line.direction}
                      onChange={(e) =>
                        setShape(
                          updateEdge(shape, line.id, {
                            direction: e.target.value as EdgeDirection,
                          }),
                        )
                      }
                    >
                      {(Object.keys(DIRECTION_LABEL) as EdgeDirection[]).map(
                        (key) => (
                          <option key={key} value={key}>
                            {DIRECTION_LABEL[key]}
                          </option>
                        ),
                      )}
                    </select>
                  </td>
                  <td>
                    <input
                      className="num"
                      defaultValue={
                        line.length === null ? "" : formatNumber(line.length, 2)
                      }
                      key={`${line.id}-${line.length ?? "auto"}`}
                      placeholder={
                        line.auto ? formatNumber(line.resolved, 2) : ""
                      }
                      title="空欄にすると、閉じた形になるように自動算出します"
                      onBlur={(e) => {
                        const text = e.target.value.trim();
                        setShape(
                          updateEdge(shape, line.id, {
                            length: text === "" ? null : Number(text),
                          }),
                        );
                      }}
                    />
                  </td>
                  <td>
                    <select
                      value={line.kind}
                      onChange={(e) =>
                        setShape(
                          updateEdge(shape, line.id, {
                            kind: e.target.value as EdgeKind,
                          }),
                        )
                      }
                    >
                      {(Object.keys(KIND_LABEL) as EdgeKind[]).map((key) => (
                        <option key={key} value={key}>
                          {KIND_LABEL[key]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <p className="totals">
            床面積 {formatNumber(quantities.floorArea, 2)}／壁長さ{" "}
            {formatNumber(quantities.wallLength, 2)}／柱長さ{" "}
            {formatNumber(quantities.columnLength, 2)}
          </p>
        </section>

        <section className="room-fittings">
          <div className="section-bar">
            <span>この部屋の建具（上段の自動計算に使います）</span>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>記号</th>
                <th className="num">数</th>
                <th>取り付く壁</th>
                <th className="num">面積</th>
                <th className="num">巾木減</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roomFittings.map((item, index) => {
                const resolved = resolvedFittings[index];
                const unknown = !fittings.some(
                  (fitting) => fitting.symbol === item.symbol,
                );
                return (
                  <tr key={item.id} className={unknown ? "unknown" : ""}>
                    <td>
                      <input
                        list="room-fitting-symbols"
                        defaultValue={item.symbol}
                        onBlur={(e) =>
                          setRoomFittings((current) =>
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
                          setRoomFittings((current) =>
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
                        value={item.edgeId ?? ""}
                        onChange={(e) =>
                          setRoomFittings((current) =>
                            current.map((each) =>
                              each.id === item.id
                                ? {
                                    ...each,
                                    edgeId:
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
                        {wallEdges.map((line, wallIndex) => (
                          <option key={line.id} value={line.id}>
                            壁{wallIndex + 1}（{formatNumber(line.resolved, 2)}
                            ）
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      {formatNumber(resolved?.area ?? null, 2)}
                    </td>
                    <td className="num">
                      {formatNumber(resolved?.baseboardDeduction ?? null, 2)}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setRoomFittings((current) =>
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
          <datalist id="room-fitting-symbols">
            {fittings.map((fitting) => (
              <option key={fitting.id} value={fitting.symbol} />
            ))}
          </datalist>
          <div className="register">
            <span>建具表に無い建具はここで入力（建具表へ登録します）</span>
            <input
              placeholder="記号"
              value={newFitting.symbol}
              onChange={(e) =>
                setNewFitting({ ...newFitting, symbol: e.target.value })
              }
            />
            <input
              className="num"
              placeholder="W"
              value={newFitting.width}
              onChange={(e) =>
                setNewFitting({ ...newFitting, width: e.target.value })
              }
            />
            <input
              className="num"
              placeholder="H"
              value={newFitting.height}
              onChange={(e) =>
                setNewFitting({ ...newFitting, height: e.target.value })
              }
            />
            <input
              className="num"
              placeholder="腰高"
              value={newFitting.sill}
              onChange={(e) =>
                setNewFitting({ ...newFitting, sill: e.target.value })
              }
            />
            <button type="button" onClick={() => void registerFitting()}>
              ＋ 建具表へ登録して追加
            </button>
          </div>
          <p className="note">
            上段の建具は壁面積・巾木長さから自動で差し引きます。下段の計算式で使う建具記号（&lt;AW1&gt;
            など）は、ここに書かなくても建具表から数量を引用します。
          </p>
        </section>

        {showCeiling && (
          <section className="ceiling">
            <div className="section-bar">
              <span>天井伏図（平面図の壁沿いに線を追加します）</span>
              {(Object.keys(CEILING_KIND_LABEL) as CeilingElementKind[]).map(
                (kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={wallEdges.length === 0}
                    onClick={() =>
                      setCeiling((current) => [
                        ...current,
                        ceilingElement(
                          kind,
                          selectedEdge ?? wallEdges[0]?.id ?? null,
                        ),
                      ])
                    }
                  >
                    ＋ {CEILING_KIND_LABEL[kind]}
                  </button>
                ),
              )}
            </div>
            <table className="grid">
              <thead>
                <tr>
                  <th>種別</th>
                  <th>沿う壁</th>
                  <th className="num">長さ</th>
                  <th className="num">幅</th>
                  <th className="num">壁からの離れ</th>
                  <th className="num">範囲の天井高さ</th>
                  <th className="num">下がり</th>
                  <th className="num">面積</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ceilingResult.items.map((item) => {
                  const element = item.element;
                  return (
                    <tr key={element.id}>
                      <td>
                        <select
                          value={element.kind}
                          onChange={(e) =>
                            updateCeiling(element.id, {
                              kind: e.target.value as CeilingElementKind,
                            })
                          }
                        >
                          {(
                            Object.keys(
                              CEILING_KIND_LABEL,
                            ) as CeilingElementKind[]
                          ).map((kind) => (
                            <option key={kind} value={kind}>
                              {CEILING_KIND_LABEL[kind]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={element.edgeId ?? ""}
                          onChange={(e) =>
                            updateCeiling(element.id, {
                              edgeId:
                                e.target.value === "" ? null : e.target.value,
                            })
                          }
                        >
                          <option value="">指定なし</option>
                          {wallEdges.map((line, wallIndex) => (
                            <option key={line.id} value={line.id}>
                              壁{wallIndex + 1}（
                              {formatNumber(line.resolved, 2)}）
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="num"
                          defaultValue={
                            element.length === null
                              ? ""
                              : formatNumber(element.length, 2)
                          }
                          placeholder={formatNumber(item.length, 2)}
                          title="空欄なら沿う壁の長さを使います"
                          onBlur={(e) => {
                            const text = e.target.value.trim();
                            updateCeiling(element.id, {
                              length: text === "" ? null : Number(text),
                            });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          defaultValue={
                            element.width === null
                              ? ""
                              : formatNumber(element.width, 2)
                          }
                          onBlur={(e) => {
                            const text = e.target.value.trim();
                            updateCeiling(element.id, {
                              width: text === "" ? null : Number(text),
                            });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          defaultValue={
                            element.offset === null
                              ? ""
                              : formatNumber(element.offset, 2)
                          }
                          onBlur={(e) => {
                            const text = e.target.value.trim();
                            updateCeiling(element.id, {
                              offset: text === "" ? null : Number(text),
                            });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          defaultValue={
                            element.ceilingHeight === null
                              ? ""
                              : formatNumber(element.ceilingHeight, 2)
                          }
                          title="この線で囲まれる範囲の天井高さ"
                          onBlur={(e) => {
                            const text = e.target.value.trim();
                            updateCeiling(element.id, {
                              ceilingHeight: text === "" ? null : Number(text),
                            });
                          }}
                        />
                      </td>
                      <td className="num">{formatNumber(item.drop, 2)}</td>
                      <td className="num">
                        {element.kind === "dropCeiling" ? (
                          <input
                            className="num"
                            defaultValue={
                              element.area === null
                                ? ""
                                : formatNumber(element.area, 2)
                            }
                            title="下がり天井の範囲面積"
                            onBlur={(e) => {
                              const text = e.target.value.trim();
                              updateCeiling(element.id, {
                                area: text === "" ? null : Number(text),
                              });
                            }}
                          />
                        ) : (
                          formatNumber(item.area, 2)
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() =>
                            setCeiling((current) =>
                              current.filter((each) => each.id !== element.id),
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
            <p className="note">
              範囲の天井高さを入れると、部屋の天井高さとの差（下がり）から面積を自動算出します。梁型面積は長さ×（梁幅＋下がり）、天井付梁型は両側に見付が出るので長さ×（梁幅＋下がり×2）です。記号はGL/GA・BL/BA・DWL/DWA・SL/SA（下がり天井は高さごとにSLH1…）。
            </p>
          </section>
        )}

        <section className="fittings">
          <div className="section-bar">
            <span>建具表（クリックで &lt;記号&gt; をコピー）</span>
            <label className="deduction">
              取合欠除
              <input
                className="num"
                defaultValue={String(deductionLimit)}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setDeductionLimit(value);
                  void window.sekisan.saveDeductionLimit(value);
                  setMessage(`${value}m2以下は差し引かない設定にしました`);
                }}
              />
              m2以下は引かない
            </label>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>記号</th>
                <th className="num">W</th>
                <th className="num">H</th>
                <th className="num">腰高</th>
                <th className="num">面積</th>
                <th className="num">巾木減</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fittings.map((fitting) => {
                const computed = computeFitting(fitting);
                return (
                  <tr
                    key={fitting.id}
                    onClick={() => useSymbol(`<${fitting.symbol}>`)}
                  >
                    <td>{fitting.symbol}</td>
                    <td className="num">{formatNumber(fitting.width, 2)}</td>
                    <td className="num">{formatNumber(fitting.height, 2)}</td>
                    <td className="num">
                      {formatNumber(fitting.sillHeight, 2)}
                    </td>
                    <td className="num">{formatNumber(computed.area, 2)}</td>
                    <td className="num">
                      {formatNumber(computed.baseboardDeduction, 2)}
                    </td>
                    <td>
                      <button
                        type="button"
                        title="この部屋の自動計算へ加える"
                        onClick={(e) => {
                          e.stopPropagation();
                          addRoomFitting(fitting.symbol);
                        }}
                      >
                        ＋部屋
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
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
      />

      {showCheck && (
        <div className="check-window">
          <div className="section-bar">
            <span>チェック表（上段の自動計算と下段の計算式合計）</span>
            <button type="button" onClick={() => setShowCheck(false)}>
              ✕ 閉じる
            </button>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>部位</th>
                <th className="num">自動計算</th>
                <th className="num">計算式合計</th>
                <th className="num">差</th>
              </tr>
            </thead>
            <tbody>
              {checkRows.map((item) => (
                <tr
                  key={item.partName}
                  className={
                    item.diff !== null && Math.abs(item.diff) > 0.005
                      ? "differ"
                      : ""
                  }
                >
                  <td>{item.partName}</td>
                  <td className="num">{formatNumber(item.auto, 2)}</td>
                  <td className="num">{formatNumber(item.manual, 2)}</td>
                  <td className="num">{formatNumber(item.diff, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            印刷には出しません。入力ミスを見つけるための画面です。
          </p>
        </div>
      )}

      <p className="hint">
        辺の寸法は空欄にすると、閉じた形になるように自動算出します（同じ方向に未入力が2辺あると寸法不足として
        赤く点滅します）。「開口（壁なし）」にした辺は壁長さ・壁面積に入れません。「柱」にした辺は柱長さ・柱面積として
        分けて数え、巾木長さには含めます。記号は下段の計算式にそのまま使えます（計算式にカーソルがあるときに記号をクリックすると差し込みます）。
      </p>
    </div>
  );
}
