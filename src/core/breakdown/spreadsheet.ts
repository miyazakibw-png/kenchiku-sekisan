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

function textCell(value: string): string {
  return `<Cell ss:StyleID="b"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function numberCell(value: number | null): string {
  if (value === null) return '<Cell ss:StyleID="b"/>';
  return `<Cell ss:StyleID="n"><Data ss:Type="Number">${value}</Data></Cell>`;
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
  rows.forEach((row) => {
    if (row.rowKind === "subject") {
      lines.push(
        rowXml([
          `<Cell ss:StyleID="h"><Data ss:Type="String">${escapeXml(row.subjectName)}</Data></Cell>`,
        ]),
      );
      return;
    }
    if (layout === BREAKDOWN_LAYOUT.excel) {
      // 書式③：2段を1行にまとめて掃き出す
      const name = [row.nameUpper, row.nameLower].filter((v) => v !== "").join(" ");
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
          textCell(remarks),
        ]),
      );
      return;
    }
    if (
      layout === BREAKDOWN_LAYOUT.oneLine ||
      layout === BREAKDOWN_LAYOUT.twoRow
    ) {
      // 書式②④：1行に1段だけ書く
      lines.push(
        rowXml([
          textCell(row.nameLower),
          textCell(row.descriptionLower),
          numberCell(row.quantity),
          textCell(row.unit),
          textCell(row.remarksLower),
        ]),
      );
      return;
    }
    lines.push(
      rowXml([
        textCell(row.nameUpper),
        textCell(row.descriptionUpper),
        '<Cell ss:StyleID="b"/>',
        '<Cell ss:StyleID="b"/>',
        textCell(row.remarksUpper),
      ]),
    );
    lines.push(
      rowXml([
        textCell(row.nameLower),
        textCell(row.descriptionLower),
        numberCell(row.quantity),
        textCell(row.unit),
        textCell(row.remarksLower),
      ]),
    );
  });
  return lines;
}

const HEADER = ["名称", "摘要", "数量", "単位", "備考"];

function worksheet(sheet: SheetData, index: number, layout: number): string {
  const header = rowXml(
    HEADER.map(
      (title) =>
        `<Cell ss:StyleID="h"><Data ss:Type="String">${title}</Data></Cell>`,
    ),
  );
  const columns = [40, 30, 12, 8, 20]
    .map((width) => `<Column ss:Width="${width * 5}"/>`)
    .join("");
  return `<Worksheet ss:Name="${escapeXml(sheetName(sheet.name, index))}"><Table>${columns}${header}${bodyRows(sheet.rows, layout).join("")}</Table></Worksheet>`;
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
