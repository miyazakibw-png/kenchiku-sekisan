/** 科目をまとめて変える行の✔を付け外しする（shift＝前に押した行からここまで同じ状態にする） */
export function toggleBulkCheck(
  order: readonly string[],
  checked: ReadonlySet<string>,
  key: string,
  anchor: string | null,
  shift: boolean,
): Set<string> {
  const next = new Set(checked);
  const checkedNow = !checked.has(key);
  const anchorIndex = shift && anchor !== null ? order.indexOf(anchor) : -1;
  const keyIndex = order.indexOf(key);

  if (anchorIndex >= 0 && keyIndex >= 0) {
    const first = Math.min(anchorIndex, keyIndex);
    const last = Math.max(anchorIndex, keyIndex);
    for (const rangeKey of order.slice(first, last + 1)) {
      if (checkedNow) next.add(rangeKey);
      else next.delete(rangeKey);
    }
  } else if (checkedNow) {
    next.add(key);
  } else {
    next.delete(key);
  }

  return next;
}
