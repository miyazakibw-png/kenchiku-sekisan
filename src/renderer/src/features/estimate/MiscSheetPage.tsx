import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Detail,
  MasterOptions,
  MiscSheet,
  ProjectSummary,
} from "@shared/types";
import {
  cellValue,
  columnTotal,
  isEmptyColumn,
  miscColumn,
  miscRow,
  syncRowsFromEstimate,
  type MiscColumn,
  type MiscRow,
} from "../../../../core/misc/miscSheet";
import MasterCodeInput, {
  MasterCodeOptions,
} from "../../components/MasterCodeInput";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import "./EstimatePartsPage.css";
import "./MiscSheetPage.css";

interface Props {
  project: ProjectSummary;
  options: MasterOptions;
  onBack: () => void;
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** 明細（列）の見出し。上から順に1行ずつ出す */
const HEADS: {
  key: keyof MiscColumn;
  label: string;
  kind: "text" | "number" | "subject" | "unit";
}[] = [
  { key: "subjectId", label: "科目", kind: "subject" },
  { key: "partNumber", label: "部位ID", kind: "number" },
  { key: "detailNumber", label: "名称ID", kind: "number" },
  { key: "partName", label: "部位", kind: "text" },
  { key: "name", label: "名称", kind: "text" },
  { key: "descriptionUpper", label: "摘要(上段)", kind: "text" },
  { key: "descriptionLower", label: "摘要(下段)", kind: "text" },
  { key: "unit", label: "単位", kind: "unit" },
  { key: "remarksUpper", label: "備考(上段)", kind: "text" },
  { key: "remarksLower", label: "備考(下段)", kind: "text" },
];

function numberText(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * 部位別雑・金物入力表。
 * 明細を1列ずつタテに書き、部屋（部位別入力表の行）をヨコに並べて数量を拾う。
 * 集計では「その部屋の計算書に入れた」のと同じ扱いになる。
 */
export default function MiscSheetPage({
  project,
  options,
  onBack,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<MiscSheet | null>(null);
  const [columns, setColumns] = useState<MiscColumn[]>([]);
  const [rows, setRows] = useState<MiscRow[]>([]);
  const [message, setMessage] = useState("");
  const [callOpen, setCallOpen] = useState(false);
  const [callColumn, setCallColumn] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);

  const { markSaved } = useSaveOnLeave({ columns, rows }, () => save(true));

  useEffect(() => {
    void (async () => {
      const loaded = await window.sekisan.getMiscSheet(project.id);
      const nextColumns = parseJson<MiscColumn[]>(loaded.columnsJson, []);
      const nextRows = parseJson<MiscRow[]>(loaded.rowsJson, []);
      setSheet(loaded);
      setColumns(nextColumns.length > 0 ? nextColumns : [miscColumn()]);
      setRows(nextRows);
      markSaved({ columns: nextColumns, rows: nextRows });
    })();
  }, [markSaved, project.id]);

  useEffect(() => {
    if (!callOpen || subjectId === null) {
      setDetails([]);
      return;
    }
    void (async () =>
      setDetails(await window.sekisan.listDetails(subjectId, project.id)))();
  }, [callOpen, project.id, subjectId]);

  const save = useCallback(
    async (quiet = false) => {
      if (!sheet) return;
      const saved = await window.sekisan.saveMiscSheet({
        id: sheet.id,
        columnsJson: JSON.stringify(columns),
        rowsJson: JSON.stringify(rows),
        note: sheet.note,
      });
      setSheet(saved);
      markSaved({ columns, rows });
      if (quiet) return;
      setMessage("保存しました（集計実行で集計書に入ります）");
    },
    [columns, markSaved, rows, sheet],
  );

  /** 部位別入力表の部屋を取り込む（入れてある数量はそのまま残す） */
  const loadRooms = useCallback(async () => {
    const estimateRows = await window.sekisan.listEstimateRows(project.id);
    const next = syncRowsFromEstimate(rows, estimateRows);
    setRows(next);
    setMessage(`部位別入力表から ${next.length} 行を出しました`);
  }, [project.id, rows]);

  const editColumn = useCallback(
    (id: string, patch: Partial<MiscColumn>): void =>
      setColumns((current) =>
        current.map((column) =>
          column.id === id ? { ...column, ...patch } : column,
        ),
      ),
    [],
  );

  const editCell = useCallback(
    (rowId: string, columnId: string, text: string): void =>
      setRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? { ...row, values: { ...row.values, [columnId]: text } }
            : row,
        ),
      ),
    [],
  );

