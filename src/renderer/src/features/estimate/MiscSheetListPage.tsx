import { useCallback, useEffect, useState } from "react";
import type { MiscSheetSummary, ProjectSummary } from "@shared/types";
import { ask } from "../common/askDialog";
import OtherProjectSheetPicker from "./OtherProjectSheetPicker";
import "./EstimatePartsPage.css";
import "./MiscSheetListPage.css";

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

  const load = useCallback(async (): Promise<void> => {
    setSheets(await window.sekisan.listMiscSheets(project.id));
  }, [project.id]);

  /** 他の物件の表をこの物件の末尾に写す */
  const copyFromOther = async (sheetIds: number[]): Promise<void> => {
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
    setSheets(next);
    setSheets(await window.sekisan.saveMiscSheetList(project.id, next));
    setMessage("保存しました");
  };

  const add = async (): Promise<void> => {
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
    await window.sekisan.deleteMiscSheet(sheet.id);
    await load();
    setMessage("表を消しました");
  };

  /** 並びを1つ入れ替える */
  const move = async (index: number, step: number): Promise<void> => {
    const to = index + step;
    if (to < 0 || to >= sheets.length) return;
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
    const at = mode === "insert" ? selectionStart : sheets.length;
    setSheets(await window.sekisan.pasteMiscSheets(project.id, clipboard, at));
    setMessage(`${clipboard.length} 枚を貼り付けました（中の入力も写します）`);
  };

  const change = (index: number, patch: Partial<MiscSheetSummary>): void => {
    setSheets(
      sheets.map((sheet, at) =>
        at === index ? { ...sheet, ...patch } : sheet,
      ),
    );
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
        <thead>
          <tr>
            <th className="no">No</th>
            <th className="name">表の名前</th>
            <th className="count">明細</th>
            <th className="count">部屋</th>
            <th className="note">メモ</th>
            <th className="ops">操作</th>
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
