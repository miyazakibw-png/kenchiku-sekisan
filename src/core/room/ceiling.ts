/**
 * 天井伏図（平面図に梁型・下がり壁・下がり天井の線を足したもの）の計算。
 *
 * 平面図の辺をそのまま使い、追加した線が持つ「範囲の天井高さ」から
 * 部屋の天井高さとの差（下がり高さ）を自動算出して数量にする。
 * 数量根拠を追えるように、追加した線も作成時のIDと取り付く辺のIDを保持する。
 */

import { round2, type SolvedShape } from "./shape";

/**
 * wallBeam: 壁付き梁型（壁面に付く梁。GL/GA）
 * ceilingBeam: 天井付梁型（壁から離れた梁。BL/BA）
 * dropWall: 下がり壁（DWL/DWA）
 * dropCeiling: 下がり天井（SL/SA。高さごとに長さを出す）
 */
export type CeilingElementKind =
  "wallBeam" | "ceilingBeam" | "dropWall" | "dropCeiling";

export interface CeilingElement {
  /** 数量根拠の追跡用のID */
  id: string;
  kind: CeilingElementKind;
  /** どの壁沿いか（未入力の寸法・作図位置に使う） */
  edgeId: string | null;
  /** 長さ。未入力なら取り付く壁の長さ */
  length: number | null;
  /** 天井伏図に見える幅（梁幅・下がり天井の見付） */
  width: number | null;
  /** 壁からの離れ（天井付梁型・下がり天井の位置） */
  offset: number | null;
  /** その範囲の天井高さ。部屋の天井高さとの差が下がり高さ */
  ceilingHeight: number | null;
  /** Ｈ（梁せい・下がり壁の高さ）。入れると壁の高さ（範囲の天井高さ）は自動で決まる */
  height?: number | null;
  /** 下がり天井の範囲面積（範囲の自動判定は次段階。ここでは入力値を使う） */
  area: number | null;
  note: string;
}

export interface CeilingElementResult {
  element: CeilingElement;
  /** 確定した長さ */
  length: number | null;
  /** 下がり高さ（部屋の天井高さ − 範囲の天井高さ） */
  drop: number | null;
  /** 見付面積（梁型は幅と下がり高さから、下がり壁は下がり高さから） */
  area: number | null;
  /** 天井伏図に出す範囲の番号（下がり天井のみ。C1・C2…） */
  code: string | null;
}

export interface CeilingPoint {
  x: number;
  y: number;
}

/** 天井伏図に描く線（壁で止めた区間） */
export interface CeilingSegment {
  a: CeilingPoint;
  b: CeilingPoint;
  length: number;
}

function signedArea(points: CeilingPoint[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + (point.x * next.y - next.x * point.y);
  }, 0);
}

function cross(a: CeilingPoint, b: CeilingPoint): number {
  return a.x * b.y - a.y * b.x;
}

function inside(points: CeilingPoint[], target: CeilingPoint): boolean {
  let hit = false;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const crosses = point.y > target.y !== next.y > target.y;
    if (!crosses) return;
    const x =
      point.x +
      ((target.y - point.y) / (next.y - point.y)) * (next.x - point.x);
    if (target.x < x) hit = !hit;
  });
  return hit;
}

/** 部屋の内側へ向く単位ベクトル（辺の法線） */
export function inwardNormal(
  points: CeilingPoint[],
  index: number,
): CeilingPoint {
  const from = points[index];
  const to = points[(index + 1) % points.length];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const size = Math.hypot(dx, dy) || 1;
  const sign = signedArea(points) >= 0 ? 1 : -1;
  return { x: (-dy / size) * sign, y: (dx / size) * sign };
}

/**
 * 辺から内側へ離した位置に引く線を、部屋の壁に当たるところで止める。
 * 下がり天井のように部屋を横切る線でも、○から○まで（壁から壁まで）になる。
 */
