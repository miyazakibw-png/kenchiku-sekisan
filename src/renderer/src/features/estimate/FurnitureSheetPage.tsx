import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FurnitureSheet,
  MasterEntry,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import {
  applyFurnitureDetails,
  furnitureRow,
  furnitureSettings,
  resolveFurnitureRows,
  rowQuantity,
  type FurnitureDetail,
  type FurnitureRow,
  type FurnitureSettings,
  type FurnitureSymbol,
} from "../../../../core/furniture/furnitureSheet";
import { PickInput, type PickEntry } from "../../components/PickInput";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import "./EstimatePartsPage.css";
import "./FurnitureSheetPage.css";

interface Props {
  project: ProjectSummary;
  options: MasterOptions;
  sheetId: number;
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

function pickMaster(
  entries: MasterEntry[],
  text: string,
): { id: number | null; name: string } {
  const value = text.trim();
  if (value === "") return { id: null, name: "" };
  const byId = entries.find((entry) => String(entry.id) === value);
  if (byId) return { id: byId.id, name: byId.name };
  const byName = entries.find((entry) => entry.name === value);
  if (byName) return { id: byName.id, name: byName.name };
  return { id: null, name: value };
}

/** 入力欄の列（表示・非表示を切り替えられる） */
const INPUT_COLUMNS: { key: string; label: string; forDetail: boolean }[] = [
  { key: "subjectId", label: "科目", forDetail: true },
  { key: "partNumber", label: "部位ID", forDetail: true },
  { key: "detailNumber", label: "名称ID", forDetail: true },
  { key: "part", label: "部位", forDetail: false },
  { key: "partAdd", label: "+部位", forDetail: false },
  { key: "partSymbol", label: "+部位(記号)", forDetail: false },
  { key: "nameSymbol", label: "名称", forDetail: false },
  { key: "width", label: "W", forDetail: false },
  { key: "height", label: "H", forDetail: false },
  { key: "depth", label: "D", forDetail: false },
  { key: "quantity", label: "数量", forDetail: false },
  { key: "unit", label: "単位", forDetail: false },
  { key: "descriptionUpper", label: "摘要(上段)", forDetail: false },
  { key: "remarksLower", label: "備考(下段)", forDetail: false },
];

/** 右側の明細欄の列 */
const DETAIL_COLUMNS: { key: keyof FurnitureDetail; label: string }[] = [
  { key: "subjectId", label: "科目" },
  { key: "partNumber", label: "部位ID" },
  { key: "detailNumber", label: "名称ID" },
  { key: "partName", label: "部位" },
  { key: "name", label: "名称" },
  { key: "descriptionLower", label: "摘要(下段)" },
  { key: "descriptionUpper", label: "摘要(上段)" },
  { key: "formula", label: "計算式" },
  { key: "unit", label: "単位" },
  { key: "remarksLower", label: "備考(下段)" },
  { key: "remarksUpper", label: "備考(上段)" },
];

function detailText(detail: FurnitureDetail, key: keyof FurnitureDetail): string {
  const value = detail[key];
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

/** 記号と表示文字の対応表（＋部位・名称） */
function SymbolTable({
  title,
  symbols,
  onChange,
}: {
  title: string;
  symbols: FurnitureSymbol[];
  onChange: (next: FurnitureSymbol[]) => void;
}): JSX.Element {
  const rows = [...symbols, { symbol: "", text: "" }];
  return (
    <div>
      <b>{title}</b>
      <table>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${title}${index}`}>
              <td>
                <input
                  value={row.symbol}
                  onChange={(event) => {
                    const next = [...symbols];
                    if (index === symbols.length)
                      next.push({ symbol: event.target.value, text: "" });
                    else
                      next[index] = { ...next[index], symbol: event.target.value };
                    onChange(next.filter((item) => item.symbol !== "" || item.text !== ""));
                  }}
                />
              </td>
              <td>→</td>
              <td>
                <input
                  lang="ja"
                  value={row.text}
                  onChange={(event) => {
                    const next = [...symbols];
                    if (index === symbols.length)
                      next.push({ symbol: "", text: event.target.value });
                    else next[index] = { ...next[index], text: event.target.value };
                    onChange(next.filter((item) => item.symbol !== "" || item.text !== ""));
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 家具計算書（システム収納などの拾い）。
 * 左の入力欄から右の明細欄を自動で作り、右は手で直せる（直した欄は左へ返さない）。
 */
export default function FurnitureSheetPage({
  project,
  options,
  sheetId,
  onBack,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<FurnitureSheet | null>(null);
  const [rows, setRows] = useState<FurnitureRow[]>([]);
  const [settings, setSettings] = useState<FurnitureSettings>(
    furnitureSettings(),
  );
  const [hidden, setHidden] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState(0);

  const { markSaved } = useSaveOnLeave({ rows, settings }, () => save(true));

  const save = useCallback(
    async (quiet = false): Promise<void> => {
      if (!sheet) return;
      const saved = await window.sekisan.saveFurnitureSheet({
        id: sheet.id,
        name: sheet.name,
        part1: sheet.part1,
        part2: sheet.part2,
        part2Split: sheet.part2Split,
        multiplier: sheet.multiplier,
        kind: sheet.kind,
        rowsJson: JSON.stringify(rows),
        settingsJson: JSON.stringify(settings),
        note: sheet.note,
      });
      setSheet(saved);
      markSaved({ rows, settings });
      if (!quiet)
        setMessage("保存しました（建具表へ転記し、集計実行で集計書に入ります）");
    },
    [markSaved, rows, settings, sheet],
  );

  useEffect(() => {
    void (async () => {
      const loaded = await window.sekisan.getFurnitureSheet(sheetId);
      const loadedRows = parseJson<FurnitureRow[]>(loaded.rowsJson, []);
      const nextRows = loadedRows.length > 0 ? loadedRows : [furnitureRow()];
      const nextSettings = {
        ...furnitureSettings(),
        ...parseJson<FurnitureSettings>(loaded.settingsJson, furnitureSettings()),
      };
      setSheet(loaded);
      setRows(nextRows);
      setSettings(nextSettings);
      markSaved({ rows: nextRows, settings: nextSettings });
    })();
  }, [markSaved, sheetId]);

  /** 右の明細欄は左の入力欄から作る（手で直した欄はそのまま残る） */
  const view = useMemo(
    () => applyFurnitureDetails(rows, settings),
    [rows, settings],
  );
  const resolved = useMemo(() => resolveFurnitureRows(view), [view]);

  const subjectEntries = useMemo<PickEntry[]>(
    () =>
      options.subjects.map((subject) => ({
        value: String(subject.id),
        label: `${subject.id} ${subject.name}`,
      })),
    [options.subjects],
  );
  const pickupPartEntries = useMemo<PickEntry[]>(
    () =>
      options.pickupParts.map((part) => ({
        value: String(part.id),
        label: `${part.id} ${part.name}`,
      })),
    [options.pickupParts],
  );
  const unitEntries = useMemo<PickEntry[]>(
    () => options.units.map((unit) => ({ value: unit.name, label: unit.name })),
    [options.units],
  );

  const editRow = (index: number, patch: Partial<FurnitureRow>): void => {
    setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  };

  /** 右の明細欄を手で直す（直した欄は自動作成で上書きしない） */
  const editDetail = (
    index: number,
    patch: Partial<FurnitureDetail>,
  ): void => {
    setRows(
      rows.map((row, at) => {
        if (at !== index) return row;
        const edited = [...row.detail.edited];
        Object.keys(patch).forEach((key) => {
          if (key !== "formula" && !edited.includes(key)) edited.push(key);
        });
        return {
          ...row,
          detail: { ...view[index].detail, ...patch, edited },
        };
      }),
    );
  };

  const addRow = (at: number): void => {
    const next = [...rows];
    next.splice(at, 0, furnitureRow());
    setRows(next);
    setPicked(at);
  };

  const removeRow = (at: number): void => {
    if (rows.length <= 1) return;
    setRows(rows.filter((_row, index) => index !== at));
  };

  const moveRow = (at: number, step: number): void => {
    const to = at + step;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const moved = next.splice(at, 1)[0];
    next.splice(to, 0, moved);
    setRows(next);
    setPicked(to);
  };

  const visible = (key: string): boolean => !hidden.includes(key);

  const toggleColumn = (key: string): void => {
    setHidden(
      hidden.includes(key)
        ? hidden.filter((item) => item !== key)
        : [...hidden, key],
    );
  };

  const changeSettings = (patch: Partial<FurnitureSettings>): void => {
    setSettings({ ...settings, ...patch });
  };

  if (!sheet) return <div className="estimate-page furniture-page">読み込み中…</div>;

  return (
    <div className="estimate-page furniture-page">
      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            void save(true).then(onBack);
          }}
        >
          ← 家具・設備入力表（一覧）へ
        </button>
        <h2>家具計算書</h2>
        <span className="project">
          {sheet.name}／{project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => addRow(picked + 1)}>
          ＋ 行を足す
        </button>
        <button type="button" onClick={() => removeRow(picked)}>
          － 行を消す
        </button>
        <button type="button" onClick={() => moveRow(picked, -1)}>
          ↑
        </button>
        <button type="button" onClick={() => moveRow(picked, 1)}>
          ↓
        </button>
        <button type="button" onClick={() => setShowSettings(!showSettings)}>
          ⚙ 設定
        </button>
        <button type="button" onClick={() => window.print()}>
          🖨 印刷
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      <div className="furniture-columns">
        表示する列：
        {INPUT_COLUMNS.map((column) => (
          <label key={column.key}>
            <input
              type="checkbox"
              checked={visible(column.key)}
              onChange={() => toggleColumn(column.key)}
            />
            {column.label}
          </label>
        ))}
      </div>

      {showSettings && (
        <div className="furniture-settings">
          <table>
            <tbody>
              <tr>
                <td>部位の前後付加文字</td>
                <td>
                  <input
                    lang="ja"
                    value={settings.partPrefix}
                    onChange={(event) =>
                      changeSettings({ partPrefix: event.target.value })
                    }
                  />
                  ＋部位＋
                  <input
                    lang="ja"
                    value={settings.partSuffix}
                    onChange={(event) =>
                      changeSettings({ partSuffix: event.target.value })
                    }
                  />
                </td>
                <td>+部位の前後付加文字</td>
                <td>
                  <input
                    lang="ja"
                    value={settings.addPrefix}
                    onChange={(event) =>
                      changeSettings({ addPrefix: event.target.value })
                    }
                  />
                  ＋部位＋
                  <input
                    lang="ja"
                    value={settings.addSuffix}
                    onChange={(event) =>
                      changeSettings({ addSuffix: event.target.value })
                    }
                  />
                </td>
              </tr>
              <tr>
                <td>W・H・Dの表示文字</td>
                <td colSpan={3}>
                  <input
                    value={settings.widthLabel}
                    onChange={(event) =>
                      changeSettings({ widthLabel: event.target.value })
                    }
                  />
                  <input
                    value={settings.heightLabel}
                    onChange={(event) =>
                      changeSettings({ heightLabel: event.target.value })
                    }
                  />
                  <input
                    value={settings.depthLabel}
                    onChange={(event) =>
                      changeSettings({ depthLabel: event.target.value })
                    }
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <SymbolTable
            title="+部位の記号"
            symbols={settings.partSymbols}
            onChange={(partSymbols) => changeSettings({ partSymbols })}
          />
          <SymbolTable
            title="名称の記号"
            symbols={settings.nameSymbols}
            onChange={(nameSymbols) => changeSettings({ nameSymbols })}
          />
        </div>
      )}

      <table className="furniture-table">
        <thead>
          <tr>
            <th className="ops-col">操作</th>
            <th>番号</th>
            {INPUT_COLUMNS.filter((column) => visible(column.key)).map(
              (column) => (
                <th
                  key={column.key}
                  className={column.forDetail ? "no-print" : ""}
                >
                  {column.label}
                </th>
              ),
            )}
            <th className="side">数量</th>
            {DETAIL_COLUMNS.map((column) => (
              <th key={String(column.key)} className="side">
                明細:{column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.map((row, index) => {
            const quantity = rowQuantity(row, resolved[index]);
            return (
              <tr
                key={row.id}
                className={quantity === null ? "title-row" : ""}
                onMouseDown={() => setPicked(index)}
              >
                <td className="ops-col">
                  <button type="button" onClick={() => addRow(index + 1)}>
                    ＋
                  </button>
                  <button type="button" onClick={() => removeRow(index)}>
                    －
                  </button>
                </td>
                <td className="num">{index + 1}</td>
                {visible("subjectId") && (
                  <td className="no-print">
                    <PickInput
                      entries={subjectEntries}
                      halfWidth
                      value={
                        rows[index].subjectId === null
                          ? ""
                          : String(rows[index].subjectId)
                      }
                      placeholder={
                        resolved[index].subjectId === null
                          ? ""
                          : String(resolved[index].subjectId)
                      }
                      onCommit={(text) => {
                        const id = Number.parseInt(text.trim(), 10);
                        editRow(index, {
                          subjectId: Number.isNaN(id) ? null : id,
                        });
                      }}
                    />
                  </td>
                )}
                {visible("partNumber") && (
                  <td className="no-print">
                    <PickInput
                      entries={pickupPartEntries}
                      halfWidth
                      value={
                        rows[index].partNumber === null
                          ? ""
                          : String(rows[index].partNumber)
                      }
                      placeholder={
                        resolved[index].partNumber === null
                          ? ""
                          : String(resolved[index].partNumber)
                      }
                      onCommit={(text) => {
                        const picked = pickMaster(options.pickupParts, text);
                        editRow(index, { partNumber: picked.id });
                      }}
                    />
                  </td>
                )}
                {visible("detailNumber") && (
                  <td className="num no-print">
                    <input
                      value={
                        rows[index].detailNumber === null
                          ? ""
                          : String(rows[index].detailNumber)
                      }
                      placeholder={
                        resolved[index].detailNumber === null
                          ? ""
                          : resolved[index].detailNumber.toFixed(2)
                      }
                      title="空欄のときは上の行に0.01を足します"
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        editRow(index, {
                          detailNumber:
                            event.target.value.trim() === "" ||
                            Number.isNaN(value)
                              ? null
                              : value,
                        });
                      }}
                    />
                  </td>
                )}
                {visible("part") && (
                  <td>
                    <input
                      value={rows[index].part}
                      placeholder={resolved[index].part}
                      onChange={(event) =>
                        editRow(index, { part: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("partAdd") && (
                  <td>
                    <input
                      value={rows[index].partAdd}
                      onChange={(event) =>
                        editRow(index, { partAdd: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("partSymbol") && (
                  <td>
                    <input
                      value={rows[index].partSymbol}
                      title="設定の記号表で文字に変わります"
                      onChange={(event) =>
                        editRow(index, { partSymbol: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("nameSymbol") && (
                  <td>
                    <input
                      lang="ja"
                      value={rows[index].nameSymbol}
                      title="設定の記号表で文字に変わります（表に無い文字はそのまま出ます）"
                      onChange={(event) =>
                        editRow(index, { nameSymbol: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("width") && (
                  <td className="num">
                    <input
                      value={rows[index].width}
                      onChange={(event) =>
                        editRow(index, { width: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("height") && (
                  <td className="num">
                    <input
                      value={rows[index].height}
                      onChange={(event) =>
                        editRow(index, { height: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("depth") && (
                  <td className="num">
                    <input
                      value={rows[index].depth}
                      onChange={(event) =>
                        editRow(index, { depth: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("quantity") && (
                  <td className="num">
                    <input
                      value={rows[index].quantity}
                      placeholder={resolved[index].quantity}
                      title="0はタイトル行になり、集計しません"
                      onChange={(event) =>
                        editRow(index, { quantity: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("unit") && (
                  <td>
                    <PickInput
                      entries={unitEntries}
                      value={rows[index].unit}
                      onCommit={(text) =>
                        editRow(index, {
                          unit: pickMaster(options.units, text).name,
                        })
                      }
                    />
                  </td>
                )}
                {visible("descriptionUpper") && (
                  <td>
                    <input
                      lang="ja"
                      value={rows[index].descriptionUpper}
                      onChange={(event) =>
                        editRow(index, { descriptionUpper: event.target.value })
                      }
                    />
                  </td>
                )}
                {visible("remarksLower") && (
                  <td>
                    <input
                      lang="ja"
                      value={rows[index].remarksLower}
                      onChange={(event) =>
                        editRow(index, { remarksLower: event.target.value })
                      }
                    />
                  </td>
                )}
                <td className="num detail">
                  {quantity === null ? "" : quantity}
                </td>
                {DETAIL_COLUMNS.map((column) => (
                  <td
                    key={String(column.key)}
                    className={`detail${
                      row.detail.edited.includes(String(column.key))
                        ? " edited"
                        : ""
                    }`}
                  >
                    <input
                      lang="ja"
                      value={detailText(row.detail, column.key)}
                      title="ここを直しても左の入力欄には返しません"
                      onChange={(event) => {
                        const text = event.target.value;
                        if (
                          column.key === "subjectId" ||
                          column.key === "partNumber" ||
                          column.key === "detailNumber"
                        ) {
                          const value = Number(text);
                          editDetail(index, {
                            [column.key]:
                              text.trim() === "" || Number.isNaN(value)
                                ? null
                                : value,
                          });
                          return;
                        }
                        editDetail(index, { [column.key]: text });
                      }}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
