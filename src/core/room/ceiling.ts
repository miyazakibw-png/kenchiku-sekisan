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
  /** 下がるのは線の向こう側（壁と反対側）か。未指定は壁側が下がる */
  inner?: boolean;
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

/** その要素が天井から下がる寸法（Ｈを入れていればそのまま使う） */
export function elementDrop(
  element: CeilingElement,
  roomCeilingHeight: number | null,
): number | null {
  if (element.height !== null && element.height !== undefined)
    return round2(element.height);
  if (roomCeilingHeight === null || element.ceilingHeight === null) return null;
  return round2(roomCeilingHeight - element.ceilingHeight);
}

/** 辺に沿って内側へ離した線（壁の長さいっぱい。切りません） */
function offsetSegment(
  points: CeilingPoint[],
  index: number,
  distance: number,
): CeilingSegment | null {
  if (points.length < 3 || index < 0 || index >= points.length) return null;
  const from = points[index];
  const to = points[(index + 1) % points.length];
  const size = Math.hypot(to.x - from.x, to.y - from.y);
  if (size === 0) return null;
  const normal = inwardNormal(points, index);
  return {
    a: { x: from.x + normal.x * distance, y: from.y + normal.y * distance },
    b: { x: to.x + normal.x * distance, y: to.y + normal.y * distance },
    length: round2(size),
  };
}

/** 線を、当たった線のところで切って一番長い区間を残す */
function cutByBarriers(
  line: CeilingSegment,
  barriers: CeilingSegment[],
): CeilingSegment {
  const span = { x: line.b.x - line.a.x, y: line.b.y - line.a.y };
  const size = Math.hypot(span.x, span.y);
  if (size === 0) return line;
  const dir = { x: span.x / size, y: span.y / size };
  const cuts = [0, size];

  barriers.forEach((barrier) => {
    const other = {
      x: barrier.b.x - barrier.a.x,
      y: barrier.b.y - barrier.a.y,
    };
    const denom = cross(dir, other);
    if (Math.abs(denom) < 1e-9) return;
    const gap = { x: barrier.a.x - line.a.x, y: barrier.a.y - line.a.y };
    const u = cross(gap, dir) / denom;
    if (u < -1e-9 || u > 1 + 1e-9) return;
    const t = cross(gap, other) / denom;
    if (t < 1e-6 || t > size - 1e-6) return;
    if (!cuts.some((value) => Math.abs(value - t) < 1e-6)) cuts.push(t);
  });

  cuts.sort((a, b) => a - b);
  let best: [number, number] = [cuts[0], cuts[1]];
  for (let no = 1; no + 1 < cuts.length; no += 1) {
    if (cuts[no + 1] - cuts[no] > best[1] - best[0])
      best = [cuts[no], cuts[no + 1]];
  }

  const at = (t: number): CeilingPoint => ({
    x: line.a.x + dir.x * t,
    y: line.a.y + dir.y * t,
  });
  return { a: at(best[0]), b: at(best[1]), length: round2(best[1] - best[0]) };
}

/** 天井伏図に描く線（天井付梁型は両側の2本） */
export interface CeilingLine extends CeilingSegment {
  elementId: string;
  kind: CeilingElementKind;
  /** その要素の何本目の線か */
  no: number;
  /** 沿う辺からの離れ */
  distance: number;
}

/**
 * 天井伏図の線を作る。
 * 壁付き梁型・下がり壁は壁の長さのまま。
 * 下がり天井・天井付梁型は、突き当たる壁か、自分より低くなる線のところで止める
 * （立体で見て、より下がっている天井・梁の下をくぐらない）。
 */
