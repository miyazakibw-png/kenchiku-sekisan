/** 見出し行を上に固定するときの、行ごとの上端位置を求める */
export function stickyTops(
  toolbarHeight: number,
  rowHeights: readonly number[],
): number[] {
  const tops: number[] = [];
  let top = toolbarHeight;
  for (const height of rowHeights) {
    tops.push(top);
    top += height;
  }
  return tops;
}