export function wallToWallLine(
  points: CeilingPoint[],
  index: number,
  distance: number,
): CeilingSegment | null {
  if (points.length < 3 || index < 0 || index >= points.length) return null;
  const from = points[index];
  const to = points[(index + 1) % points.length];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const size = Math.hypot(dx, dy);
  if (size === 0) return null;
  const dir = { x: dx / size, y: dy / size };
  const normal = inwardNormal(points, index);
  const base = {
    x: from.x + normal.x * distance,
    y: from.y + normal.y * distance,
  };
  if (Math.abs(distance) < 1e-6) {
    return { a: from, b: to, length: round2(size) };
  }

  const hits: number[] = [];
  points.forEach((point, no) => {
    const next = points[(no + 1) % points.length];
    const span = { x: next.x - point.x, y: next.y - point.y };
    const denom = cross(dir, span);
    if (Math.abs(denom) < 1e-9) return;
    const gap = { x: point.x - base.x, y: point.y - base.y };
    const u = cross(gap, dir) / denom;
    if (u < -1e-9 || u > 1 + 1e-9) return;
    const t = cross(gap, span) / denom;
    if (!hits.some((value) => Math.abs(value - t) < 1e-6)) hits.push(t);
  });
  hits.sort((a, b) => a - b);
  if (hits.length < 2) return null;

  const at = (t: number): CeilingPoint => ({
    x: base.x + dir.x * t,
    y: base.y + dir.y * t,
  });
  const middle = size / 2;
  let best: [number, number] | null = null;
  for (let no = 0; no + 1 < hits.length; no += 1) {
    const [start, end] = [hits[no], hits[no + 1]];
    if (end - start < 1e-6) continue;
    if (!inside(points, at((start + end) / 2))) continue;
    const holdsMiddle = start <= middle && middle <= end;
    if (holdsMiddle) {
      best = [start, end];
      break;
    }
    if (best === null || end - start > best[1] - best[0]) best = [start, end];
  }
  if (best === null) return null;
  return { a: at(best[0]), b: at(best[1]), length: round2(best[1] - best[0]) };
}

/** その線が取り付く辺から内側へ離す寸法 */
export function ceilingLineDistance(element: CeilingElement): number {
  if (element.kind === "wallBeam" || element.kind === "dropWall")
    return element.width ?? 0;
  return element.offset ?? 0;
}

export interface CeilingTotals {
  /** GL 壁付き梁型の長さ */
  wallBeamLength: number;
  /** GA 壁付き梁型の面積 */
  wallBeamArea: number;
  /** BL 天井付梁型の長さ */
  ceilingBeamLength: number;
  /** BA 天井付梁型の面積 */
  ceilingBeamArea: number;
  /** DWL 下がり壁の長さ */
  dropWallLength: number;
  /** DWA 下がり壁の面積 */
  dropWallArea: number;
  /** SL 下がり天井の段差長さ */
  dropCeilingLength: number;
  /** SA 下がり天井の範囲面積 */
  dropCeilingArea: number;
}

export interface CeilingQuantities {
  items: CeilingElementResult[];
  totals: CeilingTotals;
  /** 下がり天井の高さごとの長さ（下がり高さ→長さ） */
  dropCeilingByHeight: { drop: number; length: number }[];
}

let sequence = 0;

export function ceilingElementId(): string {
  sequence += 1;
  return `c${Date.now().toString(36)}${sequence.toString(36)}`;
}

export function ceilingElement(
  kind: CeilingElementKind,
  edgeId: string | null,
): CeilingElement {
  return {
    id: ceilingElementId(),
    kind,
    edgeId,
    length: null,
    width: kind === "dropCeiling" ? null : 0.3,
    offset: kind === "wallBeam" || kind === "dropWall" ? 0 : 1,
    ceilingHeight: null,
    height: null,
    area: null,
    note: "",
  };
}

function edgeLength(solved: SolvedShape, edgeId: string | null): number | null {
  if (edgeId === null) return null;
  return solved.edges.find((row) => row.id === edgeId)?.resolved ?? null;
}

/**
 * 天井伏図の数量。
 * 梁型面積は「長さ×(梁幅＋下がり高さ)」（天井付梁型は両側に見付が出るので下がり高さ×2）。
 */