export function ceilingLines(
  elements: CeilingElement[],
  solved: SolvedShape,
  roomCeilingHeight: number | null,
): CeilingLine[] {
  const points = solved.points;
  if (points.length < 3) return [];

  const distancesOf = (element: CeilingElement): number[] => {
    const width = element.width ?? 0;
    const offset = element.offset ?? 0;
    if (element.kind === "ceilingBeam") return [offset, offset + width];
    if (element.kind === "dropCeiling") return [offset];
    return [width];
  };

  const rough = elements.map((element) => {
    const index = solved.edges.findIndex((row) => row.id === element.edgeId);
    const crossing = element.kind === "wallBeam" || element.kind === "dropWall";
    const lines = distancesOf(element).map((distance, no) => {
      const segment = crossing
        ? offsetSegment(points, index, distance)
        : wallToWallLine(points, index, distance);
      return segment === null
        ? null
        : {
            ...segment,
            elementId: element.id,
            kind: element.kind,
            no,
            distance,
          };
    });
    return {
      element,
      index,
      lines,
      drop: elementDrop(element, roomCeilingHeight),
    };
  });

  return rough.flatMap((row) => {
    const clip =
      row.element.kind === "dropCeiling" || row.element.kind === "ceilingBeam";
    if (!clip)
      return row.lines.filter((line): line is CeilingLine => line !== null);

    // 自分より低くなる（下がりが大きい）線だけが行き止まりになる
    const barriers = rough
      .filter(
        (other) =>
          other.element.id !== row.element.id &&
          other.drop !== null &&
          (row.drop === null || other.drop > row.drop + 1e-6),
      )
      .flatMap((other) => other.lines.filter((line) => line !== null));

    return row.lines
      .filter((line): line is CeilingLine => line !== null)
      .map((line) => ({ ...line, ...cutByBarriers(line, barriers) }));
  });
}

/** 線で囲まれた天井の区画（C1・C2…）。天井高さが同じで隣り合う区画は1つにまとめる */
export interface CeilingRegion {
  /** 区画の番号（C1・C2…） */
  code: string;
  /** まとめた元の形（コ型・L型はいくつかに分かれる） */
  parts: CeilingPoint[][];
  /** 番号を出す位置（一番広いところの中央） */
  center: CeilingPoint;
  area: number;
  /** その区画の下がり（部屋の天井高さからの下がり） */
  drop: number;
  /** その区画の天井高さ */
  height: number | null;
  /** その区画を下げている下がり天井（壁に近い順）。天井高さはこの行に入る */
  elementIds: string[];
  /** その区画の境目になっている下がり天井（下がっていない側の区画でも高さを入れられる） */
  boundaryIds: string[];
}

/** その点が多角形のどの辺のどこに乗っているか（乗っていなければnull） */
function boundaryAt(
  poly: CeilingPoint[],
  target: CeilingPoint,
): { edge: number; rate: number } | null {
  let best: { edge: number; rate: number } | null = null;
  let bestGap = 1e-6;
  poly.forEach((point, no) => {
    const next = poly[(no + 1) % poly.length];
    const span = { x: next.x - point.x, y: next.y - point.y };
    const size = span.x * span.x + span.y * span.y;
    if (size < 1e-18) return;
    const rate = Math.max(
      0,
      Math.min(
        1,
        ((target.x - point.x) * span.x + (target.y - point.y) * span.y) / size,
      ),
    );
    const near = { x: point.x + span.x * rate, y: point.y + span.y * rate };
    const gap = Math.hypot(target.x - near.x, target.y - near.y);
    if (gap <= bestGap) {
      bestGap = gap;
      best = { edge: no, rate };
    }
  });
  return best;
}

/**
 * 多角形をその線で切る。
 * 線がその多角形を横切っているところ（中を通るひと続き）だけで切るので、
 * L型・凹型でも、線が届いていないところはそのまま残る。
 */
