import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BreakdownExportKind,
  BreakdownRowRecord,
  BreakdownSettingsRecord,
  BreakdownVersion,
  BreakdownView,
  ProjectSummary,
  Subject,
} from "@shared/types";
import {
  BREAKDOWN_LAYOUT,
  NAME_PATTERN,
} from "../../../../core/breakdown/breakdown";
import { compareBreakdown, moveRow } from "../../../../core/breakdown/compare";
import "../estimate/EstimatePartsPage.css";
import "../aggregate/AggregatePage.css";
import "./BreakdownPage.css";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

const EMPTY_SETTINGS: BreakdownSettingsRecord = {
  projectId: 0,
  layout: BREAKDOWN_LAYOUT.twoLine,
  namePattern: NAME_PATTERN.asIs,
  nameWidth: "raw",
  roundThreshold1: 100,
  roundDecimals1: 0,
  roundThreshold2: 0,
  roundDecimals2: 1,
  roundDecimals3: 2,
  subjectOrder: [],
  replacements: [],
  unitOrder: [],
  workCategory: "建築主体工事",
};

function blankRow(): BreakdownRowRecord {
  return {
    id: null,
    displayOrder: 0,
    rowKind: "blank",
    subjectId: null,
    subjectName: "",
    masterKey: "",
    aggregateItemId: null,
    partName: "",
    nameUpper: "",
    nameLower: "",
    descriptionUpper: "",
    descriptionLower: "",
    quantity: null,
    unit: "",
    unitPrice: null,
    amount: null,
    remarksUpper: "",
    remarksLower: "",
  };
}

/**
 * 内訳書。集計書兼工事マスターから変換転記して作る。
 * 3層目＝工種科目の見出し、4層目＝その科目の明細（基準は2段1行）。
 * 提出の回ごとに版を残し、前回との比較ができる。
 */
