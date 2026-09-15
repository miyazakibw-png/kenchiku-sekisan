import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@shared/types";
import {
  adjacencyVariables,
  calcBeamRow,
  calcColumnRow,
  beamSheetTotals,
  columnSheetTotals,
  inheritedFloors,
  normalizeManageRows,
  normalizeWallLabels,
  type FireproofColumnRow,
  type FireproofManageRow,
} from "../../../../core/fireproof/fireproofEstimate";
import { evaluateCalcSheet } from "../../../../core/room/calcSheet";
import {
  normalizeFloorList,
  type FireproofFloorList,
} from "../../../../core/fireproof/fireproofList";
import CalcPrintSheet from "../print/CalcPrintSheet";
import {
  HEAD_DETAIL_WIDTHS,
  SHEET_KIND,
  sizeHint,
  type FireproofTableKind,
} from "./FireproofEstimatePage";
import "./FireproofPrintSheet.css";

/** A3横の印刷できる大きさ・1行・見出しの高さ（計算書印刷と同じ） */
const PAGE_WIDTH = 1527;
const PAGE_HEIGHT = 1062;
const TITLE_HEIGHT = 24;
const ROW_HEIGHT = 20;
const HEAD_HEIGHT = 22;
/** 先頭の明細表（見出し＋1行）と厚み・合計の帯の高さ */
const DETAIL_HEIGHT = 46;
const STRIP_HEIGHT = 26;

/** 先頭の明細行の欄（画面と同じ並び） */
const HEAD_DETAIL_LABELS = [
  "区分",
  "科目",
  "部位ID",
  "名称ID",
  "部位",
  "名称",
  "摘要（下段）",
  "摘要（上段）",
  "単位",
  "備考（下段）",
  "備考（上段）",
] as const;

function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function formatNumber(value: number | null, decimals = 2): string {
  return value === null ? "" : value.toFixed(decimals);
}

/** 画面で動かした列幅（入力表と同じ置き場）。無ければ既定幅 */
function screenWidths(key: string, defaults: number[]): number[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaults;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return defaults;
    const map = stored as Record<string, unknown>;
    return defaults.map((width, index) => {
      const value = map[String(index)];
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : width;
    });
  } catch {
    return defaults;
  }
}

/** 部位1は空欄なら上の行を引き継ぐ（管理表と同じ） */
function inheritedPart1List(rows: FireproofManageRow[]): string[] {
  let part1 = "";
  return rows.map((row) => {
    if (row.part1.trim() !== "") part1 = row.part1;
    return part1;
  });
}

