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

export default function SubjectMasterPage(): JSX.Element {
  const [rows, setRows] = useState<SubjectDraft[]>([]);
  const [selected, setSelected] = useState(0);
  const [toast, setToast] = useState("");

  const reload = useCallback(async () => {
    setRows(toDrafts(await window.sekisan.listSubjects()));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async () => {
    const result = await window.sekisan.saveSubjects(rows);
    setRows(toDrafts(result.subjects));
    setToast(
      result.blockedDeletes.length > 0
        ? `明細が登録されているため削除できませんでした：${result.blockedDeletes.join("、")}（末尾へ移動しました）`
        : "保存しました",
    );
  }, [rows]);

  return (
    <div className="subject-page">
      <div className="toolbar">
        <h2>工種科目マスター</h2>
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
          科目IDは行位置で自動採番します。明細は科目の内部IDに付くため、番号や名称を変えても所属は変わりません（集計順は列のみ用意して未使用）
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
              <td className="no">{displayCode(index)}</td>
              <td>
                <input
                  value={row.name}
                  onChange={(e) =>
                    setRows(updateRow(rows, index, { name: e.target.value }))
                  }
                />
              </td>
              <td>
                <input
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
