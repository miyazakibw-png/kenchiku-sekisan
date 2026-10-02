/**
 * 耐火被覆・鉄骨塗装のリスト（階別リスト＝柱・梁／階共通リスト）。
 * Excelの柱リスト・梁リストと同じ形で、階をタテ・部材記号（C1・G1…）をヨコに並べる。
 */

/** 部材の形（□＝角形鋼管・コラム／Ｈ＝Ｈ鋼） */
export type SteelShape = "box" | "h";

/** リストの1マス（形＋寸法2つ）。柱は W・D、梁は H・W。空欄は下の階の数字を引き継ぐ */
export interface FireproofSize {
  /** 空文字はリストごとの初期値（柱＝□、梁・階共通＝Ｈ） */
  shape: SteelShape | "";
  /** 柱はＷ（コラムの幅／Ｈ鋼のウェブ高さ）、梁はＨ */
  first: number | null;
  /** 柱はＤ（コラムの見付／Ｈ鋼のフランジ幅）、梁はＷ */
  second: number | null;
}

/** 階（柱は最上階から1階へ、梁は最上段がＲ）。名前は書き換えられる */
export interface FireproofFloor {
  id: string;
  label: string;
  /** 手で足した行（中2階・塔屋など）。階数を直しても消さない */
  manual?: boolean;
}

/** 部材記号1つ分（画面ではヨコに「形・寸法・寸法」の3列） */
export interface FireproofMember {
  id: string;
  symbol: string;
  /** 階ID → その階の形・寸法 */
  sizes: Record<string, FireproofSize>;
}

/** 階別リスト（柱リスト・梁リスト） */
export interface FireproofFloorList {
  floors: FireproofFloor[];
  members: FireproofMember[];
}

/** 階共通リストの1行（階で分けない部材。Ｐ1・Ｂ1 など） */
export interface FireproofCommonRow {
  id: string;
  symbol: string;
  shape: SteelShape | "";
  first: number | null;
  second: number | null;
}

/** 耐火被覆・塗装積算入力のリスト一式（1工事に1つ） */
export interface FireproofSheet {
  /** 階数（ここを直すと階の行を作り直す。中2階・塔屋は行を足して入れる） */
  floorCount: number;
  columns: FireproofFloorList;
  beams: FireproofFloorList;
  common: FireproofCommonRow[];
}

export const EMPTY_SIZE: FireproofSize = {
  shape: "",
  first: null,
  second: null,
};

/** 保存したJSONを画面で使える形に整える（空・古い形でも止まらないようにする） */
export function normalizeFloorList(value: unknown): FireproofFloorList {
  const list = (value ?? {}) as Partial<FireproofFloorList>;
  return {
    floors: Array.isArray(list.floors)
      ? list.floors.map((floor) => ({
          id: floor.id ?? fireproofId("f"),
          label: floor.label ?? "",
          ...(floor.manual === true ? { manual: true } : {}),
        }))
      : [],
    members: Array.isArray(list.members)
      ? list.members.map((member) => ({
          id: member.id ?? fireproofId("m"),
          symbol: member.symbol ?? "",
          sizes: member.sizes ?? {},
        }))
      : [],
  };
}

export function normalizeCommonRows(value: unknown): FireproofCommonRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    id: row.id ?? fireproofId("c"),
    symbol: row.symbol ?? "",
    /* 階共通の形状の基本はＨ（空欄・古い形もＨとして入れておく） */
    shape: row.shape === "box" || row.shape === "h" ? row.shape : "h",
    first: row.first ?? null,
    second: row.second ?? null,
  }));
}

export function emptyFireproofSheet(): FireproofSheet {
  return {
    floorCount: 0,
    columns: { floors: [], members: [] },
    beams: { floors: [], members: [] },
    common: [],
  };
}

/** 柱リストの階名（上が最上階、下が1階） */
export function columnFloorLabels(floorCount: number): string[] {
  const labels: string[] = [];
  for (let floor = floorCount; floor >= 1; floor -= 1)
    labels.push(String(floor));
  return labels;
}

/** 梁リストの階名（柱より1つ上にずらし、一番上はＲ） */
export function beamFloorLabels(floorCount: number): string[] {
  if (floorCount <= 0) return [];
  return ["R", ...columnFloorLabels(floorCount).slice(0, floorCount - 1)];
}

let nextId = 0;

/** 画面で行・列を見分けるためのID（保存した中身の並びとは別） */
export function fireproofId(prefix: string): string {
  nextId += 1;
  return `${prefix}${Date.now().toString(36)}${nextId.toString(36)}`;
}

/**
 * 階数に合わせて階の行を作り直す。
 * 手で足した行（中2階・塔屋）は同じ場所に残し、自動の行だけ作り直す。
 */
