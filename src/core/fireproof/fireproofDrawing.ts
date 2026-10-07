/**
 * 鉄骨伏図（耐火被覆・塗装積算入力の図面）1階分の中身。
 * 柱線寸法線 → 交点の柱 → 柱間の大梁 を「番号に記号を入れる」だけで描く作り。
 */
import { resolveCommonRow, resolveSize } from "./fireproofList";
import type { FireproofCommonRow, FireproofFloorList } from "./fireproofList";

/** 小梁1本。大梁に囲まれた区画を等分割して置く（端点はmm） */
export interface FireproofDrawingBeam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 記号（B40 など） */
  symbol: string;
  /** 取合記号のキーに使う番号。無いものは行番号で代用する */
  id?: string;
}

/** 斜梁（通り芯にそわない大梁。始点・終点は交点のグリッド番号） */
export interface FireproofDrawingDiagGirder {
  /** 始点の交点（グリッドの番号） */
  fx: number;
  fy: number;
  /** 終点の交点 */
  tx: number;
  ty: number;
  /** 記号（大梁リストのもの） */
  symbol: string;
  /** 取合記号のキーに使う番号。無いものは行番号で代用する */
  id?: string;
  /** 部材を法線方向にずらす量（mm。柱の面に合わせる寄せ。正＝法線 +n 側） */
  offset?: number;
  /** 始点が交点以外（引いてある梁・柱の線上の点）のときの実座標（mm）。あるときはグリッドより優先。
     その場合の fx,fy は一番近い交点の番号（位置表記・拾い用） */
  fromMm?: { x: number; y: number };
  /** 終点が交点以外のときの実座標（mm） */
  toMm?: { x: number; y: number };
}

/** 補助寸法線の位置（mm）。基になる寸法線の位置に離れ寸法を足したもの */
export function auxLinePosition(
  floor: Pick<FireproofDrawingFloor, "xSpans" | "ySpans">,
  line: FireproofDrawingAuxLine,
): number | null {
  const base = positions(line.axis === "x" ? floor.xSpans : floor.ySpans)[
    line.base
  ];
  if (base === undefined) return null;
  return base + line.offset;
}

/** 引き梁の両端の実座標（mm。交点のときはグリッドの位置） */
export function diagEnds(
  xs: number[],
  ys: number[],
  g: FireproofDrawingDiagGirder,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const x1 = g.fromMm?.x ?? xs[g.fx];
  const y1 = g.fromMm?.y ?? ys[g.fy];
  const x2 = g.toMm?.x ?? xs[g.tx];
  const y2 = g.toMm?.y ?? ys[g.ty];
  if (
    x1 === undefined ||
    y1 === undefined ||
    x2 === undefined ||
    y2 === undefined
  )
    return null;
  return { x1, y1, x2, y2 };
}

/** 線の描き幅の半分（mm）。部材の幅（リストの後ろの数字）が分からないときの既定値。
    小梁の端を線の内側（内内寸法）に寄せる量としても使う */
export const GIRDER_HALF = 75; // 大梁（幅が不明なとき150mm幅で描く）
export const BEAM_HALF = 60; // 小梁（幅が不明なとき120mm幅で描く）
/** 柱の四角の半幅（mm）。寸法が分からない柱の描き幅・端寄せの面に使う */
export const COLUMN_HALF = 120;

/** 区画の境界線の半幅（mm）→ 内内寸法を出す量。部材幅の半分 */
export type HalfWidthOf = (symbol: string) => number | null;

/** 柱記号→柱の四角の半分（横×縦 mm）。大梁の端寄せの面の位置に使う */
export type ColumnHalfOf = (
  symbol: string,
) => { hw: number; hd: number } | null;

/** 大梁の位置合わせ。無い・"center"は柱芯どおり（中央）。
   "min"：横の梁は上端寄せ・縦の梁は左端寄せ（梁の外側の面が柱の面に付く）
   "max"：下端寄せ・右端寄せ。両端の柱の大きさが違うときは小さいほうの面に合わせる */
export type GirderAlign = "min" | "max";

/** まわりを囲む線でできた区画（大梁・小梁の線を境界とする） */
export interface DrawingRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 各辺を作った線の半幅。左の境界線の半幅が insetLeft に入る（小梁の端は中心線ではなく線の内側） */
  insetLeft?: number;
  insetRight?: number;
  insetTop?: number;
  insetBottom?: number;
  /** 境界になった斜めの線（この線で区切られた側を区画の外側にはみ出さないよう、置く小梁を切る） */
  diagEdges?: DiagEdge[];
}

/** 区画の境界になった斜めの線（中心線・その線の半幅・囲む側） */
export interface DiagEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  half: number;
  side: "left" | "right" | "top" | "bottom";
}

export interface FireproofDrawingFloor {
  /** X軸方向の柱線寸法（mm）。例 [7300, 7650, 7300] */
  xSpans: number[];
  /** Y軸方向の柱線寸法（mm）。例 [7350, 6650] */
  ySpans: number[];
  /** 交点ごとの柱記号。キー "xi,yi"（x軸xi番目・y軸yi番目の交点）→ "C1" など */
  columns: Record<string, string>;
  /** 「無し」チェックの交点（キーはcolumnsと同じ）。柱を置かないことを表す。
     記号は残るが部材として置かず、この位置を通る大梁はつなげる */
  noColumns?: Record<string, true>;
  /** 柱間区間ごとの大梁記号。キー "x:xi,yi"（xi,yiの交点から右へ1区間）・"y:xi,yi"（下へ1区間）→ "G1" など */
  girders: Record<string, string>;
  /** 「無し」チェックの大梁区間（キーはgirdersと同じ）。記号は残るが部材として置かない */
  noGirders?: Record<string, true>;
  /** 大梁の位置合わせ（キーはgirdersと同じ）。無い区間は中央（柱芯どおり） */
  girderAlign?: Record<string, GirderAlign>;
  /** 取合記号（耐火被覆の断面積算出用）。1部材に1記号。
     キーは柱 "c:xi,yi"・大梁 "g:x:0,0"（girdersと同じ）・小梁 "b:小梁id" */
  jointSymbols?: Record<string, string>;
  /** 縦の通りごとの柱の高さ（mm）。キーは通りの番号（"0"が図のいちばん上の通り）。
     入っていない通りはその階の階高を使う */
  axisHeights?: Record<string, number>;
  /** 横の通りごとの柱の高さ（mm）。キーは通りの番号（"0"が図のいちばん左の通り）。
     入っていない通りはその階の階高を使う */
  axisHeightsX?: Record<string, number>;
  /** 小梁（区画を分割して置く線） */
  beams: FireproofDrawingBeam[];
  /** 斜梁（通り芯にそわない大梁。2つの交点を結ぶ線） */
  diagGirders?: FireproofDrawingDiagGirder[];
  /** 補助寸法線（①柱線寸法線とは別に、寸法線からずらして引く平行な線） */
  auxLines?: FireproofDrawingAuxLine[];
  /** 他の計算書へ呼び出せるように書き出した画像（データURL）。無いときは空文字 */
  image: string;
  /** 書き出した画像の 1mm あたり画素数（呼び出す側の縮尺に使う） */
  pixelsPerMm: number;
  /** 書き出した画像の幅・高さ（画素） */
  imageWidth: number;
  imageHeight: number;
}

/** 補助寸法線。axis の基になる寸法線（base＝通りの番号）から offset mm 離れた平行な線
   （offset は添字が増える向き＝右・下が正）。梁を引くための端のとり場になる */
