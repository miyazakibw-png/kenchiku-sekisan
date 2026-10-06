/**
 * 鉄骨伏図（耐火被覆・塗装積算入力の図面）1階分の中身。
 * 柱線寸法線 → 交点の柱 → 柱間の大梁 を「番号に記号を入れる」だけで描く作り。
 */

export interface FireproofDrawingFloor {
  /** X軸方向の柱線寸法（mm）。例 [7300, 7650, 7300] */
  xSpans: number[];
  /** Y軸方向の柱線寸法（mm）。例 [7350, 6650] */
  ySpans: number[];
  /** 交点ごとの柱記号。キー "xi,yi"（x軸xi番目・y軸yi番目の交点）→ "C1" など */
  columns: Record<string, string>;
  /** 柱間区間ごとの大梁記号。キー "x:xi,yi"（xi,yiの交点から右へ1区間）・"y:xi,yi"（下へ1区間）→ "G1" など */
  girders: Record<string, string>;
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

/** X軸の柱線につける通し番号（①②③…。数は柱線＝寸法+1本） */
export function xGridLabel(index: number): string {
  const circled = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  return index < circled.length ? circled[index] : `(${index + 1})`;
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
