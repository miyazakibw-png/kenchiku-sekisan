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
  /** 柱にした壁（辺）の番号（角i→角i+1）。入っていない辺は壁 */
  columns?: number[];
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

/** 天井付き梁型（X方向・Y方向、または斜めの壁に沿う梁） */
export interface PitBeam {
  id: string;
  /** どのピットに付くか */
  pitId: string;
  /** X：よこ向きに通る梁／Y：たて向きに通る梁／E：壁（辺）に沿う梁 */
  axis: "X" | "Y" | "E";
  /** Eのとき、どの辺に沿わせるか（形の角の番号。角i→角i+1の辺） */
  edge?: number;
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
    const at = Math.min(
      Math.max(pit.cutAt ?? (along - size) / 2, 0),
      along - size,
    );
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

/**
 * なぞった図（mの点の並び）をピットの形にする。
 * 左上を0にそろえ、X・Yは外形の最大寸法にする（欠き・柱の指定は作り直す）。
 */
export function setPitPoints(
  pit: PitShape,
  points: readonly PitPoint[],
): PitShape {
  if (points.length < 3) return pit;
  const fixed = normalizePoints(points);
  return {
    ...pit,
    points: fixed,
    x: round4(Math.max(...fixed.map((point) => point.x))),
    y: round4(Math.max(...fixed.map((point) => point.y))),
    kind: undefined,
    columns: undefined,
    corners: undefined,
    cutW: undefined,
    cutD: undefined,
    cutCorner: undefined,
    cutSide: undefined,
    cutAt: undefined,
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
    columns: undefined,
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
 * Ｌ型・コ型で欠いた所へぴったり収まる□の大きさと、ピットの左上から見た位置。
 * 欠きが無い（四角・自由な形）ときは null。
 */
export function pitNotch(
  pit: PitShape,
  gap = 0,
): { x: number; y: number; offsetX: number; offsetY: number } | null {
  if (pit.points && pit.points.length >= 3) return null;
  const w = Math.min(Math.max(pit.cutW ?? 0, 0), pit.x);
  const d = Math.min(Math.max(pit.cutD ?? 0, 0), pit.y);
  if (w <= 0 || d <= 0) return null;

  if (pit.kind === "L") {
    // Ｌ型は2方（たてとよこの内側）にすき間を空ける
    const g = Math.max(Math.min(gap, w / 2, d / 2), 0);
    const corner = pit.cutCorner ?? "br";
    const right = corner === "tr" || corner === "br";
    const bottom = corner === "bl" || corner === "br";
    return {
      x: round4(w - g),
      y: round4(d - g),
      offsetX: right ? round4(pit.x - (w - g)) : 0,
      offsetY: bottom ? round4(pit.y - (d - g)) : 0,
    };
  }

  if (pit.kind === "U") {
    const side = pit.cutSide ?? "bottom";
    const along = side === "top" || side === "bottom" ? pit.x : pit.y;
    const size = side === "top" || side === "bottom" ? w : d;
    const at = Math.min(
      Math.max(pit.cutAt ?? (along - size) / 2, 0),
      along - size,
    );
    // コ型は3方（両わきと奥）にすき間を空ける
    const g = Math.max(Math.min(gap, w / 3, d / 3), 0);
    switch (side) {
      case "top":
        return {
          x: round4(w - g * 2),
          y: round4(d - g),
          offsetX: round4(at + g),
          offsetY: 0,
        };
      case "bottom":
        return {
          x: round4(w - g * 2),
          y: round4(d - g),
          offsetX: round4(at + g),
          offsetY: round4(pit.y - (d - g)),
        };
      case "left":
        return {
          x: round4(w - g),
          y: round4(d - g * 2),
          offsetX: 0,
          offsetY: round4(at + g),
        };
      default:
        return {
          x: round4(w - g),
          y: round4(d - g * 2),
          offsetX: round4(pit.x - (w - g)),
          offsetY: round4(at + g),
        };
    }
  }

  return null;
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

/** 点が図形の中にあるか */
function insidePolygon(points: readonly PitPoint[], at: PitPoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (
      a.y > at.y !== b.y > at.y &&
      at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

/** 点から線分までの近さ */
function distanceToSegment(at: PitPoint, a: PitPoint, b: PitPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.min(
          Math.max(((at.x - a.x) * dx + (at.y - a.y) * dy) / length, 0),
          1,
        );
  return Math.hypot(at.x - (a.x + dx * t), at.y - (a.y + dy * t));
}

/**
 * 記号や寸法の文字を置く場所（ピットの左上を0とした座標）。
 * 欠いた所（Ｌ型・コ型の中）や、細い所を避けて、いちばん広い所に置く。
 */
export function pitLabelPoint(pit: PitShape): PitPoint {
  const points = pitPolygon(pit);
  if (points.length < 3) return { x: pit.x / 2, y: pit.y / 2 };
  const width = Math.max(...points.map((point) => point.x));
  const height = Math.max(...points.map((point) => point.y));
  const steps = 24;
  const middle = { x: width / 2, y: height / 2 };
  let best = middle;
  let bestRoom = -1;
  let bestNear = Number.POSITIVE_INFINITY;
  for (let ix = 1; ix < steps; ix += 1) {
    for (let iy = 1; iy < steps; iy += 1) {
      const at = { x: (width * ix) / steps, y: (height * iy) / steps };
      if (!insidePolygon(points, at)) continue;
      let room = Number.POSITIVE_INFINITY;
      points.forEach((point, index) => {
        const next = points[(index + 1) % points.length];
        room = Math.min(room, distanceToSegment(at, point, next));
      });
      // 同じ広さなら真ん中に近い所へ置く
      const near = Math.hypot(at.x - middle.x, at.y - middle.y);
      if (
        room > bestRoom + 1e-9 ||
        (room > bestRoom - 1e-9 && near < bestNear)
      ) {
        bestRoom = room;
        bestNear = near;
        best = at;
      }
    }
  }
  return { x: round4(best.x), y: round4(best.y) };
}

/** ピットの壁の1辺（斜めの壁に梁を付けるときに使う） */
export interface PitEdge {
  /** 何番目の辺か（角i→角i+1） */
  index: number;
  from: PitPoint;
  to: PitPoint;
  /** 辺の長さ */
  length: number;
  /** たて・よこのどちらでもない斜めの辺か */
  slant: boolean;
}

/** ピットの壁（辺）の一覧 */
export function pitEdges(pit: PitShape): PitEdge[] {
  const points = pitPolygon(pit);
  return points.map((from, index) => {
    const to = points[(index + 1) % points.length];
    return {
      index,
      from,
      to,
      length: round4(Math.hypot(to.x - from.x, to.y - from.y)),
      slant: Math.abs(to.x - from.x) > 1e-9 && Math.abs(to.y - from.y) > 1e-9,
    };
  });
}

/**
 * 選んだ壁（辺）をまとめて柱にする／壁に戻す。
 * 辺の番号は角i→角i+1。柱にした分は壁面長さから外し、柱長さに入る。
 */
export function setPitColumns(
  pit: PitShape,
  indexes: readonly number[],
  column: boolean,
): PitShape {
  if (indexes.length === 0) return pit;
  const current = new Set(pit.columns ?? []);
  const before = current.size;
  indexes.forEach((index) => {
    if (column) current.add(index);
    else current.delete(index);
  });
  if (current.size === before) return pit;
  return { ...pit, columns: [...current].sort((a, b) => a - b) };
}

/** クリックした所に一番近い壁（辺） */
export function nearestPitEdge(pit: PitShape, at: PitPoint): PitEdge | null {
  const edges = pitEdges(pit).filter((edge) => edge.length > 0);
  if (edges.length === 0) return null;
  let best = edges[0];
  let near = Number.POSITIVE_INFINITY;
  edges.forEach((edge) => {
    const away = distanceToSegment(at, edge.from, edge.to);
    if (away < near) {
      near = away;
      best = edge;
    }
  });
  return best;
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
  /** 壁面長さ（内周から柱の分を引いたもの） */
  wallLength: number;
  /** 柱長さ（柱にした辺の合計） */
  columnLength: number;
  /** 柱面積（柱長さ×深さ） */
  columnArea: number;
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
  axis: "X" | "Y" | "E";
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
  /** 壁（辺）に沿う梁のときの両端（図全体の座標） */
  line?: { x1: number; y1: number; x2: number; y2: number };
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

/** まとめてそろえる辺（左・右・上・下） */
export type PitAlignSide = "left" | "right" | "top" | "bottom";

/**
 * 選んだピットを、はじめに選んだピットの辺にそろえる。
 * 例：右でそろえると、四角の右の辺がＸ通りのように一直線になる。
 */
export function alignPits(
  pits: readonly PitShape[],
  ids: readonly string[],
  side: PitAlignSide,
): PitShape[] {
  const rects = layoutPits(pits);
  const chosen = pits.filter((pit) => ids.includes(pit.id));
  const first = chosen[0]
    ? rects.find((rect) => rect.id === chosen[0].id)
    : undefined;
  if (chosen.length < 2 || !first) return pits.map((pit) => ({ ...pit }));
  const target =
    side === "left"
      ? first.left
      : side === "right"
        ? first.left + first.x
        : side === "top"
          ? first.top
          : first.top + first.y;
  // 基準にしているピットを動かすと他も動くので、1つずつ置き直しながらそろえる
  let moved = pits.map((pit) => ({ ...pit }));
  chosen.slice(1).forEach((pit) => {
    const rect = layoutPits(moved).find((each) => each.id === pit.id);
    if (!rect) return;
    moved = moved.map((each) => {
      if (each.id !== pit.id) return each;
      if (side === "left" || side === "right") {
        const now = side === "left" ? rect.left : rect.left + rect.x;
        return { ...each, shiftX: round4((each.shiftX ?? 0) + (target - now)) };
      }
      const now = side === "top" ? rect.top : rect.top + rect.y;
      return { ...each, shiftY: round4((each.shiftY ?? 0) + (target - now)) };
    });
  });
  return moved;
}

/**
 * 形を直したあとも、直していないピットが図の上で動かないようにする。
 * 基準にしたピットの外形が変わると置き位置も変わるので、そのずれを打ち消す。
 */
export function keepPitPlaces(
  before: readonly PitShape[],
  after: readonly PitShape[],
  changedIds: readonly string[],
): PitShape[] {
  const places = layoutPits(before);
  let kept = after.map((pit) => ({ ...pit }));
  kept.forEach((pit, index) => {
    if (changedIds.includes(pit.id)) return;
    const was = places.find((rect) => rect.id === pit.id);
    const now = layoutPits(kept).find((rect) => rect.id === pit.id);
    if (!was || !now) return;
    const dx = now.left - was.left;
    const dy = now.top - was.top;
    if (dx === 0 && dy === 0) return;
    kept = kept.map((each, at) =>
      at === index
        ? {
            ...each,
            shiftX: round4((each.shiftX ?? 0) - dx),
            shiftY: round4((each.shiftY ?? 0) - dy),
          }
        : each,
    );
  });
  return kept;
}

/**
 * 角を動かしたあと、図の上で動くのは「動かした分」だけにする。
 * 基準にしているピットの外形が変わって押し出される分は打ち消すので、
 * いくつものピットの角をまとめて動かしても、倍に動かない。
 */
export function keepPitPlacesByShift(
  before: readonly PitShape[],
  after: readonly PitShape[],
): PitShape[] {
  const places = layoutPits(before);
  let kept = after.map((pit) => ({ ...pit }));
  kept.forEach((pit, index) => {
    const was = places.find((rect) => rect.id === pit.id);
    const old = before.find((each) => each.id === pit.id);
    if (!was || !old) return;
    const wantLeft = was.left + ((pit.shiftX ?? 0) - (old.shiftX ?? 0));
    const wantTop = was.top + ((pit.shiftY ?? 0) - (old.shiftY ?? 0));
    const now = layoutPits(kept).find((rect) => rect.id === pit.id);
    if (!now) return;
    const dx = now.left - wantLeft;
    const dy = now.top - wantTop;
    if (dx === 0 && dy === 0) return;
    kept = kept.map((each, at) =>
      at === index
        ? {
            ...each,
            shiftX: round4((each.shiftX ?? 0) - dx),
            shiftY: round4((each.shiftY ?? 0) - dy),
          }
        : each,
    );
  });
  return kept;
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
 * 梁の通り道のうち、形の中に入っている区間。
 * 斜めの壁や欠き込みで切られるので、四角の端から端までではなくこの区間を使う。
 */
function insideSpans(
  pit: PitShape,
  axis: "X" | "Y",
  at: number,
): { from: number; to: number }[] {
  const points = pitPolygon(pit);
  const span = axis === "X" ? pit.x : pit.y;
  if (points.length < 3) return [{ from: 0, to: span }];
  const hits: number[] = [];
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    const a0 = axis === "X" ? a.y : a.x;
    const b0 = axis === "X" ? b.y : b.x;
    if (a0 > at === b0 > at) return;
    const a1 = axis === "X" ? a.x : a.y;
    const b1 = axis === "X" ? b.x : b.y;
    hits.push(a1 + ((b1 - a1) * (at - a0)) / (b0 - a0));
  });
  hits.sort((a, b) => a - b);
  const spans: { from: number; to: number }[] = [];
  for (let index = 0; index + 1 < hits.length; index += 2) {
    const from = round4(Math.max(hits[index], 0));
    const to = round4(Math.min(hits[index + 1], span));
    if (to - from > 1e-6) spans.push({ from, to });
  }
  return spans.length > 0 ? spans : [{ from: 0, to: span }];
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
  if (beam.axis === "E") {
    const edge = pitEdges(pit).find((each) => each.index === (beam.edge ?? -1));
    const removed = beam.removed ?? [];
    if (!edge || edge.length <= 0 || removed.includes(0)) return [];
    return [{ index: 0, from: 0, to: edge.length }];
  }
  const span = beam.axis === "X" ? pit.x : pit.y;
  const across = beam.axis === "X" ? pit.y : pit.x;
  const at = Math.min(Math.max(beam.position, 0), 1) * across;
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
  insideSpans(pit, beam.axis, at).forEach((inside) => {
    let start = inside.from;
    cuts.forEach((cut) => {
      if (cut.to <= start || cut.from >= inside.to) return;
      if (cut.from > start)
        pieces.push({ index: pieces.length, from: start, to: cut.from });
      start = Math.max(start, cut.to);
    });
    if (start < inside.to)
      pieces.push({ index: pieces.length, from: start, to: inside.to });
  });
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
    if (beam.axis === "E") {
      const edge = pitEdges(pit).find(
        (each) => each.index === (beam.edge ?? -1),
      );
      if (!edge) return;
      lines.push({
        id: beam.id,
        pitId: beam.pitId,
        symbol: rect.symbol,
        axis: "E",
        width: beam.width,
        height: beam.height,
        length,
        segments,
        position: ratio,
        left: rect.left + (edge.from.x + edge.to.x) / 2,
        top: rect.top + (edge.from.y + edge.to.y) / 2,
        line: {
          x1: rect.left + edge.from.x,
          y1: rect.top + edge.from.y,
          x2: rect.left + edge.to.x,
          y2: rect.top + edge.to.y,
        },
      });
      return;
    }
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
    const columnSet = new Set(pit.columns ?? []);
    const columnLength = round4(
      pitEdges(pit)
        .filter((each) => columnSet.has(each.index))
        .reduce((sum, each) => sum + each.length, 0),
    );
    const wallLength = Math.max(polygonPerimeter(points) - columnLength, 0);
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
      columnLength,
      columnArea: round4(columnLength * pit.depth),
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
  let total = 0;
  quantities.forEach((quantity, index) => {
    const value = partName.includes("天井")
      ? quantity.ceilingArea
      : partName.includes("梁")
        ? quantity.beamArea
        : partName.includes("柱")
          ? quantity.columnArea
          : partName.includes("壁")
            ? quantity.wallArea
            : quantity.floorArea;
    values[pitFormulaSymbol(index)] = value;
    total += value;
  });
  values.PA = round4(total);
  return values;
}

/** 全部のピットを足した数量（表の先頭のＰＡ行に出す） */
export function pitTotal(quantities: readonly PitQuantity[]): PitQuantity {
  const total = quantities.reduce<PitQuantity>(
    (sum, quantity) => ({
      id: "PA",
      symbol: "ＰＡ",
      depth: 0,
      floorArea: sum.floorArea + quantity.floorArea,
      wallLength: sum.wallLength + quantity.wallLength,
      columnLength: sum.columnLength + quantity.columnLength,
      columnArea: sum.columnArea + quantity.columnArea,
      wallArea: sum.wallArea + quantity.wallArea,
      beamBottomArea: sum.beamBottomArea + quantity.beamBottomArea,
      beamArea: sum.beamArea + quantity.beamArea,
      ceilingArea: sum.ceilingArea + quantity.ceilingArea,
    }),
    {
      id: "PA",
      symbol: "ＰＡ",
      depth: 0,
      floorArea: 0,
      wallLength: 0,
      columnLength: 0,
      columnArea: 0,
      wallArea: 0,
      beamBottomArea: 0,
      beamArea: 0,
      ceilingArea: 0,
    },
  );
  return {
    id: "PA",
    symbol: "ＰＡ",
    depth: 0,
    floorArea: round4(total.floorArea),
    wallLength: round4(total.wallLength),
    columnLength: round4(total.columnLength),
    columnArea: round4(total.columnArea),
    wallArea: round4(total.wallArea),
    beamBottomArea: round4(total.beamBottomArea),
    beamArea: round4(total.beamArea),
    ceilingArea: round4(total.ceilingArea),
  };
}

/** 計算式に使える記号（FA1…はピットごと、FA…は全部の合計） */
export function pitVariables(
  quantities: readonly PitQuantity[],
): Record<string, number> {
  const values: Record<string, number> = {};
  let floorArea = 0;
  let wallLength = 0;
  let columnLength = 0;
  let columnArea = 0;
  let wallArea = 0;
  let beamArea = 0;
  let beamBottomArea = 0;
  let ceilingArea = 0;
  quantities.forEach((quantity, index) => {
    const no = pitNumber(index);
    values[`FA${no}`] = quantity.floorArea;
    values[`WL${no}`] = quantity.wallLength;
    values[`CL${no}`] = quantity.columnLength;
    values[`HA${no}`] = quantity.columnArea;
    values[`DP${no}`] = quantity.depth;
    values[`WA${no}`] = quantity.wallArea;
    values[`GB${no}`] = quantity.beamBottomArea;
    values[`GA${no}`] = quantity.beamArea;
    values[`CA${no}`] = quantity.ceilingArea;
    floorArea += quantity.floorArea;
    wallLength += quantity.wallLength;
    columnLength += quantity.columnLength;
    columnArea += quantity.columnArea;
    wallArea += quantity.wallArea;
    beamArea += quantity.beamArea;
    beamBottomArea += quantity.beamBottomArea;
    ceilingArea += quantity.ceilingArea;
  });
  values.FA = floorArea;
  values.WL = wallLength;
  values.CL = columnLength;
  values.HA = columnArea;
  values.WA = wallArea;
  values.GA = beamArea;
  values.GB = beamBottomArea;
  values.CA = ceilingArea;
  return values;
}

/** 図の印に使う色（10色から選ぶ） */
export const PIT_MARK_COLORS: { name: string; color: string }[] = [
  { name: "赤", color: "#dc2626" },
  { name: "青", color: "#2563eb" },
  { name: "緑", color: "#16a34a" },
  { name: "橙", color: "#d97706" },
  { name: "紫", color: "#7c3aed" },
  { name: "水", color: "#0891b2" },
  { name: "桃", color: "#db2777" },
  { name: "黄緑", color: "#65a30d" },
  { name: "深緑", color: "#0f766e" },
  { name: "茶", color: "#b45309" },
];

/** ピット間（ピットとピットの間）に付けた印。図に引いた1本 */
export interface PitWall {
  id: string;
  /** 図全体の座標（m） */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 図に出す印の太さ（m）。梁のＷと同じ図の表記だけで、集計には使わない */
  width: number;
  /** 図の印の色 */
  color: string;
}

/** 図に出す印の太さ（500mm・200mmの2種類） */
export const PIT_WALL_SIZES: { width: number; color: string }[] = [
  { width: 0.5, color: "#dc2626" },
  { width: 0.2, color: "#2563eb" },
];

/** 人通口・通水管・通気管などスリーブの種類（10種類） */
export interface PitSleeveKind {
  id: string;
  name: string;
  /** 図の印の色 */
  color: string;
}

const PIT_SLEEVE_KINDS: { name: string; color: string }[] = [
  { name: "人通口600φ", color: "#dc2626" },
  { name: "連通管100φ", color: "#2563eb" },
  { name: "通水管150φ半割", color: "#16a34a" },
  { name: "通気管100φ", color: "#d97706" },
  { name: "スリーブ5", color: "#7c3aed" },
  { name: "スリーブ6", color: "#0891b2" },
  { name: "スリーブ7", color: "#db2777" },
  { name: "スリーブ8", color: "#65a30d" },
  { name: "スリーブ9", color: "#0f766e" },
  { name: "スリーブ10", color: "#b45309" },
];

export function defaultPitSleeveKinds(): PitSleeveKind[] {
  return PIT_SLEEVE_KINDS.map((kind, index) => ({
    id: `s${index + 1}`,
    name: kind.name,
    color: kind.color,
  }));
}

/** ピット間に付けた人通口・スリーブ1か所 */
export interface PitSleeve {
  id: string;
  /** どのピット間に付くか */
  wallId: string;
  kindId: string;
  /** 線に沿った位置（0〜1） */
  position: number;
  /** 長さ（mm）。空のときは付けたピット間の長さを使う */
  length: number | null;
}

/** ピット間1本の長さ（m） */
export function pitWallLength(wall: PitWall): number {
  return round4(Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1));
}

/** 集計でまとめる長さ（既定は50mmごと） */
export function groupLengthMm(mm: number, step = 50): number {
  if (step <= 0) return Math.round(mm);
  return Math.round(mm / step) * step;
}

/** スリーブ1か所の長さ（mm）。手入力が無いときは付けたピット間の長さ */
export function pitSleeveLength(
  sleeve: PitSleeve,
  walls: readonly PitWall[],
): number {
  if (sleeve.length !== null && sleeve.length > 0) return sleeve.length;
  const wall = walls.find((each) => each.id === sleeve.wallId);
  return wall ? Math.round(pitWallLength(wall) * 1000) : 0;
}

/** ピット間の長さ別集計（長さは50mmでまとめる） */
export interface PitWallTally {
  /** まとめた長さ（mm） */
  lengthMm: number;
  count: number;
  /** 合計長さ（m） */
  total: number;
}

export function pitWallTallies(walls: readonly PitWall[]): PitWallTally[] {
  const rows = new Map<number, PitWallTally>();
  walls.forEach((wall) => {
    const lengthMm = groupLengthMm(pitWallLength(wall) * 1000);
    const row = rows.get(lengthMm) ?? { lengthMm, count: 0, total: 0 };
    row.count += 1;
    row.total = round4(row.total + pitWallLength(wall));
    rows.set(lengthMm, row);
  });
  return [...rows.values()].sort((a, b) => a.lengthMm - b.lengthMm);
}

/** 人通口・スリーブの種類別×長さ別の個数表 */
export interface PitSleeveTable {
  /** 表の列になる長さ（mm・50mmでまとめたもの） */
  lengths: number[];
  rows: { kindId: string; counts: number[]; total: number }[];
}

export function pitSleeveTable(
  sleeves: readonly PitSleeve[],
  walls: readonly PitWall[],
  kinds: readonly PitSleeveKind[],
): PitSleeveTable {
  const lengths = [
    ...new Set(
      sleeves.map((sleeve) => groupLengthMm(pitSleeveLength(sleeve, walls))),
    ),
  ].sort((a, b) => a - b);
  const rows = kinds.map((kind) => {
    const counts = lengths.map(
      (length) =>
        sleeves.filter(
          (sleeve) =>
            sleeve.kindId === kind.id &&
            groupLengthMm(pitSleeveLength(sleeve, walls)) === length,
        ).length,
    );
    return {
      kindId: kind.id,
      counts,
      total: counts.reduce((sum, count) => sum + count, 0),
    };
  });
  return { lengths, rows };
}

/**
 * 計算式に使える記号。
 * ピット間：MW＝合計長さ、MW1・MN1…＝長さ（50mmごと）ごとの長さ／本数
 * スリーブ：SV1…＝種類ごとの本数、SV1L500…＝長さごとの本数
 */
export function pitWallVariables(
  walls: readonly PitWall[],
  sleeves: readonly PitSleeve[],
  kinds: readonly PitSleeveKind[],
): Record<string, number> {
  const values: Record<string, number> = {};
  const tallies = pitWallTallies(walls);
  let total = 0;
  tallies.forEach((row, index) => {
    values[`MW${index + 1}`] = row.total;
    values[`MN${index + 1}`] = row.count;
    total += row.total;
  });
  values.MW = round4(total);
  values.MN = walls.length;
  const table = pitSleeveTable(sleeves, walls, kinds);
  table.rows.forEach((row, index) => {
    values[`SV${index + 1}`] = row.total;
    table.lengths.forEach((length, column) => {
      values[`SV${index + 1}L${length}`] = row.counts[column];
    });
  });
  return values;
}

/**
 * ピット間をクリックしたときに引く印。
 * いちばん近いピットの壁から、向かい合うピットの壁へ垂直につなぐ。
 */
export function pitGapLink(
  rects: readonly PitRect[],
  pits: readonly PitShape[],
  at: PitPoint,
): { from: PitPoint; to: PitPoint } | null {
  type Wall = { pitId: string; from: PitPoint; to: PitPoint };
  const wallsAll: Wall[] = [];
  rects.forEach((rect) => {
    const pit = pits.find((each) => each.id === rect.id);
    if (!pit) return;
    const points = pitPolygon(pit).map((point) => ({
      x: point.x + rect.left,
      y: point.y + rect.top,
    }));
    points.forEach((from, index) => {
      const to = points[(index + 1) % points.length];
      if (Math.hypot(to.x - from.x, to.y - from.y) > 1e-9)
        wallsAll.push({ pitId: rect.id, from, to });
    });
  });
  if (wallsAll.length === 0) return null;

  let near: Wall | null = null;
  let nearAway = Number.POSITIVE_INFINITY;
  wallsAll.forEach((wall) => {
    const away = distanceToSegment(at, wall.from, wall.to);
    if (away < nearAway) {
      nearAway = away;
      near = wall;
    }
  });
  if (near === null) return null;
  const base: Wall = near;

  const dx = base.to.x - base.from.x;
  const dy = base.to.y - base.from.y;
  const len2 = dx * dx + dy * dy;
  const t = Math.min(
    Math.max(((at.x - base.from.x) * dx + (at.y - base.from.y) * dy) / len2, 0),
    1,
  );
  const foot = { x: base.from.x + dx * t, y: base.from.y + dy * t };
  const length = Math.sqrt(len2);
  let nx = -dy / length;
  let ny = dx / length;
  // クリックした側（ピットの外）へ向ける
  if ((at.x - foot.x) * nx + (at.y - foot.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }

  let hit: PitPoint | null = null;
  let hitAway = Number.POSITIVE_INFINITY;
  wallsAll.forEach((wall) => {
    if (wall.pitId === base.pitId) return;
    const ex = wall.to.x - wall.from.x;
    const ey = wall.to.y - wall.from.y;
    const cross = nx * ey - ny * ex;
    if (Math.abs(cross) < 1e-9) return;
    const qx = wall.from.x - foot.x;
    const qy = wall.from.y - foot.y;
    const distance = (qx * ey - qy * ex) / cross;
    const on = (qx * ny - qy * nx) / cross;
    if (distance <= 1e-6 || on < -1e-9 || on > 1 + 1e-9) return;
    if (distance < hitAway) {
      hitAway = distance;
      hit = { x: foot.x + nx * distance, y: foot.y + ny * distance };
    }
  });
  if (hit === null) return null;
  const to: PitPoint = hit;
  return {
    from: { x: round4(foot.x), y: round4(foot.y) },
    to: { x: round4(to.x), y: round4(to.y) },
  };
}
