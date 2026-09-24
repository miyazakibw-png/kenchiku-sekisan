import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement } from "react";
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
  defaultFrameKinds,
  EMPTY_FRAME_TRACE,
  findSharedWalls,
  frameLineAttribute,
  frameQuantities,
  frameSymbols,
  linePartVariables,
  isPickedUp,
  nearMissWalls,
  reinforcementKind,
  reinforcementLength,
  snapPlacement,
  type FrameFitting,
  type FrameKind,
  type FrameLineAttribute,
  type FrameManualLine,
  type FramePlacement,
  type FrameTrace,
  parseFrameTraces,
} from "../../../../core/frame/frame";
import {
  floorArea,
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
import { bareSymbolVariables } from "../../../../core/aggregate/variables";
import {
  DEFAULT_FITTING_PART_VALUES,
  fittingKindForPart,
  fittingSuffix,
  fittingSymbolForPart,
  type FittingPartValue,
} from "../../../../core/fittings/partValue";
import RoomCalcSheet, { type CalcFocus } from "./RoomCalcSheet";
import { pdfPageImage } from "./pdfPage";
import {
  loadImageSize,
  spotBesideBoxes,
  type UnderlayBox,
} from "./useUnderlay";
import CalcPrintSheet from "../print/CalcPrintSheet";
import { formatNumber } from "./estimateRows";
import "./RoomSheetPage.css";
import "./FrameSheetPage.css";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import { ask } from "../common/askDialog";

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
  /** 置ける部屋の名前を押したとき、その部屋の計算書を開く */
  onOpenRoomSheet?: (estimateRowId: number) => void;
  /** 施工高さを直したときに部位別入力表の行（天井高さ）へも伝える */
  onWorkHeightChange?: (height: number | null) => void;
  /** 印刷書式（A3横）で出す。入力はせず、保存もしない */
  printMode?: boolean;
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

/** 吸着の幅（mm）。パソコンに覚えておいて次も同じ幅で使う */
const SNAP_KEY = "frameSnapMm";
const DEFAULT_SNAP_MM = 300;

function savedSnapMm(): number {
  try {
    const value = Number(window.localStorage.getItem(SNAP_KEY));
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SNAP_MM;
  } catch {
    return DEFAULT_SNAP_MM;
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

/** ↶戻る・↷進むで戻す図の中身（置いた部屋・引いた線・線の設定・建具・下敷き図面・軸組種類をまとめて1つにする） */
interface FrameDiagramContent {
  placements: FramePlacement[];
  manualLines: FrameManualLine[];
  attributes: Record<string, FrameLineAttribute>;
  frameFittings: {
    id: string;
    symbol: string;
    multiplier: number;
    lineId: string | null;
  }[];
  traces: FrameTrace[];
  /** 動かす・合わせる・外すの対象にしている図面の番号 */
  activeTrace: number;
  /** 「🔗 まとめて動かす」がONか */
  traceLocked: boolean;
  kinds: FrameKind[];
}

export default function FrameSheetPage({
  project,
  row,
  roomName,
  onBack,
  onOpenRoomSheet,
  onWorkHeightChange,
  printMode = false,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<FrameSheet | null>(null);
  // 印刷は図と拾った線・数量根拠まで出したいので「確認」の並びで出す
  const [mode, setMode] = useState<FrameMode>(printMode ? "check" : "layout");
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
  /** 下敷きに置いてある図面画像（なぞって線を引く。複数枚を重ねられる） */
  const [traces, setTraces] = useState<FrameTrace[]>([]);
  /** 動かす・合わせる・外すの対象にしている図面の番号 */
  const [activeTrace, setActiveTrace] = useState(0);
  /** 「🔗 まとめて動かす」：ONの間は「✥ 図面を動かす」で全部の図面が一緒に動く（重ね合わせたあと1枚の絵として固定する） */
  const [traceLocked, setTraceLocked] = useState(false);
  /** 図面画像の大きさ（画素。画像データごとに覚える） */
  const [traceSizes, setTraceSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  /** いま選んでいる図面（無ければ空）。縮尺合わせ・濃さ・外すはこの1枚に効く */
  const trace =
    traces[Math.min(activeTrace, Math.max(traces.length - 1, 0))] ??
    EMPTY_FRAME_TRACE;
  /** 選んでいる図面の大きさ（画素。読み込むまでは仮の大きさ） */
  const traceSize = traceSizes[trace.image] ?? { width: 1000, height: 700 };
  /** 選んだ図面の番号をドラッグ中の古いcallbackからも見るため参照で持つ */
  const activeTraceRef = useRef(activeTrace);
  activeTraceRef.current = activeTrace;
  /** いま選んでいる図面だけを書き替える（image="" にするとその図面が外れる） */
  const setTrace = useCallback(
    (next: FrameTrace | ((current: FrameTrace) => FrameTrace)) => {
      setTraces((current) => {
        const index = Math.min(activeTraceRef.current, current.length - 1);
        const resolved =
          typeof next === "function"
            ? next(current[index] ?? EMPTY_FRAME_TRACE)
            : next;
        if (index < 0) return resolved.image === "" ? current : [resolved];
        return current
          .map((item, at) => (at === index ? resolved : item))
          .filter((item) => item.image !== "");
      });
    },
    [],
  );
  // 図面を外して枚数が減ったら、選んだ番号を最後の図面に合わせる
  useEffect(() => {
    if (activeTrace > traces.length - 1)
      setActiveTrace(Math.max(traces.length - 1, 0));
  }, [activeTrace, traces.length]);
  /** 図面の使い方：off＝ふつう／scale＝縮尺合わせ／move＝図面を動かす */
  const [traceMode, setTraceMode] = useState<"off" | "scale" | "move">("off");
  /** 縮尺合わせで押した2点（図の座標m） */
  const [scalePoints, setScalePoints] = useState<{ x: number; y: number }[]>(
    [],
  );
  const [scaleText, setScaleText] = useState("3.640");
  const [pageText, setPageText] = useState("1");
  /** 軸組種類（線の色分け。たて・よこをまとめる単位） */
  const [kinds, setKinds] = useState<FrameKind[]>(defaultFrameKinds);
  /** これから引く線に付ける軸組種類 */
  const [drawKindId, setDrawKindId] = useState("");
  /** まとめて色を付けるために選んだ線 */
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  /** 軸組種類の名前・色を直す表を出す */
  const [showKinds, setShowKinds] = useState(false);
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
  /** レイアウトの上から線を引く（すき間をつなぐ） */
  const [drawing, setDrawing] = useState(false);
  /** 自分で引いた線だけを見る（部屋の図は薄くする） */
  const [manualOnly, setManualOnly] = useState(false);
  const [zoom, setZoom] = useState(1);
  /** 拡大したときに図全体をつまんで動かす */
  const [panMode, setPanMode] = useState(false);
  /** 図の表示範囲に図面画像も入れるか（切ると引いた線に合わせる） */
  const [fitTrace, setFitTrace] = useState(false);
  /** 建物レイアウトを画面いっぱいの別窓で開く */
  const [expanded, setExpanded] = useState(false);
  /** 大きく開いたときに「置ける部屋」の表を出すか（消すと図を広く使える） */
  const [showRoomList, setShowRoomList] = useState(false);
  /** 吸着の幅（mm）。部屋ごとの寸法の食い違いをここで調整する */
  const [snapMm, setSnapMm] = useState(savedSnapMm);
  const [snapText, setSnapText] = useState(() => String(savedSnapMm()));
  const [message, setMessage] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** 図ぜんたいをつまんで動かしているときの位置 */
  const panDragRef = useRef<{
    clientX: number;
    clientY: number;
    left: number;
    top: number;
  } | null>(null);
  /** つまんで実際に動かしたか（ドラッグ後のクリックで点を打たないための印） */
  const panMovedRef = useRef(false);
  /** 図の枠（拡大したときはこの中をスクロールする） */
  const canvasRef = useRef<HTMLDivElement | null>(null);
  /** 図面画像をつまんで動かしているときの位置 */
  const traceDragRef = useRef<{
    clientX: number;
    clientY: number;
    /** つかんだ図面の番号（まとめて動かすでないとき、この1枚だけ動く） */
    index: number;
    /** 動かし始めの全図面（ここからずらすので加速しない。まとめて動かすの基準にもなる） */
    all: FrameTrace[];
  } | null>(null);
  const dragRef = useRef<{
    placementId: string;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);

  /** 部位別入力表の行の天井高さ（読み込みのときだけ見る） */
  const rowHeightRef = useRef(row.ceilingHeight);
  rowHeightRef.current = row.ceilingHeight;

  // 画面を閉じる・ウィンドウを閉じるときは、直した内容を自動で保存する
  const { markSaved } = useSaveOnLeave(
    {
      placements,
      manualLines,
      attributes,
      frameFittings,
      lower,
      workHeight,
      traces,
      activeTrace,
      traceLocked,
      kinds,
    },
    () => save(),
  );

  /** 図の履歴（↶戻る・↷進む用） */
  const diagramHistory = useUndoRedo<FrameDiagramContent>();
  const diagramRef = useRef<FrameDiagramContent>({
    placements: [],
    manualLines: [],
    attributes: {},
    frameFittings: [],
    traces: [],
    activeTrace: 0,
    traceLocked: false,
    kinds: defaultFrameKinds(),
  });
  useEffect(() => {
    diagramRef.current = {
      placements,
      manualLines,
      attributes,
      frameFittings,
      traces,
      activeTrace,
      traceLocked,
      kinds,
    };
  }, [
    placements,
    manualLines,
    attributes,
    frameFittings,
    traces,
    activeTrace,
    traceLocked,
    kinds,
  ]);

  /** 図を直す直前に、今の形を履歴へ積む */
  const pushDiagram = useCallback((): void => {
    diagramHistory.push(diagramRef.current);
  }, [diagramHistory]);

  /** 図を1つ前の形に戻す */
  const undoDiagram = (): void => {
    const previous = diagramHistory.undo(diagramRef.current);
    if (previous === null) {
      setMessage("戻せる操作がありません");
      return;
    }
    panDragRef.current = null;
    traceDragRef.current = null;
    dragRef.current = null;
    endRef.current = null;
    setDrawStart(null);
    setScalePoints([]);
    setHeldView(null);
    setPlacements(previous.placements);
    setManualLines(previous.manualLines);
    setAttributes(previous.attributes);
    setFrameFittings(previous.frameFittings);
    setTraces(previous.traces);
    setActiveTrace(previous.activeTrace);
    setTraceLocked(previous.traceLocked);
    setKinds(previous.kinds);
    setMessage("図を1つ前に戻しました（保存すると確定します）");
  };

  /** 戻した図を1つ先へ進める */
  const redoDiagram = (): void => {
    const next = diagramHistory.redo(diagramRef.current);
    if (next === null) {
      setMessage("進める操作がありません");
      return;
    }
    panDragRef.current = null;
    traceDragRef.current = null;
    dragRef.current = null;
    endRef.current = null;
    setDrawStart(null);
    setScalePoints([]);
    setHeldView(null);
    setPlacements(next.placements);
    setManualLines(next.manualLines);
    setAttributes(next.attributes);
    setFrameFittings(next.frameFittings);
    setTraces(next.traces);
    setActiveTrace(next.activeTrace);
    setTraceLocked(next.traceLocked);
    setKinds(next.kinds);
    setMessage("図を1つ先へ進めました（保存すると確定します）");
  };

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getFrameSheet(row.id as number);
      // 施工高さは部位別入力表の天井高さを優先（部位別入力表で直した高さを引き継ぐ）
      const height = rowHeightRef.current ?? loaded.workHeight;
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
      setWorkHeight(height);
      const loadedTrace = parseFrameTraces(loaded.traceJson);
      const loadedKinds = parseJson<FrameKind[]>(loaded.kindsJson, []);
      setTraces(loadedTrace.traces);
      setActiveTrace(loadedTrace.active);
      setTraceLocked(loadedTrace.locked);
      setKinds(loadedKinds.length > 0 ? loadedKinds : defaultFrameKinds());
      markSaved({
        placements: parseJson<FramePlacement[]>(loaded.layoutJson, []),
        manualLines: parseJson<FrameManualLine[]>(loaded.linesJson, []),
        attributes: parseJson<Record<string, FrameLineAttribute>>(
          loaded.attributesJson,
          {},
        ),
        frameFittings: parseJson<
          {
            id: string;
            symbol: string;
            multiplier: number;
            lineId: string | null;
          }[]
        >(loaded.fittingsJson, []),
        lower: trimEmptySets(parseJson<CalcSet[]>(loaded.lowerJson, [])),
        // 保存してある高さと違うときは、閉じるときに直した高さで保存させる
        workHeight: loaded.workHeight,
        traces: loadedTrace.traces,
        activeTrace: loadedTrace.active,
        traceLocked: loadedTrace.locked,
        kinds: loadedKinds.length > 0 ? loadedKinds : defaultFrameKinds(),
      });
      diagramHistory.clear();
      setRooms(await window.sekisan.listFrameRooms(project.id));
      setFittings(await window.sekisan.listFittings(project.id));
      setPartValues(await window.sekisan.getFittingPartValues());
      setOptions(await window.sekisan.getMasterOptions(project.id));
    })();
  }, [markSaved, project.id, row.id]);

  /** 施工高さを直す（部位別入力表の天井高さへも伝える） */
  const changeWorkHeight = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      const value = trimmed === "" ? null : Number(trimmed);
      if (value !== null && Number.isNaN(value)) return;
      setWorkHeight(value);
      onWorkHeightChange?.(value);
    },
    [onWorkHeightChange],
  );

  // 図で選んだ「引いた線」は Delete（BackSpace）で消せるようにする
  useEffect(() => {
    if (selectedLineId === null) return;
    if (!manualLines.some((line) => line.id === selectedLineId)) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable === true) return;
      event.preventDefault();
      pushDiagram();
      setManualLines((current) =>
        current.filter((line) => line.id !== selectedLineId),
      );
      setSelectedLineId(null);
      setDrawStart(null);
      setMessage("引いた線を消しました");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manualLines, selectedLineId]);

  // 線を引く途中の1点目・縮尺合わせの点・選んだ線は Esc で取り消す
  useEffect(() => {
    if (
      drawStart === null &&
      scalePoints.length === 0 &&
      selectedLineId === null
    )
      return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setDrawStart(null);
      setScalePoints([]);
      setSelectedLineId(null);
      setMessage("取り消しました（選んだ線の丸印も外しました）");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawStart, scalePoints, selectedLineId]);

  // 別窓で開いているときは Esc で閉じられるようにする
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

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
    () => frameSymbols(quantities, workHeight, kinds),
    [kinds, quantities, workHeight],
  );
  const shared = useMemo(() => findSharedWalls(lines), [lines]);
  /** 寸法の基準は面積が最大の部屋とするため、配置ごとの面積を渡す */
  const placementAreas = useMemo(() => {
    const areas = new Map<string, number>();
    placements.forEach((placement) => {
      const solved = shapes.get(placement.estimateRowId);
      if (!solved) return;
      areas.set(placement.id, floorArea(solved) ?? 0);
    });
    return areas;
  }, [placements, shapes]);
  /** 同じ壁のはずなのに少しずれている組（部屋ごとの寸法の食い違い） */
  const gaps = useMemo(
    () => nearMissWalls(lines, snapMm / 1000, placementAreas),
    [lines, placementAreas, snapMm],
  );
  /** 基準（最大の部屋）に合わない側を赤く出す */
  const gapLineIds = useMemo(() => new Set(gaps.map((gap) => gap.bId)), [gaps]);

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

  /** 置いてある図面の大きさ（m）。traces と同じ並び、画像の無い所は null */
  const traceBoxes = useMemo<(UnderlayBox | null)[]>(
    () =>
      traces.map((item) => {
        const size = traceSizes[item.image];
        if (item.image === "" || item.metersPerPixel <= 0 || size === undefined)
          return null;
        return {
          x: item.x,
          y: item.y,
          width: size.width * item.metersPerPixel,
          height: size.height * item.metersPerPixel,
        };
      }),
    [traceSizes, traces],
  );
  /** いま選んでいる図面を置く大きさ（m） */
  const traceBox =
    traceBoxes[Math.min(activeTrace, Math.max(traces.length - 1, 0))] ?? null;

  /** 図面だけを大きく／小さくする（真ん中を動かさず、引いた線はそのまま） */
  const resizeTrace = useCallback(
    (factor: number) => {
      if (traceBox === null) return;
      pushDiagram();
      setTrace((current) => ({
        ...current,
        metersPerPixel: current.metersPerPixel * factor,
        x: current.x + (traceBox.width * (1 - factor)) / 2,
        y: current.y + (traceBox.height * (1 - factor)) / 2,
      }));
    },
    [pushDiagram, traceBox],
  );

  const points = useMemo(
    () => [
      ...lines.flatMap((line) => [
        { x: line.x1, y: line.y1 },
        { x: line.x2, y: line.y2 },
      ]),
      ...(!fitTrace && lines.length > 0
        ? []
        : traceBoxes
            .filter((box): box is UnderlayBox => box !== null)
            .flatMap((box) => [
              { x: box.x, y: box.y },
              { x: box.x + box.width, y: box.y + box.height },
            ])),
    ],
    [fitTrace, lines, traceBoxes],
  );
  const autoView = useMemo(() => viewBox(points), [points]);
  /** 表示範囲を止めているとき（線を引く間は図面が動かないようにする） */
  const [heldView, setHeldView] = useState<{
    box: string;
    span: number;
  } | null>(null);
  const baseView = heldView ?? autoView;
  // 図面の大きさ・縮尺が変わったら、いったん範囲を合わせ直す
  useEffect(() => {
    setHeldView(null);
  }, [trace.image, trace.metersPerPixel, traceSize.width, traceSize.height]);
  useEffect(() => {
    if (traceBox === null || heldView !== null) return;
    setHeldView(autoView);
  }, [autoView, heldView, traceBox]);
  const view = baseView;

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
    // <X1> は かっこ無しの X1 でも書ける
    return { ...bareSymbolVariables(values), ...values };
  }, [fittings, symbols, workHeight]);

  /** <AW1> だけのときは、そのセットの部位に合った数値を採る */
  const partFittingVariables = useCallback(
    (set: CalcSet): Record<string, number> => {
      const kind = fittingKindForPart(set.partName, partValues, set.partNumber);
      const suffix = fittingSuffix(kind);
      // 部位が補強のセットでは <X1> などで補強長さを採る
      const values: Record<string, number> = linePartVariables(
        symbols,
        set.partName,
      );
      if (suffix === "") return values;
      fittings.forEach((fitting) => {
        const value = calcVariables[`<${fitting.symbol}${suffix}>`];
        if (value !== undefined) values[`<${fitting.symbol}>`] = value;
      });
      return values;
    },
    [calcVariables, fittings, partValues, symbols],
  );

  const calcResult = useMemo(
    () => evaluateCalcSheet(lower, calcVariables, partFittingVariables),
    [calcVariables, lower, partFittingVariables],
  );

  const save = useCallback(async () => {
    // 印刷は見るだけなので、直したことにしない
    if (!sheet || printMode) return;
    // 入力の無いセット明細は保存時に取り除く（画面からも消す）
    const trimmed = trimEmptySets(lower);
    setLower(trimmed);
    markSaved({
      placements,
      manualLines,
      attributes,
      frameFittings,
      lower: trimmed,
      workHeight,
      traces,
      activeTrace,
      traceLocked,
      kinds,
    });
    const saved = await window.sekisan.saveFrameSheet({
      id: sheet.id,
      layoutJson: JSON.stringify(placements),
      linesJson: JSON.stringify(manualLines),
      attributesJson: JSON.stringify(attributes),
      fittingsJson: JSON.stringify(frameFittings),
      lowerJson: JSON.stringify(trimmed),
      workHeight,
      traceJson: JSON.stringify({
        traces,
        active: Math.min(activeTrace, Math.max(traces.length - 1, 0)),
        locked: traceLocked,
      }),
      kindsJson: JSON.stringify(kinds),
      note: sheet.note,
    });
    setSheet(saved);
    setMessage("保存しました");
  }, [
    attributes,
    frameFittings,
    kinds,
    lower,
    manualLines,
    markSaved,
    placements,
    printMode,
    sheet,
    traces,
    activeTrace,
    traceLocked,
    workHeight,
  ]);

  const updateAttribute = useCallback(
    (lineId: string, patch: Partial<FrameLineAttribute>, quiet = false) => {
      if (!quiet) pushDiagram();
      setAttributes((current) => ({
        ...current,
        [lineId]: { ...frameLineAttribute(current[lineId]), ...patch },
      }));
    },
    [pushDiagram],
  );

  // 図面画像の大きさ（画素）を測る（置いてある図面を全部）
  useEffect(() => {
    traces.forEach((item) => {
      if (item.image === "" || traceSizes[item.image] !== undefined) return;
      const image = new Image();
      image.onload = () =>
        setTraceSizes((current) =>
          current[item.image] !== undefined
            ? current
            : {
                ...current,
                [item.image]: {
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                },
              },
        );
      image.src = item.image;
    });
  }, [traceSizes, traces]);

  /** 取り込んだ図面を足す（縮尺はいったん仮に決めて、あとで合わせる）。2枚目以降は今ある図面の右横に置く */
  const putTraceImage = useCallback(
    (dataUrl: string) => {
      pushDiagram();
      setHeldView(null);
      setFitTrace(true);
      const spot = spotBesideBoxes(traceBoxes);
      setTraces((current) => [
        ...current,
        {
          image: dataUrl,
          metersPerPixel: 0.01,
          x: spot.x,
          y: spot.y,
          opacity: 0.75,
        },
      ]);
      setActiveTrace(traces.length);
      setScalePoints([]);
      setTraceMode("scale");
      setPanMode(false);
      // 縮尺合わせの間は線を引けないので、線引きは止めておく
      setDrawing(false);
      setDrawStart(null);
      setMessage(
        "図面の中で長さの分かる所を2回クリックし、その実寸（m）を入れてください",
      );
    },
    [pushDiagram, traceBoxes, traces.length],
  );

  /** クリップボードの画像（Shift+Windows+S の切り取り）を図面にする */
  const pasteTraceImage = useCallback(async () => {
    const fromApp = await window.sekisan.readClipboardImage();
    if (fromApp.image !== "") {
      putTraceImage(fromApp.image);
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((entry) => entry.startsWith("image/"));
        if (type === undefined) continue;
        const blob = await item.getType(type);
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("画像を読めませんでした"));
          reader.readAsDataURL(blob);
        });
        putTraceImage(dataUrl);
        return;
      }
    } catch {
      // クリップボードを読めないときは知らせるだけにする
    }
    setMessage(`クリップボードに画像がありません（中身：${fromApp.note}）`);
  }, [putTraceImage]);

  /** PDF・画像のファイルを選んで図面にする（まとめて複数選ぶと横に並べて置く） */
  const openTraceFiles = useCallback(async () => {
    const page = Number(pageText);
    setMessage("ファイルを読んでいます…");
    const got = await window.sekisan.openDrawingFiles(page > 0 ? page : 1);
    if (got.items.length === 0) {
      setMessage(got.note === "" ? "取り込みをやめました" : got.note);
      return;
    }
    pushDiagram();
    setHeldView(null);
    setFitTrace(true);
    // 縮尺合わせの間は線を引けないので、線引きは止めておく
    setDrawing(false);
    setDrawStart(null);
    let cursor = spotBesideBoxes(traceBoxes);
    let placed = 0;
    for (const item of got.items) {
      let dataUrl = item.image;
      if (item.pdf !== "") {
        const made = await pdfPageImage(item.pdf, page > 0 ? page : 1);
        dataUrl = made.image;
        if (dataUrl === "") {
          setMessage("PDFを画像にできませんでした");
          continue;
        }
      }
      if (dataUrl === "") continue;
      // 先に大きさを読み、次の図面をこの図面の右横へずらして置く
      const size = await loadImageSize(dataUrl);
      if (size !== null)
        setTraceSizes((current) =>
          current[dataUrl] !== undefined
            ? current
            : { ...current, [dataUrl]: size },
        );
      setTraces((current) => [
        ...current,
        {
          image: dataUrl,
          metersPerPixel: 0.01,
          x: cursor.x,
          y: cursor.y,
          opacity: 0.75,
        },
      ]);
      cursor = {
        x: cursor.x + (size !== null ? size.width * 0.01 : 10) + 0.5,
        y: cursor.y,
      };
      placed += 1;
    }
    if (placed === 0) return;
    setActiveTrace(traces.length + placed - 1);
    setScalePoints([]);
    setTraceMode("scale");
    setPanMode(false);
    setMessage(
      `${placed}枚の図面を置きました。図面の中で長さの分かる所を2回クリックし、その実寸（m）を入れてください`,
    );
  }, [pageText, pushDiagram, traceBoxes, traces.length]);

  /** 縮尺合わせの前の形（「↶ 縮尺を戻す」で元に戻せるように取っておく） */
  const [scaleUndo, setScaleUndo] = useState<
    { traces: FrameTrace[]; active: number; lines: FrameManualLine[] }[]
  >([]);

  /** 縮尺合わせ：2点の間、または選んだ線の実寸を入れて、図面と引いた線を伸び縮みさせる */
  const applyScale = useCallback(() => {
    const meters = Number(scaleText);
    if (!Number.isFinite(meters) || meters <= 0) {
      setMessage("実寸（m）を入れてください");
      return;
    }
    const chosen = manualLines.find((line) => line.id === selectedLineId);
    const now =
      scalePoints.length >= 2
        ? Math.hypot(
            scalePoints[1].x - scalePoints[0].x,
            scalePoints[1].y - scalePoints[0].y,
          )
        : chosen === undefined
          ? 0
          : Math.hypot(chosen.x2 - chosen.x1, chosen.y2 - chosen.y1);
    if (now < 1e-6) {
      setMessage("図面の上で2点をクリックするか、直す線を選んでください");
      return;
    }
    const factor = meters / now;
    pushDiagram();
    setScaleUndo((current) => [
      ...current.slice(-9),
      {
        traces,
        active: Math.min(activeTrace, Math.max(traces.length - 1, 0)),
        lines: manualLines,
      },
    ]);
    setTrace((current) => ({
      ...current,
      metersPerPixel: current.metersPerPixel * factor,
      x: current.x * factor,
      y: current.y * factor,
    }));
    // 引いた線も一緒に伸び縮みさせる（図面とずれないようにする）
    setManualLines((current) =>
      current.map((line) => ({
        ...line,
        x1: line.x1 * factor,
        y1: line.y1 * factor,
        x2: line.x2 * factor,
        y2: line.y2 * factor,
      })),
    );
    setScalePoints([]);
    setHeldView(null);
    setTraceMode("off");
    setMessage("縮尺を合わせました（図面も引いた線も一緒に伸び縮みしました）");
  }, [
    activeTrace,
    manualLines,
    pushDiagram,
    scalePoints,
    scaleText,
    selectedLineId,
    traces,
  ]);

  /** 「📍 近くへ戻す」で図面を置き直す場所（置いた部屋・引いた線の左上の角。無ければ原点） */
  const traceHomeSpot = useMemo(() => {
    const xs = [
      ...placements.map((placement) => placement.x),
      ...manualLines.flatMap((line) => [line.x1, line.x2]),
    ];
    const ys = [
      ...placements.map((placement) => placement.y),
      ...manualLines.flatMap((line) => [line.y1, line.y2]),
    ];
    if (xs.length === 0) return { x: 0, y: 0 };
    return { x: Math.min(...xs), y: Math.min(...ys) };
  }, [manualLines, placements]);

  /** 選んでいる図面をいちばん上に出す（後に置いた図面が上に重なるので、いちばん後ろへ移す） */
  const bringTraceFront = useCallback(() => {
    const index = Math.min(activeTraceRef.current, traces.length - 1);
    const picked = traces[index];
    if (picked === undefined || traces.length < 2) return;
    pushDiagram();
    setTraces([...traces.filter((_, at) => at !== index), picked]);
    setActiveTrace(traces.length - 1);
    setMessage("選んでいる図面をいちばん上に出しました");
  }, [pushDiagram, traces]);

  /** 選んでいる図面を線・部屋の近くへ戻す（まとめて動かす中は全員まとめて戻る） */
  const goHomeTrace = useCallback(() => {
    const index = Math.min(activeTraceRef.current, traces.length - 1);
    const picked = traces[index];
    if (picked === undefined) return;
    pushDiagram();
    if (traceLocked && traces.length > 1) {
      const dx = traceHomeSpot.x - picked.x;
      const dy = traceHomeSpot.y - picked.y;
      setTraces(
        traces.map((item) =>
          item.image === ""
            ? item
            : { ...item, x: item.x + dx, y: item.y + dy },
        ),
      );
    } else {
      setTrace({ ...picked, x: traceHomeSpot.x, y: traceHomeSpot.y });
    }
    setMessage("図面を図形の近くへ戻しました");
  }, [pushDiagram, setTrace, traceHomeSpot, traceLocked, traces]);

  /** 縮尺合わせを1回分もとに戻す */
  const undoScale = useCallback(() => {
    setScaleUndo((current) => {
      const last = current[current.length - 1];
      if (last === undefined) return current;
      setTraces(last.traces);
      setActiveTrace(
        Math.min(last.active, Math.max(last.traces.length - 1, 0)),
      );
      setManualLines(last.lines);
      setHeldView(null);
      setMessage("縮尺合わせを元に戻しました");
      return current.slice(0, -1);
    });
  }, []);

  const kindOf = useCallback(
    (kindId: string): FrameKind | undefined =>
      kinds.find((kind) => kind.id === kindId),
    [kinds],
  );

  /** 引いた線を軸組種類でまとめた表（たて・よこは1つの表に入れる） */
  const kindGroups = useMemo(() => {
    const manual = quantities.lines.filter(
      (result) => result.line.source === "manual",
    );
    const groups = kinds
      .map((kind, no) => ({
        id: kind.id,
        name: kind.name,
        color: kind.color,
        /** 計算式の記号（種類1＝WS1…種類10＝WS10） */
        symbol: `WS${no + 1}`,
        results: manual.filter((result) => result.line.kindId === kind.id),
      }))
      .filter((group) => group.results.length > 0);
    const none = manual.filter(
      (result) => !kinds.some((kind) => kind.id === result.line.kindId),
    );
    if (none.length > 0)
      groups.push({
        id: "",
        name: "種類なし",
        color: "#334155",
        symbol: "",
        results: none,
      });
    return groups;
  }, [kinds, quantities.lines]);

  /** 選んだ線にまとめて軸組種類を付ける */
  const applyKindToChecked = useCallback(
    (kindId: string) => {
      if (checkedIds.length === 0) {
        setMessage("先に表の左のチェックで線を選んでください");
        return;
      }
      pushDiagram();
      checkedIds.forEach((id) => updateAttribute(id, { kindId }, true));
      setMessage(
        `${checkedIds.length}本を「${kindOf(kindId)?.name ?? "種類なし"}」にしました`,
      );
      setCheckedIds([]);
    },
    [checkedIds, kindOf, pushDiagram, updateAttribute],
  );

  /** レイアウトへ部屋を置く（重ならないように少しずらして置く） */
  const addPlacement = useCallback(
    (room: FrameRoomOption) => {
      const offset = placements.length * 0.5;
      pushDiagram();
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
    [placements.length, pushDiagram],
  );

  /** 画面の位置を図の座標（m）に直す */
  const toModel = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height) || 1;
      // 図は正方形の枠で真ん中に出るので、上下・左右の余白の分をひく
      const padX = (rect.width - size) / 2;
      const padY = (rect.height - size) / 2;
      const [left, top] = view.box.split(" ").map(Number);
      return {
        x: left + ((clientX - rect.left - padX) / size) * view.span,
        y: top + ((clientY - rect.top - padY) / size) * view.span,
      };
    },
    [view.box, view.span],
  );

  /** クリックした所を、近くの角（点）や壁の位置へ寄せる */
  const snapPoint = useCallback(
    (
      point: { x: number; y: number },
      exceptLineId: string | null = null,
    ): { x: number; y: number } => {
      const tolerance = snapMm / 1000;
      const corners = lines
        .filter((line) => line.id !== exceptLineId)
        .flatMap((line) => [
          { x: line.x1, y: line.y1 },
          { x: line.x2, y: line.y2 },
        ]);
      let best: { x: number; y: number } | null = null;
      let bestDistance = tolerance;
      corners.forEach((corner) => {
        const distance = Math.hypot(corner.x - point.x, corner.y - point.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = corner;
        }
      });
      if (best !== null) return best;
      // 角に届かないときは、たて・よこそれぞれ近い壁の位置に合わせる
      const near = (value: number, targets: number[]): number => {
        let found = value;
        let distance = tolerance;
        targets.forEach((target) => {
          if (Math.abs(target - value) < distance) {
            distance = Math.abs(target - value);
            found = target;
          }
        });
        return found;
      };
      return {
        x: near(
          point.x,
          corners.map((corner) => corner.x),
        ),
        y: near(
          point.y,
          corners.map((corner) => corner.y),
        ),
      };
    },
    [lines, snapMm],
  );

  /**
   * 引いた線の番号を出す位置。
   * 同じ所に重ねて引いた線は数字が読めなくなるので、少しずつずらして出す。
   */
  const manualNumbers = useMemo(() => {
    const step = view.span * 0.022;
    const used = new Map<string, number>();
    return manualLines.map((line) => {
      const mx = (line.x1 + line.x2) / 2;
      const my = (line.y1 + line.y2) / 2;
      const key = `${Math.round(mx * 20)}/${Math.round(my * 20)}`;
      const order = used.get(key) ?? 0;
      used.set(key, order + 1);
      const vertical =
        Math.abs(line.y1 - line.y2) >= Math.abs(line.x1 - line.x2);
      return {
        id: line.id,
        no: lines.find((each) => each.id === line.id)?.label ?? "",
        x: mx + (vertical ? step * (order + 1) : 0),
        y: my - (vertical ? 0 : step * (order + 1)),
      };
    });
  }, [lines, manualLines, view.span]);

  /** 同じ所に重ねて引いてしまった線（両端が同じ線どうし） */
  const doubled = useMemo(() => {
    const groups = new Map<string, string[]>();
    manualLines.forEach((line) => {
      const ends = [
        `${Math.round(line.x1 * 20)},${Math.round(line.y1 * 20)}`,
        `${Math.round(line.x2 * 20)},${Math.round(line.y2 * 20)}`,
      ].sort();
      const key = ends.join("/");
      groups.set(key, [...(groups.get(key) ?? []), line.id]);
    });
    /** 重なっている線のid（あとから引いた分は「消す候補」） */
    const ids = new Set<string>();
    const extras = new Set<string>();
    groups.forEach((members) => {
      if (members.length < 2) return;
      members.forEach((id, index) => {
        ids.add(id);
        if (index > 0) extras.add(id);
      });
    });
    return { ids, extras };
  }, [manualLines]);

  /** 部屋の表はレイアウトを大きく開いているときだけ出す（戻したら図と線の表だけ） */
  const showRoomTables = expanded && !manualOnly && showRoomList;

  /** 表に入れた長さに合わせて、引いた線の終わりの端だけを動かす */
  const setManualLength = useCallback(
    (id: string, length: number): void => {
      if (!Number.isFinite(length) || length <= 0) return;
      pushDiagram();
      setManualLines((current) =>
        current.map((line) => {
          if (line.id !== id) return line;
          const dx = line.x2 - line.x1;
          const dy = line.y2 - line.y1;
          const now = Math.hypot(dx, dy);
          if (now < 1e-6) return line;
          const at = (value: number): number => Math.round(value * 1000) / 1000;
          return {
            ...line,
            x2: at(line.x1 + (dx / now) * length),
            y2: at(line.y1 + (dy / now) * length),
          };
        }),
      );
    },
    [pushDiagram],
  );

  /** 引いた線の端をつまんで伸び縮みさせるときの、つかんでいる端 */
  const endRef = useRef<{
    lineId: string;
    end: 1 | 2;
    /** Shiftを押している間は吸着させない（好きな長さに伸ばせる） */
    free: boolean;
  } | null>(null);
  /** 端をつまんで離した直後のクリックで、線を引き始めないための印 */
  const endMovedRef = useRef(false);

  const finishDrag = useCallback(() => {
    panDragRef.current = null;
    traceDragRef.current = null;
    const grabbed = endRef.current;
    if (grabbed) {
      endRef.current = null;
      endMovedRef.current = true;
      if (grabbed.free) return;
      setManualLines((current) =>
        current.map((line) => {
          if (line.id !== grabbed.lineId) return line;
          const point = snapPoint(
            grabbed.end === 1
              ? { x: line.x1, y: line.y1 }
              : { x: line.x2, y: line.y2 },
            line.id,
          );
          return grabbed.end === 1
            ? { ...line, x1: point.x, y1: point.y }
            : { ...line, x2: point.x, y2: point.y };
        }),
      );
      return;
    }
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
          snapMm / 1000,
        );
        return { ...placement, ...snapped };
      }),
    );
  }, [lines, shapes, snapMm, snapPoint]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const movePan = panDragRef.current;
      if (movePan) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.scrollLeft = movePan.left - (event.clientX - movePan.clientX);
        canvas.scrollTop = movePan.top - (event.clientY - movePan.clientY);
        if (
          Math.abs(event.clientX - movePan.clientX) +
            Math.abs(event.clientY - movePan.clientY) >
          4
        ) {
          panMovedRef.current = true;
        }
        return;
      }
      const moveTrace = traceDragRef.current;
      if (moveTrace) {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height) || 1;
        const scale = view.span / size;
        // 動かし始めの位置からの差を全図面（またはつかんだ1枚）に足す
        const dx = (event.clientX - moveTrace.clientX) * scale;
        const dy = (event.clientY - moveTrace.clientY) * scale;
        if (traceLocked) {
          setTraces(
            moveTrace.all.map((item) => ({
              ...item,
              x: item.x + dx,
              y: item.y + dy,
            })),
          );
        } else {
          setTraces(
            moveTrace.all.map((item, at) =>
              at === moveTrace.index
                ? { ...item, x: item.x + dx, y: item.y + dy }
                : item,
            ),
          );
        }
        return;
      }
      const grabbed = endRef.current;
      if (grabbed) {
        if (event.shiftKey) grabbed.free = true;
        const point = toModel(event.clientX, event.clientY);
        if (!point) return;
        const at = (value: number): number => Math.round(value * 20) / 20;
        setManualLines((current) =>
          current.map((line) => {
            if (line.id !== grabbed.lineId) return line;
            // よこの線はよこだけ、たての線はたてだけ伸び縮みさせる
            const horizontal = Math.abs(line.y1 - line.y2) < 1e-6;
            const vertical = Math.abs(line.x1 - line.x2) < 1e-6;
            const x = vertical
              ? grabbed.end === 1
                ? line.x1
                : line.x2
              : at(point.x);
            const y = horizontal
              ? grabbed.end === 1
                ? line.y1
                : line.y2
              : at(point.y);
            return grabbed.end === 1
              ? { ...line, x1: x, y1: y }
              : { ...line, x2: x, y2: y };
          }),
        );
        return;
      }
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
    [toModel, traceLocked, view.span],
  );

  /** 始点クリック → 終点ク���ックで1本引く（軸組モード／レイアウトの「線を引く」） */
  const onCanvasClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      // 画面を動かす（パン）はドラッグだけの動き。つまんで動かした後のクリックだけは無効、
      // 普通のクリックは線引き・縮尺合わせなどに通す（線を引きながら画面を動かせる）
      if (panMode && panMovedRef.current) {
        panMovedRef.current = false;
        return;
      }
      if (endMovedRef.current) {
        endMovedRef.current = false;
        return;
      }
      if (traceMode === "scale") {
        const at = toModel(event.clientX, event.clientY);
        if (!at) return;
        setScalePoints((current) =>
          current.length >= 2 ? [at] : [...current, at],
        );
        setMessage(
          scalePoints.length === 0
            ? "もう1点クリックしてください"
            : "実寸（m）を入れて「合わせる」を押してください",
        );
        return;
      }
      if (traceMode === "move") return;
      if (mode !== "frame" && !(mode === "layout" && drawing)) {
        // 何も無い所をクリックしたら、選んだ線（両端の丸印）を外す
        if (event.target === event.currentTarget) setSelectedLineId(null);
        return;
      }
      const point = toModel(event.clientX, event.clientY);
      if (!point) return;
      const snap = (value: number): number => Math.round(value * 20) / 20;
      const next = snapPoint({ x: snap(point.x), y: snap(point.y) });
      if (drawStart === null) {
        pushDiagram();
        setDrawStart(next);
        setMessage(
          "終点をクリックしてください（Shiftを押しながらだと斜め線になります）",
        );
        return;
      }
      // 直交で引く（長い方の向きに合わせる）。Shiftを押している間は斜め線
      const dx = Math.abs(next.x - drawStart.x);
      const dy = Math.abs(next.y - drawStart.y);
      const end = event.shiftKey
        ? next
        : dx >= dy
          ? { x: next.x, y: drawStart.y }
          : { x: drawStart.x, y: next.y };
      if (dx < 0.05 && dy < 0.05) {
        setDrawStart(null);
        return;
      }
      const id = newId("l");
      setManualLines((current) => [
        ...current,
        { id, x1: drawStart.x, y1: drawStart.y, x2: end.x, y2: end.y },
      ]);
      if (drawKindId !== "") updateAttribute(id, { kindId: drawKindId }, true);
      setDrawStart(null);
      setMessage(
        drawKindId === ""
          ? "軸組ラインを1本追加しました"
          : `軸組ラインを1本追加しました（${kindOf(drawKindId)?.name ?? ""}）`,
      );
    },
    [
      drawKindId,
      drawStart,
      drawing,
      kindOf,
      mode,
      scalePoints.length,
      snapPoint,
      toModel,
      pushDiagram,
      traceMode,
      updateAttribute,
    ],
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

  /** 既に注意した誤りの内容（同じ誤りのまま2回目を押したら閉じる） */
  const [warnedKey, setWarnedKey] = useState("");
  /** 誤りの欄へカーソルを飛ばす合図 */
  const [errorJump, setErrorJump] = useState(0);
  const closePage = useCallback(() => {
    const errorKey = calcResult.errors
      .map((error) => `${error.lineId}:${error.message}`)
      .join("|");
    if (calcResult.errors.length > 0 && errorKey !== warnedKey) {
      const first = calcResult.errors[0];
      const set = lower.find((each) => each.id === first.setId);
      const found = set?.lines.findIndex((line) => line.id === first.lineId);
      const index = found === undefined || found < 0 ? 0 : found;
      const line = set?.lines[index];
      const area =
        line && line.formulaA.trim() === "" && line.formulaB.trim() !== ""
          ? "formulaB"
          : "formulaA";
      setCalcFocus({ setId: first.setId, area, index });
      setErrorJump((tick) => tick + 1);
      setWarnedKey(errorKey);
      setMessage(
        `計算式の誤りが${calcResult.errors.length}件あります（${first.message}）。誤りの計算式へカーソルを移しました。直さずに閉じるときは、もう一度押してください`,
      );
      return;
    }
    // 閉じるときは必ず自動保存する
    void (async () => {
      await save();
      onBack();
    })();
  }, [calcResult.errors, lower, onBack, warnedKey, save]);

  type FrameKindGroup = (typeof kindGroups)[number];

  /** 軸組の表の見出し（種類別でも、まとめて1つの表でも同じ） */
  const kindTableHead = (
    <thead>
      <tr>
        <th className="no" />
        <th className="no">番号</th>
        <th>種類</th>
        <th className="num">長さ</th>
        <th className="num">高さ</th>
        <th>建具</th>
        <th className="num">面積</th>
        <th className="num">補強</th>
        <th />
      </tr>
    </thead>
  );

  /** 種類ごとの合計行 */
  const kindTotalRow = (group: FrameKindGroup): ReactElement => (
    <tr className="kind-total">
      <td className="no" />
      <td
        className="symbol"
        title="クリックで計算式に入ります（面積計）"
        onClick={() => group.symbol && useSymbol(group.symbol)}
      >
        {group.symbol}
      </td>
      <td>合計</td>
      <td
        className="num"
        title="クリックで長さ計を計算式に入れます"
        onClick={() => group.symbol && useSymbol(`WSL${group.symbol.slice(2)}`)}
      >
        {formatNumber(
          group.results.reduce((total, each) => total + each.line.length, 0),
          2,
        )}
        <span className="total-symbol">{`WSL${group.symbol.slice(2)}`}</span>
      </td>
      <td className="num" />
      <td />
      <td
        className="num"
        title="クリックで面積計を計算式に入れます"
        onClick={() => group.symbol && useSymbol(group.symbol)}
      >
        {formatNumber(
          group.results.reduce((total, each) => total + (each.area ?? 0), 0),
          2,
        )}
        <span className="total-symbol">{group.symbol}</span>
      </td>
      <td
        className="num"
        title="クリックで補強計を計算式に入れます"
        onClick={() => group.symbol && useSymbol(`WSR${group.symbol.slice(2)}`)}
      >
        {formatNumber(
          group.results.reduce((total, each) => total + each.reinforcement, 0),
          2,
        )}
        <span className="total-symbol">{`WSR${group.symbol.slice(2)}`}</span>
      </td>
      <td />
    </tr>
  );

  /** 種類の中の線を1本ずつ */
  const kindLineRows = (group: FrameKindGroup): ReactElement[] =>
    group.results.map((result) => {
      const manual = result.line;
      return (
        <tr
          key={manual.id}
          className={selectedLineId === manual.id ? "selected" : ""}
          onClick={() => setSelectedLineId(manual.id)}
        >
          <td className="no">
            <input
              type="checkbox"
              title="まとめて軸組種類を付ける線を選びます"
              checked={checkedIds.includes(manual.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                setCheckedIds((current) =>
                  e.target.checked
                    ? [...current, manual.id]
                    : current.filter((id) => id !== manual.id),
                )
              }
            />
          </td>
          <td className="no" style={{ color: group.color }}>
            {manual.label}
            {doubled.ids.has(manual.id) && (
              <span className="doubled-mark" title="同じ位置に他の線があります">
                重
              </span>
            )}
          </td>
          <td>
            <select
              value={manual.kindId}
              style={{ color: group.color, fontWeight: 700 }}
              title="この線の軸組種類（図の色になります）"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                updateAttribute(manual.id, {
                  kindId: e.target.value,
                })
              }
            >
              <option value="">（種類なし）</option>
              {kinds.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.name}
                </option>
              ))}
            </select>
          </td>
          <td>
            <input
              className="num"
              key={`l-${manual.id}-${manual.length}`}
              defaultValue={formatNumber(manual.length, 2)}
              title="長さを入れると、始めの端はそのままで終わりの端が動きます"
              onBlur={(e) => setManualLength(manual.id, Number(e.target.value))}
            />
          </td>
          <td>
            <input
              className="num"
              key={`h-${manual.id}-${manual.workHeight ?? ""}`}
              defaultValue={
                manual.workHeight === null
                  ? ""
                  : formatNumber(manual.workHeight, 2)
              }
              placeholder={formatNumber(workHeight, 2)}
              title="空欄なら上の施工高さを使います"
              onBlur={(e) => {
                const text = e.target.value.trim();
                updateAttribute(manual.id, {
                  workHeight: text === "" ? null : Number(text),
                });
              }}
            />
          </td>
          <td className="fitting-cell">
            {frameFittings
              .filter((item) => item.lineId === manual.id)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="chip"
                  title="押すとこの線から建具を外します"
                  onClick={(e) => {
                    e.stopPropagation();
                    pushDiagram();
                    setFrameFittings((current) =>
                      current.filter((each) => each.id !== item.id),
                    );
                  }}
                >
                  {item.symbol}
                  {item.multiplier > 1 ? `×${item.multiplier}` : ""}
                </button>
              ))}
            <select
              value=""
              title="この番号の線に付く建具を選びます"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const symbol = e.target.value;
                if (symbol === "") return;
                pushDiagram();
                setFrameFittings((current) => [
                  ...current,
                  {
                    id: newId("ff"),
                    symbol,
                    multiplier: 1,
                    lineId: manual.id,
                  },
                ]);
              }}
            >
              <option value="">＋建具</option>
              {fittings.map((fitting) => (
                <option key={fitting.id} value={fitting.symbol}>
                  {fitting.symbol}
                </option>
              ))}
            </select>
          </td>
          <td className="num">{formatNumber(result.area, 2)}</td>
          <td className="num">{formatNumber(result.reinforcement, 2)}</td>
          <td>
            <button
              type="button"
              title="この線を消します"
              onClick={() => {
                pushDiagram();
                setManualLines((current) =>
                  current.filter((each) => each.id !== manual.id),
                );
                setSelectedLineId(null);
                setMessage("引いた線を消しました");
              }}
            >
              🗑
            </button>
          </td>
        </tr>
      );
    });

  /** 種類ごとの合計（表の下の注記） */
  const kindTotalsNote = (group: FrameKindGroup): ReactElement => (
    <p className="totals">
      長さ計{" "}
      {formatNumber(
        group.results.reduce((total, each) => total + each.line.length, 0),
        2,
      )}
      ／面積計{" "}
      {formatNumber(
        group.results.reduce((total, each) => total + (each.area ?? 0), 0),
        2,
      )}
      ／補強計{" "}
      {formatNumber(
        group.results.reduce((total, each) => total + each.reinforcement, 0),
        2,
      )}
      ／たて{" "}
      {group.results.filter((each) => each.line.label.startsWith("Y")).length}
      本・よこ{" "}
      {group.results.filter((each) => each.line.label.startsWith("X")).length}本
    </p>
  );

  /** 上段（レイアウト図・軸組の表）。印刷では紙の1枚目に入れる */
  const upperArea = (
    <div
      className={[
        "upper",
        mode === "layout" ? "layout-mode" : "",
        expanded ? "layout-popup" : "",
        expanded && manualOnly ? "lines-only" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <section className="drawing">
        <div className="section-bar">
          <span>建物レイアウト（{MODE_LABEL[mode]}）</span>
          {!printMode && (
            <>
              <button
                type="button"
                title="図の直しを1つ前に戻します"
                onClick={undoDiagram}
                disabled={!diagramHistory.canUndo}
              >
                ↶ 戻る
              </button>
              <button
                type="button"
                title="戻した図を1つ先へ進めます"
                onClick={redoDiagram}
                disabled={!diagramHistory.canRedo}
              >
                ↷ 進む
              </button>
            </>
          )}
          <button
            type="button"
            title={
              expanded
                ? "別窓を閉じてもとの画面に戻ります"
                : "レイアウトを画面いっぱいに広げて配置できます"
            }
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "✕ 閉じる" : "⤡ 大きく開く"}
          </button>
          <button
            type="button"
            title="図を大きくします（大きくしたら「✋ 図を動かす」で端まで見られます）"
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
          <button
            type="button"
            title="表示範囲を今の中身に合わせ直します"
            onClick={() => {
              setZoom(1);
              setPanMode(false);
              // 図面も入れて、中身ぜんぶが入る大きさに戻す
              if (traces.length > 0) setFitTrace(true);
              setHeldView(null);
            }}
          >
            全体
          </button>
          <button
            type="button"
            className={panMode ? "on" : ""}
            title="図をつまんで動かして見る所を変えます（大きくしたときに端まで見られます。図面そのものは「✥ 図面を動かす」で動きます）"
            onClick={() => {
              const next = !panMode;
              setPanMode(next);
              panDragRef.current = null;
              panMovedRef.current = false;
              setMessage(
                next
                  ? "図をつまんだまま動かすと見る所を変えられます（線引き・縮尺合わせのクリックはそのまま使えます）"
                  : "",
              );
            }}
          >
            ✋ 画面を動かす
          </button>
          {traces.length > 0 && (
            <button
              type="button"
              className={fitTrace ? "on" : ""}
              title="図面の紙全体に合わせます（切ると引いた線に合わせて大きく出します）"
              onClick={() => {
                setHeldView(null);
                setZoom(1);
                setFitTrace(!fitTrace);
              }}
            >
              🖼 図面に合わせる
            </button>
          )}
          {mode === "layout" && (
            <button
              type="button"
              className={drawing ? "on" : ""}
              title="置いた部屋の上から線を引きます（始点→終点をクリック。端は近くの角・壁に吸着します。終点をShiftを押しながらクリックすると斜め線になります）"
              onClick={() => {
                setDrawStart(null);
                // 線を引く間は表示範囲を止めて、図面が動かないようにする
                setHeldView(drawing ? null : baseView);
                setDrawing(!drawing);
                // 縮尺合わせ・図面を動かすが入ったままだと線が引けないのでやめる
                if (!drawing) {
                  setTraceMode("off");
                  setScalePoints([]);
                  // 画面を動かす（パン）中はクリックが効かないので切る
                  setPanMode(false);
                  panDragRef.current = null;
                }
                setMessage(
                  drawing
                    ? "線引きをやめました（部屋を動かせます）"
                    : "始点をクリックしてください（部屋は動きません）",
                );
              }}
            >
              ✎ 線を引く
            </button>
          )}
          {manualLines.length > 0 && (
            <button
              type="button"
              className={manualOnly ? "on" : ""}
              title="自分で引いた線だけを出します（下敷きの図面は消え、部屋の図は薄くなります）"
              onClick={() => setManualOnly(!manualOnly)}
            >
              ☉ 引いた線だけ
            </button>
          )}
          {expanded && (
            <button
              type="button"
              className={showRoomList ? "on" : ""}
              title="「置ける部屋」の表を出す／消す（消すと図を広く使えます）"
              onClick={() => setShowRoomList(!showRoomList)}
            >
              🏠 置ける部屋
            </button>
          )}
          {mode === "layout" && manualLines.length > 0 && (
            <button
              type="button"
              title="最後に引いた線を1本消します（図の上の線をダブルクリックでも消せます）"
              onClick={() => {
                pushDiagram();
                setManualLines((current) => current.slice(0, -1));
                setDrawStart(null);
                setMessage("引いた線を1本消しました");
              }}
            >
              ↩ 1本消す
            </button>
          )}
          {!printMode && manualLines.length > 0 && (
            <button
              type="button"
              title="自分で引いた線をすべて消します（下敷きの図面は残ります）"
              onClick={async () => {
                if (
                  !(await ask(
                    `引いた線（${manualLines.length}本）をすべて消します。よろしいですか`,
                  ))
                )
                  return;
                pushDiagram();
                setManualLines([]);
                setDrawStart(null);
                setSelectedLineId(null);
                setCheckedIds([]);
                setMessage("引いた線をすべて消しました");
              }}
            >
              🗑 線を全部消す
            </button>
          )}
          {!printMode && trace.image !== "" && (
            <button
              type="button"
              title="下敷きの図面（元図）を外します（引いた線は残ります）"
              onClick={async () => {
                if (!(await ask("下敷きの図面を外します。よろしいですか")))
                  return;
                pushDiagram();
                setTrace(EMPTY_FRAME_TRACE);
                setTraceMode("off");
                setScalePoints([]);
                setMessage(
                  traces.length > 1
                    ? "選んでいる図面を外しました（他の図面は残ります）"
                    : "下敷きの図面を外しました",
                );
              }}
            >
              🗑 図面を外す
            </button>
          )}
          {!printMode && traces.length > 1 && (
            <>
              <label
                className="snap-field"
                title="動かす・合わせる・外すの対象にする図面を選びます（選んだ図面に橙の枠が出ます）"
              >
                図面を選ぶ
                <select
                  value={Math.min(activeTrace, Math.max(traces.length - 1, 0))}
                  onChange={(e) => {
                    setActiveTrace(Number(e.target.value));
                    // 選んだ図面が表示範囲の外にあっても見えるようにする
                    setFitTrace(true);
                  }}
                >
                  {traces.map((_, index) => (
                    <option key={index} value={index}>
                      図面{index + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                title="選んでいる図面（橙枠）をいちばん上に重ねて出します（重なっている所で見える図面を変えます）"
                onClick={bringTraceFront}
              >
                ⬆ 上に出す
              </button>
              <button
                type="button"
                className={traceLocked ? "on" : ""}
                title="ONの間「✥ 図面を動かす」で全部の図面が一緒に動きます（重ね合わせたあと1枚の絵として固定したいときに）"
                onClick={() => setTraceLocked(!traceLocked)}
              >
                🔗 まとめて動かす
              </button>
            </>
          )}
          {!printMode && trace.image !== "" && (
            <button
              type="button"
              title="選んでいる図面（橙枠）を線や部屋の近くへ戻します（動かして遠くへ行き、見えなくなったときに。まとめて動かす中は全員まとめて戻ります）"
              onClick={goHomeTrace}
            >
              📍 近くへ戻す
            </button>
          )}
          {!printMode && (
            <>
              <button
                type="button"
                title="Shift+Windows+S で切り取った図面を下敷きに足します（なぞって線を引けます。2枚目以降は右横に置きます）"
                onClick={() => void pasteTraceImage()}
              >
                📋 図面を貼る
              </button>
              <button
                type="button"
                title="PDF・画像のファイルを選んで下敷きに足します（複数まとめて選ぶと横に並べて置きます）"
                onClick={() => void openTraceFiles()}
              >
                📄 図面ファイル
              </button>
              <label className="snap-field" title="PDFの何ページ目を使うか">
                頁
                <input
                  className="num"
                  value={pageText}
                  onChange={(e) => setPageText(e.target.value)}
                />
              </label>
            </>
          )}
          {trace.image !== "" && !printMode && (
            <>
              <button
                type="button"
                className={traceMode === "scale" ? "on" : ""}
                title="図面の中で長さの分かる所を2点クリックするか、引いた線を選び、実寸（m）を入れると縮尺が合います"
                onClick={() => {
                  setScalePoints([]);
                  setTraceMode(traceMode === "scale" ? "off" : "scale");
                  if (traceMode !== "scale") {
                    setDrawing(false);
                    setDrawStart(null);
                    // 図を動かす（パン）中はクリックが効かないので切り、対象の図面が見えるよう表示範囲に入れる
                    setPanMode(false);
                    panDragRef.current = null;
                    setFitTrace(true);
                  }
                  setMessage(
                    traceMode === "scale"
                      ? "縮尺合わせをやめました"
                      : "長さの分かる所を2点クリックするか、直したい線を選んで、実寸（m）を入れてください",
                  );
                }}
              >
                ⤢ 縮尺合わせ
              </button>
              {scaleUndo.length > 0 && (
                <button
                  type="button"
                  title="縮尺合わせをする前の図面と線に戻します"
                  onClick={undoScale}
                >
                  ↶ 縮尺を戻す
                </button>
              )}
              {traceMode === "scale" && (
                <>
                  <label
                    className="snap-field"
                    title="2点の間、または選んだ線の実寸（m）"
                  >
                    実寸
                    <input
                      className="num"
                      value={scaleText}
                      onChange={(e) => setScaleText(e.target.value)}
                    />
                    m
                  </label>
                  <button type="button" onClick={applyScale}>
                    合わせる
                  </button>
                </>
              )}
              <button
                type="button"
                className={traceMode === "move" ? "on" : ""}
                title="図面をつまんで動かします（引いた線に合わせる位置決め）"
                onClick={() => {
                  setHeldView(traceMode === "move" ? null : baseView);
                  setTraceMode(traceMode === "move" ? "off" : "move");
                  if (traceMode !== "move") {
                    setDrawing(false);
                    setDrawStart(null);
                    // 図を動かす（パン）中は図面をつかめないので切り、対象の図面が見えるよう表示範囲に入れる
                    setPanMode(false);
                    panDragRef.current = null;
                    setFitTrace(true);
                  }
                }}
              >
                ✥ 図面を動かす
              </button>
              <button
                type="button"
                title="図面だけを少し小さくします（引いた線はそのまま）"
                onClick={() => resizeTrace(1 / 1.05)}
              >
                図面 −
              </button>
              <button
                type="button"
                title="図面だけを少し大きくします（引いた線はそのまま）"
                onClick={() => resizeTrace(1.05)}
              >
                図面 ＋
              </button>
              <label
                className="snap-field"
                title="下敷きの図面の濃さを変えます（図面は消えません）"
              >
                図面の濃さ
                <select
                  value={String(trace.opacity ?? 0.75)}
                  onChange={(e) => {
                    pushDiagram();
                    setTrace((current) => ({
                      ...current,
                      opacity: Number(e.target.value),
                    }));
                  }}
                >
                  <option value="1">濃い</option>
                  <option value="0.75">ふつう</option>
                  <option value="0.4">薄い</option>
                  <option value="0.15">とても薄い</option>
                </select>
              </label>
            </>
          )}
          {!printMode && (
            <label
              className="snap-field"
              title="これから引く線に付ける軸組種類です（線の色になります）"
            >
              種類
              <select
                value={drawKindId}
                style={{
                  color: kindOf(drawKindId)?.color ?? "#334155",
                  fontWeight: 700,
                }}
                onChange={(e) => setDrawKindId(e.target.value)}
              >
                <option value="">（種類なし）</option>
                {kinds.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!printMode && (
            <button
              type="button"
              className={showKinds ? "on" : ""}
              title="軸組種類の名前と色を直します"
              onClick={() => setShowKinds(!showKinds)}
            >
              🎨 軸組種類
            </button>
          )}
          <label
            className="snap-field"
            title="この幅より近い壁・角はぴったり合わせます。部屋ごとに寸法を測るので、大きい部屋と小さい部屋で同じ壁の長さが食い違うときはここを広げます。0にすると吸着しません"
          >
            吸着
            <input
              className="num"
              value={snapText}
              onChange={(e) => setSnapText(e.target.value)}
              onBlur={() => {
                const value = Number(snapText);
                // 数でないときや0以下のときは元の幅に戻す
                if (!Number.isFinite(value) || value < 0) {
                  setSnapText(String(snapMm));
                  return;
                }
                setSnapMm(value);
                try {
                  window.localStorage.setItem(SNAP_KEY, String(value));
                } catch {
                  // 覚えられなくても使えるようにする
                }
              }}
            />
            mm
          </label>
          {gaps.length > 0 && (
            <span
              className="gap-note"
              title={gaps
                .map(
                  (gap) =>
                    `${gap.roomName} ${formatNumber(gap.gap * 1000, 0)}mm違い`,
                )
                .join(" / ")}
            >
              壁のずれ {gaps.length}か所（最大{" "}
              {formatNumber(Math.max(...gaps.map((gap) => gap.gap)) * 1000, 0)}
              mm）
            </span>
          )}
        </div>
        {drawing && !printMode && (
          <div className="frame-draw-bar">
            <strong>線を引く</strong>
            <label>
              種類
              <select
                value={drawKindId}
                style={{
                  color: kindOf(drawKindId)?.color ?? "#334155",
                  fontWeight: 700,
                }}
                onChange={(e) => setDrawKindId(e.target.value)}
              >
                <option value="">（種類なし）</option>
                {kinds.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="status">
              始めと終わりをクリックします（1点目のやり直しは Esc か右クリック）
            </span>
            {drawStart !== null && (
              <button
                type="button"
                title="1点目を取り消して、もう一度始めからクリックします"
                onClick={() => {
                  setDrawStart(null);
                  setMessage("1点目を取り消しました");
                }}
              >
                ↶ 1点目をやり直す
              </button>
            )}
          </div>
        )}
        <div className="canvas" ref={canvasRef}>
          <svg
            ref={svgRef}
            viewBox={view.box}
            style={{
              width: `${zoom * 100}%`,
              height: `${zoom * 100}%`,
              cursor: panMode ? "grab" : undefined,
            }}
            onPointerDown={(event) => {
              if (!panMode) return;
              const canvas = canvasRef.current;
              if (!canvas) return;
              panMovedRef.current = false;
              panDragRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                left: canvas.scrollLeft,
                top: canvas.scrollTop,
              };
            }}
            onPointerMove={onPointerMove}
            onPointerUp={finishDrag}
            onPointerLeave={finishDrag}
            onClick={onCanvasClick}
            onContextMenu={(event) => {
              if (drawStart === null && scalePoints.length === 0) return;
              event.preventDefault();
              setDrawStart(null);
              setScalePoints([]);
              setMessage("取り消しました（もう一度1点目からどうぞ）");
            }}
          >
            {traces.map((item, index) => {
              const box = traceBoxes[index];
              if (box === null || box === undefined) return null;
              return (
                <g key={index}>
                  <image
                    href={item.image}
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    opacity={manualOnly ? 0.12 : (item.opacity ?? 0.75)}
                    style={{
                      cursor: traceMode === "move" ? "move" : "default",
                      pointerEvents: traceMode === "move" ? "auto" : "none",
                    }}
                    onPointerDown={(event) => {
                      if (traceMode !== "move") return;
                      event.stopPropagation();
                      pushDiagram();
                      // つかんだ図面を操作対象にして動かす（まとめて動かす中は全員が動く）
                      setActiveTrace(index);
                      traceDragRef.current = {
                        clientX: event.clientX,
                        clientY: event.clientY,
                        index,
                        all: traces,
                      };
                    }}
                  />
                  {/* 図面が2枚以上あるときは、ボタンが効く図面に橙の枠を出す */}
                  {traces.length > 1 &&
                    index ===
                      Math.min(activeTrace, Math.max(traces.length - 1, 0)) && (
                      <rect
                        x={box.x}
                        y={box.y}
                        width={box.width}
                        height={box.height}
                        fill="none"
                        stroke="#e8590c"
                        strokeWidth="2"
                        strokeDasharray="8 4"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    )}
                </g>
              );
            })}
            {scalePoints.map((point, index) => (
              <circle
                key={`sp-${index}`}
                cx={point.x}
                cy={point.y}
                r={view.span * 0.008}
                className="draw-start"
              />
            ))}
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
                        manualOnly ? "faint" : "",
                        selectedPlacementId === placement.id ? "selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      fill={placement.color}
                      onPointerDown={(event) => {
                        setSelectedPlacementId(placement.id);
                        if (drawing) return;
                        pushDiagram();
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
                        : (kindOf(line.kindId)?.color ??
                          placement?.color ??
                          "#111827")
                  }
                  className={[
                    "frame-line",
                    line.source === "manual" ? "hand" : "",
                    manualOnly && line.source !== "manual" ? "faint" : "",
                    picked ? "" : "skip",
                    gapLineIds.has(line.id) ? "gap" : "",
                    doubled.ids.has(line.id) ? "doubled" : "",
                    checkedIds.includes(line.id) ? "checked" : "",
                    selectedLineId === line.id ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onDoubleClick={(event) => {
                    if (line.source !== "manual") return;
                    event.stopPropagation();
                    pushDiagram();
                    setManualLines((current) =>
                      current.filter((each) => each.id !== line.id),
                    );
                    setDrawStart(null);
                    setMessage("引いた線を消しました");
                  }}
                  onPointerDown={(event) => {
                    // 線を引いている間は、他の線に触れても選ばない（同じ所にも点が打てる）
                    if (drawing && !event.ctrlKey && !event.shiftKey) return;
                    // Ctrl（Shift）を押しながらだと、まとめて色を付ける線に足す
                    if (
                      line.source === "manual" &&
                      (event.ctrlKey || event.shiftKey)
                    ) {
                      event.stopPropagation();
                      setCheckedIds((current) =>
                        current.includes(line.id)
                          ? current.filter((id) => id !== line.id)
                          : [...current, line.id],
                      );
                      return;
                    }
                    setSelectedLineId(line.id);
                    if (line.source === "manual") {
                      setMessage("この線は Delete キーで消せます");
                    }
                    if (mode !== "layout" || drawing || !placement) return;
                    setSelectedPlacementId(placement.id);
                    pushDiagram();
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
            {manualNumbers.map((mark) => (
              <text
                key={`n-${mark.id}`}
                className="manual-no"
                x={mark.x}
                y={mark.y}
                fontSize={view.span * 0.016}
              >
                {mark.no}
              </text>
            ))}
            {manualLines
              .filter((line) => !drawing && line.id === selectedLineId)
              .flatMap((line) =>
                ([1, 2] as const).map((end) => (
                  <circle
                    key={`h-${line.id}-${end}`}
                    cx={end === 1 ? line.x1 : line.x2}
                    cy={end === 1 ? line.y1 : line.y2}
                    r={view.span * 0.012}
                    className="line-handle"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      // つまんでいる間に表示範囲が変わって図面が動かないよう止める
                      setHeldView(baseView);
                      pushDiagram();
                      endRef.current = {
                        lineId: line.id,
                        end,
                        free: event.shiftKey,
                      };
                      setMessage(
                        "端をつまんだまま動かすと伸び縮みします（Shiftを押しながらだと吸着しません）",
                      );
                    }}
                  />
                )),
              )}
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
        {doubled.extras.size > 0 && (
          <p className="gap-note">
            同じ所に重ねて引いた線が{doubled.extras.size}
            本あります（表の番号の横の「重」印、図では紫の太い線です）{" "}
            <button
              type="button"
              title="重なっている線を、1つの位置につき1本だけ残します"
              onClick={() => {
                pushDiagram();
                setManualLines((current) =>
                  current.filter((line) => !doubled.extras.has(line.id)),
                );
                setSelectedLineId(null);
                setMessage("重なっていた線を1本にしました");
              }}
            >
              重なりを1本にする
            </button>
          </p>
        )}
      </section>

      {showRoomTables && (
        <section className="rooms">
          <div className="section-bar">
            <span>置ける部屋（部屋計算書を作った部屋）</span>
          </div>
          {
            <table className="grid">
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.estimateRowId}>
                    <td>
                      {onOpenRoomSheet ? (
                        <button
                          type="button"
                          className="room-link"
                          title="この部屋の計算書を開きます（寸法の直しはそちらで）"
                          onClick={() => onOpenRoomSheet(room.estimateRowId)}
                        >
                          {room.roomName || "（部屋名なし）"}
                        </button>
                      ) : (
                        room.roomName || "（部屋名なし）"
                      )}
                    </td>
                    <td className="num">
                      {formatNumber(room.ceilingHeight, 2)}
                    </td>
                    <td>
                      <button type="button" onClick={() => addPlacement(room)}>
                        ＋ 置く
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
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
                      {onOpenRoomSheet ? (
                        <button
                          type="button"
                          className="room-link"
                          style={{ color: placement.color }}
                          title="この部屋の計算書を開きます（寸法の直しはそちらで）"
                          onClick={() =>
                            onOpenRoomSheet(placement.estimateRowId)
                          }
                        >
                          {placement.roomName}
                        </button>
                      ) : (
                        placement.roomName
                      )}
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
                            pushDiagram();
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
                        onClick={() => {
                          pushDiagram();
                          setPlacements((current) =>
                            current.filter((each) => each.id !== placement.id),
                          );
                        }}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {showKinds && !printMode && (
        <section className="rooms frame-kinds">
          <div className="section-bar">
            <span>軸組種類（名前と色。図の線と表の色が合います）</span>
          </div>
          <p className="totals">
            図の線を
            Ctrl＋クリック、または表の左の□で選んでから、下の「この種類にする」を押すとまとめて色が付きます
          </p>
          <table className="grid">
            <tbody>
              {kinds.map((kind, index) => (
                <tr key={kind.id}>
                  <td className="no">{index + 1}</td>
                  <td>
                    <input
                      value={kind.name}
                      onFocus={pushDiagram}
                      onChange={(e) =>
                        setKinds((current) =>
                          current.map((each) =>
                            each.id === kind.id
                              ? { ...each, name: e.target.value }
                              : each,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      className="kind-color"
                      value={kind.color}
                      onFocus={pushDiagram}
                      onChange={(e) =>
                        setKinds((current) =>
                          current.map((each) =>
                            each.id === kind.id
                              ? { ...each, color: e.target.value }
                              : each,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      title="選んでいる線をこの軸組種類にします"
                      onClick={() => applyKindToChecked(kind.id)}
                    >
                      この種類にする
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!printMode && !drawing && checkedIds.length > 0 && (
        <section className="rooms kind-apply">
          <div className="section-bar">
            <span>選んだ線 {checkedIds.length} 本</span>
            <select
              value=""
              title="選んだ線にまとめて軸組種類を付けます"
              onChange={(e) => {
                if (e.target.value === "") return;
                applyKindToChecked(
                  e.target.value === "none" ? "" : e.target.value,
                );
              }}
            >
              <option value="">まとめて種類を付ける…</option>
              {kinds.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.name}
                </option>
              ))}
              <option value="none">（種類なし）</option>
            </select>
            <button type="button" onClick={() => setCheckedIds([])}>
              選び直す
            </button>
          </div>
        </section>
      )}

      {!expanded &&
        kindGroups.map((group) => (
          <section className="rooms lines-kind" key={`kind-${group.id}`}>
            <div className="section-bar">
              <span>
                <span
                  className="kind-chip"
                  style={{ background: group.color }}
                />
                {group.name}（たて・よこまとめて{group.results.length}本）
              </span>
            </div>
            <table className="grid">
              {kindTableHead}
              <tbody>
                {kindTotalRow(group)}
                {kindLineRows(group)}
              </tbody>
            </table>
            {kindTotalsNote(group)}
          </section>
        ))}

      {expanded && kindGroups.length > 0 && (
        <section className="rooms lines-kind lines-all">
          <div className="section-bar">
            <span>
              軸組（引いた線{" "}
              {kindGroups.reduce(
                (count, group) => count + group.results.length,
                0,
              )}
              本・色は軸組種類）
            </span>
          </div>
          <table className="grid">
            {kindTableHead}
            <tbody>
              {kindGroups.map((group) => (
                <Fragment key={`all-${group.id}`}>
                  {kindTotalRow(group)}
                  {kindLineRows(group)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!printMode && mode !== "layout" && (
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
      )}

      {!printMode && mode !== "layout" && (
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
                        lang="ja"
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
                        lang="ja"
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
                        lang="ja"
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
                          onClick={() => {
                            pushDiagram();
                            setManualLines((current) =>
                              current.filter((each) => each.id !== line.id),
                            );
                          }}
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
      )}

      {!printMode && mode !== "layout" && (
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
                        onFocus={pushDiagram}
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
                        onFocus={pushDiagram}
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
                        onChange={(e) => {
                          pushDiagram();
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
                          );
                        }}
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
                        onClick={() => {
                          pushDiagram();
                          setFrameFittings((current) =>
                            current.filter((each) => each.id !== item.id),
                          );
                        }}
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
      )}

      {!printMode && mode !== "layout" && (
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
                          pushDiagram();
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
      )}

      {!printMode && mode === "check" && (
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
  );

  if (printMode)
    return (
      <CalcPrintSheet
        title={`軸組計算書　${project.managementNo} ${project.name}　${roomName || "（名称なし）"}`}
        upper={upperArea}
        upperClass="frame-sheet-page"
        sets={lower}
        result={calcResult}
      />
    );

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
              if (key === "layout") setExpanded(true);
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
            key={`wh-${sheet?.id ?? "new"}-${formatNumber(workHeight, 2)}`}
            title="軸組の施工高さ。ここを直すと全体が再計算されます"
            onBlur={(e) => {
              changeWorkHeight(e.target.value);
            }}
          />
        </label>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      {upperArea}

      <RoomCalcSheet
        sets={lower}
        onChange={setLower}
        variables={calcVariables}
        options={options}
        projectId={project.id}
        focus={calcFocus}
        onFocus={setCalcFocus}
        jumpTick={errorJump}
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
