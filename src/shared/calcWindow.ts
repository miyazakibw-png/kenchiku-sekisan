import type { CalcSet, CalcSheetResult } from "../core/room/calcSheet";

/** いま入力しているセル（記号クリックの差し込み先・呼出の位置に使う） */
export interface CalcFocus {
  setId: string;
  /** detail: 明細欄 / formulaA・formulaB: 計算式欄 */
  area: "detail" | "formulaA" | "formulaB";
  index: number;
}

/** 元の画面 → 明細入力ウィンドウへ渡す内容 */
export interface CalcWindowState {
  /** ウィンドウの見出し（工事名・部屋名） */
  title: string;
  projectId: number;
  /** 上段（図・記号表）を持つ計算書か */
  hasUpper: boolean;
  /** 上段の記号・建具記号（計算式で使える数量） */
  variables: Record<string, number>;
  result: CalcSheetResult;
  sets: CalcSet[];
  /** 明細入力ウィンドウから受け取った最後の版（自分の入力が戻ってきたかの判定に使う） */
  echo: number;
}

/** 明細入力ウィンドウ → 元の画面へ返す入力 */
export interface CalcWindowInput {
  sets: CalcSet[];
  focus: CalcFocus | null;
  rev: number;
}