  /** マスターから呼び出して明細（列）に入れる */
  const callDetail = useCallback(
    (detail: Detail) => {
      const target = callColumn ?? columns[columns.length - 1]?.id;
      if (!target) return;
      editColumn(target, {
        subjectId: detail.subjectId,
        materialCategory: detail.materialCategory,
        partNumber: detail.partNumber ?? null,
        detailNumber: detail.detailNumber,
        partName: detail.partName,
        name: detail.name,
        descriptionUpper: detail.descriptionUpper,
        descriptionLower: detail.descriptionLower,
        unit: detail.unit,
        remarksUpper: detail.remarksUpper,
        remarksLower: detail.remarksLower,
        sourceDetailId: detail.id,
      });
      setMessage(`${detail.name} を呼び出しました`);
    },
    [callColumn, columns, editColumn],
  );

  const totals = useMemo(
    () =>
      new Map(
        columns.map((column) => [
          column.id,
          columnTotal({ columns, rows }, column.id),
        ]),
      ),
    [columns, rows],
  );

  const unitEntries = useMemo(
    () => options.units.map((unit) => ({ id: unit.id, name: unit.name })),
    [options.units],
  );

  const headValue = (column: MiscColumn, key: keyof MiscColumn): string => {
    const value = column[key];
    if (value === null) return "";
    return typeof value === "number" ? String(value) : String(value);
  };

