/**
 * 計算式に使える数量（変数）を作る。
 * 画面（計算書）と集計処理で同じ数量になるよう、ここに1か所だけ置く。
 */

import { computeFitting, type FittingInput } from "../fittings/fitting";
import { reinforcementLength } from "../frame/frame";

/** 記号表の1行（roomSymbols・ceilingSymbols・frameSymbols の共通部分） */
export interface SymbolValue {
  symbol: string;
  value: number | null;
}

/**
 * 建具表から引ける記号。
 * 下段の計算式は上段に建具を書かなくても建具表から直接引用する。
 * 施工高さを渡すと開口部横補強 &lt;記号:RF&gt; も作る（軸組計算書用）。
 */
export function fittingVariables(
  fittings: FittingInput[],
  workHeight: number | null = null,
): Record<string, number> {
  const values: Record<string, number> = {};
  fittings.forEach((fitting) => {
    const computed = computeFitting(fitting);
    if (computed.area !== null) values[`<${fitting.symbol}>`] = computed.area;
    if (fitting.width !== null) values[`<${fitting.symbol}:W>`] = fitting.width;
    if (fitting.height !== null)
      values[`<${fitting.symbol}:H>`] = fitting.height;
    if (computed.baseboardDeduction !== null)
      values[`<${fitting.symbol}:HL>`] = computed.baseboardDeduction;
    if (workHeight !== null) {
      const reinforcement = reinforcementLength(
        {
          width: fitting.width,
          sillHeight: fitting.sillHeight,
          baseboardDeduction: computed.baseboardDeduction,
        },
        workHeight,
      );
      if (reinforcement !== null)
        values[`<${fitting.symbol}:RF>`] = reinforcement;
    }
  });
  return values;
}

/**
 * <X1> のような記号は、かっこ無しの X1 でも書けるようにする。
 * （計算式に手で X1+X2 と打てるようにするため）
 */
export function bareSymbolVariables(
  values: Record<string, number>,
): Record<string, number> {
  const bare: Record<string, number> = {};
  Object.entries(values).forEach(([key, value]) => {
    const matched = /^<([A-Za-z][A-Za-z0-9]*)>$/.exec(key);
    if (matched && !(matched[1] in values)) bare[matched[1]] = value;
  });
  return bare;
}

/** 上段の記号（FA・WA1・AL など）と建具表の記号を合わせた計算式の変数 */
export function calcVariables(
  symbols: SymbolValue[],
  fittings: FittingInput[],
  workHeight: number | null = null,
): Record<string, number> {
  const values: Record<string, number> = {};
  symbols.forEach((item) => {
    if (item.value !== null) values[item.symbol] = item.value;
  });
  const all = { ...values, ...fittingVariables(fittings, workHeight) };
  return { ...bareSymbolVariables(all), ...all };
}
