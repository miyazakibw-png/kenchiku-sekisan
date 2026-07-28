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

export interface Detail {
  id: number
  subjectId: number
  detailNumber: string | null
  materialCategoryId: number | null
  name: string
  description: string
  unit: string
  remarks: string
  displayOrder: number
  isActive: boolean
}

/** 明細マスター画面から一括保存する編集済み行 */
export interface DetailDraft {
  /** 既存行のID。新規行は null */
  id: number | null
  detailNumber: string | null
  materialCategoryId: number | null
  name: string
  description: string
  unit: string
  remarks: string
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