  return (
    <div className="estimate-page misc-page">
      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              await save(true);
              onBack();
            })();
          }}
        >
          ← 工事管理画面へ
        </button>
        <h2>部位別雑・金物入力表</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => void loadRooms()}>
          📄 部位別入力表から転記
        </button>
        <button
          type="button"
          onClick={() => setColumns((current) => [...current, miscColumn()])}
        >
          ➕ 明細を足す
        </button>
        <button
          type="button"
          onClick={() =>
            setRows((current) => [...current, miscRow({ part3: "" })])
          }
        >
          ⤓ 行を足す
        </button>
        <button
          type="button"
          className={callOpen ? "on" : ""}
          onClick={() => setCallOpen(!callOpen)}
        >
          📂 マスター呼出
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      <MasterCodeOptions entries={unitEntries} listId="misc-units" />

      {callOpen && (
        <div className="call-window">
          <div className="section-bar">
            <span>
              マスター呼出（明細をクリックで選んだ列に入ります。列は見出しをクリックで選びます）
            </span>
            <button type="button" onClick={() => setCallOpen(false)}>
              ✕ 閉じる
            </button>
          </div>
          <div className="call-subject">
            <span>工種科目（番号で入力）</span>
            <input
              list="misc-subjects"
              onChange={(e) => {
                const text = e.target.value.trim();
                const found =
                  options.subjects.find(
                    (subject) => String(subject.id) === text,
                  ) ??
                  options.subjects.find((subject) => subject.name === text);
                setSubjectId(found?.id ?? null);
              }}
            />
            <datalist id="misc-subjects">
              {options.subjects.map((subject) => (
                <option key={subject.id} value={subject.name}>
                  {subject.id}
                </option>
              ))}
            </datalist>
          </div>
          <ul className="call-list">
            {details.map((detail, index) => (
              <li
                key={`${detail.id}-${index}`}
                tabIndex={0}
                onDoubleClick={() => callDetail(detail)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") callDetail(detail);
                }}
              >
                <span className="scope">
                  {detail.detailNumber?.toFixed(2) ?? ""}
                </span>
                <span className="part">{detail.partName}</span>
                <span className="name">{detail.name}</span>
                <span className="count">{detail.unit}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="misc-table-wrap">
        <table className="grid misc">
          <thead>
            {HEADS.map((head) => (
              <tr key={String(head.key)}>
                <th className="part" colSpan={3}>
                  {head.key === "subjectId" && (
                    <span className="hint">
                      ※明細はタテ1列。数量は計算式でも入れられます
                    </span>
                  )}
                </th>
                <th className="head-label">{head.label}</th>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    className={callColumn === column.id ? "col on" : "col"}
                    onClick={() => setCallColumn(column.id)}
                  >
                    {head.kind === "unit" ? (
                      <MasterCodeInput
                        entries={unitEntries}
                        listId="misc-units"
                        value={column.unit}
                        onChange={(value) =>
                          editColumn(column.id, { unit: value })
                        }
                      />
                    ) : head.kind === "subject" ? (
                      <input
                        value={numberText(column.subjectId)}
                        title="科目ID（数字）"
                        onChange={(e) => {
                          const parsed = Number.parseInt(e.target.value, 10);
                          editColumn(column.id, {
                            subjectId: Number.isNaN(parsed) ? null : parsed,
                          });
                        }}
                      />
                    ) : head.kind === "number" ? (
                      <input
                        value={numberText(
                          head.key === "partNumber"
                            ? column.partNumber
                            : column.detailNumber,
                        )}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const value = Number.isNaN(parsed) ? null : parsed;
                          editColumn(
                            column.id,
                            head.key === "partNumber"
                              ? { partNumber: value }
                              : { detailNumber: value },
                          );
                        }}
                      />
                    ) : (
                      <input
                        lang="ja"
                        value={headValue(column, head.key)}
                        onChange={(e) =>
                          editColumn(column.id, {
                            [head.key]: e.target.value,
                          } as Partial<MiscColumn>)
                        }
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
            <tr className="total-row">
              <th className="part">部位Ⅰ</th>
              <th className="part">部位Ⅱ</th>
              <th className="flag">部位Ⅱ別仕訳</th>
              <th className="head-label">部位Ⅲ／合計</th>
              {columns.map((column) => (
                <th key={column.id} className="num">
                  {isEmptyColumn(column)
                    ? ""
                    : (totals.get(column.id) ?? 0).toFixed(2)}
                  <button
                    type="button"
                    className="drop"
                    title="この明細（列）を消します"
                    onClick={() =>
                      setColumns((current) =>
                        current.filter((each) => each.id !== column.id),
                      )
                    }
                  >
                    🗑
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="part">{row.part1}</td>
                <td className="part">{row.part2}</td>
                <td className="flag">{row.part2Split ? "✔" : ""}</td>
                <td className="room">
                  <input
                    lang="ja"
                    value={row.part3}
                    onChange={(e) =>
                      setRows((current) =>
                        current.map((each) =>
                          each.id === row.id
                            ? { ...each, part3: e.target.value }
                            : each,
                        ),
                      )
                    }
                  />
                </td>
                {columns.map((column) => {
                  const text = row.values[column.id] ?? "";
                  const value = cellValue(text);
                  return (
                    <td
                      key={column.id}
                      className={
                        text !== "" && value === null ? "num error" : "num"
                      }
                      title={
                        value === null ? "" : `計算結果 ${value.toFixed(2)}`
                      }
                    >
                      <input
                        value={text}
                        onChange={(e) =>
                          editCell(row.id, column.id, e.target.value)
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint">
        明細はタテ1列（科目・部位ID・名称ID・部位・名称・摘要・単位・備考）に入れます。
        ヨコの行は「📄
        部位別入力表から転記」で部屋を出し、交わるマスに数量（計算式可）を入れます。
        入れた数量は、その部屋の計算書に入れたのと同じ扱いで集計します（数量根拠にも部屋名で出ます）。
      </p>
    </div>
  );
}
