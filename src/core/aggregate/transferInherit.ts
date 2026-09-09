/** 転記入力表のA〜Iは、入力がない場合は入力のある上の行と同じ入力があるものとして扱う */

export interface TransferInheritSource {
  part1: string;
  part2: string;
  part2Split: number;
  formwork: string;
  part3: string;
  subjectId: number | null;
  materialCategory: string;
  /** 部位ID（空欄なら上の行と同じ） */
  partId: number | null;
  /** 明細ID（空欄なら上の行＋0.01） */
  detailNumber: number | null;
}

export type InheritedTransfer = TransferInheritSource;

export function inheritTransferRows(
  rows: TransferInheritSource[],
): InheritedTransfer[] {
  const current: InheritedTransfer = {
    part1: "",
    part2: "",
    part2Split: 0,
    formwork: "",
    part3: "",
    subjectId: null,
    materialCategory: "",
    partId: null,
    detailNumber: null,
  };
  return rows.map((row) => {
    if (row.partId !== null) current.partId = row.partId;
    // 明細IDは家具計算書と同じで、空欄なら上の行＋0.01
    if (row.detailNumber !== null) current.detailNumber = row.detailNumber;
    else if (current.detailNumber !== null)
      current.detailNumber =
        Math.round((current.detailNumber + 0.01) * 100) / 100;
    if (row.part1.trim() !== "") current.part1 = row.part1;
    if (row.part2.trim() !== "") {
      current.part2 = row.part2;
      current.part2Split = row.part2Split;
    }
    if (row.formwork.trim() !== "") current.formwork = row.formwork;
    if (row.part3.trim() !== "") current.part3 = row.part3;
    if (row.subjectId !== null) current.subjectId = row.subjectId;
    if (row.materialCategory.trim() !== "") {
      current.materialCategory = row.materialCategory;
    }
    return { ...current };
  });
}