export interface FireproofDrawingAuxLine {
  axis: "x" | "y";
  base: number;
  offset: number;
  id?: string;
}

/** 工事ごとの鉄骨伏図。キーは階の表示名（耐火被覆の階リストと同じ "R","3","2","1" など） */
export interface FireproofDrawing {
  floors: Record<string, FireproofDrawingFloor>;
}

export const EMPTY_DRAWING: FireproofDrawing = { floors: {} };

export function emptyFloor(): FireproofDrawingFloor {
  return {
    xSpans: [],
    ySpans: [],
    columns: {},
    girders: {},
    beams: [],
    image: "",
    pixelsPerMm: 0,
    imageWidth: 0,
    imageHeight: 0,
  };
}

const numberList = (value: unknown): number[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "number" ? item : Number(item)))
        .filter((item) => Number.isFinite(item) && item > 0)
    : [];

const numberMap = (value: unknown): Record<string, number> | undefined => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const out: Record<string, number> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    const num = Number(item);
    if (Number.isFinite(num) && num > 0) out[key] = num;
  });
  return Object.keys(out).length > 0 ? out : undefined;
};

const stringMap = (value: unknown): Record<string, string> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return {};
  const map: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (typeof item === "string" && item.trim() !== "") map[key] = item.trim();
  });
  return map;
};

/** 「無し」チェックのキーの集まりを読む（値が true のキーだけ残す） */
const keySet = (value: unknown): Record<string, true> | undefined => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const out: Record<string, true> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (item === true) out[key] = true;
  });
  return Object.keys(out).length > 0 ? out : undefined;
};

function normalizeFloor(raw: unknown): FireproofDrawingFloor {
  const floor = emptyFloor();
  if (raw === null || typeof raw !== "object") return floor;
  const row = raw as Partial<FireproofDrawingFloor>;
  return {
    xSpans: numberList(row.xSpans),
    ySpans: numberList(row.ySpans),
    columns: stringMap(row.columns),
    noColumns: keySet(row.noColumns),
    girders: stringMap(row.girders),
    noGirders: keySet(row.noGirders),
    girderAlign: (() => {
      const map = row.girderAlign;
      if (map === null || typeof map !== "object" || Array.isArray(map))
        return undefined;
      const out: Record<string, GirderAlign> = {};
      Object.entries(map).forEach(([key, value]) => {
        if (value === "min" || value === "max") out[key] = value;
      });
      return Object.keys(out).length > 0 ? out : undefined;
    })(),
    jointSymbols: (() => {
      const map = stringMap(row.jointSymbols);
      // 以前は端ごとのキー（"g:…:端"・"b:…:端"）だったが、今は1部材1記号。
      // 端の番号を落として読み替える（両端で違ったら先に見つかったほうを使う）
      const out: Record<string, string> = {};
      Object.entries(map).forEach(([key, symbol]) => {
        const member = key.replace(/:\d+$/, "");
        if (!(member in out)) out[member] = symbol;
      });
      return Object.keys(out).length > 0 ? out : undefined;
    })(),
    axisHeights: numberMap(row.axisHeights),
    axisHeightsX: numberMap(row.axisHeightsX),
    diagGirders: (() => {
      if (!Array.isArray(row.diagGirders)) return undefined;
      const out: FireproofDrawingDiagGirder[] = [];
      row.diagGirders.forEach((item: unknown) => {
        if (item === null || typeof item !== "object") return;
        const r = item as Partial<FireproofDrawingDiagGirder>;
        const ends = [r.fx, r.fy, r.tx, r.ty];
        if (
          !ends.every(
            (end) => typeof end === "number" && Number.isFinite(end) && end >= 0,
          )
        )
          return;
        const g: FireproofDrawingDiagGirder = {
          fx: Math.trunc(r.fx as number),
          fy: Math.trunc(r.fy as number),
          tx: Math.trunc(r.tx as number),
          ty: Math.trunc(r.ty as number),
          symbol: typeof r.symbol === "string" ? r.symbol.trim() : "",
          ...(typeof r.id === "string" && r.id !== "" ? { id: r.id } : {}),
          ...(typeof r.offset === "number" && Number.isFinite(r.offset)
            ? { offset: r.offset }
            : {}),
          ...(() => {
            const point = (v: unknown): { x: number; y: number } | undefined => {
              if (v === null || typeof v !== "object") return undefined;
              const p = v as { x?: unknown; y?: unknown };
              if (
                typeof p.x !== "number" ||
                !Number.isFinite(p.x) ||
                typeof p.y !== "number" ||
                !Number.isFinite(p.y)
              )
                return undefined;
              return { x: p.x, y: p.y };
            };
            const fromMm = point(r.fromMm);
            const toMm = point(r.toMm);
            return {
              ...(fromMm !== undefined ? { fromMm } : {}),
              ...(toMm !== undefined ? { toMm } : {}),
            };
          })(),
        };
        if (g.fx === g.tx && g.fy === g.ty) return;
        out.push(g);
      });
      return out.length > 0 ? out : undefined;
    })(),
    auxLines: (() => {
      if (!Array.isArray(row.auxLines)) return undefined;
      const out: FireproofDrawingAuxLine[] = [];
      row.auxLines.forEach((item: unknown) => {
        if (item === null || typeof item !== "object") return;
        const r = item as Partial<FireproofDrawingAuxLine>;
        if (r.axis !== "x" && r.axis !== "y") return;
        if (
          typeof r.base !== "number" ||
          !Number.isInteger(r.base) ||
          r.base < 0 ||
          typeof r.offset !== "number" ||
          !Number.isFinite(r.offset) ||
          r.offset === 0
        )
          return;
        out.push({
          axis: r.axis,
          base: r.base,
          offset: r.offset,
          ...(typeof r.id === "string" && r.id !== "" ? { id: r.id } : {}),
        });
      });
      return out.length > 0 ? out : undefined;
    })(),
    beams: Array.isArray(row.beams)
      ? row.beams
          .map((beam) => {
            if (beam === null || typeof beam !== "object") return null;
            const row2 = beam as Partial<FireproofDrawingBeam>;
            const ends = [row2.x1, row2.y1, row2.x2, row2.y2];
            if (!ends.every((end) => typeof end === "number" && Number.isFinite(end)))
              return null;
            return {
              x1: row2.x1 as number,
              y1: row2.y1 as number,
              x2: row2.x2 as number,
              y2: row2.y2 as number,
              symbol: typeof row2.symbol === "string" ? row2.symbol.trim() : "",
              ...(typeof row2.id === "string" && row2.id !== ""
                ? { id: row2.id }
                : {}),
            };
          })
          .filter((beam): beam is FireproofDrawingBeam => beam !== null)
      : [],
    image: typeof row.image === "string" ? row.image : "",
    pixelsPerMm:
      typeof row.pixelsPerMm === "number" && row.pixelsPerMm > 0
        ? row.pixelsPerMm
        : 0,
    imageWidth:
      typeof row.imageWidth === "number" && row.imageWidth > 0
        ? row.imageWidth
        : 0,
    imageHeight:
      typeof row.imageHeight === "number" && row.imageHeight > 0
        ? row.imageHeight
        : 0,
  };
}

/** 保存した drawingJson を読む（無い・壊れているときは空） */
export function parseDrawing(json: string): FireproofDrawing {
  try {
    const parsed = JSON.parse(json) as Partial<FireproofDrawing> | null;
    if (parsed === null || typeof parsed !== "object") return { floors: {} };
    const floors: Record<string, FireproofDrawingFloor> = {};
    if (parsed.floors !== null && typeof parsed.floors === "object") {
      Object.entries(parsed.floors).forEach(([floor, raw]) => {
        floors[floor] = normalizeFloor(raw);
      });
    }
    return { floors };
  } catch {
    return { floors: {} };
  }
}

