/**
 * 軸組計算書の計算。
 *
 * 部屋計算書で作った部屋（平面図）を建物レイアウトとして並べ、その壁を軸組ラインとして拾う。
 * 部屋の壁は表面の壁なので、施工高さ（軸組の高さ）は軸組側で持ち、1か所直すと全体が再計算される。
 * 数量根拠を追えるように、軸組ラインは「部屋 → 壁 → 軸組ライン → 数量」の関係を保持する。
 */

import {
  round2,
  solveShape,
  type RoomShape,
  type SolvedShape,
} from "../room/shape";

/** レイアウトに置いた部屋（部屋計算書1つ＝1オブジェクト） */
export interface FramePlacement {
  id: string;
  /** 元の部屋（部位別入力表の行）。数量根拠の追跡に使う */
  estimateRowId: number;
  /** 部位Ⅱ＋半角スペース＋部位Ⅲ */
  roomName: string;
  /** 配置位置（m） */
  x: number;
  y: number;
  /** 輪郭の色（計算には使わないが見分けに使う） */
  color: string;
}

/** レイアウトを使わずに直接引いた軸組ライン（始点クリック→終点クリック） */
export interface FrameManualLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 軸組計算書の下敷きにする図面画像（なぞって線を引くために置く） */
export interface FrameTrace {
  /** 画像（データURL） */
  image: string;
  /** 画像1画素あたりの実寸（m） */
  metersPerPixel: number;
  /** 画像の左上を置く位置（m） */
  x: number;
  y: number;
}

export const EMPTY_FRAME_TRACE: FrameTrace = {
  image: "",
  metersPerPixel: 0,
  x: 0,
  y: 0,
};

/**
 * 軸組種類（引いた線の色分け。普通は5種類ほどだが、特殊な場合に備えて10種類まで持てる）。
 * たて・よこ（X・Y）に関係なく、この種類ごとにまとめて拾う。
 */
export interface FrameKind {
  id: string;
  name: string;
  /** 図の線の色 */
  color: string;
}

const FRAME_KIND_COLORS = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#0f766e",
  "#b45309",
];

/** 軸組種類の初期値（10種類。名前は後から直せる） */
export function defaultFrameKinds(): FrameKind[] {
  return FRAME_KIND_COLORS.map((color, index) => ({
    id: `k${index + 1}`,
    name: `種類${index + 1}`,
    color,
  }));
}

/** 軸組ラインごとの指定（拾う／拾わない・壁種・サイズ種類・施工高さ） */
export interface FrameLineAttribute {
  /** 軸組種類（色分けとまとめの単位。空欄は種類なし） */
  kindId: string;
  wallKind: string;
  sizeKind: string;
  /** 空欄なら軸組全体の施工高さを使う */
  workHeight: number | null;
  /** 拾う（外周など拾わない線はfalse） */
  pickup: boolean;
  /** 壁を共有した相手のラインID。共有された側は1本として拾わない */
  sharedWithId: string | null;
  note: string;
}

export function frameLineAttribute(
  patch: Partial<FrameLineAttribute> = {},
): FrameLineAttribute {
  return {
    kindId: "",
    wallKind: "",
    sizeKind: "",
    workHeight: null,
    pickup: true,
    sharedWithId: null,
    note: "",
    ...patch,
  };
}

export interface FrameLine extends FrameLineAttribute {
  id: string;
  /** room: 部屋の壁から作った線 / manual: 直接引いた線 */
  source: "room" | "manual";
  placementId: string | null;
  estimateRowId: number | null;
  roomName: string;
  /** 元の壁（部屋形状の辺）のID。数量根拠の追跡に使う */
  edgeId: string | null;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  /** 外周（建物の外側）の線。既定では拾わない */
  perimeter: boolean;
}

/** 軸組で拾う建具（開口の差し引きと開口部補強に使う） */
export interface FrameFitting {
  id: string;
  symbol: string;
  /** 同じ建具の数 */
  multiplier: number;
  /** どの軸組ラインの建具か（未指定は合計からだけ差し引く） */
  lineId: string | null;
  /** 建具表から引用した値 */
  area: number | null;
  width: number | null;
  sillHeight: number | null;
  baseboardDeduction: number | null;
}

