import type { Unit } from "@shared/types";
import { resolveUnitName } from "@shared/units";

interface Props {
  units: Unit[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * 単位入力欄（全画面共通）。
 * 単位マスタのID番号を入力すると単位名へ自動変換する（例: 2 → m2）。
 */
export default function UnitInput({
  units,
  value,
  onChange,
  className,
}: Props): JSX.Element {
  return (
    <input
      className={className}
      list="unit-options"
      value={value}
      title="単位マスタの番号を入力すると単位名に変換されます（1:m 2:m2 3:m3 4:ヶ所 5:枚 7:kg 9:式）"
      placeholder="番号で入力"
      onChange={(e) => onChange(resolveUnitName(units, e.target.value))}
    />
  );
}

export function UnitOptions({ units }: { units: Unit[] }): JSX.Element {
  return (
    <datalist id="unit-options">
      {units.map((u) => (
        <option key={u.id} value={u.name}>
          {u.id}
        </option>
      ))}
    </datalist>
  );
}
