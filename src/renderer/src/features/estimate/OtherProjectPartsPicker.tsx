import { useEffect, useMemo, useState } from "react";
import type { EstimateRow, ProjectSummary } from "@shared/types";
import { resolveInherited, toDrafts } from "./estimateRows";
import "./OtherProjectSheetPicker.css";

interface Props {
  /** 今開いている物件（一覧から除く） */
  currentProjectId: number;
  /** 計算書の種類 → 表示名（部位別入力表の選択肢と同じ） */
  calcSheetNames: Map<string, string>;
  /** 印を付けた行を受け取る（控えに入るので、あとは挿入貼付・追加貼付で入れる） */
  onPick: (rows: EstimateRow[]) => void;
  onClose: () => void;
}

/**
 * 他の物件の部位別入力表から行を選んで写す窓。
 * 物件を選ぶとその物件の部位別入力表がそのまま出るので、
 * 写したい部位の行に印を付けて［コピー］。
 */
export default function OtherProjectPartsPicker({
  currentProjectId,
  calcSheetNames,
  onPick,
  onClose,
}: Props): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<ProjectSummary | null>(null);
  const [sourceRows, setSourceRows] = useState<EstimateRow[]>([]);
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

  /** 部位Ⅰ・部位Ⅱは上の行を引き継ぐ表示（部位別入力表と同じ見え方にする） */
  const inherited = useMemo(
    () => resolveInherited(toDrafts(sourceRows)),
    [sourceRows],
  );

  const pickProject = async (project: ProjectSummary): Promise<void> => {
    setBusy(true);
    try {
      setSourceRows(await window.sekisan.listEstimateRows(project.id));
      setPicked(project);
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

  const copy = (): void => {
    const rows = sourceRows.filter((row) => checked.has(row.id));
    if (rows.length === 0) return;
    onPick(rows);
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
        aria-label="他の物件から部位をコピー"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="other-project-head">
          <strong>他の物件から部位をコピー</strong>
          <button type="button" onClick={onClose}>
            ✕ 閉じる
          </button>
        </div>
        {picked === null ? (
          <>
            <div className="other-project-sub">
              コピー元の物件をクリックしてください
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
                onClick={copy}
              >
                📋 印を付けた部位をコピー（{checked.size}行）
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
                          sourceRows.length > 0 &&
                          checked.size === sourceRows.length
                        }
                        onChange={(event) =>
                          setChecked(
                            event.target.checked
                              ? new Set(sourceRows.map((row) => row.id))
                              : new Set(),
                          )
                        }
                      />
                    </th>
                    <th className="no">No</th>
                    <th>部位Ⅰ</th>
                    <th>部位Ⅱ</th>
                    <th>部位Ⅱ別仕訳</th>
                    <th>型枠</th>
                    <th>部位Ⅲ（部屋名）</th>
                    <th>天井高さ</th>
                    <th>倍率</th>
                    <th>計算書</th>
                    <th>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((row, index) => {
                    const shown = inherited[index];
                    const subtotal = row.rowType === "subtotal";
                    return (
                      <tr
                        key={row.id}
                        className={
                          checked.has(row.id) ? "pick selected" : "pick"
                        }
                        onClick={() => toggle(row.id)}
                      >
                        <td className="check">
                          <input
                            type="checkbox"
                            checked={checked.has(row.id)}
                            onChange={() => toggle(row.id)}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </td>
                        <td className="no">{index + 1}</td>
                        <td>{shown?.part1 ?? ""}</td>
                        <td>{shown?.part2 ?? ""}</td>
                        <td>
                          {subtotal ? "" : row.part2Split === 1 ? "✔" : ""}
                        </td>
                        <td>{subtotal ? "Σ 小計" : row.formwork}</td>
                        <td>{subtotal ? "Σ 小計" : row.part3}</td>
                        <td>
                          {subtotal || row.ceilingHeight === null
                            ? ""
                            : row.ceilingHeight}
                        </td>
                        <td>{subtotal ? "" : row.multiplier}</td>
                        <td>
                          {subtotal
                            ? ""
                            : (calcSheetNames.get(row.calcType) ??
                              row.calcType)}
                        </td>
                        <td>{row.note}</td>
                      </tr>
                    );
                  })}
                  {sourceRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="empty">
                        この物件の部位別入力表は空です
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
