import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BasicMasterKind,
  BasicMasterRow,
  BasicMasters,
} from "@shared/types";
import {
  BASIC_MASTER_LIMITS,
  nextBasicMasterId,
  sortBasicMasterRowsById,
} from "../../../../core/masters/basicMaster";
import {
  buildPastePreview,
  copyRangeAsTsv,
  type GridColumn,
} from "../grid/gridClipboard";
import "./BasicMasterPage.css";
import { useTableResize } from "../../hooks/useTableResize";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import { ask } from "../common/askDialog";

const TABS: BasicMasterKind[] = [
  "pickupParts",
  "materialCategories",
  "units",
  "aggregationParts",
  "formworkCategories",
];

const EMPTY: BasicMasters = {
  pickupParts: [],
  materialCategories: [],
  units: [],
  aggregationParts: [],
  formworkCategories: [],
};

function copyRows(rows: readonly BasicMasterRow[]): BasicMasterRow[] {
  return rows.map((row) => ({ ...row }));
}

interface Props {
  /** 工事専用マスターを直すときの工事ID（未指定なら基本マスター） */
  projectId?: number | null;
  onBack?: () => void;
}

export default function BasicMasterPage({
  projectId = null,
  onBack,
}: Props = {}): JSX.Element {
  const tableRef = useTableResize("table-widths-basic-master-v1");
  const [masters, setMasters] = useState<BasicMasters>(EMPTY);
  const [kind, setKind] = useState<BasicMasterKind>("pickupParts");
  const [rows, setRows] = useState<BasicMasterRow[]>([]);
  const rowsRef = useRef(rows);
  const lastEditKeyRef = useRef<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [selectedCol, setSelectedCol] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const history = useUndoRedo<BasicMasterRow[]>();

  const replaceRows = useCallback((next: BasicMasterRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const pushRowsHistory = useCallback(() => {
    history.push(copyRows(rowsRef.current));
    lastEditKeyRef.current = null;
  }, [history.push]);

  const { markSaved, isDirty } = useSaveOnLeave(rows, () => save(true));

  const load = useCallback(
    (source: BasicMasters, target: BasicMasterKind) => {
      const next = source[target].map((row) => ({ ...row }));
      setMasters(source);
      setKind(target);
      replaceRows(next);
      history.clear();
      lastEditKeyRef.current = null;
      setSelected(0);
      setMessages([]);
      markSaved(next);
    },
    [history.clear, markSaved, replaceRows],
  );

  /** 別の種類へ移るときは、今の表を保存してから読み替える */
  const changeKind = async (target: BasicMasterKind): Promise<void> => {
    if (target === kind) return;
    if (!isDirty()) {
      load(masters, target);
      return;
    }
    const result = await window.sekisan.saveBasicMaster({
      kind,
      rows: copyRows(rowsRef.current),
      projectId,
    });
    load(result.errors.length > 0 ? masters : result.masters, target);
  };

  useEffect(() => {
    void window.sekisan
      .listBasicMasters(projectId)
      .then((data) => load(data, "pickupParts"));
  }, [load, projectId]);

  /** 基準（基本）マスターをこの工事へ取り込む */
  const copyFromBasic = async (): Promise<void> => {
    if (projectId === null) return;
    await window.sekisan.copyProjectMasters(projectId, true);
    load(await window.sekisan.listBasicMasters(projectId), kind);
    setMessages(["基準マスターから複製しました"]);
  };

  const syncToBasic = async (): Promise<void> => {
    if (projectId === null) return;
    if (isDirty()) {
      const saved = await window.sekisan.saveBasicMaster({
        kind,
        rows: copyRows(rowsRef.current),
        projectId,
      });
      if (saved.errors.length > 0) {
        setMessages(saved.errors);
        return;
      }
      setMasters(saved.masters);
      const next = copyRows(saved.masters[kind]);
      replaceRows(next);
      markSaved(next);
    }
    history.clear();
    lastEditKeyRef.current = null;
    setMessages([]);

    const label = BASIC_MASTER_LIMITS[kind].label;
    const confirmed = await ask(
      `「${label}」を基本マスターへ同期しますか。基本マスターの「${label}」は、この工事と同じ中身になります。この工事に無い番号は基本マスターから消えます。`,
      "同期する",
      "やめる",
    );
    if (!confirmed) return;

    const result = await window.sekisan.syncProjectBasicMasterToBasic(
      projectId,
      kind,
    );
    if (result.errors.length > 0) {
      setMessages(result.errors);
      return;
    }
    setMasters(result.masters);
    setMessages([`基本マスターへ同期しました（${label}）`]);
  };

  const limit = BASIC_MASTER_LIMITS[kind];

  const columns = useMemo((): GridColumn<BasicMasterRow>[] => {
    const list: GridColumn<BasicMasterRow>[] = [
      {
        key: "id",
        label: "番号",
        get: (row) => (row.id === 0 ? "" : String(row.id)),
        set: (row, value) => {
          const digits = value.replace(/\D/g, "");
          if (value.trim() !== "" && digits === "")
            return { row, error: "番号は数字で入力してください" };
          return { row: { ...row, id: Number(digits) } };
        },
      },
      {
        key: "name",
        label: "名称",
        get: (row) => row.name,
        set: (row, value) => ({ row: { ...row, name: value.trim() } }),
      },
    ];
    if (kind === "pickupParts")
      list.push({
        key: "note",
        label: "備考",
        get: (row) => row.note,
        set: (row, value) => ({ row: { ...row, note: value.trim() } }),
      });
    return list;
  }, [kind]);

  /** Excelの表をそのまま貼り付ける（選んでいるセルから取り込む） */
  const paste = useCallback(async (): Promise<void> => {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    const currentRows = rowsRef.current;
    const preview = buildPastePreview(
      currentRows,
      columns,
      text,
      selected,
      selectedCol,
      () => ({
        id: 0,
        name: "",
        note: "",
      }),
    );
    pushRowsHistory();
    replaceRows(preview.rows);
    const notes = [
      `${preview.cells.length} 行貼り付け`,
      preview.addedRows > 0 ? `${preview.addedRows} 行追加` : "",
      preview.errorCount > 0 ? `取り込めない値 ${preview.errorCount} 件` : "",
    ].filter((note) => note !== "");
    setMessages([`${notes.join("／")}。内容を確認して保存してください`]);
  }, [columns, pushRowsHistory, replaceRows, selected, selectedCol]);

  /** 表の内容をExcelへ貼れる形（TSV）でコピーする */
  const copy = useCallback(async (): Promise<void> => {
    if (rows.length === 0) return;
    await navigator.clipboard.writeText(
      copyRangeAsTsv(rows, columns, {
        startRow: 0,
        startCol: 0,
        endRow: rows.length - 1,
        endCol: columns.length - 1,
      }),
    );
    setMessages([`${rows.length} 行をコピーしました`]);
  }, [columns, rows]);

  const update = (
    index: number,
    field: keyof BasicMasterRow,
    patch: Partial<BasicMasterRow>,
  ): void => {
    const currentRows = rowsRef.current;
    const editKey = `${index}:${field}`;
    if (lastEditKeyRef.current !== editKey)
      history.push(copyRows(currentRows));
    lastEditKeyRef.current = editKey;
    replaceRows(
      currentRows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const addRow = (at: number): void => {
    const currentRows = rowsRef.current;
    const row: BasicMasterRow = {
      id: nextBasicMasterId(kind, currentRows),
      name: "",
      note: "",
    };
    pushRowsHistory();
    const next = [...currentRows];
    next.splice(at, 0, row);
    replaceRows(next);
    setSelected(at);
  };

  const save = async (quiet = false): Promise<void> => {
    const result = await window.sekisan.saveBasicMaster({
      kind,
      rows: copyRows(rowsRef.current),
      projectId,
    });
    setMasters(result.masters);
    if (!quiet)
      setMessages(result.errors.length > 0 ? result.errors : ["保存しました"]);
    if (result.errors.length === 0) {
      const next = copyRows(result.masters[kind]);
      replaceRows(next);
      history.clear();
      lastEditKeyRef.current = null;
      markSaved(next);
    }
  };

  const sortById = (): void => {
    const currentRows = rowsRef.current;
    const selectedRow = currentRows[selected];
    const next = sortBasicMasterRowsById(currentRows);
    if (next.some((row, index) => row !== currentRows[index])) {
      pushRowsHistory();
      replaceRows(next);
    }
    if (selectedRow) setSelected(next.indexOf(selectedRow));
    setMessages(["番号順に並べ替えました（保存すると残ります）"]);
  };

  const undoRows = (): void => {
    const previous = history.undo(copyRows(rowsRef.current));
    lastEditKeyRef.current = null;
    if (previous !== null) {
      const next = copyRows(previous);
      replaceRows(next);
      setSelected((index) => Math.min(index, Math.max(0, next.length - 1)));
    }
  };

  const redoRows = (): void => {
    const next = history.redo(copyRows(rowsRef.current));
    lastEditKeyRef.current = null;
    if (next !== null) {
      const restored = copyRows(next);
      replaceRows(restored);
      setSelected((index) =>
        Math.min(index, Math.max(0, restored.length - 1)),
      );
    }
  };

  return (
    <div
      className="basic-master-page"
      onKeyDown={(e) => {
        if (!e.ctrlKey) return;
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          undoRows();
        } else if (key === "y" || (key === "z" && e.shiftKey)) {
          e.preventDefault();
          redoRows();
        } else if (key === "v") {
          e.preventDefault();
          void paste();
        } else if (key === "c") {
          const active = document.activeElement;
          // 文字を選んでいるときは通常の文字コピーを邪魔しない
          if (
            active instanceof HTMLInputElement &&
            active.selectionStart !== active.selectionEnd
          )
            return;
          e.preventDefault();
          void copy();
        }
      }}
    >
      <div className="toolbar">
        <div className="toolbar-top">
          {onBack ? (
            <button type="button" onClick={onBack}>
              ← 戻る
            </button>
          ) : null}
          <h2>
            {projectId === null ? "基本マスター" : "この工事の基準マスター"}
          </h2>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={tab === kind ? "tab active" : "tab"}
              onClick={() => void changeKind(tab)}
            >
              {BASIC_MASTER_LIMITS[tab].label}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          {projectId === null ? null : (
            <button type="button" onClick={() => void copyFromBasic()}>
              ↻ 基準マスターから複製
            </button>
          )}
          {projectId === null ? null : (
            <button type="button" onClick={() => void syncToBasic()}>
              ⇪ 基本マスターへ同期
            </button>
          )}
          <button type="button" onClick={() => addRow(selected)}>
            ➕ 行挿入
          </button>
          <button type="button" onClick={() => addRow(rows.length)}>
            ⤓ 最終行に追加
          </button>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => {
              pushRowsHistory();
              replaceRows(
                rowsRef.current.filter((_, i) => i !== selected),
              );
              setSelected(Math.max(0, selected - 1));
            }}
          >
            🗑 行削除
          </button>
          <button type="button" onClick={sortById}>
            ↑ 番号順に並べ替え
          </button>
          <button type="button" onClick={() => void paste()}>
            📋 Excelから貼り付け
          </button>
          <button type="button" onClick={() => void copy()}>
            ⧉ Excelへコピー
          </button>
          <button type="button" onClick={() => void save()}>
            💾 保存
          </button>
          <button
            type="button"
            disabled={!history.canUndo}
            title="保存する前の直しを1つ戻します（Ctrl+Z）"
            onClick={undoRows}
          >
            ↶ 戻る
          </button>
          <button
            type="button"
            disabled={!history.canRedo}
            title="戻した直しをやり直します（Ctrl+Y）"
            onClick={redoRows}
          >
            ↷ 進む
          </button>
        </div>
      </div>

      <div className="hint">
        {limit.hint}（番号1〜{limit.maxId}／{limit.maxRows}件まで・現在{" "}
        {rows.length} 件） ／Enter・↑↓でセル移動、Ctrl+VでExcelから貼り付け、Ctrl+Z/Yで戻る・進む
      </div>
      {messages.length > 0 && (
        <ul
          className={
            messages[0] === "保存しました" ||
            messages[0].startsWith("基本マスターへ同期しました")
              ? "messages ok"
              : "messages"
          }
        >
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <table className="basic-master-list" ref={tableRef}>
        <thead>
          <tr>
            <th className="no">番号</th>
            <th className="name">名称</th>
            {kind === "pickupParts" && <th className="note">備考</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className={index === selected ? "selected" : undefined}
              onClick={() => setSelected(index)}
            >
              <td className="no">
                <input
                  value={row.id === 0 ? "" : String(row.id)}
                  onFocus={() => setSelectedCol(0)}
                  onChange={(e) =>
                    update(index, "id", {
                      id: Number(e.target.value.replace(/\D/g, "")),
                    })
                  }
                  onBlur={() => {
                    lastEditKeyRef.current = null;
                  }}
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={row.name}
                  onFocus={() => setSelectedCol(1)}
                  onChange={(e) =>
                    update(index, "name", { name: e.target.value })
                  }
                  onBlur={() => {
                    lastEditKeyRef.current = null;
                  }}
                />
              </td>
              {kind === "pickupParts" && (
                <td>
                  <input
                    lang="ja"
                    value={row.note}
                    onFocus={() => setSelectedCol(2)}
                    onChange={(e) =>
                      update(index, "note", { note: e.target.value })
                    }
                    onBlur={() => {
                      lastEditKeyRef.current = null;
                    }}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