/**
 * 開口部補強（横補強）の種類。
 * door: FL付の建具（ドア類）／window: FLから浮く窓類／mixed: 窓＋ドアなど□以外の形
 */
export type ReinforcementKind = "door" | "window" | "mixed";

/** 建具の値から補強の種類を自動判別する */
export function reinforcementKind(fitting: {
  sillHeight: number | null;
  width: number | null;
  baseboardDeduction: number | null;
}): ReinforcementKind {
  const sill = fitting.sillHeight ?? 0;
  const width = fitting.width;
  const base = fitting.baseboardDeduction;
  if (
    sill > 0 &&
    width !== null &&
    base !== null &&
    round2(base) !== round2(width)
  ) {
    return "mixed";
  }
  return sill > 0 ? "window" : "door";
}

/**
 * 開口部横補強の長さ。
 * 1 ドア類　　　　：建具上部W ＋ 施工高さ*2
 * 2 窓類　　　　　：建具上下部W（W*2） ＋ 施工高さ*2
 * 3 窓＋ドア等　　：W*2 − 巾木差し引き ＋ 施工高さ*2 ＋ 腰壁までの高さ*2
 */
export function reinforcementLength(
  fitting: {
    width: number | null;
    sillHeight: number | null;
    baseboardDeduction: number | null;
  },
  workHeight: number | null,
): number | null {
  if (fitting.width === null) return null;
  const height = workHeight ?? 0;
  const width = fitting.width;
  switch (reinforcementKind(fitting)) {
    case "door":
      return round2(width + height * 2);
    case "window":
      return round2(width * 2 + height * 2);
    default:
      return round2(
        width * 2 -
          (fitting.baseboardDeduction ?? 0) +
          height * 2 +
          (fitting.sillHeight ?? 0) * 2,
      );
  }
}

const SNAP_TOLERANCE = 0.001;

