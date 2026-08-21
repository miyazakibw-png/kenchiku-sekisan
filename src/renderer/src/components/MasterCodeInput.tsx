import { resolveMasterName } from "@shared/masters";

interface Entry {
  id: number;
  name: string;
}

interface Props {
  entries: Entry[];
  value: string;
  onChange: (value: string) => void;
  /** datalist の id。同じマスターを使う画面で共有する */
  listId: string;
  className?: string;
  title?: string;
}

/**
 * マスターの番号で入力する共通欄（全画面共通の入力方式）。
 * 番号を入力するとマスターの名称へ変換する。
 * マスターに無い文字も入力できる（入力してある文字を優先する）。
 */
export default function MasterCodeInput({
  entries,
  value,
  onChange,
  listId,
  className,
  title,
}: Props): JSX.Element {
  return (
    <input
      className={className}
      list={listId}
      value={value}
      title={title ?? "マスターの番号を入力すると名称に変換されます"}
      placeholder="番号で入力"
      onChange={(e) => onChange(resolveMasterName(entries, e.target.value))}
    />
  );
}

export function MasterCodeOptions({
  entries,
  listId,
}: {
  entries: Entry[];
  listId: string;
}): JSX.Element {
  return (
    <datalist id={listId}>
      {entries.map((entry) => (
        <option key={entry.id} value={entry.name}>
          {entry.id}
        </option>
      ))}
    </datalist>
  );
}
