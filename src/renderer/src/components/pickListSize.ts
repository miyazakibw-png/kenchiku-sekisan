/** 候補一覧の高さ（基本320pxに倍率を掛け、入る高さまで） */
export const PICK_LIST_BASE_HEIGHT = 320;

export function pickListHeight(scale: number, available: number): number {
  return Math.min(PICK_LIST_BASE_HEIGHT * scale, available);
}