function sameValue(a: number, b: number, tolerance = SNAP_TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** 部屋形状（保存済みJSON）を解いて図形にする */
export function solveRoomShape(shape: RoomShape): SolvedShape {
  return solveShape(shape);
}

export interface BuildLinesInput {
  placements: FramePlacement[];
  /** 部屋（部位別入力表の行ID）ごとの平面図 */
  shapes: Map<number, SolvedShape>;
  manualLines: FrameManualLine[];
  /** ラインIDごとの指定 */
  attributes: Record<string, FrameLineAttribute>;
}

/** 部屋の壁から作る軸組ラインのID（部屋を置き直しても同じIDになるようにする） */
export function roomLineId(placementId: string, edgeId: string): string {
  return `${placementId}/${edgeId}`;
}

/**
 * レイアウトから軸組ラインの一覧を作る。
 * 部屋の壁（開口・柱は除く）を線にし、直接引いた線を足す。外周の線には印を付ける。
 */
export function buildFrameLines(input: BuildLinesInput): FrameLine[] {
  const lines: FrameLine[] = [];

  input.placements.forEach((placement) => {
    const solved = input.shapes.get(placement.estimateRowId);
    if (!solved || solved.points.length === 0) return;
    solved.edges.forEach((edge, index) => {
      if (edge.kind !== "wall" || edge.resolved === null) return;
      const from = solved.points[index];
      const to = solved.points[(index + 1) % solved.points.length];
      const id = roomLineId(placement.id, edge.id);
      lines.push({
        ...frameLineAttribute(input.attributes[id]),
        id,
        source: "room",
        placementId: placement.id,
        estimateRowId: placement.estimateRowId,
        roomName: placement.roomName,
        edgeId: edge.id,
        label: `${placement.roomName} 壁${index + 1}`,
        x1: round2(from.x + placement.x),
        y1: round2(from.y + placement.y),
        x2: round2(to.x + placement.x),
        y2: round2(to.y + placement.y),
        length: round2(edge.resolved),
        perimeter: false,
      });
    });
  });

  // 自分で引いた線は、たてを Y1・Y2…、よこを X1・X2… と呼ぶ
  let verticalCount = 0;
  let horizontalCount = 0;
  input.manualLines.forEach((line) => {
    const vertical = Math.abs(line.y2 - line.y1) >= Math.abs(line.x2 - line.x1);
    if (vertical) verticalCount += 1;
    else horizontalCount += 1;
    lines.push({
      ...frameLineAttribute(input.attributes[line.id]),
      id: line.id,
      source: "manual",
      placementId: null,
      estimateRowId: null,
      roomName: "",
      edgeId: null,
      label: vertical ? `Y${verticalCount}` : `X${horizontalCount}`,
      x1: line.x1,
      y1: line.y1,
      x2: line.x2,
      y2: line.y2,
      length: round2(Math.hypot(line.x2 - line.x1, line.y2 - line.y1)),
      perimeter: false,
    });
  });

  return markPerimeter(lines);
}

/** 全体の外形に乗っている線に印を付ける（外周は軸組として拾わないことが多い） */
export function markPerimeter(lines: FrameLine[]): FrameLine[] {
  if (lines.length === 0) return lines;
  const xs = lines.flatMap((line) => [line.x1, line.x2]);
  const ys = lines.flatMap((line) => [line.y1, line.y2]);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return lines.map((line) => {
    const onVertical =
      sameValue(line.x1, line.x2) &&
      (sameValue(line.x1, left) || sameValue(line.x1, right));
    const onHorizontal =
      sameValue(line.y1, line.y2) &&
      (sameValue(line.y1, top) || sameValue(line.y1, bottom));
    return { ...line, perimeter: onVertical || onHorizontal };
  });
}

export interface SharedWallPair {
  /** 残す側（この線で1本として拾う） */
  keepId: string;
  /** 共有される側（拾わない） */
  dropId: string;
  /** 重なっている長さ */
  length: number;
}

/** 別の部屋どうしで重なっている壁（共有できる壁）を探す */
export function findSharedWalls(lines: FrameLine[]): SharedWallPair[] {
  const pairs: SharedWallPair[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i];
      const b = lines[j];
      if (a.placementId !== null && a.placementId === b.placementId) continue;
      const overlap = overlapLength(a, b);
      if (overlap === null || overlap <= 0) continue;
      pairs.push({ keepId: a.id, dropId: b.id, length: round2(overlap) });
    }
  }
  return pairs;
}

/** 同じ直線上で重なっている長さ（重なりが無ければ null） */
export function overlapLength(a: FrameLine, b: FrameLine): number | null {
  const aVertical = sameValue(a.x1, a.x2);
  const bVertical = sameValue(b.x1, b.x2);
  if (aVertical !== bVertical) return null;
  if (aVertical) {
    if (!sameValue(a.x1, b.x1)) return null;
    return rangeOverlap(a.y1, a.y2, b.y1, b.y2);
  }
  if (!sameValue(a.y1, b.y1)) return null;
  return rangeOverlap(a.x1, a.x2, b.x1, b.x2);
}

function rangeOverlap(
  a1: number,
  a2: number,
  b1: number,
  b2: number,
): number | null {
  const low = Math.max(Math.min(a1, a2), Math.min(b1, b2));
  const high = Math.min(Math.max(a1, a2), Math.max(b1, b2));
  const length = high - low;
  return length > SNAP_TOLERANCE ? length : null;
}

/** 同じ壁のはずなのに少しずれている組（人が見て直すために出す） */
export interface WallGap {
  /** 基準にした側（面積の大きい部屋の壁） */
  aId: string;
  /** ずれている側 */
  bId: string;
  /** ずれている側の部屋名 */
  roomName: string;
  /** ずれ（m） */
  gap: number;
}

