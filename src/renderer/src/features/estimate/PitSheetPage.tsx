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
  type CalcSet,
} from "../../../../core/room/calcSheet";
import {
  DEFAULT_PIT_GAP,
  beamLines,
  layoutPits,
  normalizeRects,
  pitQuantities,
  pitSymbol,
  pitVariables,
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

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
  /** 印刷書式（A3横）で出す。入力はせず、保存もしない */
  printMode?: boolean;
}

const DIRECTIONS: { key: PitDirection; label: string }[] = [
  { key: "right", label: "→（右）" },
  { key: "left", label: "←（左）" },
  { key: "up", label: "↑（上）" },
  { key: "down", label: "↓（下）" },
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
  /** 図をクリックしたときに置く梁の向きと寸法（mm） */
  const [beamAxis, setBeamAxis] = useState<"X" | "Y">("X");
  const [beamWidth, setBeamWidth] = useState(300);
  const [beamHeight, setBeamHeight] = useState(600);

  const { markSaved } = useSaveOnLeave({ pits, beams, lower, note }, () =>
    save(),
  );

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getPitSheet(row.id as number);
      const loadedPits = renumber(parseJson<PitShape[]>(loaded.pitsJson, []));
      const loadedBeams = parseJson<PitBeam[]>(loaded.beamsJson, []);
      const sets = trimEmptySets(parseJson<CalcSet[]>(loaded.lowerJson, []));
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
    return { ...placed, beams: beamLines(pits, placed.rects, beams) };
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
    () => evaluateCalcSheet(lower, calcVariables),
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

  /** 図の中をクリックすると、そのピットへ梁を置く（長さは当たる壁まで自動） */
  const placeBeam = useCallback(
    (pitId: string, ratio: number) => {
      setBeams((current) => [
        ...current,
        {
          id: newId("beam"),
          pitId,
          axis: beamAxis,
          width: beamWidth / 1000,
          height: beamHeight / 1000,
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
              <rect
                x={rect.left}
                y={rect.top}
                width={rect.x}
                height={rect.y}
                className="pit-rect"
                onClick={(event) => {
                  if (printMode) return;
                  const box = event.currentTarget.getBoundingClientRect();
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
          {plan.beams.map((beam) => (
            <line
              key={beam.id}
              x1={beam.left}
              y1={beam.top}
              x2={beam.axis === "X" ? beam.left + beam.length : beam.left}
              y2={beam.axis === "X" ? beam.top : beam.top + beam.length}
              className="pit-beam"
              strokeWidth={Math.max(beam.width, 0.08)}
            />
          ))}
        </svg>
      )}
    </div>
  );

  const quantityTable = (
    <table className="grid pit-quantities">
      <thead>
        <tr>
          <th>記号</th>
          <th className="num">面積</th>
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
            <h3>ピット（Ｐ1が基準／2個目からは向きとすき間で置く）</h3>
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
                <th>置き方</th>
                <th className="num">すき間（mm）</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pits.map((pit, index) => (
                <tr key={pit.id}>
                  <td>{pit.symbol}</td>
                  <td className="num">
                    <input
                      data-half="1"
                      className="num"
                      defaultValue={pit.x}
                      key={`x-${pit.id}-${pit.x}`}
                      onBlur={(e) =>
                        editPit(pit.id, { x: parseNumber(e.target.value) ?? 0 })
                      }
                    />
                  </td>
                  <td className="num">
                    <input
                      data-half="1"
                      className="num"
                      defaultValue={pit.y}
                      key={`y-${pit.id}-${pit.y}`}
                      onBlur={(e) =>
                        editPit(pit.id, { y: parseNumber(e.target.value) ?? 0 })
                      }
                    />
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
                  <td>
                    {index === 0 ? (
                      "基準（中央）"
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
                            {`${pits[index - 1]?.symbol ?? ""}${direction.label}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="num">
                    {index === 0 ? (
                      ""
                    ) : (
                      <input
                        data-half="1"
                        className="num"
                        defaultValue={Math.round(pit.gap * 1000)}
                        key={`g-${pit.id}-${pit.gap}`}
                        onBlur={(e) =>
                          editPit(pit.id, {
                            gap: (parseNumber(e.target.value) ?? 500) / 1000,
                          })
                        }
                      />
                    )}
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
        </section>

        <section className="pit-plan-area">
          <div className="section-bar">
            <h3>平面図（クリックで梁型を置く）</h3>
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
              梁W（mm）
              <input
                data-half="1"
                className="num"
                defaultValue={beamWidth}
                onBlur={(e) => setBeamWidth(parseNumber(e.target.value) ?? 300)}
              />
            </label>
            <label>
              梁H（mm）
              <input
                data-half="1"
                className="num"
                defaultValue={beamHeight}
                onBlur={(e) => setBeamHeight(parseNumber(e.target.value) ?? 600)}
              />
            </label>
          </div>
          {drawing}
          {beams.length > 0 && (
            <table className="grid pit-beams">
              <thead>
                <tr>
                  <th>ピット</th>
                  <th>向き</th>
                  <th className="num">梁W（mm）</th>
                  <th className="num">梁H（mm）</th>
                  <th className="num">長さ（m）</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plan.beams.map((beam) => (
                  <tr key={beam.id}>
                    <td>{beam.symbol}</td>
                    <td>{beam.axis === "X" ? "X方向" : "Y方向"}</td>
                    <td className="num">{Math.round(beam.width * 1000)}</td>
                    <td className="num">{Math.round(beam.height * 1000)}</td>
                    <td className="num">{formatNumber(beam.length, 2)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setBeams((current) =>
                            current.filter((each) => each.id !== beam.id),
                          )
                        }
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="pit-quantity-area">
          <div className="section-bar">
            <h3>ピットごとの数量（深さだけ手入力・他は自動）</h3>
          </div>
          {quantityTable}
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
        計算式には FA:床面積／WL:壁面長さ／WA:壁面積／GB:梁底面積／GA:梁面積／CA:天井面積 が使えます（全部の合計）。
        ピットごとは FA1・WA1・CA1 …（1がＰ1）、深さは DP1 …です。
      </p>
    </div>
  );
}
