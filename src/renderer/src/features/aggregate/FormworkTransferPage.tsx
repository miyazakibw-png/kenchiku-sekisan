import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FormworkSourceItem,
  FormworkTransferRule,
  FormworkTransferView,
  ProjectSummary,
  Subject,
} from "@shared/types";
import { buildFormworkRulesFromSources } from "../../../../core/aggregate/formworkTransfer";
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

/** 転記科目の初期値（5 型枠工事） */
const FORMWORK_SUBJECT = 5;

/**
 * 漢字変換できるように、打ち終わり（欄を出る・Enter）で確定する入力欄。
 * 1文字ごとに書き換えると変換が切れてしまうため。
 */
function TextInput({
  value,
  onCommit,
  className,
  title,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  title?: string;
  placeholder?: string;
}): JSX.Element {
  return (
    <input
      lang="ja"
      key={value}
      className={className}
      defaultValue={value}
      title={title}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
    />
  );
}

function numberOrNull(value: string): number | null {
  const parsed = Number(value);
  return value.trim() === "" || Number.isNaN(parsed) ? null : parsed;
}

export default function FormworkTransferPage({
  project,
  onBack,
}: Props): JSX.Element {
  const tableRef = useTableResize("table-widths-formwork-rules-v3");
  const tableRef1 = useTableResize("table-widths-formwork-rows-v3");
  const [view, setView] = useState<FormworkTransferView>(EMPTY);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [bulkName, setBulkName] = useState("");
  const [bulkSubject, setBulkSubject] = useState<number | null>(
    FORMWORK_SUBJECT,
  );
  const [bulkUnit, setBulkUnit] = useState("");
  const [bulkCoefficient, setBulkCoefficient] = useState(1);
  const [bulkCategory, setBulkCategory] = useState("");
  const [copyDescription, setCopyDescription] = useState(true);

  const reload = useCallback(async () => {
    setView(await window.sekisan.getFormworkTransfer(project.id));
  }, [project.id]);

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects());
      await reload();
    })();
  }, [reload]);

  /** 名称で探した元明細（空欄なら全部） */
  const shown = useMemo(() => {
    const word = search.trim();
    return word === ""
      ? view.sources
      : view.sources.filter(
          (item) =>
            item.name.includes(word) || item.descriptionUpper.includes(word),
        );
  }, [search, view.sources]);

  const update = (
    index: number,
    patch: Partial<FormworkTransferRule>,
  ): void => {
    const rules = view.rules.map((rule, i) =>
      i === index ? { ...rule, ...patch } : rule,
    );
    setView({ ...view, rules });
  };

  /** 探した元明細をまとめて型枠明細に変える（1件ずつ入力しない） */
  const addBulk = (): void => {
    const sources = view.sources.filter((item) =>
      picked.includes(item.masterKey),
    );
    if (sources.length === 0) {
      setMessage("先に、型枠に変える元の明細を選んでください");
      return;
    }
    if (bulkName.trim() === "") {
      setMessage("転記先名称（例：打放型枠）を入れてください");
      return;
    }
    const rules = buildFormworkRulesFromSources(
      sources,
      {
        subjectId: bulkSubject,
        name: bulkName,
        unit: bulkUnit,
        coefficient: bulkCoefficient,
        materialCategory: bulkCategory,
        copyDescription,
      },
      `型枠-${Date.now()}`,
    );
    setView({ ...view, rules: [...view.rules, ...rules] });
    setPicked([]);
    setMessage(
      `${rules.length} 件を型枠明細に変えました（右側で摘要・掛け率を直せます）`,
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

  const sourcesOf = (keys: readonly string[]): FormworkSourceItem[] =>
    keys
      .map((key) => view.sources.find((source) => source.masterKey === key))
      .filter((item): item is FormworkSourceItem => item !== undefined);

  return (
    <div className="estimate-page check-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>型枠転記（拾った明細を型枠明細に変える）</h2>
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
        ① 名称で探して、型枠にする元の明細を選ぶ（例：打放補修）
      </h3>
      <div className="toolbar">
        <label>
          名称で検索{" "}
          <TextInput
            value={search}
            placeholder="例：打放補修"
            onCommit={setSearch}
          />
        </label>
        <button
          type="button"
          onClick={() => setPicked(shown.map((item) => item.masterKey))}
        >
          表示中を全部選ぶ（{shown.length}件）
        </button>
        <button type="button" onClick={() => setPicked([])}>
          選択を外す
        </button>
      </div>
      <table className="parts check-sheet">
        <thead>
          <tr>
            <th className="flag">選択</th>
            <th>部位Ⅰ</th>
            <th>部位Ⅱ</th>
            <th>部位名</th>
            <th>名称・摘要</th>
            <th>数量</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item) => (
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
              <td>
                <div>{item.name}</div>
                <div className="lower">
                  {item.descriptionUpper}
                  {item.descriptionLower === ""
                    ? ""
                    : ` / ${item.descriptionLower}`}
                </div>
              </td>
              <td className="number">{item.quantity.toFixed(2)}</td>
              <td>{item.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="section">
        ② 型枠の内容を決めて、選んだ分をまとめて変える（選択 {picked.length} 件）
      </h3>
      <div className="toolbar">
        <label>
          転記科目{" "}
          <select
            value={bulkSubject ?? ""}
            onChange={(e) => setBulkSubject(numberOrNull(e.target.value))}
          >
            <option value="">（未設定）</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.id} {subject.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          転記先名称{" "}
          <TextInput
            value={bulkName}
            placeholder="例：打放型枠"
            onCommit={setBulkName}
          />
        </label>
        <label>
          単位{" "}
          <TextInput
            className="num"
            value={bulkUnit}
            placeholder="空欄＝元の単位"
            onCommit={setBulkUnit}
          />
        </label>
        <label>
          掛け率（あとで明細ごとに直せます）{" "}
          <input
            className="num"
            value={bulkCoefficient}
            onChange={(e) => setBulkCoefficient(Number(e.target.value) || 0)}
          />
        </label>
        <label>
          材種区分{" "}
          <TextInput
            value={bulkCategory}
            placeholder="空欄＝元のまま"
            onCommit={setBulkCategory}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={copyDescription}
            onChange={(e) => setCopyDescription(e.target.checked)}
          />{" "}
          摘要を元明細から写す
        </label>
        <button type="button" onClick={addBulk}>
          ➕ この内容で型枠明細に変える
        </button>
      </div>

      <h3 className="section">
        ③ 変換の一覧（左：変換元明細／右：変換後の型枠明細。摘要は2段）
      </h3>
      <table className="parts check-sheet" ref={tableRef}>
        <thead>
          <tr>
            <th colSpan={5}>変換元明細</th>
            <th colSpan={6}>変換後の型枠明細</th>
            <th rowSpan={2}>取消</th>
          </tr>
          <tr>
            <th>部位</th>
            <th>名称・摘要</th>
            <th>数量</th>
            <th>単位</th>
            <th>掛け率</th>
            <th>科目</th>
            <th>材種区分</th>
            <th>名称</th>
            <th>摘要 上段</th>
            <th>摘要 下段</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {view.rules.map((rule, index) => {
            const sources = sourcesOf(rule.sourceKeys);
            const quantity = sources.reduce(
              (sum, item) => sum + item.quantity,
              0,
            );
            return (
              <tr key={rule.key}>
                <td>
                  {sources.map((item) => (
                    <div key={item.masterKey}>
                      {`${item.part1} ${item.part2} ${item.partName}`.trim()}
                    </div>
                  ))}
                </td>
                <td>
                  {sources.map((item) => (
                    <div key={item.masterKey}>
                      <div>{item.name}</div>
                      <div className="lower">
                        {item.descriptionUpper}
                        {item.descriptionLower === ""
                          ? ""
                          : ` / ${item.descriptionLower}`}
                      </div>
                    </div>
                  ))}
                </td>
                <td className="number">{quantity.toFixed(2)}</td>
                <td>{sources[0]?.unit ?? ""}</td>
                <td className="number">
                  <input
                    value={rule.coefficient}
                    onChange={(e) =>
                      update(index, {
                        coefficient: Number(e.target.value) || 0,
                      })
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
                  <TextInput
                    value={rule.materialCategory}
                    onCommit={(value) =>
                      update(index, { materialCategory: value })
                    }
                  />
                </td>
                <td>
                  <TextInput
                    value={rule.name}
                    onCommit={(value) => update(index, { name: value })}
                  />
                </td>
                <td>
                  <TextInput
                    value={rule.description}
                    onCommit={(value) => update(index, { description: value })}
                  />
                </td>
                <td>
                  <TextInput
                    value={rule.descriptionLower}
                    onCommit={(value) =>
                      update(index, { descriptionLower: value })
                    }
                  />
                </td>
                <td>
                  <TextInput
                    value={rule.unit}
                    onCommit={(value) => update(index, { unit: value })}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => removeRule(index)}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="section">
        ④ 算出結果（型枠分類ごとにタイトル行を置き、転記入力表へ入れます）
      </h3>
      <table className="parts check-sheet" ref={tableRef1}>
        <thead>
          <tr>
            <th>明細番号</th>
            <th>名称</th>
            <th>摘要 上段</th>
            <th>摘要 下段</th>
            <th>元数量</th>
            <th>転記数量</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr
              key={`${row.formwork}|${row.detailNumber}`}
              className={row.title ? "title-row" : undefined}
            >
              <td className="number">{row.detailNumber}</td>
              <td>{row.name}</td>
              <td>{row.description}</td>
              <td>{row.descriptionLower}</td>
              <td className="number">
                {row.title ? "" : row.sourceQuantity.toFixed(2)}
              </td>
              <td className="number">
                {row.title ? "" : row.quantity.toFixed(2)}
              </td>
              <td>{row.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        型枠分類は部位別入力表で部屋ごとに入れます。その部屋で拾った分がその分類になり、
        分類ごとにタイトル行（&lt;分類名&gt;）を置いて、その下に摘要ごとの明細を並べます。
        同じ分類・同じ摘要は合算し、分類の並びは型枠分類マスターの登録番号順、
        分類の入っていない拾いは「分類なし」でまとめます。
      </p>
    </div>
  );
}
