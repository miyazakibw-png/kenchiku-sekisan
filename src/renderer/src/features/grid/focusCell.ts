/**
 * カーソルを欄に移す。画面はエクセルのように、欄が見えている間は動かさず、
 * 上下左右の端から外れるときだけその分（貼り付いた見出し行に隠れる分も）を送る
 */
export function focusCell(field: HTMLElement): void {
  field.focus({ preventScroll: true });
  const table = field.closest("table");
  const headCell = table?.tHead?.querySelector("th");
  // 貼り付いている見出し行の下端。欄がこの下に来るまで送る
  const headBottom =
    headCell && getComputedStyle(headCell).position === "sticky"
      ? headCell.getBoundingClientRect().bottom
      : null;
  for (let node = field.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrollsY =
      /auto|scroll/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight;
    const scrollsX =
      /auto|scroll/.test(style.overflowX) &&
      node.scrollWidth > node.clientWidth;
    if (!scrollsY && !scrollsX) continue;
    const box = node.getBoundingClientRect();
    const cell = field.getBoundingClientRect();
    if (scrollsY) {
      const edge = box.top + node.clientTop;
      const top =
        headBottom !== null && table && node.contains(table)
          ? Math.max(edge, headBottom)
          : edge;
      const bottom = box.top + node.clientTop + node.clientHeight;
      if (cell.top < top) node.scrollTop -= top - cell.top;
      else if (cell.bottom > bottom) node.scrollTop += cell.bottom - bottom;
    }
    if (scrollsX) {
      const left = box.left + node.clientLeft;
      const right = left + node.clientWidth;
      if (cell.left < left) node.scrollLeft -= left - cell.left;
      else if (cell.right > right) node.scrollLeft += cell.right - right;
    }
  }
}