export function serializeDrawing(drawing: FireproofDrawing): string {
  return JSON.stringify(drawing);
}

/** "7300,7650,7300" や "7350 6650" の入力を寸法の並びにする（全角・読点も使える） */
export function parseSpanList(text: string): number[] {
  return text
    .split(/[、,，\s]+/)
    .map((part) => Number(part))
    .filter((item) => Number.isFinite(item) && item > 0);
}

export function spanListText(spans: readonly number[]): string {
  return spans.join(",");
}

/** 累積の座標（先頭は0）。xPositions[xi] = xi本目の柱線のx座標（mm） */
export function positions(spans: readonly number[]): number[] {
  const points = [0];
  spans.forEach((span) => points.push(points[points.length - 1] + span));
  return points;
}

/** 交点のキー */
export function columnKey(xi: number, yi: number): string {
  return `${xi},${yi}`;
}

/** 区間のキー。axis "x"：xi,yiの交点から右へ1区間、"y"：下へ1区間 */
export function girderKey(axis: "x" | "y", xi: number, yi: number): string {
  return `${axis}:${xi},${yi}`;
}

/** 交点の通し番号（リストと図面の番号を合わせる）。左上から右へ・上から下へ */
export function columnNumbers(floor: FireproofDrawingFloor): number[][] {
  const nx = floor.xSpans.length + 1;
  const ny = floor.ySpans.length + 1;
  return Array.from({ length: ny }, (_, yi) =>
    Array.from({ length: nx }, (_, xi) => yi * nx + xi + 1),
  );
}

/** 大梁の通し番号（X方向の区間を先に、つづいてY方向） */
export function girderNumber(
  axis: "x" | "y",
  xi: number,
  yi: number,
  floor: FireproofDrawingFloor,
): number {
  const nx = floor.xSpans.length;
  const ny = floor.ySpans.length;
  if (axis === "x") return yi * nx + xi + 1;
  return nx * (ny + 1) + xi * ny + yi + 1;
}

/** 交点に柱があるか（「無し」チェックの交点は柱が無い扱い） */
export function columnExists(
  floor: FireproofDrawingFloor,
  xi: number,
  yi: number,
): boolean {
  const key = columnKey(xi, yi);
  return (
    (floor.columns[key] ?? "").trim() !== "" &&
    floor.noColumns?.[key] !== true
  );
}

/** 区間に大梁があるか（「無し」チェックの区間は無い扱い） */
export function girderExists(floor: FireproofDrawingFloor, key: string): boolean {
  return (
    (floor.girders[key] ?? "").trim() !== "" &&
    floor.noGirders?.[key] !== true
  );
}

/**
 * 大梁の軸からのずらし量（mm。0＝中央／柱芯どおり）。
 * "min"（上・左へ寄せ）：梁の外側の面が、両端の柱のうち小さいほうの面に付く位置へ。
 * "max"（下・右へ寄せ）：反対側も同じ。柱が無い端・寸法が分からない柱は芯（0）として扱う。
 */
export function girderOffset(
  floor: FireproofDrawingFloor,
  key: string,
  halfWidthOf?: HalfWidthOf,
  columnHalfOf?: ColumnHalfOf,
): number {
  const align = floor.girderAlign?.[key];
  const symbol = floor.girders[key];
  if (
    align === undefined ||
    symbol === undefined ||
    columnHalfOf === undefined
  )
    return 0;
  const [axis, point] = key.split(":");
  const [xi, yi] = point.split(",").map(Number);
  const ends =
    axis === "x"
      ? [
          [xi, yi],
          [xi + 1, yi],
        ]
      : [
          [xi, yi],
          [xi, yi + 1],
        ];
  const faces = ends
    .map(([ax, ay]) => {
      if (!columnExists(floor, ax, ay)) return null;
      const sym = (floor.columns[columnKey(ax, ay)] ?? "").trim();
      // 寸法が分からない柱も図には描かれるので、その面に合わせる
      const size = columnHalfOf(sym) ?? {
        hw: COLUMN_HALF,
        hd: COLUMN_HALF,
      };
      return axis === "x" ? size.hd : size.hw;
    })
    .filter((v): v is number => v !== null);
  // 柱の無い端は除き、両端にある場合は小さいほうの柱の面に合わせる
  const face = faces.length === 0 ? 0 : Math.min(...faces);
  const gh = halfWidthOf?.(symbol) ?? GIRDER_HALF;
  return align === "min" ? gh - face : face - gh;
}

/** X軸の柱線につける通し番号（左から 1,2,3…。数は柱線＝寸法+1本） */
export function xGridLabel(index: number): string {
  return String(index + 1);
}

/** Y軸の柱線につける記号（A,B,C…Z,AA,AB…） */
export function yGridLabel(index: number): string {
  let label = "";
  let rest = index;
  for (;;) {
    label = String.fromCharCode(65 + (rest % 26)) + label;
    rest = Math.floor(rest / 26) - 1;
    if (rest < 0) return label;
  }
}

/**
 * クリックした点をまわりで囲んでいる区画を返す。
 * 境界に使う線は大梁（記号を入れた区間）と、すでに置いた小梁。
 * 点に一番近い線を上下左右に探して、4辺そろったときだけ区画になる。
 * （小梁が作る小さい区画も同じ手順で選べる）
 */
