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
const COLUMNS_PER_PAGE = 12;
const ROWS_PER_PAGE = 33;
/** A3横の印刷できる大きさ・1行の高さ（計算書印刷と同じ） */
const PAGE_WIDTH = 1527;
const PAGE_HEIGHT = 1062;
const TITLE_HEIGHT = 24;
const ROW_HEIGHT = 22;
/** 左の1欄（科目〜合計の見出し／部位Ⅰ・Ⅱ・Ⅲ×倍率）の幅 */
const HEAD_WIDTH = 210;
/** 明細欄の既定の幅（画面と同じ） */
const COLUMN_DEFAULT = 221;

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

/** 部屋の見出し。紙を広く使うため 部位Ⅰ/部位Ⅱ/部位Ⅲ ×倍率 を 1欄にまとめる */
function roomLabel(row: MiscRow): string {
  const part3 = row.estimateRowId === null ? `＋${row.part3}` : row.part3;
  const parts = [row.part1, row.part2, part3].filter(
    (part) => part.trim() !== "",
  );
  const name = parts.join("/");
  return row.multiplier === 1 ? name : `${name} ×${row.multiplier}`;
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
  /** 画面で動かした列幅（画面と同じ置き場 misc-widths）。無い列は既定幅 */
  const widths = useMemo<Record<string, number>>(() => {
    try {
      const raw = window.localStorage.getItem(`misc-widths:${project.id}`);
      const parsed: unknown = raw === null ? {} : JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return {};
      const map: Record<string, number> = {};
      Object.entries(parsed as Record<string, unknown>).forEach(
        ([key, value]) => {
          if (typeof value === "number" && Number.isFinite(value))
            map[key] = value;
        },
      );
      return map;
    } catch {
      return {};
    }
  }, [project.id]);

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

  /** 明細欄は画面の列幅と同じ幅で出す（広すぎるときだけA3横の幅へ縮める） */
  const columnWidthOf = (column: MiscColumn): number =>
    widths[column.id] ?? COLUMN_DEFAULT;
  const tableWidthOf = (pageColumns: MiscColumn[]): number =>
    HEAD_WIDTH +
    pageColumns.reduce((total, column) => total + columnWidthOf(column), 0);
  const scaleOf = (pageColumns: MiscColumn[]): number =>
    Math.min(1, PAGE_WIDTH / tableWidthOf(pageColumns));
  /** 表のうしろの空白を埋める横罫線の本数（見出し12行＝タテ明細の見出し＋部屋見出し） */
  const blankCountOf = (pageRows: MiscRow[]): number =>
    Math.max(
      0,
      Math.floor((PAGE_HEIGHT - TITLE_HEIGHT) / ROW_HEIGHT) -
        12 -
        pageRows.length,
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
          <table
            className="misc-print"
            style={{
              width: `${tableWidthOf(page.columns) * scaleOf(page.columns)}px`,
            }}
          >
            <colgroup>
              <col
                style={{ width: `${HEAD_WIDTH * scaleOf(page.columns)}px` }}
              />
              {page.columns.map((column) => (
                <col
                  key={column.id}
                  style={{
                    width: `${columnWidthOf(column) * scaleOf(page.columns)}px`,
                  }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="head">科目</th>
                {page.columns.map((column) => (
                  <th key={column.id}>{subjectName(column.subjectId)}</th>
                ))}
              </tr>
              {HEADS.map((head) => (
                <tr key={head.key}>
                  <th className="head">{head.label}</th>
                  {page.columns.map((column) => (
                    <th key={column.id} className="value">
                      {textOf(column, head.key)}
                    </th>
                  ))}
                </tr>
              ))}
              <tr className="total">
                <th className="head">合計</th>
                {page.columns.map((column) => (
                  <th key={column.id} className="num">
                    {(totals.get(column.id) ?? 0).toFixed(2)}
                  </th>
                ))}
              </tr>
              <tr className="room-head">
                <th className="room">部位Ⅰ/部位Ⅱ/部位Ⅲ（部屋名）　×倍率</th>
                {page.columns.map((column) => (
                  <th key={column.id} />
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={row.id}>
                  <td className="room">{roomLabel(row)}</td>
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
              {/* 入力が少なく下が空く分は、手入力できるよう横罫線だけを引く */}
              {Array.from(
                { length: blankCountOf(page.rows) },
                (_unused, blank) => (
                  <tr className="blank" key={`blank-${blank}`}>
                    <td colSpan={1 + page.columns.length} />
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