function cutPolygon(
  poly: CeilingPoint[],
  line: CeilingSegment,
): CeilingPoint[][] {
  const span = { x: line.b.x - line.a.x, y: line.b.y - line.a.y };
  const size = Math.hypot(span.x, span.y);
  if (size < 1e-9) return [poly];
  const dir = { x: span.x / size, y: span.y / size };

  // 線の上で、外周と交わるところを並べる
  const hits: number[] = [0, size];
  poly.forEach((point, no) => {
    const next = poly[(no + 1) % poly.length];
    const edge = { x: next.x - point.x, y: next.y - point.y };
    const denom = cross(dir, edge);
    const gap = { x: point.x - line.a.x, y: point.y - line.a.y };
    if (Math.abs(denom) < 1e-9) return;
    const rate = cross(gap, dir) / denom;
    if (rate < -1e-9 || rate > 1 + 1e-9) return;
    const t = cross(gap, edge) / denom;
    if (t < -1e-6 || t > size + 1e-6) return;
    if (!hits.some((value) => Math.abs(value - t) < 1e-6)) hits.push(t);
  });
  hits.sort((left, right) => left - right);

  const at = (t: number): CeilingPoint => ({
    x: line.a.x + dir.x * t,
    y: line.a.y + dir.y * t,
  });

  // 中を通っているひと続きを探して、そこで切る
  for (let no = 0; no + 1 < hits.length; no += 1) {
    const [start, end] = [hits[no], hits[no + 1]];
    if (end - start < 1e-6) continue;
    if (!inside(poly, at((start + end) / 2))) continue;
    const halves = splitAtChord(poly, at(start), at(end));
    if (halves === null) continue;
    return halves.flatMap((half) => cutPolygon(half, line));
  }
  return [poly];
}

/** 両端が外周に乗っている線で多角形を2つに分ける */
function splitAtChord(
  poly: CeilingPoint[],
  head: CeilingPoint,
  tail: CeilingPoint,
): [CeilingPoint[], CeilingPoint[]] | null {
  const from = boundaryAt(poly, head);
  const to = boundaryAt(poly, tail);
  if (from === null || to === null || from.edge === to.edge) return null;

  const at = (place: { edge: number; rate: number }): CeilingPoint => {
    const point = poly[place.edge];
    const next = poly[(place.edge + 1) % poly.length];
    return {
      x: point.x + (next.x - point.x) * place.rate,
      y: point.y + (next.y - point.y) * place.rate,
    };
  };
  const start = at(from);
  const end = at(to);

  // 外周を「線の入口→出口」でたどって2つの輪にする
  const walk = (
    headEdge: number,
    tailEdge: number,
    headPoint: CeilingPoint,
    tailPoint: CeilingPoint,
  ): CeilingPoint[] => {
    const ring: CeilingPoint[] = [headPoint];
    let edge = headEdge;
    while (edge !== tailEdge) {
      edge = (edge + 1) % poly.length;
      ring.push(poly[edge]);
    }
    ring.push(tailPoint);
    return ring;
  };

  const halves: [CeilingPoint[], CeilingPoint[]] = [
    walk(from.edge, to.edge, start, end),
    walk(to.edge, from.edge, end, start),
  ];
  if (polygonArea(halves[0]) < 1e-6 || polygonArea(halves[1]) < 1e-6)
    return null;
  return halves;
}