export function enclosingRegion(
  floor: FireproofDrawingFloor,
  px: number,
  py: number,
  /** 記号→部材幅の半分（mm）。内内寸法に使う。渡さないときは描き幅の半分（GIRDER_HALF/BEAM_HALF） */
  halfWidthOf?: HalfWidthOf,
  /** false にすると小梁を境界に使わない（大梁だけで囲まれた区画） */
  includeBeams = true,
  /** 柱記号→柱の四角の半分。端寄せした大梁の位置（区画の境界）に使う */
  columnHalfOf?: ColumnHalfOf,
): DrawingRegion | null {
  const xs = positions(floor.xSpans);
  const ys = positions(floor.ySpans);
  const girderHalf = (symbol: string) =>
    halfWidthOf?.(symbol) ?? GIRDER_HALF;
  const beamHalf = (symbol: string) => halfWidthOf?.(symbol) ?? BEAM_HALF;
  /** 縦の境界線（xの位置・その線があるy区間・線の半幅） */
  const vLines: { x: number; y1: number; y2: number; half: number }[] = [];
  /** 横の境界線 */
  const hLines: { y: number; x1: number; x2: number; half: number }[] = [];
  Object.entries(floor.girders).forEach(([key, symbol]) => {
    if (!girderExists(floor, key)) return;
    const [axis, point] = key.split(":");
    const [xi, yi] = point.split(",").map(Number);
    if (
      axis === "x" &&
      xi >= 0 &&
      xi < xs.length - 1 &&
      yi >= 0 &&
      yi < ys.length
    )
      hLines.push({
        y:
          ys[yi] +
          girderOffset(floor, key, halfWidthOf, columnHalfOf),
        x1: xs[xi],
        x2: xs[xi + 1],
        half: girderHalf(symbol),
      });
    if (
      axis === "y" &&
      yi >= 0 &&
      yi < ys.length - 1 &&
      xi >= 0 &&
      xi < xs.length
    )
      vLines.push({
        x:
          xs[xi] +
          girderOffset(floor, key, halfWidthOf, columnHalfOf),
        y1: ys[yi],
        y2: ys[yi + 1],
        half: girderHalf(symbol),
      });
  });
  if (includeBeams)
    floor.beams.forEach((beam) => {
      if (beam.x1 === beam.x2)
        vLines.push({
          x: beam.x1,
          y1: Math.min(beam.y1, beam.y2),
          y2: Math.max(beam.y1, beam.y2),
          half: beamHalf(beam.symbol),
        });
      if (beam.y1 === beam.y2)
        hLines.push({
          y: beam.y1,
          x1: Math.min(beam.x1, beam.x2),
          x2: Math.max(beam.x1, beam.x2),
          half: beamHalf(beam.symbol),
        });
    });
  /* 補助寸法線（部材ではないので半幅0。同じ場所に部材が引かれているときは部材の境界が勝る） */
  (floor.auxLines ?? []).forEach((line) => {
    const pos = auxLinePosition(floor, line);
    if (pos === null) return;
    if (line.axis === "x") {
      if (vLines.some((v) => Math.abs(v.x - pos) <= 1)) return;
      vLines.push({
        x: pos,
        y1: ys[0] ?? 0,
        y2: ys[ys.length - 1] ?? 0,
        half: 0,
      });
    } else {
      if (hLines.some((h) => Math.abs(h.y - pos) <= 1)) return;
      hLines.push({
        y: pos,
        x1: xs[0] ?? 0,
        x2: xs[xs.length - 1] ?? 0,
        half: 0,
      });
    }
  });
  let left = -Infinity;
  let right = Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  /** 斜めの線が境界になった側（区画の外側に小梁がはみ出さないよう記録する） */
  const edgeOf = (side: DiagEdge["side"], x1: number, y1: number, x2: number, y2: number, half: number): DiagEdge => ({
    x1, y1, x2, y2, half, side,
  });
  const edges: DiagEdge[] = [];
  const setEdge = (edge: DiagEdge): void => {
    const i = edges.findIndex((e) => e.side === edge.side);
    if (i >= 0) edges.splice(i, 1);
    edges.push(edge);
  };
  /** 斜め・引き梁の線（軸にそわないものは斜めの境界に、軸にそうものは普通の境界にする） */
  (floor.diagGirders ?? []).forEach((g) => {
    const ends = diagEnds(xs, ys, g);
    if (ends === null) return;
    const sx = ends.x1;
    const sy = ends.y1;
    const ex = ends.x2;
    const ey = ends.y2;
    const dx = ex - sx;
    const dy = ey - sy;
    const plan = Math.hypot(dx, dy);
    if (plan <= 0) return;
    const ux = dx / plan;
    const uy = dy / plan;
    const off = g.offset ?? 0;
    const nx = -uy;
    const ny = ux;
    const x1 = sx + nx * off;
    const y1 = sy + ny * off;
    const x2 = ex + nx * off;
    const y2 = ey + ny * off;
    const half = girderHalf(g.symbol);
    if (x1 === x2) {
      vLines.push({
        x: x1,
        y1: Math.min(y1, y2),
        y2: Math.max(y1, y2),
        half,
      });
      return;
    }
    if (y1 === y2) {
      hLines.push({
        y: y1,
        x1: Math.min(x1, x2),
        x2: Math.max(x1, x2),
        half,
      });
      return;
    }
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    if (px >= minX && px <= maxX) {
      const yAt = y1 + ((y2 - y1) * (px - x1)) / (x2 - x1);
      if (yAt < py && yAt > top) {
        top = yAt;
        setEdge(edgeOf("top", x1, y1, x2, y2, half));
      }
      if (yAt > py && yAt < bottom) {
        bottom = yAt;
        setEdge(edgeOf("bottom", x1, y1, x2, y2, half));
      }
    }
    if (py >= minY && py <= maxY) {
      const xAt = x1 + ((x2 - x1) * (py - y1)) / (y2 - y1);
      if (xAt < px && xAt > left) {
        left = xAt;
        setEdge(edgeOf("left", x1, y1, x2, y2, half));
      }
      if (xAt > px && xAt < right) {
        right = xAt;
        setEdge(edgeOf("right", x1, y1, x2, y2, half));
      }
    }
  });
  let insetLeft = 0;
  let insetRight = 0;
  let insetTop = 0;
  let insetBottom = 0;
  vLines.forEach((line) => {
    if (line.y1 > py || py > line.y2) return;
    if (line.x < px && line.x > left) {
      left = line.x;
      insetLeft = line.half;
    }
    if (line.x > px && line.x < right) {
      right = line.x;
      insetRight = line.half;
    }
  });
  hLines.forEach((line) => {
    if (line.x1 > px || px > line.x2) return;
    if (line.y < py && line.y > top) {
      top = line.y;
      insetTop = line.half;
    }
    if (line.y > py && line.y < bottom) {
      bottom = line.y;
      insetBottom = line.half;
    }
  });
  if (!Number.isFinite(left + right + top + bottom)) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    insetLeft,
    insetRight,
    insetTop,
    insetBottom,
    ...(edges.length > 0 ? { diagEdges: edges } : {}),
  };
}

/**
 * 区画を等分割する小梁の並びを返す。
 * parts は「でき上がる区画の数」。置く線は parts-1 本。
 * axis "v"：縦の小梁で横に分ける、"h"：横の小梁で縦に分ける。
 * 小梁の端は区画を囲む線の内側（内内寸法。境界の半幅ぶんだけ中へ寄せる）。
 */
export function dividedBeams(
  region: DrawingRegion,
  axis: "v" | "h",
  parts: number,
  symbol: string,
): FireproofDrawingBeam[] {
  if (parts < 2) return [];
  const left = region.x + (region.insetLeft ?? 0);
  const right = region.x + region.width - (region.insetRight ?? 0);
  const top = region.y + (region.insetTop ?? 0);
  const bottom = region.y + region.height - (region.insetBottom ?? 0);
  const beams: FireproofDrawingBeam[] = [];
  for (let i = 1; i < parts; i += 1) {
    if (axis === "v") {
      const x = region.x + (region.width * i) / parts;
      beams.push({ x1: x, y1: top, x2: x, y2: bottom, symbol });
    } else {
      const y = region.y + (region.height * i) / parts;
      beams.push({ x1: left, y1: y, x2: right, y2: y, symbol });
    }
  }
  return beams
    .map((beam) => clipBeamAtDiagEdges(beam, region))
    .filter((beam): beam is FireproofDrawingBeam => beam !== null);
}

/**
 * 区画の斜めの境界をまたぐ小梁を、その線で切る（外側にはみ出さない）。
 * 区画の中心がある側を内側として、はみ出た端を斜め線との交点へ寄せ、
 * 斜め線の半幅ぶんだけ梁の向きに引く（内内寸法）。
 */
