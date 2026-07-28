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
  materialCategoryId: number | null
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
  materialCategoryId: number | null
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
