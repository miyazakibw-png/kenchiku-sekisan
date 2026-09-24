import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
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
  EMPTY_TRACE,
  EMPTY_UNDERLAY,
  parseTrace,
  parseUnderlayLocked,
  parseUnderlays,
  traceFromUnderlay,
  underlayAtTraceOrigin,
  underlayForTrace,
  type RoomTrace,
} from "../../../../core/room/trace";
import RoomTracePanel from "./RoomTracePanel";
import {
  rotateUnderlay,
  UnderlayImage,
  UnderlayScaleMarks,
  UnderlayTools,
  useUnderlay,
  type UnderlayBox,
} from "./useUnderlay";
import {
  closeShape,
  closeShapeAtEdge,
  cutCorner,
  edge,
  edgeRange,
  floorArea,
  freeColumn,
  incomingIsVertical,
  isDiagonal,
  mirrorShape,
  moveCorner,
  nextEdgeDirection,
  notchEdge,
  rectangleShape,
  roomQuantities,
  roomSymbols,
  ROOM_FIXED_SYMBOLS,
  rotateShape,
  round2,
  scaleShape,
  shapeExtents,
  solveShape,
  setEdgeKinds,
  splitEdge,
  trimEdges,
  updateEdge,
  type EdgeDirection,
  type EdgeKind,
  type Point,
  type RoomFitting,
  type RoomShape,
  type SolvedShape,
} from "../../../../core/room/shape";
import {
  ceilingElement,
  beamFootprintArea,
  ceilingQuantities,
  ceilingSymbols,
  ceilingLines as buildCeilingLines,
  ceilingBoundaries,
  cutByBeams,
  ceilingRegions,
  normalizeCeilingHeights,
  noteRegionHeight,
  parseCeilingCodes,
  splitDropCeiling,
  wallEdgeHeights,
  type CeilingAnchor,
  type CeilingCodes,
  type CeilingElement,
  type CeilingElementKind,
  type CeilingPoint,
  type CeilingRegion,
} from "../../../../core/room/ceiling";
import {
  evaluateCalcSheet,
  quantityByPart,
  trimEmptySets,
  type CalcSet,
} from "../../../../core/room/calcSheet";
import { parseLowerTemplate } from "../../../../core/room/lowerTemplate";
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
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import CalcPrintSheet from "../print/CalcPrintSheet";
import { ask } from "../common/askDialog";

interface Props {
  project: ProjectSummary;
  row: EstimateRowDraft;
  roomName: string;
  onBack: () => void;
  /** 天井高さを直したときに部位別入力表の行へも伝える */
  onCeilingHeightChange?: (height: number | null) => void;
  /** 印刷書式（A3横）で出す。入力はせず、保存もしない */
  printMode?: boolean;
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
  curve: "Ｒ壁",
  curveOpening: "Ｒ開口",
};

/** 記号表の左上から先に並べる記号（その部屋に無くても0で残す） */
const HEAD_SYMBOLS = ROOM_FIXED_SYMBOLS;

