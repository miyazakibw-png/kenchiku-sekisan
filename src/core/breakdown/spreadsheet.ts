/**
 * エクセル掃き出し（SpreadsheetML 2003 形式）。
 * 外部ライブラリを使わずに複数シート・罫線つきの表を作れるので、完全オフラインでも動く。
 */

import { BREAKDOWN_LAYOUT, type BreakdownRow } from "./breakdown";

export interface SheetData {
  name: string;
  rows: BreakdownRow[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const HEADER = ["名称", "摘要", "数量", "単位", "単価", "金額", "備考"];

/**
 * 行の罫線の種類。
 * one：上下とも罫線あり、upper：1明細の上の行（下の線なし）、lower：下の行（上の線なし）
 */
type RowBorder = "one" | "upper" | "lower";

function style(base: string, border: RowBorder): string {
  if (border === "upper") return `${base}u`;
  if (border === "lower") return `${base}l`;
  return base;
}

function textCell(value: string, border: RowBorder = "one"): string {
  return `<Cell ss:StyleID="${style("b", border)}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function numberCell(value: number | null, border: RowBorder = "one"): string {
  if (value === null) return `<Cell ss:StyleID="${style("b", border)}"/>`;
  return `<Cell ss:StyleID="${style("n", border)}"><Data ss:Type="Number">${value}</Data></Cell>`;
}

/** 見出し（工種科目・タイトル）の1行。列のタテ線を残すため全列分のセルを出す */
function headingRow(name: string, border: RowBorder): string {
  const id = style("h", border);
  const cells = HEADER.map((_title, index) =>
    index === 0 && name !== ""
      ? `<Cell ss:StyleID="${id}"><Data ss:Type="String">${escapeXml(name)}</Data></Cell>`
      : `<Cell ss:StyleID="${id}"/>`,
  );
  return rowXml(cells);
}

/** シート名に使えない文字を置き換える（31文字まで） */
function sheetName(name: string, index: number): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "･").slice(0, 28);
  return cleaned === "" ? `シート${index + 1}` : cleaned;
}

function rowXml(cells: string[]): string {
  return `<Row>${cells.join("")}</Row>`;
}

function bodyRows(rows: readonly BreakdownRow[], layout: number): string[] {
  const lines: string[] = [];
  const twoRowHeading =
    layout === BREAKDOWN_LAYOUT.twoLine || layout === BREAKDOWN_LAYOUT.twoRow;
  rows.forEach((row) => {
    if (row.rowKind === "subject" || row.rowKind === "title") {
      // 2段の書式では工種科目・タイトルの見出しも2行で、文字は下の行に出す
      const text = row.rowKind === "subject" ? row.subjectName : row.nameLower;
      if (twoRowHeading) {
        lines.push(headingRow("", "upper"));
        lines.push(headingRow(text, "lower"));
      } else {
        lines.push(headingRow(text, "one"));
      }
      return;
    }
    if (layout === BREAKDOWN_LAYOUT.excel) {
      // 書式③：2段を1行にまとめて掃き出す
      const name = [row.nameUpper, row.nameLower]
        .filter((v) => v !== "")
        .join(" ");
      const description = [row.descriptionUpper, row.descriptionLower]
        .filter((v) => v !== "")
        .join(" ");
      const remarks = [row.remarksUpper, row.remarksLower]
        .filter((v) => v !== "")
        .join(" ");
      lines.push(
        rowXml([
          textCell(name),
          textCell(description),
          numberCell(row.quantity),
          textCell(row.unit),
          numberCell(row.unitPrice),
          numberCell(row.amount),
          textCell(remarks),
        ]),
      );
      return;
    }
    if (
      layout === BREAKDOWN_LAYOUT.oneLine ||
      layout === BREAKDOWN_LAYOUT.twoRow
    ) {
      // 書式②④：1行に1段だけ書く（書式④は上段（note）と下段（detail）で2行1明細）
      const border: RowBorder =
        layout === BREAKDOWN_LAYOUT.oneLine
          ? "one"
          : row.rowKind === "note"
            ? "upper"
            : row.rowKind === "detail"
              ? "lower"
              : "one";
      lines.push(
        rowXml([
          textCell(row.nameLower, border),
          textCell(row.descriptionLower, border),
          numberCell(row.quantity, border),
          textCell(row.unit, border),
          numberCell(row.unitPrice, border),
          numberCell(row.amount, border),
          textCell(row.remarksLower, border),
        ]),
      );
      return;
    }
    lines.push(
      rowXml([
        textCell(row.nameUpper, "upper"),
        textCell(row.descriptionUpper, "upper"),
        textCell("", "upper"),
        textCell("", "upper"),
        textCell("", "upper"),
        textCell("", "upper"),
        textCell(row.remarksUpper, "upper"),
      ]),
    );
    lines.push(
      rowXml([
        textCell(row.nameLower, "lower"),
        textCell(row.descriptionLower, "lower"),
        numberCell(row.quantity, "lower"),
        textCell(row.unit, "lower"),
        numberCell(row.unitPrice, "lower"),
        numberCell(row.amount, "lower"),
        textCell(row.remarksLower, "lower"),
      ]),
    );
  });
  return lines;
}

function worksheet(sheet: SheetData, index: number, layout: number): string {
  const header = rowXml(
    HEADER.map(
      (title) =>
        `<Cell ss:StyleID="h"><Data ss:Type="String">${title}</Data></Cell>`,
    ),
  );
  const columns = [40, 30, 12, 8, 12, 14, 20]
    .map((width) => `<Column ss:Width="${width * 5}"/>`)
    .join("");
  return `<Worksheet ss:Name="${escapeXml(sheetName(sheet.name, index))}"><Table>${columns}${header}${bodyRows(sheet.rows, layout).join("")}</Table></Worksheet>`;
}

/** 上の線・下の線だけを引く罫線（1明細の上下2行の間に線を出さないため） */
function borders(top: boolean, bottom: boolean): string {
  const list = [
    '<Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>',
    '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>',
  ];
  if (top)
    list.push(
      '<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>',
    );
  if (bottom)
    list.push(
      '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>',
    );
  return `<Borders>${list.join("")}</Borders>`;
}

/** 1明細の上の行（○u）と下の行（○l）の書式を作る */
function pairStyle(base: string): string {
  const extra =
    base === "n"
      ? '<NumberFormat ss:Format="#,##0.00"/><Alignment ss:Horizontal="Right"/>'
      : base === "h"
        ? '<Font ss:Bold="1"/><Interior ss:Color="#EFEFEF" ss:Pattern="Solid"/>'
        : "";
  return [
    `<Style ss:ID="${base}u">${extra}${borders(true, false)}</Style>`,
    `<Style ss:ID="${base}l">${extra}${borders(false, true)}</Style>`,
  ].join("\n");
}

/** 複数シートのブックを作る */
export function toSpreadsheetXml(
  sheets: readonly SheetData[],
  layout: number,
): string {
  const styles = `<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="ＭＳ Ｐゴシック" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="b"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
<Style ss:ID="n"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders><NumberFormat ss:Format="#,##0.00"/><Alignment ss:Horizontal="Right"/></Style>
<Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#EFEFEF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
${pairStyle("b")}
${pairStyle("n")}
${pairStyle("h")}
</Styles>`;
  const body = sheets
    .map((sheet, index) => worksheet(sheet, index, layout))
    .join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${styles}${body}</Workbook>`;
}

/** 工種科目ごとにシートを分ける */
export function splitBySubject(rows: readonly BreakdownRow[]): SheetData[] {
  const sheets: SheetData[] = [];
  rows.forEach((row) => {
    if (row.rowKind === "subject" || sheets.length === 0) {
      sheets.push({ name: row.subjectName, rows: [] });
    }
    sheets[sheets.length - 1].rows.push(row);
  });
  return sheets;
}
