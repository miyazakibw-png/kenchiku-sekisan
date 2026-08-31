/**
 * ピット計算書の図形と数量。
 * ピット（Ｐ1・Ｐ2…）ごとに四角の平面を作り、床・壁・梁・天井の数量を出す。
 * 長さの単位はすべてメートル。
 */

/** 前のピットから見た置き方 */
export type PitDirection = "right" | "left" | "up" | "down";

/** 前のピットとどの辺をそろえるか（左右に置くときは上下、上下に置くときは左右） */
export type PitAlign = "start" | "center" | "end";

/** ピット1個（四角の平面） */
export interface PitShape {
  id: string;
  /** 記号（Ｐ1・Ｐ2…） */
  symbol: string;
  /** X方向（よこ）の内法寸法 */
  x: number;
  /** Y方向（たて）の内法寸法 */
  y: number;
  /** 深さ（天井高さと同じ考え方。ピットごとに変えられる） */
  depth: number;
  /** 前のピットから見てどちら側に置くか（1個目は使わない） */
  direction: PitDirection;
  /** 前のピットとのすき間 */
  gap: number;
  /** 前のピットとのそろえ方（初期は start＝上そろえ・左そろえ） */
  align?: PitAlign;
  /** どのピットを基準に置くか（未指定はすぐ前のピット） */
  baseId?: string;
  /** 斜めにする角（隣り合う2つを入れると台形になる） */
  corners?: PitCorner[];
  /** 斜めのX方向の量 */
  cutX?: number;
  /** 斜めのY方向の量 */
  cutY?: number;
}

/** ピットの角。左上・右上・右下・左下 */
export type PitCorner = "tl" | "tr" | "br" | "bl";

/** 図形の角（ピットの左上を0とした座標） */
export interface PitPoint {
  x: number;
  y: number;
}

/** 天井付き梁型（X方向・Y方向のどちらかに通る） */
export interface PitBeam {
  id: string;
  /** どのピットに付くか */
  pitId: string;
  /** X：よこ向きに通る梁／Y：たて向きに通る梁 */
  axis: "X" | "Y";
  /** 梁幅 */
  width: number;
  /** 梁成 */
  height: number;
  /** 図の中で置いた位置（0〜1。梁の長さは壁までで自動） */
  position: number;
  /** 消した本（高い梁で分かれた何本目か。0から数える） */
  removed?: number[];
}

/**
 * ピットの形を角の並びにする（ピットの左上が0）。
 * X・Yは最大寸法のまま。斜めにした角は、欠きX・欠きYの分だけ切り落とす。
 */
export function pitPolygon(pit: PitShape): PitPoint[] {
  const cutX = Math.min(Math.max(pit.cutX ?? 0, 0), pit.x);
  const cutY = Math.min(Math.max(pit.cutY ?? 0, 0), pit.y);
  const corners = pit.corners ?? [];
  const cut = (corner: PitCorner): boolean =>
    corners.includes(corner) && cutX > 0 && cutY > 0;
  const points: PitPoint[] = [];
  if (cut("tl")) {
    points.push({ x: 0, y: cutY }, { x: cutX, y: 0 });
  } else {
    points.push({ x: 0, y: 0 });
  }
  if (cut("tr")) {
    points.push({ x: pit.x - cutX, y: 0 }, { x: pit.x, y: cutY });
  } else {
    points.push({ x: pit.x, y: 0 });
  }
  if (cut("br")) {
    points.push({ x: pit.x, y: pit.y - cutY }, { x: pit.x - cutX, y: pit.y });
  } else {
    points.push({ x: pit.x, y: pit.y });
  }
  if (cut("bl")) {
    points.push({ x: cutX, y: pit.y }, { x: 0, y: pit.y - cutY });
  } else {
    points.push({ x: 0, y: pit.y });
  }
  return points.filter((point, index) => {
    const before = points[(index + points.length - 1) % points.length];
    return before.x !== point.x || before.y !== point.y;
  });
}

/** 多角形の面積（座標の順に足し引きして出す） */
export function polygonArea(points: readonly PitPoint[]): number {
  let total = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    total += point.x * next.y - next.x * point.y;
  });
  return Math.abs(total) / 2;
}

/** 多角形の周りの長さ */
export function polygonPerimeter(points: readonly PitPoint[]): number {
  let total = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    total += Math.hypot(next.x - point.x, next.y - point.y);
  });
  return total;
}

/** 図形全体の角の数（ピットごとの角を足したもの） */
export function pitCornerCount(pits: readonly PitShape[]): number {
  return pits.reduce((total, pit) => total + pitPolygon(pit).length, 0);
}

/** 高い梁で分かれた梁1本の区間 */
export interface PitBeamSegment {
  /** 何本目か（消すときの目印） */
  index: number;
  from: number;
  to: number;
}

/** 図に置いたピットの位置（左上を基準とした座標） */
export interface PitRect {
  id: string;
  symbol: string;
  left: number;
  top: number;
  x: number;
  y: number;
}

