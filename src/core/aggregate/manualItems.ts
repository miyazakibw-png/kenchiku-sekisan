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
 * 番号（部位番号・明細番号）を振った行は番号の順で同じ科目の直近の明細の次に付く。
 * 番号の無い行はアンカー行の直後（before のとき直前）。アンカーが無いとき（元の行が消えた・
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
  /** 番号の並びで比べる（部位番号→明細番号。空はいちばん小さい側） */
  const numRank = (item: AggregatedItem): [number, number] => [
    item.partNumber ?? Number.NEGATIVE_INFINITY,
    item.detailNumber ?? Number.NEGATIVE_INFINITY,
  ];
  const numLess = (a: [number, number], b: [number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  rows.forEach((row) => {
    let item = manualItemOf(row, unusedMasterKeys);
    const anchorIndex = result.findIndex(
      (current) => current.masterKey === row.afterMasterKey,
    );
    // 番号（部位番号・明細番号）を振った説明行は、番号の順で
    // 同じ科目の直近の明細の次に付く（60/101.01→60/101の次）
    if (item.partNumber !== null || item.detailNumber !== null) {
      const subject =
        anchorIndex >= 0 ? result[anchorIndex].subjectId : item.subjectId;
      // 部位番号が無いときは明細番号だけで比べる
      const byDetail = item.partNumber === null;
      const rankOf = (current: AggregatedItem): [number, number] =>
        byDetail
          ? [current.detailNumber ?? Number.NEGATIVE_INFINITY, 0]
          : numRank(current);
      const rank = rankOf(item);
      let at = -1;
      result.forEach((current, index) => {
        if (current.subjectId === subject && numLess(rankOf(current), rank)) {
          at = index;
        }
      });
      const besideIndex = at >= 0 ? at : -1;
      const insertAt = at >= 0 ? at + 1 : -1;
      let first = -1;
      if (insertAt < 0) {
        first = result.findIndex(
          (current) => current.subjectId === subject,
        );
      }
      const pos = insertAt >= 0 ? insertAt : first;
      if (pos >= 0) {
        const beside = result[besideIndex >= 0 ? besideIndex : first];
        item = {
          ...item,
          subjectId: beside.subjectId,
          materialCategory: beside.materialCategory,
          part1: beside.part1,
          part2: beside.part2,
          part2Raw: beside.part2Raw,
        };
        result.splice(pos, 0, item);
        return;
      }
      // 同じ科目の行が無いときはいつものフォールバックへ
    }
    if (anchorIndex >= 0) {
      // 付き先の明細の説明として扱う。科目・部位Ⅰ・部位Ⅱ・材種区分は
      // 付き先と揃える（違うと見出しで分かれてしまう）。番号・部位名は入力した通り
      const anchor = result[anchorIndex];
      item = {
        ...item,
        subjectId: anchor.subjectId,
        materialCategory: anchor.materialCategory,
        part1: anchor.part1,
        part2: anchor.part2,
        part2Raw: anchor.part2Raw,
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