function polygonArea(poly: CeilingPoint[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  poly.forEach((point, no) => {
    const next = poly[(no + 1) % poly.length];
    sum += point.x * next.y - next.x * point.y;
  });
  return Math.abs(sum) / 2;
}

function polygonCenter(poly: CeilingPoint[]): CeilingPoint {
  let sum = 0;
  let x = 0;
  let y = 0;
  poly.forEach((point, no) => {
    const next = poly[(no + 1) % poly.length];
    const step = point.x * next.y - next.x * point.y;
    sum += step;
    x += (point.x + next.x) * step;
    y += (point.y + next.y) * step;
  });
  if (Math.abs(sum) < 1e-9) {
    const first = poly[0] ?? { x: 0, y: 0 };
    return { x: first.x, y: first.y };
  }
  return { x: x / (3 * sum), y: y / (3 * sum) };
}

/** 梁型が天井から取る場所（梁底）。天井面積・区画の面積からはこの分を引く */
export interface CeilingBeamFootprint {
  /** その梁底の真ん中（どの区画に入るかを見る） */
  center: CeilingPoint;
  /** 長さ×Ｗ幅 */
  area: number;
}

/** 壁付き梁型・天井付梁型が天井から取る場所（長さ×Ｗ幅）とその中央 */
export function beamFootprints(
  elements: CeilingElement[],
  solved: SolvedShape,
  roomCeilingHeight: number | null,
): CeilingBeamFootprint[] {
  const points = solved.points;
  if (points.length < 3) return [];
  const lines = ceilingLines(elements, solved, roomCeilingHeight);

  return elements.flatMap((element) => {
    if (element.kind !== "wallBeam" && element.kind !== "ceilingBeam")
      return [];
    const width = element.width ?? 0;
    if (width <= 0) return [];
    const index = solved.edges.findIndex((row) => row.id === element.edgeId);
    if (index < 0) return [];
    const line = lines.find(
      (row) => row.elementId === element.id && row.no === 0,
    );
    if (line === undefined) return [];
    const normal = inwardNormal(points, index);
    // 壁付き梁型は壁と線の間、天井付梁型は2本の線の間が梁底
    const step = element.kind === "wallBeam" ? -width / 2 : width / 2;
    return [
      {
        center: {
          x: (line.a.x + line.b.x) / 2 + normal.x * step,
          y: (line.a.y + line.b.y) / 2 + normal.y * step,
        },
        area: round2(line.length * width),
      },
    ];
  });
}

/** 梁型が天井から取る梁底の合計（長さ×Ｗ幅）。天井面積はこの分を引く */
export function beamFootprintArea(
  elements: CeilingElement[],
  solved: SolvedShape,
  roomCeilingHeight: number | null,
): number {
  return round2(
    beamFootprints(elements, solved, roomCeilingHeight).reduce(
      (sum, beam) => sum + beam.area,
      0,
    ),
  );
}

/**
 * 天井を、下がり天井の線で区切った区画に分けて番号（C1・C2…）を振る。
 * 区切りに使うのは下がり天井の線だけ（梁型・下がり壁は天井の高さを分けないので使わない）。
 * 天井高さが同じで隣り合う区画（コ型・L型の下がり天井）は1つにまとめ、番号も1つ。
 * 番号は区画の中（一番ふところの広いところ）に出す。並びは左上から。
 */
export function ceilingRegions(
  elements: CeilingElement[],
  solved: SolvedShape,
  roomCeilingHeight: number | null,
): CeilingRegion[] {
  const points = solved.points;
  if (points.length < 3) return [];

  const dropOf = new Map(
    elements.map((element) => [
      element.id,
      elementDrop(element, roomCeilingHeight) ?? 0,
    ]),
  );
  // 区画を切るのは下がり天井の線だけ。梁型の線で切れて短くなっていても、
  // 天井の高さが変わる境目は壁から壁までなので、切るときは壁までの線を使う。
  // 低い線から先に区切る（低い線で止まっている線も、その区画は区切れる）
  const lines = elements
    .filter((element) => element.kind === "dropCeiling")
    .map((element) => ({
      element,
      line: wallToWallLine(
        points,
        solved.edges.findIndex((row) => row.id === element.edgeId),
        element.offset ?? 0,
      ),
    }))
    .filter(
      (row): row is { element: CeilingElement; line: CeilingSegment } =>
        row.line !== null,
    )
    .sort(
      (left, right) =>
        (dropOf.get(right.element.id) ?? 0) -
        (dropOf.get(left.element.id) ?? 0),
    );

  let polygons: CeilingPoint[][] = [points];
  lines.forEach((row) => {
    polygons = polygons.flatMap((poly) => cutPolygon(poly, row.line));
  });

  // 梁型（壁付き・天井付）が取る梁底は、その区画の天井面積から引く
  const beams = beamFootprints(elements, solved, roomCeilingHeight);

  const pieces = polygons.map((poly) => {
    const center = polygonCenter(poly);
    // その区画のふちになっている下がり天井（下がっていない側でも高さを入れられるように）
    const boundaryIds = lines
      .filter((row) => onBoundary(poly, row.line))
      .map((row) => row.element.id);
    const found = dropAt(elements, solved, roomCeilingHeight, center);
    const beamArea = beams
      .filter((beam) => inside(poly, beam.center))
      .reduce((sum, beam) => sum + beam.area, 0);
    return {
      poly,
      center,
      area: Math.max(0, polygonArea(poly) - beamArea),
      drop: found.drop,
      waiting: found.waiting,
      elementIds: found.elementIds,
      boundaryIds,
    };
  });

  // 天井高さが同じで隣り合う区画（コ型・L型の下がり天井）は1つにまとめる
  const group = pieces.map((_, no) => no);
  const rootOf = (no: number): number =>
    group[no] === no ? no : (group[no] = rootOf(group[no]));
  pieces.forEach((left, no) => {
    pieces.forEach((right, other) => {
      if (other <= no) return;
      if (Math.abs(left.drop - right.drop) > 1e-6) return;
      if (left.waiting !== right.waiting) return;
      if (!touching(left.poly, right.poly)) return;
      group[rootOf(other)] = rootOf(no);
    });
  });

  const merged = new Map<number, typeof pieces>();
  pieces.forEach((piece, no) => {
    const key = rootOf(no);
    merged.set(key, [...(merged.get(key) ?? []), piece]);
  });

  return [...merged.values()]
    .map((rows) => {
      const widest = rows.reduce((best, row) =>
        row.area > best.area ? row : best,
      );
      const parts = rows.map((row) => row.poly);
      return {
        parts,
        center: labelPoint(parts, widest.center),
        area: round2(rows.reduce((sum, row) => sum + row.area, 0)),
        drop: widest.drop,
        elementIds: widest.elementIds,
        boundaryIds: [...new Set(rows.flatMap((row) => row.boundaryIds))],
        height:
          roomCeilingHeight === null
            ? null
            : round2(roomCeilingHeight - widest.drop),
      };
    })
    .sort((left, right) =>
      Math.abs(left.center.y - right.center.y) > 1e-6
        ? left.center.y - right.center.y
        : left.center.x - right.center.x,
    )
    .map((row, no) => ({ code: `C${no + 1}`, ...row }));
}

/** 番号を出す位置（区画の中で、まわりの線から一番離れているところ） */
function labelPoint(
  parts: CeilingPoint[][],
  fallback: CeilingPoint,
): CeilingPoint {
  const all = parts.flat();
  if (all.length === 0) return fallback;
  const left = Math.min(...all.map((point) => point.x));
  const right = Math.max(...all.map((point) => point.x));
  const top = Math.min(...all.map((point) => point.y));
  const bottom = Math.max(...all.map((point) => point.y));

  const inParts = (target: CeilingPoint): boolean =>
    parts.some((poly) => inside(poly, target));

  // まとめた区画の外まわりの線だけを見る（中で接している線は境目にしない）
  const edges: [CeilingPoint, CeilingPoint][] = [];
  parts.forEach((poly) => {
    poly.forEach((point, no) => {
      const next = poly[(no + 1) % poly.length];
      const span = { x: next.x - point.x, y: next.y - point.y };
      const size = Math.hypot(span.x, span.y);
      if (size < 1e-9) return;
      const middle = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
      const step = Math.min(size, right - left, bottom - top) * 1e-3 + 1e-6;
      const off = { x: (-span.y / size) * step, y: (span.x / size) * step };
      const outer =
        inParts({ x: middle.x + off.x, y: middle.y + off.y }) &&
        inParts({ x: middle.x - off.x, y: middle.y - off.y });
      if (!outer) edges.push([point, next]);
    });
  });

  const reach = (target: CeilingPoint): number =>
    edges.reduce((best, [from, to]) => {
      const span = { x: to.x - from.x, y: to.y - from.y };
      const size = span.x * span.x + span.y * span.y;
      const rate =
        size === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((target.x - from.x) * span.x + (target.y - from.y) * span.y) /
                  size,
              ),
            );
      const near = { x: from.x + span.x * rate, y: from.y + span.y * rate };
      return Math.min(best, Math.hypot(target.x - near.x, target.y - near.y));
    }, Infinity);

  const steps = 24;
  let best: CeilingPoint | null = null;
  let bestReach = -1;
  for (let ix = 1; ix < steps; ix += 1) {
    for (let iy = 1; iy < steps; iy += 1) {
      const target = {
        x: left + ((right - left) * ix) / steps,
        y: top + ((bottom - top) * iy) / steps,
      };
      if (!inParts(target)) continue;
      const here = reach(target);
      if (here > bestReach) {
        bestReach = here;
        best = target;
      }
    }
  }
  return best ?? fallback;
}