/**
 * 別の部屋どうしで、同じ向き・向かい合っているのに少しずれている壁を拾う。
 * 部屋ごとに寸法を測るので、大きい部屋と小さい部屋で同じ壁の長さが食い違うことがある。
 * ずれが tolerance 以内のものだけ「同じ壁のはず」とみて返す（0 は一致なので返さない）。
 */
export function nearMissWalls(
  lines: FrameLine[],
  tolerance: number,
  areas: Map<string, number> = new Map(),
): WallGap[] {
  const gaps: WallGap[] = [];
  /** 面積が大きい部屋の壁を正（基準）とする */
  const area = (line: FrameLine): number =>
    line.placementId === null ? 0 : (areas.get(line.placementId) ?? 0);
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i];
      const b = lines[j];
      if (a.placementId !== null && a.placementId === b.placementId) continue;
      const aVertical = sameValue(a.x1, a.x2);
      if (aVertical !== sameValue(b.x1, b.x2)) continue;
      const offset = aVertical ? Math.abs(a.x1 - b.x1) : Math.abs(a.y1 - b.y1);
      if (offset <= SNAP_TOLERANCE || offset > tolerance) continue;
      const along = aVertical
        ? rangeOverlap(a.y1, a.y2, b.y1, b.y2)
        : rangeOverlap(a.x1, a.x2, b.x1, b.x2);
      if (along === null) continue;
      const base = area(a) >= area(b) ? a : b;
      const off = base === a ? b : a;
      gaps.push({
        aId: base.id,
        bId: off.id,
        roomName: off.roomName,
        gap: round2(offset),
      });
    }
  }
  return gaps;
}

/**
 * 部屋を近付けたときに壁位置を合わせる（吸着）。
 * 置こうとしている位置から、他の部屋の壁の座標に近ければその座標へ寄せる。
 */
export function snapPlacement(
  moving: { x: number; y: number; solved: SolvedShape },
  others: FrameLine[],
  tolerance = 0.3,
): { x: number; y: number } {
  if (moving.solved.points.length === 0) return { x: moving.x, y: moving.y };
  const xs = moving.solved.points.map((point) => point.x + moving.x);
  const ys = moving.solved.points.map((point) => point.y + moving.y);
  const targetXs = others.flatMap((line) => [line.x1, line.x2]);
  const targetYs = others.flatMap((line) => [line.y1, line.y2]);

  // 点と点（角どうし）が近ければ、その角がぴったり重なるように寄せる
  const corners = moving.solved.points.map((point) => ({
    x: point.x + moving.x,
    y: point.y + moving.y,
  }));
  const targetCorners = others.flatMap((line) => [
    { x: line.x1, y: line.y1 },
    { x: line.x2, y: line.y2 },
  ]);
  let cornerShift: { x: number; y: number } | null = null;
  let cornerDistance = tolerance;
  corners.forEach((corner) => {
    targetCorners.forEach((target) => {
      const distance = Math.hypot(target.x - corner.x, target.y - corner.y);
      if (distance < cornerDistance) {
        cornerDistance = distance;
        cornerShift = { x: target.x - corner.x, y: target.y - corner.y };
      }
    });
  });
  if (cornerShift !== null) {
    const shift: { x: number; y: number } = cornerShift;
    return {
      x: round2(moving.x + shift.x),
      y: round2(moving.y + shift.y),
    };
  }

  const shift = (values: number[], targets: number[]): number => {
    let best = 0;
    let bestDistance = tolerance;
    values.forEach((value) => {
      targets.forEach((target) => {
        const distance = Math.abs(target - value);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = target - value;
        }
      });
    });
    return best;
  };

  return {
    x: round2(moving.x + shift(xs, targetXs)),
    y: round2(moving.y + shift(ys, targetYs)),
  };
}

export interface FrameLineResult {
  line: FrameLine;
  /** 使う施工高さ */
  height: number | null;
  /** 差し引く建具面積 */
  fittingArea: number;
  /** 軸組面積（長さ×施工高さ−建具面積） */
  area: number | null;
  /** この線に付く建具の開口補強長さ */
  reinforcement: number;
}

