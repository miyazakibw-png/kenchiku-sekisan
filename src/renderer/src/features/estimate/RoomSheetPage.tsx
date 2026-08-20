import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EstimateRowDraft,
  Fitting,
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
  const [deductionLimit, setDeductionLimit] = useState(0.5);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getRoomSheet(row.id as number);
      setSheet(loaded);
      setShape(parseShape(loaded.shapeJson));
      setRoomFittings(parseRoomFittings(loaded.fittingsJson));
      setCeiling(parseCeiling(loaded.ceilingJson));
      setCeilingHeight(loaded.ceilingHeight);
      setFittings(await window.sekisan.listFittings(project.id));
      setDeductionLimit(await window.sekisan.getDeductionLimit());
    })();
  }, [project.id, row.id]);

  const solved = useMemo(() => solveShape(shape), [shape]);
  const view = useMemo(() => viewBox(solved), [solved]);

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

  /** 天井伏図の線を描く位置（平面図の辺から内側へ離す） */
  const ceilingLines = useMemo(() => {
    if (solved.points.length === 0) return [];
    const area = solved.points.reduce((sum, point, index) => {
      const next = solved.points[(index + 1) % solved.points.length];
      return sum + (point.x * next.y - next.x * point.y);
    }, 0);
    const inward = area >= 0 ? 1 : -1;
    return ceilingResult.items.flatMap((item) => {
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
      return distances.map((distance, no) => ({
        key: `${item.element.id}-${no}`,
        elementId: item.element.id,
        kind: item.element.kind,
        x1: from.x + nx * distance,
        y1: from.y + ny * distance,
        x2: to.x + nx * distance,
        y2: to.y + ny * distance,
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
      ceilingHeight,
      note: sheet.note,
    });
    setSheet(saved);
    setMessage("保存しました（天井高さは部位別入力表にも反映します）");
  }, [ceiling, ceilingHeight, roomFittings, shape, sheet]);

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

  const startShape = (next: RoomShape): void => {
    setShape(next);
    setSelectedEdge(null);
  };

  return (
    <div className="room-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
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
          <div className="canvas">
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
                      x={vertical ? middle.x + view.span * 0.035 : middle.x}
                      y={vertical ? middle.y : middle.y - view.span * 0.035}
                      className={line.auto ? "dim auto" : "dim"}
                      fontSize={view.span * 0.05}
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
                      strokeDasharray={`${view.span * 0.02} ${view.span * 0.015}`}
                    />
                    {line.label !== "" && (
                      <text
                        x={(line.x1 + line.x2) / 2}
                        y={(line.y1 + line.y2) / 2 + view.span * 0.045}
                        className="dim ceiling"
                        fontSize={view.span * 0.045}
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
          <table className="grid">
            <tbody>
              {symbols.map((item) => (
                <tr
                  key={item.symbol}
                  onClick={() => void copySymbol(item.symbol)}
                >
                  <td className="symbol">{item.symbol}</td>
                  <td className="label">{item.label}</td>
                  <td className="num">{formatNumber(item.value, 2)}</td>
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
                    onClick={() => void copySymbol(`<${fitting.symbol}>`)}
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

      <p className="hint">
        辺の寸法は空欄にすると、閉じた形になるように自動算出します（同じ方向に未入力が2辺あると寸法不足として
        赤く点滅します）。「開口（壁なし）」にした辺は壁長さ・壁面積に入れません。「柱」にした辺は柱長さ・柱面積として
        分けて数え、巾木長さには含めます。記号は計算式にそのまま使えます（下段のセット明細計算表は次に作ります）。
      </p>
    </div>
  );
}
