/** 工事管理画面（積算操作：管理・移動・集計指示）のメニュー */
export interface WorkspaceMenuItem {
  key: string
  label: string
  /** 画面上の区分け */
  group: 'master' | 'input' | 'aggregate' | 'output'
  note: string
  ready: boolean
}

export const WORKSPACE_MENU: WorkspaceMenuItem[] = [
  {
    key: 'subjects',
    label: '科目マスター',
    group: 'master',
    note: 'この物件専用。工種科目は物件全体（内訳書を除く）に連動し、大元へ同期もできる',
    ready: false
  },
  {
    key: 'details',
    label: '明細マスター',
    group: 'master',
    note: 'この物件専用の複製。最初の入力に使う。修正は大元へ同期できる',
    ready: false
  },
  {
    key: 'assemblies',
    label: 'セット明細表示',
    group: 'master',
    note: '物件のセット明細一覧',
    ready: false
  },
  {
    key: 'fittings',
    label: '建具入力',
    group: 'input',
    note: '建具積算用',
    ready: false
  },
  {
    key: 'roomFinishes',
    label: '部位別入力表',
    group: 'input',
    note: 'メイン積算の管理画面（部屋別等）',
    ready: false
  },
  {
    key: 'transferInput',
    label: '転記入力表',
    group: 'input',
    note: '集計書へ直接集計。1明細で複数行の仕様書きが可能。根拠集計・セット明細には登録しない',
    ready: false
  },
  {
    key: 'aggregate',
    label: '集計処理',
    group: 'aggregate',
    note: '科目集計＋根拠展開はまとめて実行。部位別集計は独立',
    ready: false
  },
  {
    key: 'projectMaster',
    label: '集計書兼工事マスター',
    group: 'aggregate',
    note: '物件専用明細マスター（集計数量も表示）。削除不可・計上不要明細は科目末尾へ',
    ready: false
  },
  {
    key: 'basisSheet',
    label: '内訳展開集計表',
    group: 'aggregate',
    note: '集計書の根拠表示',
    ready: false
  },
  {
    key: 'roomAggregate',
    label: '部屋別集計',
    group: 'aggregate',
    note: '部位Ⅲの名称を工種科目代わりに集計（明細は科目順に並べる）',
    ready: false
  },
  {
    key: 'changeHistory',
    label: '明細マスター変更履歴',
    group: 'aggregate',
    note: '集計書兼工事マスターで変更した内容のみ記録',
    ready: false
  },
  {
    key: 'statement',
    label: '内訳書',
    group: 'output',
    note: '集計書兼工事マスターからの転記',
    ready: false
  },
  {
    key: 'statementSingle',
    label: '内訳書（1行）',
    group: 'output',
    note: '2段明細を1段へ変換して転記',
    ready: false
  },
  {
    key: 'statementSettings',
    label: '設定',
    group: 'output',
    note: '内訳書形式・表示に関する設定',
    ready: false
  },
  {
    key: 'finishCheck',
    label: '仕上チェック表',
    group: 'output',
    note: '集計書兼工事マスターから仕上のみ抜き出した部位別チェック',
    ready: false
  },
  {
    key: 'print',
    label: '印刷',
    group: 'output',
    note: '計算書・集計書のプリンター／PDF／Excel出力',
    ready: false
  }
]

export const MENU_GROUP_LABEL: Record<WorkspaceMenuItem['group'], string> = {
  master: '物件専用マスター',
  input: '積算入力',
  aggregate: '集計',
  output: '内訳書・出力'
}

const HIDDEN_KEY = 'project.workspace.hiddenFields'

/** 管理番号・工事名称は常に表示する標準項目。それ以外は表示/非表示を切り替えられる */
export const ALWAYS_VISIBLE = ['managementNo', 'name']

export function loadHiddenFields(): string[] {
  const raw = localStorage.getItem(HIDDEN_KEY)
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
}

export function saveHiddenFields(keys: string[]): void {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(keys))
}

export function toggleHiddenField(hidden: string[], key: string): string[] {
  if (ALWAYS_VISIBLE.includes(key)) return hidden
  return hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key]
}