export default function BreakdownPage({ project, onBack }: Props): JSX.Element {
  const [view, setView] = useState<BreakdownView>({
    version: null,
    rows: [],
    settings: { ...EMPTY_SETTINGS, projectId: project.id },
  });
  const [versions, setVersions] = useState<BreakdownVersion[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<number | null>(null);
  const [panel, setPanel] = useState<"none" | "settings" | "compare">("none");
  const [message, setMessage] = useState("");
  const [leftRows, setLeftRows] = useState<BreakdownRowRecord[]>([]);
  const [rightRows, setRightRows] = useState<BreakdownRowRecord[]>([]);
  const [compareTarget, setCompareTarget] = useState<number | null>(null);

  const reload = useCallback(
    async (versionId?: number) => {
      const next = await window.sekisan.getBreakdown(project.id, versionId);
      setView(next);
      setLeftRows(next.rows);
      setVersions(await window.sekisan.listBreakdownVersions(project.id));
    },
    [project.id],
  );

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects());
      await reload();
    })();
  }, [reload]);

  const settings = view.settings;

  const transfer = async (): Promise<void> => {
    const next = await window.sekisan.transferBreakdown(project.id);
    setView(next);
    setLeftRows(next.rows);
    setVersions(await window.sekisan.listBreakdownVersions(project.id));
    setMessage(
      next.version === null
        ? "集計処理を先に実行してください。"
        : `${next.version.round}回目として転記しました（${next.rows.length}行）`,
    );
  };

  const saveSettings = async (
    patch: Partial<BreakdownSettingsRecord>,
  ): Promise<void> => {
    const saved = await window.sekisan.saveBreakdownSettings({
      ...settings,
      ...patch,
      projectId: project.id,
    });
    setView((current) => ({ ...current, settings: saved }));
  };

  const confirmVersion = async (): Promise<void> => {
    if (!view.version) return;
    await window.sekisan.confirmBreakdownVersion(view.version.id);
    await reload(view.version.id);
    setMessage("この回を確定しました。次の転記は新しい回になります。");
  };

  const exportFile = async (kind: BreakdownExportKind): Promise<void> => {
    if (!view.version) return;
    const result = await window.sekisan.exportBreakdown({
      projectId: project.id,
      versionId: view.version.id,
      kind,
    });
    setMessage(
      result.filePath === null
        ? "掃き出しを取り消しました。"
        : `掃き出しました：${result.filePath}`,
    );
  };

  const openCompare = async (versionId: number): Promise<void> => {
    const other = await window.sekisan.getBreakdown(project.id, versionId);
    setRightRows(other.rows);
    setCompareTarget(versionId);
    setPanel("compare");
  };

  const saveCompare = async (): Promise<void> => {
    if (view.version) {
      await window.sekisan.saveBreakdownRows({
        versionId: view.version.id,
        rows: leftRows,
      });
    }
    if (compareTarget !== null) {
      await window.sekisan.saveBreakdownRows({
        versionId: compareTarget,
        rows: rightRows,
      });
    }
    setMessage("比較の行位置を保存しました。");
  };

  const usedSubjects = useMemo(() => {
    const names = new Map<number | null, string>();
    view.rows.forEach((row) => {
      if (row.rowKind === "subject") names.set(row.subjectId, row.subjectName);
    });
    const order = settings.subjectOrder;
    return [...names.entries()].sort((a, b) => {
      const ai = a[0] === null ? Number.MAX_SAFE_INTEGER : order.indexOf(a[0]);
      const bi = b[0] === null ? Number.MAX_SAFE_INTEGER : order.indexOf(b[0]);
      return ai - bi;
    });
  }, [settings.subjectOrder, view.rows]);

  const shownRows = useMemo(
    () =>
      selectedSubject === null
        ? view.rows
        : view.rows.filter((row) => row.subjectId === selectedSubject),
    [selectedSubject, view.rows],
  );

  const moveSubject = (subjectId: number, step: number): void => {
    const order = [...settings.subjectOrder];
    const index = order.indexOf(subjectId);
    if (index < 0) return;
    void saveSettings({ subjectOrder: moveRow(order, index, step) });
  };

  const diffs = useMemo(
    () => compareBreakdown(leftRows, rightRows),
    [leftRows, rightRows],
  );

  return (
    <div className="estimate-page aggregate-page breakdown-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>内訳書</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => void transfer()}>
          ⇩ 集計書から転記
        </button>
        <select
          value={view.version?.id ?? ""}
          onChange={(e) => void reload(Number(e.target.value))}
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.round}回目
              {version.confirmed === 1 ? "（確定）" : ""} {version.createdAt}
            </option>
          ))}
          {versions.length === 0 && <option value="">未作成</option>}
        </select>
        <button
          type="button"
          onClick={() => void confirmVersion()}
          disabled={!view.version || view.version.confirmed === 1}
        >
          ✓ この回を確定
        </button>
        <button type="button" onClick={() => void exportFile("bcs")}>
          BCS.CSV
        </button>
        <button type="button" onClick={() => void exportFile("excelAll")}>
          Excel（1シート）
        </button>
        <button type="button" onClick={() => void exportFile("excelBySubject")}>
          Excel（科目別）
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
        >
          ⚙ 設定
        </button>
        <select
          value={compareTarget ?? ""}
          onChange={(e) =>
            e.target.value === ""
              ? setPanel("none")
              : void openCompare(Number(e.target.value))
          }
        >
          <option value="">比較しない</option>
          {versions
            .filter((version) => version.id !== view.version?.id)
            .map((version) => (
              <option key={version.id} value={version.id}>
                {version.round}回目と比較
              </option>
            ))}
        </select>
        <span className="message">{message}</span>
      </div>

      {panel === "settings" && (
        <div className="breakdown-settings">
          <label>
            書式
            <select
              value={settings.layout}
              onChange={(e) =>
                void saveSettings({ layout: Number(e.target.value) })
              }
            >
              <option value={BREAKDOWN_LAYOUT.twoLine}>①2段1行</option>
              <option value={BREAKDOWN_LAYOUT.oneLine}>②1段</option>
              <option value={BREAKDOWN_LAYOUT.excel}>
                ③エクセル転記用（2段を1行）
              </option>
            </select>
          </label>
          <label>
            名称欄
            <select
              value={settings.namePattern}
              onChange={(e) =>
                void saveSettings({ namePattern: Number(e.target.value) })
              }
            >
              <option value={NAME_PATTERN.asIs}>そのまま</option>
              <option value={NAME_PATTERN.withPart}>部位＋名称</option>
            </select>
          </label>
          <label>
            名称（下段）の文字
            <select
              value={settings.nameWidth}
              onChange={(e) => void saveSettings({ nameWidth: e.target.value })}
            >
              <option value="raw">そのまま</option>
              <option value="half">半角</option>
              <option value="full">全角</option>
            </select>
          </label>
          <label>
            数量
            <input
              type="number"
              value={settings.roundThreshold1}
              onChange={(e) =>
                void saveSettings({ roundThreshold1: Number(e.target.value) })
              }
            />
            以上は
            <input
              type="number"
              value={settings.roundDecimals1}
              onChange={(e) =>
                void saveSettings({ roundDecimals1: Number(e.target.value) })
              }
            />
            桁、未満は
            <input
              type="number"
              value={settings.roundDecimals2}
              onChange={(e) =>
                void saveSettings({ roundDecimals2: Number(e.target.value) })
              }
            />
            桁（0になる場合は数字が出る桁まで）
          </label>
          <label>
            工事区分（BCS 2層目）
            <input
              lang="ja"
              value={settings.workCategory}
              onChange={(e) =>
                void saveSettings({ workCategory: e.target.value })
              }
            />
          </label>
          <div className="replacements">
            <span>摘要の文字置き換え</span>
            {settings.replacements.map((rule, index) => (
              <span key={`${rule.from}-${index}`} className="rule">
                <input
                  lang="ja"
                  value={rule.from}
                  onChange={(e) => {
                    const next = [...settings.replacements];
                    next[index] = { ...rule, from: e.target.value };
                    void saveSettings({ replacements: next });
                  }}
                />
                →
                <input
                  lang="ja"
                  value={rule.to}
                  onChange={(e) => {
                    const next = [...settings.replacements];
                    next[index] = { ...rule, to: e.target.value };
                    void saveSettings({ replacements: next });
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    void saveSettings({
                      replacements: settings.replacements.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() =>
                void saveSettings({
                  replacements: [
                    ...settings.replacements,
                    { from: "", to: "" },
                  ],
                })
              }
            >
              ＋追加
            </button>
          </div>
          <div className="units">
            単位：
            {settings.unitOrder.join("・") || "（転記すると自動で並びます）"}
          </div>
        </div>
      )}

      {panel === "compare" ? (
        <div className="breakdown-compare">
          <div className="compare-toolbar">
            <span>
              左：{view.version?.round ?? "-"}回目（新しい方）／右：
              {versions.find((v) => v.id === compareTarget)?.round ?? "-"}回目
            </span>
            <button type="button" onClick={() => void saveCompare()}>
              ⌷ 行位置を保存
            </button>
            <span className="note">
              行のずれは左右それぞれ「行挿入」「↑」「↓」で合わせます。違う部分に色が付きます。
            </span>
          </div>
          <table className="parts compare">
            <thead>
              <tr>
                <th className="ops">操作</th>
                <th>名称</th>
                <th>摘要</th>
                <th>数量</th>
                <th>単位</th>
                <th className="ops">操作</th>
                <th>名称</th>
                <th>摘要</th>
                <th>数量</th>
                <th>単位</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((diff) => (
                <tr key={diff.index}>
                  <td className="ops">
                    <button
                      type="button"
                      onClick={() =>
                        setLeftRows((rows) => {
                          const next = [...rows];
                          next.splice(diff.index, 0, blankRow());
                          return next;
                        })
                      }
                    >
                      ＋
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLeftRows((rows) => moveRow(rows, diff.index, -1))
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLeftRows((rows) => moveRow(rows, diff.index, 1))
                      }
                    >
                      ↓
                    </button>
                  </td>
                  {renderCompareCells(diff.left, diff.changed, diff.onlyLeft)}
                  <td className="ops">
                    <button
                      type="button"
                      onClick={() =>
                        setRightRows((rows) => {
                          const next = [...rows];
                          next.splice(diff.index, 0, blankRow());
                          return next;
                        })
                      }
                    >
                      ＋
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setRightRows((rows) => moveRow(rows, diff.index, -1))
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setRightRows((rows) => moveRow(rows, diff.index, 1))
                      }
                    >
                      ↓
                    </button>
                  </td>
                  {renderCompareCells(diff.right, diff.changed, diff.onlyRight)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="breakdown-body">
          <div className="subject-list">
            <button
              type="button"
              className={selectedSubject === null ? "selected" : ""}
              onClick={() => setSelectedSubject(null)}
            >
              すべて
            </button>
            {usedSubjects.map(([subjectId, name]) => (
              <div key={subjectId ?? "none"} className="subject-row">
                <button
                  type="button"
                  className={selectedSubject === subjectId ? "selected" : ""}
                  onClick={() => setSelectedSubject(subjectId)}
                >
                  {name}
                </button>
                {subjectId !== null && (
                  <span className="order">
                    <button
                      type="button"
                      onClick={() => moveSubject(subjectId, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSubject(subjectId, 1)}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </div>
            ))}
            <div className="hint">
              並びは提出先の指定に合わせて↑↓で変更します（{subjects.length}
              科目のうち集計で使った科目だけ並びます）
            </div>
          </div>

          <table className="parts breakdown">
            <thead>
              <tr>
                <th className="mark">印</th>
                <th>名称</th>
                <th>摘要</th>
                <th className="qty">数量</th>
                <th className="unit">単位</th>
                <th>備考</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row, index) =>
                row.rowKind === "subject" ? (
                  <tr key={`s-${index}`} className="subject">
                    <td className="mark">{row.subjectId ?? ""}</td>
                    <td colSpan={5}>{row.subjectName}</td>
                  </tr>
                ) : settings.layout === BREAKDOWN_LAYOUT.oneLine ? (
                  <tr key={`d-${index}`}>
                    <td className="mark" />
                    <td>{row.nameLower}</td>
                    <td>{row.descriptionLower}</td>
                    <td className="qty">{row.quantity ?? ""}</td>
                    <td className="unit">{row.unit}</td>
                    <td>{row.remarksLower}</td>
                  </tr>
                ) : (
                  <tr key={`d-${index}`} className="two-line">
                    <td className="mark" />
                    <td>
                      <div className="upper">{row.nameUpper}</div>
                      <div className="lower">{row.nameLower}</div>
                    </td>
                    <td>
                      <div className="upper">{row.descriptionUpper}</div>
                      <div className="lower">{row.descriptionLower}</div>
                    </td>
                    <td className="qty">
                      <div className="upper" />
                      <div className="lower">{row.quantity ?? ""}</div>
                    </td>
                    <td className="unit">
                      <div className="upper" />
                      <div className="lower">{row.unit}</div>
                    </td>
                    <td>
                      <div className="upper">{row.remarksUpper}</div>
                      <div className="lower">{row.remarksLower}</div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function renderCompareCells(
  row: BreakdownRowRecord | null,
  changed: string[],
  onlySide: boolean,
): JSX.Element[] {
  const mark = (field: string): string =>
    onlySide ? "only" : changed.includes(field) ? "changed" : "";
  if (row === null) {
    return [
      <td key="n" className="only" />,
      <td key="d" className="only" />,
      <td key="q" className="only" />,
      <td key="u" className="only" />,
    ];
  }
  const name = [row.nameUpper, row.nameLower].filter((v) => v !== "").join(" ");
  const description = [row.descriptionUpper, row.descriptionLower]
    .filter((v) => v !== "")
    .join(" ");
  return [
    <td key="n" className={mark("name")}>
      {row.rowKind === "subject" ? row.subjectName : name}
    </td>,
    <td key="d" className={mark("description")}>
      {description}
    </td>,
    <td key="q" className={`qty ${mark("quantity")}`}>
      {row.quantity ?? ""}
    </td>,
    <td key="u" className={`unit ${mark("unit")}`}>
      {row.unit}
    </td>,
  ];
}
