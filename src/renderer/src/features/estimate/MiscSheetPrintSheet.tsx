import { useEffect, useMemo, useState } from "react";
import type { MasterOptions, ProjectSummary } from "@shared/types";
import {
  cellValue,
  columnTotal,
  isEmptyColumn,
  type MiscColumn,
  type MiscRow,
} from "../../../../core/misc/miscSheet";
import "./MiscSheetPrintSheet.css";

/** A3横1枚に入る明細（タテ列）の数と部屋（ヨコ行）の数 */
const COLUMNS_PER_PAGE = 10;
const ROWS_PER_PAGE = 33;

/** 明細の見出し（上から順に1行ずつ） */
const HEADS: { key: keyof MiscColumn; label: string }[] = [
  { key: "partNumber", label: "部位ID" },
  { key: "detailNumber", label: "名称ID" },
  { key: "partName", label: "部位" },
  { key: "name", label: "名称" },
  { key: "descriptionUpper", label: "摘要(上段)" },
  { key: "descriptionLower", label: "摘要(下段)" },
  { key: "unit", label: "単位" },
  { key: "remarksUpper", label: "備考(上段)" },
  { key: "remarksLower", label: "備考(下段)" },
];

function textOf(column: MiscColumn, key: keyof MiscColumn): string {
  const value = column[key];
  if (value === null) return "";
  return typeof value === "string" ? value : String(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const list: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    list.push(items.slice(start, start + size));
  return list.length > 0 ? list : [[]];
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

interface Props {
  project: ProjectSummary;
  /** 印刷する部位別雑・金物入力表 */
  sheetId: number;
  options: MasterOptions | null;
}

/**
 * 部位別雑・金物入力表の印刷書式（A3横）。
 * 画面と同じ並び（明細はタテ1列・部屋はヨコ1行）で、明細が多いときは紙を分ける。
 */
export default function MiscSheetPrintSheet({
  project,
  sheetId,
  options,
}: Props): JSX.Element {
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<MiscColumn[]>([]);
  const [rows, setRows] = useState<MiscRow[]>([]);

  useEffect(() => {
    void (async () => {
      const sheet = await window.sekisan.getMiscSheet(sheetId);
      setName(sheet.name);
      // 何も入れていない明細（列）は紙に出さない
      setColumns(
        parseJson<MiscColumn[]>(sheet.columnsJson, []).filter(
          (column) => !isEmptyColumn(column),
        ),
      );
      setRows(parseJson<MiscRow[]>(sheet.rowsJson, []));
    })();
  }, [sheetId]);

  const totals = useMemo(
    () =>
      new Map(
        columns.map((column) => [
          column.id,
          columnTotal({ columns, rows }, column.id),
        ]),
      ),
    [columns, rows],
  );

  const subjectName = (subjectId: number | null): string =>
    options?.subjects.find((subject) => subject.id === subjectId)?.name ?? "";

  // 何も入れていない表は紙にしない
  if (columns.length === 0) return <></>;

  const columnPages = chunk(columns, COLUMNS_PER_PAGE);
  const rowPages = chunk(rows, ROWS_PER_PAGE);
  const pages = columnPages.flatMap((pageColumns, columnPage) =>
    rowPages.map((pageRows, rowPage) => ({
      columnPage,
      rowPage,
      columns: pageColumns,
      rows: pageRows,
    })),
  );

  return (
    <div className="calc-print-sheet misc-print-sheet">
      {pages.map((page) => (
        <div
          className="calc-print-page"
          key={`${page.columnPage}-${page.rowPage}`}
        >
          <div className="calc-print-title">
            {name || "部位別雑・金物入力表"}　{project.managementNo}{" "}
            {project.name}
            {pages.length > 1
              ? `　（明細 ${page.columnPage + 1}／${columnPages.length}・部屋 ${
                  page.rowPage + 1
                }／${rowPages.length}）`
              : ""}
          </div>
          <table className="misc-print">
            <thead>
              <tr>
                <th className="head" colSpan={4}>
                  科目
                </th>
                {page.columns.map((column) => (
                  <th key={column.id}>{subjectName(column.subjectId)}</th>
                ))}
              </tr>
              {HEADS.map((head) => (
                <tr key={head.key}>
                  <th className="head" colSpan={4}>
                    {head.label}
                  </th>
                  {page.columns.map((column) => (
                    <th key={column.id} className="value">
                      {textOf(column, head.key)}
                    </th>
                  ))}
                </tr>
              ))}
              <tr className="total">
                <th className="head" colSpan={4}>
                  合計
                </th>
                {page.columns.map((column) => (
                  <th key={column.id} className="num">
                    {(totals.get(column.id) ?? 0).toFixed(2)}
                  </th>
                ))}
              </tr>
              <tr className="room-head">
                <th className="part1">部位Ⅰ</th>
                <th className="part2">部位Ⅱ</th>
                <th className="part3">部位Ⅲ（部屋名）</th>
                <th className="multiplier">倍率</th>
                {page.columns.map((column) => (
                  <th key={column.id} />
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={row.id}>
                  <td className="part1">{row.part1}</td>
                  <td className="part2">{row.part2}</td>
                  <td className="part3">
                    {row.estimateRowId === null ? `＋${row.part3}` : row.part3}
                  </td>
                  <td className="multiplier">{row.multiplier}</td>
                  {page.columns.map((column) => {
                    const value = cellValue(row.values[column.id] ?? "");
                    return (
                      <td key={column.id} className="num">
                        {value === null ? "" : value.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {Array.from({
                length: Math.max(0, ROWS_PER_PAGE - page.rows.length),
              }).map((_unused, blank) => (
                <tr className="blank" key={`blank-${blank}`}>
                  {Array.from({ length: 4 + page.columns.length }).map(
                    (_cell, cell) => (
                      <td key={cell} />
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
