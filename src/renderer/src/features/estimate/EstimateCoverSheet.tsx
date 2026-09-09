import { useEffect, useMemo, useState } from "react";
import type {
  EstimateRowDraft,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import { formatNumber, resolveInherited } from "./estimateRows";
import "./EstimateCoverSheet.css";

/** A3横1枚（1062px）に収まる明細行の数 */
const ROWS_PER_PAGE = 44;

interface Props {
  project: ProjectSummary;
  /** 部位別入力表の全行（小計行も画面のとおり並べる） */
  rows: EstimateRowDraft[];
}

/**
 * 計算書一括印刷の表紙（部位別入力表）。
 * 画面の入力欄の中身をそのまま紙の表として並べる（数量の拾いは各計算書に出る）。
 */
export default function EstimateCoverSheet({
  project,
  rows,
}: Props): JSX.Element {
  const [options, setOptions] = useState<MasterOptions | null>(null);

  useEffect(() => {
    void (async () => {
      setOptions(await window.sekisan.getMasterOptions(project.id));
    })();
  }, [project.id]);

  const inherited = useMemo(() => resolveInherited(rows), [rows]);

  const pages = useMemo(() => {
    const list: { start: number; rows: EstimateRowDraft[] }[] = [];
    for (let start = 0; start < rows.length; start += ROWS_PER_PAGE)
      list.push({ start, rows: rows.slice(start, start + ROWS_PER_PAGE) });
    return list.length > 0 ? list : [{ start: 0, rows: [] }];
  }, [rows]);

  const calcName = (key: string): string =>
    options?.calcSheets.find((sheet) => sheet.key === key)?.name ?? key;

  return (
    <div className="calc-print-sheet estimate-cover-sheet">
      {pages.map((page, index) => (
        <div className="calc-print-page" key={page.start}>
          <div className="calc-print-title">
            部位別入力表　{project.managementNo} {project.name}
            {pages.length > 1 ? `　（${index + 1}／${pages.length}）` : ""}
          </div>
          <table>
            <thead>
              <tr>
                <th className="no">No</th>
                <th>部位Ⅰ</th>
                <th>部位Ⅱ</th>
                <th className="flag">部位Ⅱ別仕訳</th>
                <th>型枠</th>
                <th>部位Ⅲ（部屋名）</th>
                <th className="num">天井高さ</th>
                <th className="num">倍率</th>
                <th>計算書</th>
                <th className="note">備考</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, offset) => {
                const shown = inherited[page.start + offset];
                if (row.rowType === "subtotal")
                  return (
                    <tr key={row.id ?? `sub-${page.start + offset}`}>
                      <td className="no">{page.start + offset + 1}</td>
                      <td />
                      <td />
                      <td className="flag" />
                      <td />
                      <td>{row.part3 || "小計"}</td>
                      <td className="num" />
                      <td className="num" />
                      <td />
                      <td className="note">{row.note}</td>
                    </tr>
                  );
                return (
                  <tr key={row.id ?? `row-${page.start + offset}`}>
                    <td className="no">{page.start + offset + 1}</td>
                    <td>{row.part1 || shown.part1}</td>
                    <td>{row.part2 || shown.part2}</td>
                    <td className="flag">{row.part2Split === 1 ? "✓" : ""}</td>
                    <td>{row.formwork}</td>
                    <td>{row.part3}</td>
                    <td className="num">
                      {row.ceilingHeight === null
                        ? ""
                        : formatNumber(row.ceilingHeight, 2)}
                    </td>
                    <td className="num">{formatNumber(row.multiplier, 2)}</td>
                    <td>{calcName(row.calcType)}</td>
                    <td className="note">{row.note}</td>
                  </tr>
                );
              })}
              {Array.from({
                length: Math.max(0, ROWS_PER_PAGE - page.rows.length),
              }).map((_unused, blank) => (
                <tr className="blank" key={`blank-${blank}`}>
                  {Array.from({ length: 10 }).map((_cell, column) => (
                    <td key={column} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
