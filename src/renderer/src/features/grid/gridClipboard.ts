import { normalizePastedMatrix, parseTsv, toTsv } from "@shared/tsv";

/** 貼り付け・コピー対象となる論理列の定義（画面ごとに宣言する） */
export interface GridColumn<T> {
  key: string;
  label: string;
  /** 行から表示用の文字列を取り出す */
  get: (row: T) => string;
  /**
   * 文字列を行へ適用する。
   * error: 取り込めない不正値 / warning: 取り込むが確認が必要な値
   */
  set?: (row: T, value: string) => { row: T; error?: string; warning?: string };
}

export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export function normalizeRange(range: CellRange): CellRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    endRow: Math.max(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

export function isInRange(
  range: CellRange | null,
  row: number,
  col: number,
): boolean {
  if (!range) return false;
  const r = normalizeRange(range);
  return (
    row >= r.startRow && row <= r.endRow && col >= r.startCol && col <= r.endCol
  );
}

/** 選択範囲をExcelへ貼り付け可能なTSV文字列にする */
export function copyRangeAsTsv<T>(
  rows: T[],
  columns: GridColumn<T>[],
  range: CellRange,
): string {
  const r = normalizeRange(range);
  const matrix: string[][] = [];
  for (let i = r.startRow; i <= r.endRow && i < rows.length; i++) {
    const line: string[] = [];
    for (let c = r.startCol; c <= r.endCol && c < columns.length; c++) {
      line.push(columns[c].get(rows[i]));
    }
    matrix.push(line);
  }
  return toTsv(matrix);
}

export interface PreviewCell {
  value: string;
  error?: string;
  warning?: string;
}

export interface PastePreview<T> {
  /** 貼り付け後の行（確定するとそのまま採用する） */
  rows: T[];
  /** プレビュー表示用の値とエラー */
  cells: PreviewCell[][];
  columns: GridColumn<T>[];
  errorCount: number;
  warningCount: number;
  /** 新しく追加される行数 */
  addedRows: number;
  startRow: number;
  startCol: number;
}

/**
 * クリップボードのTSVを解釈し、貼り付け結果のプレビューを組み立てる。
 * 実データへの反映は利用側が確定操作で行う。
 */
export function buildPastePreview<T>(
  rows: T[],
  columns: GridColumn<T>[],
  clipboardText: string,
  startRow: number,
  startCol: number,
  createRow: () => T,
): PastePreview<T> {
  const matrix = normalizePastedMatrix(parseTsv(clipboardText));
  const nextRows = [...rows];
  const cells: PreviewCell[][] = [];
  let errorCount = 0;
  let warningCount = 0;
  let addedRows = 0;

  matrix.forEach((line, r) => {
    const rowIndex = startRow + r;
    if (rowIndex >= nextRows.length) {
      nextRows.push(createRow());
      addedRows += 1;
    }
    const previewLine: PreviewCell[] = [];
    line.forEach((value, c) => {
      const column = columns[startCol + c];
      if (!column || !column.set) {
        previewLine.push({
          value,
          error: column ? "入力不可の列です" : "列がありません",
        });
        errorCount += 1;
        return;
      }
      const result = column.set(nextRows[rowIndex], value);
      nextRows[rowIndex] = result.row;
      if (result.error) errorCount += 1;
      if (result.warning) warningCount += 1;
      previewLine.push({ value, error: result.error, warning: result.warning });
    });
    cells.push(previewLine);
  });

  return {
    rows: nextRows,
    cells,
    columns,
    errorCount,
    warningCount,
    addedRows,
    startRow,
    startCol,
  };
}

/**
 * 元の行を消さずに差し込む貼り付け。
 * at の位置に貼り付けた行を入れ、そこにあった行は下へずらす（at が行数なら最終行への追加になる）。
 */
export function buildInsertPastePreview<T>(
  rows: T[],
  columns: GridColumn<T>[],
  clipboardText: string,
  at: number,
  createRow: () => T,
): PastePreview<T> {
  const position = Math.min(Math.max(at, 0), rows.length);
  const head = rows.slice(0, position);
  const tail = rows.slice(position);
  const preview = buildPastePreview(
    head,
    columns,
    clipboardText,
    position,
    0,
    createRow,
  );
  return { ...preview, rows: [...preview.rows, ...tail] };
}
