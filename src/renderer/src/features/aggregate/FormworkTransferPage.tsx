import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FormworkSourceItem,
  FormworkRunView,
  FormworkTransferRow,
  FormworkTransferRule,
  FormworkTransferView,
  MasterOptions,
  ProjectSummary,
  Subject,
} from "@shared/types";
import { resolveMasterName } from "@shared/masters";
import {
  buildFormworkRulesFromSources,
  compareFormworkRuns,
  moveFormworkRow,
  sortFormworkRowsByName,
} from "../../../../core/aggregate/formworkTransfer";
import PickInput, { type PickEntry } from "../../components/PickInput";
import "../estimate/EstimatePartsPage.css";
import "./CheckSheetPage.css";
import { useTableResize } from "../../hooks/useTableResize";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

const EMPTY: FormworkTransferView = {
  sources: [],
  groups: [],
  runs: [],
  lastSearch: "",
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
  onInput,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  title?: string;
  placeholder?: string;
  onInput?: () => void;
}): JSX.Element {
  return (
    <input
      lang="ja"
      key={value}
      className={className}
      defaultValue={value}
      title={title}
      placeholder={placeholder}
      onInput={onInput}
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

interface FormworkRunTableProps {
  projectId: number;
  run: FormworkRunView;
  runCount: number;
  runIndex: number;
  previousRows: readonly FormworkTransferRow[] | null;
  onViewChange: (view: FormworkTransferView) => void;
  onMessage: (message: string) => void;
}

function FormworkRunTable({
  projectId,
  run,
  runCount,
  runIndex,
  previousRows,
  onViewChange,
  onMessage,
}: FormworkRunTableProps): JSX.Element {
  const tableRef = useTableResize("table-widths-formwork-runs-v1");
  const comparison = useMemo(
    () => compareFormworkRuns(run.rows, previousRows),
    [run.rows, previousRows],
  );

  const reorder = async (
    rows: readonly FormworkTransferRow[],
    message: string,
  ): Promise<void> => {
    onViewChange(
      await window.sekisan.reorderFormworkRows({ projectId, rows: [...rows] }),
    );
    onMessage(message);
  };

  const remove = async (): Promise<void> => {
    if (
      !window.confirm(
        "この算出結果の表を消しますか？（転記入力表の行は消えません）",
      )
    )
      return;
    onViewChange(
      await window.sekisan.deleteFormworkRun({ projectId, runId: run.id }),
    );
    onMessage("算出結果の表を消しました。");
  };

  return (
    <section className="formwork-run-table-block">
      <div className="formwork-run-caption">
        第{runCount - runIndex}回 {run.createdAt}　検索：
        {run.search || "（なし）"}
      </div>
      <div className="formwork-run-actions">
        {run.current && (
          <>
            <strong>転記入力表に入っています</strong>
            <button
              type="button"
              onClick={() =>
                void reorder(
                  sortFormworkRowsByName(run.rows),
                  "分類ごとに名称の昇順に並び替えました",
                )
              }
            >
              名称の昇順に並び替える
            </button>
            <span className="note">
              明細は↑↓で上下へ移せます。並びは転記入力表にも反映されます。
            </span>
          </>
        )}
        <button type="button" onClick={() => void remove()}>
          ✕ 消す
        </button>
      </div>
      <table className="parts check-sheet formwork-run-table" ref={tableRef}>
        <thead>
          <tr>
            {run.current && <th className="flag">並び</th>}
            <th>明細番号</th>
            <th>名称</th>
            <th>摘要 下段</th>
            <th>摘要 上段</th>
            <th>元数量</th>
            <th>転記数量</th>
            <th>単位</th>
            <th>前回</th>
            <th>差</th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((entry, index) => {
            const { row } = entry;
            const className = [
              row.title ? "title-row" : "",
              entry.status === "changed" ? "formwork-changed-row" : "",
              entry.status === "new" && !row.title ? "formwork-new-row" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const difference =
              entry.previousQuantity === null || row.title
                ? ""
                : row.quantity - entry.previousQuantity;
            return (
              <tr
                key={`${row.formwork}|${row.detailNumber}|${row.name}|${index}`}
                className={className || undefined}
              >
                {run.current && (
                  <td className="flag">
                    {row.title ? (
                      ""
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={
                            !run.rows
                              .slice(0, index)
                              .some((above) => !above.title)
                          }
                          onClick={() =>
                            void reorder(
                              moveFormworkRow(run.rows, index, -1),
                              "並びを変えました（転記入力表へも反映しました）",
                            )
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={
                            !run.rows
                              .slice(index + 1)
                              .some((below) => !below.title)
                          }
                          onClick={() =>
                            void reorder(
                              moveFormworkRow(run.rows, index, 1),
                              "並びを変えました（転記入力表へも反映しました）",
                            )
                          }
                        >
                          ↓
                        </button>
                      </>
                    )}
                  </td>
                )}
                <td className="number">{row.detailNumber}</td>
                <td>{row.name}</td>
                <td>{row.descriptionLower}</td>
                <td>{row.description}</td>
                <td className="number">
                  {row.title ? "" : row.sourceQuantity.toFixed(2)}
                </td>
                <td className="number">
                  {row.title ? "" : row.quantity.toFixed(2)}
                </td>
                <td>{row.unit}</td>
                <td className="number">
                  {entry.previousQuantity === null || row.title
                    ? ""
                    : entry.previousQuantity.toFixed(2)}
                </td>
                <td>
                  {row.title
                    ? ""
                    : entry.status === "new"
                      ? "新"
                      : difference === ""
                        ? ""
                        : `${difference >= 0 ? "+" : ""}${difference.toFixed(2)}`}
                </td>
              </tr>
            );
          })}
          {comparison.removed.map((row, index) => (
            <tr
              key={`removed|${row.formwork}|${row.detailNumber}|${row.name}|${index}`}
              className="formwork-removed-row"
            >
              {run.current && <td className="flag" />}
              <td className="number">{row.detailNumber}</td>
              <td>{row.name}</td>
              <td>{row.descriptionLower}</td>
              <td>{row.description}</td>
              <td className="number">{row.sourceQuantity.toFixed(2)}</td>
              <td className="number" />
              <td>{row.unit}</td>
              <td className="number">{row.quantity.toFixed(2)}</td>
              <td>前回だけ</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function FormworkTransferPage({
  project,
  onBack,
}: Props): JSX.Element {
  const tableRef0 = useTableResize("table-widths-formwork-source-v1");
  const tableRef = useTableResize("table-widths-formwork-rules-v3");
  const [view, setView] = useState<FormworkTransferView>(EMPTY);
  const [rules, setRules] = useState<FormworkTransferRule[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const initialSearchSet = useRef(false);
  const searchTouched = useRef(false);
  const [bulkName, setBulkName] = useState("打放型枠");
  const [bulkSubject, setBulkSubject] = useState<number | null>(
    FORMWORK_SUBJECT,
  );
  const [bulkUnit, setBulkUnit] = useState("");
  const [bulkCoefficient, setBulkCoefficient] = useState(1);
  const [copyDescription, setCopyDescription] = useState(true);
  /** ①の表に出す工種科目（localStorageに残す。未設定は左官工事のみ・無ければ全部） */
  const [subjectSel, setSubjectSel] = useState<ReadonlySet<string> | null>(
    null,
  );

  const reload = useCallback(async () => {
    const next = await window.sekisan.getFormworkTransfer(project.id);
    setView(next);
    if (!initialSearchSet.current) {
      if (!searchTouched.current) setSearch(next.lastSearch);
      initialSearchSet.current = true;
    }
  }, [project.id]);

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects());
      setOptions(await window.sekisan.getMasterOptions(project.id));
      await reload();
    })();
  }, [reload, project.id]);

  /** 単位欄は番号入力で単位マスターの名称に変わる（全画面共通の入力方式） */
  const unitOf = (text: string): string =>
    resolveMasterName(options?.units ?? [], text);

  /** 単位マスターの呼び出し一覧（計算書の単位欄と同じ並び） */
  const unitEntries: PickEntry[] = useMemo(
    () =>
      (options?.units ?? []).map((unit) => ({
        value: unit.name,
        label: `${unit.id}　${unit.name}`,
      })),
    [options],
  );

  const subjectKeyOf = (subjectId: number | null): string =>
    subjectId === null ? "none" : String(subjectId);

  /** ①の表に出る明細に載っている工種科目（科目マスターの並び。科目なしは最後） */
  const subjectOptions = useMemo(() => {
    const counts = new Map<string, number>();
    view.sources.forEach((item) => {
      const key = subjectKeyOf(item.subjectId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    const options: { key: string; label: string; count: number }[] = [];
    subjects.forEach((subject) => {
      const count = counts.get(String(subject.id));
      if (count !== undefined && count > 0) {
        options.push({
          key: String(subject.id),
          label: `${subject.id} ${subject.name}`,
          count,
        });
        counts.delete(String(subject.id));
      }
    });
    counts.forEach((count, key) => {
      options.push({
        key,
        label: key === "none" ? "（科目なし）" : key,
        count,
      });
    });
    return options;
  }, [view.sources, subjects]);

  /** 表示する工種科目の初期値：前回の選びを復元、初めては左官工事のみ（無ければ全部） */
  useEffect(() => {
    if (subjectSel !== null || subjectOptions.length === 0) return;
    const valid = new Set(subjectOptions.map((option) => option.key));
    const stored = window.localStorage.getItem("formwork-source-subjects");
    if (stored !== null) {
      try {
        const keys = (JSON.parse(stored) as string[]).filter((key) =>
          valid.has(key),
        );
        if (keys.length > 0) {
          setSubjectSel(new Set(keys));
          return;
        }
      } catch {
        // 読めないときは初期値へ
      }
    }
    const plaster = subjectOptions
      .filter((option) => option.label.includes("左官"))
      .map((option) => option.key);
    setSubjectSel(new Set(plaster.length > 0 ? plaster : [...valid]));
  }, [subjectOptions, subjectSel]);

  const toggleSubject = (key: string, on: boolean): void => {
    const next = new Set(subjectSel ?? []);
    if (on) next.add(key);
    else next.delete(key);
    setSubjectSel(next);
    window.localStorage.setItem(
      "formwork-source-subjects",
      JSON.stringify([...next]),
    );
  };

  const selectAllSubjects = (): void => {
    const next = new Set(subjectOptions.map((option) => option.key));
    setSubjectSel(next);
    window.localStorage.setItem(
      "formwork-source-subjects",
      JSON.stringify([...next]),
    );
  };

  /** 名称で探した元明細（空欄なら全部）＋表示する工種科目で絞る */
  const shown = useMemo(() => {
    const word = search.trim();
    return view.sources.filter((item) => {
      if (subjectSel !== null && !subjectSel.has(subjectKeyOf(item.subjectId)))
        return false;
      if (word === "") return true;
      return item.name.includes(word) || item.descriptionUpper.includes(word);
    });
  }, [search, view.sources, subjectSel]);

  /** すでに型枠明細に登録してある元明細（再び変換を押すと入れ替わる） */
  const covered = useMemo(
    () => new Set(rules.flatMap((rule) => rule.sourceKeys)),
    [rules],
  );

  const update = (
    index: number,
    patch: Partial<FormworkTransferRule>,
  ): void => {
    const next = rules.map((rule, i) =>
      i === index ? { ...rule, ...patch } : rule,
    );
    setRules(next);
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
    const addedRules = buildFormworkRulesFromSources(
      sources,
      {
        subjectId: bulkSubject,
        name: bulkName,
        unit: bulkUnit,
        coefficient: bulkCoefficient,
        copyDescription,
      },
      `型枠-${Date.now()}`,
    );
    // すでに登録済みの元明細を選んだときは、古い決まりを消して入れ替える（二重登録を防ぐ）
    const pickedSet = new Set(picked);
    const cleared = rules.filter(
      (rule) => !rule.sourceKeys.some((key) => pickedSet.has(key)),
    );
    const replaced = rules.length - cleared.length;
    setRules([...cleared, ...addedRules]);
    setPicked([]);
    setMessage(
      `${addedRules.length} 件を型枠明細に変えました${replaced > 0 ? `（登録済みの ${replaced} 件は入れ替えました）` : ""}（右側で摘要・掛け率を直せます）`,
    );
  };

  const removeRule = (index: number): void => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const run = async (): Promise<void> => {
    const result = await window.sekisan.runFormworkTransfer({
      projectId: project.id,
      rules,
      search,
    });
    setView(result);
    if (!result.created) {
      setMessage("元明細と転記先の名称を入れてから算出してください。");
      return;
    }
    setMessage(
      `集計をかけ直して、転記入力表へ ${result.runs[0]?.rows.length ?? 0} 行を自動転記しました（④のいちばん左に表を足しました）`,
    );
  };

  const back = (): void => onBack();

  const sourcesOf = (keys: readonly string[]): FormworkSourceItem[] =>
    keys
      .map((key) => view.sources.find((source) => source.masterKey === key))
      .filter((item): item is FormworkSourceItem => item !== undefined);

  return (
    <div className="estimate-page check-sheet-page formwork-transfer-page">
      <div className="toolbar">
        <button type="button" onClick={() => void back()}>
          ← 工事管理画面へ
        </button>
        <h2>型枠転記（拾った明細を型枠明細に変える）</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <span className="message">
          {message !== ""
            ? message
            : view.sources.length === 0
              ? "先に集計をかけてください（集計書兼工事マスターの明細から選びます）。"
              : ""}
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
            onInput={() => {
              searchTouched.current = true;
            }}
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
      {subjectOptions.length > 1 && (
        <div className="toolbar subject-filter">
          <span>表示する工種：</span>
          {subjectOptions.map((option) => (
            <label key={option.key}>
              <input
                type="checkbox"
                checked={subjectSel?.has(option.key) === true}
                onChange={(event) =>
                  toggleSubject(option.key, event.target.checked)
                }
              />{" "}
              {option.label}（{option.count}）
            </label>
          ))}
          <button type="button" onClick={selectAllSubjects}>
            全部
          </button>
        </div>
      )}
      <table className="parts check-sheet" ref={tableRef0}>
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
                {covered.has(item.masterKey) && (
                  <div className="registered">登録済</div>
                )}
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
        ② 型枠の内容を決めて、選んだ分をまとめて変える（選択 {picked.length}{" "}
        件）
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
          <PickInput
            className="num"
            entries={unitEntries}
            halfWidth
            value={bulkUnit}
            placeholder="空欄＝元の単位"
            title="単位。一覧から選べます。番号を打つと単位の文字に変わります"
            onCommit={(value) => setBulkUnit(unitOf(value))}
          />
        </label>
        <label>
          掛け率（あとで明細ごとに直せます。小数2桁まで可）{" "}
          <TextInput
            className="num"
            value={String(bulkCoefficient)}
            onCommit={(value) => setBulkCoefficient(numberOrNull(value) ?? 0)}
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
            <th colSpan={5}>変換後の型枠明細</th>
            <th rowSpan={2}>取消</th>
          </tr>
          <tr>
            <th>部位</th>
            <th>名称・摘要</th>
            <th>数量</th>
            <th>単位</th>
            <th>掛け率</th>
            <th>科目</th>
            <th>名称</th>
            <th>摘要 下段</th>
            <th>摘要 上段</th>
            <th>単位</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, index) => {
            const sources = sourcesOf(rule.sourceKeys);
            const quantity = sources.reduce(
              (sum, item) => sum + item.quantity,
              0,
            );
            const unitMismatch = sources.some(
              (item) => item.unit !== rule.unit,
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
                  <TextInput
                    className="num"
                    value={String(rule.coefficient)}
                    onCommit={(value) =>
                      update(index, {
                        coefficient: numberOrNull(value) ?? 0,
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
                    value={rule.name}
                    onCommit={(value) => update(index, { name: value })}
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
                    value={rule.description}
                    onCommit={(value) => update(index, { description: value })}
                  />
                </td>
                <td
                  className={unitMismatch ? "unit-mismatch" : undefined}
                  title={
                    unitMismatch
                      ? `元明細の単位（${sources.map((item) => item.unit).join("／")}）と違います`
                      : undefined
                  }
                >
                  <PickInput
                    entries={unitEntries}
                    halfWidth
                    value={rule.unit}
                    title="単位。一覧から選べます。番号を打つと単位の文字に変わります"
                    onCommit={(value) => update(index, { unit: unitOf(value) })}
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

      <div className="toolbar">
        <button type="button" onClick={() => void run()}>
          ▶ 算出して転記入力表へ
        </button>
        <span className="note">
          ①で元の明細を選び、②で型枠の内容を決めて変え、③の一覧で摘要・掛け率を直してから押してください。
          転記入力表の最後に部位Ⅰ「仕上転記数量」として入り、算出するたびに④の左へ結果の表を足します。
        </span>
      </div>

      <h3 className="section">
        ④
        算出結果（算出するたびに左へ表を足します。色の付いた行は前回（右の表）と数量が違います）
      </h3>
      <div className="formwork-run-tables">
        {view.runs.map((run, index) => (
          <FormworkRunTable
            key={run.id}
            projectId={project.id}
            run={run}
            runCount={view.runs.length}
            runIndex={index}
            previousRows={view.runs[index + 1]?.rows ?? null}
            onViewChange={setView}
            onMessage={setMessage}
          />
        ))}
      </div>
      <p className="note">
        型枠分類は部位別入力表で部屋ごとに入れます。その部屋で拾った分がその分類になり、
        分類ごとにタイトル行（&lt;分類名&gt;）を置いて、その下に摘要ごとの明細を並べます。
        同じ分類・同じ摘要は合算し、分類の並びは型枠分類マスターの登録番号順、
        分類の入っていない拾いは「分類なし」でまとめます。
      </p>
    </div>
  );
}