export function ceilingQuantities(
  elements: CeilingElement[],
  solved: SolvedShape,
  roomCeilingHeight: number | null,
): CeilingQuantities {
  const totals: CeilingTotals = {
    wallBeamLength: 0,
    wallBeamArea: 0,
    ceilingBeamLength: 0,
    ceilingBeamArea: 0,
    dropWallLength: 0,
    dropWallArea: 0,
    dropCeilingLength: 0,
    dropCeilingArea: 0,
  };
  const byHeight = new Map<number, number>();
  let dropCeilingNo = 0;

  const items = elements.map((element) => {
    // 下がり天井は部屋を横切るので、壁に当たるところまでの長さを自動で使う
    const crossing =
      element.kind === "dropCeiling"
        ? wallToWallLine(
            solved.points,
            solved.edges.findIndex((row) => row.id === element.edgeId),
            ceilingLineDistance(element),
          )
        : null;
    const length =
      element.length ?? crossing?.length ?? edgeLength(solved, element.edgeId);
    const code =
      element.kind === "dropCeiling" ? `C${(dropCeilingNo += 1)}` : null;
    // 梁型・下がり壁はＨ（梁せい）をそのまま下がりに使い、壁の高さは自動で決める
    const drop =
      element.height !== null && element.height !== undefined
        ? round2(element.height)
        : roomCeilingHeight === null || element.ceilingHeight === null
          ? null
          : round2(roomCeilingHeight - element.ceilingHeight);
    const width = element.width ?? 0;
    let area: number | null = null;

    if (length !== null) {
      switch (element.kind) {
        case "wallBeam":
          totals.wallBeamLength += length;
          if (drop !== null) area = round2(length * (width + drop));
          totals.wallBeamArea += area ?? 0;
          break;
        case "ceilingBeam":
          totals.ceilingBeamLength += length;
          if (drop !== null) area = round2(length * (width + drop * 2));
          totals.ceilingBeamArea += area ?? 0;
          break;
        case "dropWall":
          totals.dropWallLength += length;
          if (drop !== null) area = round2(length * drop);
          totals.dropWallArea += area ?? 0;
          break;
        case "dropCeiling":
          totals.dropCeilingLength += length;
          area = element.area;
          totals.dropCeilingArea += area ?? 0;
          if (drop !== null) {
            byHeight.set(drop, round2((byHeight.get(drop) ?? 0) + length));
          }
          break;
      }
    }

    return { element, length, drop, area, code };
  });

  return {
    items,
    totals: {
      wallBeamLength: round2(totals.wallBeamLength),
      wallBeamArea: round2(totals.wallBeamArea),
      ceilingBeamLength: round2(totals.ceilingBeamLength),
      ceilingBeamArea: round2(totals.ceilingBeamArea),
      dropWallLength: round2(totals.dropWallLength),
      dropWallArea: round2(totals.dropWallArea),
      dropCeilingLength: round2(totals.dropCeilingLength),
      dropCeilingArea: round2(totals.dropCeilingArea),
    },
    dropCeilingByHeight: [...byHeight.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([drop, length]) => ({ drop, length })),
  };
}

export interface CeilingSymbol {
  symbol: string;
  label: string;
  value: number | null;
  /** 元になった線（数量根拠の追跡用） */
  elementId?: string;
}

const KIND_SYMBOL: Record<
  CeilingElementKind,
  { length: string; area: string }
> = {
  wallBeam: { length: "GL", area: "GA" },
  ceilingBeam: { length: "BL", area: "BA" },
  dropWall: { length: "DWL", area: "DWA" },
  dropCeiling: { length: "SL", area: "SA" },
};

const KIND_LABEL: Record<CeilingElementKind, string> = {
  wallBeam: "壁付き梁型",
  ceilingBeam: "天井付梁型",
  dropWall: "下がり壁",
  dropCeiling: "下がり天井",
};

/** 計算式で使う天井伏図の記号（合計と線ごと） */
export function ceilingSymbols(quantities: CeilingQuantities): CeilingSymbol[] {
  const { totals } = quantities;
  const symbols: CeilingSymbol[] = [
    { symbol: "GL", label: "壁付き梁型 長さ", value: totals.wallBeamLength },
    { symbol: "GA", label: "壁付き梁型 面積", value: totals.wallBeamArea },
    { symbol: "BL", label: "天井付梁型 長さ", value: totals.ceilingBeamLength },
    { symbol: "BA", label: "天井付梁型 面積", value: totals.ceilingBeamArea },
    { symbol: "DWL", label: "下がり壁 長さ", value: totals.dropWallLength },
    { symbol: "DWA", label: "下がり壁 面積", value: totals.dropWallArea },
    { symbol: "SL", label: "下がり天井 長さ", value: totals.dropCeilingLength },
    { symbol: "SA", label: "下がり天井 面積", value: totals.dropCeilingArea },
  ];

  const index: Record<CeilingElementKind, number> = {
    wallBeam: 0,
    ceilingBeam: 0,
    dropWall: 0,
    dropCeiling: 0,
  };
  for (const item of quantities.items) {
    const kind = item.element.kind;
    index[kind] += 1;
    const no = index[kind];
    symbols.push({
      symbol: `${KIND_SYMBOL[kind].length}${no}`,
      label: `${KIND_LABEL[kind]}${no} 長さ`,
      value: item.length,
      elementId: item.element.id,
    });
    symbols.push({
      symbol: `${KIND_SYMBOL[kind].area}${no}`,
      label: `${KIND_LABEL[kind]}${no} 面積`,
      value: item.area,
      elementId: item.element.id,
    });
  }

  for (const [no, row] of quantities.dropCeilingByHeight.entries()) {
    symbols.push({
      symbol: `SLH${no + 1}`,
      label: `下がり天井 下がり${row.drop.toFixed(2)} 長さ`,
      value: row.length,
    });
  }

  return symbols;
}
