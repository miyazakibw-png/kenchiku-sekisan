import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type {
  EstimateRowDraft,
  Fitting,
  MasterOptions,
  ProjectSummary,
  RoomSheet,
  RoomSheetFitting,
} from "@shared/types";
import {
  closeShape,
  closeShapeAtEdge,
  cutCorner,
  edge,
  incomingIsVertical,
  isDiagonal,
  moveCorner,
  nextEdgeDirection,
  notchEdge,
  rectangleShape,
  roomQuantities,
  roomSymbols,
  shapeExtents,
  solveShape,
  splitEdge,
  updateEdge,
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
  syncPartNames,
  trimEmptySets,
  type CalcSet,
} from "../../../../core/room/calcSheet";
import RoomCalcSheet, { type CalcFocus } from "./RoomCalcSheet";
import { computeFitting } from "../../../../core/fittings/fitting";
import { evaluateFormula } from "../../../../core/formula/evaluate";
import {
  DEFAULT_FITTING_PART_VALUES,
  fittingKindForPart,
  fittingSuffix,
  fittingSymbolForPart,
  type FittingPartValue,
} from "../../../../core/fittings/partValue";
import { formatNumber } from "./estimateRows";
import "./RoomSheetPage.css";

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
}

/** チェック表で合計する材種区分 */
const FINISH_CATEGORY = "仕上";

const DIRECTION_LABEL: Record<EdgeDirection, string> = {
  E: "→ 右",
  S: "↓ 下",
  W: "← 左",
  N: "↑ 上",
  D: "╱ 斜め",
};

const KIND_LABEL: Record<EdgeKind, string> = {
  wall: "壁",
  opening: "開口",
  column: "柱",
  curve: "曲面壁",
};

/** まだ選んでいない欄を押したときは、中の数字をまるごと選んで上書きできるようにする */
function selectWholeOnFirstClick(event: MouseEvent<HTMLInputElement>): void {
  const input = event.currentTarget;
  if (document.activeElement === input) return;
  event.preventDefault();
  input.focus();
  input.select();
}

/**
 * 打った文字を数値にする（空欄・数字でないものは未入力）。
 * 6.4+0.3 や 3.6/2 のような計算式は答えにする。
 */
function textToNumber(text: string): number | null {
  const body = text.trim();
  if (body === "") return null;
  const value = Number(body);
  if (Number.isFinite(value)) return value;
  return evaluateFormula(body);
}

/** 寸法欄で計算式を答えに直す（Enter・欄を出たときに使う） */
function showAnswer(input: HTMLInputElement): void {
  const value = textToNumber(input.value);
  if (value !== null) input.value = formatNumber(value, 2);
}

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
    return Array.isArray(parsed) ? trimEmptySets(parsed) : [];
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

/** 図形の寸法を小窓で入れてから確定する（四角・L型・コ型・角の追加） */
type ShapePrompt =
  | null
  | {
      kind: "rect" | "cut" | "notch";
      across: string;
      along: string;
      /** L型・コ型で足す辺の種別（小さいL・コは柱にすることが多い） */
      edgeKind: EdgeKind;
    }
  | { kind: "split"; edgeId: string; span: number; first: string };