/** ピット1個の数量 */
export interface PitQuantity {
  id: string;
  symbol: string;
  /** 床面積 */
  floorArea: number;
  /** 壁面長さ（内周） */
  wallLength: number;
  /** 深さ */
  depth: number;
  /** 壁面面積 */
  wallArea: number;
  /** 梁底面積（天井の差し引き用） */
  beamBottomArea: number;
  /** 梁面積（梁成を含む梁の表面） */
  beamArea: number;
  /** 天井面積（床面積から梁底面積を引いた分） */
  ceilingArea: number;
}

/** 図に置いた梁（長さは当たる壁までで自動） */
export interface PitBeamLine {
  id: string;
  pitId: string;
  symbol: string;
  axis: "X" | "Y";
  width: number;
  height: number;
  /** 梁の長さ（壁から壁まで。高い梁に当たる分は引く） */
  length: number;
  /** 高い梁で分かれた1本ずつの区間（梁の向きに沿った位置） */
  segments: PitBeamSegment[];
  /** 図の中で置いた位置（0〜1） */
  position: number;
  /** 図の中の位置（左上を基準とした梁の中心線） */
  left: number;
  top: number;
}

export const DEFAULT_PIT_GAP = 0.5;

/** 記号（Ｐ1・Ｐ2…）を並び順から作る */
export function pitSymbol(index: number): string {
  return `Ｐ${index + 1}`;
}

/** 計算式で使う記号（FA1・WA1…）の番号。全角のＰ記号とは分けて持つ */
function pitNumber(index: number): string {
  return String(index + 1);
}

/** ピットを順番に並べる。1個目を基準に、2個目からは向きとすき間で置く */
export function layoutPits(pits: readonly PitShape[]): PitRect[] {
  const rects: PitRect[] = [];
  pits.forEach((pit, index) => {
    if (index === 0) {
      rects.push({ id: pit.id, symbol: pit.symbol, left: 0, top: 0, x: pit.x, y: pit.y });
      return;
    }
    const previous =
      rects.find((rect) => rect.id === pit.baseId) ?? rects[index - 1];
    const gap = pit.gap;
    const align = pit.align ?? "start";
    let left = previous.left;
    let top = previous.top;
    if (pit.direction === "right" || pit.direction === "left") {
      left =
        pit.direction === "right"
          ? previous.left + previous.x + gap
          : previous.left - (pit.x + gap);
      if (align === "center") top = previous.top + (previous.y - pit.y) / 2;
      if (align === "end") top = previous.top + previous.y - pit.y;
    } else {
      top =
        pit.direction === "down"
          ? previous.top + previous.y + gap
          : previous.top - (pit.y + gap);
      if (align === "center") left = previous.left + (previous.x - pit.x) / 2;
      if (align === "end") left = previous.left + previous.x - pit.x;
    }
    rects.push({ id: pit.id, symbol: pit.symbol, left, top, x: pit.x, y: pit.y });
  });
  return rects;
}

/** 図全体の大きさ（左上を0にそろえた並び） */
export function normalizeRects(rects: readonly PitRect[]): {
  rects: PitRect[];
  width: number;
  height: number;
} {
  if (rects.length === 0) return { rects: [], width: 0, height: 0 };
  const minLeft = Math.min(...rects.map((rect) => rect.left));
  const minTop = Math.min(...rects.map((rect) => rect.top));
  const moved = rects.map((rect) => ({
    ...rect,
    left: rect.left - minLeft,
    top: rect.top - minTop,
  }));
  return {
    rects: moved,
    width: Math.max(...moved.map((rect) => rect.left + rect.x)),
    height: Math.max(...moved.map((rect) => rect.top + rect.y)),
  };
}

/**
 * 梁の区間。壁から壁までを、梁成Hの高い直交する梁で分けて1本ずつにする。
 * 消した本（removed）は外す。
 */
export function beamSegments(
  pit: PitShape,
  beam: PitBeam,
  beams: readonly PitBeam[],
): PitBeamSegment[] {
  const span = beam.axis === "X" ? pit.x : pit.y;
  const cuts = beams
    .filter(
      (other) =>
        other.pitId === beam.pitId &&
        other.id !== beam.id &&
        other.axis !== beam.axis &&
        other.height > beam.height,
    )
    .map((other) => {
      const center = Math.min(Math.max(other.position, 0), 1) * span;
      return {
        from: Math.max(center - other.width / 2, 0),
        to: Math.min(center + other.width / 2, span),
      };
    })
    .sort((a, b) => a.from - b.from);

  const pieces: PitBeamSegment[] = [];
  let start = 0;
  cuts.forEach((cut) => {
    if (cut.from > start)
      pieces.push({ index: pieces.length, from: start, to: cut.from });
    start = Math.max(start, cut.to);
  });
  if (start < span)
    pieces.push({ index: pieces.length, from: start, to: span });
  const removed = beam.removed ?? [];
  return pieces.filter((piece) => !removed.includes(piece.index));
}

