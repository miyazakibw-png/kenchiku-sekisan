/**
 * エクセル（.xlsx）の書き出し。
 * 外部ライブラリを使わずに zip（Node の zlib）と XML だけで作るので、完全オフラインでも動く。
 */

import { deflateRawSync } from "zlib";

/**
 * セルの見た目。text：文字、number：数字（右寄せ・#,##0.00）、header：見出し（太字・灰色）、
 * wrap：セルの中で改行する文字（エクセルの Alt+Enter と同じ）
 */
export type XlsxCellKind = "text" | "number" | "header" | "wrap";

/**
 * 行の罫線。
 * one：上下とも線あり、upper：1明細の上の行（下の線なし）、lower：下の行（上の線なし）
 */
export type XlsxBorder = "one" | "upper" | "lower";

export interface XlsxCell {
  value: string | number | null;
  kind: XlsxCellKind;
  border: XlsxBorder;
}

export interface XlsxSheet {
  name: string;
  /** 列幅（文字数）。省ける */
  columnWidths?: number[];
  rows: XlsxCell[][];
}

const KINDS: XlsxCellKind[] = ["text", "number", "header", "wrap"];
const BORDERS: XlsxBorder[] = ["one", "upper", "lower"];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // エクセルが読めない制御文字は落とす
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** 列番号（0始まり）を A, B, ... AA へ直す */
export function columnName(index: number): string {
  let rest = index;
  let name = "";
  while (rest >= 0) {
    name = String.fromCharCode(65 + (rest % 26)) + name;
    rest = Math.floor(rest / 26) - 1;
  }
  return name;
}

/** シート名に使えない文字を置き換える（31文字まで・重複は連番） */
export function xlsxSheetName(
  name: string,
  index: number,
  used: string[],
): string {
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

/** 書式の並び順（種類×罫線）。styles.xml の cellXfs と同じ並びにする */
function styleIndex(cell: XlsxCell): number {
  return KINDS.indexOf(cell.kind) * BORDERS.length + BORDERS.indexOf(cell.border);
}

function borderXml(border: XlsxBorder): string {
  const top = border === "one" || border === "upper" ? "<top style=\"thin\"/>" : "<top/>";
  const bottom =
    border === "one" || border === "lower" ? "<bottom style=\"thin\"/>" : "<bottom/>";
  return `<border><left style="thin"/><right style="thin"/>${top}${bottom}<diagonal/></border>`;
}

function stylesXml(): string {
  const borders = BORDERS.map(borderXml).join("");
  const xfs = KINDS.flatMap((kind) =>
    BORDERS.map((border) => {
      const fontId = kind === "header" ? 1 : 0;
      const fillId = kind === "header" ? 2 : 0;
      const numFmtId = kind === "number" ? 176 : 0;
      const alignment =
        kind === "number"
          ? '<alignment vertical="center" horizontal="right"/>'
          : kind === "wrap"
            ? '<alignment vertical="center" wrapText="1"/>'
            : '<alignment vertical="center"/>';
      return `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${BORDERS.indexOf(border)}" xfId="0" applyBorder="1" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1">${alignment}</xf>`;
    }),
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="176" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="10"/><name val="ＭＳ Ｐゴシック"/></font><font><b/><sz val="10"/><name val="ＭＳ Ｐゴシック"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="${BORDERS.length}">${borders}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${KINDS.length * BORDERS.length}">${xfs}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function cellXml(cell: XlsxCell, reference: string): string {
  const style = styleIndex(cell);
  if (cell.value === null || cell.value === "") {
    return `<c r="${reference}" s="${style}"/>`;
  }
  if (typeof cell.value === "number") {
    return `<c r="${reference}" s="${style}"><v>${cell.value}</v></c>`;
  }
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols =
    sheet.columnWidths && sheet.columnWidths.length > 0
      ? `<cols>${sheet.columnWidths
          .map(
            (width, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
          )
          .join("")}</cols>`
      : "";
  const rows = sheet.rows
    .map((cells, rowIndex) => {
      const body = cells
        .map((cell, columnIndex) =>
          cellXml(cell, `${columnName(columnIndex)}${rowIndex + 1}`),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${body}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** zip を組み立てる（.xlsx は zip の中に XML を並べたもの） */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  });
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

/** シートを並べて .xlsx のファイル中身を作る */
export function toXlsx(sheets: readonly XlsxSheet[]): Buffer {
  const used: string[] = [];
  const named = sheets.map((sheet, index) => ({
    ...sheet,
    name: xlsxSheetName(sheet.name, index, used),
  }));
  named.forEach((sheet) => used.push(sheet.name));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${named
  .map(
    (_sheet, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("\n")}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("")}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("")}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml(), "utf8") },
    ...named.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: Buffer.from(sheetXml(sheet), "utf8"),
    })),
  ];
  return zip(entries);
}