/** その点の下がり（下がり天井の下になっていれば、その中で一番大きい下がり） */
function dropAt(
  elements: CeilingElement[],
  solved: SolvedShape,
  roomCeilingHeight: number | null,
  target: CeilingPoint,
): { drop: number; waiting: string; elementIds: string[] } {
  const points = solved.points;
  let drop = 0;
  // 高さがまだ入っていない下がり天井。高さが決まるまで、その内と外は別の区画にする
  const waiting: string[] = [];
  // その区画を下げている下がり天井（壁に近い順）
  const covering: { id: string; offset: number }[] = [];
  elements.forEach((element) => {
    if (element.kind !== "dropCeiling") return;
    const index = solved.edges.findIndex((row) => row.id === element.edgeId);
    if (index < 0) return;
    const from = points[index];
    const normal = inwardNormal(points, index);
    const reach =
      (target.x - from.x) * normal.x + (target.y - from.y) * normal.y;
    // 下がり天井が下げているのは、その線より壁側（innerなら線の向こう側）
    const far = element.offset ?? 0;
    const lowered =
      element.inner === true ? reach > far - 1e-6 : reach <= far + 1e-6;
    if (!lowered) return;
    covering.push({ id: element.id, offset: far });
    const here = elementDrop(element, roomCeilingHeight);
    if (here === null) {
      waiting.push(element.id);
      return;
    }
    if (here > drop) drop = here;
  });
  return {
    drop: round2(drop),
    waiting: waiting.sort().join(","),
    elementIds: covering
      .sort((left, right) => left.offset - right.offset)
      .map((row) => row.id),
  };
}

