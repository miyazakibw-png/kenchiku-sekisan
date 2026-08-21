/**
 * 画面の表をそのままエクセル（SpreadsheetML 2003）へ掃き出す。
 * 入力表ごとに1シートで、式は入れず数字と文字だけの閲覧用。
 */

export interface ScreenSheet {
  /** シート名（入力表の名前） */
  name: string;
  /** 1行目は見出し。セルは画面の表示文字そのまま */
  rows: string[][];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 数字だけのセルは数値として書き出す（桁区切りは外す） */
export function numberOf(value: string): number | null {
  const text = value.trim().replace(/,/g, "");
  if (text === "" || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function cell(value: string, style: string): string {
  const numeric = style === "h" ? null : numberOf(value);
  if (numeric !== null) {
    return `<Cell ss:StyleID="n"><Data ss:Type="Number">${numeric}</Data></Cell>`;
  }
  if (value === "") return `<Cell ss:StyleID="${style}"/>`;
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

/** シート名に使えない文字を置き換える（31文字まで・重複は連番） */
export function sheetName(name: string, index: number, used: string[]): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "･").slice(0, 28);
  const base = cleaned === "" ? `シート${index + 1}` : cleaned;
  let candidate = base;
  let serial = 2;
  while (used.includes(candidate)) {
    candidate = `${base}(${serial})`;
    serial += 1;
  }
  return candidate;
}

function worksheet(sheet: ScreenSheet, index: number, used: string[]): string {
  const name = sheetName(sheet.name, index, used);
  used.push(name);
  const rows = sheet.rows
    .map((row, rowIndex) =>
      `<Row>${row.map((value) => cell(value, rowIndex === 0 ? "h" : "b")).join("")}</Row>`,
    )
    .join("");
  return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${rows}</Table></Worksheet>`;
}

const STYLES = `<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="ＭＳ Ｐゴシック" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="b"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
<Style ss:ID="n"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders><Alignment ss:Horizontal="Right"/></Style>
<Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#EFEFEF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
</Styles>`;

/** 入力表ごとに1シートのブックを作る */
export function toScreenXml(sheets: readonly ScreenSheet[]): string {
  const used: string[] = [];
  const body = sheets
    .map((sheet, index) => worksheet(sheet, index, used))
    .join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${STYLES}${body}</Workbook>`;
}