function clipBeamAtDiagEdges(
  beam: FireproofDrawingBeam,
  region: DrawingRegion,
): FireproofDrawingBeam | null {
  const edges = region.diagEdges;
  if (edges === undefined || edges.length === 0) return beam;
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  let x1 = beam.x1;
  let y1 = beam.y1;
  let x2 = beam.x2;
  let y2 = beam.y2;
  for (const edge of edges) {
    const bdx = x2 - x1;
    const bdy = y2 - y1;
    const edx = edge.x2 - edge.x1;
    const edy = edge.y2 - edge.y1;
    const den = bdx * edy - bdy * edx;
    const eLen = Math.hypot(edx, edy);
    const bLen = Math.hypot(bdx, bdy);
    if (Math.abs(den) < 1e-6 || eLen === 0 || bLen === 0) continue; // 平行・長さなし
    const sideC = (cx - edge.x1) * edy - (cy - edge.y1) * edx;
    if (sideC === 0) continue;
    const inSign = sideC > 0 ? 1 : -1;
    const s1 = inSign * ((x1 - edge.x1) * edy - (y1 - edge.y1) * edx);
    const s2 = inSign * ((x2 - edge.x1) * edy - (y2 - edge.y1) * edx);
    const out1 = s1 < -1e-6;
    const out2 = s2 < -1e-6;
    if (!out1 && !out2) continue;
    if (out1 && out2) return null; // 線の外側に全部ある
    const t =
      ((edge.x1 - x1) * edy - (edge.y1 - y1) * edx) / den;
    const ix = x1 + bdx * t;
    const iy = y1 + bdy * t;
    // 斜め線とのなす角の sin で半幅を梁の向きに割り戻す
    const sin = Math.abs(den) / (bLen * eLen);
    const inset = edge.half / Math.max(0.3, sin);
    const ux = bdx / bLen;
    const uy = bdy / bLen;
    if (out1) {
      x1 = ix + ux * inset;
      y1 = iy + uy * inset;
    } else {
      x2 = ix - ux * inset;
      y2 = iy - uy * inset;
    }
  }
  if (Math.hypot(x2 - x1, y2 - y1) < 1) return null;
  return { ...beam, x1, y1, x2, y2 };
}

/** 小梁の長さ（mm） */
export function beamLength(beam: FireproofDrawingBeam): number {
  return Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1);
}

/** その通りの柱の高さ（mm）。軸に入っていなければ階高を使う */
export function axisHeightAt(
  floor: FireproofDrawingFloor,
  yi: number,
  defaultHeight: number,
): number {
  return floor.axisHeights?.[String(yi)] ?? defaultHeight;
}

/** その横通りの柱の高さ（mm）。軸に入っていなければ階高を使う */
export function axisHeightXAt(
  floor: FireproofDrawingFloor,
  xi: number,
  defaultHeight: number,
): number {
  return floor.axisHeightsX?.[String(xi)] ?? defaultHeight;
}

/** pos にいちばん近い通りの番号 */
function nearestAxis(axis: number[], pos: number): number {
  let best = 0;
  let dist = Number.POSITIVE_INFINITY;
  axis.forEach((p, index) => {
    const d = Math.abs(p - pos);
    if (d < dist) {
      dist = d;
      best = index;
    }
  });
  return best;
}

/** 勾配を含む小梁の実長（mm）。両端の通りで柱の高さが違うとき、その差ぶん長くなる。
   縦の梁は縦通り同士・横の梁は横通り同士の高さ差を見る */
export function beamSlopeLength(
  beam: FireproofDrawingBeam,
  floor: FireproofDrawingFloor,
  floorHeight: number,
): number {
  const plan = beamLength(beam);
  if (beam.x1 === beam.x2) {
    const ys = positions(floor.ySpans);
    if (ys.length === 0) return plan;
    const dh = Math.abs(
      axisHeightAt(floor, nearestAxis(ys, beam.y1), floorHeight) -
        axisHeightAt(floor, nearestAxis(ys, beam.y2), floorHeight),
    );
    return Math.hypot(plan, dh);
  }
  if (beam.y1 === beam.y2) {
    const xs = positions(floor.xSpans);
    if (xs.length === 0) return plan;
    const dh = Math.abs(
      axisHeightXAt(floor, nearestAxis(xs, beam.x1), floorHeight) -
        axisHeightXAt(floor, nearestAxis(xs, beam.x2), floorHeight),
    );
    return Math.hypot(plan, dh);
  }
  return plan;
}

/**
 * 小梁の端を、今の図面（大梁・柱線・部材の幅）に合わせて入れ直す。
 * 中点を囲む区画を拾い直して、軸方向の両端をその区画の内内寸法に止める。
 * 寸法や記号の幅が変わったときに呼ぶと、長さ表示が図面に連動する。
 */
export function refitBeams(
  floor: FireproofDrawingFloor,
  halfWidthOf?: HalfWidthOf,
  columnHalfOf?: ColumnHalfOf,
): FireproofDrawingBeam[] {
  return floor.beams.map((beam) => {
    const mx = (beam.x1 + beam.x2) / 2;
    const my = (beam.y1 + beam.y2) / 2;
    const region = enclosingRegion(
      floor,
      mx,
      my,
      halfWidthOf,
      true,
      columnHalfOf,
    );
    if (region === null) return beam;
    if (beam.x1 === beam.x2)
      return {
        ...beam,
        y1: region.y + (region.insetTop ?? 0),
        y2: region.y + region.height - (region.insetBottom ?? 0),
      };
    if (beam.y1 === beam.y2)
      return {
        ...beam,
        x1: region.x + (region.insetLeft ?? 0),
        x2: region.x + region.width - (region.insetRight ?? 0),
      };
    return beam;
  });
}

/** 小梁を軸と直角の方向へ delta mm 動かす（縦の梁は左右・横の梁は上下） */
export function nudgeBeam(
  beam: FireproofDrawingBeam,
  delta: number,
): FireproofDrawingBeam {
  if (beam.x1 === beam.x2) return { ...beam, x1: beam.x1 + delta, x2: beam.x2 + delta };
  return { ...beam, y1: beam.y1 + delta, y2: beam.y2 + delta };
}

/** 柱入力表へ取り込む1本分の中身（伏図の柱から作る） */
export interface ColumnImportItem {
  /**
   * コメント欄。取り込んだブロックの最初の行だけ
   * 「柱位置表示（縦軸左より1から順に2,3と表記する・横軸下よりAから順にB,Cと表記する）」
   * 2行目以降は柱位置（例 "1-C"）。
   */
  comment: string;
  /** 柱記号 */
  symbol: string;
  /** 図面で打ち込んだ取合番号（無いときは空） */
  mark: string;
  /** その柱の高さの計算式（m。"3.8" のような小数。高さが不明なときは空） */
  lengthFormula: string;
}

/** 伏図から取り込んだブロックの先頭に入れる案内文 */
export const COLUMN_IMPORT_HEAD_COMMENT =
  "柱位置表示（縦軸左より1から順に2,3と表記する・横軸下よりAから順にB,Cと表記する）";

/**
 * 取合記号が入っていない部材のキー（"c:…"・"g:…"・"b:…" の形）。
 * 記号の入っていない柱の交点・大梁の区間は部材ではないので数えない。
 * 小梁のキーは図面と同じく「idか行番号」で作る。
 */
export function missingJointKeys(floor: FireproofDrawingFloor): string[] {
  const joints = floor.jointSymbols ?? {};
  const missing: string[] = [];
  Object.keys(floor.columns).forEach((key) => {
    if (
      floor.columns[key].trim() !== "" &&
      floor.noColumns?.[key] !== true &&
      (joints[`c:${key}`] ?? "") === ""
    )
      missing.push(`c:${key}`);
  });
  girderMembers(floor).forEach((member) => {
    // 「無し」の柱をまたぐ通しの大梁は1部材：どれか1区間に記号があればよい
    if (member.keys.every((key) => (joints[`g:${key}`] ?? "") === ""))
      member.keys.forEach((key) => missing.push(`g:${key}`));
  });
  floor.beams.forEach((beam, index) => {
    const key = `b:${beam.id ?? `#${index}`}`;
    if ((joints[key] ?? "") === "") missing.push(key);
  });
  (floor.diagGirders ?? []).forEach((g, index) => {
    const key = `d:${g.id ?? `#${index}`}`;
    if (g.symbol.trim() !== "" && (joints[key] ?? "") === "")
      missing.push(key);
  });
  return missing;
}