export interface FrameQuantities {
  lines: FrameLineResult[];
  /** AL 拾う軸組の長さ合計 */
  length: number;
  /** AA 拾う軸組の面積合計（建具面積を差し引いたもの） */
  area: number;
  /** DA 差し引いた建具面積 */
  fittingArea: number;
  /** RF 開口部補強の合計 */
  reinforcement: number;
  /** 壁種ごとの長さ・面積 */
  byWallKind: { wallKind: string; length: number; area: number }[];
  /** 軸組種類ごとの長さ・面積・補強（たて・よこをまとめて数える） */
  byKind: {
    kindId: string;
    length: number;
    area: number;
    reinforcement: number;
  }[];
}

/** 拾う線かどうか（外周・共有された側・拾わない指定は数量に入れない） */
export function isPickedUp(line: FrameLine): boolean {
  return line.pickup && line.sharedWithId === null;
}

export function frameQuantities(
  lines: FrameLine[],
  fittings: FrameFitting[],
  workHeight: number | null,
): FrameQuantities {
  const results: FrameLineResult[] = lines.map((line) => {
    const height = line.workHeight ?? workHeight;
    const onLine = fittings.filter((fitting) => fitting.lineId === line.id);
    const fittingArea = round2(
      onLine.reduce(
        (sum, fitting) => sum + (fitting.area ?? 0) * fitting.multiplier,
        0,
      ),
    );
    const reinforcement = round2(
      onLine.reduce(
        (sum, fitting) =>
          sum +
          (reinforcementLength(fitting, height) ?? 0) * fitting.multiplier,
        0,
      ),
    );
    return {
      line,
      height,
      fittingArea,
      area: height === null ? null : round2(line.length * height - fittingArea),
      reinforcement,
    };
  });

  const picked = results.filter((result) => isPickedUp(result.line));
  const length = round2(
    picked.reduce((sum, result) => sum + result.line.length, 0),
  );
  const area = round2(
    picked.reduce((sum, result) => sum + (result.area ?? 0), 0),
  );
  const fittingArea = round2(
    picked.reduce((sum, result) => sum + result.fittingArea, 0),
  );
  // 線に付けていない建具（合計からだけ差し引く／補強だけ拾う）も足す
  const looseFittings = fittings.filter((fitting) => fitting.lineId === null);
  const looseArea = round2(
    looseFittings.reduce(
      (sum, fitting) => sum + (fitting.area ?? 0) * fitting.multiplier,
      0,
    ),
  );
  const reinforcement = round2(
    picked.reduce((sum, result) => sum + result.reinforcement, 0) +
      looseFittings.reduce(
        (sum, fitting) =>
          sum +
          (reinforcementLength(fitting, workHeight) ?? 0) * fitting.multiplier,
        0,
      ),
  );

  const kinds = new Map<string, { length: number; area: number }>();
  picked.forEach((result) => {
    const key = result.line.wallKind.trim();
    if (key === "") return;
    const current = kinds.get(key) ?? { length: 0, area: 0 };
    kinds.set(key, {
      length: round2(current.length + result.line.length),
      area: round2(current.area + (result.area ?? 0)),
    });
  });

  const kindTotals = new Map<
    string,
    { length: number; area: number; reinforcement: number }
  >();
  picked.forEach((result) => {
    const key = result.line.kindId;
    if (key === "") return;
    const current = kindTotals.get(key) ?? {
      length: 0,
      area: 0,
      reinforcement: 0,
    };
    kindTotals.set(key, {
      length: round2(current.length + result.line.length),
      area: round2(current.area + (result.area ?? 0)),
      reinforcement: round2(current.reinforcement + result.reinforcement),
    });
  });

  return {
    lines: results,
    length,
    area: round2(area - looseArea),
    fittingArea: round2(fittingArea + looseArea),
    reinforcement,
    byWallKind: [...kinds.entries()].map(([wallKind, value]) => ({
      wallKind,
      ...value,
    })),
    byKind: [...kindTotals.entries()].map(([kindId, value]) => ({
      kindId,
      ...value,
    })),
  };
}

