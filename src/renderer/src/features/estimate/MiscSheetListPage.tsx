import { useCallback, useEffect, useState } from "react";
import type { MiscSheetSummary, ProjectSummary } from "@shared/types";
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

  const load = useCallback(async (): Promise<void> => {
    setSheets(await window.sekisan.listMiscSheets(project.id));
  }, [project.id]);

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
    const ok = window.confirm(
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
        <button type="button" onClick={() => void save(sheets)}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

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
            <tr key={sheet.id}>
              <td className="no">{index + 1}</td>
              <td className="name">
                <input
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