const PROMPT_TITLE: Record<"rect" | "cut" | "notch" | "split", string> = {
  rect: "四角を作る",
  cut: "L型を角に追加",
  notch: "コ型を辺に追加",
  split: "角を追加",
};

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
  /** 建具の「数」を打っている途中の文字（打ち直しの邪魔をしないよう別に持つ） */
  const [fittingCountText, setFittingCountText] = useState<
    Record<string, string>
  >({});
  /** この部屋の建具の表で、いちばん下に置いておく空行（ここへ直接書き込める） */
  const [newFitting, setNewFitting] = useState({
    symbol: "",
    count: "1",
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
  /** 建具記号を計算式へ入れるときの、部位ごとの採用値 */
  const [partValues, setPartValues] = useState<FittingPartValue[]>(
    DEFAULT_FITTING_PART_VALUES,
  );
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  /** L型・コ型を足す場所（角の番号＝その角から出ていく辺の番号） */
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null);
  const [cutAcross, setCutAcross] = useState("1.00");
  const [cutAlong, setCutAlong] = useState("1.00");
  const [prompt, setPrompt] = useState<ShapePrompt>(null);
  /** L型・コ型で足す辺の種別（次に開く小窓の初期値） */
  const [promptEdgeKind, setPromptEdgeKind] = useState<EdgeKind>("wall");
  /** 頂点を動かす寸法（右・下がプラス） */
  const [moveX, setMoveX] = useState("0.00");
  const [moveY, setMoveY] = useState("0.00");
  /** 建具表はボタンでポップアップ表示する */
  const [showFittings, setShowFittings] = useState(false);
  const [zoom, setZoom] = useState(1);
  /** 角の○印を出すか（形が決まったら消して寸法を見やすくできます） */
  const [showCorners, setShowCorners] = useState(true);
  /** 図形の戻る・進む用（1操作ごとの形を覚えておく） */
  const [shapePast, setShapePast] = useState<RoomShape[]>([]);
  const [shapeFuture, setShapeFuture] = useState<RoomShape[]>([]);
  /** 辺をクリックした位置に角を足すモード */
  const [addCornerMode, setAddCornerMode] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const promptBoxRef = useRef<HTMLDivElement | null>(null);
  /** 図の実寸（寸法文字を表と同じ大きさで出すために測る） */
  const [canvasSize, setCanvasSize] = useState(200);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getRoomSheet(row.id as number);
      setSheet(loaded);
      setShape(parseShape(loaded.shapeJson));
      setShapePast([]);
      setShapeFuture([]);
      setRoomFittings(parseRoomFittings(loaded.fittingsJson));
      setCeiling(parseCeiling(loaded.ceilingJson));
      setLower(parseLower(loaded.lowerJson));
      setOptions(await window.sekisan.getMasterOptions(project.id));
      setCeilingHeight(loaded.ceilingHeight);
      setFittings(await window.sekisan.listFittings(project.id));
      setDeductionLimit(await window.sekisan.getDeductionLimit());
      setPartValues(await window.sekisan.getFittingPartValues());
    })();
  }, [project.id, row.id]);

  // 部位マスターで名前を直したら、明細の部位表示もその名前に合わせる
  useEffect(() => {
    if (!options) return;
    setLower((current) =>
      syncPartNames(current, options.aggregationParts, options.pickupParts),
    );
  }, [options]);

  // 小窓（四角・L型・コ型・角の追加）を開いている間は、カーソルを必ず小窓の中に置く
  const promptOpen = prompt !== null;
  useEffect(() => {
    if (!promptOpen) return;
    const focusInput = (): void => {
      const input = promptInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    };
    focusInput();
    const timer = window.setTimeout(focusInput, 50);
    // 小窓の外へカーソルが逃げたら（画面の検索欄などへ移ったら）寸法欄へ戻す
    const keepInside = (event: FocusEvent): void => {
      const target = event.target;
      const inside =
        target instanceof Node &&
        promptBoxRef.current !== null &&
        promptBoxRef.current.contains(target);
      if (!inside) focusInput();
    };
    document.addEventListener("focusin", keepInside);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", keepInside);
    };
  }, [promptOpen]);

  const solved = useMemo(() => solveShape(shape), [shape]);
  const extents = useMemo(() => shapeExtents(solved), [solved]);
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

  /** 角の○印の大きさ（短い辺や寸法文字にかからないように小さくする） */
  const cornerRadius = useMemo(() => {
    const points = solved.points;
    if (points.length === 0) return 0;
    const shortest = points.reduce((min, point, index) => {
      const next = points[(index + 1) % points.length];
      const length = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
      return length > 0 ? Math.min(min, length) : min;
    }, Number.POSITIVE_INFINITY);
    // 短い辺があっても見えなくならないよう下限を設ける（○印が押せなくなるため）
    const largest = Math.min(view.span * 0.025, dimFontSize * 0.7);
    return Math.max(largest * 0.5, Math.min(largest, shortest * 0.18));
  }, [dimFontSize, solved.points, view.span]);

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
    () =>
      roomQuantities(solved, ceilingHeight, resolvedFittings, deductionLimit),
    [solved, ceilingHeight, resolvedFittings, deductionLimit],
  );
  const ceilingResult = useMemo(
    () => ceilingQuantities(ceiling, solved, ceilingHeight),
    [ceiling, solved, ceilingHeight],
  );
  const symbols = useMemo(
    () => [
      ...roomSymbols(solved, ceilingHeight, resolvedFittings, deductionLimit),
      ...(ceiling.length > 0 ? ceilingSymbols(ceilingResult) : []),
    ],
    [
      solved,
      ceilingHeight,
      resolvedFittings,
      ceiling.length,
      ceilingResult,
      deductionLimit,
    ],
  );

  /**
   * 記号表は横に2組並べて高さを半分にする（下段の表示行を増やすため）。
   * 壁1・柱1などの辺ごとの記号は一覧には出さない（計算式には引き続き使える）。
   */
  const symbolPairs = useMemo(() => {
    const shown = symbols.filter(
      (item) => !("edgeId" in item) || item.edgeId === undefined,
    );
    const half = Math.ceil(shown.length / 2);
    return shown
      .slice(0, half)
      .map(
        (item, index) =>
          [item, shown[half + index] ?? null] as [
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
    // 入力の無いセット明細は保存時に取り除く（画面からも消す）
    const trimmed = trimEmptySets(lower);
    setLower(trimmed);
    const saved = await window.sekisan.saveRoomSheet({
      id: sheet.id,
      shapeJson: JSON.stringify(shape),
      fittingsJson: JSON.stringify(roomFittings),
      ceilingJson: JSON.stringify(ceiling),
      lowerJson: JSON.stringify(trimmed),
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
  const addRoomFitting = useCallback((symbol: string, multiplier = 1) => {
    setRoomFittings((current) => [
      ...current,
      { id: newRoomFittingId(), symbol, multiplier, edgeId: null },
    ]);
  }, []);

  /**
   * 表のいちばん下の空行に書いた建具を、この部屋へ足す。
   * 建具表に無い記号はそのまま建具表へ登録し、寸法を入れていれば建具表へ反映する。
   */
  const commitNewFitting = useCallback(async () => {
    const symbol = newFitting.symbol.trim();
    if (symbol === "") return;
    const width = textToNumber(newFitting.width);
    const height = textToNumber(newFitting.height);
    const sill = textToNumber(newFitting.sill);
    const master = fittings.find((fitting) => fitting.symbol === symbol);
    const sized = width !== null || height !== null || sill !== null;
    setFittings(
      await window.sekisan.registerRoomFitting(
        project.id,
        {
          symbol,
          width: width ?? master?.width ?? null,
          height: height ?? master?.height ?? null,
          sillHeight: sill ?? master?.sillHeight ?? null,
        },
        sized,
      ),
    );
    addRoomFitting(symbol, textToNumber(newFitting.count) ?? 1);
    setNewFitting({ symbol: "", count: "1", width: "", height: "", sill: "" });
    setMessage(
      master
        ? `${symbol} をこの部屋へ足しました`
        : `${symbol} を建具表へ登録してこの部屋へ足しました`,
    );
  }, [addRoomFitting, fittings, newFitting, project.id]);

  /** この部屋の建具の表で、寸法（W・H・腰高）を直接打ち替えて建具表へ反映する */
  const writeFittingSize = useCallback(
    async (
      symbol: string,
      patch: {
        width?: number | null;
        height?: number | null;
        sill?: number | null;
      },
    ) => {
      const name = symbol.trim();
      if (name === "") return;
      const master = fittings.find((fitting) => fitting.symbol === name);
      setFittings(
        await window.sekisan.registerRoomFitting(
          project.id,
          {
            symbol: name,
            width:
              patch.width === undefined ? (master?.width ?? null) : patch.width,
            height:
              patch.height === undefined
                ? (master?.height ?? null)
                : patch.height,
            sillHeight:
              patch.sill === undefined
                ? (master?.sillHeight ?? null)
                : patch.sill,
          },
          true,
        ),
      );
    },
    [fittings, project.id],
  );

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
      if (computed.reinforcement !== null)
        values[`<${fitting.symbol}:RF>`] = computed.reinforcement;
    });
    return values;
  }, [fittings, symbols]);

  /**
   * 建具記号を <AW1> と書いただけのときは、そのセットの部位に合った数値を採る。
   * 例：巾木のセットは巾木減、補強のセットは軸組横補強。
   */
  const partFittingVariables = useCallback(
    (set: CalcSet): Record<string, number> => {
      const kind = fittingKindForPart(set.partName, partValues, set.partNumber);
      const suffix = fittingSuffix(kind);
      if (suffix === "") return {};
      const values: Record<string, number> = {};
      fittings.forEach((fitting) => {
        const value = calcVariables[`<${fitting.symbol}${suffix}>`];
        if (value !== undefined) values[`<${fitting.symbol}>`] = value;
      });
      return values;
    },
    [calcVariables, fittings, partValues],
  );

  const calcResult = useMemo(
    () => evaluateCalcSheet(lower, calcVariables, partFittingVariables),
    [calcVariables, lower, partFittingVariables],
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

  /**
   * 建具表クリック：入れる先のセットの部位に合わせて採る数値を変える。
   * 例：壁＝面積 &lt;AW1&gt;／巾木＝巾木減 &lt;AW1:HL&gt;／補強＝軸組横補強 &lt;AW1:RF&gt;
   */
  const insertFittingSymbol = useCallback(
    (symbol: string) => {
      const set = lower.find((each) => each.id === calcFocus?.setId);
      useSymbol(
        fittingSymbolForPart(
          symbol,
          set?.partName ?? "",
          partValues,
          set?.partNumber ?? null,
        ),
      );
    },
    [calcFocus, lower, partValues, useSymbol],
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
    // 閉じるときは必ず自動保存する
    void (async () => {
      await save();
      onBack();
    })();
  }, [calcResult.errors, lower, onBack, warned, save]);

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
        .filter(
          (each) =>
            each.materialCategory === FINISH_CATEGORY &&
            each.partName.startsWith(item.partName),
        )
        .reduce((sum, each) => sum + each.quantity, 0);
      return {
        partName: item.partName,
        auto: item.quantity,
        manual,
        diff: item.quantity === null ? null : manual - item.quantity,
      };
    });
  }, [calcResult, lower, quantities]);

  /** 図形を書き換える。戻る・進むのために1つ前の形を覚えておく */
  const applyShape = (next: RoomShape): void => {
    setShapePast((past) => [...past.slice(-49), shape]);
    setShapeFuture([]);
    setShape(next);
  };

  const undoShape = (): void => {
    if (shapePast.length === 0) {
      setMessage("図形で戻せる操作がありません");
      return;
    }
    setShapeFuture((future) => [shape, ...future]);
    setShape(shapePast[shapePast.length - 1]);
    setShapePast(shapePast.slice(0, -1));
    setSelectedEdge(null);
    setSelectedCorner(null);
    setMessage("図形を1つ前に戻しました");
  };

  const redoShape = (): void => {
    if (shapeFuture.length === 0) {
      setMessage("図形で進める操作がありません");
      return;
    }
    setShapePast((past) => [...past, shape]);
    setShape(shapeFuture[0]);
    setShapeFuture(shapeFuture.slice(1));
    setSelectedEdge(null);
    setSelectedCorner(null);
    setMessage("図形を1つ先へ進めました");
  };

  const startShape = (next: RoomShape): void => {
    if (
      shape.edges.length > 0 &&
      !window.confirm("いまの形と寸法を消して、四角から作り直しますか？")
    ) {
      return;
    }
    applyShape(next);
    setSelectedEdge(null);
    setSelectedCorner(null);
  };

  /**
   * 図形を直す前に、閉じていない寸法を自動で合わせる。
   * 合わせた形と、直したことを伝える文言を返す。
   */
  const readyShape = (): { shape: RoomShape; note: string } => {
    if (solveShape(shape).points.length === shape.edges.length) {
      return { shape, note: "" };
    }
    const closed = closeShape(shape);
    return {
      shape: closed.shape,
      note: closed.changed ? "（閉じていない寸法を自動で合わせました）" : "",
    };
  };

  /** 図形を直したときに増えた辺だけ、小窓で選んだ種別にする */
  const applyKindToNewEdges = (
    before: RoomShape,
    after: RoomShape,
    edgeKind: EdgeKind,
  ): RoomShape => {
    if (edgeKind === "wall") return after;
    const known = new Set(before.edges.map((item) => item.id));
    return {
      edges: after.edges.map((item) =>
        known.has(item.id) ? item : { ...item, kind: edgeKind },
      ),
    };
  };

  /** 選んだ角をL型に欠き取る（いまの形と寸法は残す） */
  const addCorner = (
    across: number,
    along: number,
    edgeKind: EdgeKind,
  ): void => {
    if (selectedCorner === null) {
      setMessage("図の角（○印）を選んでからL型を押してください");
      return;
    }
    const base = readyShape();
    const vertical = incomingIsVertical(base.shape, selectedCorner);
    const result = cutCorner(
      base.shape,
      selectedCorner,
      vertical ? along : across,
      vertical ? across : along,
    );
    if (result.error) {
      setMessage(result.error);
      return;
    }
    const next = applyKindToNewEdges(base.shape, result.shape, edgeKind);
    applyShape(next);
    setSelectedEdge(null);
    // 続けてL型を足せるよう、選んである角は残す（形が小さくなったときは最後の角へ寄せる）
    setShowCorners(true);
    setSelectedCorner(
      Math.min(selectedCorner, Math.max(result.shape.edges.length - 1, 0)),
    );
    setMessage(
      `選んだ角をL型に欠き取りました（足した辺は${KIND_LABEL[edgeKind]}）${
        result.adjusted ? "（隣の辺の長さに合わせました）" : ""
      }${base.note}`,
    );
  };

  /** 小窓で入れた寸法で、四角・L型・コ型・角の追加を確定する */
  const submitPrompt = (): void => {
    if (!prompt) return;
    if (prompt.kind === "split") {
      const first = textToNumber(prompt.first) ?? 0;
      if (!(first > 0) || first >= prompt.span) {
        setMessage(
          `角の位置は 0 より大きく ${prompt.span} 未満で入れてください`,
        );
        return;
      }
      setPrompt(null);
      applySplit(prompt.edgeId, first);
      return;
    }
    const across = textToNumber(prompt.across) ?? 0;
    const along = textToNumber(prompt.along) ?? 0;
    if (!(across > 0) || !(along > 0)) {
      setMessage("寸法は0より大きい値を入れてください");
      return;
    }
    setPrompt(null);
    if (prompt.kind === "rect") {
      startShape(rectangleShape(across, along));
      setMessage(
        `横${formatNumber(across, 2)}／縦${formatNumber(along, 2)} の四角を作りました`,
      );
      return;
    }
    setCutAcross(formatNumber(across, 2));
    setCutAlong(formatNumber(along, 2));
    if (prompt.kind === "cut") addCorner(across, along, prompt.edgeKind);
    else addNotch(across, along, prompt.edgeKind);
  };

  /** 選んだ辺の寸法だけを、閉じた形になるように自動で入れる */
  const fitEdge = (edgeId: string): void => {
    const result = closeShapeAtEdge(shape, edgeId);
    if (result.error !== null) {
      setMessage(result.error);
      return;
    }
    if (result.shape === shape) {
      setMessage(
        "この辺の寸法は合っています（もう一方の向きの辺を選んでください）",
      );
      return;
    }
    applyShape(result.shape);
    setMessage(
      `選んだ辺の寸法を ${formatNumber(result.length, 2)} にして形を閉じました`,
    );
  };

  /** 閉じていない寸法を自動で合わせる */
  const fixClosure = (): void => {
    const closed = closeShape(shape);
    if (!closed.changed) {
      setMessage("自動で合わせられる寸法がありません");
      return;
    }
    applyShape(closed.shape);
    setMessage("閉じていない寸法を自動で合わせました");
  };

  /**
   * 選んだ角（頂点）を上下左右へ寸法で動かす。
   * 動かした結果、両隣の辺が縦横でなくなると斜め辺になる。
   */
  const moveSelectedCorner = (dx: number, dy: number): void => {
    if (selectedCorner === null) {
      setMessage("図の角（○印）を選んでから移動を押してください");
      return;
    }
    const result = moveCorner(shape, selectedCorner, dx, dy);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    applyShape(result.shape);
    setSelectedEdge(null);
    setMessage(
      `角を 横${formatNumber(dx, 2)}／縦${formatNumber(dy, 2)} 動かしました`,
    );
  };

  /**
   * 辺をクリックした位置で辺を分けて角を足す。
   * 位置はだいたいでよく、あとから寸法欄で直せる。
   */
  const splitEdgeAt = (
    id: string,
    start: { x: number; y: number },
    end: { x: number; y: number },
    event: React.MouseEvent<SVGGElement>,
  ): void => {
    const svg = event.currentTarget.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return;
    const origin = svg.createSVGPoint();
    origin.x = event.clientX;
    origin.y = event.clientY;
    const clicked = origin.matrixTransform(matrix.inverse());
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const span = Math.hypot(dx, dy);
    if (span < 0.02) {
      setMessage("この辺は短すぎて分けられません");
      return;
    }
    const ratio =
      ((clicked.x - start.x) * dx + (clicked.y - start.y) * dy) / (span * span);
    const first =
      Math.round(span * Math.min(Math.max(ratio, 0.05), 0.95) * 100) / 100;
    setAddCornerMode(false);
    setPrompt({
      kind: "split",
      edgeId: id,
      span: Math.round(span * 100) / 100,
      first: formatNumber(first, 2),
    });
  };

  /** 角を足す位置を小窓で確かめてから辺を分ける */
  const applySplit = (edgeId: string, first: number): void => {
    applyShape(splitEdge(shape, edgeId, first));
    setSelectedEdge(null);
    setSelectedCorner(null);
    setMessage(
      `辺を ${formatNumber(first, 2)} の位置で分けて角を足しました（寸法欄でも直せます）`,
    );
  };

  /** 選んだ辺の途中をコ型に凹ませる（いまの形と寸法は残す） */
  const addNotch = (
    across: number,
    along: number,
    edgeKind: EdgeKind,
  ): void => {
    const index = shape.edges.findIndex((item) => item.id === selectedEdge);
    if (index < 0) {
      setMessage("凹ませる辺を選んでからコ型を押してください");
      return;
    }
    const base = readyShape();
    const target = base.shape.edges[index];
    const vertical = isDiagonal(target.direction)
      ? Math.abs(target.dy ?? 0) > Math.abs(target.dx ?? 0)
      : target.direction === "N" || target.direction === "S";
    const result = notchEdge(
      base.shape,
      index,
      vertical ? along : across,
      vertical ? across : along,
    );
    if (result.error) {
      setMessage(result.error);
      return;
    }
    applyShape(applyKindToNewEdges(base.shape, result.shape, edgeKind));
    setSelectedEdge(null);
    setSelectedCorner(null);
    setMessage(
      `選んだ辺をコ型に凹ませました（足した辺は${KIND_LABEL[edgeKind]}）${base.note}`,
    );
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
        <button
          type="button"
          className={showFittings ? "on" : ""}
          onClick={() => setShowFittings(!showFittings)}
        >
          🚪 建具表
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
          </div>
          <div className="drawing-body">
            <div className="shape-tools">
              <button
                type="button"
                title="小窓で横・縦の寸法を入れて四角を作ります"
                onClick={() =>
                  setPrompt({
                    kind: "rect",
                    across: "4.00",
                    along: "3.00",
                    edgeKind: "wall",
                  })
                }
              >
                □ 四角
              </button>
              <button
                type="button"
                title="図の角（○印）を選んでから押すと、小窓で寸法を入れてその角を欠き取ります（何度でも使えます）"
                onClick={() => {
                  if (selectedCorner === null) {
                    setShowCorners(true);
                    setMessage(
                      "図の角（○印）をクリックで選んでから、もう一度L型を押してください",
                    );
                    return;
                  }
                  setPrompt({
                    kind: "cut",
                    across: cutAcross,
                    along: cutAlong,
                    edgeKind: promptEdgeKind,
                  });
                }}
              >
                L型を角に追加
              </button>
              <button
                type="button"
                title="辺を選んでから押すと、小窓で寸法を入れてその辺の中央を凹ませます（何度でも使えます）"
                onClick={() => {
                  if (!shape.edges.some((item) => item.id === selectedEdge)) {
                    setMessage("凹ませる辺を選んでからコ型を押してください");
                    return;
                  }
                  setPrompt({
                    kind: "notch",
                    across: cutAcross,
                    along: cutAlong,
                    edgeKind: promptEdgeKind,
                  });
                }}
              >
                コ型を辺に追加
              </button>
              <button
                type="button"
                className={addCornerMode ? "on" : ""}
                title="押してから図の辺をクリックすると、小窓で位置の寸法を確かめて辺を分け、角を追加します"
                onClick={() => {
                  const next = !addCornerMode;
                  setAddCornerMode(next);
                  setMessage(
                    next ? "角を足す位置で図の辺をクリックしてください" : "",
                  );
                }}
              >
                ○ 角を追加
              </button>
              <button
                type="button"
                disabled={shapePast.length === 0}
                title="図形の操作を1つ前に戻します"
                onClick={undoShape}
              >
                ↶ 戻る
              </button>
              <button
                type="button"
                disabled={shapeFuture.length === 0}
                title="戻した図形の操作を1つ先へ進めます"
                onClick={redoShape}
              >
                ↷ 進む
              </button>
              <span className="corner-move">
                <label title="角を動かす寸法（右がプラス・左がマイナス）">
                  横
                  <input
                    className="num cut"
                    value={moveX}
                    onChange={(e) => setMoveX(e.target.value)}
                  />
                </label>
                <label title="角を動かす寸法（下がプラス・上がマイナス）">
                  縦
                  <input
                    className="num cut"
                    value={moveY}
                    onChange={(e) => setMoveY(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={selectedCorner === null}
                  title="角（○印）を選んでから押すと、その角を左へ動かします"
                  onClick={() =>
                    moveSelectedCorner(-Math.abs(Number(moveX)), 0)
                  }
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={selectedCorner === null}
                  title="角（○印）を選んでから押すと、その角を右へ動かします"
                  onClick={() => moveSelectedCorner(Math.abs(Number(moveX)), 0)}
                >
                  →
                </button>
                <button
                  type="button"
                  disabled={selectedCorner === null}
                  title="角（○印）を選んでから押すと、その角を上へ動かします"
                  onClick={() =>
                    moveSelectedCorner(0, -Math.abs(Number(moveY)))
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={selectedCorner === null}
                  title="角（○印）を選んでから押すと、その角を下へ動かします"
                  onClick={() => moveSelectedCorner(0, Math.abs(Number(moveY)))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={selectedCorner === null}
                  title="横・縦の両方へ同時に動かします（斜めの辺になります）"
                  onClick={() =>
                    moveSelectedCorner(Number(moveX), Number(moveY))
                  }
                >
                  ╱ 斜めへ
                </button>
              </span>
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
              <button
                type="button"
                className={showCorners ? "on" : ""}
                title="角の○印を出す／消す（形が決まったら消せます）"
                onClick={() => {
                  if (showCorners) setSelectedCorner(null);
                  setShowCorners(!showCorners);
                }}
              >
                {showCorners ? "○角を消す" : "○角を出す"}
              </button>
            </div>
            <div className="canvas" ref={canvasRef}>
              <svg
                viewBox={view.box}
                style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
              >
                {solved.points.map((point, index) => {
                  const line = solved.edges[index];
                  const next =
                    solved.points[(index + 1) % solved.points.length];
                  const middle = {
                    x: (point.x + next.x) / 2,
                    y: (point.y + next.y) / 2,
                  };
                  const vertical = point.x === next.x;
                  const className = [
                    "edge",
                    line.kind,
                    selectedEdge === line.id ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  // 曲面壁は矢（ふくらみ）の分だけ膨らませて描く（マイナスは内側へ凹む）
                  const bulge = line.kind === "curve" ? (line.bulge ?? 0) : 0;
                  const span = Math.hypot(next.x - point.x, next.y - point.y);
                  const normal =
                    span === 0
                      ? { x: 0, y: 0 }
                      : {
                          x: -(next.y - point.y) / span,
                          y: (next.x - point.x) / span,
                        };
                  const control = {
                    x: middle.x - normal.x * bulge * 2,
                    y: middle.y - normal.y * bulge * 2,
                  };
                  return (
                    <g
                      key={line.id}
                      onClick={(event) => {
                        if (addCornerMode) {
                          splitEdgeAt(line.id, point, next, event);
                          return;
                        }
                        setSelectedEdge(line.id);
                        setSelectedCorner(null);
                        // 閉じていないときは、押した辺の寸法で合わせる
                        if (solved.error !== null) fitEdge(line.id);
                      }}
                    >
                      {/* 線は細いので、当たり判定用の太い線を重ねる */}
                      <line
                        x1={point.x}
                        y1={point.y}
                        x2={next.x}
                        y2={next.y}
                        className="edge-hit"
                        strokeWidth={cornerRadius * 1.6}
                      />
                      {bulge !== 0 ? (
                        <path
                          d={`M ${point.x} ${point.y} Q ${control.x} ${control.y} ${next.x} ${next.y}`}
                          className={className}
                          fill="none"
                        />
                      ) : (
                        <line
                          x1={point.x}
                          y1={point.y}
                          x2={next.x}
                          y2={next.y}
                          className={className}
                        />
                      )}
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
                {showCorners &&
                  solved.points.map((point, index) => (
                    <g
                      key={`corner-${solved.edges[index].id}`}
                      onClick={() => {
                        setSelectedCorner(index);
                        setSelectedEdge(null);
                        setAddCornerMode(false);
                      }}
                    >
                      {/* ○印は小さいので、まわりに広い当たり判定を置いて選びやすくする */}
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={cornerRadius * 2.6}
                        className="corner-hit"
                      />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={cornerRadius}
                        className={`corner ${selectedCorner === index ? "selected" : ""}`}
                      />
                    </g>
                  ))}
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
                    : "「□ 四角」から始めて寸法を入れ、角の○印や辺を選んでL型・コ型を足してください。"}
                </p>
              )}
              {extents && (
                <p className="extents">
                  X={formatNumber(extents.x, 2)}, Y={formatNumber(extents.y, 2)}
                </p>
              )}
            </div>
          </div>
          {solved.error && (
            <p className="error">
              {solved.error}
              <button type="button" onClick={fixClosure}>
                寸法を自動で合わせる
              </button>
              <button
                type="button"
                disabled={selectedEdge === null}
                onClick={() => selectedEdge !== null && fitEdge(selectedEdge)}
              >
                選んだ辺で合わせる
              </button>
              <span>（図の直したい辺をクリックすると、その辺で合わせます）</span>
            </p>
          )}
        </section>

        <section className="edges">
          <div className="section-bar">
            <span>寸法入力（空欄は自動算出）</span>
            <button
              type="button"
              title="形が閉じていない方向へ戻る向きで辺を足します（向きは後から直せます）"
              onClick={() =>
                applyShape({
                  edges: [...shape.edges, edge(nextEdgeDirection(shape), null)],
                })
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
                applyShape(
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
                applyShape({
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
                <th className="num" title="曲面壁のふくらみ（矢）">
                  Ｒ向き
                </th>
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
                        applyShape(
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
                    {isDiagonal(line.direction) ? (
                      <span className="diagonal">
                        <input
                          className="num"
                          defaultValue={formatNumber(line.dx ?? 0, 2)}
                          key={`${line.id}-dx-${line.dx ?? 0}`}
                          title="斜め辺の横移動（右がプラス）。計算式も入れられます"
                          onKeyDown={(e) =>
                            e.key === "Enter" && e.currentTarget.blur()
                          }
                          onBlur={(e) =>
                            applyShape(
                              updateEdge(shape, line.id, {
                                dx: textToNumber(e.target.value) ?? 0,
                              }),
                            )
                          }
                        />
                        <input
                          className="num"
                          defaultValue={formatNumber(line.dy ?? 0, 2)}
                          key={`${line.id}-dy-${line.dy ?? 0}`}
                          title="斜め辺の縦移動（下がプラス）。計算式も入れられます"
                          onKeyDown={(e) =>
                            e.key === "Enter" && e.currentTarget.blur()
                          }
                          onBlur={(e) =>
                            applyShape(
                              updateEdge(shape, line.id, {
                                dy: textToNumber(e.target.value) ?? 0,
                              }),
                            )
                          }
                        />
                      </span>
                    ) : (
                      <input
                        className="num"
                        defaultValue={
                          line.length === null
                            ? ""
                            : formatNumber(line.length, 2)
                        }
                        key={`${line.id}-${line.length ?? "auto"}`}
                        placeholder={
                          line.auto ? formatNumber(line.resolved, 2) : ""
                        }
                        title={
                          line.kind === "curve"
                            ? "曲面壁は弦（両端を結ぶ直線）の長さを入れます（計算式も入れられます）"
                            : "6.4+0.3 のような計算式も入れられます。空欄にすると、閉じた形になるように自動算出します"
                        }
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          showAnswer(e.currentTarget);
                          e.currentTarget.blur();
                        }}
                        onBlur={(e) => {
                          applyShape(
                            updateEdge(shape, line.id, {
                              length: textToNumber(e.target.value),
                            }),
                          );
                        }}
                      />
                    )}
                  </td>
                  <td>
                    {line.kind === "curve" ? (
                      <span className="curve">
                        <input
                          className="num"
                          defaultValue={
                            line.bulge === null || line.bulge === undefined
                              ? ""
                              : formatNumber(Math.abs(line.bulge), 2)
                          }
                          key={`${line.id}-bulge-${line.bulge ?? "none"}`}
                          title={`Ｒ向き（矢＝ふくらみ）を入れると弧長で数えます。いまの弧長 ${formatNumber(line.measured, 2)}`}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            showAnswer(e.currentTarget);
                            e.currentTarget.blur();
                          }}
                          onBlur={(e) => {
                            const value = textToNumber(e.target.value);
                            const size = value === null ? null : Math.abs(value);
                            applyShape(
                              updateEdge(shape, line.id, {
                                bulge:
                                  size === null
                                    ? null
                                    : (line.bulge ?? 0) < 0
                                      ? -size
                                      : size,
                              }),
                            );
                          }}
                        />
                        <select
                          value={(line.bulge ?? 0) < 0 ? "in" : "out"}
                          title="ふくらむ向き（外＝部屋の外側へ／内＝部屋の内側へ凹む）"
                          onChange={(e) => {
                            const size = Math.abs(line.bulge ?? 0);
                            applyShape(
                              updateEdge(shape, line.id, {
                                bulge:
                                  size === 0
                                    ? line.bulge
                                    : e.target.value === "in"
                                      ? -size
                                      : size,
                              }),
                            );
                          }}
                        >
                          <option value="out">外</option>
                          <option value="in">内</option>
                        </select>
                      </span>
                    ) : (
                      <span className="none">－</span>
                    )}
                  </td>
                  <td>
                    <select
                      value={line.kind}
                      onChange={(e) =>
                        applyShape(
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
                <th className="symbol">記号</th>
                <th className="num">数</th>
                <th className="num">W</th>
                <th className="num">H</th>
                <th className="num">腰高</th>
                <th className="num">面積</th>
                <th className="num">巾木減</th>
                <th className="num">横補強</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roomFittings.map((item, index) => {
                const resolved = resolvedFittings[index];
                const master = fittings.find(
                  (fitting) => fitting.symbol === item.symbol,
                );
                const computed = master ? computeFitting(master) : null;
                const unknown = master === undefined;
                return (
                  <tr key={item.id} className={unknown ? "unknown" : ""}>
                    <td className="symbol">
                      <input
                        list="room-fitting-symbols"
                        onMouseDown={selectWholeOnFirstClick}
                        onFocus={(e) => e.currentTarget.select()}
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
                        value={
                          fittingCountText[item.id] ?? String(item.multiplier)
                        }
                        onMouseDown={selectWholeOnFirstClick}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          const text = e.target.value;
                          setFittingCountText((current) => ({
                            ...current,
                            [item.id]: text,
                          }));
                          const value = Number(text);
                          if (text.trim() === "" || !Number.isFinite(value))
                            return;
                          setRoomFittings((current) =>
                            current.map((each) =>
                              each.id === item.id
                                ? { ...each, multiplier: value }
                                : each,
                            ),
                          );
                        }}
                        onBlur={() =>
                          setFittingCountText((current) => {
                            const next = { ...current };
                            delete next[item.id];
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        key={`w-${item.id}-${master?.width ?? ""}`}
                        defaultValue={formatNumber(master?.width ?? null, 2)}
                        onMouseDown={selectWholeOnFirstClick}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) =>
                          void writeFittingSize(item.symbol, {
                            width: textToNumber(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        key={`h-${item.id}-${master?.height ?? ""}`}
                        defaultValue={formatNumber(master?.height ?? null, 2)}
                        onMouseDown={selectWholeOnFirstClick}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) =>
                          void writeFittingSize(item.symbol, {
                            height: textToNumber(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        key={`s-${item.id}-${master?.sillHeight ?? ""}`}
                        defaultValue={formatNumber(
                          master?.sillHeight ?? null,
                          2,
                        )}
                        onMouseDown={selectWholeOnFirstClick}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) =>
                          void writeFittingSize(item.symbol, {
                            sill: textToNumber(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="num">
                      {formatNumber(resolved?.area ?? null, 2)}
                    </td>
                    <td className="num">
                      {formatNumber(resolved?.baseboardDeduction ?? null, 2)}
                    </td>
                    <td className="num">
                      {formatNumber(computed?.reinforcement ?? null, 2)}
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
              {/* いちばん下は空行。記号・数・寸法を直接書き込める（Enterで確定） */}
              <tr
                className="blank"
                // 空行の外へ出たときに確定する（欄を移る途中では確定しない）
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    void commitNewFitting();
                  }
                }}
              >
                <td className="symbol">
                  <input
                    list="room-fitting-symbols"
                    value={newFitting.symbol}
                    placeholder="記号"
                    onChange={(e) =>
                      setNewFitting({ ...newFitting, symbol: e.target.value })
                    }
                    onKeyDown={(e) =>
                      e.key === "Enter" && void commitNewFitting()
                    }
                  />
                </td>
                <td>
                  <input
                    className="num"
                    value={newFitting.count}
                    onMouseDown={selectWholeOnFirstClick}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) =>
                      setNewFitting({ ...newFitting, count: e.target.value })
                    }
                    onKeyDown={(e) =>
                      e.key === "Enter" && void commitNewFitting()
                    }
                  />
                </td>
                <td>
                  <input
                    className="num"
                    value={newFitting.width}
                    onChange={(e) =>
                      setNewFitting({ ...newFitting, width: e.target.value })
                    }
                    onKeyDown={(e) =>
                      e.key === "Enter" && void commitNewFitting()
                    }
                  />
                </td>
                <td>
                  <input
                    className="num"
                    value={newFitting.height}
                    onChange={(e) =>
                      setNewFitting({ ...newFitting, height: e.target.value })
                    }
                    onKeyDown={(e) =>
                      e.key === "Enter" && void commitNewFitting()
                    }
                  />
                </td>
                <td>
                  <input
                    className="num"
                    value={newFitting.sill}
                    onChange={(e) =>
                      setNewFitting({ ...newFitting, sill: e.target.value })
                    }
                    onKeyDown={(e) =>
                      e.key === "Enter" && void commitNewFitting()
                    }
                  />
                </td>
                <td className="num" />
                <td className="num" />
                <td className="num" />
                <td>
                  <button type="button" onClick={() => void commitNewFitting()}>
                    ＋
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <datalist id="room-fitting-symbols">
            {fittings.map((fitting) => (
              <option key={fitting.id} value={fitting.symbol} />
            ))}
          </datalist>
          <p className="note">
            いちばん下の空行に、記号・数・W・H・腰高をそのまま書き込めます（記号は一覧から選ぶこともできます）。建具表に無い記号は建具表へ登録し、W・H・腰高を打ち替えると建具表にも反映します。上段の建具は壁面積・巾木長さから自動で差し引きます。下段の計算式で使う建具記号（&lt;AW1&gt;
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

        {prompt && (
          <div
            className="shape-prompt-overlay"
            // 小窓を出している間は、後ろの欄を押しても入力が移らないようにする
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) e.preventDefault();
            }}
          >
            <div
              className="shape-prompt"
              ref={promptBoxRef}
              onKeyDown={(e) => {
                if (e.key === "Escape") setPrompt(null);
              }}
            >
              <div className="section-bar">
                <span>{PROMPT_TITLE[prompt.kind]}</span>
              </div>
              <div className="body">
                {prompt.kind === "split" ? (
                  <label>
                    角までの寸法
                    <input
                      className="num"
                      ref={promptInputRef}
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onMouseDown={selectWholeOnFirstClick}
                      value={prompt.first}
                      onChange={(e) =>
                        setPrompt({ ...prompt, first: e.target.value })
                      }
                      onKeyDown={(e) => e.key === "Enter" && submitPrompt()}
                    />
                    <span className="hint">
                      （辺の長さ {formatNumber(prompt.span, 2)}）
                    </span>
                  </label>
                ) : (
                  <>
                    <label>
                      横
                      <input
                        className="num"
                        ref={promptInputRef}
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        onMouseDown={selectWholeOnFirstClick}
                        value={prompt.across}
                        onChange={(e) =>
                          setPrompt({ ...prompt, across: e.target.value })
                        }
                        onKeyDown={(e) => e.key === "Enter" && submitPrompt()}
                      />
                    </label>
                    <label>
                      縦
                      <input
                        className="num"
                        onFocus={(e) => e.currentTarget.select()}
                        onMouseDown={selectWholeOnFirstClick}
                        value={prompt.along}
                        onChange={(e) =>
                          setPrompt({ ...prompt, along: e.target.value })
                        }
                        onKeyDown={(e) => e.key === "Enter" && submitPrompt()}
                      />
                    </label>
                    {prompt.kind !== "rect" && (
                      <label>
                        種別
                        <select
                          value={prompt.edgeKind}
                          onChange={(e) => {
                            const edgeKind = e.target.value as EdgeKind;
                            setPromptEdgeKind(edgeKind);
                            setPrompt({ ...prompt, edgeKind });
                          }}
                          onKeyDown={(e) => e.key === "Enter" && submitPrompt()}
                        >
                          {(Object.keys(KIND_LABEL) as EdgeKind[]).map(
                            (key) => (
                              <option key={key} value={key}>
                                {KIND_LABEL[key]}
                              </option>
                            ),
                          )}
                        </select>
                        <span className="hint">（足す辺の種別）</span>
                      </label>
                    )}
                  </>
                )}
                <button type="button" onClick={submitPrompt}>
                  OK
                </button>
                <button type="button" onClick={() => setPrompt(null)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {showFittings && (
          <section className="fittings popup">
            <div className="section-bar">
              <span>
                建具表（クリックで計算式へ。部位に合わせて面積／巾木減／横補強を採ります＝建具表画面の「部位ごとの採用値」）
              </span>
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
              <button type="button" onClick={() => setShowFittings(false)}>
                ✕ 閉じる
              </button>
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
                        {formatNumber(computed.baseboardDeduction, 2)}
                      </td>
                      <td
                        className="num"
                        title="軸組の開口部横補強（自動計算には使いません）"
                      >
                        {formatNumber(computed.reinforcement, 2)}
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
        windowTitle={`部屋計算書　${project.managementNo} ${roomName || "（部屋名なし）"}`}
      />

      {showCheck && (
        <div className="check-window">
          <div className="section-bar">
            <span>
              チェック表（上段の自動計算と下段の計算式合計／材種区分「仕上」のみ）
            </span>
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
    </div>
  );
}
