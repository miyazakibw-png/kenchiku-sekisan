import { describe, expect, it } from "vitest";
import {
  buildInsertPastePreview,
  buildPastePreview,
  copyRangeAsTsv,
  clearRange,
  isInRange,
  normalizeRange,
  pasteIntoRange,
  type GridColumn,
} from "../../src/renderer/src/features/grid/gridClipboard";

interface Row {
  code: string;
  name: string;
  qty: number | null;
}

const columns: GridColumn<Row>[] = [
  {
    key: "code",
    label: "記号",
    get: (r) => r.code,
    set: (r, v) => ({ row: { ...r, code: v } }),
  },
  {
    key: "name",
    label: "名称",
    get: (r) => r.name,
    set: (r, v) => ({ row: { ...r, name: v } }),
  },
  {
    key: "qty",
    label: "数量",
    get: (r) => (r.qty === null ? "" : String(r.qty)),
    set: (r, v) => {
      if (v === "") return { row: { ...r, qty: null } };
      const n = Number(v);
      if (Number.isNaN(n)) return { row: r, error: "数値ではありません" };
      return { row: { ...r, qty: n } };
    },
  },
];

const createRow = (): Row => ({ code: "", name: "", qty: null });

const rows: Row[] = [
  { code: "A", name: "床", qty: 1 },
  { code: "B", name: "壁", qty: 2 },
];

