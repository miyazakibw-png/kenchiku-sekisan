import { useCallback, useEffect, useRef, useState } from "react";
import type { MiscSheet, MiscSheetSummary, ProjectSummary } from "@shared/types";
import { ask } from "../common/askDialog";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import { useColumnWidths } from "./columnWidths";
import OtherProjectSheetPicker from "./OtherProjectSheetPicker";
import "./EstimatePartsPage.css";
import "./MiscSheetListPage.css";

/** 一覧の列（右端の「消す」列はボタンだけ置く空の見出し） */
const LIST_COLUMNS: {
  key: string;
  label: string;
  className: string;
  defaultWidth: number;
}[] = [
  { key: "ops", label: "操作", className: "ops", defaultWidth: 150 },
  { key: "no", label: "No", className: "no", defaultWidth: 40 },
  { key: "name", label: "表の名前", className: "name", defaultWidth: 260 },
  { key: "cols", label: "明細", className: "count", defaultWidth: 60 },
  { key: "rows", label: "部屋", className: "count", defaultWidth: 60 },
  { key: "note", label: "メモ", className: "note", defaultWidth: 300 },
  { key: "del", label: "", className: "ops del", defaultWidth: 64 },
];

interface Props {
  project: ProjectSummary;
  onOpen: (sheetId: number) => void;
  onBack: () => void;
}

/**
 * 部位別雑・金物入力表の管理表。
 * 1工事に何枚でも表を作り、ここから選んで開く（表を管理するだけの画面）。
 */
