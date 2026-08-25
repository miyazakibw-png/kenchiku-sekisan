import { useCallback, useEffect, useState } from "react";
import type {
  FormworkTransferRule,
  FormworkTransferView,
  ProjectSummary,
  Subject,
} from "@shared/types";
import "../estimate/EstimatePartsPage.css";
import "./CheckSheetPage.css";
import { useTableResize } from "../../hooks/useTableResize";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

const EMPTY: FormworkTransferView = {
  rules: [],
  sources: [],
  groups: [],
  rows: [],
};

function numberOrNull(value: string): number | null {
  const parsed = Number(value);
  return value.trim() === "" || Number.isNaN(parsed) ? null : parsed;
}

function newRule(sourceKeys: string[]): FormworkTransferRule {
  return {
    key: `型枠-${Date.now()}`,
    sourceKeys,
    formwork: "",
    coefficient: 1,
    subjectId: null,
    materialCategory: "",
    part1: "",
    part2: "",
    part3: "",
    partNumber: null,
    partName: "",
    detailNumber: null,
    name: "",
    description: "",
    unit: "",
    remarks: "",
  };
}

/**
 * 型枠転記。集計書兼工事マスターの明細（コンクリート壁など）を選び、
 * その明細の部屋ごとの拾い数量を型枠分類別に合算し、掛け率を掛けて
 * 別の明細（打放型枠など）として転記入力表の空き行へ自動転記する。
 * 選んだ元明細と転記先は覚えているので、集計をかけ直すたびに作り直す。
 */
