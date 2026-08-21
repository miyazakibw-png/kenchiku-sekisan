/**
 * BCS（建築内訳書標準書式）のCSV掃き出し。
 * 1行19列。層コード3段＋階層レベル＋行番号＋行種別（P:見出し A:注記 D:明細 S:小計 T:合計）。
 */

import type { BreakdownRow } from "./breakdown";

export interface BcsOptions {
  /** 表紙の工事名称 */
  projectName: string;
  /** 2層目の工事区分（建築主体工事など） */
  workCategory: string;
}

const COLUMNS = 19;

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function line(cells: (string | number | null)[]): string {
  const row = Array.from({ length: COLUMNS }, (_, index) => {
    const cell = cells[index];
    if (cell === undefined || cell === null || cell === "") return "";
    return typeof cell === "number" ? String(cell) : quote(cell);
  });
  return row.join(",");
}

/** 内訳書の行をBCS形式のCSV文字列にする（改行はCRLF） */
export function toBcsCsv(
  rows: readonly BreakdownRow[],
  options: BcsOptions,
): string {
  const lines: string[] = [];
  // 1層目：表紙
  lines.push(line([1, "", "", "", "", "", "", "", "", "P", options.projectName, "", 1, "式", 0]));
  // 2層目：総括表・工事区分
  lines.push(line([2, "", "", "", "", "", "", 1, "", "P", "総括表", "", 0, "", 0]));
  lines.push(line([2, 1, "", "", "", "", "", 2, "", "P", options.workCategory, "", 0, "", 0]));

  let subjectNo = 0;
  let detailNo = 0;
  let open = false;

  const closeSubject = (): void => {
    if (!open) return;
    lines.push(line([2, 1, subjectNo, "", "", "", "", 4, "", "T", "合　計"]));
    open = false;
  };

  rows.forEach((row) => {
    if (row.rowKind === "subject") {
      closeSubject();
      subjectNo += 1;
      detailNo = 0;
      open = true;
      lines.push(
        line([2, 1, subjectNo, "", "", "", "", 3, "", "P", row.subjectName, "", 0, "", 0]),
      );
      return;
    }
    if (row.rowKind === "blank") return;
    if (!open) {
      subjectNo += 1;
      detailNo = 0;
      open = true;
    }
    detailNo += 1;
    const name = [row.nameUpper, row.nameLower].filter((v) => v !== "").join(" ");
    if (row.rowKind === "note" || row.unit === "") {
      lines.push(
        line([
          2, 1, subjectNo, "", "", "", "", 4, detailNo, "A",
          name,
          row.descriptionLower,
        ]),
      );
      return;
    }
    lines.push(
      line([
        2, 1, subjectNo, "", "", "", "", 4, detailNo, "D",
        name,
        row.descriptionLower,
        row.quantity ?? "",
        row.unit,
        0,
        "",
        row.remarksLower,
      ]),
    );
  });

  closeSubject();
  // 各層の合計
  lines.push(line([2, 1, "", "", "", "", "", 3, "", "T", "合　計"]));
  lines.push(line([2, "", "", "", "", "", "", 2, "", "T", "合　計"]));
  lines.push(line([1, "", "", "", "", "", "", "", "", "T", "合　計"]));

  return `${lines.join("\r\n")}\r\n`;
}
