import type {
  AggregateItem,
  AggregateItemEdit,
  Subject,
} from "@shared/types";
import { aggregateQuantityText } from "../../../../core/aggregate/aggregate";
import { toTsv } from "@shared/tsv";

export interface AggregateHeadingRow {
  kind: "subject" | "part1" | "part2";
  subjectId: number | null;
  text: string;
}

export type AggregateGridLine =
  | { kind: "heading"; heading: AggregateHeadingRow }
  | { kind: "item"; item: AggregateItem };

export interface AggregateGridCell {
  row: number;
  col: number;
}

export interface AggregateGridRange {
  anchor: AggregateGridCell;
  end: AggregateGridCell;
}

export function initialEdit(item: AggregateItem): AggregateItemEdit {
  return {
    masterKey: item.masterKey,
    subjectId: item.subjectId,
    materialCategory: item.materialCategory,
    partNumber: item.partNumber,
    partName: item.partName,
    detailNumber: item.detailNumber,
    name: item.name,
    descriptionUpper: item.descriptionUpper,
    descriptionLower: item.descriptionLower,
    unit: item.unit,
    remarksUpper: item.remarksUpper,
    remarksLower: item.remarksLower,
    estimateDisplay: item.estimateDisplay,
  };
}

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function buildAggregateGrid(
  lines: readonly AggregateGridLine[],
  edits: Record<string, AggregateItemEdit>,
  subjects: readonly Subject[],
): string[][] {
  const grid: string[][] = [];
  for (const line of lines) {
    if (line.kind === "heading") {
      grid.push([
        line.heading.kind === "subject"
          ? numberText(line.heading.subjectId)
          : "",
        line.heading.text,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      continue;
    }

    const { item } = line;
    const draft = edits[item.masterKey] ?? initialEdit(item);
    const subject = subjects.find((row) => row.id === draft.subjectId);
    grid.push([
      numberText(draft.subjectId),
      subject ? `${subject.id} ${subject.name}` : "",
      draft.materialCategory,
      numberText(draft.partNumber),
      draft.partName,
      draft.descriptionUpper,
      "",
      "",
      draft.remarksUpper,
      draft.estimateDisplay ?? "",
    ]);
    grid.push([
      "",
      "",
      "",
      numberText(draft.detailNumber),
      draft.name,
      draft.descriptionLower,
      item.manual
        ? numberText(draft.quantity ?? item.quantity)
        : aggregateQuantityText(item.quantity, draft.unit),
      draft.unit,
      draft.remarksLower,
      "",
    ]);
  }
  return grid;
}

export function aggregateRangeTsv(
  grid: readonly (readonly string[])[],
  range: AggregateGridRange,
): string {
  const startRow = Math.min(range.anchor.row, range.end.row);
  const endRow = Math.max(range.anchor.row, range.end.row);
  const startCol = Math.min(range.anchor.col, range.end.col);
  const endCol = Math.max(range.anchor.col, range.end.col);
  return toTsv(
    grid
      .slice(startRow, endRow + 1)
      .map((row) => row.slice(startCol, endCol + 1)),
  );
}

export function itemsInGridRange(
  lines: readonly AggregateGridLine[],
  range: AggregateGridRange,
): AggregateItem[] {
  const firstRow = Math.min(range.anchor.row, range.end.row);
  const lastRow = Math.max(range.anchor.row, range.end.row);
  const items: AggregateItem[] = [];
  const seen = new Set<string>();
  let row = 0;
  for (const line of lines) {
    if (line.kind === "heading") {
      row += 1;
      continue;
    }
    if (
      (row >= firstRow && row <= lastRow) ||
      (row + 1 >= firstRow && row + 1 <= lastRow)
    ) {
      if (!seen.has(line.item.masterKey)) {
        items.push(line.item);
        seen.add(line.item.masterKey);
      }
    }
    row += 2;
  }
  return items;
}
