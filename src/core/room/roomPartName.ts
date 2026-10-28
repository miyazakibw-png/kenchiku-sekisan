import { toHalfWidth } from "../text/halfWidth";

/** 部位名の「室名」を部屋名（半角）に置きかえる。部屋名が空なら何もしない */
export function fillRoomName(
  partName: string,
  roomPartName: string | undefined,
): string {
  const name = toHalfWidth(roomPartName ?? "").trim();
  if (name === "" || !partName.includes("室名")) return partName;
  return partName.replaceAll("室名", name);
}
