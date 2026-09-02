/**
 * 部屋形状（単線図）の計算。
 *
 * 部屋は直交する辺の並びで表す。辺は「向き」と「寸法」を持ち、
 * 未入力の寸法は閉じた形になるように自動算出する（各方向1辺まで自動算出できる）。
 * 数量根拠を追えるように、辺は作成時のIDを保持し続ける。
 */

/** E/W/N/S は直交する辺。D は斜め辺（横移動・縦移動で向きを決める） */
export type EdgeDirection = "E" | "W" | "N" | "S" | "D";

/**
 * 壁：積算対象／開口：壁の無い部分（数量に入れない）／柱：柱1ヶ所分の総幅
 * 曲面壁：弦の長さと矢（ふくらみ）を入れて弧長を壁長さに使う
 */
export type EdgeKind = "wall" | "opening" | "column" | "curve";

export interface RoomEdge {
  id: string;
  direction: EdgeDirection;
  /** 未入力（自動算出）は null。曲面壁では弦の長さ */
  length: number | null;
  kind: EdgeKind;
  /** 斜め辺の横移動（右がプラス）。direction が "D" のときに使う */
  dx?: number | null;
  /** 斜め辺の縦移動（下がプラス）。direction が "D" のときに使う */
  dy?: number | null;
  /** 曲面壁の矢（ふくらみ）。プラスは外側へ、マイナスは内側へ。0・未入力なら直線 */
  bulge?: number | null;
}

/**
 * 部屋の中に立つ独立柱（Ｗ×Ｄ）。
 * 外周の形には入れず、本数・周長・見付面積だけを数える。
 */
export interface FreeColumn {
  id: string;
  /** 図の中の中心の位置（m） */
  x: number;
  y: number;
  /** 横幅Ｗ（m） */
  width: number;
  /** 奥行Ｄ（m） */
  depth: number;
}

export interface RoomShape {
  edges: RoomEdge[];
  /** 部屋の中の独立柱（無い計算書もあるので任意） */
  columns?: FreeColumn[];
}