/** まだ選んでいない欄を押したときは、中の数字をまるごと選んで上書きできるようにする */
function selectWholeOnFirstClick(event: MouseEvent<HTMLInputElement>): void {
  const input = event.currentTarget;
  if (document.activeElement === input) return;
  // ここで入力先を横取りすると、Windowsで窓に文字が入らなくなることがあるので、
  // 押した後（欄に入った後）に全部を選ぶ
  window.setTimeout(() => {
    if (document.activeElement === input) input.select();
  }, 0);
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

/**
 * 区画一覧の数字欄。欄を出たときに確定し、確定後は必ず今の値（2桁）を表示する。
 * 値が変わらなかったときも打った文字のまま残さない（別の区画の欄と入れ違いにならないように）。
 */
function RegionNumberCell({
  value,
  title,
  onCommit,
}: {
  value: number | null;
  title: string;
  onCommit: (text: string) => void;
}): JSX.Element {
  const shown = formatNumber(value, 2);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  return (
    <input
      className="num"
      value={editing ? text : shown}
      title={title}
      onFocus={() => {
        setText(shown);
        setEditing(true);
      }}
      onClick={selectWholeOnFirstClick}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={() => {
        setEditing(false);
        onCommit(text);
      }}
    />
  );
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

/**
 * 保存してある天井伏図を読む。
 * 入っている壁高さはＨ（梁せい・下がり）に直して読み込む。
 * こうしておくと、計算書をコピーして部屋の天井高さを変えても、元の天井高さの壁高さが残らない。
 */
function parseCeiling(
  json: string,
  roomCeilingHeight: number | null,
): CeilingElement[] {
  try {
    const parsed = JSON.parse(json) as CeilingElement[];
    return Array.isArray(parsed)
      ? normalizeCeilingHeights(parsed, roomCeilingHeight)
      : [];
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
  | { kind: "split"; edgeId: string; span: number; first: string }
  | { kind: "scale"; edgeId: string; current: number; value: string };

const PROMPT_TITLE: Record<
  "rect" | "cut" | "notch" | "split" | "scale",
  string
> = {
  rect: "四角を作る",
  cut: "L型を角に追加",
  notch: "コ型を辺に追加",
  split: "角を追加",
  scale: "縮尺を合わせる",
};

/** 表示スペースいっぱいに、縦横の大きい方に合わせて描く（1m角も100m角も同じ大きさで見える） */
/** 角の○印を出すかを覚えておく場所（次に開いたときも同じ状態にする） */
const CORNERS_KEY = "roomSheet.showCorners";

function viewBox(
  solved: SolvedShape,
  underlays: (UnderlayBox | null)[],
): { box: string; span: number } {
  const underlayBoxes = underlays.filter(
    (box): box is UnderlayBox => box !== null,
  );
  if (solved.points.length === 0 && underlayBoxes.length === 0)
    return { box: "0 0 100 100", span: 100 };
  const xs = solved.points.map((point) => point.x);
  const ys = solved.points.map((point) => point.y);
  for (const underlay of underlayBoxes) {
    xs.push(underlay.x, underlay.x + underlay.width);
    ys.push(underlay.y, underlay.y + underlay.height);
  }
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(width, height, 0.001);
  // 下敷きの図面はなぞる画面と同じ見え方（左上づめ・原寸）にするので余白を小さくする
  const margin = size * (underlayBoxes.length === 0 ? 0.18 : 0.05);
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
  onCeilingHeightChange,
  printMode = false,
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
  /** C番号を手で動かした位置と、下がり天井の無い区画に入れた天井高さ */
  const [codes, setCodes] = useState<CeilingCodes>({ moves: {}, heights: [] });
  /** C番号をつかんでいる間の持ち手（番号と、つかんだ時の位置） */
  const codeDragRef = useRef<{
    code: string;
    fromX: number;
    fromY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  /** 選んだ自由線の持ち手（①・折れ点・②）をつかんでいる間の持ち手 */
  const freePointDragRef = useRef<{
    elementId: string;
    key: "a" | "b" | number;
  } | null>(null);
  /** 図形の角（○印）をつかんでいる間の持ち手。base はつかみ始めた時の形 */
  const cornerDragRef = useRef<{
    index: number;
    base: RoomShape;
    origin: Point;
    moved: boolean;
  } | null>(null);
  /** 天井伏図（線・区画の高さ・C番号の位置）を1つの履歴にして戻る・進む */
  const ceilingHistory = useUndoRedo<{
    ceiling: CeilingElement[];
    codes: CeilingCodes;
  }>();
  const ceilingContentRef = useRef({ ceiling, codes });
  useEffect(() => {
    ceilingContentRef.current = { ceiling, codes };
  });
  const changeCeiling = (
    next: React.SetStateAction<CeilingElement[]>,
  ): void => {
    ceilingHistory.push(ceilingContentRef.current);
    setCeiling(next);
  };
  const changeCodes = (next: React.SetStateAction<CeilingCodes>): void => {
    ceilingHistory.push(ceilingContentRef.current);
    setCodes(next);
  };
  const undoCeiling = (): void => {
    const previous = ceilingHistory.undo(ceilingContentRef.current);
    if (previous === null) return;
    setCeiling(previous.ceiling);
    setCodes(previous.codes);
    setPickedCeiling(null);
    setMessage("1つ前に戻しました（保存すると確定します）");
  };
  const redoCeiling = (): void => {
    const next = ceilingHistory.redo(ceilingContentRef.current);
    if (next === null) return;
    setCeiling(next.ceiling);
    setCodes(next.codes);
    setPickedCeiling(null);
    setMessage("戻した内容を1つ先へ進めました（保存すると確定します）");
  };
  const [showCeiling, setShowCeiling] = useState(printMode);
  /** 同じ高さの区画を、離れていても1つの番号にまとめるか */
  const [mergeCeiling, setMergeCeiling] = useState(false);
  /** 図でクリックして選んだ天井伏図の線（入力表の行が光ります） */
  const [pickedCeiling, setPickedCeiling] = useState<string | null>(null);
  /**
   * 図の上でクリックして自由線の下がり天井を引くモード。
   * null＝引いていない、"idle"＝①を待っている。
   * a が入っていれば①は済みで、部屋の中をクリックすると折れ点を足し、
   * 辺の近くをクリックすると②になって線ができる（L字・コの字にできる）
   */
  const [freeDraw, setFreeDraw] = useState<
    { a: CeilingAnchor; via: CeilingPoint[] } | "idle" | null
  >(null);
  /** ②や折れ点を待っている間の、カーソルの所の位置（辺に近いと辺の上に付く） */
  const [freeCursor, setFreeCursor] = useState<
    (CeilingPoint & { onEdge: boolean }) | null
  >(null);
  /** 図を画面いっぱいに開いて、右に寸法入力表だけを出す */
  const [expanded, setExpanded] = useState(false);
  /**
   * 天井伏図を大きく開いているとき＝天井高さの入力用の表示。
   * 区切られた範囲すべてに番号を出し、同じ高さの境目の線も薄く残す。
   */
  const editCeiling = expanded && showCeiling && !printMode;
  const [lower, setLower] = useState<CalcSet[]>([]);
  const [calcFocus, setCalcFocus] = useState<CalcFocus | null>(null);
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [showCheck, setShowCheck] = useState(false);
  const [deductionLimit, setDeductionLimit] = useState(0.5);
  /** 下段の初期状態（見出し行＋部位の並び。全物件共通）の保存・読み出し */
  const lowerTemplate = useMemo(
    () => ({
      save: async (sets: CalcSet[]): Promise<void> => {
        await window.sekisan.saveRoomLowerTemplate(JSON.stringify(sets));
      },
      load: async (): Promise<CalcSet[]> =>
        parseLowerTemplate(await window.sekisan.getRoomLowerTemplate()),
    }),
    [],
  );
  /** 建具記号を計算式へ入れるときの、部位ごとの採用値 */
  const [partValues, setPartValues] = useState<FittingPartValue[]>(
    DEFAULT_FITTING_PART_VALUES,
  );
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  /** 範囲選択の終わりの辺（Shift＋クリック）。まとめて消すときに使う */
  const [rangeEdge, setRangeEdge] = useState<string | null>(null);
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
  /** 建具表の小窓をつかんで動かした位置（null＝既定の右上） */
  const [fittingsPos, setFittingsPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const fittingsDragRef = useRef<{
    fromX: number;
    fromY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  /**
   * 角の○印を出すか（形が決まったら消して寸法を見やすくできます）。
   * 標準は「消す」。出す／消すは覚えておき、次に開いたときも同じ状態にする。印刷では出さない。
   */
  const [showCorners, setShowCorners] = useState(
    () => window.localStorage.getItem(CORNERS_KEY) === "1",
  );
  /** 図形の戻る・進む用（1操作ごとの形を覚えておく） */
  const [shapePast, setShapePast] = useState<RoomShape[]>([]);
  const [shapeFuture, setShapeFuture] = useState<RoomShape[]>([]);
  /** 辺をクリックした位置に角を足すモード */
  const [addCornerMode, setAddCornerMode] = useState(false);
  /** 種別をまとめて変える選び中の辺（null は選び中でない） */
  const [kindPick, setKindPick] = useState<string[] | null>(null);
  /** 部屋の中の独立柱を置くモード */
  const [columnMode, setColumnMode] = useState(false);
  /** これから置く独立柱の大きさ（Ｗ×Ｄ・m） */
  const [columnWidth, setColumnWidth] = useState("0.60");
  const [columnDepth, setColumnDepth] = useState("0.60");
  /** 選んでいる独立柱（消すときに使う） */
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  /** 置く前に柱の形を見せるカーソル（置くモード中だけ） */
  const [columnGhost, setColumnGhost] = useState<Point | null>(null);
  /** 置いた柱をつかんで動かしている間の持ち手。base はつかみ始めた時の形 */
  const columnDragRef = useRef<{
    id: string;
    base: RoomShape;
    /** つかみ始めた柱の中心（m） */
    from: Point;
    /** つかみ始めたポインタの図内座標（m） */
    start: Point;
    moved: boolean;
  } | null>(null);
  /** つかんで動かした直後のクリックを打ち消す（選択の切替え・再配置を防ぐ） */
  const columnClickSuppressRef = useRef(false);
  /** 図面画像となぞった点（数量根拠として一緒に保存する） */
  const [trace, setTrace] = useState<RoomTrace>(EMPTY_TRACE);
  const [showTrace, setShowTrace] = useState(false);
  /** 図を右下に浮かせる小窓（計算書に数字を入れながら図を見るためのもの） */
  const [showMini, setShowMini] = useState(false);
  const [miniPos, setMiniPos] = useState(() => ({
    x: Math.max(8, window.innerWidth - 560),
    y: Math.max(8, window.innerHeight - 420),
  }));
  const miniDragRef = useRef<{ dx: number; dy: number } | null>(null);
  /** 小窓の拡大率と見えている場所（＋で図だけ大きくし、数字の大きさは変えない） */
  const [miniZoom, setMiniZoom] = useState(1);
  const [miniPan, setMiniPan] = useState<{ x: number; y: number } | null>(null);
  const miniPanRef = useRef<{
    clientX: number;
    clientY: number;
    from: { x: number; y: number };
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const promptBoxRef = useRef<HTMLDivElement | null>(null);
  /** 図の実寸（寸法文字を表と同じ大きさで出すために測る） */
  const [canvasSize, setCanvasSize] = useState(200);
  const [message, setMessage] = useState("");

  const solved = useMemo(() => solveShape(shape), [shape]);
  const extents = useMemo(() => shapeExtents(solved), [solved]);
  /** 「📍 近くへ戻す」で図面を置き直す場所（図形の左上の角） */
  const homeSpot = useMemo(() => {
    if (solved.points.length === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(...solved.points.map((point) => point.x)),
      y: Math.min(...solved.points.map((point) => point.y)),
    };
  }, [solved.points]);
  /** 図の下敷きにする図面（部屋の形と見比べるために置く。traceJson に一緒に保存する） */
  const underlayTool = useUnderlay({
    setMessage,
    planSize: extents === null ? 0 : Math.max(extents.x, extents.y),
    multi: true,
    homeSpot,
  });
  const { underlay, setUnderlay, underlays, setUnderlays } = underlayTool;

  // 画面を閉じる・ウィンドウを閉じるときは、直した内容を自動で保存する
  const { markSaved } = useSaveOnLeave(
    {
      shape,
      roomFittings,
      ceiling,
      codes,
      lower,
      ceilingHeight,
      trace,
      underlays,
      underlayLocked: underlayTool.moveAll,
    },
    () => save(),
  );

  /** 部位別入力表の行の天井高さ（読み込みのときだけ見る） */
  const rowCeilingRef = useRef(row.ceilingHeight);
  rowCeilingRef.current = row.ceilingHeight;

  useEffect(() => {
    if (row.id === null) return;
    void (async () => {
      const loaded = await window.sekisan.getRoomSheet(row.id as number);
      // 天井高さは部位別入力表の値を優先（計算書をコピーしたときに元の高さが残らないように）
      const height = rowCeilingRef.current ?? loaded.ceilingHeight;
      setSheet(loaded);
      setCeilingHeight(height);
      setShape(parseShape(loaded.shapeJson));
      setShapePast([]);
      setShapeFuture([]);
      setRoomFittings(parseRoomFittings(loaded.fittingsJson));
      setCeiling(parseCeiling(loaded.ceilingJson, height));
      setCodes(parseCeilingCodes(loaded.ceilingCodesJson));
      ceilingHistory.clear();
      setLower(parseLower(loaded.lowerJson));
      setTrace(parseTrace(loaded.traceJson));
      setUnderlays(parseUnderlays(loaded.traceJson));
      underlayTool.setMoveAll(parseUnderlayLocked(loaded.traceJson));
      markSaved({
        trace: parseTrace(loaded.traceJson),
        underlays: parseUnderlays(loaded.traceJson),
        underlayLocked: parseUnderlayLocked(loaded.traceJson),
        shape: parseShape(loaded.shapeJson),
        roomFittings: parseRoomFittings(loaded.fittingsJson),
        ceiling: parseCeiling(loaded.ceilingJson, height),
        codes: parseCeilingCodes(loaded.ceilingCodesJson),
        lower: parseLower(loaded.lowerJson),
        // 保存してある高さと違うときは、閉じるときに直した高さで保存させる
        ceilingHeight: loaded.ceilingHeight,
      });
      setOptions(await window.sekisan.getMasterOptions(project.id));
      setFittings(await window.sekisan.listFittings(project.id));
      setDeductionLimit(await window.sekisan.getDeductionLimit());
      setPartValues(await window.sekisan.getFittingPartValues());
    })();
  }, [markSaved, project.id, row.id]);

  // 小窓（四角・L型・コ型・角の追加）を開いたら、寸法欄にカーソルを入れる
  const promptOpen = prompt !== null;
  useEffect(() => {
    if (!promptOpen) return;
    const focusInput = (): void => {
      const input = promptInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    };
    // 窓に文字が入るようにしてから欄へ入れる（Windowsで入力先が外れることへの備え）
    window.focus();
    focusInput();
    const timer = window.setTimeout(focusInput, 50);
    return () => window.clearTimeout(timer);
  }, [promptOpen]);

  /** 天井高さを直す（部位別入力表の行にもその場で反映させる） */
  const applyCeilingHeight = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      const value = trimmed === "" ? null : Number(trimmed);
      if (value !== null && Number.isNaN(value)) return;
      setCeilingHeight(value);
      onCeilingHeightChange?.(value);
    },
    [onCeilingHeightChange],
  );

  const liveView = useMemo(
    () =>
      viewBox(
        solved,
        underlayTool.boxes.filter((box) => box !== null),
      ),
    [solved, underlayTool.boxes],
  );
  /** 「図面を動かす」の間は見え方を動かし始めのまま固定する（図形も他の図面もその場に残り、画面が跳ねない） */
  const frozenViewRef = useRef(liveView);
  let view = liveView;
  if (underlayTool.mode === "move") {
    view = frozenViewRef.current;
  } else {
    frozenViewRef.current = liveView;
  }

  /** 小窓の見え方：拡大率と動かした場所だけずらした図。数字は画面で同じ大きさに保つ */
  const [viewBoxX, viewBoxY] = useMemo(() => {
    const parts = view.box.split(" ").map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0];
  }, [view.box]);
  const miniSpan = view.span / miniZoom;
  const miniOrigin = miniPan ?? { x: viewBoxX, y: viewBoxY };
  const miniBox = `${miniOrigin.x} ${miniOrigin.y} ${miniSpan} ${miniSpan}`;
  /** 小窓の幅を540pxとみなしたとき、文字が約11pxに見える図の中の大きさ（拡大しても画面での大きさは変わらない） */
  const miniFont = (miniSpan / 540) * 11;
  const miniZoomTo = (next: number) => {
    const span = view.span / next;
    const cx = miniOrigin.x + miniSpan / 2;
    const cy = miniOrigin.y + miniSpan / 2;
    setMiniZoom(next);
    setMiniPan(next <= 1 ? null : { x: cx - span / 2, y: cy - span / 2 });
  };

  // なぞる画面で画像を貼り替え・縮尺を変えたら「いま選んでいる図面」に反映する
  // （選んだ図面の1枚として残り、3枚目が増えない）
  useEffect(() => {
    if (!showTrace) return;
    const slotIndex = Math.min(underlayTool.active, underlays.length - 1);
    const current = slotIndex >= 0 ? underlays[slotIndex] : undefined;
    if (current === undefined || trace.image === "") return;
    if (
      current.image !== trace.image ||
      (trace.metersPerPixel > 0 &&
        current.metersPerPixel !== trace.metersPerPixel)
    ) {
      setUnderlays(
        underlays.map((item, index) =>
          index === slotIndex
            ? {
                ...item,
                image: trace.image,
                ...(trace.metersPerPixel > 0
                  ? { metersPerPixel: trace.metersPerPixel, scaled: true }
                  : {}),
              }
            : item,
        ),
        slotIndex,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTrace, trace, underlayTool.active]);

  /**
   * 下敷きの図面があるときは、なぞる画面と同じく画像を原寸（1画素＝1画面px）で出す。
   * このとき図の1mは 1/mpp px なので、svg の大きさは view.span/mpp px になる
   * （大きさが違うと貼る画面となぞる画面で画像の見え方がずれるため）。
   */
  const underlayScale =
    !printMode &&
    underlayTool.boxes.some((box) => box !== null) &&
    underlay.metersPerPixel > 0
      ? underlay.metersPerPixel
      : null;
  /** 図を実際に描いている大きさ（px。寸法文字やC番号のつかみ移動にも使う） */
  const drawnSize =
    underlayScale !== null
      ? (view.span / underlayScale) * zoom
      : Math.max(canvasSize * zoom, 1);

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
  const dimFontSize = useMemo(
    () => (view.span / drawnSize) * 12,
    [view.span, drawnSize],
  );

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

  const ceilingResult = useMemo(
    () => ceilingQuantities(ceiling, solved, ceilingHeight, codes.heights),
    [ceiling, codes.heights, solved, ceilingHeight],
  );
  // 梁型・下がり壁で何本にも分かれている下がり天井（別々の行に分けられる）
  const splitCeiling = useMemo(
    () =>
      new Map(
        ceiling
          .filter((element) => element.kind === "dropCeiling")
          .map((element) => [
            element.id,
            splitDropCeiling(element, ceiling, solved, ceilingHeight),
          ]),
      ),
    [ceiling, solved, ceilingHeight],
  );
  // 天井面積は梁型（壁付き・天井付）が取る梁底（長さ×Ｗ幅）の分を引く
  const beamArea = useMemo(
    () => beamFootprintArea(ceiling, solved, ceilingHeight),
    [ceiling, solved, ceilingHeight],
  );
  /**
   * 低い天井の区画に面している壁の壁高さ（面する区画の高さを長さで重み付けした実効値）。
   * 高さの欄に手で入れた辺はその値が優先
   */
  const edgeHeights = useMemo(() => {
    const auto = wallEdgeHeights(ceiling, solved, ceilingHeight, codes.heights);
    for (const row of solved.edges) {
      if (typeof row.height === "number" && row.height > 0) {
        auto.set(row.id, row.height);
      }
    }
    return auto;
  }, [ceiling, solved, ceilingHeight, codes.heights]);
  const quantities = useMemo(
    () =>
      roomQuantities(
        solved,
        ceilingHeight,
        resolvedFittings,
        deductionLimit,
        beamArea,
        edgeHeights,
      ),
    [
      solved,
      ceilingHeight,
      resolvedFittings,
      deductionLimit,
      beamArea,
      edgeHeights,
    ],
  );
  const symbols = useMemo(
    () => [
      ...roomSymbols(
        solved,
        ceilingHeight,
        resolvedFittings,
        deductionLimit,
        beamArea,
        edgeHeights,
      ),
      ...(ceiling.length > 0 ? ceilingSymbols(ceilingResult) : []),
    ],
    [
      solved,
      ceilingHeight,
      resolvedFittings,
      ceiling.length,
      ceilingResult,
      deductionLimit,
      beamArea,
      edgeHeights,
    ],
  );

  /**
   * 記号表は横に2組並べて高さを半分にする（下段の表示行を増やすため）。
   * 壁1・柱1などの辺ごとの記号は一覧には出さない（計算式には引き続き使える）。
   * よく使う記号は左上から決まった順に並べ、その部屋に無くても0で残す。
   */
  const symbolPairs = useMemo(() => {
    const shown = symbols.filter(
      (item) => !("edgeId" in item) || item.edgeId === undefined,
    );
    const head = HEAD_SYMBOLS.map(
      ({ symbol, label }) =>
        shown.find((item) => item.symbol === symbol) ?? {
          symbol,
          label,
          value: 0,
        },
    );
    const headSymbols = new Set(HEAD_SYMBOLS.map((item) => item.symbol));
    const ordered = [
      ...head,
      ...shown.filter((item) => !headSymbols.has(item.symbol)),
    ];
    // 曲面壁があるときは RHL を HL の直下、RWA を WA の直下に置く
    const moveAfter = (symbol: string, after: string): void => {
      const from = ordered.findIndex((item) => item.symbol === symbol);
      if (from < 0) return;
      const [item] = ordered.splice(from, 1);
      const to = ordered.findIndex((each) => each.symbol === after);
      ordered.splice(to < 0 ? ordered.length : to + 1, 0, item);
    };
    moveAfter("RHL", "HL");
    moveAfter("RWA", "WA");
    const half = Math.ceil(ordered.length / 2);
    return ordered
      .slice(0, half)
      .map(
        (item, index) =>
          [item, ordered[half + index] ?? null] as [
            (typeof symbols)[number],
            (typeof symbols)[number] | null,
          ],
      );
  }, [symbols]);

  /** 端点（辺の上の位置）の座標 */
  const anchorPos = useCallback(
    (anchor: CeilingAnchor): { x: number; y: number } | null => {
      const edgeIndex = solved.edges.findIndex(
        (row) => row.id === anchor.edgeId,
      );
      if (edgeIndex < 0 || solved.points.length === 0) return null;
      const from = solved.points[edgeIndex];
      const to = solved.points[(edgeIndex + 1) % solved.points.length];
      return {
        x: from.x + (to.x - from.x) * anchor.rate,
        y: from.y + (to.y - from.y) * anchor.rate,
      };
    },
    [solved.edges, solved.points],
  );

  const ceilingLines = useMemo(() => {
    if (solved.points.length === 0) return [];
    const count = ceilingResult.items.length;
    // 下がり天井は「区画のふち」から作る（同じ高さの境目は引かず、高さが違う所は実線）
    const shown = 0;
    const seen = new Map<string, number>();
    // 高さが違う区画の境目（高さがまだ決まっていない所も）は点線で出し、
    // 両側が同じ高さ（区画に入れた高さも含む）の境目は出さない。
    // 拡大して高さを入れるときは区画をまとめないので、線で区切られた境目すべてを見る。
    const drawn = [
      ...buildCeilingLines(ceiling, solved, ceilingHeight).filter(
        (line) => line.kind !== "dropCeiling",
      ),
      // 梁型・下がり壁のところ（梁底）は抜く
      ...ceilingBoundaries(
        ceiling,
        solved,
        ceilingHeight,
        editCeiling ? false : mergeCeiling,
        codes.heights,
      ).flatMap((edge) => {
        if (edge.step !== null && edge.step < 1e-6) return [];
        const element = ceiling.find((row) => row.id === edge.elementId);
        if (element === undefined) return [];
        return cutByBeams(edge, element, ceiling, solved, ceilingHeight).map(
          (piece) => {
            const no = seen.get(edge.elementId) ?? shown;
            seen.set(edge.elementId, no + 1);
            return {
              ...edge,
              ...piece,
              kind: "dropCeiling" as const,
              no,
              distance: 0,
              same: false,
              solid: edge.solid,
            };
          },
        );
      }),
    ];

    // 自由線の端点マーカー（①・②）はその線の1か所にだけ出す
    const freeMarkDone = new Set<string>();

    return drawn.flatMap((line, lineIndex) => {
      const itemIndex = ceilingResult.items.findIndex(
        (row) => row.element.id === line.elementId,
      );
      if (itemIndex < 0) return [];
      const item = ceilingResult.items[itemIndex];

      // 同じ壁に何本も線を置いても天井高さの文字が重ならないように、線の上で位置をずらす
      const at = (itemIndex + 1) / (count + 1);

      const marks: { key: string; x: number; y: number; label: string }[] = [];
      const free = item.element.free ?? null;
      if (free !== null && !freeMarkDone.has(item.element.id)) {
        freeMarkDone.add(item.element.id);
        const start = anchorPos(free.a);
        const end = anchorPos(free.b);
        // 線の内側へ少しずらして出す（角や辺の線と重ならないように）
        if (start !== null && end !== null) {
          const along = { x: end.x - start.x, y: end.y - start.y };
          marks.push(
            {
              key: `${item.element.id}-mark-a`,
              x: start.x + along.x * 0.03,
              y: start.y + along.y * 0.03,
              label: "①",
            },
            {
              key: `${item.element.id}-mark-b`,
              x: end.x - along.x * 0.03,
              y: end.y - along.y * 0.03,
              label: "②",
            },
          );
        }
      }

      return [
        {
          key: `${line.elementId}-${line.no}-${lineIndex}`,
          elementId: line.elementId,
          kind: line.kind,
          same: line.same,
          solid: "solid" in line && line.solid === true,
          x1: line.a.x,
          y1: line.a.y,
          x2: line.b.x,
          y2: line.b.y,
          labelX: line.a.x + (line.b.x - line.a.x) * at,
          labelY: line.a.y + (line.b.y - line.a.y) * at,
          label:
            line.no === 0 && item.element.ceilingHeight !== null
              ? formatNumber(item.element.ceilingHeight, 2)
              : "",
          marks,
        },
      ];
    });
  }, [
    anchorPos,
    ceiling,
    ceilingHeight,
    ceilingResult.items,
    codes.heights,
    editCeiling,
    mergeCeiling,
    solved,
  ]);

  /**
   * 線で囲まれた天井の区画（すべての区画にC1・C2…の番号を出す）。
   * 拡大して高さを入れるときは、線で区切られた範囲すべてを1つずつ出す。
   */
  const ceilingCodes = useMemo(
    () =>
      solved.points.length === 0
        ? []
        : ceilingRegions(
            ceiling,
            solved,
            ceilingHeight,
            mergeCeiling,
            editCeiling,
            codes.heights,
          ),
    [ceiling, ceilingHeight, codes.heights, editCeiling, mergeCeiling, solved],
  );

  /** 壁の辺だけ（建具の取付先の選択肢） */
  const wallEdges = useMemo(
    () => solved.edges.filter((line) => line.kind === "wall"),
    [solved.edges],
  );

  const save = useCallback(async () => {
    // 印刷は見るだけなので、直したことにしない
    if (!sheet || printMode) return;
    // 入力の無いセット明細は保存時に取り除く（画面からも消す）
    const trimmed = trimEmptySets(lower);
    setLower(trimmed);
    markSaved({
      shape,
      roomFittings,
      ceiling,
      codes,
      lower: trimmed,
      ceilingHeight,
      trace,
      underlays,
      underlayLocked: underlayTool.moveAll,
    });
    const saved = await window.sekisan.saveRoomSheet({
      id: sheet.id,
      shapeJson: JSON.stringify(shape),
      fittingsJson: JSON.stringify(roomFittings),
      ceilingJson: JSON.stringify(ceiling),
      ceilingCodesJson: JSON.stringify(codes),
      lowerJson: JSON.stringify(trimmed),
      traceJson: JSON.stringify({
        ...trace,
        underlay: underlays[0] ?? EMPTY_UNDERLAY,
        underlays,
        underlayLocked: underlayTool.moveAll,
      }),
      ceilingHeight,
      note: sheet.note,
    });
    setSheet(saved);
    setMessage("保存しました（天井高さは部位別入力表にも反映します）");
  }, [
    ceiling,
    ceilingHeight,
    codes,
    lower,
    markSaved,
    printMode,
    roomFittings,
    shape,
    sheet,
    trace,
    underlays,
    underlayTool.moveAll,
  ]);

  /** 図の1ピクセルが何メートルか（C番号をつかんで動かすときに使う） */
  const perPixel = useMemo(() => view.span / drawnSize, [view.span, drawnSize]);

  /** C番号をつかんで好きな位置へ動かす */
  const startCodeDrag = useCallback(
    (code: string, event: ReactPointerEvent<SVGTextElement>): void => {
      ceilingHistory.push(ceilingContentRef.current);
      const base = codes.moves[code] ?? { x: 0, y: 0 };
      codeDragRef.current = {
        code,
        fromX: event.clientX,
        fromY: event.clientY,
        baseX: base.x,
        baseY: base.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.stopPropagation();
    },
    [codes.moves],
  );

  const moveCodeDrag = useCallback(
    (event: ReactPointerEvent<SVGTextElement>): void => {
      const drag = codeDragRef.current;
      if (drag === null) return;
      const moved = {
        x: drag.baseX + (event.clientX - drag.fromX) * perPixel,
        y: drag.baseY + (event.clientY - drag.fromY) * perPixel,
      };
      setCodes((current) => ({
        ...current,
        moves: { ...current.moves, [drag.code]: moved },
      }));
    },
    [perPixel],
  );

  const endCodeDrag = useCallback((): void => {
    codeDragRef.current = null;
  }, []);

  const updateCeiling = useCallback(
    (id: string, patch: Partial<CeilingElement>): void =>
      changeCeiling((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** 自由線を選んだときの両端のたたき台（部屋をまたぐ対角線） */
  const defaultFree = useCallback((): {
    a: CeilingAnchor;
    b: CeilingAnchor;
  } => {
    const first = solved.edges[0]?.id ?? "";
    const last = solved.edges[Math.floor(solved.edges.length / 2)]?.id ?? "";
    return {
      a: { edgeId: first, rate: 0 },
      b: { edgeId: last, rate: 1 },
    };
  }, [solved.edges]);

  const setFreeAnchor = useCallback(
    (
      element: CeilingElement,
      side: "a" | "b",
      patch: Partial<CeilingAnchor>,
    ): void => {
      const free = element.free;
      if (free === null || free === undefined) return;
      updateCeiling(element.id, {
        free: { ...free, [side]: { ...free[side], ...patch } },
      });
    },
    [updateCeiling],
  );

  /** 図の上のクリック位置を図形の座標に直す */
  const svgPointAt = (
    svg: SVGSVGElement | null,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    if (svg === null) return null;
    const matrix = svg.getScreenCTM();
    if (matrix === null) return null;
    const origin = svg.createSVGPoint();
    origin.x = clientX;
    origin.y = clientY;
    return origin.matrixTransform(matrix.inverse());
  };

  const svgPoint = (
    event: React.MouseEvent<SVGSVGElement>,
  ): { x: number; y: number } | null =>
    svgPointAt(event.currentTarget, event.clientX, event.clientY);

  /** クリックした所に一番近い、辺の上の位置（線の端は必ず部屋のふちに付く。gap＝クリックから辺への離れ） */
  const nearestAnchor = useCallback(
    (point: {
      x: number;
      y: number;
    }): (CeilingAnchor & { gap: number }) | null => {
      let best: { edgeId: string; rate: number; gap: number } | null = null;
      for (const [index, row] of solved.edges.entries()) {
        const from = solved.points[index];
        const to = solved.points[(index + 1) % solved.points.length];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const span2 = dx * dx + dy * dy;
        const rate =
          span2 === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  ((point.x - from.x) * dx + (point.y - from.y) * dy) / span2,
                ),
              );
        const gap = Math.hypot(
          point.x - (from.x + dx * rate),
          point.y - (from.y + dy * rate),
        );
        if (best === null || gap < best.gap)
          best = { edgeId: row.id, rate, gap };
      }
      return best === null
        ? null
        : { edgeId: best.edgeId, rate: best.rate, gap: best.gap };
    },
    [solved.edges, solved.points],
  );

  /** 自由線の端が付く、辺への近さ（部屋の中のクリックは折れ点になる） */
  const freeSnap = view.span * 0.03;

  /**
   * 自由線を引くモードでの図のクリック。
   * 1か所目＝①（近い辺の上に付く）。次に部屋の中をクリックすると折れ点を足し、
   * 辺の近くをクリックすると②になって線ができる（折れ点でL字・コの字になる）
   */
  const clickFreeDraw = (event: React.MouseEvent<SVGSVGElement>): void => {
    const point = svgPoint(event);
    if (point === null) return;
    const near = nearestAnchor(point);
    if (near === null) return;
    if (freeDraw === "idle") {
      setFreeDraw({ a: { edgeId: near.edgeId, rate: near.rate }, via: [] });
      setMessage(
        "①を置きました。部屋の中をクリックすると折れ点を足せます。辺の近くをクリックすると②になって線ができます",
      );
      return;
    }
    if (freeDraw === null) return;
    if (near.gap > freeSnap) {
      setFreeDraw({ ...freeDraw, via: [...freeDraw.via, point] });
      setMessage(
        `折れ点を足しました（${freeDraw.via.length + 1}か所）。部屋の中＝折れ点、辺の近く＝②です`,
      );
      return;
    }
    const added = ceilingElement("dropCeiling", null);
    const next: CeilingElement = {
      ...added,
      edgeId: null,
      free: {
        a: freeDraw.a,
        b: { edgeId: near.edgeId, rate: near.rate },
        ...(freeDraw.via.length > 0 ? { via: freeDraw.via } : {}),
      },
    };
    changeCeiling((current) => [...current, next]);
    setPickedCeiling(next.id);
    setFreeDraw(null);
    setFreeCursor(null);
    setMessage(
      "自由線の下がり天井を引きました。線をクリックすると①・折れ点・②の持ち手が出て、つかんで動かせます",
    );
  };

  /** 選んだ自由線の①・折れ点・②をつかんで動かす */
  const startFreePointDrag = (
    elementId: string,
    key: "a" | "b" | number,
    event: ReactPointerEvent<SVGElement>,
  ): void => {
    if (freeDraw !== null) return;
    const element = ceiling.find((row) => row.id === elementId);
    if (element === undefined || element.free === undefined) return;
    if (element.free === null) return;
    ceilingHistory.push(ceilingContentRef.current);
    freePointDragRef.current = { elementId, key };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const moveFreePointDrag = (event: ReactPointerEvent<SVGElement>): void => {
    const drag = freePointDragRef.current;
    if (drag === null) return;
    const point = svgPointAt(
      event.currentTarget.ownerSVGElement,
      event.clientX,
      event.clientY,
    );
    if (point === null) return;
    setCeiling((current) =>
      current.map((row) => {
        if (
          row.id !== drag.elementId ||
          row.free === null ||
          row.free === undefined
        )
          return row;
        if (typeof drag.key === "number")
          return {
            ...row,
            free: {
              ...row.free,
              via: (row.free.via ?? []).map((each, index) =>
                index === drag.key ? { x: point.x, y: point.y } : each,
              ),
            },
          };
        const near = nearestAnchor(point);
        if (near === null) return row;
        return {
          ...row,
          free: {
            ...row.free,
            [drag.key]: { edgeId: near.edgeId, rate: near.rate },
          },
        };
      }),
    );
    event.stopPropagation();
  };

  const endFreePointDrag = (): void => {
    freePointDragRef.current = null;
  };

  /** 図形の角（○印）をつかみ始める */
  const startCornerDrag = (
    index: number,
    event: ReactPointerEvent<SVGElement>,
  ): void => {
    if (freeDraw !== null) return;
    const origin = solved.points[index];
    if (origin === undefined) return;
    setSelectedCorner(index);
    setSelectedEdge(null);
    setAddCornerMode(false);
    cornerDragRef.current = { index, base: shape, origin, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  /** 角をつかんで動かす。動き始めた時点で1つ前の形を履歴に入れ、あとは連続更新 */
  const moveCornerDrag = (
    index: number,
    event: ReactPointerEvent<SVGElement>,
  ): void => {
    const drag = cornerDragRef.current;
    if (drag === null || drag.index !== index) return;
    const point = svgPointAt(
      event.currentTarget.ownerSVGElement,
      event.clientX,
      event.clientY,
    );
    if (point === null) return;
    const result = moveCorner(
      drag.base,
      index,
      point.x - drag.origin.x,
      point.y - drag.origin.y,
    );
    if (result.error !== null) return;
    if (!drag.moved) {
      drag.moved = true;
      setShapePast((past) => [...past.slice(-49), drag.base]);
      setShapeFuture([]);
    }
    setShape(result.shape);
    event.stopPropagation();
  };

  const endCornerDrag = (index: number): void => {
    const drag = cornerDragRef.current;
    if (drag === null || drag.index !== index) return;
    cornerDragRef.current = null;
    if (drag.moved) setMessage("角をつかんで動かしました");
  };

  // 自由線を引いている間、Escでやめられる
  useEffect(() => {
    if (freeDraw === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setFreeDraw(null);
        setFreeCursor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [freeDraw]);

  /**
   * 区画一覧で入れた下がりは、その区画だけの高さとして覚える（隣の区画・下がり天井の行のＨは変えない）。
   * 下がり天井の行のＨはその線で下がる側の既定で、区画で入れた高さがあればそちらが優先。
   * 空欄にしたときは既定（下がり天井のＨ、なければ部屋の天井高さ）に戻す。
   */
  const setRegionDrop = useCallback(
    (region: CeilingRegion, drop: number | null): void => {
      // 触っただけ（値が変わっていない）ときは何もしない。
      // 高さがまだ決まっていない区画（Ｈが空の下がり天井の側）は、同じ数字でもその区画の高さとして覚える
      if (
        drop !== null &&
        region.height !== null &&
        Math.abs(drop - region.drop) < 1e-6
      )
        return;
      changeCodes((current) => ({
        ...current,
        heights: noteRegionHeight(current.heights, region, drop),
      }));
    },
    [],
  );

  /** 区画一覧の天井高さは「部屋の天井高さ－この区画の天井高さ」を下がりにして入れる */
  const setRegionHeight = useCallback(
    (region: CeilingRegion, text: string): void => {
      const body = text.trim();
      if (body === "") {
        setRegionDrop(region, null);
        return;
      }
      const height = textToNumber(body);
      if (height === null || ceilingHeight === null) return;
      setRegionDrop(region, Math.round((ceilingHeight - height) * 100) / 100);
    },
    [ceilingHeight, setRegionDrop],
  );

  /** 区画一覧の下がり欄 */
  const setRegionDropText = useCallback(
    (region: CeilingRegion, text: string): void => {
      const body = text.trim();
      if (body === "") {
        setRegionDrop(region, null);
        return;
      }
      const drop = textToNumber(body);
      if (drop === null) return;
      setRegionDrop(region, drop);
    },
    [setRegionDrop],
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
    // 建具表に無い記号だけここで入れた寸法を登録する。ある記号の寸法は建具表で直す
    setFittings(
      await window.sekisan.registerRoomFitting(
        project.id,
        {
          symbol,
          width: width ?? master?.width ?? null,
          height: height ?? master?.height ?? null,
          sillHeight: sill ?? master?.sillHeight ?? null,
        },
        master === undefined,
        row.id,
      ),
    );
    addRoomFitting(symbol, textToNumber(newFitting.count) ?? 1);
    setNewFitting({ symbol: "", count: "1", width: "", height: "", sill: "" });
    setMessage(
      master
        ? `${symbol} をこの部屋へ足しました`
        : `${symbol} を建具表へ登録してこの部屋へ足しました`,
    );
  }, [addRoomFitting, fittings, newFitting, project.id, row.id]);

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
    // 記号表にいつも出している記号は、その部屋に無くても0として計算式で使える
    HEAD_SYMBOLS.forEach(({ symbol }) => {
      if (values[symbol] === undefined) values[symbol] = 0;
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

  /** チェック表：上段の自動計算と下段の計算式合計を見比べる */
  const checkRows = useMemo(() => {
    const byPart = quantityByPart(lower, calcResult);
    const auto: { partName: string; quantity: number | null }[] = [
      { partName: "床", quantity: quantities.floorArea },
      { partName: "天井", quantity: quantities.ceilingArea },
      { partName: "壁", quantity: quantities.wallArea },
      // 曲面壁がある部屋は、壁から分けた曲面分も見比べられるように出す
      ...(solved.edges.some((row) => row.kind === "curve")
        ? [{ partName: "曲面壁", quantity: quantities.curveArea }]
        : []),
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
    // 形を直す操作は外周の辺だけを作るので、置いてある独立柱は残す
    setShape(
      next.columns === undefined ? { ...next, columns: shape.columns } : next,
    );
  };

  /** いまの図形を左右（x）・上下（y）に反転する */
  const flipShape = (axis: "x" | "y"): void => {
    if (shape.edges.length === 0) {
      setMessage("先に部屋の形を作ってください");
      return;
    }
    applyShape(mirrorShape(shape, axis));
    setSelectedEdge(null);
    setSelectedCorner(null);
    setMessage(axis === "x" ? "左右に反転しました" : "上下に反転しました");
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

  const startShape = async (next: RoomShape): Promise<void> => {
    if (
      shape.edges.length > 0 &&
      !(await ask("いまの形と寸法を消して、四角から作り直しますか？"))
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
    if (prompt.kind === "scale") {
      const value = textToNumber(prompt.value) ?? 0;
      const next = value > 0 ? scaleShape(shape, prompt.edgeId, value) : null;
      if (next === null) {
        setMessage("実寸は0より大きい値を入れてください");
        return;
      }
      setPrompt(null);
      applyShape(next);
      setSelectedEdge(null);
      setSelectedCorner(null);
      setMessage(
        `図形を${formatNumber(value / prompt.current, 2)}倍に合わせました（選んだ辺を ${formatNumber(value, 2)}m にしました）`,
      );
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
      void startShape(rectangleShape(across, along));
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

  /**
   * 選んだ辺を起点に図形全体を水平・垂直へ回す。
   * 貼った図面があるときは、同じ角度・同じ起点で画像も回してずれないようにする。
   */
  const rotateAtEdge = async (
    target: "horizontal" | "vertical",
  ): Promise<void> => {
    const row = solved.edges.find((item) => item.id === selectedEdge);
    if (row === undefined) {
      setMessage("回す起点にする辺を図か表で1本選んでから押してください");
      return;
    }
    const turned = rotateShape(shape, row.id, target);
    if (turned === null) {
      setMessage("この辺は長さが決まっていないので回せません");
      return;
    }
    applyShape(turned.shape);
    setSelectedEdge(null);
    setSelectedCorner(null);
    let imageNote = "";
    if (underlays.length > 0) {
      const turnedUnderlays = await Promise.all(
        underlays.map((item) =>
          rotateUnderlay(item, turned.pivot, turned.pivotTo, turned.angle),
        ),
      );
      if (turnedUnderlays.some((item) => item !== null)) {
        setUnderlays(
          underlays.map((item, index) => turnedUnderlays[index] ?? item),
          underlayTool.active,
        );
        imageNote = "（貼った図面も一緒に回りました）";
      }
    }
    setMessage(
      `選んだ辺を${target === "horizontal" ? "水平" : "垂直"}にしました${imageNote}`,
    );
  };

  /** 種別をまとめて変える選び中に、辺を選ぶ／外す */
  const toggleKindPick = (edgeId: string): void => {
    const picked = kindPick ?? [];
    const next = picked.includes(edgeId)
      ? picked.filter((item) => item !== edgeId)
      : [...picked, edgeId];
    setKindPick(next);
    setMessage(
      `${next.length}本えらんでいます（図の壁線をクリックして選び、「柱にする」か「壁に戻す」を押してください）`,
    );
  };

  /** 選んだ辺の種別をまとめて変える */
  const applyPickedKind = (kind: EdgeKind): void => {
    const picked = kindPick ?? [];
    if (picked.length === 0) {
      setMessage("図の線をクリックして選んでから押してください");
      return;
    }
    applyShape(setEdgeKinds(shape, picked, kind));
    setKindPick(null);
    setMessage(`${picked.length}本を「${KIND_LABEL[kind]}」にしました`);
  };

  /** 辺を選ぶ（Shift＋クリックでここからここまでの範囲選択） */
  const selectEdge = (edgeId: string, extend: boolean): void => {
    if (extend && selectedEdge !== null && selectedEdge !== edgeId) {
      setRangeEdge(edgeId);
      return;
    }
    setSelectedEdge(edgeId);
    setRangeEdge(null);
  };

  /** 選んでいる辺（範囲選択中はその間の辺すべて） */
  const selectedEdgeIds = ((): string[] => {
    if (selectedEdge === null) return [];
    if (rangeEdge === null) return [selectedEdge];
    return edgeRange(shape, selectedEdge, rangeEdge).map(
      (index) => shape.edges[index].id,
    );
  })();

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

  /** 図をクリックした所へ独立柱（Ｗ×Ｄ）を1本置く */
  const addFreeColumn = (event: React.MouseEvent<SVGSVGElement>): void => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const origin = svg.createSVGPoint();
    origin.x = event.clientX;
    origin.y = event.clientY;
    const clicked = origin.matrixTransform(matrix.inverse());
    const width = Number(columnWidth);
    const depth = Number(columnDepth);
    if (!(width > 0) || !(depth > 0)) {
      setMessage("独立柱のＷ・Ｄに0より大きい寸法を入れてください");
      return;
    }
    const added = freeColumn(
      round2(clicked.x),
      round2(clicked.y),
      round2(width),
      round2(depth),
    );
    applyShape({
      ...shape,
      columns: [...(shape.columns ?? []), added],
    });
    setSelectedColumn(added.id);
    setMessage(
      `独立柱を置きました（${formatNumber(added.width, 2)}×${formatNumber(added.depth, 2)}）。柱として数えます（床・天井は面積を減らし、周長を柱長ＣＬ・柱面積ＨＡ・巾木ＨＬ・廻り縁ＭＬへ足します）`,
    );
  };

  /** 選んでいる独立柱を消す */
  const removeFreeColumn = (): void => {
    const columns = shape.columns ?? [];
    if (
      selectedColumn === null ||
      !columns.some((c) => c.id === selectedColumn)
    )
      return;
    applyShape({
      ...shape,
      columns: columns.filter((column) => column.id !== selectedColumn),
    });
    setSelectedColumn(null);
    setMessage("独立柱を消しました");
  };

  /** 置いた柱をつかみ始める（置くモード中は置く操作を優先する） */
  const startColumnDrag = (
    column: SolvedShape["columns"][number],
    event: ReactPointerEvent<SVGElement>,
  ): void => {
    if (columnMode) return;
    const point = svgPointAt(
      event.currentTarget.ownerSVGElement,
      event.clientX,
      event.clientY,
    );
    if (point === null) return;
    columnDragRef.current = {
      id: column.id,
      base: shape,
      from: { x: column.x, y: column.y },
      start: point,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  /** 柱をつかんで動かす。動き始めた時点で1つ前の形を履歴に入れ、あとは連続更新 */
  const moveColumnDrag = (
    id: string,
    event: ReactPointerEvent<SVGElement>,
  ): void => {
    const drag = columnDragRef.current;
    if (drag === null || drag.id !== id) return;
    const point = svgPointAt(
      event.currentTarget.ownerSVGElement,
      event.clientX,
      event.clientY,
    );
    if (point === null) return;
    const x = round2(drag.from.x + point.x - drag.start.x);
    const y = round2(drag.from.y + point.y - drag.start.y);
    if (!drag.moved) {
      drag.moved = true;
      setShapePast((past) => [...past.slice(-49), drag.base]);
      setShapeFuture([]);
    }
    setShape({
      ...shape,
      columns: (shape.columns ?? []).map((column) =>
        column.id === id ? { ...column, x, y } : column,
      ),
    });
    event.stopPropagation();
  };

  const endColumnDrag = (id: string): void => {
    const drag = columnDragRef.current;
    if (drag === null || drag.id !== id) return;
    columnDragRef.current = null;
    if (drag.moved) {
      columnClickSuppressRef.current = true;
      setMessage("柱をつかんで動かしました");
    }
  };

  /** 選んでいる柱を壁⇔柱の数え方に変える */
  const toggleFreeColumnKind = (): void => {
    const columns = shape.columns ?? [];
    const target = columns.find((column) => column.id === selectedColumn);
    if (target === undefined) return;
    const next = target.kind === "wall" ? "column" : "wall";
    applyShape({
      ...shape,
      columns: columns.map((column) =>
        column.id === selectedColumn ? { ...column, kind: next } : column,
      ),
    });
    setMessage(
      next === "wall"
        ? "壁として数えます（周長を壁長ＷＬ・壁面積ＷＡ・巾木ＨＬ・廻り縁ＭＬへ足します）"
        : "柱として数えます（周長を柱長ＣＬ・柱面積ＨＡ・巾木ＨＬ・廻り縁ＭＬへ足します）",
    );
  };

  /** 選んでいる独立柱の大きさを直す */
  const resizeFreeColumn = (width: number, depth: number): void => {
    const columns = shape.columns ?? [];
    if (selectedColumn === null) return;
    applyShape({
      ...shape,
      columns: columns.map((column) =>
        column.id === selectedColumn
          ? { ...column, width: round2(width), depth: round2(depth) }
          : column,
      ),
    });
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

  /** 図の中身を描く（小窓でももう一度描く。fontFix を渡すと文字だけその大きさにする） */
  const renderDrawingContent = (fontFix: number | null): JSX.Element => (
    <>
      <UnderlayImage u={underlayTool} />
      {solved.points.map((point, index) => {
        const line = solved.edges[index];
        const next = solved.points[(index + 1) % solved.points.length];
        const middle = {
          x: (point.x + next.x) / 2,
          y: (point.y + next.y) / 2,
        };
        const vertical = point.x === next.x;
        const className = [
          "edge",
          line.kind,
          (kindPick ?? []).includes(line.id) ? "picked" : "",
          selectedEdgeIds.includes(line.id) ? "selected" : "",
        ]
          .filter(Boolean)
          .join(" ");
        // Ｒ壁・Ｒ開口は矢（ふくらみ）の分だけ膨らませて描く（マイナスは内側へ凹む）
        const bulge =
          line.kind === "curve" || line.kind === "curveOpening"
            ? (line.bulge ?? 0)
            : 0;
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
              // 独立柱を置いている間・自由線を引いている間は、辺を選ばない
              if (columnMode) return;
              if (freeDraw !== null) return;
              if (kindPick !== null) {
                toggleKindPick(line.id);
                return;
              }
              if (addCornerMode) {
                splitEdgeAt(line.id, point, next, event);
                return;
              }
              selectEdge(line.id, event.shiftKey);
              setSelectedCorner(null);
              // 閉じていないときは、押した辺の寸法で合わせる
              if (!event.shiftKey && solved.error !== null) fitEdge(line.id);
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
              fontSize={fontFix ?? dimFontSize}
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
      {solved.columns.map((column, index) => (
        <g
          key={column.id}
          onClick={(event) => {
            if (columnClickSuppressRef.current) {
              columnClickSuppressRef.current = false;
              event.stopPropagation();
              return;
            }
            if (columnMode) return;
            event.stopPropagation();
            setSelectedColumn(selectedColumn === column.id ? null : column.id);
            setColumnWidth(formatNumber(column.width, 2));
            setColumnDepth(formatNumber(column.depth, 2));
          }}
          onPointerDown={(event) => startColumnDrag(column, event)}
          onPointerMove={(event) => moveColumnDrag(column.id, event)}
          onPointerUp={() => endColumnDrag(column.id)}
        >
          <rect
            x={column.x - column.width / 2}
            y={column.y - column.depth / 2}
            width={column.width}
            height={column.depth}
            className={`free-column${
              column.kind === "wall" ? " wall" : ""
            }${selectedColumn === column.id ? " selected" : ""}`}
          />
          <text
            x={column.x}
            y={column.y - column.depth / 2 - dimFontSize * 0.3}
            className="dim"
            textAnchor="middle"
            fontSize={fontFix ?? dimFontSize}
          >
            {`${column.kind === "wall" ? "壁" : "C"}${index + 1} ${formatNumber(column.width, 2)}×${formatNumber(column.depth, 2)}`}
          </text>
        </g>
      ))}
      {showCorners &&
        !printMode &&
        solved.points.map((point, index) => (
          <g
            key={`corner-${solved.edges[index].id}`}
            onPointerDown={(event) => startCornerDrag(index, event)}
            onPointerMove={(event) => moveCornerDrag(index, event)}
            onPointerUp={() => endCornerDrag(index)}
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
              className={`ceiling-line ${line.kind}${line.same ? " same" : ""}${
                pickedCeiling === line.elementId ? " picked" : ""
              }`}
            />
            <line
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              className="ceiling-line-hit"
              onClick={() => {
                if (freeDraw !== null) return;
                setPickedCeiling(
                  pickedCeiling === line.elementId ? null : line.elementId,
                );
              }}
            >
              <title>入力表の行を光らせます</title>
            </line>
            {line.label !== "" && (
              <text
                x={line.labelX}
                y={line.labelY + dimFontSize * 0.9}
                className="dim ceiling"
                fontSize={fontFix ?? dimFontSize}
              >
                CH {line.label}
              </text>
            )}
            {line.marks.map((mark) => (
              <text
                key={mark.key}
                x={mark.x}
                y={mark.y}
                className="dim ceiling"
                fontSize={fontFix ?? dimFontSize}
              >
                {mark.label}
              </text>
            ))}
          </g>
        ))}
      {showCeiling &&
        !printMode &&
        freeDraw === null &&
        pickedCeiling !== null &&
        (() => {
          const element = ceiling.find((row) => row.id === pickedCeiling);
          const free = element?.free ?? null;
          if (element === undefined || free === null) return null;
          const handles: {
            key: "a" | "b" | number;
            at: CeilingPoint | null;
          }[] = [
            { key: "a", at: anchorPos(free.a) },
            ...(free.via ?? []).map((point, index) => ({
              key: index as number,
              at: point,
            })),
            { key: "b", at: anchorPos(free.b) },
          ];
          return (
            <g>
              {handles.map((item) =>
                item.at === null ? null : (
                  <g
                    key={`${element.id}-handle-${item.key}`}
                    style={{ cursor: "grab" }}
                    onPointerDown={(event) =>
                      startFreePointDrag(element.id, item.key, event)
                    }
                    onPointerMove={moveFreePointDrag}
                    onPointerUp={endFreePointDrag}
                  >
                    <circle
                      cx={item.at.x}
                      cy={item.at.y}
                      r={cornerRadius * 2.6}
                      className="corner-hit"
                    >
                      <title>
                        {item.key === "a"
                          ? "①をつかんで動かす（近い辺の上に付きます）"
                          : item.key === "b"
                            ? "②をつかんで動かす（近い辺の上に付きます）"
                            : "折れ点をつかんで動かす"}
                      </title>
                    </circle>
                    <circle
                      cx={item.at.x}
                      cy={item.at.y}
                      r={cornerRadius}
                      className="corner selected"
                    />
                  </g>
                ),
              )}
            </g>
          );
        })()}
      {freeDraw !== null &&
        freeDraw !== "idle" &&
        (() => {
          const start = anchorPos(freeDraw.a);
          if (start === null) return null;
          const path = [start, ...freeDraw.via];
          if (freeCursor !== null) path.push(freeCursor);
          return (
            <g className="ceiling-free-draw">
              {path.length >= 2 && (
                <polyline
                  points={path
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ")}
                  className="ceiling-line dropCeiling"
                  fill="none"
                />
              )}
              <text
                x={start.x}
                y={start.y}
                className="dim ceiling"
                fontSize={fontFix ?? dimFontSize}
              >
                ①
              </text>
              {freeDraw.via.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={cornerRadius}
                  className="corner"
                />
              ))}
              {freeCursor !== null && freeCursor.onEdge && (
                <text
                  x={freeCursor.x}
                  y={freeCursor.y}
                  className="dim ceiling"
                  fontSize={fontFix ?? dimFontSize}
                >
                  ②
                </text>
              )}
            </g>
          );
        })()}
      {showCeiling &&
        ceilingCodes.flatMap((region) =>
          region.centers.map((center, no) => {
            const moved = codes.moves[region.code] ?? { x: 0, y: 0 };
            return (
              <text
                key={`${region.code}-${no}`}
                x={center.x + moved.x}
                y={center.y + moved.y}
                className="ceiling-code"
                textAnchor="middle"
                fontSize={fontFix ?? dimFontSize * 1.3}
                onPointerDown={(event) => startCodeDrag(region.code, event)}
                onPointerMove={moveCodeDrag}
                onPointerUp={endCodeDrag}
                onDoubleClick={() =>
                  changeCodes((current) => {
                    const moves = { ...current.moves };
                    delete moves[region.code];
                    return { ...current, moves };
                  })
                }
              >
                {region.code}
              </text>
            );
          }),
        )}
      {!printMode && <UnderlayScaleMarks u={underlayTool} span={view.span} />}
    </>
  );

  /** 上段（図・寸法入力・記号・建具・天井伏図）。印刷では紙の1枚目に入れる */
  const upperArea = (
    <div className={expanded ? "upper expanded" : "upper"}>
      <section className="drawing">
        <div className="section-bar">
          <span>部屋形状イメージ</span>
          <button
            type="button"
            className={showCeiling ? "on" : ""}
            onClick={() => setShowCeiling(!showCeiling)}
          >
            {showCeiling ? "□ 平面図へ" : "▤ 天井伏図へ"}
          </button>
          <button
            type="button"
            className={showTrace ? "on" : ""}
            title="Shift+Windows+S で切り取った図面を Ctrl+V で貼り付け、なぞって部屋形状にします"
            onClick={() => {
              // 複数の図面があるときは「いま選んでいる図面」をそのままなぞる画面に映す
              // （別の画像データが混ざって重なって出るのを防ぐ）
              const picked =
                underlays[Math.min(underlayTool.active, underlays.length - 1)];
              if (picked !== undefined && picked.image !== "") {
                setTrace({
                  ...trace,
                  image: picked.image,
                  metersPerPixel: picked.metersPerPixel,
                });
              } else {
                setTrace(traceFromUnderlay(trace, underlay));
              }
              setShowTrace(true);
            }}
          >
            🖼 図面をなぞる
          </button>
          {/* 図面はこの画面でそのまま貼る・開く（ファイルは複数まとめて選べる）。なぞる画面からも入れられる */}
          <UnderlayTools u={underlayTool} />
          <button
            type="button"
            className={expanded ? "on" : ""}
            title="図を画面いっぱいに開いて、そのまま入力できます"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "✕ 閉じる" : "⤡ 大きく開く"}
          </button>
          <button
            type="button"
            className={showMini ? "on" : ""}
            title="図を小さな窓で右下に浮かせます（計算書に数字を入れながら図が見られます。上の帯をつかんで動かせ、角で大きさも変えられます）"
            onClick={() => setShowMini(!showMini)}
          >
            🗔 図の小窓
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
              disabled={solved.edges.length === 0}
              title="出来た図形の辺を1本選んでから押すと、その辺の実寸を入れて図形全体を同じ比率で拡大・縮小します（図面をなぞってできた形の縮尺合わせに使えます）"
              onClick={() => {
                const row = solved.edges.find(
                  (item) => item.id === selectedEdge,
                );
                if (
                  row === undefined ||
                  row.resolved === null ||
                  row.resolved <= 0
                ) {
                  setMessage(
                    "基準にする辺を図か表で1本選んでから押してください",
                  );
                  return;
                }
                setPrompt({
                  kind: "scale",
                  edgeId: row.id,
                  current: row.resolved,
                  value: formatNumber(row.resolved, 2),
                });
              }}
            >
              📏 縮尺を合わせる
            </button>
            <button
              type="button"
              disabled={solved.edges.length === 0}
              title="選んだ辺が水平（右向き・左向きの近い方）になるよう、辺の起点に図形全体を回します（貼った図面も一緒に回ります）"
              onClick={() => void rotateAtEdge("horizontal")}
            >
              ↔ 辺を水平に
            </button>
            <button
              type="button"
              disabled={solved.edges.length === 0}
              title="選んだ辺が垂直（下向き・上向きの近い方）になるよう、辺の起点に図形全体を回します（貼った図面も一緒に回ります）"
              onClick={() => void rotateAtEdge("vertical")}
            >
              ↕ 辺を垂直に
            </button>
            <button
              type="button"
              className={kindPick !== null ? "on" : ""}
              disabled={shape.edges.length === 0}
              title="押してから図の壁線をまとめてクリックし、「柱にする」（または「壁に戻す」）で一括で種別を変えます"
              onClick={() => {
                if (kindPick !== null) {
                  setKindPick(null);
                  setMessage("種別の選びをやめました");
                  return;
                }
                setKindPick([]);
                setAddCornerMode(false);
                setMessage(
                  "種別を変える線を図でクリックして選んでください（何本でも）。そのあと「柱にする」か「壁に戻す」を押します",
                );
              }}
            >
              壁⇄柱
            </button>
            {kindPick !== null && (
              <span className="kind-pick">
                <span>{kindPick.length}本選択</span>
                <button
                  type="button"
                  disabled={kindPick.length === 0}
                  onClick={() => applyPickedKind("column")}
                >
                  ✓ 柱にする
                </button>
                <button
                  type="button"
                  disabled={kindPick.length === 0}
                  onClick={() => applyPickedKind("wall")}
                >
                  ✓ 壁に戻す
                </button>
                <button
                  type="button"
                  disabled={kindPick.length === 0}
                  onClick={() => {
                    setKindPick([]);
                    setMessage("選びを外しました");
                  }}
                >
                  選び直す
                </button>
              </span>
            )}
            <button
              type="button"
              className={columnMode ? "on" : ""}
              disabled={shape.edges.length === 0}
              title="押してからＷ・Ｄを決め、図の中をクリックすると部屋の中に独立柱を置きます"
              onClick={() => {
                const next = !columnMode;
                setColumnMode(next);
                setColumnGhost(null);
                if (next) {
                  setKindPick(null);
                  setAddCornerMode(false);
                }
                setMessage(
                  next
                    ? "Ｗ・Ｄを決めて、柱を置く所を図でクリックしてください（カーソルに柱の形がついていきます）"
                    : "独立柱を置くのをやめました",
                );
              }}
            >
              ▣ 独立柱
            </button>
            {(columnMode || selectedColumn !== null) && (
              <span className="kind-pick">
                <span>Ｗ</span>
                <input
                  className="num"
                  value={columnWidth}
                  onChange={(e) => setColumnWidth(e.target.value)}
                  onBlur={(e) => {
                    const width = Number(e.target.value);
                    const depth = Number(columnDepth);
                    if (width > 0 && depth > 0) resizeFreeColumn(width, depth);
                  }}
                />
                <span>Ｄ</span>
                <input
                  className="num"
                  value={columnDepth}
                  onChange={(e) => setColumnDepth(e.target.value)}
                  onBlur={(e) => {
                    const depth = Number(e.target.value);
                    const width = Number(columnWidth);
                    if (width > 0 && depth > 0) resizeFreeColumn(width, depth);
                  }}
                />
                <span>{(shape.columns ?? []).length}本</span>
                <button
                  type="button"
                  disabled={selectedColumn === null}
                  title="選んでいる柱を、壁として数えるか柱として数えるかを切替えます"
                  onClick={toggleFreeColumnKind}
                >
                  {(shape.columns ?? []).find(
                    (column) => column.id === selectedColumn,
                  )?.kind === "wall"
                    ? "▦ 柱に戻す"
                    : "▦ 壁にする"}
                </button>
                <button
                  type="button"
                  disabled={selectedColumn === null}
                  title="選んでいる独立柱を消します"
                  onClick={removeFreeColumn}
                >
                  🗑 この柱を消す
                </button>
              </span>
            )}
            <button
              type="button"
              disabled={shape.edges.length === 0}
              title="今の図形を左右に反転します（寸法はそのまま）"
              onClick={() => flipShape("x")}
            >
              ⇔ 左右反転
            </button>
            <button
              type="button"
              disabled={shape.edges.length === 0}
              title="今の図形を上下に反転します（寸法はそのまま）"
              onClick={() => flipShape("y")}
            >
              ⇕ 上下反転
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
                onClick={() => moveSelectedCorner(-Math.abs(Number(moveX)), 0)}
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
                onClick={() => moveSelectedCorner(0, -Math.abs(Number(moveY)))}
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
                onClick={() => moveSelectedCorner(Number(moveX), Number(moveY))}
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
            <button
              type="button"
              title="下敷きの図面があるときは、全体が画面に入る大きさにします（＋−で原寸の何倍かにできます）"
              onClick={() =>
                setZoom(
                  underlayScale !== null && canvasSize > 0
                    ? Math.max((canvasSize * underlayScale) / view.span, 0.05)
                    : 1,
                )
              }
            >
              全体
            </button>
            <button
              type="button"
              className={showCorners ? "on" : ""}
              title="角の○印を出す／消す（形が決まったら消せます）"
              onClick={() => {
                const next = !showCorners;
                if (!next) setSelectedCorner(null);
                setShowCorners(next);
                window.localStorage.setItem(CORNERS_KEY, next ? "1" : "0");
              }}
            >
              {showCorners ? "○角を消す" : "○角を出す"}
            </button>
          </div>
          <div
            className={
              underlayScale !== null ? "canvas has-underlay" : "canvas"
            }
            ref={canvasRef}
          >
            <svg
              viewBox={view.box}
              className={underlayTool.svgClass}
              style={
                underlayScale !== null
                  ? { width: `${drawnSize}px`, height: `${drawnSize}px` }
                  : { width: `${zoom * 100}%`, height: `${zoom * 100}%` }
              }
              onClick={(event) => {
                if (!printMode && underlayTool.onSvgClick(event)) return;
                if (freeDraw !== null) {
                  clickFreeDraw(event);
                  return;
                }
                if (columnMode) addFreeColumn(event);
              }}
              onPointerDown={printMode ? undefined : underlayTool.onPointerDown}
              onPointerMove={(event) => {
                underlayTool.onPointerMove(event);
                if (columnMode) setColumnGhost(svgPoint(event));
                if (freePointDragRef.current !== null) return;
                if (freeDraw !== null && freeDraw !== "idle") {
                  const point = svgPoint(event);
                  if (point === null) {
                    setFreeCursor(null);
                    return;
                  }
                  const near = nearestAnchor(point);
                  const snapped =
                    near !== null && near.gap <= freeSnap
                      ? anchorPos({
                          edgeId: near.edgeId,
                          rate: near.rate,
                        })
                      : null;
                  setFreeCursor(
                    snapped !== null
                      ? { ...snapped, onEdge: true }
                      : { ...point, onEdge: false },
                  );
                }
              }}
              onPointerUp={underlayTool.onPointerUp}
              onPointerLeave={() => setColumnGhost(null)}
            >
              <g id="room-drawing">{renderDrawingContent(null)}</g>
              {columnMode &&
                columnGhost !== null &&
                Number(columnWidth) > 0 &&
                Number(columnDepth) > 0 && (
                  <g pointerEvents="none">
                    <rect
                      x={columnGhost.x - Number(columnWidth) / 2}
                      y={columnGhost.y - Number(columnDepth) / 2}
                      width={Number(columnWidth)}
                      height={Number(columnDepth)}
                      className="free-column-ghost"
                    />
                    <text
                      x={columnGhost.x}
                      y={
                        columnGhost.y -
                        Number(columnDepth) / 2 -
                        dimFontSize * 0.3
                      }
                      className="dim"
                      textAnchor="middle"
                      fontSize={dimFontSize}
                    >
                      {`${formatNumber(Number(columnWidth), 2)}×${formatNumber(Number(columnDepth), 2)}`}
                    </text>
                  </g>
                )}
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
          <label className="ceiling-height">
            天井高さ
            <input
              className="num"
              key={`ech-${sheet?.id ?? "new"}-${formatNumber(ceilingHeight, 2)}`}
              defaultValue={formatNumber(ceilingHeight, 2)}
              title="この部屋の天井高さ（記号CH）。直すと部位別入力表の天井高さも変わります"
              onBlur={(e) => applyCeilingHeight(e.target.value)}
            />
          </label>
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
          <button
            type="button"
            disabled={selectedEdge === null || rangeEdge === null}
            title="始めの辺をクリックし、終わりの辺をShift＋クリックで選んでから押すと、その間の辺（表の並び順に進みます。一周をまたいでも選べます）をまとめて消し、まっすぐな壁でそろえます"
            onClick={() => {
              if (selectedEdge === null || rangeEdge === null) return;
              const result = trimEdges(shape, selectedEdge, rangeEdge);
              if (result.error !== null) {
                setMessage(result.error);
                return;
              }
              applyShape(result.shape);
              setSelectedEdge(null);
              setRangeEdge(null);
            }}
          >
            ▭ 範囲をまとめる
          </button>
        </div>
        <table className={printMode ? "grid print" : "grid"}>
          <thead>
            <tr>
              {!printMode && (
                <th
                  className="no"
                  title="選んでいる辺（行か図の線をクリック。終わりの辺はShift＋クリック）"
                >
                  選
                </th>
              )}
              <th className="no">No</th>
              <th>向き</th>
              <th className="num">
                <span className="dim-split">
                  <span>寸法</span>
                  <span title="壁・柱の高さ（空欄は面する天井区画から自動算出。壁面積WA・柱面積HAに効く）">
                    平均高さ
                  </span>
                </span>
              </th>
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
                  (kindPick ?? []).includes(line.id) ? "picked" : "",
                  selectedEdgeIds.includes(line.id) ? "selected" : "",
                  solved.missing.includes(line.id) ? "missing" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={(event) =>
                  kindPick !== null
                    ? toggleKindPick(line.id)
                    : selectEdge(line.id, event.shiftKey)
                }
              >
                {!printMode && (
                  <td className="no edge-pick">
                    {selectedEdgeIds.includes(line.id) ? "☑" : "☐"}
                  </td>
                )}
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
                  <span className="dim-split">
                    {isDiagonal(line.direction) ? (
                      <input
                        className="num"
                        defaultValue={formatNumber(line.resolved, 2)}
                        key={`${line.id}-len-${line.dx ?? 0}-${line.dy ?? 0}`}
                        title="斜め辺の長さ（有効長さ）。数字を入れると同じ向きのまま長さだけ変わります。「1.44 -1.16」のように横移動・縦移動の2つでも入れられます"
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          showAnswer(e.currentTarget);
                          e.currentTarget.blur();
                        }}
                        onBlur={(e) => {
                          const body = e.target.value.trim();
                          // 「横 縦」の2つで入れれば移動量をそのまま直す
                          const pair = body
                            .split(/[\s,、]+/)
                            .filter((part) => part !== "");
                          if (pair.length === 2) {
                            applyShape(
                              updateEdge(shape, line.id, {
                                dx: textToNumber(pair[0]) ?? 0,
                                dy: textToNumber(pair[1]) ?? 0,
                              }),
                            );
                            return;
                          }
                          const value = textToNumber(body);
                          if (value === null) return;
                          if (value < 0) {
                            setMessage(
                              "長さは0以上で入れてください（マイナスを入れたいときは「横 縦」の2つの数字で入れてください）",
                            );
                            return;
                          }
                          const dx = line.dx ?? 0;
                          const dy = line.dy ?? 0;
                          const current = Math.hypot(dx, dy);
                          if (value === 0) {
                            applyShape(
                              updateEdge(shape, line.id, { dx: 0, dy: 0 }),
                            );
                            return;
                          }
                          if (current < 0.005) {
                            setMessage(
                              "この辺は向きが分からないので長さを変えられません（「横 縦」の2つの数字で入れてください）",
                            );
                            return;
                          }
                          const factor = value / current;
                          applyShape(
                            updateEdge(shape, line.id, {
                              dx: round2(dx * factor),
                              dy: round2(dy * factor),
                            }),
                          );
                        }}
                      />
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
                          line.kind === "curve" || line.kind === "curveOpening"
                            ? "Ｒ壁・Ｒ開口は弦（両端を結ぶ直線）の長さを入れます（計算式も入れられます）"
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
                    {line.kind === "wall" ||
                    line.kind === "curve" ||
                    line.kind === "column" ? (
                      <input
                        className={`num height${typeof line.height === "number" ? " manual" : ""}`}
                        type="number"
                        step="0.05"
                        min="0"
                        defaultValue={
                          typeof line.height === "number"
                            ? formatNumber(line.height, 2)
                            : ""
                        }
                        key={`${line.id}-h-${line.height ?? "auto"}`}
                        placeholder={
                          ceilingHeight === null
                            ? ""
                            : formatNumber(
                                edgeHeights.get(line.id) ?? ceilingHeight,
                                2,
                              )
                        }
                        title="この辺の高さ（壁面積WA・柱面積HAにだけ効きます）。空欄にすると面する天井区画から自動算出します"
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.currentTarget.blur();
                        }}
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          if (text === "") {
                            if (typeof line.height === "number") {
                              applyShape(
                                updateEdge(shape, line.id, { height: null }),
                              );
                            }
                            return;
                          }
                          const value = textToNumber(text);
                          if (value === null || value <= 0) {
                            setMessage(
                              "高さは0より大きい数字で入れてください（空欄で自動に戻ります）",
                            );
                            return;
                          }
                          if (line.height === value) return;
                          applyShape(
                            updateEdge(shape, line.id, { height: value }),
                          );
                          setMessage(
                            `No.${index + 1} の高さを ${formatNumber(
                              value,
                              2,
                            )}m に直しました（壁面積WA・柱面積HAにだけ効きます。空欄で自動に戻ります）`,
                          );
                        }}
                      />
                    ) : (
                      <span className="none">－</span>
                    )}
                  </span>
                </td>
                <td>
                  {line.kind === "curve" || line.kind === "curveOpening" ? (
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
        <p className="note">
          辺は表の行でも図の線でもクリックで選べます（選んだ辺は「選」に☑が付き、図では太く光ります）。始めの辺を選んでから終わりの辺をShift＋クリックすると「ここからここまで」を選べ（表の並び順に進みます。17番→1番のように一周をまたぐ範囲も選べます）、「▭
          範囲をまとめる」でその間の辺をまとめて消し、始点と終点を結ぶまっすぐな壁（縦横がずれていれば2本）に置き換えます。形は閉じたままなので、1本ずつ消したときのように崩れません。
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
                  {/* W・H・腰高は建具表の値を見るだけ（寸法の直しは建具表で行う） */}
                  <td className="num">
                    {formatNumber(master?.width ?? null, 2)}
                  </td>
                  <td className="num">
                    {formatNumber(master?.height ?? null, 2)}
                  </td>
                  <td className="num">
                    {formatNumber(master?.sillHeight ?? null, 2)}
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
            <label className="ceiling-height">
              天井高さ
              <input
                className="num"
                key={`cch-${sheet?.id ?? "new"}-${formatNumber(ceilingHeight, 2)}`}
                defaultValue={formatNumber(ceilingHeight, 2)}
                title="この部屋の天井高さ（記号CH）。直すと部位別入力表の天井高さも変わります"
                onBlur={(e) => applyCeilingHeight(e.target.value)}
              />
            </label>
            <label
              className="ceiling-merge"
              title="入れると、離れていても天井高さが同じ区画を1つの番号にまとめます"
            >
              <input
                type="checkbox"
                checked={mergeCeiling}
                onChange={(e) => setMergeCeiling(e.target.checked)}
              />
              同じ高さをまとめる
            </label>
            <button
              type="button"
              disabled={!ceilingHistory.canUndo}
              title="1つ前の内容に戻します"
              onClick={undoCeiling}
            >
              ↶ 戻る
            </button>
            <button
              type="button"
              disabled={!ceilingHistory.canRedo}
              title="戻した内容を1つ先へ進めます"
              onClick={redoCeiling}
            >
              ↷ 進む
            </button>
            {(Object.keys(CEILING_KIND_LABEL) as CeilingElementKind[]).map(
              (kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={
                    kind === "dropCeiling"
                      ? solved.edges.length === 0
                      : wallEdges.length === 0
                  }
                  onClick={() =>
                    changeCeiling((current) => [
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
            <button
              type="button"
              className={freeDraw !== null ? "on" : ""}
              disabled={solved.edges.length === 0}
              title="壁に沿わない下がり天井を、図の上でクリックして引きます（①→部屋の中で折れ点→辺の近くで②。折れ点でL字・コの字になります）"
              onClick={() => {
                if (freeDraw !== null) {
                  setFreeDraw(null);
                  setFreeCursor(null);
                  return;
                }
                setFreeDraw("idle");
                setFreeCursor(null);
                setMessage(
                  "①を置く場所を上の図でクリックしてください（線の端は近い辺の上に付きます。部屋の中をクリックすると折れ点、辺の近くで②。もう一度押すとやめます）",
                );
              }}
            >
              ✏ 自由線を引く
            </button>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th className="ceiling-actions" />
                <th className="no">番号</th>
                <th>種別</th>
                <th>沿う壁</th>
                <th className="num">長さ</th>
                <th className="num" title="梁幅・下がり天井の見付">
                  Ｗ幅
                </th>
                <th
                  className="num"
                  title="梁せい・下がり壁の高さ（入れると壁の高さは自動）"
                >
                  Ｈ高さ
                </th>
                <th className="num">壁からの離れ</th>
                <th
                  className="num"
                  title="その梁・下がり壁が取りつく天井の高さ。空なら自動（下がり天井の中なら下がった天井）"
                >
                  取りつく天井(m)
                </th>
                <th
                  className="num"
                  title="取りつく天井高さ−Ｈ。ここに入れるとＨが自動で合います"
                >
                  壁高さ(m)
                </th>
                <th className="num" title="部屋の天井高さからの下がり">
                  下がり(m)
                </th>
                <th className="num">面積(㎡)</th>
              </tr>
            </thead>
            <tbody>
              {ceilingResult.items.map((item, itemNo) => {
                const element = item.element;
                return (
                  <tr
                    key={element.id}
                    className={pickedCeiling === element.id ? "picked" : ""}
                    onClick={() => setPickedCeiling(element.id)}
                  >
                    <td className="ceiling-actions">
                      {(() => {
                        const parts = splitCeiling.get(element.id) ?? null;
                        return parts === null ? null : (
                          <button
                            type="button"
                            title={`梁型・下がり壁で分かれている${parts.length}本を別々の下がり天井の行にします（片側だけ消す・高さを変えるとき）`}
                            onClick={(e) => {
                              e.stopPropagation();
                              changeCeiling((current) =>
                                current.flatMap((each) =>
                                  each.id === element.id ? parts : [each],
                                ),
                              );
                              setPickedCeiling(parts[0].id);
                            }}
                          >
                            ✂ {parts.length}本に分ける
                          </button>
                        );
                      })()}
                      {element.range ? (
                        <button
                          type="button"
                          title="範囲を外して壁から壁までの下がり天井に戻します"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateCeiling(element.id, { range: null });
                          }}
                        >
                          ↔ 壁まで
                        </button>
                      ) : null}
                      <button
                        type="button"
                        title={
                          element.range
                            ? "この範囲の下がり天井だけ消す"
                            : "この行を消す"
                        }
                        onClick={() =>
                          changeCeiling((current) =>
                            current.filter((each) => each.id !== element.id),
                          )
                        }
                      >
                        🗑
                      </button>
                    </td>
                    <td className="no">{itemNo + 1}</td>
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
                        value={
                          element.free !== null && element.free !== undefined
                            ? "__free__"
                            : (element.edgeId ?? "")
                        }
                        onChange={(e) => {
                          // 範囲は元の壁の角から測っているので、壁を変えたら壁から壁までに戻す
                          if (
                            e.target.value === "__free__" &&
                            element.kind === "dropCeiling"
                          ) {
                            updateCeiling(element.id, {
                              edgeId: null,
                              range: null,
                              free: defaultFree(),
                            });
                            return;
                          }
                          updateCeiling(element.id, {
                            edgeId:
                              e.target.value === "" ? null : e.target.value,
                            range: null,
                            free: null,
                          });
                        }}
                      >
                        <option value="">指定なし</option>
                        {wallEdges.map((line, wallIndex) => (
                          <option key={line.id} value={line.id}>
                            壁{wallIndex + 1}（{formatNumber(line.resolved, 2)}
                            ）
                          </option>
                        ))}
                        {element.kind === "dropCeiling" && (
                          <option value="__free__">
                            自由線（辺の上の2点）
                          </option>
                        )}
                      </select>
                      {element.kind === "dropCeiling" &&
                      element.free !== null &&
                      element.free !== undefined
                        ? (["a", "b"] as const).map((side) => {
                            const anchor = element.free?.[side];
                            if (anchor === undefined) return null;
                            const anchorEdge = solved.edges.find(
                              (row) => row.id === anchor.edgeId,
                            );
                            const edgeLength = anchorEdge?.resolved ?? 0;
                            return (
                              <span key={side} className="ceiling-anchor">
                                {side === "a" ? "①" : "②"}
                                <select
                                  value={anchor.edgeId}
                                  onChange={(e) =>
                                    setFreeAnchor(element, side, {
                                      edgeId: e.target.value,
                                    })
                                  }
                                >
                                  {solved.edges.map((row, edgeIndex) => (
                                    <option key={row.id} value={row.id}>
                                      辺{edgeIndex + 1}
                                    </option>
                                  ))}
                                </select>
                                の
                                <input
                                  className="num"
                                  key={`${anchor.edgeId}-${anchor.rate}`}
                                  defaultValue={formatNumber(
                                    anchor.rate * edgeLength,
                                    2,
                                  )}
                                  title="辺の始まりの角からの位置（m。0なら始まりの角）"
                                  onBlur={(e) => {
                                    const value = Number(e.target.value.trim());
                                    if (Number.isNaN(value) || edgeLength <= 0)
                                      return;
                                    setFreeAnchor(element, side, {
                                      rate: Math.max(
                                        0,
                                        Math.min(1, value / edgeLength),
                                      ),
                                    });
                                  }}
                                />
                                m
                              </span>
                            );
                          })
                        : null}
                    </td>
                    <td>
                      {element.kind === "dropCeiling" ||
                      element.kind === "ceilingBeam" ? (
                        // 図で止まったところまでの長さ（手入力できると図と合わなくなる）
                        <span
                          className="num"
                          title={
                            element.range
                              ? `壁${wallEdges.findIndex((line) => line.id === element.edgeId) + 1}の始まりの角から ${formatNumber(element.range.from, 2)}～${formatNumber(element.range.to, 2)}m の範囲だけ（梁型で分けた下がり天井）`
                              : "自動（図に出る段差の線の長さ。突き当たる壁・自分より低い下がり天井・梁型まで）"
                          }
                        >
                          {formatNumber(item.length, 2)}
                          {element.range ? (
                            <small className="ceiling-range">
                              {" "}
                              {formatNumber(element.range.from, 2)}～
                              {formatNumber(element.range.to, 2)}
                            </small>
                          ) : null}
                        </span>
                      ) : (
                        <input
                          className="num"
                          defaultValue={
                            element.length === null
                              ? ""
                              : formatNumber(element.length, 2)
                          }
                          placeholder={formatNumber(item.length, 2)}
                          title="空欄なら沿う壁の長さ"
                          onBlur={(e) => {
                            const text = e.target.value.trim();
                            updateCeiling(element.id, {
                              length: text === "" ? null : Number(text),
                            });
                          }}
                        />
                      )}
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
                          element.height === null ||
                          element.height === undefined
                            ? ""
                            : formatNumber(element.height, 2)
                        }
                        title="Ｈ（梁せい・下がり壁の高さ・下がり天井の下がり）。入れると壁高さは取りつく天井から自動で決まります"
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          updateCeiling(element.id, {
                            height: text === "" ? null : Number(text),
                            ceilingHeight: null,
                          });
                        }}
                      />
                    </td>
                    <td>
                      {element.free !== null &&
                      element.free !== undefined &&
                      element.kind === "dropCeiling" ? (
                        <span
                          className="num"
                          title="自由線は両端の位置で決まります（「沿う壁」で壁に戻すと離れが使えます）"
                        >
                          ―
                        </span>
                      ) : (
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
                      )}
                    </td>
                    <td>
                      <input
                        className="num"
                        key={`base-${element.id}-${item.baseHeight ?? ""}`}
                        defaultValue={
                          element.baseHeight === null ||
                          element.baseHeight === undefined
                            ? ""
                            : formatNumber(element.baseHeight, 2)
                        }
                        placeholder={formatNumber(item.baseHeight, 2)}
                        title="空なら自動（その位置の天井。梁の前に下がり天井があればその高さ）"
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          updateCeiling(element.id, {
                            baseHeight: text === "" ? null : Number(text),
                          });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        key={`wall-${element.id}-${item.wallHeight ?? ""}`}
                        defaultValue={formatNumber(item.wallHeight, 2)}
                        title="取りつく天井高さ−Ｈ。ここを直すとＨが自動で合います"
                        onBlur={(e) => {
                          const text = e.target.value.trim();
                          if (text === "") {
                            updateCeiling(element.id, {
                              height: null,
                              ceilingHeight: null,
                            });
                            return;
                          }
                          const value = Number(text);
                          if (Number.isNaN(value)) return;
                          // 壁高さを入れたらＨ（梁せい・下がり）を合わせる
                          updateCeiling(
                            element.id,
                            item.baseHeight === null
                              ? { ceilingHeight: value, height: null }
                              : {
                                  height: round2(item.baseHeight - value),
                                  ceilingHeight: null,
                                },
                          );
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
                          placeholder={formatNumber(item.area, 2)}
                          title="下がり天井の段差の見付面積（空欄なら長さ×段差で自動）"
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
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ceilingCodes.length > 0 && (
            <table className="grid ceiling-regions">
              <thead>
                <tr>
                  <th className="no">番号</th>
                  <th className="num">天井高さ(m)</th>
                  <th className="num">下がり(m)</th>
                  <th className="num">区画の面積(㎡)</th>
                </tr>
              </thead>
              <tbody>
                {ceilingCodes.map((region) => (
                  <tr key={region.code}>
                    <td className="no">{region.code}</td>
                    <td className="num">
                      <RegionNumberCell
                        value={region.height}
                        title="この区画の天井高さ（この区画だけが変わります。空欄で既定に戻ります）"
                        onCommit={(text) => setRegionHeight(region, text)}
                      />
                    </td>
                    <td className="num">
                      <RegionNumberCell
                        value={region.drop}
                        title="この区画の下がり（部屋の天井高さからの下がり。空欄で既定に戻ります）"
                        onCommit={(text) => setRegionDropText(region, text)}
                      />
                    </td>
                    <td className="num">{formatNumber(region.area, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">
            梁型・下がり壁はＷ（幅）とＨ（梁せい）を入れれば、壁高さは「取りつく天井高さ−Ｈ」で自動で決まります。取りつく天井は自動で見ます（梁の前に下がり天井があればその下がった天井。違うときは「取りつく天井」欄に入れれば上書きできます）。壁高さの欄を直すとＨが自動で合います。壁付き梁型・下がり壁は壁の長さのまま。下がり天井は、突き当たる壁か、梁型・下がり壁の線、自分より低い下がり天井のところまで自動で伸びます（梁型は天井より低く見えるときだけ入れる線なので、下がり天井の端部は壁か梁になります）。天井付梁型は、突き当たる壁か、自分より低くなる線のところまで伸びます。天井の区画は下がり天井の線と梁型（壁付き・天井付）の梁底で分け（梁型で分断された天井は別々の区画。梁底そのものには番号を付けません）、すべての区画にC1・C2…の番号を中央に出します（左上からの順）。隣り合っていて高さが同じ区画は1つにまとめます。離れた所も1つにまとめたいときは「同じ高さをまとめる」を入れてください（離れた所にも同じ番号を出します）。線は区画のふちから引くので、高さが違う区画の境目だけが点線で途切れずに出ます（同じ高さの所の線は消えます。1本の線でも、高さが違う所だけが点線になります）。Ｈ高さが空の下がり天井は「高さがまだ決まっていない」ものとして線を残し、区画も分けます。Ｈ高さに0を入れると、そこは「部屋と同じ高さ」に戻ります（同じ所が重なっているときは後の行が優先なので、下がり天井の中に0の帯を入れると、その帯だけ元の高さに戻り、境目に点線が出ます）。「⤡
            大きく開く」で天井伏図を開いているときは入力用の表示になり、線で区切られた範囲すべてにＣ記号を出します（区画一覧の天井高さに、その範囲の高さを入れてください）。境目の線（点線）は両側の高さが違う所だけに出て、両側が同じ高さになった所（区画に入れた高さで同じになった所も）は消えます。閉じた通常画面と印刷も同じです。図の線をクリックすると、上の入力表のその行が光ります（表の行をクリックしても線が光ります）。下がり天井の高さは、上の入力表のＨ高さ（または壁高さ）に入れてください。高さが違う所に線が出ます。番号はつかんで好きな位置へ動かせます（ダブルクリックで元の位置に戻ります）。部屋の天井高さとの差（下がり）から面積を自動算出します。梁型面積は仕上げる面で、壁付き梁型は長さ×（Ｗ幅＋Ｈ）（梁底＋見付1面）、天井付梁型は長さ×（Ｗ幅＋Ｈ×2）（梁底＋見付2面）、下がり壁は見付で長さ×Ｈ（下がり）です。下がり天井の面積（SA）は段差の見付で、段差になっている長さ×その所の段差の高さ（両側の天井高さの差）です（Ｈが0の線でも、反対側と高さが違えば面積が出ます）。範囲の天井面積は下の区画一覧の「区画の面積」で見てください。SLH1…は段差の高さごとの長さです。区画の面積と天井面積（CA）は、梁型の梁底（長さ×Ｗ幅）の分を引いた面積です。区画一覧の天井高さ・下がりはどの区画でもそのまま入力でき、入れた区画だけが変わります（隣の区画や上の入力表のＨは変わりません。上の入力表の下がり天井のＨは、その線で下がる側の区画の既定の高さです）。区画に入れた高さは、その区画の場所で覚えます（線を足して区画が分かれても残ります）。空欄にすると既定（下がり天井のＨ、なければ部屋の天井高さ）に戻ります。記号はGL/GA・BL/BA・DWL/DWA・SL/SA（下がり天井は高さごとにSLH1…）。
          </p>
          <p className="note">
            下がり天井の「沿う壁」を「自由線（辺の上の2点）」にすると、壁に沿わない線を引けます。①と②の端点を「辺○の、始まりの角から○m」の形で入れます（線はその2点を結んだもので、部屋から出る所は部屋のふちで切れます）。線の下がる側は①→②の左側です。反対側に下げたいときは①と②を入れ替えてください（線を選ぶと出る○の持ち手をつかんで動かすか、欄で位置を直します）。
          </p>
        </section>
      )}

      {prompt && (
        <div
          className="shape-prompt-overlay"
          // 後ろを押したときは寸法欄へカーソルを戻す（入力先が外れないようにする）
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const input = promptInputRef.current;
            if (input) {
              input.focus();
              input.select();
            }
          }}
        >
          <div
            className="shape-prompt"
            ref={promptBoxRef}
            // 小窓の余白や文字を押しても、カーソルは寸法欄に置いたままにする
            onClick={(e) => {
              const target = e.target;
              const onControl =
                target instanceof HTMLInputElement ||
                target instanceof HTMLSelectElement ||
                target instanceof HTMLButtonElement;
              if (onControl) return;
              const input = promptInputRef.current;
              if (
                input &&
                !(document.activeElement instanceof HTMLInputElement)
              ) {
                input.focus();
                input.select();
              }
            }}
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
              ) : prompt.kind === "scale" ? (
                <label>
                  選んだ辺の実寸
                  <input
                    className="num"
                    ref={promptInputRef}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onMouseDown={selectWholeOnFirstClick}
                    value={prompt.value}
                    onChange={(e) =>
                      setPrompt({ ...prompt, value: e.target.value })
                    }
                    onKeyDown={(e) => e.key === "Enter" && submitPrompt()}
                  />
                  <span className="hint">
                    （いま {formatNumber(prompt.current, 2)}
                    m。全部の辺・独立柱が同じ比率で拡大・縮小します）
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
                        {(Object.keys(KIND_LABEL) as EdgeKind[]).map((key) => (
                          <option key={key} value={key}>
                            {KIND_LABEL[key]}
                          </option>
                        ))}
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
        <section
          className="fittings popup"
          style={
            fittingsPos === null
              ? undefined
              : { left: fittingsPos.x, top: fittingsPos.y, right: "auto" }
          }
        >
          <div
            className="section-bar"
            style={{ cursor: "move" }}
            title="この帯をつかんで動かせます"
            onPointerDown={(event) => {
              // ボタン・入力欄を押したときは動かさない
              if (
                (event.target as HTMLElement).closest(
                  "button,input,select,textarea",
                )
              )
                return;
              const section = event.currentTarget.parentElement;
              if (section === null) return;
              const rect = section.getBoundingClientRect();
              fittingsDragRef.current = {
                fromX: event.clientX,
                fromY: event.clientY,
                baseX: rect.left,
                baseY: rect.top,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = fittingsDragRef.current;
              if (drag === null) return;
              setFittingsPos({
                x: Math.max(0, drag.baseX + event.clientX - drag.fromX),
                y: Math.max(0, drag.baseY + event.clientY - drag.fromY),
              });
            }}
            onPointerUp={() => {
              fittingsDragRef.current = null;
            }}
          >
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
  );

  if (printMode)
    return (
      <CalcPrintSheet
        title={`部屋別計算書　${project.managementNo} ${project.name}　${roomName || "（部屋名なし）"}`}
        upper={upperArea}
        sets={lower}
        result={calcResult}
      />
    );

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
            key={`ch-${sheet?.id ?? "new"}-${formatNumber(ceilingHeight, 2)}`}
            onBlur={(e) => applyCeilingHeight(e.target.value)}
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
        <button
          type="button"
          className={showCeiling ? "on" : ""}
          onClick={() => setShowCeiling(!showCeiling)}
        >
          {showCeiling ? "□ 平面図へ" : "▤ 天井伏図へ"}
        </button>
        <button
          type="button"
          className={expanded ? "on" : ""}
          title="図を画面いっぱいに開いて、そのまま入力できます"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "✕ 閉じる" : "⤡ 大きく開く"}
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
        windowTitle={`部屋計算書　${project.managementNo} ${roomName || "（部屋名なし）"}`}
        template={lowerTemplate}
      />

      {showTrace && !printMode && (
        <RoomTracePanel
          trace={trace}
          onChange={setTrace}
          underlays={underlays}
          activeIndex={underlayTool.active}
          onUnderlay={(perPixel) => {
            // なぞらずに図面だけを図形の下敷きにする。同じ図面が既にあればその枚をそろえる（重複しない）。
            // 無ければ新しい1枚として足す（2枚目以降は今ある図面の右横。縮尺がまだなら仮の縮尺で置く）
            const fallback =
              Math.max(
                extents === null ? 0 : Math.max(extents.x, extents.y),
                10,
              ) / 1000;
            const matchIndex = underlays.findIndex(
              (item) => item.image === trace.image,
            );
            // 画像データが別経路で貼られて一致しないときは、なぞる画面を開いた（いま選んでいる）図面をその対象にする
            const slotIndex =
              matchIndex >= 0
                ? matchIndex
                : Math.min(underlayTool.active, underlays.length - 1);
            const matched = slotIndex >= 0 ? underlays[slotIndex] : undefined;
            const next = {
              image: trace.image,
              metersPerPixel:
                perPixel > 0 ? perPixel : (matched?.metersPerPixel ?? fallback),
              x: matched?.x ?? underlayTool.nextSpot.x,
              y: matched?.y ?? underlayTool.nextSpot.y,
              opacity: matched?.opacity ?? underlay.opacity,
              ...(perPixel > 0 || matched?.scaled === true
                ? { scaled: true }
                : {}),
            };
            if (matched === undefined) {
              setUnderlays([...underlays, next], underlays.length);
            } else {
              setUnderlays(
                underlays.map((item, index) =>
                  index === slotIndex ? next : item,
                ),
                slotIndex,
              );
            }
            setShowTrace(false);
            setMessage(
              perPixel > 0
                ? "図面を図形の下に敷きました（動かす・濃さは図の上のボタンで調整できます）"
                : "図面を図形の下に敷きました（縮尺は仮です。「⤢ 縮尺合わせ」で図形に合わせてください）",
            );
          }}
          onApply={(next, meters, _pixels, perPixel) => {
            applyShape(next);
            // なぞった図面と縮尺を図形の下敷きにそろえ、なぞった位置に重なるように置く。
            // 同じ図面が既にあればその枚だけを書き替え、無ければ新しい1枚として足す（他の図面は変えない）
            if (trace.image === "") {
              setUnderlay(underlayAtTraceOrigin(underlay, meters));
            } else {
              const matchIndex = underlays.findIndex(
                (item) => item.image === trace.image,
              );
              // 画像データが別経路で貼られて一致しないときは、なぞる画面を開いた（いま選んでいる）図面をその対象にする
              const slotIndex =
                matchIndex >= 0
                  ? matchIndex
                  : Math.min(underlayTool.active, underlays.length - 1);
              const base =
                slotIndex >= 0
                  ? underlays[slotIndex]
                  : {
                      image: trace.image,
                      metersPerPixel: 0,
                      x: 0,
                      y: 0,
                      opacity: underlay.opacity,
                    };
              const synced =
                underlayForTrace(
                  { ...trace, metersPerPixel: perPixel },
                  base,
                ) ?? base;
              const placed = underlayAtTraceOrigin(synced, meters);
              if (slotIndex >= 0) {
                setUnderlays(
                  underlays.map((item, index) =>
                    index === slotIndex ? placed : item,
                  ),
                  slotIndex,
                );
              } else {
                setUnderlays([...underlays, placed], underlays.length);
              }
            }
            setShowTrace(false);
            const madeSolved = solveShape(next);
            const madeSize = shapeExtents(madeSolved);
            const madeArea = floorArea(madeSolved);
            setMessage(
              madeSize === null
                ? "なぞった形を部屋形状にしました（寸法は表で直せます。図面となぞりは数量根拠として保存します）"
                : `なぞった形を部屋形状にしました：横${madeSize.x.toFixed(2)}m×縦${madeSize.y.toFixed(2)}m／床面積${(madeArea ?? 0).toFixed(2)}㎡（寸法は表で直せます。図面となぞりは数量根拠として保存します）`,
            );
          }}
          onClose={() => setShowTrace(false)}
        />
      )}

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

      {/* 図を見ながら計算書に数字を入れるための小窓（上の帯をつかんで動かせる。角で大きさを変えられる） */}
      {showMini && !printMode && (
        <div
          className="mini-drawing"
          style={{ left: miniPos.x, top: miniPos.y }}
        >
          <div
            className="mini-drawing-head"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              miniDragRef.current = {
                dx: event.clientX - miniPos.x,
                dy: event.clientY - miniPos.y,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = miniDragRef.current;
              if (start === null) return;
              setMiniPos({
                x: Math.max(0, event.clientX - start.dx),
                y: Math.max(0, event.clientY - start.dy),
              });
            }}
            onPointerUp={(event) => {
              miniDragRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          >
            <span>図（見ながら入力できます）</span>
            <span className="mini-drawing-btns">
              <button
                type="button"
                title="図を大きくする（数字の大きさは変わりません）"
                onClick={() => miniZoomTo(Math.min(miniZoom * 1.6, 40))}
              >
                ＋
              </button>
              <button
                type="button"
                title="図を小さくする"
                onClick={() => miniZoomTo(Math.max(miniZoom / 1.6, 1))}
              >
                －
              </button>
              <button
                type="button"
                title="全体に戻す"
                onClick={() => {
                  setMiniZoom(1);
                  setMiniPan(null);
                }}
              >
                全体
              </button>
              <button
                type="button"
                title="小窓を閉じる"
                onClick={() => setShowMini(false)}
              >
                ×
              </button>
            </span>
          </div>
          <div
            className="mini-drawing-body"
            title="つかんで動かすと見る場所をずらせます"
            onPointerDown={(event) => {
              miniPanRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                from: miniOrigin,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = miniPanRef.current;
              if (start === null) return;
              const unit =
                miniSpan / Math.max(1, event.currentTarget.clientWidth);
              setMiniPan({
                x: start.from.x - (event.clientX - start.clientX) * unit,
                y: start.from.y - (event.clientY - start.clientY) * unit,
              });
            }}
            onPointerUp={(event) => {
              miniPanRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          >
            <svg
              viewBox={miniBox}
              preserveAspectRatio="xMidYMid meet"
              style={{ width: "100%", height: "100%" }}
            >
              {renderDrawingContent(miniFont)}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
