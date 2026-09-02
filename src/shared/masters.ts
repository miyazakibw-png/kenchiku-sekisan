/**
 * 番号入力でマスターの名称へ変換する共通処理（全画面共通の入力方式）。
 * 数字のみの入力をマスターのIDとして扱い、該当が無い場合や
 * 文字入力はそのまま返す（マスターに無い文字も許容する）。
 */
export function resolveMasterName(
  entries: { id: number; name: string }[],
  input: string,
): string {
  if (!/^\d+$/.test(input)) return input;
  const found = entries.find((entry) => entry.id === Number(input));
  return found ? found.name : input;
}