export interface SolvedEdge extends RoomEdge {
  /** 自動算出した寸法を含む確定値。決められない場合は null（曲面壁は弦の長さ） */
  resolved: number | null;
  /** 数量に使う長さ。曲面壁は弧長、それ以外は resolved と同じ */
  measured: number | null;
  /** 自動算出した辺 */
  auto: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface SolvedShape {
  edges: SolvedEdge[];
  /** 部屋の中の独立柱（形の計算には使わない） */
  columns: FreeColumn[];
  /** 各辺の始点（edges と同じ並び）。寸法が決まらない場合は空 */
  points: Point[];
  /** 寸法が足りず決められない辺のID（画面で点滅させる） */
  missing: string[];
  /** 閉じた形にならない場合の説明 */
  error: string | null;
}

/** 直交する向き（斜め辺 "D" は含まない） */
export type AxisDirection = "E" | "W" | "N" | "S";

const AXIS: Record<AxisDirection, "x" | "y"> = {
  E: "x",
  W: "x",
  N: "y",
  S: "y",
};
const SIGN: Record<AxisDirection, 1 | -1> = { E: 1, W: -1, N: -1, S: 1 };

export function isDiagonal(direction: EdgeDirection): boolean {
  return direction === "D";
}

function axisOf(direction: EdgeDirection): "x" | "y" | null {
  return direction === "D" ? null : AXIS[direction];
}

function signOf(direction: EdgeDirection): 1 | -1 {
  return direction === "D" ? 1 : SIGN[direction];
}

/** 斜め辺の横移動・縦移動（未入力は0） */
function diagonalVector(row: RoomEdge): Point {
  return { x: row.dx ?? 0, y: row.dy ?? 0 };
}

/**
 * 曲面壁の弧長。弦の長さ c と矢（ふくらみ）h から求める。
 *   r = c^2 / (8h) + h / 2
 *   弧長 = 2 * r * asin(c / (2r))
 * 矢は外側へふくらむがプラス、内側へ凹むがマイナスで、長さはどちらも同じ。
 * 矢が0なら直線として弦の長さを返す。
 */
export function arcLength(chord: number, bulge: number | null): number {
  const h = Math.abs(bulge ?? 0);
  if (h <= 0 || chord <= 0) return round2(chord);
  const r = (chord * chord) / (8 * h) + h / 2;
  const ratio = Math.min(1, chord / (2 * r));
  const half = Math.asin(ratio);
  const angle = h > r ? Math.PI - half : half;
  return round2(2 * r * angle);
}

/** 辺の進む向きと長さ（図形を描くときの移動量） */
export function edgeVector(row: RoomEdge, length: number | null): Point {
  if (isDiagonal(row.direction)) return diagonalVector(row);
  const value = length ?? 0;
  return AXIS[row.direction] === "x"
    ? { x: SIGN[row.direction] * value, y: 0 }
    : { x: 0, y: SIGN[row.direction] * value };
}

/** 案内文に出す寸法（小数2桁） */
function formatLength(value: number): string {
  return value.toFixed(2);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

let sequence = 0;

export function edgeId(): string {
  sequence += 1;
  return `e${Date.now().toString(36)}${sequence.toString(36)}`;
}

export function freeColumnId(): string {
  sequence += 1;
  return `c${Date.now().toString(36)}${sequence.toString(36)}`;
}

/** 独立柱1本（位置と大きさはm） */
export function freeColumn(
  x: number,
  y: number,
  width: number,
  depth: number,
): FreeColumn {
  return { id: freeColumnId(), x, y, width, depth };
}

export function edge(
  direction: EdgeDirection,
  length: number | null,
  kind: EdgeKind = "wall",
): RoomEdge {
  return { id: edgeId(), direction, length, kind };
}

/** 長方形 */
export function rectangleShape(width: number, depth: number): RoomShape {
  return {
    edges: [
      edge("E", width),
      edge("S", depth),
      edge("W", width),
      edge("N", depth),
    ],
  };
}

/** L型（右下を欠き取った形）。欠き取り寸法を入れると残りは自動算出になる */
export function lShape(
  width: number,
  depth: number,
  cutWidth: number,
  cutDepth: number,
): RoomShape {
  return {
    edges: [
      edge("E", width),
      edge("S", round2(depth - cutDepth)),
      edge("W", cutWidth),
      edge("S", cutDepth),
      edge("W", round2(width - cutWidth)),
      edge("N", depth),
    ],
  };
}

/** コ型（下辺の中央を凹ませた形） */
export function uShape(
  width: number,
  depth: number,
  notchWidth: number,
  notchDepth: number,
  offset: number,
): RoomShape {
  const right = round2(width - notchWidth - offset);
  return {
    edges: [
      edge("E", width),
      edge("S", depth),
      edge("W", right),
      edge("N", notchDepth),
      edge("W", notchWidth),
      edge("S", notchDepth),
      edge("W", offset),
      edge("N", depth),
    ],
  };
}

/**
 * 図形を左右（横）・上下（縦）に反転する。
 * 反転すると一周する向きが逆になるので、辺の並びも逆にして
 * 「E→S→W→N で一周する」前提を保つ。寸法・辺の種別はそのまま引き継ぐ。
 */
const MIRROR_X: Record<AxisDirection, AxisDirection> = {
  E: "E",
  W: "W",
  N: "S",
  S: "N",
};
const MIRROR_Y: Record<AxisDirection, AxisDirection> = {
  E: "W",
  W: "E",
  N: "N",
  S: "S",
};

export function mirrorShape(shape: RoomShape, axis: "x" | "y"): RoomShape {
  const map = axis === "x" ? MIRROR_X : MIRROR_Y;
  const edges = [...shape.edges].reverse().map((row) => {
    if (isDiagonal(row.direction)) {
      const vector = diagonalVector(row);
      return axis === "x"
        ? { ...row, dx: vector.x, dy: round2(-vector.y) }
        : { ...row, dx: round2(-vector.x), dy: vector.y };
    }
    return { ...row, direction: map[row.direction as AxisDirection] };
  });
  return { edges };
}

/** 辺を進む向きから見た内側の向き（E→S→W→N の並びで一周する形が前提） */
const INSIDE: Record<AxisDirection, AxisDirection> = {
  E: "S",
  S: "W",
  W: "N",
  N: "E",
};

export function insideDirection(direction: AxisDirection): AxisDirection {
  return INSIDE[direction];
}

function opposite(direction: AxisDirection): AxisDirection {
  return INSIDE[INSIDE[direction]];
}

/** 辺に収まる欠き取り・凹みの上限（元の辺を少しだけ残して形が潰れないようにする） */
function fitToEdge(length: number): number {
  return Math.max(round2(length - 0.01), length / 2);
}

/** 角へ入ってくる辺が縦向きか（斜め辺は縦の動きが大きいかで決める） */
export function incomingIsVertical(
  shape: RoomShape,
  cornerIndex: number,
): boolean {
  const count = shape.edges.length;
  if (count === 0) return false;
  const inEdge = shape.edges[(((cornerIndex - 1) % count) + count) % count];
  if (isDiagonal(inEdge.direction)) {
    const vector = diagonalVector(inEdge);
    return Math.abs(vector.y) > Math.abs(vector.x);
  }
  return axisOf(inEdge.direction) === "y";
}

/**
 * 指定した角（辺と辺のつなぎ目）をL型に欠き取る。
 * 両隣の辺を欠き取り寸法だけ手前で止め、その2点をL（縦横）でつなぐ。
 * 斜め辺に接する角でも欠き取れる。
 * cornerIndex は「その角から出ていく辺」の番号。
 */
export function cutCorner(
  shape: RoomShape,
  cornerIndex: number,
  cutAlong: number,
  cutAcross: number,
): { shape: RoomShape; error: string | null; adjusted: boolean } {
  const count = shape.edges.length;
  if (count < 3)
    return { shape, error: "先に部屋の形を作ってください", adjusted: false };
  if (cutAlong <= 0 || cutAcross <= 0) {
    return {
      shape,
      error: "欠き取り寸法は0より大きい値を入れてください",
      adjusted: false,
    };
  }
  const solved = solveShape(shape);
  if (solved.points.length !== count) {
    return { shape, error: "先に部屋の寸法を決めてください", adjusted: false };
  }
  const outIndex = ((cornerIndex % count) + count) % count;
  const inIndex = (outIndex - 1 + count) % count;
  const inEdge = shape.edges[inIndex];
  const outEdge = shape.edges[outIndex];
  const corner = solved.points[outIndex];
  const previous = solved.points[inIndex];
  const next = solved.points[(outIndex + 1) % count];
  const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
  const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
  if (inLength < 0.005 || outLength < 0.005) {
    return {
      shape,
      error: "先に隣の辺の寸法を決めてください",
      adjusted: false,
    };
  }
  // 欠き取りが隣の辺より大きいときは、辺が無くならない範囲まで縮めて欠き取る
  const along = Math.min(cutAlong, fitToEdge(inLength));
  const across = Math.min(cutAcross, fitToEdge(outLength));
  const adjusted = along < cutAlong || across < cutAcross;

  const back = {
    x: round2(corner.x - ((corner.x - previous.x) / inLength) * along),
    y: round2(corner.y - ((corner.y - previous.y) / inLength) * along),
  };
  const forward = {
    x: round2(corner.x + ((next.x - corner.x) / outLength) * across),
    y: round2(corner.y + ((next.y - corner.y) / outLength) * across),
  };
  // L型の折れ点は、角から遠い方（角をそのまま残さない方）を選ぶ
  const candidates = [
    { x: back.x, y: forward.y },
    { x: forward.x, y: back.y },
  ];
  const middle =
    Math.hypot(candidates[0].x - corner.x, candidates[0].y - corner.y) >=
    Math.hypot(candidates[1].x - corner.x, candidates[1].y - corner.y)
      ? candidates[0]
      : candidates[1];

  const shortenedIn = edgeFromVector(inEdge, {
    x: back.x - previous.x,
    y: back.y - previous.y,
  });
  const shortenedOut = edgeFromVector(outEdge, {
    x: next.x - forward.x,
    y: next.y - forward.y,
  });
  const first = edgeFromVector(edge("E", null, inEdge.kind), {
    x: middle.x - back.x,
    y: middle.y - back.y,
  });
  const second = edgeFromVector(edge("E", null, outEdge.kind), {
    x: forward.x - middle.x,
    y: forward.y - middle.y,
  });
  const inserted = [first, second].filter((row) => (row.length ?? 0) > 0);
  if (inserted.length === 0) {
    return { shape, error: "欠き取り寸法が大きすぎます", adjusted: false };
  }
  const edges = [...shape.edges];
  edges[inIndex] = shortenedIn;
  edges[outIndex] = shortenedOut;
  edges.splice(outIndex, 0, ...inserted);
  // 辺いっぱいに欠き取ったときは、長さ0になった元の辺を残さない
  const kept = edges.filter(
    (row) =>
      (row !== shortenedIn && row !== shortenedOut) || (row.length ?? 0) > 0,
  );
  if (kept.length < 3) {
    return { shape, error: "欠き取り寸法が大きすぎます", adjusted: false };
  }
  return { shape: { edges: kept }, error: null, adjusted };
}

/**
 * 閉じていない寸法を自動で合わせる。
 * 足りない分は同じ向きの辺を伸び縮みさせ、できないときは辺を足す。
 */
export function closeShape(shape: RoomShape): {
  shape: RoomShape;
  changed: boolean;
} {
  const edges = [...shape.edges];
  let changed = false;

  for (const axis of ["x", "y"] as const) {
    const indexes = edges
      .map((row, index) => ({ row, index }))
      .filter((item) => axisOf(item.row.direction) === axis);
    if (indexes.some((item) => item.row.length === null)) continue;

    const diagonal = edges
      .filter((row) => isDiagonal(row.direction))
      .reduce((sum, row) => sum + diagonalVector(row)[axis], 0);
    const total = indexes.reduce(
      (sum, item) => sum + signOf(item.row.direction) * (item.row.length ?? 0),
      diagonal,
    );
    const gap = round2(-total);
    if (gap === 0) continue;

    const fixable = [...indexes]
      .reverse()
      .find(
        (item) =>
          round2((item.row.length ?? 0) + gap * signOf(item.row.direction)) >
          0.005,
      );
    if (fixable) {
      edges[fixable.index] = {
        ...fixable.row,
        length: round2(
          (fixable.row.length ?? 0) + gap * signOf(fixable.row.direction),
        ),
      };
    } else {
      const direction: AxisDirection =
        axis === "x" ? (gap > 0 ? "E" : "W") : gap > 0 ? "S" : "N";
      edges.push(edge(direction, round2(Math.abs(gap))));
    }
    changed = true;
  }

  return { shape: changed ? { edges } : shape, changed };
}

/**
 * 選んだ辺の寸法だけを直して、閉じていない分を合わせる。
 * その辺の向きの方向で足りない（余っている）分をこの辺で引き受ける。
 */
export function closeShapeAtEdge(
  shape: RoomShape,
  edgeId: string,
): { shape: RoomShape; length: number | null; error: string | null } {
  const index = shape.edges.findIndex((row) => row.id === edgeId);
  const target = index < 0 ? undefined : shape.edges[index];
  const axis = target === undefined ? null : axisOf(target.direction);
  if (target === undefined || axis === null) {
    return { shape, length: null, error: "斜め辺は自動で合わせられません" };
  }
  // 空欄の辺は自動算出した寸法で数える（自動算出できない空欄が残っていたら直せない）
  const solved = solveShape(shape);
  const sameAxisBlank = solved.edges.some(
    (row) =>
      row.id !== edgeId &&
      axisOf(row.direction) === axis &&
      row.resolved === null,
  );
  if (sameAxisBlank) {
    return {
      shape,
      length: null,
      error: "先に他の辺の寸法を入れてください（空欄が残っています）",
    };
  }

  const others = solved.edges
    .filter((row) => row.id !== edgeId)
    .reduce((sum, row) => {
      if (isDiagonal(row.direction)) return sum + diagonalVector(row)[axis];
      return (
        sum +
        (axisOf(row.direction) === axis
          ? signOf(row.direction) * (row.resolved ?? 0)
          : 0)
      );
    }, 0);

  const length = round2(-others * signOf(target.direction));
  if (!(length > 0.005)) {
    return {
      shape,
      length: null,
      error: "この辺では合わせられません（向きを直すか別の辺を選んでください）",
    };
  }
  if (length === target.length) {
    return { shape, length, error: null };
  }

  const edges = [...shape.edges];
  edges[index] = { ...target, length };
  return { shape: { edges }, length, error: null };
}

/** 斜め辺の途中をコ型に凹ませる（辺と直角の向きへ凹ませる） */
function notchDiagonalEdge(
  shape: RoomShape,
  edgeIndex: number,
  notchWidth: number,
  notchDepth: number,
  offset?: number,
): { shape: RoomShape; error: string | null } {
  const target = shape.edges[edgeIndex];
  const vector = diagonalVector(target);
  const span = Math.hypot(vector.x, vector.y);
  if (span < 0.005) return { shape, error: "先に辺の寸法を決めてください" };
  // 凹みが元の辺より大きいときは、辺が無くならない範囲まで縮めて凹ませる
  const width = Math.min(notchWidth, fitToEdge(span));
  const head = Math.min(
    Math.max(offset ?? (span - width) / 2, 0),
    span - width,
  );
  const unit = { x: vector.x / span, y: vector.y / span };
  const inside = { x: -unit.y, y: unit.x };
  const along = (value: number): Point => ({
    x: unit.x * value,
    y: unit.y * value,
  });
  const across = (value: number): Point => ({
    x: inside.x * value,
    y: inside.y * value,
  });
  const steps: Point[] = [
    along(head),
    across(notchDepth),
    along(width),
    across(-notchDepth),
  ];
  // 端数で形が開かないように、通る点を丸めてから辺の寸法を出す（最後は元の終点に戻す）
  const stops: Point[] = [{ x: 0, y: 0 }];
  for (const step of steps) {
    const last = stops[stops.length - 1];
    stops.push({ x: round2(last.x + step.x), y: round2(last.y + step.y) });
  }
  stops.push({ x: round2(vector.x), y: round2(vector.y) });
  const parts: Point[] = stops
    .slice(1)
    .map((stop, index) => ({
      x: round2(stop.x - stops[index].x),
      y: round2(stop.y - stops[index].y),
    }))
    .filter((part) => Math.abs(part.x) >= 0.005 || Math.abs(part.y) >= 0.005);
  const edges = [...shape.edges];
  edges.splice(
    edgeIndex,
    1,
    ...parts.map((part, index) =>
      edgeFromVector(index === 0 ? target : edge("E", null, target.kind), part),
    ),
  );
  return { shape: { edges }, error: null };
}

/**
 * 指定した辺の途中をコ型に凹ませる。
 * offset を省くと中央に置く。いまの形と入れた寸法は残す。
 */
export function notchEdge(
  shape: RoomShape,
  edgeIndex: number,
  notchWidth: number,
  notchDepth: number,
  offset?: number,
): { shape: RoomShape; error: string | null } {
  const target = shape.edges[edgeIndex];
  if (!target) return { shape, error: "凹ませる辺を選んでください" };
  if (notchWidth <= 0 || notchDepth <= 0) {
    return { shape, error: "凹み寸法は0より大きい値を入れてください" };
  }
  if (isDiagonal(target.direction)) {
    return notchDiagonalEdge(shape, edgeIndex, notchWidth, notchDepth, offset);
  }
  const length = solveShape(shape).edges[edgeIndex].resolved;
  if (length === null) return { shape, error: "先に辺の寸法を決めてください" };
  // 凹みが元の辺より大きいときは、辺が無くならない範囲まで縮めて凹ませる
  const width = Math.min(notchWidth, fitToEdge(length));
  const rest = round2(length - width);
  const head = Math.min(Math.max(offset ?? round2(rest / 2), 0), rest);
  const tail = round2(rest - head);
  const inside = insideDirection(target.direction as AxisDirection);
  const parts = [
    { ...target, length: head },
    edge(inside, notchDepth, target.kind),
    edge(target.direction, width, target.kind),
    edge(opposite(inside), notchDepth, target.kind),
    edge(target.direction, tail, target.kind),
  ].filter((row) => (row.length ?? 0) > 0);
  const edges = [...shape.edges];
  edges.splice(edgeIndex, 1, ...parts);
  return { shape: { edges }, error: null };
}

/**
 * 「辺追加」で足す辺の向き。
 * 形が閉じていない方向へ戻す向きを選び（無ければ最後の辺と直角の向き）、
 * 向きの取り違えを減らす。
 */
export function nextEdgeDirection(shape: RoomShape): AxisDirection {
  const gap = { x: 0, y: 0 };
  shape.edges.forEach((row) => {
    if (isDiagonal(row.direction)) {
      const vector = diagonalVector(row);
      gap.x += vector.x;
      gap.y += vector.y;
      return;
    }
    gap[AXIS[row.direction]] += SIGN[row.direction] * (row.length ?? 0);
  });

  const last = shape.edges[shape.edges.length - 1];
  const lastAxis = last === undefined ? null : axisOf(last.direction);
  const across: "x" | "y" = lastAxis === "x" ? "y" : "x";
  // 開きの大きい方向から閉じる。どちらも閉じていれば最後の辺と直角にする
  const axis =
    round2(gap.x) === 0 && round2(gap.y) === 0
      ? across
      : Math.abs(gap.y) > Math.abs(gap.x)
        ? "y"
        : "x";
  if (axis === "x") return gap.x > 0 ? "W" : "E";
  return gap.y > 0 ? "N" : "S";
}

/**
 * 未入力の寸法を閉じた形になるように自動算出する。
 * X方向・Y方向それぞれ、未入力が1辺までなら自動算出できる。
 */
export function solveShape(shape: RoomShape): SolvedShape {
  const resolved = new Map<string, number>();
  const missing: string[] = [];
  let error: string | null = null;

  /** 斜め辺は横・縦の両方へ決まった量だけ進むので、先に足しておく */
  const diagonalTotal = shape.edges
    .filter((row) => isDiagonal(row.direction))
    .reduce(
      (sum, row) => {
        const vector = diagonalVector(row);
        return { x: sum.x + vector.x, y: sum.y + vector.y };
      },
      { x: 0, y: 0 },
    );

  for (const axis of ["x", "y"] as const) {
    const axisEdges = shape.edges.filter(
      (row) => axisOf(row.direction) === axis,
    );
    const blanks = axisEdges.filter((row) => row.length === null);
    const total = axisEdges.reduce(
      (sum, row) =>
        row.length === null ? sum : sum + signOf(row.direction) * row.length,
      axis === "x" ? diagonalTotal.x : diagonalTotal.y,
    );

    if (blanks.length === 0) {
      const gap = round2(total);
      if (gap !== 0) {
        // どちら向きへ何m足りないかを出して、向きの取り違えに気付けるようにする
        const back =
          axis === "x"
            ? gap > 0
              ? "← 左"
              : "→ 右"
            : gap > 0
              ? "↑ 上"
              : "↓ 下";
        error = `${axis === "x" ? "横" : "縦"}方向の寸法が閉じていません（${back}へ ${formatLength(Math.abs(gap))} 足りません）`;
      }
      continue;
    }
    if (blanks.length > 1) {
      blanks.forEach((row) => missing.push(row.id));
      continue;
    }

    const blank = blanks[0];
    const value = round2(-total / signOf(blank.direction));
    if (value <= 0) {
      missing.push(blank.id);
      error = "自動算出した寸法が0以下になります";
      continue;
    }
    resolved.set(blank.id, value);
  }

  const edges: SolvedEdge[] = shape.edges.map((row) => {
    const value = isDiagonal(row.direction)
      ? round2(Math.hypot(row.dx ?? 0, row.dy ?? 0))
      : (row.length ?? resolved.get(row.id) ?? null);
    return {
      ...row,
      resolved: value,
      measured:
        value === null
          ? null
          : row.kind === "curve"
            ? arcLength(value, row.bulge ?? null)
            : value,
      auto:
        !isDiagonal(row.direction) &&
        row.length === null &&
        resolved.has(row.id),
    };
  });

  const points: Point[] = [];
  if (missing.length === 0 && edges.every((row) => row.resolved !== null)) {
    let x = 0;
    let y = 0;
    for (const row of edges) {
      points.push({ x, y });
      const vector = edgeVector(row, row.resolved);
      x += vector.x;
      y += vector.y;
    }
  }

  return { edges, columns: shape.columns ?? [], points, missing, error };
}

/** 独立柱の合計（本数・周長・平面の占める面積・見付面積） */
export interface FreeColumnTotals {
  /** 本数 */
  count: number;
  /** 周長の合計（m） */
  perimeter: number;
  /** 平面で占める面積の合計（m2） */
  plan: number;
  /** 見付面積の合計（周長×天井高さ）。天井高さが無ければ null */
  face: number | null;
}

export function freeColumnTotals(
  columns: FreeColumn[],
  ceilingHeight: number | null = null,
): FreeColumnTotals {
  const perimeter = columns.reduce(
    (sum, column) => sum + (column.width + column.depth) * 2,
    0,
  );
  const plan = columns.reduce(
    (sum, column) => sum + column.width * column.depth,
    0,
  );
  return {
    count: columns.length,
    perimeter: round2(perimeter),
    plan: round2(plan),
    face: ceilingHeight === null ? null : round2(perimeter * ceilingHeight),
  };
}

function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 柱の欠き（柱の辺が続く部分）1ヶ所ぶんの面積 */
export interface ColumnNotch {
  /** 柱の辺のID（数量根拠の追跡用） */
  edgeIds: string[];
  /** 柱を無いものとして壁を伸ばしたときに増える面積 */
  area: number;
}

/** 柱の辺が続く部分（始まりの辺の番号と本数）を拾う */
function columnRuns(edges: SolvedEdge[]): { start: number; count: number }[] {
  const total = edges.length;
  const isColumn = (index: number): boolean =>
    edges[(index + total) % total].kind === "column";
  if (edges.every((row) => row.kind === "column")) return [];

  const runs: { start: number; count: number }[] = [];
  for (let i = 0; i < total; i += 1) {
    if (!isColumn(i) || isColumn(i - 1)) continue;
    let count = 1;
    while (count < total && isColumn(i + count)) count += 1;
    runs.push({ start: i, count });
  }
  return runs;
}

/**
 * 柱の欠きを埋めた（柱の無いものとして前後の壁を伸ばして交わらせた）多角形。
 * 前後の辺が直交していないときは、柱の角をそのまま結ぶ。
 */
function filledPoints(
  solved: SolvedShape,
  run: { start: number; count: number },
): Point[] {
  const total = solved.points.length;
  const before = (run.start - 1 + total) % total;
  const after = (run.start + run.count) % total;
  const previous = solved.edges[before];
  const next = solved.edges[after];
  const corner = solved.points[run.start];
  const resume = solved.points[after];

  const axisA = axisOf(previous.direction);
  const axisB = axisOf(next.direction);
  const inserted: Point[] =
    axisA === null || axisB === null || axisA === axisB
      ? []
      : axisA === "x"
        ? [{ x: resume.x, y: corner.y }]
        : [{ x: corner.x, y: resume.y }];

  const kept: Point[] = [];
  for (let i = 0; i < total; i += 1) {
    const index = (run.start + i) % total;
    if (i >= 1 && i <= run.count - 1) continue;
    kept.push(solved.points[index]);
    if (i === 0) kept.push(...inserted);
  }
  return kept;
}

/** 柱の欠きごとの面積（柱を埋めたときに増える分） */
export function columnNotches(solved: SolvedShape): ColumnNotch[] {
  if (solved.points.length < 3) return [];
  const base = polygonArea(solved.points);
  return columnRuns(solved.edges)
    .map((run) => ({
      edgeIds: Array.from(
        { length: run.count },
        (_, i) => solved.edges[(run.start + i) % solved.edges.length].id,
      ),
      area: round2(polygonArea(filledPoints(solved, run)) - base),
    }))
    .filter((notch) => notch.area > 0);
}

/**
 * 床面積（多角形の面積）。
 * 柱の欠きは取合欠除の設定より小さければ差し引かない（柱の無いものとして数える）。
 * 部屋の中の独立柱は柱として数えるので、その面積は床から差し引く。
 */
export function floorArea(
  solved: SolvedShape,
  limit = DEFAULT_DEDUCTION_LIMIT,
): number | null {
  if (solved.points.length < 3) return null;
  const kept = columnNotches(solved)
    .filter((notch) => !deducts(notch.area, limit))
    .reduce((sum, notch) => sum + notch.area, 0);
  const free = solved.columns.reduce(
    (sum, column) => sum + column.width * column.depth,
    0,
  );
  return round2(polygonArea(solved.points) + kept - free);
}

/** 図の外形寸法（X＝横の最大、Y＝縦の最大）。曲面壁のふくらみは含めない */
export function shapeExtents(
  solved: SolvedShape,
): { x: number; y: number } | null {
  if (solved.points.length === 0) return null;
  const xs = solved.points.map((point) => point.x);
  const ys = solved.points.map((point) => point.y);
  return {
    x: round2(Math.max(...xs) - Math.min(...xs)),
    y: round2(Math.max(...ys) - Math.min(...ys)),
  };
}

export interface EdgeLengthTotals {
  /** 壁の長さ合計（曲面壁の弧長を含む。開口・柱は含まない） */
  wall: number;
  /** 柱の長さ合計 */
  column: number;
  /** 壁の無い開口の長さ合計（数量には使わない） */
  opening: number;
}

export function edgeTotals(solved: SolvedShape): EdgeLengthTotals {
  const totals: EdgeLengthTotals = { wall: 0, column: 0, opening: 0 };
  for (const row of solved.edges) {
    if (row.measured === null) continue;
    if (row.kind === "curve") totals.wall += row.measured;
    else totals[row.kind] += row.measured;
  }
  return {
    wall: round2(totals.wall),
    column: round2(totals.column),
    opening: round2(totals.opening),
  };
}

/**
 * 上段（自動計算）で使う建具。
 * 建具表から W/H/面積/巾木減を引用し、倍率を掛けて壁面積・巾木長さから差し引く。
 * 下段の計算式で <AW1> を使う場合はここに書かなくても建具表から引用する。
 */
export interface RoomFitting {
  symbol: string;
  /** 同じ建具の数（マイナスも可） */
  multiplier: number;
  area: number | null;
  baseboardDeduction: number | null;
  /** どの壁の建具か（数量根拠の追跡用。未指定は合計からだけ差し引く） */
  edgeId: string | null;
}

export interface FittingTotals {
  /** 建具面積の合計 */
  area: number;
  /** 巾木減の合計 */
  baseboard: number;
}

export function fittingTotals(
  fittings: RoomFitting[],
  edgeId?: string,
): FittingTotals {
  const target =
    edgeId === undefined
      ? fittings
      : fittings.filter((row) => row.edgeId === edgeId);
  return {
    area: round2(
      target.reduce((sum, row) => sum + (row.area ?? 0) * row.multiplier, 0),
    ),
    baseboard: round2(
      target.reduce(
        (sum, row) => sum + (row.baseboardDeduction ?? 0) * row.multiplier,
        0,
      ),
    ),
  };
}

export interface RoomQuantities {
  /** FA 床面積 */
  floorArea: number | null;
  /** CA 天井面積（梁型が取る梁底の分は引く） */
  ceilingArea: number | null;
  /** WL 壁長さ */
  wallLength: number;
  /** CL 柱長さ */
  columnLength: number;
  /** HL 巾木長さ（壁＋柱－建具の巾木減） */
  baseboardLength: number;
  /** WA 壁面積（建具面積を差し引いた計上面積） */
  wallArea: number | null;
  /** HA 柱面積 */
  columnArea: number | null;
  /** ML 廻り縁長さ */
  moldingLength: number;
  /** DA 差し引いた建具面積 */
  fittingArea: number;
  /** DL 差し引いた建具の巾木減 */
  fittingBaseboard: number;
}

export function roomQuantities(
  solved: SolvedShape,
  ceilingHeight: number | null,
  fittings: RoomFitting[] = [],
  limit = DEFAULT_DEDUCTION_LIMIT,
  beamArea = 0,
): RoomQuantities {
  const totals = edgeTotals(solved);
  const area = floorArea(solved, limit);
  const height = ceilingHeight ?? null;
  const fitting = fittingTotals(fittings);
  const free = freeColumnTotals(solved.columns, height);
  // 部屋の中の独立柱は、周長を柱として数える（柱長さ・柱面積・巾木・廻り縁に足す）
  const column = round2(totals.column + free.perimeter);
  return {
    floorArea: area,
    ceilingArea: area === null ? null : round2(Math.max(0, area - beamArea)),
    wallLength: totals.wall,
    columnLength: column,
    baseboardLength: round2(totals.wall + column - fitting.baseboard),
    wallArea:
      height === null ? null : round2(totals.wall * height - fitting.area),
    columnArea: height === null ? null : round2(column * height),
    moldingLength: round2(totals.wall + column),
    fittingArea: fitting.area,
    fittingBaseboard: fitting.baseboard,
  };
}

export interface RoomSymbol {
  /** 計算式に入力する記号 */
  symbol: string;
  label: string;
  value: number | null;
  /** 元になった辺（数量根拠の追跡用） */
  edgeId?: string;
}

/**
 * 計算式で使う記号表。
 * 合計の記号（FA/CA/CH/HL/WA/HA/ML）に加えて、辺ごとの記号（HL1・WA1…）を作る。
 */
export function roomSymbols(
  solved: SolvedShape,
  ceilingHeight: number | null,
  fittings: RoomFitting[] = [],
  limit = DEFAULT_DEDUCTION_LIMIT,
  beamArea = 0,
): RoomSymbol[] {
  const quantities = roomQuantities(
    solved,
    ceilingHeight,
    fittings,
    limit,
    beamArea,
  );
  const symbols: RoomSymbol[] = [
    { symbol: "FA", label: "床面積", value: quantities.floorArea },
    { symbol: "CA", label: "天井面積", value: quantities.ceilingArea },
    { symbol: "CH", label: "天井高さ", value: ceilingHeight },
    { symbol: "WL", label: "壁長さ", value: quantities.wallLength },
    { symbol: "CL", label: "柱長さ", value: quantities.columnLength },
    { symbol: "HL", label: "巾木長さ", value: quantities.baseboardLength },
    { symbol: "WA", label: "壁面積", value: quantities.wallArea },
    { symbol: "HA", label: "柱面積", value: quantities.columnArea },
    { symbol: "ML", label: "廻り縁", value: quantities.moldingLength },
    { symbol: "DA", label: "建具面積（減）", value: quantities.fittingArea },
    { symbol: "DL", label: "建具巾木減", value: quantities.fittingBaseboard },
  ];

  let wallIndex = 0;
  let columnIndex = 0;
  for (const row of solved.edges) {
    if (row.measured === null) continue;
    if (row.kind === "wall" || row.kind === "curve") {
      wallIndex += 1;
      const onWall = fittingTotals(fittings, row.id);
      symbols.push({
        symbol: `HL${wallIndex}`,
        label: `壁${wallIndex} 長さ`,
        value: round2(row.measured - onWall.baseboard),
        edgeId: row.id,
      });
      symbols.push({
        symbol: `WA${wallIndex}`,
        label: `壁${wallIndex} 面積`,
        value:
          ceilingHeight === null
            ? null
            : round2(row.measured * ceilingHeight - onWall.area),
        edgeId: row.id,
      });
    } else if (row.kind === "column") {
      columnIndex += 1;
      symbols.push({
        symbol: `HA${columnIndex}`,
        label: `柱${columnIndex} 面積`,
        value:
          ceilingHeight === null ? null : round2(row.measured * ceilingHeight),
        edgeId: row.id,
      });
    }
  }

  return symbols;
}

/**
 * 選んだ辺の種別（壁・柱など）をまとめて変える。
 * なぞった図形はすべて壁になるので、柱の所だけ選んで一括で直すのに使う。
 */
export function setEdgeKinds(
  shape: RoomShape,
  ids: string[],
  kind: EdgeKind,
): RoomShape {
  if (ids.length === 0) return shape;
  const targets = new Set(ids);
  let changed = false;
  const edges = shape.edges.map((row) => {
    if (!targets.has(row.id) || row.kind === kind) return row;
    changed = true;
    return { ...row, kind };
  });
  return changed ? { edges } : shape;
}

/** 辺を分割する（元の寸法を入れると残りは自動算出になる） */
export function splitEdge(
  shape: RoomShape,
  id: string,
  firstLength: number,
): RoomShape {
  const index = shape.edges.findIndex((row) => row.id === id);
  if (index < 0) return shape;
  const target = shape.edges[index];
  if (isDiagonal(target.direction)) {
    const vector = diagonalVector(target);
    const span = Math.hypot(vector.x, vector.y);
    if (span < 0.005) return shape;
    const ratio = Math.min(Math.max(firstLength / span, 0), 1);
    // 端数で形が開かないように、残りは元の寸法から差し引いて決める
    const headVector = {
      x: round2(vector.x * ratio),
      y: round2(vector.y * ratio),
    };
    const head = edgeFromVector(target, headVector);
    const tail = edgeFromVector(edge("E", null, target.kind), {
      x: round2(vector.x - headVector.x),
      y: round2(vector.y - headVector.y),
    });
    return {
      edges: [
        ...shape.edges.slice(0, index),
        head,
        tail,
        ...shape.edges.slice(index + 1),
      ],
    };
  }
  const rest =
    target.length === null ? null : round2(target.length - firstLength);
  return {
    edges: [
      ...shape.edges.slice(0, index),
      { ...target, length: firstLength },
      { ...edge(target.direction, rest, target.kind) },
      ...shape.edges.slice(index + 1),
    ],
  };
}

/** 座標の差から辺の向き・寸法を決める（縦横がそろわない場合は斜め辺にする） */
function edgeFromVector(base: RoomEdge, vector: Point): RoomEdge {
  const dx = round2(vector.x);
  const dy = round2(vector.y);
  if (Math.abs(dy) < 0.005 && Math.abs(dx) >= 0.005) {
    return {
      ...base,
      direction: dx > 0 ? "E" : "W",
      length: round2(Math.abs(dx)),
      dx: null,
      dy: null,
    };
  }
  if (Math.abs(dx) < 0.005 && Math.abs(dy) >= 0.005) {
    return {
      ...base,
      direction: dy > 0 ? "S" : "N",
      length: round2(Math.abs(dy)),
      dx: null,
      dy: null,
    };
  }
  return {
    ...base,
    direction: "D",
    length: round2(Math.hypot(dx, dy)),
    dx,
    dy,
  };
}

/**
 * 頂点（角）を上下左右へ寸法で動かす。
 * moveX は右がプラス、moveY は下がプラス。
 * 動かした結果、両隣の辺が縦横でなくなる場合は斜め辺になる。
 * cornerIndex は「その角から出ていく辺」の番号。
 */
export function moveCorner(
  shape: RoomShape,
  cornerIndex: number,
  moveX: number,
  moveY: number,
): { shape: RoomShape; error: string | null } {
  const count = shape.edges.length;
  if (count < 3) return { shape, error: "先に部屋の形を作ってください" };
  if (moveX === 0 && moveY === 0) {
    return { shape, error: "移動する寸法を入れてください" };
  }
  const solved = solveShape(shape);
  if (solved.points.length !== count) {
    return { shape, error: "先に部屋の寸法を決めてください" };
  }
  const outIndex = ((cornerIndex % count) + count) % count;
  const inIndex = (outIndex - 1 + count) % count;
  const corner = solved.points[outIndex];
  const previous = solved.points[inIndex];
  const next = solved.points[(outIndex + 1) % count];
  const moved = { x: corner.x + moveX, y: corner.y + moveY };

  const inEdge = edgeFromVector(shape.edges[inIndex], {
    x: moved.x - previous.x,
    y: moved.y - previous.y,
  });
  const outEdge = edgeFromVector(shape.edges[outIndex], {
    x: next.x - moved.x,
    y: next.y - moved.y,
  });
  if ((inEdge.length ?? 0) <= 0 || (outEdge.length ?? 0) <= 0) {
    return { shape, error: "移動すると辺の長さが0以下になります" };
  }

  const edges = [...shape.edges];
  edges[inIndex] = inEdge;
  edges[outIndex] = outEdge;
  return { shape: { edges }, error: null };
}

/**
 * 選んだ範囲（この辺からこの辺まで）の辺の番号。
 * 始めの辺から形をたどる向き（表の並び順）に進んで終わりの辺まで。一周をまたいでもよい。
 */
export function edgeRange(
  shape: RoomShape,
  fromId: string,
  toId: string,
): number[] {
  const count = shape.edges.length;
  const from = shape.edges.findIndex((row) => row.id === fromId);
  const to = shape.edges.findIndex((row) => row.id === toId);
  if (from < 0 || to < 0) return [];
  const steps = (((to - from) % count) + count) % count;
  return Array.from({ length: steps + 1 }, (_, step) => (from + step) % count);
}

/**
 * 選んだ範囲（この辺からこの辺まで）をまとめて消し、その間をまっすぐな壁でそろえる。
 * 始めの辺の始点と終わりの辺の終点を結ぶ辺（縦横がずれていれば2本）に置き換えるので、
 * 1本ずつ消したときのように形が崩れない。
 */
export function trimEdges(
  shape: RoomShape,
  fromId: string,
  toId: string,
): { shape: RoomShape; error: string | null } {
  const count = shape.edges.length;
  const range = edgeRange(shape, fromId, toId);
  if (range.length === 0) return { shape, error: "範囲を選んでください" };
  if (count - range.length < 2) {
    return { shape, error: "この範囲は消せません（辺が残りません）" };
  }
  const solved = solveShape(shape);
  if (solved.points.length !== count) {
    return {
      shape,
      error: "先に部屋の寸法を決めてください（空欄が残っています）",
    };
  }

  const first = range[0];
  const last = range[range.length - 1];
  const start = solved.points[first];
  const end = solved.points[(last + 1) % count];
  const dx = round2(end.x - start.x);
  const dy = round2(end.y - start.y);
  const base = shape.edges[first];
  const replaced: RoomEdge[] = [];
  // 縦横がずれているときは、消した先頭の辺の向きに合わせて2本に分ける
  const horizontalFirst = axisOf(base.direction) !== "y";
  const horizontal = (): void => {
    if (Math.abs(dx) < 0.005) return;
    replaced.push(edge(dx > 0 ? "E" : "W", round2(Math.abs(dx)), base.kind));
  };
  const vertical = (): void => {
    if (Math.abs(dy) < 0.005) return;
    replaced.push(edge(dy > 0 ? "S" : "N", round2(Math.abs(dy)), base.kind));
  };
  if (horizontalFirst) {
    horizontal();
    vertical();
  } else {
    vertical();
    horizontal();
  }

  // 残る辺は「終わりの辺の次」から順にたどる（一周をまたぐ範囲でも同じ形のまま）
  const removedIds = new Set(range.map((index) => shape.edges[index].id));
  const kept: RoomEdge[] = [];
  for (let step = 1; step <= count; step += 1) {
    const row = shape.edges[(last + step) % count];
    if (!removedIds.has(row.id)) kept.push(row);
  }
  const edges = [...kept, ...replaced];
  if (edges.length < 3) {
    return { shape, error: "この範囲は消せません（形が作れません）" };
  }
  return { shape: { edges }, error: null };
}

export function updateEdge(
  shape: RoomShape,
  id: string,
  patch: Partial<RoomEdge>,
): RoomShape {
  return {
    edges: shape.edges.map((row) =>
      row.id === id ? { ...row, ...patch } : row,
    ),
  };
}

/** 取り合いの欠除：この面積以下は差し引かない（設定画面で変更する） */
export const DEFAULT_DEDUCTION_LIMIT = 0.5;

export function deducts(
  area: number,
  limit = DEFAULT_DEDUCTION_LIMIT,
): boolean {
  return area > limit;
}
