import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EstimateRowDraft,
  Fitting,
  MasterOptions,
  PitSheet,
  ProjectSummary,
} from "@shared/types";
import {
  evaluateCalcSheet,
  trimEmptySets,
  withUniqueIds,
  type CalcSet,
} from "../../../../core/room/calcSheet";
import {
  DEFAULT_PIT_GAP,
  addPitCorner,
  beamLines,
  beamSegments,
  layoutPits,
  movePitCorner,
  rectanglePit,
  removePitCorner,
  normalizeRects,
  pitCornerCount,
  pitPolygon,
  pitQuantities,
  pitFormulaSymbol,
  pitPartVariables,
  pitSymbol,
  pitVariables,
  type PitAlign,
  type PitBeam,
  type PitDirection,
  type PitShape,
} from "../../../../core/pit/pit";
import { computeFitting } from "../../../../core/fittings/fitting";
import RoomCalcSheet, { type CalcFocus } from "./RoomCalcSheet";
import CalcPrintSheet from "../print/CalcPrintSheet";
import "./RoomSheetPage.css";
import "./PitSheetPage.css";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";

/** セットの部位名（左端の部位。空なら明細の部位名で見る） */
function partOfSet(set: CalcSet | undefined): string {
  if (!set) return "";
  const part = set.partName.trim();
  if (part !== "") return part;
  return set.details.find((detail) => detail.partName.trim() !== "")?.partName ?? "";
}

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
  /** 印刷書式（A3横）で出す。入力はせず、保存もしない */
  printMode?: boolean;
}

const ALIGNS_SIDE: { key: PitAlign; label: string }[] = [
  { key: "start", label: "上そろえ" },
  { key: "center", label: "中央" },
  { key: "end", label: "下そろえ" },
];

const ALIGNS_UPDOWN: { key: PitAlign; label: string }[] = [
  { key: "start", label: "左そろえ" },
  { key: "center", label: "中央" },
  { key: "end", label: "右そろえ" },
];