/** その線が区画のふち（外周の辺）になっているか */
function onBoundary(poly: CeilingPoint[], line: CeilingSegment): boolean {
  const span = { x: line.b.x - line.a.x, y: line.b.y - line.a.y };
  const size = Math.hypot(span.x, span.y);
  if (size < 1e-9) return false;
  const dir = { x: span.x / size, y: span.y / size };
  return poly.some((point, no) => {
    const next = poly[(no + 1) % poly.length];
    const edge = { x: next.x - point.x, y: next.y - point.y };
    const length = Math.hypot(edge.x, edge.y);
    if (length < 1e-6) return false;
    if (Math.abs(cross(dir, { x: edge.x / length, y: edge.y / length })) > 1e-9)
      return false;
    // 同じ向きで、線の上に乗っているか
    const gap = { x: point.x - line.a.x, y: point.y - line.a.y };
    if (Math.abs(cross(dir, gap)) > 1e-6) return false;
    const from = gap.x * dir.x + gap.y * dir.y;
    const to = from + (edge.x * dir.x + edge.y * dir.y);
    return Math.min(from, to) < size - 1e-6 && Math.max(from, to) > 1e-6;
  });
}

/** 2つの区画が辺で接しているか（同じ直線の上で重なっているか） */
function touching(left: CeilingPoint[], right: CeilingPoint[]): boolean {
  return left.some((point, no) => {
    const next = left[(no + 1) % left.length];
    const span = { x: next.x - point.x, y: next.y - point.y };
    const size = Math.hypot(span.x, span.y);
    if (size < 1e-9) return false;
    const dir = { x: span.x / size, y: span.y / size };
    return right.some((other, index) => {
      const after = right[(index + 1) % right.length];
      const gap = { x: after.x - other.x, y: after.y - other.y };
      const length = Math.hypot(gap.x, gap.y);
      if (length < 1e-9) return false;
      if (Math.abs(cross(dir, { x: gap.x / length, y: gap.y / length })) > 1e-9)
        return false;
      if (
        Math.abs(cross(dir, { x: other.x - point.x, y: other.y - point.y })) >
        1e-6
      )
        return false;
      const alongOf = (mark: CeilingPoint): number =>
        (mark.x - point.x) * dir.x + (mark.y - point.y) * dir.y;
      const from = Math.max(0, Math.min(alongOf(other), alongOf(after)));
      const to = Math.min(size, Math.max(alongOf(other), alongOf(after)));
      return to - from > 1e-6;
    });
  });
}