describe("グリッドのExcel互換コピー＆ペースト", () => {
  it("選択範囲をTSVでコピーする", () => {
    expect(
      copyRangeAsTsv(rows, columns, {
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      }),
    ).toBe("A\t床\r\nB\t壁");
  });

  it("逆方向の範囲指定も正規化して扱う", () => {
    expect(
      normalizeRange({ startRow: 2, startCol: 3, endRow: 0, endCol: 1 }),
    ).toEqual({
      startRow: 0,
      startCol: 1,
      endRow: 2,
      endCol: 3,
    });
    expect(
      isInRange({ startRow: 2, startCol: 2, endRow: 0, endCol: 0 }, 1, 1),
    ).toBe(true);
    expect(isInRange(null, 0, 0)).toBe(false);
  });

  it("貼り付けプレビューを作成し、行不足分は追加行として扱う", () => {
    const preview = buildPastePreview(
      rows,
      columns,
      "C\t天井\t3\nD\t梁\t4",
      1,
      0,
      createRow,
    );
    expect(preview.addedRows).toBe(1);
    expect(preview.errorCount).toBe(0);
    expect(preview.rows.length).toBe(3);
    expect(preview.rows[1]).toEqual({ code: "C", name: "天井", qty: 3 });
    expect(preview.rows[2]).toEqual({ code: "D", name: "梁", qty: 4 });
    expect(rows.length).toBe(2);
  });

  it("不正値はエラーとして数え、確定前に判別できる", () => {
    const preview = buildPastePreview(
      rows,
      columns,
      "X\tあ\tｱｲｳ",
      0,
      0,
      createRow,
    );
    expect(preview.errorCount).toBe(1);
    expect(preview.cells[0][2].error).toBe("数値ではありません");
    expect(preview.rows[0].qty).toBe(1);
  });

  it("列数を超える貼り付けはエラーにする", () => {
    const preview = buildPastePreview(
      rows,
      columns,
      "a\tb\tc\td",
      0,
      0,
      createRow,
    );
    expect(preview.cells[0][3].error).toBe("列がありません");
  });

  it("警告はエラーと区別して数える", () => {
    const withWarning: typeof columns = [
      ...columns.slice(0, 2),
      {
        key: "qty",
        label: "数量",
        get: (r) => String(r.qty ?? ""),
        set: (r, v) => ({ row: { ...r, qty: Number(v) }, warning: "要確認" }),
      },
    ];
    const preview = buildPastePreview(
      rows,
      withWarning,
      "A\t床\t5",
      0,
      0,
      createRow,
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.warningCount).toBe(1);
    expect(preview.rows[0].qty).toBe(5);
  });

  it("全角数字・桁区切りは正規化して取り込む", () => {
    const preview = buildPastePreview(
      rows,
      columns,
      "A\t床\t１，２３４",
      0,
      0,
      createRow,
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0].qty).toBe(1234);
  });

  it("挿入貼り付けは元の行を消さずに差し込む", () => {
    const preview = buildInsertPastePreview(
      rows,
      columns,
      "C\t天井\t3",
      1,
      createRow,
    );
    expect(preview.rows.map((r) => r.code)).toEqual(["A", "C", "B"]);
    expect(preview.addedRows).toBe(1);
  });

  it("追加貼り付け（行数を指定）は最後の行に足す", () => {
    const preview = buildInsertPastePreview(
      rows,
      columns,
      "C\t天井\t3",
      rows.length,
      createRow,
    );
    expect(preview.rows.map((r) => r.code)).toEqual(["A", "B", "C"]);
  });

  it("単一値を複数セルの選択範囲全体へ貼り付ける", () => {
    const preview = pasteIntoRange(
      rows,
      columns,
      "5",
      {
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 2,
      },
      createRow,
    );
    expect(preview.rows).toEqual([
      { code: "5", name: "5", qty: 5 },
      { code: "5", name: "5", qty: 5 },
    ]);
    expect(preview.addedRows).toBe(0);
  });

  it("選択範囲より大きいTSVは範囲内だけに貼り付け、行を追加しない", () => {
    const preview = pasteIntoRange(
      rows,
      columns,
      "C\t天井\t3\nD\t梁\t4\nE\t床\t5",
      {
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      },
      createRow,
    );
    expect(preview.rows).toEqual([
      { code: "C", name: "天井", qty: 1 },
      { code: "D", name: "梁", qty: 2 },
    ]);
    expect(preview.addedRows).toBe(0);
  });

  it("選択範囲より小さいTSVは貼り付けたセル以外を維持する", () => {
    const threeRows = [...rows, { code: "C", name: "梁", qty: 3 }];
    const preview = pasteIntoRange(
      threeRows,
      columns,
      "X\t天井\nY\t床",
      {
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 2,
      },
      createRow,
    );
    expect(preview.rows).toEqual([
      { code: "X", name: "天井", qty: 1 },
      { code: "Y", name: "床", qty: 2 },
      { code: "C", name: "梁", qty: 3 },
    ]);
    expect(preview.addedRows).toBe(0);
  });

  it("単一セル選択では通常貼り付けと同様に展開して行を追加する", () => {
    const range = {
      startRow: 1,
      startCol: 1,
      endRow: 1,
      endCol: 1,
    };
    const preview = pasteIntoRange(
      rows,
      columns,
      "天井\t3\n梁\t4",
      range,
      createRow,
    );
    expect(preview).toEqual(
      buildPastePreview(rows, columns, "天井\t3\n梁\t4", 1, 1, createRow),
    );
    expect(preview.addedRows).toBe(1);
    expect(preview.rows[2]).toEqual({ code: "", name: "梁", qty: 4 });
  });

  it("範囲内の文字列列と数値列を消去し、範囲外を維持する", () => {
    const cleared = clearRange(rows, columns, {
      startRow: 0,
      startCol: 1,
      endRow: 0,
      endCol: 2,
    });
    expect(cleared).toEqual([
      { code: "A", name: "", qty: null },
      { code: "B", name: "壁", qty: 2 },
    ]);
    expect(rows[0]).toEqual({ code: "A", name: "床", qty: 1 });
  });

  it("貼り付けでは自動計算列の警告を維持する", () => {
    const preview = pasteIntoRange(
      rows,
      columns,
      "値",
      {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 2,
      },
      createRow,
    );
    expect(preview.warningCount).toBe(0);

    const calculatedColumns: GridColumn<Row>[] = [
      columns[0],
      {
        key: "calc",
        label: "計算",
        get: () => "",
        set: (row) => ({ row, warning: "自動計算" }),
      },
    ];
    const calculated = pasteIntoRange(
      rows,
      calculatedColumns,
      "値",
      {
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      },
      createRow,
    );
    expect(calculated.warningCount).toBe(2);

    const inputlessColumn: GridColumn<Row>[] = [
      columns[0],
      { key: "readonly", label: "参照", get: (row) => row.name },
    ];
    const inputless = pasteIntoRange(
      rows,
      inputlessColumn,
      "C\t値",
      {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 1,
      },
      createRow,
    );
    expect(inputless.errorCount).toBe(0);
    expect(inputless.rows[0].code).toBe("C");
    expect(inputless.rows[0].name).toBe("床");
  });
});