export function applyFloorCount(
  list: FireproofFloorList,
  labels: string[],
): FireproofFloorList {
  const autoFloors = list.floors.filter((floor) => floor.manual !== true);
  const rebuilt = labels.map((label, index) => {
    const kept = autoFloors[index];
    return kept ? { ...kept, label } : { id: fireproofId("f"), label };
  });
  // 手で足した行をもとの位置へ戻す
  const floors = [...rebuilt];
  list.floors.forEach((floor, index) => {
    if (floor.manual !== true) return;
    floors.splice(Math.min(index, floors.length), 0, floor);
  });
  // 行が減ったときは、消える階の寸法も落とす
  const keep = new Set(floors.map((floor) => floor.id));
  const members = list.members.map((member) => ({
    ...member,
    sizes: Object.fromEntries(
      Object.entries(member.sizes).filter(([floorId]) => keep.has(floorId)),
    ),
  }));
  return { floors, members };
}

/** 空の部材記号（列）を作る */
export function newMember(symbol = ""): FireproofMember {
  return { id: fireproofId("m"), symbol, sizes: {} };
}

export function newCommonRow(symbol = ""): FireproofCommonRow {
  return {
    id: fireproofId("c"),
    symbol,
    shape: "h",
    first: null,
    second: null,
  };
}

/**
 * 全角の英数字・記号を半角に直す（リストは記号と寸法だけなので日本語変換は使わない）。
 */
export function toHalfWidth(text: string): string {
  return text.replace(/[！-～]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 1マスに打った寸法を読む（「250*125」＝Ｗ250・Ｄ125、「250」＝Ｗだけ）。
 * ＊・×・x・空白区切りも同じに読む。将来 Ｗ*Ｄ*Ｔ1*Ｔ2 と増やせるよう数字は全部返す。
 */
export function parseSizeInput(text: string): number[] {
  return toHalfWidth(text)
    .split(/[*＊xX×,、\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));
}

/** 1マスの寸法を「250*125」の形に戻す（打ち直しできるように） */
export function formatSizeInput(size: FireproofSize): string {
  if (size.first === null && size.second === null) return "";
  if (size.second === null) return String(size.first ?? "");
  return `${size.first ?? ""}*${size.second}`;
}

/** マスに打った文字を寸法に直す */
export function sizeFromInput(
  size: FireproofSize,
  text: string,
): FireproofSize {
  const numbers = parseSizeInput(text);
  return {
    ...size,
    first: numbers.length > 0 ? numbers[0] : null,
    second: numbers.length > 1 ? numbers[1] : null,
  };
}

export interface ResolvedSize {
  shape: SteelShape;
  first: number | null;
  second: number | null;
  /** 下の階から引き継いだ数字のときは true（画面で薄く出す） */
  inherited: boolean;
}

/**
 * 実際に使う寸法を求める。
 * ・空欄は「下にある階」の数字を上の階の数字として使う（柱＝Ｗ→Ｄ、梁＝Ｈ→Ｗの順）
 * ・□でもＷとＤが違う部材があるので、Ｄが空ならＨ鋼と同じく下の階の数字を使う
 */
export function resolveSize(
  member: FireproofMember,
  floors: readonly FireproofFloor[],
  index: number,
  kind: "column" | "beam",
): ResolvedSize {
  const defaultShape: SteelShape = kind === "column" ? "box" : "h";
  const own = member.sizes[floors[index]?.id ?? ""] ?? EMPTY_SIZE;
  /** 自分の階から下へ順に見て、最初に入っている値を使う */
  const below = (
    pick: (size: FireproofSize) => number | null,
  ): number | null => {
    for (let at = index; at < floors.length; at += 1) {
      const size = member.sizes[floors[at].id];
      const value = size ? pick(size) : null;
      if (value !== null) return value;
    }
    return null;
  };
  const shapeBelow = ((): SteelShape | "" => {
    for (let at = index; at < floors.length; at += 1) {
      const size = member.sizes[floors[at].id];
      if (size && size.shape !== "") return size.shape;
    }
    return "";
  })();
  const shape = shapeBelow === "" ? defaultShape : shapeBelow;
  const first = below((size) => size.first);
  const second = below((size) => size.second);
  const inherited =
    (own.first === null && first !== null) ||
    (own.second === null && second !== null);
  return { shape, first, second, inherited };
}

/** 階共通リストの寸法（引き継ぎは無い。形の初期はＨ） */
export function resolveCommonRow(row: FireproofCommonRow): ResolvedSize {
  const shape: SteelShape = row.shape === "" ? "h" : row.shape;
  return { shape, first: row.first, second: row.second, inherited: false };
}

export const SHAPE_LABEL: Record<SteelShape, string> = {
  box: "□",
  h: "Ｈ",
};
