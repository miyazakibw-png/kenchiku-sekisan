import type { AssemblyItem } from "./types";

/**
 * セットの内容を表す照合キー。
 * 修正の結果まったく同じ構成になったセット（統合対象）を見分けるために使う。
 * 並び順も内容のうちなので、行を入れ替えたセットは別物として扱う。
 */
export function assemblySignature(items: AssemblyItem[]): string {
  return items
    .map((item) =>
      [
        item.subjectId,
        item.partNumber ?? "",
        item.detailNumber ?? "",
        item.materialCategory,
        item.partName,
        item.name,
        item.descriptionUpper,
        item.descriptionLower,
        item.unit,
        item.remarksUpper,
        item.remarksLower,
        item.estimateDisplay,
        item.formula,
        item.coefficient,
      ]
        .map((value) => String(value).trim())
        .join("\u001f"),
    )
    .join("\u001e");
}
