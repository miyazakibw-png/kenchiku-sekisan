export const CALC_COLUMN_WIDTHS_V2_KEY = "calc-sheet-columns-v2";
export const CALC_COLUMN_WIDTHS_V3_KEY = "calc-sheet-columns-v3";

export function migrateCalcColumnWidthsV2ToV3(
  widths: readonly number[],
): number[] {
  const migrated = [...widths];
  if (widths.length >= 4) {
    migrated[1] = widths[3];
    migrated[2] = widths[1];
    migrated[3] = widths[2];
  }
  return migrated;
}

function isColumnWidth(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 28;
}

export function calcPrintColumnWidths(
  screenWidthsV3: readonly number[] | null,
  screenWidthsV2: readonly number[] | null,
  defaults: readonly number[],
): number[] {
  return defaults.map((defaultWidth, printIndex) => {
    const screenIndex = [0, 2, 3, 1][printIndex] ?? printIndex;
    const screenWidth = screenWidthsV3?.[screenIndex];
    if (isColumnWidth(screenWidth)) return screenWidth;

    const legacyWidth = screenWidthsV2?.[printIndex];
    return isColumnWidth(legacyWidth) ? legacyWidth : defaultWidth;
  });
}
