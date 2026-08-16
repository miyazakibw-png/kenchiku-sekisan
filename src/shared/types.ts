export interface Subject {
  id: number
  code: string
  name: string
  displayOrder: number
}

export interface MaterialCategory {
  id: number
  code: string
  name: string
  displayOrder: number
}

export interface Unit {
  id: number
  name: string
  displayOrder: number
}

/** 1明細は上下2段で構成する（上段: 部位名/摘要上段/備考上段、下段: 名称/摘要下段/備考下段） */
export interface Detail {
  id: number
  subjectId: number
  /** 明細番号（小数点以下2桁の数値） */
  detailNumber: number | null
  /** 材種区分（マスタ番号で入力補助するが、マスタに無い文字も入力可） */
  materialCategory: string
  partName: string
  name: string
  descriptionUpper: string
  descriptionLower: string
  unit: string
  remarksUpper: string
  remarksLower: string
  estimateDisplay: string
  displayOrder: number
  isActive: boolean
}

/** 明細マスター画面から一括保存する編集済み行 */
export interface DetailDraft {
  /** 既存行のID。新規行は null */
  id: number | null
  detailNumber: number | null
  materialCategory: string
  partName: string
  name: string
  descriptionUpper: string
  descriptionLower: string
  unit: string
  remarksUpper: string
  remarksLower: string
  estimateDisplay: string
  isActive: boolean
}

export interface SaveDetailsRequest {
  subjectId: number
  rows: DetailDraft[]
  /** 画面上で削除された既存行のID */
  deletedIds: number[]
}

export interface MasterOptions {
  subjects: Subject[]
  materialCategories: MaterialCategory[]
  units: Unit[]
}

/** basic: 全物件共通の基本セット / project: 積算入力時に自動登録される物件固有セット */
export type AssemblyScope = 'basic' | 'project'

/**
 * セットの構成明細。
 * 明細マスターを参照せず、呼び出した時点の内容を写し取って保持する（一方通行）。
 */
export interface AssemblyItem {
  id: number | null
  /** 写し取り元の明細（追跡用。連動はしない） */
  sourceDetailId: number | null
  subjectId: number
  partNumber: number | null
  detailNumber: number | null
  materialCategory: string
  partName: string
  name: string
  descriptionUpper: string
  descriptionLower: string
  unit: string
  remarksUpper: string
  remarksLower: string
  estimateDisplay: string
  formula: string
  /** 掛け率（セットで拾うが計上単位が異なる場合に使用） */
  coefficient: number
}

export interface FinishAssembly {
  id: number
  scope: AssemblyScope
  projectId: number | null
  note: string
  displayOrder: number
  /** 1行目が一覧の表示行になる */
  items: AssemblyItem[]
}

export interface SaveAssemblyRequest {
  /** 既存セットのID。新規は null */
  id: number | null
  scope: AssemblyScope
  projectId: number | null
  note: string
  items: AssemblyItem[]
}

/** 保存結果。同じ内容のセットが既にある場合は統合候補を返す */
export interface SaveAssemblyResult {
  assembly: FinishAssembly
  /** 内容が一致する既存セット（統合確認用） */
  duplicateOf: FinishAssembly | null
}

export interface Part {
  id: number
  code: string | null
  name: string
  displayOrder: number
}

/** 仕上明細セット画面で使うマスター。明細マスター画面と同じ内容 */
export type AssemblyMasterOptions = MasterOptions
