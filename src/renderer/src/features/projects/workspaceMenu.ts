/** 工事管理画面（積算操作：管理・移動・集計指示）のメニュー */
export interface WorkspaceMenuItem {
  key: string;
  label: string;
  /** 画面上の区分け */
  group: "master" | "input" | "aggregate" | "output";
  note: string;
  ready: boolean;
}

export const WORKSPACE_MENU: WorkspaceMenuItem[] = [
  {
    key: "subjects",
    label: "科目マスター",
    group: "master",
    note: "この物件専用の工種科目。基準マスターの複製を自由に直せる",
    ready: true,
  },
  {
    key: "basicMasters",
    label: "基準マスター",
    group: "master",
    note: "この物件専用の部位（明細用・管理用）・材種区分・単位・型枠分類",
    ready: true,
  },
  {
    key: "details",
    label: "明細マスター",
    group: "master",
    note: "この物件専用の複製。最初の入力に使う。修正は大元へ同期できる",
    ready: true,
  },
  {
    key: "assemblies",
    label: "セット明細表示",
    group: "master",
    note: "この物件専用の仕上明細セット。計算書でまとめて呼び出せる",
    ready: true,
  },
  {
    key: "fittings",
    label: "建具入力",
    group: "input",
    note: "建具表（W・H・腰高から面積／巾木減／軸組横補強を算出）",
    ready: true,
  },
  {
    key: "roomFinishes",
    label: "部位別入力表",
    group: "input",
    note: "メイン積算の管理画面（部位Ⅰ〜Ⅲ・天井高さ・倍率・計算書の書式指定）",
    ready: true,
  },
  {
    key: "transferInput",
    label: "転記入力表",
    group: "input",
    note: "集計書へ直接集計。1明細で複数行の仕様書きが可能。根拠集計・セット明細には登録しない",
    ready: true,
  },
  {
    key: "aggregate",
    label: "集計処理",
    group: "aggregate",
    note: "科目集計＋根拠展開はまとめて実行。部位別集計は独立",
    ready: true,
  },
  {
    key: "projectMaster",
    label: "集計書兼工事マスター",
    group: "aggregate",
    note: "物件専用明細マスター（集計数量も表示）。削除不可・計上不要明細は科目末尾へ",
    ready: true,
  },
  {
    key: "roomAggregate",
    label: "部屋別集計",
    group: "aggregate",
    note: "部位Ⅲの名称を工種科目代わりに集計（明細は科目順に並べる）",
    ready: true,
  },
  {
    key: "formworkTransfer",
    label: "型枠転記",
    group: "aggregate",
    note: "集計書兼工事マスターの明細を選び、型枠明細を算出して転記入力表へ自動転記",
    ready: true,
  },
  {
    key: "changeHistory",
    label: "明細マスター変更履歴",
    group: "aggregate",
    note: "この工事の明細マスターを直した記録。修正前と修正後を続けて表示する",
    ready: true,
  },
  {
    key: "statement",
    label: "内訳書",
    group: "output",
    note: "集計書兼工事マスターからの転記（書式・表示の設定もこの画面の「設定」から）",
    ready: true,
  },
  {
    key: "finishCheck",
    label: "チェック表",
    group: "output",
    note: "集計書兼工事マスターから材種区分別に抜き出した部位別チェック（Excel貼り付け可）",
    ready: true,
  },
  {
    key: "print",
    label: "印刷",
    group: "output",
    note: "各画面の右上「🖨 印刷／📄 PDF／📊 Excel」から、A3横1枚の幅で出せます",
    ready: false,
  },
];

export const MENU_GROUP_LABEL: Record<WorkspaceMenuItem["group"], string> = {
  master: "物件専用マスター",
  input: "積算入力",
  aggregate: "集計",
  output: "内訳書・出力",
};

const HIDDEN_KEY = "project.workspace.hiddenFields";

/** 管理番号・工事名称は常に表示する標準項目。それ以外は表示/非表示を切り替えられる */
export const ALWAYS_VISIBLE = ["managementNo", "name"];

export function loadHiddenFields(): string[] {
  const raw = localStorage.getItem(HIDDEN_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed)
    ? parsed.filter((key): key is string => typeof key === "string")
    : [];
}

export function saveHiddenFields(keys: string[]): void {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(keys));
}

export function toggleHiddenField(hidden: string[], key: string): string[] {
  if (ALWAYS_VISIBLE.includes(key)) return hidden;
  return hidden.includes(key)
    ? hidden.filter((item) => item !== key)
    : [...hidden, key];
}
