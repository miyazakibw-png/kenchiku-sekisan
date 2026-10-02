import { describe, expect, it } from "vitest";
import {
  applyFloorCount,
  beamFloorLabels,
  columnFloorLabels,
  fireproofId,
  formatSizeInput,
  newCommonRow,
  newMember,
  normalizeCommonRows,
  parseSizeInput,
  resolveCommonRow,
  resolveSize,
  sizeFromInput,
  toHalfWidth,
  type FireproofFloorList,
  type FireproofMember,
} from "../../src/core/fireproof/fireproofList";

function floorList(
  labels: string[],
  members: FireproofMember[] = [],
): FireproofFloorList {
  return {
    floors: labels.map((label) => ({ id: fireproofId("f"), label })),
    members,
  };
}

describe("耐火被覆・塗装のリスト", () => {
  it("階数から階の名を作る（柱＝上から順に下がり、梁＝一番上がＲ）", () => {
    expect(columnFloorLabels(5)).toEqual(["5", "4", "3", "2", "1"]);
    expect(beamFloorLabels(5)).toEqual(["R", "5", "4", "3", "2"]);
    expect(beamFloorLabels(1)).toEqual(["R"]);
    expect(columnFloorLabels(0)).toEqual([]);
  });

  it("階数を直すと行を作り直す（手で足した中2階・塔屋の行は残す）", () => {
    const list = floorList(["5", "4", "3", "2", "1"]);
    // 4と3の間に「中2階」を足した想定
    list.floors.splice(2, 0, { id: "mid", label: "中2階", manual: true });
    const next = applyFloorCount(list, columnFloorLabels(3));
    expect(next.floors.map((floor) => floor.label)).toEqual([
      "3",
      "2",
      "中2階",
      "1",
    ]);
  });

  it("寸法は「数字*数字」の1マスで読む（区切りは＊・×・x・空白も同じ）", () => {
    expect(parseSizeInput("250*125")).toEqual([250, 125]);
    expect(parseSizeInput("250＊125")).toEqual([250, 125]);
    expect(parseSizeInput("250x125")).toEqual([250, 125]);
    expect(parseSizeInput("250 125")).toEqual([250, 125]);
    expect(parseSizeInput("300")).toEqual([300]);
    expect(parseSizeInput("")).toEqual([]);
  });

  it("1マスに打った寸法をＷ・Ｄへ分ける", () => {
    const size = sizeFromInput(
      { shape: "", first: 100, second: 200 },
      "300*400",
    );
    expect(size.first).toBe(300);
    expect(size.second).toBe(400);
    expect(formatSizeInput(size)).toBe("300*400");
    expect(formatSizeInput({ shape: "h", first: 300, second: null })).toBe(
      "300",
    );
  });

  it("柱の寸法が空なら下の階の数字を使う（Ｗ→Ｄの順）", () => {
    const list = floorList(["4", "3", "2", "1"]);
    const member = newMember("C1");
    // 2階と1階にだけ寸法がある
    member.sizes[list.floors[2].id] = { shape: "box", first: 400, second: 400 };
    member.sizes[list.floors[3].id] = { shape: "box", first: 450, second: 450 };
    // 4階（一番上）は2階の400を引き継ぐ
    const top = resolveSize(member, list.floors, 0, "column");
    expect(top.first).toBe(400);
    expect(top.second).toBe(400);
    expect(top.inherited).toBe(true);
    expect(top.shape).toBe("box");
  });

  it("柱は□でもＷとＤが違うものを入れられる（空欄だけ下の階を使う）", () => {
    const list = floorList(["2", "1"]);
    const member = newMember("C1");
    member.sizes[list.floors[0].id] = {
      shape: "box",
      first: 300,
      second: 200,
    };
    const resolved = resolveSize(member, list.floors, 0, "column");
    expect(resolved.first).toBe(300);
    expect(resolved.second).toBe(200);
    // Ｗだけ入れたとき、Ｄは下の階から引き継ぐ（Ｈ鋼と同じ決まり）
    const half = newMember("C2");
    half.sizes[list.floors[0].id] = {
      shape: "box",
      first: 300,
      second: null,
    };
    half.sizes[list.floors[1].id] = {
      shape: "box",
      first: 500,
      second: 450,
    };
    expect(resolveSize(half, list.floors, 0, "column").second).toBe(450);
  });

  it("梁の寸法が空なら下の階の数字を使う（Ｈ→Ｗの順）", () => {
    const list = floorList(["R", "2", "1"]);
    const member = newMember("G1");
    member.sizes[list.floors[1].id] = { shape: "h", first: 400, second: 200 };
    const top = resolveSize(member, list.floors, 0, "beam");
    expect(top.first).toBe(400);
    expect(top.second).toBe(200);
    expect(top.shape).toBe("h");
  });

  it("階共通リスト：形の初期はＨ、□でもＷとＤは別々に入る", () => {
    const empty = resolveCommonRow({
      id: "c1",
      symbol: "P1",
      shape: "",
      first: 250,
      second: null,
    });
    expect(empty.shape).toBe("h");
    expect(empty.first).toBe(250);
    expect(empty.second).toBeNull();
    const box = resolveCommonRow({
      id: "c2",
      symbol: "B1",
      shape: "box",
      first: 300,
      second: 100,
    });
    expect(box.shape).toBe("box");
    expect(box.second).toBe(100);
  });

  it("階共通リストの形状は基本Ｈ（新しい行・空欄の古い保存も）", () => {
    expect(newCommonRow("P1").shape).toBe("h");
    const rows = normalizeCommonRows([
      { id: "c1", symbol: "P1", shape: "", first: null, second: null },
      { id: "c2", symbol: "B1", shape: "box", first: null, second: null },
    ]);
    expect(rows.map((row) => row.shape)).toEqual(["h", "box"]);
  });

  it("全角で打った記号・寸法は半角にする（日本語変換は使わない）", () => {
    expect(toHalfWidth("Ｃ１")).toBe("C1");
    expect(toHalfWidth("２５０＊１２５")).toBe("250*125");
    expect(parseSizeInput("２５０＊１２５")).toEqual([250, 125]);
  });
});