export interface FrameSymbol {
  symbol: string;
  label: string;
  value: number | null;
  /** 元になった軸組ライン（数量根拠の追跡用） */
  lineId?: string;
}

/** 計算式で使う記号表（合計＋ラインごと） */
export function frameSymbols(
  quantities: FrameQuantities,
  workHeight: number | null,
  kinds: FrameKind[] = [],
): FrameSymbol[] {
  const symbols: FrameSymbol[] = [
    { symbol: "AH", label: "施工高さ", value: workHeight },
    { symbol: "AL", label: "軸組長さ", value: quantities.length },
    { symbol: "AA", label: "軸組面積", value: quantities.area },
    { symbol: "DA", label: "建具面積（減）", value: quantities.fittingArea },
    { symbol: "RF", label: "開口補強", value: quantities.reinforcement },
  ];
  // 軸組種類ごとの合計（たて・よこをまとめたもの）
  kinds.forEach((kind, no) => {
    const total = quantities.byKind.find((row) => row.kindId === kind.id);
    if (total === undefined) return;
    symbols.push({
      symbol: `ALK${no + 1}`,
      label: `${kind.name} 長さ`,
      value: total.length,
    });
    symbols.push({
      symbol: `AAK${no + 1}`,
      label: `${kind.name} 面積`,
      value: total.area,
    });
    symbols.push({
      symbol: `RFK${no + 1}`,
      label: `${kind.name} 補強`,
      value: total.reinforcement,
    });
    // 種類ごとの合計は WS1〜WS10（面積）・WSL◯（長さ）・WSR◯（補強）でも使える
    symbols.push({
      symbol: `WS${no + 1}`,
      label: `${kind.name} 面積計`,
      value: total.area,
    });
    symbols.push({
      symbol: `WSL${no + 1}`,
      label: `${kind.name} 長さ計`,
      value: total.length,
    });
    symbols.push({
      symbol: `WSR${no + 1}`,
      label: `${kind.name} 補強計`,
      value: total.reinforcement,
    });
  });
  let index = 0;
  quantities.lines.forEach((result) => {
    if (!isPickedUp(result.line)) return;
    index += 1;
    symbols.push({
      symbol: `AL${index}`,
      label: `${result.line.label} 長さ`,
      value: result.line.length,
      lineId: result.line.id,
    });
    symbols.push({
      symbol: `AA${index}`,
      label: `${result.line.label} 面積`,
      value: result.area,
      lineId: result.line.id,
    });
  });
  // 自分で引いた線は X1・Y1 の記号でも使える（部位が補強のときは <X1> で補強長さ）
  quantities.lines.forEach((result) => {
    if (result.line.source !== "manual") return;
    const name = result.line.label;
    symbols.push({
      symbol: `<${name}>`,
      label: `${name} 面積（部位が補強なら補強）`,
      value: result.area,
      lineId: result.line.id,
    });
    symbols.push({
      symbol: `<${name}:AL>`,
      label: `${name} 長さ`,
      value: result.line.length,
      lineId: result.line.id,
    });
    symbols.push({
      symbol: `<${name}:AA>`,
      label: `${name} 面積`,
      value: result.area,
      lineId: result.line.id,
    });
    symbols.push({
      symbol: `<${name}:RF>`,
      label: `${name} 補強`,
      value: result.reinforcement,
      lineId: result.line.id,
    });
  });
  return symbols;
}

/** 部位が「補強」のセットでは、<X1> などの記号で補強長さを採る */
export function linePartVariables(
  symbols: FrameSymbol[],
  partName: string,
): Record<string, number> {
  if (!partName.includes("補強")) return {};
  const values: Record<string, number> = {};
  symbols.forEach((item) => {
    if (item.value === null) return;
    const matched = /^<(.+):RF>$/.exec(item.symbol);
    if (!matched) return;
    values[`<${matched[1]}>`] = item.value;
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(matched[1]))
      values[matched[1]] = item.value;
  });
  return values;
}