export default function MiscSheetListPage({
  project,
  onOpen,
  onBack,
}: Props): JSX.Element {
  const [sheets, setSheets] = useState<MiscSheetSummary[]>([]);
  const [message, setMessage] = useState("");
  /** カーソルの行（貼り付け先）と、Shift+クリックで選んだ端 */
  const [selected, setSelected] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState(0);
  /** コピーした表（貼り付けで中身ごと写す） */
  const [clipboard, setClipboard] = useState<number[]>([]);
  /** 他の物件から表を写す窓 */
  const [pickingOther, setPickingOther] = useState(false);
  const { widthOf, resizeAtEdge } = useColumnWidths(
    `misc-list-widths:${project.id}`,
  );

  /** ↶戻る・↷進む用の履歴（一覧の行・並びをまとめて1つの履歴にする） */
  const history = useUndoRedo<MiscSheetSummary[]>();
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  /** 消した表の中身（↶戻るで作り直すために控える。ID→表全体） */
  const graves = useRef(new Map<number, MiscSheet>());
  /** 同じ欄への続けての入力を履歴1つにまとめるための目印 */
  const editKey = useRef<string | null>(null);
  /** 戻る・進むの途中（連打しても順番が崩れないよう一度に1つ） */
  const applying = useRef(false);

  /** 変更前の一覧を履歴へ積む（keyがあるときは同じ欄の連続入力を1つにまとめる） */
  const pushHistory = useCallback(
    (key?: string): void => {
      if (key !== undefined && editKey.current === key) return;
      history.push(sheetsRef.current);
      editKey.current = key ?? null;
    },
    [history],
  );

  const load = useCallback(async (): Promise<void> => {
    setSheets(await window.sekisan.listMiscSheets(project.id));
  }, [project.id]);

  /** 他の物件の表をこの物件の末尾に写す */
  const copyFromOther = async (sheetIds: number[]): Promise<void> => {
    pushHistory();
    setSheets(
      await window.sekisan.copyMiscSheetsFromProject(project.id, sheetIds),
    );
    setPickingOther(false);
    setMessage(
      `他の物件から ${sheetIds.length} 枚を写しました（いちばん下。部屋の行は手で足した行として入ります）`,
    );
  };

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: MiscSheetSummary[]): Promise<void> => {
    editKey.current = null;
    setSheets(next);
    setSheets(await window.sekisan.saveMiscSheetList(project.id, next));
    setMessage("保存しました");
  };

  const add = async (): Promise<void> => {
    pushHistory();
    await window.sekisan.createMiscSheet(
      project.id,
      `部位別雑・金物入力表${sheets.length + 1}`,
    );
    await load();
    setMessage("表を1枚足しました");
  };

  const remove = async (sheet: MiscSheetSummary): Promise<void> => {
    const ok = await ask(
      `「${sheet.name}」を消します。中の入力も消えます。よろしいですか。`,
    );
    if (!ok) return;
    // 戻るで戻せるよう、消す前に表の中身を控える
    graves.current.set(sheet.id, await window.sekisan.getMiscSheet(sheet.id));
    pushHistory();
    await window.sekisan.deleteMiscSheet(sheet.id);
    await load();
    setMessage("表を消しました（↶ 戻るで戻せます）");
  };

  /** 並びを1つ入れ替える */
  const move = async (index: number, step: number): Promise<void> => {
    const to = index + step;
    if (to < 0 || to >= sheets.length) return;
    pushHistory();
    const next = [...sheets];
    const moved = next.splice(index, 1)[0];
    next.splice(to, 0, moved);
    await save(next);
  };

  const selectionStart = Math.min(selected, selectedEnd);
  const selectionEnd = Math.max(selected, selectedEnd);

  /** カーソルの行（Shift+クリックで選んだ範囲）をコピーする */
  const copy = (): void => {
    const copied = sheets
      .slice(selectionStart, selectionEnd + 1)
      .map((sheet) => sheet.id);
    if (copied.length === 0) return;
    setClipboard(copied);
    setMessage(
      `⧉ ${copied.length} 枚をコピーしました（貼り付けたい行にカーソルを置いて「挿入貼付」「追加貼付」）`,
    );
  };

  /** 写した表を入れる（挿入＝カーソルの行の上、追加＝最後尾） */
  const paste = async (mode: "insert" | "append"): Promise<void> => {
    if (clipboard.length === 0) return;
    pushHistory();
    const at = mode === "insert" ? selectionStart : sheets.length;
    setSheets(await window.sekisan.pasteMiscSheets(project.id, clipboard, at));
    setMessage(`${clipboard.length} 枚を貼り付けました（中の入力も写します）`);
  };

  const change = (index: number, patch: Partial<MiscSheetSummary>): void => {
    const sheet = sheets[index];
    pushHistory(
      sheet === undefined
        ? undefined
        : `${sheet.id}:${Object.keys(patch).join(",")}`,
    );
    setSheets(
      sheets.map((sheet, at) =>
        at === index ? { ...sheet, ...patch } : sheet,
      ),
    );
  };

  /**
   * 履歴の一覧へ戻す・進める。履歴の後に足した表は消し（中身は控える）、
   * 履歴にある消した表は控えた中身から作り直す（IDは新しく振られ、履歴の中も合わせる）。
   */
  const applyList = useCallback(
    async (target: MiscSheetSummary[]): Promise<void> => {
      const currentIds = new Set(
        sheetsRef.current.map((sheet) => sheet.id),
      );
      const targetIds = new Set(target.map((sheet) => sheet.id));
      for (const sheet of sheetsRef.current) {
        if (targetIds.has(sheet.id)) continue;
        graves.current.set(
          sheet.id,
          await window.sekisan.getMiscSheet(sheet.id),
        );
        await window.sekisan.deleteMiscSheet(sheet.id);
      }
      const idMap = new Map<number, number>();
      for (const sheet of target) {
        if (currentIds.has(sheet.id)) continue;
        const grave = graves.current.get(sheet.id);
        const created = await window.sekisan.createMiscSheet(
          project.id,
          sheet.name,
        );
        if (grave !== undefined) {
          await window.sekisan.saveMiscSheet({
            id: created.id,
            name: grave.name,
            columnsJson: grave.columnsJson,
            rowsJson: grave.rowsJson,
            note: grave.note,
          });
        }
        idMap.set(sheet.id, created.id);
      }
      const resolved = target.map((sheet) => ({
        ...sheet,
        id: idMap.get(sheet.id) ?? sheet.id,
      }));
      setSheets(await window.sekisan.saveMiscSheetList(project.id, resolved));
      if (idMap.size > 0) {
        history.map((snap) =>
          snap.map((sheet) => ({
            ...sheet,
            id: idMap.get(sheet.id) ?? sheet.id,
          })),
        );
      }
      setSelected((at) => Math.min(at, Math.max(resolved.length - 1, 0)));
      setSelectedEnd((at) => Math.min(at, Math.max(resolved.length - 1, 0)));
    },
    [history, project.id],
  );

  const undo = async (): Promise<void> => {
    if (applying.current) return;
    const previous = history.undo(sheetsRef.current);
    if (previous === null) {
      setMessage("戻せる操作がありません");
      return;
    }
    applying.current = true;
    try {
      await applyList(previous);
      setMessage("1つ前に戻しました");
    } finally {
      applying.current = false;
    }
  };

  const redo = async (): Promise<void> => {
    if (applying.current) return;
    const next = history.redo(sheetsRef.current);
    if (next === null) {
      setMessage("進める操作がありません");
      return;
    }
    applying.current = true;
    try {
      await applyList(next);
      setMessage("1つ先へ進めました");
    } finally {
      applying.current = false;
    }
  };

  return (
    <div className="estimate-page misc-list-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>部位別雑・金物入力表（一覧）</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button
          type="button"
          disabled={!history.canUndo}
          title="1つ前の内容に戻します（消した表も中身ごと戻ります）"
          onClick={() => void undo()}
        >
          ↶ 戻る
        </button>
        <button
          type="button"
          disabled={!history.canRedo}
          title="戻した内容を1つ先へ進めます"
          onClick={() => void redo()}
        >
          ↷ 進む
        </button>
        <button type="button" onClick={() => void add()}>
          ➕ 表を足す
        </button>
        <button
          type="button"
          title="カーソルの行（Shift+クリックで選んだ範囲）の表を、中の入力ごとコピーします"
          onClick={copy}
        >
          ⧉ 表コピー（複数可）
        </button>
        <button
          type="button"
          title="カーソルの行の上へ、コピーした表を入れます"
          disabled={clipboard.length === 0}
          onClick={() => void paste("insert")}
        >
          📋 挿入貼付
        </button>
        <button
          type="button"
          title="いちばん下へ、コピーした表を足します"
          disabled={clipboard.length === 0}
          onClick={() => void paste("append")}
        >
          📋 追加貼付
        </button>
        <button
          type="button"
          title="他の物件の一覧から表を選んで、中の明細・数量ごとこの物件に写します"
          onClick={() => setPickingOther(true)}
        >
          🏢 他の物件から表コピー
        </button>
        <button type="button" onClick={() => void save(sheets)}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      {pickingOther && (
        <OtherProjectSheetPicker
          title="他の物件から表コピー（部位別雑・金物入力表）"
          currentProjectId={project.id}
          listSheets={async (projectId) =>
            (await window.sekisan.listMiscSheets(projectId)).map((sheet) => ({
              id: sheet.id,
              name: sheet.name,
              detail: `明細 ${sheet.columnCount}・部屋 ${sheet.rowCount}`,
              note: sheet.note,
            }))
          }
          onCopy={copyFromOther}
          onClose={() => setPickingOther(false)}
        />
      )}

      <table className="grid misc-list">
        <colgroup>
          {LIST_COLUMNS.map((column) => (
            <col
              key={column.key}
              style={{ width: widthOf(column.key, column.defaultWidth) }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {LIST_COLUMNS.map((column) => (
              <th
                key={column.key}
                className={column.className}
                title="右端をドラッグして列の幅を変えます"
                onMouseDown={(event) =>
                  resizeAtEdge(column.key, column.defaultWidth, event)
                }
              >
                <span className="cellbox">
                  {column.label}
                  <span className="resizer" />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheets.map((sheet, index) => (
            <tr
              key={sheet.id}
              className={
                index >= selectionStart && index <= selectionEnd
                  ? "selected"
                  : ""
              }
              onMouseDown={(event) => {
                if (event.shiftKey) {
                  setSelectedEnd(index);
                  return;
                }
                setSelected(index);
                setSelectedEnd(index);
              }}
            >
              <td className="ops">
                <button type="button" onClick={() => onOpen(sheet.id)}>
                  📂 開く
                </button>
                <button type="button" onClick={() => void move(index, -1)}>
                  ↑
                </button>
                <button type="button" onClick={() => void move(index, 1)}>
                  ↓
                </button>
              </td>
              <td className="no">{index + 1}</td>
              <td className="name">
                <input
                  lang="ja"
                  value={sheet.name}
                  onChange={(event) =>
                    change(index, { name: event.target.value })
                  }
                  onBlur={() => void save(sheets)}
                />
              </td>
              <td className="count">{sheet.columnCount}</td>
              <td className="count">{sheet.rowCount}</td>
              <td className="note">
                <input
                  lang="ja"
                  value={sheet.note}
                  onChange={(event) =>
                    change(index, { note: event.target.value })
                  }
                  onBlur={() => void save(sheets)}
                />
              </td>
              <td className="ops del">
                <button type="button" onClick={() => void remove(sheet)}>
                  🗑 消す
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
