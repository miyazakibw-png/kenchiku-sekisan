import { useCallback, useEffect, useState } from "react";
import type { SubjectDraft } from "@shared/types";
import {
  displayCode,
  insertRow,
  moveRow,
  removeRow,
  toDrafts,
  updateRow,
} from "./subjectRows";
import "./SubjectMasterPage.css";

interface Props {
  /** 工事専用の科目マスターを直すときの工事ID（未指定なら基本マスター） */
  projectId?: number | null;
  onBack?: () => void;
}

export default function SubjectMasterPage({
  projectId = null,
  onBack,
}: Props = {}): JSX.Element {
  const [rows, setRows] = useState<SubjectDraft[]>([]);
  const [selected, setSelected] = useState(0);
  const [toast, setToast] = useState("");

  const reload = useCallback(async () => {
    setRows(toDrafts(await window.sekisan.listSubjects(projectId)));
  }, [projectId]);

  /** 基準（基本）マスターの科目をこの工事へ取り込む */
  const copyFromBasic = useCallback(async () => {
    if (projectId === null) return;
    await window.sekisan.copyProjectMasters(projectId, true);
    await reload();
    setToast("基準マスターから複製しました");
  }, [projectId, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async () => {
    const result = await window.sekisan.saveSubjects(rows, projectId);
    setRows(toDrafts(result.subjects));
    setToast(
      result.blockedDeletes.length > 0
        ? `明細が登録されているため削除できませんでした：${result.blockedDeletes.join("、")}（末尾へ移動しました）`
        : "保存しました",
    );
  }, [projectId, rows]);

  return (
    <div className="subject-page">
      <div className="toolbar">
        {onBack ? (
          <button type="button" onClick={onBack}>
            ← 戻る
          </button>
        ) : null}
        <h2>
          {projectId === null
            ? "工種科目マスター"
            : "この工事の工種科目マスター"}
        </h2>
        {projectId === null ? null : (
          <button type="button" onClick={() => void copyFromBasic()}>
            ↻ 基準マスターから複製
          </button>
        )}
        <button
          type="button"
          onClick={() => setRows(insertRow(rows, selected))}
        >
          ➕ 行挿入
        </button>
        <button
          type="button"
          onClick={() => setRows(insertRow(rows, rows.length))}
        >
          ⤓ 最終行に追加
        </button>
        <button
          type="button"
          onClick={() => setRows(removeRow(rows, selected))}
        >
          🗑 行削除
        </button>
        <button
          type="button"
          disabled={selected <= 0}
          onClick={() => {
            setRows(moveRow(rows, selected, selected - 1));
            setSelected(selected - 1);
          }}
        >
          ↑ 上へ
        </button>
        <button
          type="button"
          disabled={selected >= rows.length - 1}
          onClick={() => {
            setRows(moveRow(rows, selected, selected + 1));
            setSelected(selected + 1);
          }}
        >
          ↓ 下へ
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="hint">
          {projectId === null
            ? "科目IDは行位置で自動採番します。明細は科目の内部IDに付くため、番号や名称を変えても所属は変わりません（集計順は列のみ用意して未使用）"
            : "この工事だけの科目です。科目IDは一度決まると並べ替えても変わりません。追加した行には空き番号を割り当てます"}
        </span>
        <span className="status">{toast}</span>
      </div>

      <table className="grid subject-list">
        <thead>
          <tr>
            <th className="no">科目ID</th>
            <th className="name">工種科目名</th>
            <th className="note">備考</th>
            <th className="flag">部位Ⅱ分不要</th>
            <th className="spare">予備1</th>
            <th className="spare">予備2</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id ?? `new-${index}`}
              className={index === selected ? "selected" : undefined}
              onClick={() => setSelected(index)}
            >
              <td className="no">
                {projectId === null ? displayCode(index) : (row.id ?? "新規")}
              </td>
              <td>
                <input
                  lang="ja"
                  value={row.name}
                  onChange={(e) =>
                    setRows(updateRow(rows, index, { name: e.target.value }))
                  }
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={row.note}
                  onChange={(e) =>
                    setRows(updateRow(rows, index, { note: e.target.value }))
                  }
                />
              </td>
              <td className="flag">
                <input
                  type="checkbox"
                  checked={row.skipPart2 === 1}
                  title="集計時に部位Ⅱの仕分けを行わない"
                  onChange={(e) =>
                    setRows(
                      updateRow(rows, index, {
                        skipPart2: e.target.checked ? 1 : 0,
                      }),
                    )
                  }
                />
              </td>
              <td>
                <input
                  value={row.spare1}
                  onChange={(e) =>
                    setRows(updateRow(rows, index, { spare1: e.target.value }))
                  }
                />
              </td>
              <td>
                <input
                  value={row.spare2}
                  onChange={(e) =>
                    setRows(updateRow(rows, index, { spare2: e.target.value }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
