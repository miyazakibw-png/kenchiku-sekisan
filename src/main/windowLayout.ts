import type { Rectangle } from "electron";

export function splitHalves(workArea: Rectangle): {
  left: Rectangle;
  right: Rectangle;
} {
  const leftWidth = Math.floor(workArea.width / 2);
  return {
    left: {
      x: workArea.x,
      y: workArea.y,
      width: leftWidth,
      height: workArea.height,
    },
    right: {
      x: workArea.x + leftWidth,
      y: workArea.y,
      width: workArea.width - leftWidth,
      height: workArea.height,
    },
  };
}
