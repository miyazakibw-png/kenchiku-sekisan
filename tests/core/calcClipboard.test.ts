import { describe, expect, it } from "vitest";
import {
  cellsAsTsv,
  detailAsTsv,
  duplicateDetail,
  duplicateLine,
  duplicateSet,
  rowsAsTsv,
  fillLines,
  fillCells,
  pasteDetails,
  pasteCells,
  pasteLines,
  pasteRows,
  pasteSheet,
  rowsToSets,
  setAsTsv,
} from "../../src/core/room/calcClipboard";
import {
  calcDetail,
  calcLine,
  calcSet,
  commentSet,
  isCommentSet,
} from "../../src/core/room/calcSheet";

describe("セット明細計算表のコピー・貼り付け", () => {
  it("Excelの表を明細として取り込む（足りない行は追加する）", () => {
    const details = [calcDetail(), calcDetail()];
    const text = [
      "床\tビニル床シート\t上\t下\tm2\t1.05\t備上\t備下\tC21",
      "\tモルタル下地",
    ].join("\n");
    const next = pasteDetails(details, 0, text);
    expect(next).toHaveLength(2);
    expect(next[0].name).toBe("ビニル床シート");
    expect(next[0].partName).toBe("床");
    expect(next[0].unit).toBe("m2");
    expect(next[0].coefficient).toBe(1.05);
    expect(next[0].estimateDisplay).toBe("C21");
    expect(next[1].name).toBe("モルタル下地");
    // 掛け率が空欄なら元の値のまま
    expect(next[1].coefficient).toBe(1);
  });

  it("選んだ明細の位置から貼り付け、行数が足りなければ増やす", () => {
    const details = [calcDetail({ name: "元" })];
    const next = pasteDetails(details, 1, "A\t追加1\nB\t追加2");
    expect(next.map((row) => row.name)).toEqual(["元", "追加1", "追加2"]);
  });

  it("Excelの数量表を計算式として取り込む（1列だけなら計算式Ａ）", () => {
    const lines = [calcLine({ bSymbol: "B1" })];
    const next = pasteLines(lines, 0, "3*4.5\n12.30");
    expect(next.map((row) => row.formulaA)).toEqual(["3*4.5", "12.30"]);
    // 記号Ｂはセットに1つなので貼り付けでは動かさない
    expect(next[0].bSymbol).toBe("B1");

    const three = pasteLines([calcLine()], 0, "廊下\t2*3\t1.2");
    expect(three[0]).toMatchObject({
      comment: "廊下",
      formulaA: "2*3",
      formulaB: "1.2",
    });
  });

  it("全角の数字・桁区切りは半角へ直して取り込む", () => {
    const next = pasteLines([calcLine()], 0, "\t１２．５\t2");
    expect(next[0].formulaA).toBe("12.5");
    const details = pasteDetails([calcDetail()], 0, "床\t名称\t\t\tm2\t１.５");
    expect(details[0].coefficient).toBe(1.5);
  });

  it("明細を増やしたら計算式行も1明細1行になるまで足す", () => {
    const details = [calcDetail(), calcDetail(), calcDetail()];
    const lines = [calcLine({ formulaA: "1" }), calcLine()];
    const next = fillLines(details, lines);
    expect(next).toHaveLength(3);
    expect(next[0].formulaA).toBe("1");
    // すでに足りているときは増やさない
    expect(fillLines([calcDetail()], next)).toHaveLength(3);
  });

  it("明細・セットはExcelへ貼れるTSVでコピーする", () => {
    const detail = calcDetail({
      partName: "床",
      name: "シート",
      unit: "m2",
      coefficient: 1.05,
    });
    expect(detailAsTsv(detail).split("\t").slice(0, 3)).toEqual([
      "床",
      "シート",
      "",
    ]);

    const set = calcSet(0);
    set.partName = "床";
    set.details = [detail];
    set.lines = [calcLine({ formulaA: "3*4", comment: "事務室" })];
    const rows = setAsTsv(set).split("\r\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].split("\t")[0]).toBe("床");
    expect(rows[0].split("\t")[10]).toBe("3*4");
  });

  it("選んだ複数行は明細と計算式を並べてコピーする", () => {
    const details = [
      calcDetail({
        partName: "床",
        name: "シート",
        unit: "m2",
        coefficient: 1.05,
      }),
      calcDetail({ name: "下地" }),
    ];
    const lines = [
      calcLine({ comment: "事務室", formulaA: "3*4" }),
      calcLine({ formulaA: "2" }),
    ];
    const rows = rowsAsTsv(details, lines).split("\r\n");
    expect(rows).toHaveLength(2);
    // 明細の列のあとに計算式の列を並べる（明細欄へ貼り直しても列がずれない）
    expect(rows[0].split("\t")).toEqual([
      "床",
      "シート",
      "",
      "",
      "m2",
      "1.05",
      "",
      "",
      "",
      "事務室",
      "3*4",
      "",
    ]);
    expect(rows[1].split("\t")[10]).toBe("2");

    const copied = duplicateLine(lines[0]);
    expect(copied.id).not.toBe(lines[0].id);
    expect(copied.formulaA).toBe("3*4");
    expect(duplicateLine(calcLine({ bSymbol: "B1" })).bSymbol).toBe("");
  });

  it("コピーした行を明細欄へ貼り直しても列がずれない", () => {
    const details = [
      calcDetail({
        partName: "床",
        name: "シート",
        unit: "m2",
        coefficient: 1.05,
        remarksUpper: "備上",
        estimateDisplay: "C21",
      }),
    ];
    const lines = [calcLine({ comment: "事務室", formulaA: "3*4" })];
    const text = rowsAsTsv(details, lines);
    const pasted = pasteRows([calcDetail()], [calcLine()], 0, text);
    expect(pasted.details[0]).toMatchObject({
      partName: "床",
      name: "シート",
      unit: "m2",
      coefficient: 1.05,
      remarksUpper: "備上",
      estimateDisplay: "C21",
    });
    expect(pasted.lines[0]).toMatchObject({
      comment: "事務室",
      formulaA: "3*4",
    });
  });

  it("計算式の列が無いExcelの表は明細だけ入り、計算式はそのまま", () => {
    const pasted = pasteRows(
      [calcDetail()],
      [calcLine({ formulaA: "残す" })],
      0,
      "床	シート			m2	1.05",
    );
    expect(pasted.details[0].name).toBe("シート");
    expect(pasted.lines[0].formulaA).toBe("残す");
  });

  it("写した明細・セットは新しいIDを持ち、記号Ｂは引き継がない", () => {
    const detail = calcDetail({ name: "シート" });
    const copied = duplicateDetail(detail);
    expect(copied.id).not.toBe(detail.id);
    expect(copied.name).toBe("シート");

    const set = calcSet(0);
    set.partName = "床";
    set.details = [detail];
    set.lines = [calcLine({ formulaA: "3*4", bSymbol: "B1" })];
    const copiedSet = duplicateSet(set);
    expect(copiedSet.id).not.toBe(set.id);
    expect(copiedSet.partName).toBe("床");
    expect(copiedSet.details[0].id).not.toBe(detail.id);
    expect(copiedSet.lines[0].formulaA).toBe("3*4");
    expect(copiedSet.lines[0].bSymbol).toBe("");
  });
});

describe("カーソルのある列から貼り付ける", () => {
  it("区分の列（左から2列目）から画面の並びどおりに入る", () => {
    const text =
      "仕上\t34\t10\t12\t床\tビニール床タイル\tt2.5 コンクリート面\t\tm2";
    const pasted = pasteSheet([calcDetail()], [calcLine()], 0, 1, text);
    const detail = pasted.details[0];
    expect(detail.materialCategory).toBe("仕上");
    expect(detail.subjectId).toBe(34);
    expect(detail.partNumber).toBe(10);
    expect(detail.detailNumber).toBe(12);
    expect(detail.partName).toBe("床");
    expect(detail.name).toBe("ビニール床タイル");
    expect(detail.descriptionLower).toBe("t2.5 コンクリート面");
    expect(detail.unit).toBe("m2");
  });

  it("部位ID列への貼り付けは未登録番号を保ち、部位名を変えない", () => {
    const pasted = pasteSheet(
      [
        calcDetail({ partName: "床" }),
        calcDetail({ partName: "天井" }),
      ],
      [calcLine(), calcLine()],
      0,
      3,
      "180\n30.01",
    );

    expect(pasted.details[0]).toMatchObject({
      partNumber: 180,
      partName: "床",
    });
    expect(pasted.details[1]).toMatchObject({
      partNumber: 30.01,
      partName: "天井",
    });
  });

  it("計算式の列から貼り付けるとコメント・計算式に入る（計算で出る欄は変えない）", () => {
    const text = "FA\t1*2\t3";
    const pasted = pasteSheet([calcDetail()], [calcLine()], 0, 12, text);
    expect(pasted.lines[0].comment).toBe("FA");
    expect(pasted.lines[0].formulaA).toBe("1*2");
    expect(pasted.lines[0].formulaB).toBe("3");
  });

  it("※行を含めてコピーした行は、※行の位置のままセットに戻る", () => {
    const details = [calcDetail({ name: "床" }), calcDetail({ name: "壁" })];
    const lines = [calcLine({ formulaA: "1" }), calcLine({ formulaA: "2" })];
    const sets = rowsToSets(
      details,
      lines,
      [{ at: 1, text: "※ 見出し", color: "#dcfce7" }],
      [{ at: 0, partNumber: 3, partName: "床" }],
    );
    expect(
      sets.map((set) => (isCommentSet(set) ? "※" : set.details[0].name)),
    ).toEqual(["床", "※", "壁"]);
    expect(sets[0].partName).toBe("床");
    expect(sets[2].partName).toBe("");
    expect(sets[2].lines[0].formulaA).toBe("2");
  });

  it("※行の2つ目の文字（コメント列）もコピー・貼り付けでそのまま戻る", () => {
    const details = [calcDetail({ name: "床" })];
    const lines = [calcLine({ formulaA: "1" })];
    const sets = rowsToSets(
      details,
      lines,
      [
        {
          at: 1,
          text: "※ 見出し",
          color: "#dcfce7",
          text2: "手洗い部",
        },
      ],
      [{ at: 0, partNumber: 3, partName: "床" }],
    );
    expect(sets[1].banner?.text).toBe("※ 見出し");
    expect(sets[1].banner?.text2).toBe("手洗い部");
  });

  it("複数のセットをまたいでコピーしても、各セットの左端の部位が残る", () => {
    const details = [calcDetail(), calcDetail(), calcDetail()];
    const lines = [calcLine(), calcLine(), calcLine()];
    const sets = rowsToSets(
      details,
      lines,
      [],
      [
        { at: 0, partNumber: 1, partName: "壁" },
        { at: 2, partNumber: 2, partName: "軸組" },
      ],
    );
    expect(sets).toHaveLength(2);
    expect(sets[0].details).toHaveLength(2);
    expect(sets[0].partName).toBe("壁");
    expect(sets[1].details).toHaveLength(1);
    expect(sets[1].partNumber).toBe(2);
    expect(sets[1].partName).toBe("軸組");
  });

  it("部位合計の列を含んでいても、その列は飛ばして右へ入る", () => {
    const text = "m2\t1\t9.99\tFA\t1+2";
    const pasted = pasteSheet([calcDetail()], [calcLine()], 0, 9, text);
    expect(pasted.details[0].unit).toBe("m2");
    expect(pasted.details[0].coefficient).toBe(1);
    expect(pasted.lines[0].comment).toBe("FA");
    expect(pasted.lines[0].formulaA).toBe("1+2");
  });
});

describe("計算表のセル範囲コピー・貼り付け", () => {
  it("コメント行を飛ばして範囲をコピーし、番号を2桁・計算列を空欄にする", () => {
    const first = calcSet(2);
    first.partName = "壁";
    first.details[0] = calcDetail({
      detailNumber: 101.5,
      partName: "内壁",
      name: "塗装",
      coefficient: 1.25,
    });
    first.details[1] = calcDetail({ name: "下地" });
    const second = calcSet(1);
    second.partName = "床";
    second.details[0] = calcDetail({ detailNumber: 2.03, name: "床材" });
    const text = cellsAsTsv(
      [first, commentSet("見出し", "#e2e8f0"), second],
      0,
      2,
      4,
      11,
    );
    const rows = text.split("\r\n").map((row) => row.split("\t"));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["101.50", "内壁", "塗装", "", "", "", "1.25", ""]);
    expect(rows[1][0]).toBe("");
    expect(rows[2][0]).toBe("2.03");
    expect(rows[2][7]).toBe("");
  });

  it("複数セットをまたいで貼り付け、末尾を広げても入力を変えず説明行を保つ", () => {
    const first = calcSet(2);
    first.details[0] = calcDetail({ name: "先頭" });
    first.details[1] = calcDetail({ name: "最後" });
    const second = calcSet(1);
    second.details[0] = calcDetail({ name: "説明", note: true });
    const originalFirst = first.details[1];
    const originalSecond = second.details[0];
    const next = pasteCells(
      [first, commentSet("見出し", "#e2e8f0"), second],
      1,
      2,
      "51\t10\n52\t11\n53\t12",
    );
    expect(next[0].details[1]).toMatchObject({ subjectId: 51, partNumber: 10 });
    expect(next[2].details[0]).toMatchObject({
      subjectId: 52,
      partNumber: 11,
      note: true,
    });
    expect(next[2].details[1]).toMatchObject({
      subjectId: 53,
      partNumber: 12,
    });
    expect(first.details[1]).toBe(originalFirst);
    expect(first.details[1].subjectId).toBeNull();
    expect(second.details[0]).toBe(originalSecond);
    expect(second.details[0].subjectId).toBeNull();
    expect(next[2].details).toHaveLength(2);
  });

  it("範囲の消去は番号と文字を空にし、掛け率と説明行を保つ", () => {
    const set = calcSet(2);
    set.details[0] = calcDetail({
      subjectId: 2,
      partNumber: 3,
      detailNumber: 4.05,
      name: "床",
      coefficient: 0.75,
      note: true,
    });
    set.details[1] = calcDetail({ name: "壁" });
    set.lines[0].comment = "コメント";
    const cleared = fillCells([set], 0, 0, 2, 12, "");
    expect(cleared[0].details[0]).toMatchObject({
      subjectId: null,
      partNumber: null,
      detailNumber: null,
      partName: "",
      name: "",
      coefficient: 0.75,
      note: true,
    });
    expect(cleared[0].lines[0].comment).toBe("");
    expect(set.details[0].name).toBe("床");
    expect(set.details[0].subjectId).toBe(2);
  });

  it("1つの値を選択範囲の全セルへ入れる", () => {
    const set = calcSet(2);
    const filled = fillCells([set], 0, 1, 6, 7, "同じ値");
    expect(
      filled[0].details.map((detail) => [detail.name, detail.descriptionLower]),
    ).toEqual([
      ["同じ値", "同じ値"],
      ["同じ値", "同じ値"],
    ]);
    expect(set.details[0].name).toBe("");
  });
});
