/**
 * 建具記号を計算式へ入れるとき、部位ごとにどの数値を採るかの決まり。
 * 例：壁＝面積 <AW1>／巾木＝巾木減 <AW1:HL>／補強＝軸組横補強 <AW1:RF>
 */

/** 建具表のどの数値を採るか */
export type FittingValueKind =
  "area" | "baseboard" | "reinforcement" | "width" | "height";

/** 部位ごとの採用値 */
export interface FittingPartValue {
  /** 管理用部位の番号（同じ名前の部位が複数あっても取り違えない） */
  partId?: number | null;
  /** 部位名（セット先頭の部位欄と突き合わせる） */
  partName: string;
  kind: FittingValueKind;
}

/** 設定画面に出す採用値の名前 */
export const FITTING_VALUE_LABELS: { kind: FittingValueKind; label: string }[] =
  [
    { kind: "area", label: "面積" },
    { kind: "baseboard", label: "巾木減" },
    { kind: "reinforcement", label: "軸組横補強" },
    { kind: "width", label: "W（幅）" },
    { kind: "height", label: "H（高さ）" },
  ];

/** 初期の決まり（Excel積算の使い方に合わせる） */
export const DEFAULT_FITTING_PART_VALUES: FittingPartValue[] = [
  { partName: "壁", kind: "area" },
  { partName: "巾木", kind: "baseboard" },
  { partName: "補強", kind: "reinforcement" },
];

/** 計算式に書く記号の後ろに付ける文字（面積は付けない） */
export function fittingSuffix(kind: FittingValueKind): string {
  switch (kind) {
    case "baseboard":
      return ":HL";
    case "reinforcement":
      return ":RF";
    case "width":
      return ":W";
    case "height":
      return ":H";
    default:
      return "";
  }
}

/** 部位に当てはまる採用値を探す（番号→同じ名前→名前を含む→既定は面積） */
export function fittingKindForPart(
  partName: string,
  values: FittingPartValue[],
  partId?: number | null,
): FittingValueKind {
  if (partId !== null && partId !== undefined) {
    const byId = values.find((value) => value.partId === partId);
    if (byId) return byId.kind;
  }
  const name = partName.trim();
  if (name === "") return "area";
  const exact = values.find((value) => value.partName.trim() === name);
  if (exact) return exact.kind;
  const partial = values.find(
    (value) =>
      value.partName.trim() !== "" && name.includes(value.partName.trim()),
  );
  return partial ? partial.kind : "area";
}

/** 部位に合わせた建具記号（計算式へそのまま入れられる形）を作る */
export function fittingSymbolForPart(
  symbol: string,
  partName: string,
  values: FittingPartValue[],
  partId?: number | null,
): string {
  const kind = fittingKindForPart(partName, values, partId);
  return `<${symbol}${fittingSuffix(kind)}>`;
}

/** 保存されている値を読み込む（壊れた値は初期の決まりに戻す） */
export function parseFittingPartValues(text: string): FittingPartValue[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return DEFAULT_FITTING_PART_VALUES;
    const kinds = FITTING_VALUE_LABELS.map((item) => item.kind);
    const values: FittingPartValue[] = [];
    parsed.forEach((row) => {
      if (typeof row !== "object" || row === null) return;
      const record = row as Record<string, unknown>;
      const partName = record.partName;
      const kind = record.kind;
      const partId = record.partId;
      if (typeof partName !== "string" || typeof kind !== "string") return;
      if (!kinds.includes(kind as FittingValueKind)) return;
      values.push({
        partId: typeof partId === "number" ? partId : null,
        partName,
        kind: kind as FittingValueKind,
      });
    });
    return values;
  } catch {
    return DEFAULT_FITTING_PART_VALUES;
  }
}
