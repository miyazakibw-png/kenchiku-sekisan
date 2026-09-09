/** 画面の見た目の列（上段・下段を持つかどうか） */
export interface ScreenColumn {
  upper: boolean;
  lower: boolean;
}

/** 1明細＝上下2行のExcelを、1明細＝1行の並びに畳んだ結果 */
export interface FoldedPaste {
  matrix: string[][];
  /** 畳んだ行の先頭が当たる論理列 */
  startCol: number;
}

/** 画面の列番号を、論理列（上段→下段の順に並べた列）の先頭番号へ直す */
export function screenColToLogicalCol(
  columns: readonly ScreenColumn[],
  screenCol: number,
): number {
  let logical = 0;
  for (let i = 0; i < screenCol && i < columns.length; i++) {
    logical += (columns[i].upper ? 1 : 0) + (columns[i].lower ? 1 : 0);
  }
  return logical;
}

/**
 * Excelの2行（上段・下段）を1明細の1行に畳む。
 * 上段しか無い列は上段の値だけ、下段しか無い列は下段の値だけを取る。
 */
export function foldTwoRowPaste(
  matrix: readonly (readonly string[])[],
  columns: readonly ScreenColumn[],
  screenCol: number,
): FoldedPaste {
  const folded: string[][] = [];
  for (let i = 0; i < matrix.length; i += 2) {
    const upper = matrix[i] ?? [];
    const lower = matrix[i + 1] ?? [];
    const line: string[] = [];
    const width = Math.max(upper.length, lower.length);
    for (let c = 0; c < width; c++) {
      const column = columns[screenCol + c];
      if (!column) break;
      if (column.upper) line.push(upper[c] ?? "");
      if (column.lower) line.push(lower[c] ?? "");
    }
    folded.push(line);
  }
  return {
    matrix: folded,
    startCol: screenColToLogicalCol(columns, screenCol),
  };
}

/** 畳んだ表をTSV文字列に戻す（貼り付け処理へ渡すため） */
export function toTsvText(matrix: readonly (readonly string[])[]): string {
  return matrix.map((line) => line.join("\t")).join("\n");
}