/**
 * 伏図1階分の柱を、柱入力表へ取り込む順（上の通り→下へ、各行は左→右）に並べる。
 * コメントは柱位置（階数は表の階欄が持つので付けない。案内文の行は画面側で足す）。
 * 柱の高さは縦通りの値 → 横通りの値 → 階高 の順で使う。
 */
export function columnImportItems(
  floor: FireproofDrawingFloor,
  floorHeight: number | null,
): ColumnImportItem[] {
  const ys = positions(floor.ySpans);
  const keys = Object.keys(floor.columns)
    .filter(
      (key) =>
        floor.columns[key].trim() !== "" && floor.noColumns?.[key] !== true,
    )
    .sort((a, b) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return ay === by ? ax - bx : ay - by;
    });
  return keys.map((key) => {
    const [xi, yi] = key.split(",").map(Number);
    const position = `${xGridLabel(xi)}-${yGridLabel(ys.length - 1 - yi)}`;
    const height =
      floor.axisHeights?.[String(yi)] ??
      floor.axisHeightsX?.[String(xi)] ??
      floorHeight;
    return {
      comment: position,
      symbol: floor.columns[key].trim(),
      mark: floor.jointSymbols?.[`c:${key}`] ?? "",
      lengthFormula: height === null ? "" : String(height / 1000),
    };
  });
}

/** 伏図から取り込んだ梁ブロックの先頭に入れる案内文 */
export const BEAM_IMPORT_HEAD_COMMENT =
  "梁位置表示（大＝大梁は通り芯の区間・小＝小梁は区画。軸の表記は柱と同じ）";

/** 斜梁の位置表示（例「4-A〜5-C」。始点→終点の交点ラベル） */
export function diagGirderPosition(
  floor: FireproofDrawingFloor,
  g: FireproofDrawingDiagGirder,
): string {
  const ys = positions(floor.ySpans);
  const at = (xi: number, yi: number) =>
    `${xGridLabel(xi)}-${yGridLabel(ys.length - 1 - yi)}`;
  const from = g.fromMm !== undefined ? "線上" : at(g.fx, g.fy);
  const to = g.toMm !== undefined ? "線上" : at(g.tx, g.ty);
  return `${from}〜${to}`;
}

/** 「無し」の柱をまたいでつなぐ大梁の1部材分 */
export interface GirderMember {
  axis: "x" | "y";
  /** 含まれる区間キー（順どおり） */
  keys: string[];
  symbol: string;
  /** 両端の交点（グリッドの番号） */
  fromXi: number;
  fromYi: number;
  toXi: number;
  toYi: number;
  /** 端の詰め（mm。柱の面・交差した優先側大梁の面ぶん引く） */
  startCut: number;
  endCut: number;
}

/**
 * 「無し」の交点をまたぐ大梁を、通しの1部材（または交差で切れた部材）にまとめる。
 * 同じ向きで同じ記号が「無し」の交点を挟んで続くときつなぐ。
 * 「無し」の交点で縦・横の大梁が十字に交差するときは、先に入力した向き（girdersのキーの出現順が早い方）を優先
 * ＝通しにし、もう一方はその交点で切れて、その大梁の面までの長さになる。
 */
export function girderMembers(
  floor: FireproofDrawingFloor,
  columnHalfOf?: ColumnHalfOf,
  memberHalfOf?: HalfWidthOf,
): GirderMember[] {
  const xs = positions(floor.xSpans);
  const ys = positions(floor.ySpans);
  const nx = xs.length;
  const ny = ys.length;
  if (nx < 2 || ny < 1) return [];

  const sym = (key: string) => (floor.girders[key] ?? "").trim();
  const present = (key: string) =>
    girderExists(floor, key);

  /** 柱が無い交点（xi,yi）で、向き axis の大梁がつなぐか（両側に同じ記号が入っている） */
  const mergeAt = (axis: "x" | "y", xi: number, yi: number): boolean => {
    if (columnExists(floor, xi, yi)) return false;
    if (axis === "x") {
      const left = `x:${xi - 1},${yi}`;
      const right = `x:${xi},${yi}`;
      return present(left) && present(right) && sym(left) === sym(right);
    }
    const above = `y:${xi},${yi - 1}`;
    const below = `y:${xi},${yi}`;
    return present(above) && present(below) && sym(above) === sym(below);
  };

  /** 大梁キーの入力順（先に入れた方が交差で優先） */
  const order = new Map(
    Object.keys(floor.girders).map((key, index) => [key, index] as const),
  );

  /** 交点 (xi,yi) を通る向き axis の連続区間のうち、いちばん早く入れたキーの順位 */
  const runOrder = (axis: "x" | "y", xi: number, yi: number): number => {
    const keys: string[] = [];
    if (axis === "x") {
      keys.push(`x:${xi - 1},${yi}`, `x:${xi},${yi}`);
      let j = xi + 1;
      while (mergeAt("x", j, yi)) {
        keys.push(`x:${j},${yi}`);
        j += 1;
      }
      j = xi - 1;
      while (mergeAt("x", j, yi)) {
        keys.push(`x:${j - 1},${yi}`);
        j -= 1;
      }
    } else {
      keys.push(`y:${xi},${yi - 1}`, `y:${xi},${yi}`);
      let j = yi + 1;
      while (mergeAt("y", xi, j)) {
        keys.push(`y:${xi},${j}`);
        j += 1;
      }
      j = yi - 1;
      while (mergeAt("y", xi, j)) {
        keys.push(`y:${xi},${j - 1}`);
        j -= 1;
      }
    }
    return Math.min(
      ...keys.map((key) => order.get(key) ?? Number.MAX_SAFE_INTEGER),
    );
  };

  /**
   * 十字に交差する点（「無し」の交点を縦・横の両方がつなぐ）で負けた側の区間端の詰め（mm）。
   * キーは負けた側の区間キー。start＝図の上・左側の端、end＝下・右側の端。
   */
  const crossCuts = new Map<string, { start: number; end: number }>();
  const cutAt = (key: string, end: "start" | "end", mm: number) => {
    const cur = crossCuts.get(key) ?? { start: 0, end: 0 };
    cur[end] = Math.max(cur[end], mm);
    crossCuts.set(key, cur);
  };
  for (let yi = 0; yi < ny; yi++) {
    for (let xi = 0; xi < nx; xi++) {
      if (!mergeAt("x", xi, yi) || !mergeAt("y", xi, yi)) continue;
      const xFirst = runOrder("x", xi, yi) < runOrder("y", xi, yi);
      const [winner, loser] = xFirst ? (["x", "y"] as const) : (["y", "x"] as const);
      const winnerSym =
        winner === "x" ? sym(`x:${xi - 1},${yi}`) : sym(`y:${xi},${yi - 1}`);
      const half = memberHalfOf?.(winnerSym) ?? GIRDER_HALF;
      if (loser === "x") {
        cutAt(`x:${xi - 1},${yi}`, "end", half);
        cutAt(`x:${xi},${yi}`, "start", half);
      } else {
        cutAt(`y:${xi},${yi - 1}`, "end", half);
        cutAt(`y:${xi},${yi}`, "start", half);
      }
    }
  }

  /** 区間キーの start 端の交点が crossCuts で切れているか（負けた側の端） */
  const startCutOf = (key: string) => crossCuts.get(key)?.start ?? 0;
  const endCutOf = (key: string) => crossCuts.get(key)?.end ?? 0;

  /** 交点の柱の面の詰め（mm。柱が無い端は0＝柱線まで）。向き axis の梁の軸方向の面 */
  const faceAt = (axis: "x" | "y", ax: number, ay: number): number => {
    if (!columnExists(floor, ax, ay)) return 0;
    const symbol = (floor.columns[columnKey(ax, ay)] ?? "").trim();
    const size = columnHalfOf?.(symbol) ?? {
      hw: COLUMN_HALF,
      hd: COLUMN_HALF,
    };
    return axis === "x" ? size.hw : size.hd;
  };

  /** 境界（交点）をまたぐか。つなぐのは柱が無い交点で両側に同じ記号があり、十字で負けていない場合 */
  const joins = (axis: "x" | "y", xi: number, yi: number): boolean => {
    if (!mergeAt(axis, xi, yi)) return false;
    // 十字で負けた側はここで切れる（詰めは crossCuts が持つ）
    const beforeKey = axis === "x" ? `x:${xi - 1},${yi}` : `y:${xi},${yi - 1}`;
    const afterKey = axis === "x" ? `x:${xi},${yi}` : `y:${xi},${yi}`;
    return endCutOf(beforeKey) === 0 && startCutOf(afterKey) === 0;
  };

  const members: GirderMember[] = [];

  // X方向（横の大梁）：通り yi ごとに xi を走査
  for (let yi = 0; yi < ny; yi++) {
    let run: string[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const first = run[0];
      const last = run[run.length - 1];
      const f = Number(first.split(":")[1].split(",")[0]);
      const t = Number(last.split(":")[1].split(",")[0]) + 1;
      members.push({
        axis: "x",
        keys: run,
        symbol: sym(first),
        fromXi: f,
        fromYi: yi,
        toXi: t,
        toYi: yi,
        startCut: columnExists(floor, f, yi)
          ? faceAt("x", f, yi)
          : startCutOf(first),
        endCut: columnExists(floor, t, yi)
          ? faceAt("x", t, yi)
          : endCutOf(last),
      });
      run = [];
    };
    for (let xi = 0; xi < nx - 1; xi++) {
      const key = `x:${xi},${yi}`;
      if (present(key)) {
        run.push(key);
      } else {
        flush();
      }
      if (present(key) && !joins("x", xi + 1, yi)) flush();
    }
    flush();
  }

  // Y方向（縦の大梁）：通り xi ごとに yi を走査
  for (let xi = 0; xi < nx; xi++) {
    let run: string[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const first = run[0];
      const last = run[run.length - 1];
      const f = Number(first.split(":")[1].split(",")[1]);
      const t = Number(last.split(":")[1].split(",")[1]) + 1;
      members.push({
        axis: "y",
        keys: run,
        symbol: sym(first),
        fromXi: xi,
        fromYi: f,
        toXi: xi,
        toYi: t,
        startCut: columnExists(floor, xi, f)
          ? faceAt("y", xi, f)
          : startCutOf(first),
        endCut: columnExists(floor, xi, t)
          ? faceAt("y", xi, t)
          : endCutOf(last),
      });
      run = [];
    };
    for (let yi = 0; yi < ny - 1; yi++) {
      const key = `y:${xi},${yi}`;
      if (present(key)) {
        run.push(key);
      } else {
        flush();
      }
      if (present(key) && !joins("y", xi, yi + 1)) flush();
    }
    flush();
  }

  return members;
}