/** 先頭の明細表（文字だけ。管理表と同じ並び） */
function DetailRow({ row }: { row: FireproofManageRow }): JSX.Element {
  const detail = row.detail;
  const values = [
    detail.materialCategory,
    detail.subjectId === null ? "" : String(detail.subjectId),
    detail.partNumber === null ? "" : String(detail.partNumber),
    detail.detailNumber === null ? "" : detail.detailNumber.toFixed(2),
    detail.partName,
    detail.name,
    detail.descriptionLower,
    detail.descriptionUpper,
    detail.unit,
    detail.remarksLower,
    detail.remarksUpper,
  ];
  return (
    <table className="fireproof-print-detail">
      <colgroup>
        {HEAD_DETAIL_WIDTHS.map((width, index) => (
          <col key={index} style={{ width: `${width}px` }} />
        ))}
      </colgroup>
      <thead>
        <tr style={{ height: `${HEAD_HEIGHT}px` }}>
          {HEAD_DETAIL_LABELS.map((label) => (
            <th key={label}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr style={{ height: `${DETAIL_HEIGHT - HEAD_HEIGHT}px` }}>
          {values.map((value, index) => (
            <td key={index}>{value}</td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** 柱入力表・梁型入力表の1枚分 */
function TablePage({
  kind,
  row,
  list,
  title,
}: {
  kind: FireproofTableKind;
  row: FireproofManageRow;
  list: FireproofFloorList;
  title: string;
}): JSX.Element {
  const config = SHEET_KIND[kind];
  const sheet = kind === "beam" ? row.beamSheet : row.sheet;
  const calcRow = kind === "beam" ? calcBeamRow : calcColumnRow;
  const totals =
    kind === "beam"
      ? beamSheetTotals(sheet, list)
      : columnSheetTotals(sheet, list);
  const wallLabels = normalizeWallLabels(sheet.wallLabels, config.markCount);
  const floors = inheritedFloors(sheet.rows);
  /** 画面で動かした列幅をそのまま紙に使い、A3横の幅へ縮める */
  const widths = useMemo(
    () => screenWidths(config.storageKey, config.widths),
    [config],
  );
  const contentWidth = Math.max(
    widths.reduce((total, width) => total + width, 0),
    HEAD_DETAIL_WIDTHS.reduce((total, width) => total + width, 0),
  );
  const scale = PAGE_WIDTH / contentWidth;

  /** 1枚に入る行数（1枚目は明細表と帯の分だけ少ない。最低1枚＝行が無くても1枚出す） */
  const { pages } = useMemo(() => {
    const first = Math.max(
      1,
      Math.floor(
        (PAGE_HEIGHT -
          TITLE_HEIGHT -
          (DETAIL_HEIGHT + STRIP_HEIGHT + HEAD_HEIGHT) * scale) /
          (ROW_HEIGHT * scale),
      ),
    );
    const later = Math.max(
      1,
      Math.floor(
        (PAGE_HEIGHT - TITLE_HEIGHT - HEAD_HEIGHT * scale) /
          (ROW_HEIGHT * scale),
      ),
    );
    const chunks: FireproofColumnRow[][] = [];
    const rows = sheet.rows;
    chunks.push(rows.slice(0, first));
    for (let at = first; at < rows.length; at += later)
      chunks.push(rows.slice(at, at + later));
    return { pages: chunks };
  }, [scale, sheet.rows]);

  return (
    <>
      {pages.map((pageRows, page) => {
        const capacity =
          page === 0
            ? Math.max(
                1,
                Math.floor(
                  (PAGE_HEIGHT -
                    TITLE_HEIGHT -
                    (DETAIL_HEIGHT + STRIP_HEIGHT + HEAD_HEIGHT) * scale) /
                    (ROW_HEIGHT * scale),
                ),
              )
            : Math.max(
                1,
                Math.floor(
                  (PAGE_HEIGHT - TITLE_HEIGHT - HEAD_HEIGHT * scale) /
                    (ROW_HEIGHT * scale),
                ),
              );
        const blanks = Math.max(0, capacity - pageRows.length);
        return (
          <div className="calc-print-page" key={page}>
            <div
              className="calc-print-title"
              style={{ height: `${TITLE_HEIGHT}px` }}
            >
              {config.title}　{title}
              {pages.length > 1 ? `　（${page + 1}／${pages.length}）` : ""}
            </div>
            <div
              className="fireproof-print-body"
              style={{
                transform: `scale(${scale})`,
                width: `${contentWidth}px`,
              }}
            >
              {page === 0 && (
                <>
                  <DetailRow row={row} />
                  <div
                    className="fireproof-print-strip"
                    style={{ height: `${STRIP_HEIGHT}px` }}
                  >
                    <span>耐火被覆厚み→ {sheet.thickness ?? ""} mm</span>
                    <span>
                      必要数㎡ <b>{formatNumber(totals.needed)}</b>
                    </span>
                    <span>
                      {config.adjacency} <b>{formatNumber(totals.wall)}</b>
                    </span>
                    {wallLabels.map((label, mark) => (
                      <span key={mark}>
                        {config.adjacency.slice(0, -1)}
                        {label}{" "}
                        <b>{formatNumber(totals.wallMarks[mark] ?? null)}</b>
                      </span>
                    ))}
                  </div>
                </>
              )}
              <table className="fireproof-print-table">
                <colgroup>
                  {widths.map((width, index) => (
                    <col key={index} style={{ width: `${width}px` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ height: `${HEAD_HEIGHT}px` }}>
                    <th>階</th>
                    <th>コメント</th>
                    <th>記号</th>
                    <th>倍数</th>
                    <th>取合</th>
                    <th>計算式(有効長)</th>
                    <th>断面必要計算式</th>
                    <th>必要数㎡</th>
                    <th>{config.adjacency}</th>
                    {wallLabels.map((label, mark) => (
                      <th key={mark}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((each) => {
                    // 行番号は表全体での位置（階の引き継ぎ用）
                    const index = sheet.rows.indexOf(each);
                    const floor = floors[index] ?? "";
                    const calc = calcRow(
                      { ...each, floor },
                      list,
                      sheet.thickness,
                    );
                    const hint = sizeHint(list, floor, each.symbol, kind);
                    return (
                      <tr key={each.id} style={{ height: `${ROW_HEIGHT}px` }}>
                        <td>{floor}</td>
                        <td>{each.comment}</td>
                        <td>
                          {each.symbol}
                          {hint ? `　${hint}` : ""}
                        </td>
                        <td className="num">
                          {each.count === null ? "" : each.count}
                        </td>
                        <td>{each.mark}</td>
                        <td>{each.lengthFormula}</td>
                        <td>
                          {each.sectionFormula.trim() !== ""
                            ? each.sectionFormula
                            : calc.sectionText}
                        </td>
                        <td className="num">{formatNumber(calc.needed)}</td>
                        <td className="num">{formatNumber(calc.wall)}</td>
                        {wallLabels.map((_label, mark) => (
                          <td key={mark} className="mark">
                            {each.wallChecks[mark] === true ? "✔" : ""}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {Array.from({ length: blanks }, (_unused, blank) => (
                    <tr
                      className="blank"
                      key={`blank-${blank}`}
                      style={{ height: `${ROW_HEIGHT}px` }}
                    >
                      <td colSpan={widths.length} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

interface Props {
  project: ProjectSummary;
  /** 印刷する入力管理表の行（行IDの配列。1行＝計算書1画面分で最低1枚） */
  rowIds: string[];
}

/**
 * 耐火被覆・塗装入力表の計算書の印刷書式（A3横）。
 * 選んだ行ごとに、その行で選んだ計算書（柱入力表・梁型入力表・汎用計算書）を出す。
 * 1行＝最低1枚。入力が少なく下が空くときは罫線だけ入れて埋める。
 */
export default function FireproofPrintSheet({
  project,
  rowIds,
}: Props): JSX.Element {
  const [rows, setRows] = useState<FireproofManageRow[]>([]);
  const [columnsList, setColumnsList] = useState<FireproofFloorList>({
    floors: [],
    members: [],
  });
  const [beamsList, setBeamsList] = useState<FireproofFloorList>({
    floors: [],
    members: [],
  });

  useEffect(() => {
    void (async () => {
      const record = await window.sekisan.getFireproofSheet(project.id);
      setRows(normalizeManageRows(parseJson(record.estimateJson, [])));
      setColumnsList(normalizeFloorList(parseJson(record.columnsJson, {})));
      setBeamsList(normalizeFloorList(parseJson(record.beamsJson, {})));
    })();
  }, [project.id]);

  const part1List = useMemo(() => inheritedPart1List(rows), [rows]);
  const byId = useMemo(
    () => new Map(rows.map((row, index) => [row.id, { row, index }])),
    [rows],
  );

  return (
    <>
      {rowIds.map((rowId) => {
        const found = byId.get(rowId);
        if (!found) return null;
        const { row, index } = found;
        const part1 = part1List[index] ?? "";
        if (row.calcType === "general") {
          const variables = adjacencyVariables(rows, columnsList, beamsList);
          return (
            <CalcPrintSheet
              key={rowId}
              title={`汎用計算書　${project.managementNo} ${project.name}${part1 ? `　${part1}` : ""}`}
              upper={null}
              sets={row.generalSheet}
              result={evaluateCalcSheet(row.generalSheet, variables)}
            />
          );
        }
        return (
          <div className="calc-print-sheet fireproof-print-sheet" key={rowId}>
            <TablePage
              kind={row.calcType === "beam" ? "beam" : "column"}
              row={row}
              list={row.calcType === "beam" ? beamsList : columnsList}
              title={`${project.managementNo} ${project.name}${part1 ? `　${part1}` : ""}`}
            />
          </div>
        );
      })}
    </>
  );
}
