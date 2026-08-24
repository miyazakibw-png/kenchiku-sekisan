import type { ProjectField } from "@shared/types";

/** 物件台帳の1列。fixed の列（日付・管理番号・工事名称）は必ず先頭に出す */
export interface LedgerColumn {
  key: string;
  title: string;
  fixed: boolean;
  /** ユーザー定義列のときだけ入る */
  fieldId?: number;
}

/** 表示するかどうかと並び順（この端末に記憶する） */
export interface LedgerColumnSetting {
  key: string;
  visible: boolean;
}

export const FIXED_COLUMNS: LedgerColumn[] = [
  { key: "projectDate", title: "日付", fixed: true },
  { key: "managementNo", title: "管理番号", fixed: true },
  { key: "name", title: "工事名称", fixed: true },
];

const OPTIONAL_COLUMNS: LedgerColumn[] = [
  { key: "builderName", title: "建設会社", fixed: false },
  { key: "designerName", title: "設計事務所", fixed: false },
  { key: "note", title: "備考", fixed: false },
];

/** 台帳に出しうる列を、固定列＋標準列＋ユーザー定義列の順に並べる */
export function allLedgerColumns(fields: ProjectField[]): LedgerColumn[] {
  return [
    ...FIXED_COLUMNS,
    ...OPTIONAL_COLUMNS,
    ...fields.map((field) => ({
      key: `field:${field.id}`,
      title: field.title,
      fixed: false,
      fieldId: field.id,
    })),
  ];
}

/**
 * 記憶した設定（並び順・表示／非表示）を当てはめる。
 * 記憶に無い列は末尾に表示ありで足し、無くなった列は捨てる。
 */
export function applyColumnSettings(
  columns: LedgerColumn[],
  settings: LedgerColumnSetting[],
): LedgerColumn[] {
  const fixed = columns.filter((column) => column.fixed);
  const optional = columns.filter((column) => !column.fixed);
  const ordered: LedgerColumn[] = [];
  for (const setting of settings) {
    const column = optional.find((item) => item.key === setting.key);
    if (column && !ordered.includes(column) && setting.visible)
      ordered.push(column);
  }
  const known = new Set(settings.map((setting) => setting.key));
  for (const column of optional) {
    if (!known.has(column.key)) ordered.push(column);
  }
  return [...fixed, ...ordered];
}

/** 設定画面で使う一覧（非表示の列も並び順つきで返す） */
export function optionalColumnSettings(
  columns: LedgerColumn[],
  settings: LedgerColumnSetting[],
): LedgerColumnSetting[] {
  const optional = columns.filter((column) => !column.fixed);
  const result: LedgerColumnSetting[] = [];
  for (const setting of settings) {
    if (optional.some((column) => column.key === setting.key))
      result.push({ ...setting });
  }
  const known = new Set(result.map((setting) => setting.key));
  for (const column of optional) {
    if (!known.has(column.key)) result.push({ key: column.key, visible: true });
  }
  return result;
}

/** 一覧の並べ替え（上下移動） */
export function moveSetting(
  settings: LedgerColumnSetting[],
  from: number,
  to: number,
): LedgerColumnSetting[] {
  if (to < 0 || to >= settings.length || from === to) return settings;
  const next = [...settings];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const STORAGE_KEY = "project-ledger-columns-v1";

export function loadColumnSettings(): LedgerColumnSetting[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as LedgerColumnSetting).key === "string" &&
      typeof (item as LedgerColumnSetting).visible === "boolean"
        ? [
            {
              key: (item as LedgerColumnSetting).key,
              visible: (item as LedgerColumnSetting).visible,
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

export function saveColumnSettings(settings: LedgerColumnSetting[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const WIDTH_KEY = "project-ledger-widths-v1";

export function loadColumnWidths(): Record<string, number> {
  const raw = window.localStorage.getItem(WIDTH_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && value >= 40) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveColumnWidths(widths: Record<string, number>): void {
  window.localStorage.setItem(WIDTH_KEY, JSON.stringify(widths));
}