/**
 * 図に描くときの大梁の区間端の詰め（mm）。
 * 「無し」の交点で十字に交差して負けた側の区間は、優先側の大梁の面までで止める。
 */
export function girderEndCuts(
  floor: FireproofDrawingFloor,
  memberHalfOf?: HalfWidthOf,
): Record<string, { start: number; end: number }> {
  // girderMembers と同じ判定で、区間ごとの端の詰めだけを返す
  const xs = positions(floor.xSpans);
  const ys = positions(floor.ySpans);
  const nx = xs.length;
  const ny = ys.length;
  if (nx < 2 || ny < 1) return {};

  const sym = (key: string) => (floor.girders[key] ?? "").trim();
  const present = (key: string) => girderExists(floor, key);

  const mergeAt = (axis: "x" | "y", xi: number, yi: number): boolean => {
    if (columnExists(floor, xi, yi)) return false;
    if (axis === "x") {
      const left = `x:${xi - 1},${yi}`;
      const right = `x:${xi},${yi}`;
      return present(left) && present(right) && sym(left) === sym(right);
    }
    const above = `y:${xi},${yi - 1}`;
    const below = `y:${xi},${yi}`;
    return present(above) && present(below) && sym(above) === sym(below);
  };

  const order = new Map(
    Object.keys(floor.girders).map((key, index) => [key, index] as const),
  );
  const runOrder = (axis: "x" | "y", xi: number, yi: number): number => {
    const keys: string[] = [];
    if (axis === "x") {
      keys.push(`x:${xi - 1},${yi}`, `x:${xi},${yi}`);
      let j = xi + 1;
      while (mergeAt("x", j, yi)) {
        keys.push(`x:${j},${yi}`);
        j += 1;
      }
      j = xi - 1;
      while (mergeAt("x", j, yi)) {
        keys.push(`x:${j - 1},${yi}`);
        j -= 1;
      }
    } else {
      keys.push(`y:${xi},${yi - 1}`, `y:${xi},${yi}`);
      let j = yi + 1;
      while (mergeAt("y", xi, j)) {
        keys.push(`y:${xi},${j}`);
        j += 1;
      }
      j = yi - 1;
      while (mergeAt("y", xi, j)) {
        keys.push(`y:${xi},${j - 1}`);
        j -= 1;
      }
    }
    return Math.min(
      ...keys.map((key) => order.get(key) ?? Number.MAX_SAFE_INTEGER),
    );
  };

  const out: Record<string, { start: number; end: number }> = {};
  const cutAt = (key: string, end: "start" | "end", mm: number) => {
    const cur = out[key] ?? { start: 0, end: 0 };
    cur[end] = Math.max(cur[end], mm);
    out[key] = cur;
  };
  for (let yi = 0; yi < ny; yi++) {
    for (let xi = 0; xi < nx; xi++) {
      if (!mergeAt("x", xi, yi) || !mergeAt("y", xi, yi)) continue;
      const xFirst = runOrder("x", xi, yi) < runOrder("y", xi, yi);
      const [winner, loser] = xFirst
        ? (["x", "y"] as const)
        : (["y", "x"] as const);
      const winnerSym =
        winner === "x" ? sym(`x:${xi - 1},${yi}`) : sym(`y:${xi},${yi - 1}`);
      const half = memberHalfOf?.(winnerSym) ?? GIRDER_HALF;
      if (loser === "x") {
        cutAt(`x:${xi - 1},${yi}`, "end", half);
        cutAt(`x:${xi},${yi}`, "start", half);
      } else {
        cutAt(`y:${xi},${yi - 1}`, "end", half);
        cutAt(`y:${xi},${yi}`, "start", half);
      }
    }
  }
  return out;
}

/**
 * 柱記号→柱の四角の半分（mm）を伏図と同じルールで引く関数を作る。
 * 記号は柱リスト（その階の寸法）・階共通リストから拾う。
 * 梁型入力表への取り込みで、大梁の端を柱の面どうしの長さにするために使う。
 */
