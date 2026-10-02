import {
  ledgerKeyForWorkspace,
  loadColumnSettings,
  saveColumnSettings,
} from "./ledgerColumns";

/** 工事管理画面（積算操作：管理・移動・集計指示）のメニュー */
export interface WorkspaceMenuItem {
  key: string;
  label: string;
  /** 画面上の区分け */
  group: "master" | "fireproof" | "input" | "aggregate" | "output";
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
    key: "fireproofList",
    label: "鉄骨リスト",
    group: "fireproof",
    note: "階別リスト（柱・梁）と階共通リストを1つの画面で入力（階数を入れると行ができます）",
    ready: true,
  },
  {
    key: "fireproofEstimate",
    label: "耐火被覆・塗装入力表",
    group: "fireproof",
    note: "入力管理表（1行＝1明細）と柱入力表（鉄骨リストの寸法から必要数㎡を出す）",
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
    key: "miscInput",
    label: "部位別雑・金物入力表",
    group: "input",
    note: "明細をタテ1列、部屋をヨコ1行に並べて拾う表（その部屋の計算書に入れたのと同じ扱いで集計）",
    ready: true,
  },
  {
    key: "furnitureInput",
    label: "家具・設備入力表",
    group: "input",
    note: "システム収納などの家具計算書（入力欄から明細欄を自動で作り、建具表へも転記）",
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
    key: "printCalcAll",
    label: "計算書一括印刷",
    group: "input",
    note: "部位別入力表を表紙に付けて、部屋別・軸組・汎用の計算書を全部A3横で印刷",
    ready: true,
  },
  {
    key: "printCalcSelect",
    label: "部屋別計算書印刷",
    group: "input",
    note: "部位別入力表からチェックを付けた計算書だけをA3横で印刷（複数可）",
    ready: true,
  },
  {
    key: "printAggregate",
    label: "集計書印刷",
    group: "input",
    note: "1明細ごとに数量根拠（部屋ごとの拾い）を付けてA4横で印刷",
    ready: true,
  },
  {
    key: "projectMaster",
    label: "集計書兼工事マスター",
    group: "aggregate",
    note: "物件専用明細マスター（集計数量も表示）。ここで集計実行もできます",
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
];

export const MENU_GROUP_LABEL: Record<WorkspaceMenuItem["group"], string> = {
  master: "物件専用マスター",
  fireproof: "耐火被覆・塗装積算入力",
  input: "仕上積算入力",
  aggregate: "集計",
  output: "内訳書・出力",
};

/**
 * 日付・管理番号・工事名称は常に表示する標準項目（台帳の固定列と同じ）。
 * それ以外は表示/非表示を切り替えられる。設定は台帳の「列の表示・並び」と同じ場所に記憶する。
 */
export const ALWAYS_VISIBLE = ["projectDate", "managementNo", "name"];

const HIDDEN_KEY = "project.workspace.hiddenFields";

/**
 * 以前の「積算操作画面の表示項目」設定を台帳の「列の表示・並び」へ一度だけ移す。
 * 移し終えた旧設定は消す。
 */
export function migrateWorkspaceHiddenFields(): void {
  const raw = localStorage.getItem(HIDDEN_KEY);
  if (raw === null) return;
  localStorage.removeItem(HIDDEN_KEY);
  let keys: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    keys = Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return;
  }
  let settings = loadColumnSettings();
  for (const workspaceKey of keys) {
    const ledgerKey = ledgerKeyForWorkspace(workspaceKey);
    settings = settings.some((setting) => setting.key === ledgerKey)
      ? settings.map((setting) =>
          setting.key === ledgerKey
            ? { ...setting, visible: false }
            : setting,
        )
      : [...settings, { key: ledgerKey, visible: false }];
  }
  saveColumnSettings(settings);
}
