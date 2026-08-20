/**
 * 部屋形状（単線図）の計算。
 *
 * 部屋は直交する辺の並びで表す。辺は「向き」と「寸法」を持ち、
 * 未入力の寸法は閉じた形になるように自動算出する（各方向1辺まで自動算出できる）。
 * 数量根拠を追えるように、辺は作成時のIDを保持し続ける。
 */

export type EdgeDirection = "E" | "W" | "N" | "S";

/** 壁：積算対象／開口：壁の無い部分（数量に入れない）／柱：柱1ヶ所分の総幅 */
export type EdgeKind = "wall" | "opening" | "column";

export interface RoomEdge {
  id: string;
  direction: EdgeDirection;
  /** 未入力（自動算出）は null */
  length: number | null;
  kind: EdgeKind;
}

export interface RoomShape {
  edges: RoomEdge[];
}

export interface SolvedEdge extends RoomEdge {
  /** 自動算出した寸法を含む確定値。決められない場合は null */
  resolved: number | null;
  /** 自動算出した辺 */
  auto: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface SolvedShape {
  edges: SolvedEdge[];
  /** 各辺の始点（edges と同じ並び）。寸法が決まらない場合は空 */
  points: Point[];
  /** 寸法が足りず決められない辺のID（画面で点滅させる） */
  missing: string[];
  /** 閉じた形にならない場合の説明 */
  error: string | null;
}

const AXIS: Record<EdgeDirection, "x" | "y"> = {
  E: "x",
  W: "x",
  N: "y",
  S: "y",
};
const SIGN: Record<EdgeDirection, 1 | -1> = { E: 1, W: -1, N: -1, S: 1 };

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

let sequence = 0;

export function edgeId(): string {
  sequence += 1;
  return `e${Date.now().toString(36)}${sequence.toString(36)}`;
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
 * 未入力の寸法を閉じた形になるように自動算出する。
 * X方向・Y方向それぞれ、未入力が1辺までなら自動算出できる。
 */
export function solveShape(shape: RoomShape): SolvedShape {
  const resolved = new Map<string, number>();
  const missing: string[] = [];
  let error: string | null = null;

  for (const axis of ["x", "y"] as const) {
    const axisEdges = shape.edges.filter((row) => AXIS[row.direction] === axis);
    const blanks = axisEdges.filter((row) => row.length === null);
    const total = axisEdges.reduce(
      (sum, row) =>
        row.length === null ? sum : sum + SIGN[row.direction] * row.length,
      0,
    );

    if (blanks.length === 0) {
      if (round2(total) !== 0) {
        error =
          axis === "x"
            ? "横方向の寸法が閉じていません"
            : "縦方向の寸法が閉じていません";
      }
      continue;
    }
    if (blanks.length > 1) {
      blanks.forEach((row) => missing.push(row.id));
      continue;
    }

    const blank = blanks[0];
    const value = round2(-total / SIGN[blank.direction]);
    if (value <= 0) {
      missing.push(blank.id);
      error = "自動算出した寸法が0以下になります";
      continue;
    }
    resolved.set(blank.id, value);
  }

  const edges: SolvedEdge[] = shape.edges.map((row) => ({
    ...row,
    resolved: row.length ?? resolved.get(row.id) ?? null,
    auto: row.length === null && resolved.has(row.id),
  }));

  const points: Point[] = [];
  if (missing.length === 0 && edges.every((row) => row.resolved !== null)) {
    let x = 0;
    let y = 0;
    for (const row of edges) {
      points.push({ x, y });
      const length = row.resolved as number;
      if (AXIS[row.direction] === "x") x += SIGN[row.direction] * length;
      else y += SIGN[row.direction] * length;
    }
  }

  return { edges, points, missing, error };
}

/** 床面積（多角形の面積） */
export function floorArea(solved: SolvedShape): number | null {
  if (solved.points.length < 3) return null;
  let sum = 0;
  for (let i = 0; i < solved.points.length; i += 1) {
    const a = solved.points[i];
    const b = solved.points[(i + 1) % solved.points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return round2(Math.abs(sum) / 2);
}

export interface EdgeLengthTotals {
  /** 壁の長さ合計（開口・柱は含まない） */
  wall: number;
  /** 柱の長さ合計 */
  column: number;
  /** 壁の無い開口の長さ合計（数量には使わない） */
  opening: number;
}

export function edgeTotals(solved: SolvedShape): EdgeLengthTotals {
  const totals: EdgeLengthTotals = { wall: 0, column: 0, opening: 0 };
  for (const row of solved.edges) {
    if (row.resolved === null) continue;
    totals[row.kind] += row.resolved;
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
  /** CA 天井面積 */
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
): RoomQuantities {
  const totals = edgeTotals(solved);
  const area = floorArea(solved);
  const height = ceilingHeight ?? null;
  const fitting = fittingTotals(fittings);
  return {
    floorArea: area,
    ceilingArea: area,
    wallLength: totals.wall,
    columnLength: totals.column,
    baseboardLength: round2(totals.wall + totals.column - fitting.baseboard),
    wallArea:
      height === null ? null : round2(totals.wall * height - fitting.area),
    columnArea: height === null ? null : round2(totals.column * height),
    moldingLength: round2(totals.wall + totals.column),
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
): RoomSymbol[] {
  const quantities = roomQuantities(solved, ceilingHeight, fittings);
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
    if (row.resolved === null) continue;
    if (row.kind === "wall") {
      wallIndex += 1;
      const onWall = fittingTotals(fittings, row.id);
      symbols.push({
        symbol: `HL${wallIndex}`,
        label: `壁${wallIndex} 長さ`,
        value: round2(row.resolved - onWall.baseboard),
        edgeId: row.id,
      });
      symbols.push({
        symbol: `WA${wallIndex}`,
        label: `壁${wallIndex} 面積`,
        value:
          ceilingHeight === null
            ? null
            : round2(row.resolved * ceilingHeight - onWall.area),
        edgeId: row.id,
      });
    } else if (row.kind === "column") {
      columnIndex += 1;
      symbols.push({
        symbol: `HA${columnIndex}`,
        label: `柱${columnIndex} 面積`,
        value:
          ceilingHeight === null ? null : round2(row.resolved * ceilingHeight),
        edgeId: row.id,
      });
    }
  }

  return symbols;
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