export function drawingColumnHalfOf(
  columnsList: FireproofFloorList,
  common: readonly FireproofCommonRow[],
  floorLabel: string,
): ColumnHalfOf {
  const columnAt = columnsList.floors.findIndex(
    (f) => f.label === floorLabel,
  );
  return (symbol) => {
    const member = columnsList.members.find(
      (m) => m.symbol.trim() === symbol.trim(),
    );
    const size =
      member !== undefined
        ? resolveSize(
            member,
            columnsList.floors,
            Math.max(0, columnAt),
            "column",
          )
        : (() => {
            const row = common.find(
              (r) => r.symbol.trim() === symbol.trim(),
            );
            return row === undefined ? null : resolveCommonRow(row);
          })();
    if (size === null) return null;
    const width = size.first;
    const depth = size.second ?? size.first;
    if (width === null || width <= 0) return null;
    return { hw: width / 2, hd: (depth ?? width) / 2 };
  };
}

/**
 * 伏図1階分の大梁・小梁を、梁型入力表へ取り込む行にする。
 * 大梁は通し番号どおり（X方向→Y方向）、小梁は上→下・左→右の見え方で並べる。
 * 「無し」の柱をまたぐ大梁は1部材にまとめ、十字になるところは先に入力した向きを優先（通し）にする。
 * コメントは位置だけ（大梁は軸-区間・小梁は区画。案内文の行は画面側で足す）。
 * 有効長は図に描かれている長さ（大梁は柱の面どうし・小梁は内内寸法。勾配ぶんも入れる）。
 */
export function beamImportItems(
  floor: FireproofDrawingFloor,
  floorHeight: number | null,
  columnHalfOf?: ColumnHalfOf,
  memberHalfOf?: HalfWidthOf,
): ColumnImportItem[] {
  const xs = positions(floor.xSpans);
  const ys = positions(floor.ySpans);

  /** 交点の柱の高さ（mm）。縦通り → 横通り → 階高 の順（柱の取り込みと同じ） */
  const colHeight = (xi: number, yi: number): number | null =>
    floor.axisHeights?.[String(yi)] ??
    floor.axisHeightsX?.[String(xi)] ??
    floorHeight;

  const girders: {
    no: number;
    position: string;
    symbol: string;
    mark: string;
    mm: number;
  }[] = [];
  const beams: {
    sort: number;
    position: string;
    symbol: string;
    mark: string;
    mm: number;
  }[] = [];

  girderMembers(floor, columnHalfOf, memberHalfOf).forEach((member) => {
    const start =
      member.axis === "x"
        ? xs[member.fromXi] + member.startCut
        : ys[member.fromYi] + member.startCut;
    const end =
      member.axis === "x"
        ? xs[member.toXi] - member.endCut
        : ys[member.toYi] - member.endCut;
    const plan = Math.max(0, end - start);
    const h1 = colHeight(member.fromXi, member.fromYi);
    const h2 = colHeight(member.toXi, member.toYi);
    const dh =
      floorHeight !== null && h1 !== null && h2 !== null
        ? Math.abs(h1 - h2)
        : 0;
    /** 位置（大梁は軸-区間。区間は通しのとき繋げて出す） */
    const position =
      member.axis === "x"
        ? `${yGridLabel(ys.length - 1 - member.fromYi)}-${xGridLabel(member.fromXi)}〜${xGridLabel(member.toXi)}`
        : `${xGridLabel(member.fromXi)}-${yGridLabel(ys.length - 1 - member.toYi)}〜${yGridLabel(ys.length - 1 - member.fromYi)}`;
    girders.push({
      no: girderNumber(member.axis, member.fromXi, member.fromYi, floor),
      position,
      symbol: member.symbol,
      mark:
        member.keys
          .map((key) => floor.jointSymbols?.[`g:${key}`] ?? "")
          .find((mark) => mark !== "") ?? "",
      mm: Math.hypot(plan, dh),
    });
  });
  /* 斜梁（2交点どうしを結ぶ大梁。端は両端の柱の、斜め方向の面ぶん詰める） */
  const girderTotal =
    ys.length * (xs.length - 1) + xs.length * (ys.length - 1);
  (floor.diagGirders ?? []).forEach((g, index) => {
    const symbol = g.symbol.trim();
    if (symbol === "") return;
    const ends = diagEnds(xs, ys, g);
    if (ends === null) return;
    const { x1, y1, x2, y2 } = ends;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const plan = Math.hypot(dx, dy);
    if (plan <= 0) return;
    const ux = dx / plan;
    const uy = dy / plan;
    /** 交点の柱の、斜め方向の面までの量（四角の半分を方向に写す）。
       線上の点を端にしたときはその場所が端なので面ぶんは引かない */
    const faceAt = (xi: number, yi: number, free?: { x: number; y: number }): number => {
      if (free !== undefined) return 0;
      if (!columnExists(floor, xi, yi)) return 0;
      const sym = (floor.columns[columnKey(xi, yi)] ?? "").trim();
      const half = columnHalfOf?.(sym) ?? {
        hw: COLUMN_HALF,
        hd: COLUMN_HALF,
      };
      return half.hw * Math.abs(ux) + half.hd * Math.abs(uy);
    };
    const len = Math.max(
      0,
      plan - faceAt(g.fx, g.fy, g.fromMm) - faceAt(g.tx, g.ty, g.toMm),
    );
    const h1 = colHeight(g.fx, g.fy);
    const h2 = colHeight(g.tx, g.ty);
    const dh =
      floorHeight !== null && h1 !== null && h2 !== null
        ? Math.abs(h1 - h2)
        : 0;
    girders.push({
      no: girderTotal + 1 + index,
      position: diagGirderPosition(floor, g),
      symbol,
      mark: floor.jointSymbols?.[`d:${g.id ?? `#${index}`}`] ?? "",
      mm: Math.hypot(len, dh),
    });
  });
  girders.sort((a, b) => a.no - b.no);

  floor.beams.forEach((beam, index) => {
    const mx = (beam.x1 + beam.x2) / 2;
    const my = (beam.y1 + beam.y2) / 2;
    /** 中点が入る区画の軸（柱線の間の番号） */
    const bay = (
      pos: number,
      lines: number[],
    ): { from: number; to: number } | null => {
      if (lines.length < 2) return null;
      const at = Math.min(
        Math.max(
          lines.findIndex(
            (_v, i) =>
              i < lines.length - 1 &&
              pos >= (lines[i] ?? 0) &&
              pos < (lines[i + 1] ?? 0),
          ),
          0,
        ),
        lines.length - 2,
      );
      return { from: at, to: at + 1 };
    };
    const xb = bay(mx, xs);
    const yb = bay(my, ys);
    const position =
      xb !== null && yb !== null
        ? `${xGridLabel(xb.from)}〜${xGridLabel(xb.to)}-${yGridLabel(ys.length - 1 - yb.to)}〜${yGridLabel(ys.length - 1 - yb.from)}`
        : "小";
    const mm =
      floorHeight === null
        ? beamLength(beam)
        : beamSlopeLength(beam, floor, floorHeight);
    beams.push({
      sort: index,
      position,
      symbol: beam.symbol.trim(),
      mark: floor.jointSymbols?.[`b:${beam.id ?? `#${index}`}`] ?? "",
      mm,
    });
  });
  beams.sort((a, b) => a.sort - b.sort);

  return [...girders, ...beams].map((item) => ({
    comment: item.position,
    symbol: item.symbol,
    mark: item.mark,
    lengthFormula: String(Math.round(item.mm) / 1000),
  }));
}
