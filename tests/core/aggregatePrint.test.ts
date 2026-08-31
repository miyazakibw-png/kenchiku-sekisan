import { describe, expect, it } from "vitest";
import {
  aggregatePrintRows,
  paginateAggregateRows,
  type AggregatePrintItem,
} from "../../src/core/print/aggregatePrint";

function item(
  overrides: Partial<AggregatePrintItem> & { masterKey: string },
): AggregatePrintItem {
  return {
    subjectId: 1,
    part1: "躯体",
    part2: "1階",
    materialCategory: "仕上",
    partNumber: 10,
    partName: "床",
    detailNumber: 1,
    name: "ビニル床シート",
    descriptionUpper: "厚2.0",
    descriptionLower: "t=2.0",
    unit: "m2",
    remarksUpper: "",
    remarksLower: "",
    unused: false,
    quantity: 12.5,
    rooms: [
      { roomName: "1階：事務室", quantity: 8 },
      { roomName: "1階：会議室", quantity: 4.5 },
    ],
    ...overrides,
  };
}

const subjectName = (id: number | null): string => (id === null ? "" : `科目${id}`);

describe("集計書の印刷", () => {
  it("明細の下に数量根拠（部屋ごとの拾い）を並べる", () => {
    const rows = aggregatePrintRows([item({ masterKey: "a" })], subjectName);
    expect(rows.map((row) => row.kind)).toEqual([
      "heading",
      "heading",
      "heading",
      "item",
      "room",
      "room",
    ]);
    const detail = rows[3];
    if (detail.kind !== "item") throw new Error("明細行ではありません");
    expect(detail.name).toBe("床 / ビニル床シート");
    expect(detail.quantity).toBe("12.50");
    const room = rows[4];
    if (room.kind !== "room") throw new Error("根拠行ではありません");
    expect(room.roomName).toBe("1階：事務室");
    expect(room.quantity).toBe("8.00");
  });

  it("明細と最初の根拠は同じページに置き、残りの部屋は次のページの続きから出す", () => {
    const rows = aggregatePrintRows(
      [
        item({ masterKey: "a" }),
        item({
          masterKey: "b",
          name: "タイルカーペット",
          detailNumber: 2,
          rooms: [
            { roomName: "1階：応接室", quantity: 3 },
            { roomName: "1階：廊下", quantity: 2 },
          ],
        }),
      ],
      subjectName,
    );
    // 見出し3行＋明細＋根拠2行＝6行、次の明細＋根拠2行＝3行
    const pages = paginateAggregateRows(rows, 7);
    expect(pages).toHaveLength(2);
    // 明細だけがページの最後に残らない
    expect(pages[0][pages[0].length - 1].kind).toBe("room");
    const head = pages[1][0];
    if (head.kind !== "item") throw new Error("2ページ目は明細から始まります");
    expect(head.name).toBe("床 / タイルカーペット");
  });

  it("根拠が途中で切れたときは、続きの部屋から次のページに出す", () => {
    const rows = aggregatePrintRows(
      [
        item({
          masterKey: "a",
          rooms: [
            { roomName: "1階：事務室", quantity: 8 },
            { roomName: "1階：会議室", quantity: 4.5 },
            { roomName: "1階：倉庫", quantity: 2 },
          ],
        }),
      ],
      subjectName,
    );
    const pages = paginateAggregateRows(rows, 5);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(5);
    const head = pages[1][0];
    if (head.kind !== "room") throw new Error("続きの部屋から始まります");
    expect(head.roomName).toBe("1階：会議室");
    expect(head.continued).toBe(true);
    expect(head.itemName).toBe("ビニル床シート");
  });
});
