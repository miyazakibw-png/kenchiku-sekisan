/**
 * BCS（建築内訳書標準書式）のCSV掃き出し。
 * 1行19列。層コード3段＋階層レベル＋行番号＋行種別（P:見出し A:注記 D:明細 S:小計 T:合計）。
 * 2段1明細は1行にまとめる：K名称下段・L摘要下段・M数量・N単位・O単価・P備考下段・
 * Q部位（名称上段）・R摘要上段・S備考上段。
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

/**
 * 2段2行の書式で作った行を、1明細1行に戻す。
 * 上段の行（note）と、同じ明細の下段の行（detail）をひとつにする。
 */
function mergeTwoLines(rows: readonly BreakdownRow[]): BreakdownRow[] {
  const merged: BreakdownRow[] = [];
  let upper: BreakdownRow | null = null;

  const flushUpper = (): void => {
    if (upper !== null) merged.push(upper);
    upper = null;
  };

  rows.forEach((row) => {
    if (row.rowKind === "note") {
      flushUpper();
      upper = row;
      return;
    }
    if (row.rowKind !== "detail") {
      flushUpper();
      merged.push(row);
      return;
    }
    const above: BreakdownRow | null = upper;
    upper = null;
    if (above === null) {
      merged.push(row);
      return;
    }
    merged.push({
      ...row,
      nameUpper: row.nameUpper === "" ? above.nameLower : row.nameUpper,
      descriptionUpper:
        row.descriptionUpper === ""
          ? above.descriptionLower
          : row.descriptionUpper,
      remarksUpper:
        row.remarksUpper === "" ? above.remarksLower : row.remarksUpper,
    });
  });
  flushUpper();
  return merged;
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

  const merged = mergeTwoLines(rows);

  merged.forEach((row) => {
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
    if (row.unit === "") {
      lines.push(
        line([
          2, 1, subjectNo, "", "", "", "", 4, detailNo, "A",
          row.nameLower === "" ? row.nameUpper : row.nameLower,
          row.descriptionLower,
          "", "", "",
          row.remarksLower,
          row.nameLower === "" ? "" : row.nameUpper,
          row.descriptionUpper,
          row.remarksUpper,
        ]),
      );
      return;
    }
    lines.push(
      line([
        2, 1, subjectNo, "", "", "", "", 4, detailNo, "D",
        row.nameLower,
        row.descriptionLower,
        row.quantity ?? "",
        row.unit,
        0,
        row.remarksLower,
        row.nameUpper,
        row.descriptionUpper,
        row.remarksUpper,
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