const DIRECTIONS: { key: PitDirection; label: string }[] = [
  { key: "right", label: "→（右）" },
  { key: "left", label: "←（左）" },
  { key: "up", label: "↑（上）" },
  { key: "down", label: "↓（下）" },
  { key: "free", label: "自由（位置指定）" },
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
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatNumber(value: number, digits: number): string {
  return value.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 数字欄の入力（空欄は0にせず、そのまま打ち直せるようにする） */
function parseNumber(text: string): number | null {
  const value = Number(text.replace(/[０-９．]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  ));
  return Number.isFinite(value) ? value : null;
}

/** 記号（Ｐ1・Ｐ2…）を並び順で振り直す */
function renumber(pits: PitShape[]): PitShape[] {
  return pits.map((pit, index) => ({ ...pit, symbol: pitSymbol(index) }));
}

/** ピット計算書：Ｐ*ごとに寸法で四角を作り、床・壁・天井付き梁型を拾う計算書 */
export default function PitSheetPage({
  project,
  row,
  roomName,
  onBack,
  printMode = false,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<PitSheet | null>(null);
  const [pits, setPits] = useState<PitShape[]>([]);
  const [beams, setBeams] = useState<PitBeam[]>([]);
  const [lower, setLower] = useState<CalcSet[]>([]);
  const [note, setNote] = useState("");
  const [fittings, setFittings] = useState<Fitting[]>([]);
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [calcFocus, setCalcFocus] = useState<CalcFocus | null>(null);
  const [message, setMessage] = useState("");
  const [warned, setWarned] = useState(false);
  /** 図をクリックしたときに置く梁の向きと寸法（m） */
  const [beamAxis, setBeamAxis] = useState<"X" | "Y">("X");
  const [beamWidth, setBeamWidth] = useState(0.3);
  const [beamHeight, setBeamHeight] = useState(0.6);
  /** 図のクリックで何をするか（梁を置く／形の角を直す） */
  const [planMode, setPlanMode] = useState<"beam" | "shape">("beam");
  /** 選んでいる角（○印） */
  const [corner, setCorner] = useState<{ pitId: string; index: number } | null>(
    null,
  );
  /** 角を動かす寸法（m） */
  const [cornerStep, setCornerStep] = useState(1);

  const { markSaved } = useSaveOnLeave({ pits, beams, lower, note }, () =>
    save(),
  );

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getPitSheet(row.id as number);
      const loadedPits = renumber(parseJson<PitShape[]>(loaded.pitsJson, []));
      const loadedBeams = parseJson<PitBeam[]>(loaded.beamsJson, []);
      const sets = withUniqueIds(
        trimEmptySets(parseJson<CalcSet[]>(loaded.lowerJson, [])),
      );
      setSheet(loaded);
      setPits(loadedPits);
      setBeams(loadedBeams);
      setLower(sets);
      setNote(loaded.note);
      markSaved({
        pits: loadedPits,
        beams: loadedBeams,
        lower: sets,
        note: loaded.note,
      });
      setFittings(await window.sekisan.listFittings(project.id));
      setOptions(await window.sekisan.getMasterOptions(project.id));
    })();
  }, [markSaved, project.id, row.id]);

  const quantities = useMemo(() => pitQuantities(pits, beams), [beams, pits]);

  const plan = useMemo(() => {
    const rects = layoutPits(pits);
    const placed = normalizeRects(rects);
    const outlines: Record<string, string> = {};
    placed.rects.forEach((rect) => {
      const pit = pits.find((each) => each.id === rect.id);
      if (!pit) return;
      outlines[rect.id] = pitPolygon(pit)
        .map((point) => `${rect.left + point.x},${rect.top + point.y}`)
        .join(" ");
    });
    return {
      ...placed,
      outlines,
      beams: beamLines(pits, placed.rects, beams),
    };
  }, [beams, pits]);

  /** 計算式に使える記号（ピットごとのFA1…と、全部の合計FA・WA・GA・CA） */
  const calcVariables = useMemo(() => {
    const values: Record<string, number> = pitVariables(quantities);
    fittings.forEach((fitting) => {
      const computed = computeFitting(fitting);
      if (computed.area !== null) values[`<${fitting.symbol}>`] = computed.area;
      if (fitting.width !== null)
        values[`<${fitting.symbol}:W>`] = fitting.width;
      if (fitting.height !== null)
        values[`<${fitting.symbol}:H>`] = fitting.height;
      if (computed.baseboardDeduction !== null)
        values[`<${fitting.symbol}:HL>`] = computed.baseboardDeduction;
    });
    return values;
  }, [fittings, quantities]);

  const calcResult = useMemo(
    () =>
      evaluateCalcSheet(lower, calcVariables, (set) =>
        pitPartVariables(quantities, partOfSet(set)),
      ),
    [calcVariables, lower],
  );

  const save = useCallback(async () => {
    if (!sheet || printMode) return;
    const trimmed = trimEmptySets(lower);
    setLower(trimmed);
    markSaved({ pits, beams, lower: trimmed, note });
    const saved = await window.sekisan.savePitSheet({
      id: sheet.id,
      pitsJson: JSON.stringify(pits),
      beamsJson: JSON.stringify(beams),
      lowerJson: JSON.stringify(trimmed),
      note,
    });
    setSheet(saved);
    setMessage("保存しました");
  }, [beams, lower, markSaved, note, pits, printMode, sheet]);

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
    void (async () => {
      await save();
      onBack();
    })();
  }, [calcResult.errors, lower, onBack, warned, save]);

  const addPit = useCallback(() => {
    setPits((current) => {
      const last = current[current.length - 1];
      return renumber([
        ...current,
        {
          id: newId("pit"),
          symbol: pitSymbol(current.length),
          x: last?.x ?? 4,
          y: last?.y ?? 4,
          depth: last?.depth ?? 1,
          direction: "right",
          gap: last?.gap ?? DEFAULT_PIT_GAP,
        },
      ]);
    });
  }, []);

  const removePit = useCallback((id: string) => {
    setPits((current) => renumber(current.filter((pit) => pit.id !== id)));
    setBeams((current) => current.filter((beam) => beam.pitId !== id));
  }, []);

  const editPit = useCallback((id: string, values: Partial<PitShape>) => {
    setPits((current) =>
      current.map((pit) => (pit.id === id ? { ...pit, ...values } : pit)),
    );
  }, []);

  /**
   * Ｐ記号クリック：入れる先のセットの部位に合わせた記号を計算式へ入れる。
   * 床＝FA*／壁＝WA*／梁型＝GA*／天井＝CA*（式にカーソルが無いときはコピー）
   */
  const useSymbol = useCallback(
    (index: number) => {
      const target = calcFocus;
      const symbol = pitFormulaSymbol(index);
      if (!target || target.area === "detail") {
        void navigator.clipboard.writeText(symbol);
        setMessage(`${symbol} をコピーしました（計算式に貼り付けられます）`);
        return;
      }
      setLower((current) =>
        current.map((each) =>
          each.id !== target.setId
            ? each
            : {
                ...each,
                lines: each.lines.map((line, lineIndex) =>
                  lineIndex !== target.index
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

  /** 梁の1本（高い梁で分かれた区間）を消す。全部消したら梁ごと消す */
  const removeBeamSegment = useCallback(
    (id: string, index: number) => {
      setBeams((current) =>
        current.flatMap((beam) => {
          if (beam.id !== id) return [beam];
          const removed = [...(beam.removed ?? []), index];
          const pit = pits.find((each) => each.id === beam.pitId);
          const next = { ...beam, removed };
          if (pit && beamSegments(pit, next, current).length === 0) return [];
          return [next];
        }),
      );
    },
    [pits],
  );

  const editBeam = useCallback((id: string, values: Partial<PitBeam>) => {
    setBeams((current) =>
      current.map((beam) => (beam.id === id ? { ...beam, ...values } : beam)),
    );
  }, []);

  /** 選んだ角を上下左右へ動かす（右・下がプラス） */
  const moveCorner = useCallback(
    (dx: number, dy: number) => {
      if (!corner) {
        setMessage("図の角（○印）を選んでから↑↓→←を押してください");
        return;
      }
      setPits((current) =>
        current.map((pit) =>
          pit.id === corner.pitId
            ? movePitCorner(pit, corner.index, dx, dy)
            : pit,
        ),
      );
      setMessage(
        `角を 横${formatNumber(dx, 2)}／縦${formatNumber(dy, 2)} 動かしました`,
      );
    },
    [corner],
  );

  /** 辺の近くをクリックしたら、その場所へ角を足す */
  const addCorner = useCallback((pitId: string, x: number, y: number) => {
    setPits((current) =>
      current.map((pit) =>
        pit.id === pitId ? addPitCorner(pit, { x, y }) : pit,
      ),
    );
    setMessage("角を足しました（○印を選んで↑↓→←で動かします）");
  }, []);

  /** 選んだ角を消す */
  const dropCorner = useCallback(() => {
    if (!corner) {
      setMessage("図の角（○印）を選んでから押してください");
      return;
    }
    setPits((current) =>
      current.map((pit) =>
        pit.id === corner.pitId ? removePitCorner(pit, corner.index) : pit,
      ),
    );
    setCorner(null);
    setMessage("角を消しました");
  }, [corner]);

  /** 選んだ角のピットを四角に戻す */
  const resetShape = useCallback(() => {
    if (!corner) {
      setMessage("図の角（○印）を選んでから押してください");
      return;
    }
    setPits((current) =>
      current.map((pit) => (pit.id === corner.pitId ? rectanglePit(pit) : pit)),
    );
    setCorner(null);
    setMessage("四角に戻しました");
  }, [corner]);

  /** 図の中をクリックすると、そのピットへ梁を置く（長さは当たる壁まで自動） */
  const placeBeam = useCallback(
    (pitId: string, ratio: number) => {
      setBeams((current) => [
        ...current,
        {
          id: newId("beam"),
          pitId,
          axis: beamAxis,
          width: beamWidth,
          height: beamHeight,
          position: Math.min(Math.max(ratio, 0), 1),
        },
      ]);
    },
    [beamAxis, beamHeight, beamWidth],
  );

  const drawing = (
    <div className="pit-drawing">
      {plan.rects.length === 0 ? (
        <p className="empty">
          「＋ ピット追加」でＰ1から順に四角を作ります（1個目が基準）
        </p>
      ) : (
        <svg
          viewBox={`${-1} ${-1} ${plan.width + 2} ${plan.height + 2}`}
          className="pit-plan"
        >
          {plan.rects.map((rect) => (
            <g key={rect.id}>
              <polygon
                points={plan.outlines[rect.id] ?? ""}
                className="pit-rect"
                onClick={(event) => {
                  if (printMode) return;
                  const box = event.currentTarget.getBoundingClientRect();
                  if (planMode === "shape") {
                    const svg = event.currentTarget.ownerSVGElement;
                    if (!svg) return;
                    const area = svg.getBoundingClientRect();
                    const px =
                      -1 +
                      ((event.clientX - area.left) / area.width) *
                        (plan.width + 2) -
                      rect.left;
                    const py =
                      -1 +
                      ((event.clientY - area.top) / area.height) *
                        (plan.height + 2) -
                      rect.top;
                    addCorner(rect.id, px, py);
                    return;
                  }
                  const ratio =
                    beamAxis === "X"
                      ? (event.clientY - box.top) / box.height
                      : (event.clientX - box.left) / box.width;
                  placeBeam(rect.id, ratio);
                }}
              />
              <text
                x={rect.left + rect.x / 2}
                y={rect.top + rect.y / 2}
                className="pit-label"
              >
                {rect.symbol}
              </text>
              <text
                x={rect.left + rect.x / 2}
                y={rect.top + rect.y / 2 + 0.45}
                className="pit-size"
              >
                {`X=${formatNumber(rect.x, 2)} Y=${formatNumber(rect.y, 2)}`}
              </text>
            </g>
          ))}
          {[...plan.beams]
            .sort((a, b) => a.height - b.height)
            .flatMap((beam) =>
              beam.segments.map((segment, index) => (
                <rect
                  key={`${beam.id}-${index}`}
                  x={
                    beam.axis === "X"
                      ? beam.left + segment.from
                      : beam.left - beam.width / 2
                  }
                  y={
                    beam.axis === "X"
                      ? beam.top - beam.width / 2
                      : beam.top + segment.from
                  }
                  width={
                    beam.axis === "X" ? segment.to - segment.from : beam.width
                  }
                  height={
                    beam.axis === "X" ? beam.width : segment.to - segment.from
                  }
                  className="pit-beam"
                />
              )),
            )}
          {!printMode &&
            planMode === "shape" &&
            plan.rects.flatMap((rect) => {
              const pit = pits.find((each) => each.id === rect.id);
              if (!pit) return [];
              const size = Math.max(plan.width, plan.height) / 70;
              return pitPolygon(pit).map((point, index) => (
                <circle
                  key={`${rect.id}-${index}`}
                  cx={rect.left + point.x}
                  cy={rect.top + point.y}
                  r={size}
                  className={
                    corner?.pitId === rect.id && corner.index === index
                      ? "pit-corner on"
                      : "pit-corner"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    setCorner({ pitId: rect.id, index });
                    setMessage(
                      `${rect.symbol} の角を選びました（↑↓→←で動かします）`,
                    );
                  }}
                />
              ));
            })}
        </svg>
      )}
    </div>
  );

  const quantityTable = (
    <table className="grid pit-quantities">
      <thead>
        <tr>
          <th>記号</th>
          <th className="num">床面積</th>
          <th className="num">壁面長さ</th>
          <th className="num">深さ</th>
          <th className="num">壁面面積</th>
          <th className="num">梁底面積</th>
          <th className="num">梁面積</th>
          <th className="num">天井面積</th>
        </tr>
      </thead>
      <tbody>
        {quantities.map((quantity) => (
          <tr key={quantity.id}>
            <td>{quantity.symbol}</td>
            <td className="num">{formatNumber(quantity.floorArea, 2)}</td>
            <td className="num">{formatNumber(quantity.wallLength, 2)}</td>
            <td className="num">{formatNumber(quantity.depth, 2)}</td>
            <td className="num">{formatNumber(quantity.wallArea, 2)}</td>
            <td className="num">{formatNumber(quantity.beamBottomArea, 2)}</td>
            <td className="num">{formatNumber(quantity.beamArea, 2)}</td>
            <td className="num">{formatNumber(quantity.ceilingArea, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (printMode)
    return (
      <CalcPrintSheet
        title={`ピット計算書　${project.managementNo} ${project.name}　${roomName || "（名称なし）"}`}
        upper={
          <div className="pit-print-upper">
            {drawing}
            {quantityTable}
          </div>
        }
        sets={lower}
        result={calcResult}
      />
    );

  return (
    <div className="room-sheet-page pit-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={closePage}>
          ← 部位別入力表へ
        </button>
        <h2>ピット計算書</h2>
        <span className="project">
          {project.managementNo} {roomName || "（名称なし）"}
        </span>
        <label className="grow">
          備考
          <input
            lang="ja"
            key={`note-${sheet?.id ?? "new"}`}
            defaultValue={note}
            onBlur={(e) => setNote(e.target.value)}
          />
        </label>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      <div className="pit-upper">
        <section className="pit-list">
          <div className="section-bar">
            <h3>ピット（Ｐ1が基準・深さだけ手入力・数量は自動）</h3>
            <button type="button" onClick={addPit}>
              ＋ ピット追加
            </button>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>記号</th>
                <th className="num">X（m）</th>
                <th className="num">Y（m）</th>
                <th className="num">深さ（m）</th>
                <th>形</th>
                <th>基準</th>
                <th>置き方</th>
                <th>そろえ／Y位置</th>
                <th className="num">すき間／X位置</th>
                <th className="num">床面積</th>
                <th className="num">壁面長さ</th>
                <th className="num">壁面面積</th>
                <th className="num">梁底面積</th>
                <th className="num">梁面積</th>
                <th className="num">天井面積</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pits.map((pit, index) => (
                <tr key={pit.id}>
                  <td
                    className="symbol"
                    onClick={() => useSymbol(index)}
                    title="クリックで計算式へ（部位で中身が変わります）"
                  >
                    {pit.symbol}
                  </td>
                  <td className="num">
                    {pit.points ? (
                      formatNumber(pit.x, 2)
                    ) : (
                      <input
                        data-half="1"
                        className="num"
                        defaultValue={pit.x}
                        key={`x-${pit.id}-${pit.x}`}
                        onBlur={(e) =>
                          editPit(pit.id, {
                            x: parseNumber(e.target.value) ?? 0,
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="num">
                    {pit.points ? (
                      formatNumber(pit.y, 2)
                    ) : (
                      <input
                        data-half="1"
                        className="num"
                        defaultValue={pit.y}
                        key={`y-${pit.id}-${pit.y}`}
                        onBlur={(e) =>
                          editPit(pit.id, {
                            y: parseNumber(e.target.value) ?? 0,
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="num">
                    <input
                      data-half="1"
                      className="num"
                      defaultValue={pit.depth}
                      key={`d-${pit.id}-${pit.depth}`}
                      onBlur={(e) =>
                        editPit(pit.id, {
                          depth: parseNumber(e.target.value) ?? 0,
                        })
                      }
                    />
                  </td>
                  <td>{`${pitPolygon(pit).length}角`}</td>
                  <td>
                    {index === 0 ? (
                      "基準（中央）"
                    ) : (
                      <select
                        value={pit.baseId ?? pits[index - 1]?.id ?? ""}
                        onChange={(e) =>
                          editPit(pit.id, { baseId: e.target.value })
                        }
                      >
                        {pits.slice(0, index).map((base) => (
                          <option key={base.id} value={base.id}>
                            {base.symbol}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {index === 0 ? (
                      ""
                    ) : (
                      <select
                        value={pit.direction}
                        onChange={(e) =>
                          editPit(pit.id, {
                            direction: e.target.value as PitDirection,
                          })
                        }
                      >
                        {DIRECTIONS.map((direction) => (
                          <option key={direction.key} value={direction.key}>
                            {direction.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {index === 0 ? (
                      ""
                    ) : pit.direction === "free" ? (
                      <input
                        data-half="1"
                        className="num"
                        key={`oy-${pit.id}-${pit.offsetY ?? 0}`}
                        defaultValue={pit.offsetY ?? 0}
                        title="基準ピットの上からの位置（m）"
                        onBlur={(e) =>
                          editPit(pit.id, {
                            offsetY: parseNumber(e.target.value) ?? 0,
                          })
                        }
                      />
                    ) : (
                      <select
                        value={pit.align ?? "start"}
                        onChange={(e) =>
                          editPit(pit.id, {
                            align: e.target.value as PitAlign,
                          })
                        }
                      >
                        {(pit.direction === "up" || pit.direction === "down"
                          ? ALIGNS_UPDOWN
                          : ALIGNS_SIDE
                        ).map((align) => (
                          <option key={align.key} value={align.key}>
                            {align.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="num">
                    {index === 0 ? (
                      ""
                    ) : pit.direction === "free" ? (
                      <input
                        data-half="1"
                        className="num"
                        key={`ox-${pit.id}-${pit.offsetX ?? 0}`}
                        defaultValue={pit.offsetX ?? 0}
                        title="基準ピットの左からの位置（m）"
                        onBlur={(e) =>
                          editPit(pit.id, {
                            offsetX: parseNumber(e.target.value) ?? 0,
                          })
                        }
                      />
                    ) : (
                      <input
                        data-half="1"
                        className="num"
                        defaultValue={pit.gap}
                        key={`g-${pit.id}-${pit.gap}`}
                        onBlur={(e) =>
                          editPit(pit.id, {
                            gap: parseNumber(e.target.value) ?? DEFAULT_PIT_GAP,
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="num">
                    {formatNumber(quantities[index]?.floorArea ?? 0, 2)}
                  </td>
                  <td className="num">
                    {formatNumber(quantities[index]?.wallLength ?? 0, 2)}
                  </td>
                  <td className="num">
                    {formatNumber(quantities[index]?.wallArea ?? 0, 2)}
                  </td>
                  <td className="num">
                    {formatNumber(quantities[index]?.beamBottomArea ?? 0, 2)}
                  </td>
                  <td className="num">
                    {formatNumber(quantities[index]?.beamArea ?? 0, 2)}
                  </td>
                  <td className="num">
                    {formatNumber(quantities[index]?.ceilingArea ?? 0, 2)}
                  </td>
                  <td>
                    <button type="button" onClick={() => removePit(pit.id)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="section-bar beam-bar">
            <h3>梁型（置いたあとも直せます／高い梁Hで分かれた1本ずつ消せます）</h3>
          </div>
          <table className="grid pit-beams">
            <thead>
              <tr>
                <th>ピット</th>
                <th>向き</th>
                <th className="num">梁W（m）</th>
                <th className="num">梁H（m）</th>
                <th className="num">位置（m）</th>
                <th className="num">区間（m）</th>
                <th className="num">長さ（m）</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plan.beams.map((beam) => {
                const pit = pits.find((each) => each.id === beam.pitId);
                const across = (beam.axis === "X" ? pit?.y : pit?.x) ?? 0;
                const span = beam.segments.length || 1;
                return beam.segments.map((segment, order) => (
                  <tr key={`${beam.id}-${segment.index}`}>
                    {order === 0 && (
                      <>
                        <td rowSpan={span}>{beam.symbol}</td>
                        <td rowSpan={span}>
                          <select
                            value={beam.axis}
                            onChange={(e) =>
                              editBeam(beam.id, {
                                axis: e.target.value === "Y" ? "Y" : "X",
                                removed: [],
                              })
                            }
                          >
                            <option value="X">X方向</option>
                            <option value="Y">Y方向</option>
                          </select>
                        </td>
                        <td className="num" rowSpan={span}>
                          <input
                            data-half="1"
                            className="num"
                            key={`bw-${beam.id}-${beam.width}`}
                            defaultValue={beam.width}
                            onBlur={(e) =>
                              editBeam(beam.id, {
                                width: parseNumber(e.target.value) ?? 0.3,
                              })
                            }
                          />
                        </td>
                        <td className="num" rowSpan={span}>
                          <input
                            data-half="1"
                            className="num"
                            key={`bh-${beam.id}-${beam.height}`}
                            defaultValue={beam.height}
                            onBlur={(e) =>
                              editBeam(beam.id, {
                                height: parseNumber(e.target.value) ?? 0.6,
                                removed: [],
                              })
                            }
                          />
                        </td>
                        <td className="num" rowSpan={span}>
                          <input
                            data-half="1"
                            className="num"
                            key={`bp-${beam.id}-${beam.position}`}
                            defaultValue={formatNumber(
                              beam.position * across,
                              2,
                            )}
                            onBlur={(e) => {
                              const value = parseNumber(e.target.value);
                              if (value === null || across <= 0) return;
                              editBeam(beam.id, {
                                position: value / across,
                                removed: [],
                              });
                            }}
                          />
                        </td>
                      </>
                    )}
                    <td className="num">
                      {formatNumber(segment.from, 2)}〜
                      {formatNumber(segment.to, 2)}
                    </td>
                    <td className="num">
                      {formatNumber(segment.to - segment.from, 2)}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => removeBeamSegment(beam.id, segment.index)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </section>

        <section className="pit-plan-area">
          <div className="section-bar">
            <h3>
              平面図（
              {planMode === "beam"
                ? "クリックで梁型を置く"
                : "○角を選んで↑↓→←で動かす／辺をクリックで角を足す"}）／全体{" "}
              {pitCornerCount(pits)}角
            </h3>
            <button
              type="button"
              className={planMode === "shape" ? "on" : ""}
              title="図の角を動かして台形・Ｌ型・コ型を作ります"
              onClick={() => {
                setPlanMode(planMode === "shape" ? "beam" : "shape");
                setCorner(null);
                setMessage(
                  planMode === "shape"
                    ? "梁を置くに戻しました"
                    : "形を直します（○角を選んで↑↓→←、辺をクリックで角を足す）",
                );
              }}
            >
              {planMode === "shape" ? "○ 形を直す（中）" : "○ 形を直す"}
            </button>
            {planMode === "shape" && (
              <>
                <label>
                  動かす寸法（m）
                  <input
                    data-half="1"
                    className="num"
                    defaultValue={cornerStep}
                    onBlur={(e) =>
                      setCornerStep(parseNumber(e.target.value) ?? 1)
                    }
                  />
                </label>
                <button
                  type="button"
                  title="選んだ角を左へ"
                  onClick={() => moveCorner(-cornerStep, 0)}
                >
                  ←
                </button>
                <button
                  type="button"
                  title="選んだ角を右へ"
                  onClick={() => moveCorner(cornerStep, 0)}
                >
                  →
                </button>
                <button
                  type="button"
                  title="選んだ角を上へ"
                  onClick={() => moveCorner(0, -cornerStep)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="選んだ角を下へ"
                  onClick={() => moveCorner(0, cornerStep)}
                >
                  ↓
                </button>
                <button type="button" onClick={dropCorner}>
                  角を消す
                </button>
                <button type="button" onClick={resetShape}>
                  □ 四角に戻す
                </button>
                <span className="status">
                  {corner === null
                    ? "角（○印）を選んでください"
                    : (() => {
                        const pit = pits.find(
                          (each) => each.id === corner.pitId,
                        );
                        const point = pit
                          ? pitPolygon(pit)[corner.index]
                          : undefined;
                        return point
                          ? `${pit?.symbol} の角 X=${formatNumber(point.x, 2)} Y=${formatNumber(point.y, 2)}`
                          : "";
                      })()}
                </span>
              </>
            )}
            <label>
              向き
              <select
                value={beamAxis}
                onChange={(e) => setBeamAxis(e.target.value === "Y" ? "Y" : "X")}
              >
                <option value="X">X方向（よこ）</option>
                <option value="Y">Y方向（たて）</option>
              </select>
            </label>
            <label>
              梁W（m）
              <input
                data-half="1"
                className="num"
                defaultValue={beamWidth}
                onBlur={(e) => setBeamWidth(parseNumber(e.target.value) ?? 0.3)}
              />
            </label>
            <label>
              梁H（m）
              <input
                data-half="1"
                className="num"
                defaultValue={beamHeight}
                onBlur={(e) => setBeamHeight(parseNumber(e.target.value) ?? 0.6)}
              />
            </label>
          </div>
          {drawing}
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
        hasUpper
        windowTitle={`ピット計算書　${project.managementNo}`}
      />

      <p className="hint">
        形（台形・Ｌ型・コ型）は「○ 形を直す」を押して、図の○角を選んで↑↓→←で動かします（辺をクリックすると角が増えます）。
        Ｌ型のあとに□を入れるときは、ピットを追加して置き方を「自由（位置指定）」にし、X位置・Y位置を入れます。
        <br />
        Ｐ記号（P1・P2…）は、その行のセット部位で中身が変わります（床＝床面積／壁＝壁面積／梁型＝梁面積／天井＝天井面積）。
        FA:床面積／WL:壁面長さ／WA:壁面積／GB:梁底面積／GA:梁面積／CA:天井面積 は全部の合計、FA1・WA1・CA1・DP1 …はピットごとです。
      </p>
    </div>
  );
}
