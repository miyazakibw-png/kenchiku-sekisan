/**
 * ピット計算書の図形と数量。
 * ピット（Ｐ1・Ｐ2…）ごとに四角の平面を作り、床・壁・梁・天井の数量を出す。
 * 長さの単位はすべてメートル。
 */

/** 前のピットから見た置き方 */
export type PitDirection = "right" | "left" | "up" | "down" | "free";

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
  /** 自由な形の角（左上を0とした座標。無いときは四角） */
  points?: PitPoint[];
  /** 置き方が「自由」のときの、基準ピットの左からの位置 */
  offsetX?: number;
  /** 置き方が「自由」のときの、基準ピットの上からの位置 */
  offsetY?: number;
  /** 角を動かして外枠が変わっても図の位置を保つためのずれ（横） */
  shiftX?: number;
  /** 角を動かして外枠が変わっても図の位置を保つためのずれ（縦） */
  shiftY?: number;
  /** 形の種類（四角・Ｌ型・コ型）。角を動かすと自由な形になる */
  kind?: PitKind;
  /** Ｌ型・コ型の欠きX（よこの欠き寸法） */
  cutW?: number;
  /** Ｌ型・コ型の欠きY（たての欠き寸法） */
  cutD?: number;
  /** Ｌ型でどの角を欠くか（初期は右下） */
  cutCorner?: PitCorner;
  /** コ型でどの辺を欠くか（初期は下） */
  cutSide?: PitSide;
  /** コ型の欠きの位置（辺の左または上からの寸法） */
  cutAt?: number;
  /** 斜めにする角（古いデータ用。角を動かす方式に置き換え） */
  corners?: PitCorner[];
  /** 斜めのX方向の量（古いデータ用） */
  cutX?: number;
  /** 斜めのY方向の量（古いデータ用） */
  cutY?: number;
}

/** ピットの角。左上・右上・右下・左下 */
export type PitCorner = "tl" | "tr" | "br" | "bl";

/** ピットの辺。上・下・左・右 */
export type PitSide = "top" | "bottom" | "left" | "right";

/** 形の種類。四角／Ｌ型／コ型 */
export type PitKind = "rect" | "L" | "U";

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
function shapePoints(pit: PitShape): PitPoint[] | null {
  const w = Math.min(Math.max(pit.cutW ?? 0, 0), pit.x);
  const d = Math.min(Math.max(pit.cutD ?? 0, 0), pit.y);
  if (w <= 0 || d <= 0) return null;
  const x = pit.x;
  const y = pit.y;

  if (pit.kind === "L") {
    switch (pit.cutCorner ?? "br") {
      case "tl":
        return [
          { x: w, y: 0 },
          { x, y: 0 },
          { x, y },
          { x: 0, y },
          { x: 0, y: d },
          { x: w, y: d },
        ];
      case "tr":
        return [
          { x: 0, y: 0 },
          { x: x - w, y: 0 },
          { x: x - w, y: d },
          { x, y: d },
          { x, y },
          { x: 0, y },
        ];
      case "bl":
        return [
          { x: 0, y: 0 },
          { x, y: 0 },
          { x, y },
          { x: w, y },
          { x: w, y: y - d },
          { x: 0, y: y - d },
        ];
      default:
        return [
          { x: 0, y: 0 },
          { x, y: 0 },
          { x, y: y - d },
          { x: x - w, y: y - d },
          { x: x - w, y },
          { x: 0, y },
        ];
    }
  }

  if (pit.kind === "U") {
    const side = pit.cutSide ?? "bottom";
    const along = side === "top" || side === "bottom" ? x : y;
    const size = side === "top" || side === "bottom" ? w : d;
    const deep = side === "top" || side === "bottom" ? d : w;
    const at = Math.min(Math.max(pit.cutAt ?? (along - size) / 2, 0), along - size);
    const end = at + size;

    switch (side) {
      case "top":
        return [
          { x: 0, y: 0 },
          { x: at, y: 0 },
          { x: at, y: deep },
          { x: end, y: deep },
          { x: end, y: 0 },
          { x, y: 0 },
          { x, y },
          { x: 0, y },
        ];
      case "left":
        return [
          { x: 0, y: 0 },
          { x, y: 0 },
          { x, y },
          { x: 0, y },
          { x: 0, y: end },
          { x: deep, y: end },
          { x: deep, y: at },
          { x: 0, y: at },
        ];
      case "right":
        return [
          { x: 0, y: 0 },
          { x, y: 0 },
          { x, y: at },
          { x: x - deep, y: at },
          { x: x - deep, y: end },
          { x, y: end },
          { x, y },
          { x: 0, y },
        ];
      default:
        return [
          { x: 0, y: 0 },
          { x, y: 0 },
          { x, y },
          { x: end, y },
          { x: end, y: y - deep },
          { x: at, y: y - deep },
          { x: at, y },
          { x: 0, y },
        ];
    }
  }

  return null;
}

