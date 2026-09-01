/**
 * 図面画像をなぞって部屋形状を作る計算。
 *
 * 画像は画素（px）の座標で扱い、2点をクリックして実寸（m）を入れて縮尺を決める。
 * なぞった点はそのまま数量根拠として残し、部屋形状（辺の並び）へ写す。
 */

import type { EdgeKind, Point, RoomEdge, RoomShape } from "./shape";
import { edge, round2 } from "./shape";

/** 画像に載せてなぞった内容（部屋計算書に保存する） */
export interface RoomTrace {
  /** 図面画像（data URL）。無いときは空文字 */
  image: string;
  /** 画像1画素が何メートルか。0 は縮尺が未設定 */
  metersPerPixel: number;
  /** 縮尺合わせに使った2点（画素座標）。数量根拠として残す */
  scalePoints: Point[];
  /** 縮尺合わせに入れた実寸（m） */
  scaleLength: number;
  /** なぞった点（画素座標） */
  points: Point[];
}

export const EMPTY_TRACE: RoomTrace = {
  image: "",
  metersPerPixel: 0,
  scalePoints: [],
  scaleLength: 0,
  points: [],
};

export function parseTrace(json: string): RoomTrace {
  try {
    const parsed = JSON.parse(json) as Partial<RoomTrace>;
    return {
      image: typeof parsed.image === "string" ? parsed.image : "",
      metersPerPixel:
        typeof parsed.metersPerPixel === "number" &&
        Number.isFinite(parsed.metersPerPixel)
          ? parsed.metersPerPixel
          : 0,
      scalePoints: Array.isArray(parsed.scalePoints) ? parsed.scalePoints : [],
      scaleLength:
        typeof parsed.scaleLength === "number" &&
        Number.isFinite(parsed.scaleLength)
          ? parsed.scaleLength
          : 0,
      points: Array.isArray(parsed.points) ? parsed.points : [],
    };
  } catch {
    return { ...EMPTY_TRACE };
  }
}

/** 2点と実寸から縮尺（1画素あたりのメートル）を出す */
export function metersPerPixel(
  from: Point,
  to: Point,
  realLength: number,
): number {
  const pixels = Math.hypot(to.x - from.x, to.y - from.y);
  if (pixels === 0 || !(realLength > 0)) return 0;
  return realLength / pixels;
}

/** 画素座標をメートルへ直す */
export function toMeters(points: Point[], perPixel: number): Point[] {
  return points.map((point) => ({
    x: point.x * perPixel,
    y: point.y * perPixel,
  }));
}

/**
 * 直前の点から見て、ほぼ水平・ほぼ垂直なら真横・真下にそろえる（直交スナップ）。
 * ratio は「短い方÷長い方」がこれ以下ならそろえる、という当たりの幅。
 */
export function snapToAxis(previous: Point, point: Point, ratio = 0.25): Point {
  const dx = point.x - previous.x;
  const dy = point.y - previous.y;
  const across = Math.abs(dx);
  const along = Math.abs(dy);
  if (across === 0 || along === 0) return point;
  if (along <= across * ratio) return { x: point.x, y: previous.y };
  if (across <= along * ratio) return { x: previous.x, y: point.y };
  return point;
}

/**
 * なぞった点（メートル・y は下がプラス）を部屋形状へ写す。
 * 水平・垂直の辺は E/W/N/S、斜めの辺は D（横移動・縦移動）にする。
 */
export function pointsToShape(
  points: Point[],
  kind: EdgeKind = "wall",
): RoomShape {
  if (points.length < 3) return { edges: [] };
  const edges: RoomEdge[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const dx = round2(to.x - from.x);
    const dy = round2(to.y - from.y);
    if (dx === 0 && dy === 0) continue;
    if (dy === 0) {
      edges.push(edge(dx > 0 ? "E" : "W", Math.abs(dx), kind));
      continue;
    }
    if (dx === 0) {
      edges.push(edge(dy > 0 ? "S" : "N", Math.abs(dy), kind));
      continue;
    }
    const diagonal = edge("D", round2(Math.hypot(dx, dy)), kind);
    edges.push({ ...diagonal, dx, dy });
  }
  return { edges };
}

/**
 * なぞった点のうち、いちばん長い辺の長さ（画素）。
 * 縮尺が未設定のまま なぞったときに、その辺の実寸から縮尺を出すのに使う。
 */
export function longestEdgePixels(points: Point[]): number {
  if (points.length < 2) return 0;
  let longest = 0;
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    longest = Math.max(longest, Math.hypot(to.x - from.x, to.y - from.y));
  }
  return longest;
}

/** なぞった形の面積（㎡）。確かめ用に画面へ出す */
export function traceArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let doubled = 0;
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    doubled += from.x * to.y - to.x * from.y;
  }
  return round2(Math.abs(doubled) / 2);
}
