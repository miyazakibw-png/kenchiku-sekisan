/**
 * 鉄骨伏図（耐火被覆・塗装積算入力の図面）1階分の中身。
 * 柱線寸法線 → 交点の柱 → 柱間の大梁 を「番号に記号を入れる」だけで描く作り。
 */

/** 小梁1本。大梁に囲まれた区画を等分割して置く（端点はmm） */
export interface FireproofDrawingBeam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 記号（B40 など） */
  symbol: string;
}

/** 線の描き幅の半分（mm）。部材の幅（リストの後ろの数字）が分からないときの既定値。
    小梁の端を線の内側（内内寸法）に寄せる量としても使う */
export const GIRDER_HALF = 75; // 大梁（幅が不明なとき150mm幅で描く）
export const BEAM_HALF = 60; // 小梁（幅が不明なとき120mm幅で描く）

/** 区画の境界線の半幅（mm）→ 内内寸法を出す量。部材幅の半分 */
export type HalfWidthOf = (symbol: string) => number | null;

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
}

export interface FireproofDrawingFloor {
  /** X軸方向の柱線寸法（mm）。例 [7300, 7650, 7300] */
  xSpans: number[];
  /** Y軸方向の柱線寸法（mm）。例 [7350, 6650] */
  ySpans: number[];
  /** 交点ごとの柱記号。キー "xi,yi"（x軸xi番目・y軸yi番目の交点）→ "C1" など */
  columns: Record<string, string>;
  /** 柱間区間ごとの大梁記号。キー "x:xi,yi"（xi,yiの交点から右へ1区間）・"y:xi,yi"（下へ1区間）→ "G1" など */
  girders: Record<string, string>;
  /** 小梁（区画を分割して置く線） */
  beams: FireproofDrawingBeam[];
  /** 他の計算書へ呼び出せるように書き出した画像（データURL）。無いときは空文字 */
  image: string;
  /** 書き出した画像の 1mm あたり画素数（呼び出す側の縮尺に使う） */
  pixelsPerMm: number;
  /** 書き出した画像の幅・高さ（画素） */
  imageWidth: number;
  imageHeight: number;
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

const stringMap = (value: unknown): Record<string, string> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return {};
  const map: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (typeof item === "string" && item.trim() !== "") map[key] = item.trim();
  });
  return map;
};

function normalizeFloor(raw: unknown): FireproofDrawingFloor {
  const floor = emptyFloor();
  if (raw === null || typeof raw !== "object") return floor;
  const row = raw as Partial<FireproofDrawingFloor>;
  return {
    xSpans: numberList(row.xSpans),
    ySpans: numberList(row.ySpans),
    columns: stringMap(row.columns),
    girders: stringMap(row.girders),
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
        y: ys[yi],
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
        x: xs[xi],
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
  let left = -Infinity;
  let right = Infinity;
  let top = -Infinity;
  let bottom = Infinity;
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
  return beams;
}

/** 小梁の長さ（mm） */
export function beamLength(beam: FireproofDrawingBeam): number {
  return Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1);
}

/**
 * 小梁の端を、今の図面（大梁・柱線・部材の幅）に合わせて入れ直す。
 * 中点を囲む区画を拾い直して、軸方向の両端をその区画の内内寸法に止める。
 * 寸法や記号の幅が変わったときに呼ぶと、長さ表示が図面に連動する。
 */
export function refitBeams(
  floor: FireproofDrawingFloor,
  halfWidthOf?: HalfWidthOf,
): FireproofDrawingBeam[] {
  return floor.beams.map((beam) => {
    const mx = (beam.x1 + beam.x2) / 2;
    const my = (beam.y1 + beam.y2) / 2;
    const region = enclosingRegion(floor, mx, my, halfWidthOf);
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