export function pitPolygon(pit: PitShape): PitPoint[] {
  const free = pit.points ?? [];
  if (free.length >= 3) return free.map((point) => ({ ...point }));
  const shape = shapePoints(pit);
  if (shape) return shape;
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

/** 小数4桁で丸める（角を動かしたときの端数をためない） */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** 角の並びを左上0にそろえる */
function normalizePoints(points: readonly PitPoint[]): PitPoint[] {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  return points.map((point) => ({
    x: round4(point.x - minX),
    y: round4(point.y - minY),
  }));
}

/**
 * 角の並びを入れ替えたピット（X・Yは外形の最大寸法に直す）。
 * 角を左上に寄せ直した分は、ずれ（shiftX・shiftY）に入れて図の位置を保つ。
 */
function withPoints(pit: PitShape, points: readonly PitPoint[]): PitShape {
  const fixed = normalizePoints(points);
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  return {
    ...pit,
    points: fixed,
    shiftX: round4((pit.shiftX ?? 0) + minX),
    shiftY: round4((pit.shiftY ?? 0) + minY),
    x: round4(Math.max(...fixed.map((point) => point.x))),
    y: round4(Math.max(...fixed.map((point) => point.y))),
    kind: undefined,
    corners: undefined,
    cutX: undefined,
    cutY: undefined,
  };
}

/** 選んだ角を上下左右へ動かす（右・下がプラス） */
export function movePitCorner(
  pit: PitShape,
  index: number,
  dx: number,
  dy: number,
): PitShape {
  return movePitCorners(pit, [index], dx, dy);
}

/** 選んだいくつかの角をまとめて上下左右へ動かす（右・下がプラス） */
export function movePitCorners(
  pit: PitShape,
  indexes: readonly number[],
  dx: number,
  dy: number,
): PitShape {
  const points = pitPolygon(pit);
  const targets = indexes.filter(
    (index) => index >= 0 && index < points.length,
  );
  if (targets.length === 0) return pit;
  const moved = points.map((point, at) =>
    targets.includes(at) ? { x: point.x + dx, y: point.y + dy } : point,
  );
  return withPoints(pit, moved);
}

/** 選んだいくつかの角の横（x）または縦（y）の位置を、同じ値にそろえる */
export function alignPitCorners(
  pit: PitShape,
  indexes: readonly number[],
  axis: "x" | "y",
  value: number,
): PitShape {
  const points = pitPolygon(pit);
  const targets = indexes.filter(
    (index) => index >= 0 && index < points.length,
  );
  if (targets.length === 0) return pit;
  const moved = points.map((point, at) =>
    targets.includes(at)
      ? axis === "x"
        ? { x: value, y: point.y }
        : { x: point.x, y: value }
      : point,
  );
  return withPoints(pit, moved);
}

/** 選んだ角を指す場所へ動かす（ピットの左上を0とした座標） */
export function setPitCorner(
  pit: PitShape,
  index: number,
  at: PitPoint,
): PitShape {
  const points = pitPolygon(pit);
  if (index < 0 || index >= points.length) return pit;
  return withPoints(
    pit,
    points.map((point, position) => (position === index ? at : point)),
  );
}

/** クリックした場所に近い辺へ角を足す */
export function addPitCorner(pit: PitShape, at: PitPoint): PitShape {
  const points = pitPolygon(pit);
  let bestIndex = 0;
  let bestPoint: PitPoint = points[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const vx = next.x - point.x;
    const vy = next.y - point.y;
    const span = vx * vx + vy * vy;
    const ratio =
      span === 0
        ? 0
        : Math.min(
            Math.max(((at.x - point.x) * vx + (at.y - point.y) * vy) / span, 0),
            1,
          );
    const on = { x: point.x + vx * ratio, y: point.y + vy * ratio };
    const distance = Math.hypot(at.x - on.x, at.y - on.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
      bestPoint = on;
    }
  });
  const next = [...points];
  next.splice(bestIndex + 1, 0, bestPoint);
  return withPoints(pit, next);
}

/** 選んだ角を消す（3つより減らさない） */
export function removePitCorner(pit: PitShape, index: number): PitShape {
  const points = pitPolygon(pit);
  if (points.length <= 3 || index < 0 || index >= points.length) return pit;
  return withPoints(
    pit,
    points.filter((_point, at) => at !== index),
  );
}

/** 形を四角に戻す（X・Yはそのまま） */
export function rectanglePit(pit: PitShape): PitShape {
  return {
    ...pit,
    points: undefined,
    shiftX: undefined,
    shiftY: undefined,
    kind: undefined,
    cutW: undefined,
    cutD: undefined,
    cutCorner: undefined,
    cutSide: undefined,
    cutAt: undefined,
    corners: undefined,
    cutX: undefined,
    cutY: undefined,
  };
}

/**
 * 形の種類（四角／Ｌ型／コ型）を選び直す。
 * 角を動かして作った自由な形は消し、X・Yと欠き寸法から作り直す。
 */
export function setPitKind(pit: PitShape, kind: PitKind): PitShape {
  const base = rectanglePit(pit);
  if (kind === "rect") return base;
  return {
    ...base,
    kind,
    cutW: pit.cutW && pit.cutW > 0 ? pit.cutW : round4(pit.x / 3),
    cutD: pit.cutD && pit.cutD > 0 ? pit.cutD : round4(pit.y / 3),
    cutCorner: pit.cutCorner ?? "br",
    cutSide: pit.cutSide ?? "bottom",
    cutAt: pit.cutAt,
  };
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
      rects.push({
        id: pit.id,
        symbol: pit.symbol,
        left: pit.shiftX ?? 0,
        top: pit.shiftY ?? 0,
        x: pit.x,
        y: pit.y,
      });
      return;
    }
    const previous =
      rects.find((rect) => rect.id === pit.baseId) ?? rects[index - 1];
    const gap = pit.gap;
    const align = pit.align ?? "start";
    let left = previous.left;
    let top = previous.top;
    if (pit.direction === "free") {
      rects.push({
        id: pit.id,
        symbol: pit.symbol,
        left: previous.left + (pit.offsetX ?? 0) + (pit.shiftX ?? 0),
        top: previous.top + (pit.offsetY ?? 0) + (pit.shiftY ?? 0),
        x: pit.x,
        y: pit.y,
      });
      return;
    }
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
    rects.push({
      id: pit.id,
      symbol: pit.symbol,
      left: left + (pit.shiftX ?? 0),
      top: top + (pit.shiftY ?? 0),
      x: pit.x,
      y: pit.y,
    });
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
