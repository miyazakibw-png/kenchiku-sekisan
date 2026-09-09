import { useEffect, useState } from "react";
import type { ProjectSummary } from "@shared/types";
import "./OtherProjectSheetPicker.css";

/** 他の物件の一覧に出す表1枚（名前・種類や数などの説明・メモ） */
export interface PickableSheet {
  id: number;
  name: string;
  detail: string;
  note: string;
}

interface Props {
  /** 窓の見出し（例：他の物件から表コピー（家具・設備入力表）） */
  title: string;
  /** 今開いている物件（一覧から除く） */
  currentProjectId: number;
  /** 物件を選んだらすぐ呼ぶ。その物件の表の一覧を返す */
  listSheets: (projectId: number) => Promise<PickableSheet[]>;
  /** 選んだ表をこの物件へ写す */
  onCopy: (sheetIds: number[]) => Promise<void>;
  onClose: () => void;
}

/**
 * 他の物件から表を写す窓。
 * 物件を選ぶとすぐその物件の表の一覧に切り替わり、写したい表に印を付けて［コピー］。
 */
export default function OtherProjectSheetPicker({
  title,
  currentProjectId,
  listSheets,
  onCopy,
  onClose,
}: Props): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<ProjectSummary | null>(null);
  const [sheets, setSheets] = useState<PickableSheet[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const ledger = await window.sekisan.getProjectLedger();
      setProjects(
        ledger.projects.filter((project) => project.id !== currentProjectId),
      );
    })();
  }, [currentProjectId]);

  const pickProject = async (project: ProjectSummary): Promise<void> => {
    setBusy(true);
    try {
      const list = await listSheets(project.id);
      setPicked(project);
      setSheets(list);
      setChecked(new Set());
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number): void => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const copy = async (): Promise<void> => {
    const ids = sheets
      .filter((sheet) => checked.has(sheet.id))
      .map((sheet) => sheet.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await onCopy(ids);
    } finally {
      setBusy(false);
    }
  };

  const shown = projects.filter((project) => {
    const key = filter.trim();
    if (key === "") return true;
    return `${project.managementNo} ${project.name}`.includes(key);
  });

  return (
    <div className="other-project-backdrop" onMouseDown={onClose}>
      <div
        className="other-project-box"
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="other-project-head">
          <strong>{title}</strong>
          <button type="button" onClick={onClose}>
            ✕ 閉じる
          </button>
        </div>
        {picked === null ? (
          <>
            <div className="other-project-sub">
              写したい表がある物件をクリックしてください
              <input
                lang="ja"
                placeholder="管理番号・工事名で絞る"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="other-project-scroll">
              <table className="grid other-project-list">
                <thead>
                  <tr>
                    <th className="no">管理番号</th>
                    <th>工事名</th>
                    <th className="date">日付</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((project) => (
                    <tr
                      key={project.id}
                      className="pick"
                      onClick={() => void pickProject(project)}
                    >
                      <td className="no">{project.managementNo}</td>
                      <td>{project.name}</td>
                      <td className="date">{project.projectDate}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty">
                        他の物件がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="other-project-sub">
              <button type="button" onClick={() => setPicked(null)}>
                ← 物件を選び直す
              </button>
              <span className="picked">
                {picked.managementNo} {picked.name}
              </span>
              <button
                type="button"
                className="primary"
                disabled={busy || checked.size === 0}
                onClick={() => void copy()}
              >
                📋 印を付けた表をこの物件へコピー（{checked.size}枚）
              </button>
            </div>
            <div className="other-project-scroll">
              <table className="grid other-project-list">
                <thead>
                  <tr>
                    <th className="check">
                      <input
                        type="checkbox"
                        title="全部に印を付ける／外す"
                        checked={
                          sheets.length > 0 && checked.size === sheets.length
                        }
                        onChange={(event) =>
                          setChecked(
                            event.target.checked
                              ? new Set(sheets.map((sheet) => sheet.id))
                              : new Set(),
                          )
                        }
                      />
                    </th>
                    <th>表の名前</th>
                    <th>内容</th>
                    <th>メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((sheet) => (
                    <tr
                      key={sheet.id}
                      className={
                        checked.has(sheet.id) ? "pick selected" : "pick"
                      }
                      onClick={() => toggle(sheet.id)}
                    >
                      <td className="check">
                        <input
                          type="checkbox"
                          checked={checked.has(sheet.id)}
                          onChange={() => toggle(sheet.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </td>
                      <td>{sheet.name}</td>
                      <td>{sheet.detail}</td>
                      <td>{sheet.note}</td>
                    </tr>
                  ))}
                  {sheets.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty">
                        この物件には表がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