/** その点から向きへ進んで壁に当たるまでの距離 */
export function insideDistance(
  points: CeilingPoint[],
  from: CeilingPoint,
  dir: CeilingPoint,
): number {
  let best = Infinity;
  points.forEach((point, no) => {
    const next = points[(no + 1) % points.length];
    const span = { x: next.x - point.x, y: next.y - point.y };
    const denom = cross(dir, span);
    if (Math.abs(denom) < 1e-9) return;
    const gap = { x: point.x - from.x, y: point.y - from.y };
    const u = cross(gap, dir) / denom;
    if (u < -1e-9 || u > 1 + 1e-9) return;
    const t = cross(gap, span) / denom;
    if (t > 1e-6 && t < best) best = t;
  });
  return best === Infinity ? 0 : best;
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
 * 梁型面積は仕上げる面。壁付き梁型は「長さ×（梁幅＋梁せい）」（梁底＋見付1面）、
 * 天井付梁型は「長さ×（梁幅＋梁せい×2）」（梁底＋見付2面）。
 * 下がり壁は見付「長さ×下がり高さ」。
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

  // 下がり天井・天井付梁型は壁や、自分より低くなる線のところで止まる
  const lines = ceilingLines(elements, solved, roomCeilingHeight);

  const items = elements.map((element) => {
    const crossing =
      element.kind === "dropCeiling" || element.kind === "ceilingBeam"
        ? (lines.find((line) => line.elementId === element.id) ?? null)
        : null;
    // 下がり天井・天井付梁型は、壁や自分より低い線で止めた実際の長さで数える
    const length =
      crossing?.length ?? element.length ?? edgeLength(solved, element.edgeId);
    // 梁型・下がり壁はＨ（梁せい）をそのまま下がりに使い、壁の高さは自動で決める
    const drop = elementDrop(element, roomCeilingHeight);
    const width = element.width ?? 0;
    let area: number | null = null;

    if (length !== null) {
      switch (element.kind) {
        case "wallBeam":
          totals.wallBeamLength += length;
          // 梁底＋見付1面
          if (element.width !== null)
            area = round2(length * (width + (drop ?? 0)));
          totals.wallBeamArea += area ?? 0;
          break;
        case "ceilingBeam":
          totals.ceilingBeamLength += length;
          // 梁底＋見付2面
          if (element.width !== null)
            area = round2(length * (width + (drop ?? 0) * 2));
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

    return { element, length, drop, area };
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
