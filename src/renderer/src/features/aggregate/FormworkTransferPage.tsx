import { useCallback, useEffect, useState } from "react";
import type {
  FormworkTransferRule,
  FormworkTransferView,
  ProjectSummary,
  Subject,
} from "@shared/types";
import "../estimate/EstimatePartsPage.css";
import "./CheckSheetPage.css";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

const EMPTY: FormworkTransferView = { rules: [], groups: [], rows: [] };

function numberOrNull(value: string): number | null {
  const parsed = Number(value);
  return value.trim() === "" || Number.isNaN(parsed) ? null : parsed;
}

/**
 * 型枠転記。集計した明細のうち型枠分類が付いているものを分類別に集計し、
 * 分類ごとに決めた転記先（科目・部位・名称・単位・掛け率）で
 * 転記入力表の最終行へ追記する。次の集計に含まれる。
 * この機能で作った行は転記し直すと作り直すので、二重に増えない。
 */
export default function FormworkTransferPage({
  project,
  onBack,
}: Props): JSX.Element {
  const [view, setView] = useState<FormworkTransferView>(EMPTY);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    setView(await window.sekisan.getFormworkTransfer(project.id));
  }, [project.id]);

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects());
      await reload();
    })();
  }, [reload]);

  const update = (
    index: number,
    patch: Partial<FormworkTransferRule>,
  ): void => {
    const rules = view.rules.map((rule, i) =>
      i === index ? { ...rule, ...patch } : rule,
    );
    setView({ ...view, rules });
  };

  const save = async (): Promise<void> => {
    setView(
      await window.sekisan.saveFormworkRules({
        projectId: project.id,
        rules: view.rules,
      }),
    );
    setMessage("転記先を保存しました");
  };

  const run = async (): Promise<void> => {
    const saved = await window.sekisan.saveFormworkRules({
      projectId: project.id,
      rules: view.rules,
    });
    const result = await window.sekisan.runFormworkTransfer(project.id);
    setView(result);
    setMessage(
      saved.rows.length === 0
        ? "転記先（名称）を入力してから転記してください。"
        : `転記入力表へ ${result.rows.length} 行を追記しました（次の集計に含まれます）`,
    );
  };

  return (
    <div className="estimate-page check-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>型枠転記</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => void save()}>
          転記先を保存
        </button>
        <button type="button" onClick={() => void run()}>
          ▶ 転記入力表へ転記
        </button>
        <span className="message">
          {view.groups.length === 0
            ? "型枠分類の付いた集計明細がありません。"
            : message}
        </span>
      </div>

      <h3 className="section">転記先（型枠分類ごと）</h3>
      <table className="parts check-sheet">
        <thead>
          <tr>
            <th>型枠分類</th>
            <th>科目</th>
            <th>材種区分</th>
            <th>部位番号</th>
            <th>部位名</th>
            <th>明細番号</th>
            <th>名称</th>
            <th>摘要</th>
            <th>単位</th>
            <th>掛け率</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {view.rules.map((rule, index) => (
            <tr key={rule.formwork}>
              <td>{rule.formwork}</td>
              <td>
                <select
                  value={rule.subjectId ?? ""}
                  onChange={(e) =>
                    update(index, { subjectId: numberOrNull(e.target.value) })
                  }
                >
                  <option value="">（未設定）</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.id} {subject.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={rule.materialCategory}
                  onChange={(e) =>
                    update(index, { materialCategory: e.target.value })
                  }
                />
              </td>
              <td className="number">
                <input
                  value={rule.partNumber ?? ""}
                  onChange={(e) =>
                    update(index, { partNumber: numberOrNull(e.target.value) })
                  }
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={rule.partName}
                  onChange={(e) => update(index, { partName: e.target.value })}
                />
              </td>
              <td className="number">
                <input
                  value={rule.detailNumber ?? ""}
                  onChange={(e) =>
                    update(index, {
                      detailNumber: numberOrNull(e.target.value),
                    })
                  }
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={rule.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={rule.description}
                  onChange={(e) =>
                    update(index, { description: e.target.value })
                  }
                />
              </td>
              <td>
                <input
                  value={rule.unit}
                  onChange={(e) => update(index, { unit: e.target.value })}
                />
              </td>
              <td className="number">
                <input
                  value={rule.coefficient}
                  onChange={(e) =>
                    update(index, { coefficient: Number(e.target.value) || 0 })
                  }
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={rule.remarks}
                  onChange={(e) => update(index, { remarks: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="section">転記される行（集計数量×掛け率）</h3>
      <table className="parts check-sheet">
        <thead>
          <tr>
            <th>型枠分類</th>
            <th>部位Ⅰ</th>
            <th>部位Ⅱ</th>
            <th>名称</th>
            <th>摘要</th>
            <th>集計数量</th>
            <th>転記数量</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={`${row.formwork}|${row.part1}|${row.part2}`}>
              <td>{row.formwork}</td>
              <td>{row.part1}</td>
              <td>{row.part2}</td>
              <td>{row.name}</td>
              <td>{row.description}</td>
              <td className="number">{row.sourceQuantity.toFixed(2)}</td>
              <td className="number">{row.quantity.toFixed(2)}</td>
              <td>{row.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.rows.length === 0 && view.groups.length > 0 && (
        <p className="note">
          転記先の名称を入力すると、ここに転記する行が表示されます。
        </p>
      )}
      <p className="note">
        型枠分類ごとに
        部位Ⅰ・部位Ⅱ（仕分け✔のある行のみ）で合算します。転記し直すと前回この画面で作った行だけを作り直すので、二重に増えません。
      </p>
    </div>
  );
}