/** 梁の長さ（高い梁で止まった分を除いた合計） */
export function beamLength(
  pit: PitShape,
  beam: PitBeam,
  beams: readonly PitBeam[],
): number {
  return beamSegments(pit, beam, beams).reduce(
    (total, segment) => total + (segment.to - segment.from),
    0,
  );
}

/** 梁を図に置く。長さは付いているピットの壁から壁まで */
export function beamLines(
  pits: readonly PitShape[],
  rects: readonly PitRect[],
  beams: readonly PitBeam[],
): PitBeamLine[] {
  const lines: PitBeamLine[] = [];
  beams.forEach((beam) => {
    const rect = rects.find((each) => each.id === beam.pitId);
    const pit = pits.find((each) => each.id === beam.pitId);
    if (!rect || !pit) return;
    const ratio = Math.min(Math.max(beam.position, 0), 1);
    const segments = beamSegments(pit, beam, beams);
    const length = segments.reduce(
      (total, segment) => total + (segment.to - segment.from),
      0,
    );
    if (beam.axis === "X") {
      lines.push({
        id: beam.id,
        pitId: beam.pitId,
        symbol: rect.symbol,
        axis: "X",
        width: beam.width,
        height: beam.height,
        length,
        segments,
        position: ratio,
        left: rect.left,
        top: rect.top + rect.y * ratio,
      });
      return;
    }
    lines.push({
      id: beam.id,
      pitId: beam.pitId,
      symbol: rect.symbol,
      axis: "Y",
      width: beam.width,
      height: beam.height,
      length,
      segments,
      position: ratio,
      left: rect.left + rect.x * ratio,
      top: rect.top,
    });
  });
  return lines;
}

/**
 * ピットごとの数量。
 * 梁底面積＝梁幅×長さ（天井から差し引く分）、梁面積＝（梁幅＋梁成×2）×長さ（天井付き梁型の表面）。
 */
export function pitQuantities(
  pits: readonly PitShape[],
  beams: readonly PitBeam[],
): PitQuantity[] {
  return pits.map((pit) => {
    const own = beams.filter((beam) => beam.pitId === pit.id);
    const points = pitPolygon(pit);
    const floorArea = polygonArea(points);
    const wallLength = polygonPerimeter(points);
    let beamBottomArea = 0;
    let beamArea = 0;
    own.forEach((beam) => {
      const length = beamLength(pit, beam, beams);
      beamBottomArea += beam.width * length;
      beamArea += (beam.width + beam.height * 2) * length;
    });
    return {
      id: pit.id,
      symbol: pit.symbol,
      floorArea,
      wallLength,
      depth: pit.depth,
      wallArea: wallLength * pit.depth,
      beamBottomArea,
      beamArea,
      ceilingArea: floorArea - beamBottomArea,
    };
  });
}

/** 計算式に書くピットの記号（Ｐ1→P1）。中身はセットの部位で変わる */
export function pitFormulaSymbol(index: number): string {
  return `P${pitNumber(index)}`;
}

/**
 * セットの部位で中身が変わるＰ記号。
 * 床＝床面積／壁＝壁面面積／梁型＝梁面積／天井＝天井面積
 */
export function pitPartVariables(
  quantities: readonly PitQuantity[],
  partName: string,
): Record<string, number> {
  const values: Record<string, number> = {};
  quantities.forEach((quantity, index) => {
    values[pitFormulaSymbol(index)] = partName.includes("天井")
      ? quantity.ceilingArea
      : partName.includes("梁")
        ? quantity.beamArea
        : partName.includes("壁")
          ? quantity.wallArea
          : quantity.floorArea;
  });
  return values;
}

/** 計算式に使える記号（FA1…はピットごと、FA…は全部の合計） */
export function pitVariables(quantities: readonly PitQuantity[]): Record<string, number> {
  const values: Record<string, number> = {};
  let floorArea = 0;
  let wallLength = 0;
  let wallArea = 0;
  let beamArea = 0;
  let beamBottomArea = 0;
  let ceilingArea = 0;
  quantities.forEach((quantity, index) => {
    const no = pitNumber(index);
    values[`FA${no}`] = quantity.floorArea;
    values[`WL${no}`] = quantity.wallLength;
    values[`DP${no}`] = quantity.depth;
    values[`WA${no}`] = quantity.wallArea;
    values[`GB${no}`] = quantity.beamBottomArea;
    values[`GA${no}`] = quantity.beamArea;
    values[`CA${no}`] = quantity.ceilingArea;
    floorArea += quantity.floorArea;
    wallLength += quantity.wallLength;
    wallArea += quantity.wallArea;
    beamArea += quantity.beamArea;
    beamBottomArea += quantity.beamBottomArea;
    ceilingArea += quantity.ceilingArea;
  });
  values.FA = floorArea;
  values.WL = wallLength;
  values.WA = wallArea;
  values.GA = beamArea;
  values.GB = beamBottomArea;
  values.CA = ceilingArea;
  return values;
}
