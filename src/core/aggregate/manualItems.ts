import type { AggregatedItem } from "./aggregate";

/**
 * 集計書兼工事マスターへ手で挿入した明細行。
 * 計算書を持たないので合算されず、集計のたびに「この行の直後」へ差し込む。
 * masterKey は manual:<id>（計算書から来る明細と決して衝突しない）。
 */

export const MANUAL_KEY_PREFIX = "manual:";

export function manualMasterKey(id: number): string {
  return `${MANUAL_KEY_PREFIX}${id}`;
}

export function isManualMasterKey(masterKey: string): boolean {
  return masterKey.startsWith(MANUAL_KEY_PREFIX);
}

export function manualIdOf(masterKey: string): number | null {
  if (!isManualMasterKey(masterKey)) return null;
  const id = Number(masterKey.slice(MANUAL_KEY_PREFIX.length));
  return Number.isFinite(id) ? id : null;
}

/** DBに残す手入力行（集計行と同じ欄＋挿入位置） */
export interface ManualAggregateRow {
  id: number;
  /** この明細の直後（anchorBeforeのとき直前）に置く（集計行の masterKey） */
  afterMasterKey: string;
  /** true のときその明細の直前に置く */
  before: boolean;
  subjectId: number | null;
  materialCategory: string;
  part1: string;
  part2: string;
  part2Raw: string;
  partNumber: number | null;
  partName: string;
  detailNumber: number | null;
  name: string;
  descriptionUpper: string;
  descriptionLower: string;
  unit: string;
  remarksUpper: string;
  remarksLower: string;
  estimateDisplay: string;
  formwork: string;
  quantity: number;
}

export function manualItemOf(
  row: ManualAggregateRow,
  unusedMasterKeys: ReadonlySet<string>,
): AggregatedItem {
  const masterKey = manualMasterKey(row.id);
  return {
    masterKey,
    part1: row.part1,
    part2: row.part2,
    part2Raw: row.part2Raw,
    part2Order: 0,
    subjectId: row.subjectId,
    materialCategory: row.materialCategory,
    partNumber: row.partNumber,
    partName: row.partName,
    detailNumber: row.detailNumber,
    name: row.name,
    descriptionUpper: row.descriptionUpper,
    descriptionLower: row.descriptionLower,
    unit: row.unit,
    remarksUpper: row.remarksUpper,
    remarksLower: row.remarksLower,
    estimateDisplay: row.estimateDisplay,
    formwork: row.formwork,
    unused: unusedMasterKeys.has(masterKey),
    quantity: row.quantity,
    rooms: [],
    traceIds: [],
  };
}

/**
 * 集計結果へ手入力行を差し込む。
 * アンカー行の直後（before のとき直前）。アンカーが無いとき（元の行が消えた・
 * キーが変わった）は、直後挿入は同じ 科目+部位Ⅰ+部位Ⅱ の最後→同じ科目の最後、
 * 直前挿入は同じ 科目+部位Ⅰ+部位Ⅱ の先頭→同じ科目の先頭、それも無ければ全体の最後。
 * rows は登録順で渡す（手入力行どうしの順序が保たれ、手入力行へ重ねて挿入もできる）。
 */
export function mergeManualItems(
  items: AggregatedItem[],
  rows: readonly ManualAggregateRow[],
  unusedMasterKeys: ReadonlySet<string>,
): AggregatedItem[] {
  const result = [...items];
  rows.forEach((row) => {
    let item = manualItemOf(row, unusedMasterKeys);
    const anchorIndex = result.findIndex(
      (current) => current.masterKey === row.afterMasterKey,
    );
    if (anchorIndex >= 0) {
      // 付き先の明細の説明として扱う。科目・部位Ⅰ・部位Ⅱ・材種区分は
      // 付き先と揃える（違うと見出しで分かれてしまう）。番号は空のときだけ付き先を見せる
      const anchor = result[anchorIndex];
      item = {
        ...item,
        subjectId: anchor.subjectId,
        materialCategory: anchor.materialCategory,
        part1: anchor.part1,
        part2: anchor.part2,
        part2Raw: anchor.part2Raw,
        partNumber: item.partNumber ?? anchor.partNumber,
        partName: item.partName === "" ? anchor.partName : item.partName,
        detailNumber: item.detailNumber ?? anchor.detailNumber,
      };
      let at: number;
      if (row.before) {
        // 直前挿入：その行の直前へ（同じ行の上に挿入済みの手入力行の下に並び、登録順に上から並ぶ）
        at = anchorIndex;
      } else {
        // 直後挿入：同じアンカーに挿入済みの手入力行は飛ばして後ろへ並べる（登録順）
        at = anchorIndex + 1;
        while (at < result.length && isManualMasterKey(result[at].masterKey)) {
          at += 1;
        }
      }
      result.splice(at, 0, item);
      return;
    }
    // 付き先が見つからないときは、置いた場所の隣の明細の科目・部位に揃える
    // （保存されている部位と違う場所へ置くと、見出しが間に入って分かれるため）
    const besideOf = (at: number, before: boolean): void => {
      const beside = before
        ? (result[at] ?? result[at - 1])
        : (result[at - 1] ?? result[at]);
      if (beside === undefined) return;
      item = {
        ...item,
        subjectId: beside.subjectId,
        materialCategory: beside.materialCategory,
        part1: beside.part1,
        part2: beside.part2,
        part2Raw: beside.part2Raw,
      };
    };
    if (row.before) {
      // 直前挿入のアンカーが無いとき：同じ 科目+部位Ⅰ+部位Ⅱ の先頭→同じ科目の先頭
      let firstSameGroup = -1;
      let firstSameSubject = -1;
      result.forEach((current, index) => {
        if (current.subjectId === item.subjectId) {
          if (firstSameSubject < 0) firstSameSubject = index;
          if (
            firstSameGroup < 0 &&
            current.part1 === item.part1 &&
            current.part2 === item.part2
          ) {
            firstSameGroup = index;
          }
        }
      });
      let at: number;
      if (firstSameGroup >= 0) at = firstSameGroup;
      else if (firstSameSubject >= 0) at = firstSameSubject;
      else at = result.length;
      besideOf(at, true);
      result.splice(at, 0, item);
      return;
    }
    let lastSameGroup = -1;
    let lastSameSubject = -1;
    result.forEach((current, index) => {
      if (current.subjectId === item.subjectId) {
        lastSameSubject = index;
        if (current.part1 === item.part1 && current.part2 === item.part2) {
          lastSameGroup = index;
        }
      }
    });
    let at: number;
    if (lastSameGroup >= 0) at = lastSameGroup + 1;
    else if (lastSameSubject >= 0) at = lastSameSubject + 1;
    else at = result.length;
    besideOf(at, false);
    result.splice(at, 0, item);
  });
  return result;
}