export default function FormworkTransferPage({
  project,
  onBack,
}: Props): JSX.Element {
  const tableRef = useTableResize("table-widths-formwork-rules-v2");
  const tableRef1 = useTableResize("table-widths-formwork-groups-v2");
  const [view, setView] = useState<FormworkTransferView>(EMPTY);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [openRule, setOpenRule] = useState<string | null>(null);

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

  const addRule = (): void => {
    if (picked.length === 0) {
      setMessage("先に、型枠を算出する元の明細を選んでください");
      return;
    }
    setView({ ...view, rules: [...view.rules, newRule(picked)] });
    setPicked([]);
    setMessage(
      "元明細を選びました。掛け率と転記先（名称・単位など）を入れてください",
    );
  };

  const removeRule = (index: number): void => {
    setView({ ...view, rules: view.rules.filter((_, i) => i !== index) });
  };

  const save = async (): Promise<void> => {
    setView(
      await window.sekisan.saveFormworkRules({
        projectId: project.id,
        rules: view.rules,
      }),
    );
    setMessage("型枠明細を保存しました（集計をかけ直すたびに作り直します）");
  };

  const run = async (): Promise<void> => {
    const saved = await window.sekisan.saveFormworkRules({
      projectId: project.id,
      rules: view.rules,
    });
    if (saved.rows.length === 0) {
      setView(saved);
      setMessage("元明細と転記先の名称を入れてから算出してください。");
      return;
    }
    const result = await window.sekisan.runFormworkTransfer(project.id);
    setView(result);
    setMessage(
      `転記入力表へ ${result.rows.length} 行を自動転記しました（次の集計に含まれます）`,
    );
  };

  const sourceName = (key: string): string => {
    const item = view.sources.find((source) => source.masterKey === key);
    return item ? `${item.partName} ${item.name}`.trim() : key;
  };

  return (
    <div className="estimate-page check-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>型枠転記（集計した明細から型枠明細を算出）</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => void save()}>
          保存
        </button>
        <button type="button" onClick={() => void run()}>
          ▶ 算出して転記入力表へ
        </button>
        <span className="message">
          {view.sources.length === 0
            ? "先に集計をかけてください（集計書兼工事マスターの明細から選びます）。"
            : message}
        </span>
      </div>

      <h3 className="section">
        ① 型枠を算出する元の明細を選ぶ（集計書兼工事マスター）
      </h3>
      <table className="parts check-sheet">
        <thead>
          <tr>
            <th className="flag">選択</th>
            <th>部位Ⅰ</th>
            <th>部位Ⅱ</th>
            <th>部位名</th>
            <th>名称</th>
            <th>摘要</th>
            <th>数量</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {view.sources.map((item) => (
            <tr key={item.masterKey}>
              <td className="flag">
                <input
                  type="checkbox"
                  checked={picked.includes(item.masterKey)}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? [...picked, item.masterKey]
                        : picked.filter((key) => key !== item.masterKey),
                    )
                  }
                />
              </td>
              <td>{item.part1}</td>
              <td>{item.part2}</td>
              <td>{item.partName}</td>
              <td>{item.name}</td>
              <td>{item.descriptionUpper}</td>
              <td className="number">{item.quantity.toFixed(2)}</td>
              <td>{item.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        <button type="button" onClick={addRule}>
          ➕ 選んだ明細から型枠明細を作る
        </button>
        （選択 {picked.length} 件）
      </p>

      <h3 className="section">
        ② 型枠明細（掛け率と転記先。部位Ⅰ・Ⅱが空欄なら元明細の部位を使います）
      </h3>
      <table className="parts check-sheet" ref={tableRef}>
        <thead>
          <tr>
            <th>元明細</th>
            <th>型枠分類</th>
            <th>掛け率</th>
            <th>科目</th>
            <th>材種区分</th>
            <th>部位Ⅰ</th>
            <th>部位Ⅱ</th>
            <th>部位Ⅲ</th>
            <th>部位番号</th>
            <th>部位名</th>
            <th>明細番号</th>
            <th>名称</th>
            <th>摘要</th>
            <th>単位</th>
            <th>備考</th>
            <th>取消</th>
          </tr>
        </thead>
        <tbody>
          {view.rules.map((rule, index) => (
            <tr key={rule.key}>
              <td
                title={rule.sourceKeys.map(sourceName).join(" / ")}
                onClick={() =>
                  setOpenRule(openRule === rule.key ? null : rule.key)
                }
              >
                {rule.sourceKeys.length}件
                {openRule === rule.key && (
                  <div className="note">
                    {rule.sourceKeys.map((key) => (
                      <div key={key}>{sourceName(key)}</div>
                    ))}
                  </div>
                )}
              </td>
              <td>
                <input
                  lang="ja"
                  value={rule.formwork}
                  title="空欄なら分類を問わず、元明細の数量を全部使います"
                  onChange={(e) => update(index, { formwork: e.target.value })}
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
                  lang="ja"
                  value={rule.materialCategory}
                  onChange={(e) =>
                    update(index, { materialCategory: e.target.value })
                  }
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={rule.part1}
                  onChange={(e) => update(index, { part1: e.target.value })}
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={rule.part2}
                  onChange={(e) => update(index, { part2: e.target.value })}
                />
              </td>
              <td>
                <input
                  lang="ja"
                  value={rule.part3}
                  onChange={(e) => update(index, { part3: e.target.value })}
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
              <td>
                <input
                  lang="ja"
                  value={rule.remarks}
                  onChange={(e) => update(index, { remarks: e.target.value })}
                />
              </td>
              <td>
                <button type="button" onClick={() => removeRule(index)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="section">③ 算出結果（転記入力表へ入れる行）</h3>
      <table className="parts check-sheet" ref={tableRef1}>
        <thead>
          <tr>
            <th>型枠分類</th>
            <th>部位Ⅰ</th>
            <th>部位Ⅱ</th>
            <th>部位Ⅲ</th>
            <th>名称</th>
            <th>摘要</th>
            <th>元数量</th>
            <th>転記数量</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr
              key={`${row.formworkKey}|${row.formwork}|${row.part1}|${row.part2}`}
            >
              <td>{row.formwork}</td>
              <td>{row.part1}</td>
              <td>{row.part2}</td>
              <td>{row.part3}</td>
              <td>{row.name}</td>
              <td>{row.description}</td>
              <td className="number">{row.sourceQuantity.toFixed(2)}</td>
              <td className="number">{row.quantity.toFixed(2)}</td>
              <td>{row.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        元明細の部屋ごとの拾い数量を、型枠分類（部位別入力表で付けた分類）と
        部位Ⅰ・部位Ⅱ（仕分け✔のある行のみ）で合算し、掛け率を掛けます。
        算出した行は転記入力表の空き部分（入力があれば最後の行の次）へ入れます。
        元明細と型枠明細は結び付けて覚えているので、計算書を直して集計をかけ直すと
        型枠数量も自動で作り直します（二重に増えません）。
      </p>
    </div>
  );
}
