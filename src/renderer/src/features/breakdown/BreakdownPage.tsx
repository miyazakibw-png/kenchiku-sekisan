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
import type { BreakdownDiff } from "../../../../core/breakdown/compare";
import { compareBreakdown, moveRow } from "../../../../core/breakdown/compare";
import "../estimate/EstimatePartsPage.css";
import "../aggregate/AggregatePage.css";
import "./BreakdownPage.css";
import { useTableResize } from "../../hooks/useTableResize";
import { useUndoRedo } from "../../hooks/useUndoRedo";

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

/**
 * 打ち終わり（欄を出る・Enter）で確定する入力欄。
 * 1文字ごとに書き換えると漢字変換が切れるため。
 */
function TextInput({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
}): JSX.Element {
  return (
    <input
      lang="ja"
      key={value}
      className={className}
      defaultValue={value}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
    />
  );
}

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
  const tableRef = useTableResize("table-widths-breakdown-compare-v2");
  const tableRef1 = useTableResize("table-widths-breakdown-v1");
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
  /** 比較画面の行操作を戻る／進むできるようにする */
  const history = useUndoRedo<{
    left: BreakdownRowRecord[];
    right: BreakdownRowRecord[];
  }>();

  /** 行を動かす前に今の状態を履歴へ積む */
  const editCompare = (
    side: "left" | "right",
    change: (rows: BreakdownRowRecord[]) => BreakdownRowRecord[],
  ): void => {
    history.push({ left: leftRows, right: rightRows });
    if (side === "left") setLeftRows(change(leftRows));
    else setRightRows(change(rightRows));
  };

  const undoCompare = (): void => {
    const previous = history.undo({ left: leftRows, right: rightRows });
    if (!previous) return;
    setLeftRows(previous.left);
    setRightRows(previous.right);
  };

  const redoCompare = (): void => {
    const next = history.redo({ left: leftRows, right: rightRows });
    if (!next) return;
    setLeftRows(next.left);
    setRightRows(next.right);
  };

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

  /**
   * 設定を保存して、いま見ている回（未確定）を作り直す。
   * 書式・名称の文字幅・摘要の置き換えは、保存した時点で画面に出る（転記のやり直しは不要）。
   */
  const saveSettings = async (
    patch: Partial<BreakdownSettingsRecord>,
  ): Promise<void> => {
    const saved = await window.sekisan.saveBreakdownSettings({
      ...settings,
      ...patch,
      projectId: project.id,
    });
    setView((current) => ({ ...current, settings: saved }));
    if (view.version && view.version.confirmed === 0) {
      const next = await window.sekisan.transferBreakdown(project.id);
      setView(next);
      setLeftRows(next.rows);
      setMessage("設定を変えたので、この回を作り直しました。");
    } else if (view.version) {
      setMessage(
        "確定した回は作り直しません（新しく転記すると設定が効きます）。",
      );
    }
  };

  const confirmVersion = async (): Promise<void> => {
    if (!view.version) return;
    await window.sekisan.confirmBreakdownVersion(view.version.id);
    await reload(view.version.id);
    setMessage("この回を確定しました。次の転記は新しい回になります。");
  };

  /** この回（内訳書）を消す。集計書兼工事マスターと計算書はそのまま */
  const deleteVersion = async (): Promise<void> => {
    const target = view.version;
    if (!target) return;
    if (!window.confirm(`${target.round}回目の内訳書を消します。よろしいですか。`))
      return;
    await window.sekisan.deleteBreakdownVersion(target.id);
    setPanel("none");
    setCompareTarget(null);
    setRightRows([]);
    await reload();
    setMessage(`${target.round}回目の内訳書を消しました。`);
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
    history.clear();
    setMessage(
      `${other.version?.round ?? "-"}回目（${other.rows.length}行）と比べています`,
    );
  };

  /** 前の回（1つ前の提出）と見比べる */
  const comparePrevious = async (): Promise<void> => {
    const previous = versions.find(
      (version) => version.round === (view.version?.round ?? 0) - 1,
    );
    if (!previous) {
      setMessage("比べる前の回がありません（確定してから次の回を作ります）。");
      return;
    }
    await openCompare(previous.id);
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

  // 比較画面では Ctrl+Z で戻る、Ctrl+Y（Ctrl+Shift+Z）で進む
  useEffect(() => {
    if (panel !== "compare") return;
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoCompare();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoCompare();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
        <button
          type="button"
          onClick={() => void deleteVersion()}
          disabled={!view.version}
          title="この回の内訳書だけを消します（集計書・計算書はそのまま）"
        >
          🗑 この回を削除
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
        <button
          type="button"
          onClick={() => void comparePrevious()}
          disabled={(view.version?.round ?? 0) < 2}
        >
          ⇔ 前回と比較
        </button>
        <select
          value={panel === "compare" ? (compareTarget ?? "") : ""}
          onChange={(e) => {
            if (e.target.value === "") {
              setCompareTarget(null);
              setPanel("none");
              return;
            }
            void openCompare(Number(e.target.value));
          }}
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
              <option value={BREAKDOWN_LAYOUT.twoRow}>
                ④2段2行（集計書のまま）
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
            <TextInput
              value={settings.workCategory}
              onCommit={(value) => void saveSettings({ workCategory: value })}
            />
          </label>
          <div className="replacements">
            <span>摘要の文字置き換え</span>
            {settings.replacements.map((rule, index) => (
              <span key={`${rule.from}-${index}`} className="rule">
                <TextInput
                  value={rule.from}
                  onCommit={(value) => {
                    const next = [...settings.replacements];
                    next[index] = { ...rule, from: value };
                    void saveSettings({ replacements: next });
                  }}
                />
                →
                <TextInput
                  value={rule.to}
                  onCommit={(value) => {
                    const next = [...settings.replacements];
                    next[index] = { ...rule, to: value };
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
            <button
              type="button"
              onClick={undoCompare}
              disabled={!history.canUndo}
              title="行の挿入・移動を1つ戻す（Ctrl+Z）"
            >
              ↶ 戻る
            </button>
            <button
              type="button"
              onClick={redoCompare}
              disabled={!history.canRedo}
              title="戻した操作をやり直す（Ctrl+Y）"
            >
              ↷ 進む
            </button>
            <button
              type="button"
              onClick={() => void confirmVersion()}
              disabled={!view.version || view.version.confirmed === 1}
              title="見比べた回（左）を確定します"
            >
              ✓ この回を確定
            </button>
            <button
              type="button"
              onClick={() => void deleteVersion()}
              disabled={!view.version}
              title="見比べた回（左）の内訳書を消します"
            >
              🗑 この回を削除
            </button>
            <span className="note">
              行のずれは左右それぞれ「行挿入」「↑」「↓」で合わせます。違う部分に色が付きます。
            </span>
          </div>
          <table className="parts compare" ref={tableRef}>
            <thead>
              <tr>
                <th className="ops">操作</th>
                <th>名称</th>
                <th>摘要</th>
                <th>数量</th>
                <th>単位</th>
                <th>単価</th>
                <th>金額</th>
                <th>備考</th>
                <th className="ops">操作</th>
                <th>名称</th>
                <th>摘要</th>
                <th>数量</th>
                <th>単位</th>
                <th>単価</th>
                <th>金額</th>
                <th>備考</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((diff) => (
                <tr
                  key={diff.index}
                  className={
                    settings.layout === BREAKDOWN_LAYOUT.twoLine
                      ? "two-line"
                      : comparePairClass(diffs, diff.index, settings.layout)
                  }
                >
                  <td className="ops">
                    <button
                      type="button"
                      onClick={() =>
                        editCompare("left", (rows) => {
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
                        editCompare("left", (rows) =>
                          moveRow(rows, diff.index, -1),
                        )
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        editCompare("left", (rows) =>
                          moveRow(rows, diff.index, 1),
                        )
                      }
                    >
                      ↓
                    </button>
                  </td>
                  {renderCompareCells(
                    diff.left,
                    diff.changed,
                    diff.onlyLeft,
                    settings.layout,
                  )}
                  <td className="ops">
                    <button
                      type="button"
                      onClick={() =>
                        editCompare("right", (rows) => {
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
                        editCompare("right", (rows) =>
                          moveRow(rows, diff.index, -1),
                        )
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        editCompare("right", (rows) =>
                          moveRow(rows, diff.index, 1),
                        )
                      }
                    >
                      ↓
                    </button>
                  </td>
                  {renderCompareCells(
                    diff.right,
                    diff.changed,
                    diff.onlyRight,
                    settings.layout,
                  )}
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

          <table className="parts breakdown" ref={tableRef1}>
            <thead>
              <tr>
                <th className="mark">印</th>
                <th>名称</th>
                <th>摘要</th>
                <th className="qty">数量</th>
                <th className="unit">単位</th>
                <th className="qty">単価</th>
                <th className="qty">金額</th>
                <th>備考</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row, index) =>
                row.rowKind === "subject" ? (
                  <tr key={`s-${index}`} className="subject">
                    <td className="mark">{row.subjectId ?? ""}</td>
                    <td colSpan={7}>{row.subjectName}</td>
                  </tr>
                ) : settings.layout === BREAKDOWN_LAYOUT.oneLine ||
                  settings.layout === BREAKDOWN_LAYOUT.twoRow ? (
                  <tr
                    key={`d-${index}`}
                    className={pairClass(shownRows, index, settings.layout)}
                  >
                    <td className="mark" />
                    <td>{row.nameLower}</td>
                    <td>{row.descriptionLower}</td>
                    <td className="qty">{row.quantity ?? ""}</td>
                    <td className="unit">{row.unit}</td>
                    <td className="qty">{row.unitPrice ?? ""}</td>
                    <td className="qty">{row.amount ?? ""}</td>
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
                    <td className="qty">
                      <div className="upper" />
                      <div className="lower">{row.unitPrice ?? ""}</div>
                    </td>
                    <td className="qty">
                      <div className="upper" />
                      <div className="lower">{row.amount ?? ""}</div>
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

/**
 * 書式④（2段2行）で、1明細の上段と下段の間に罫線を出さないための印。
 * 集計書兼工事マスターと同じ見た目にする。
 */
function pairClass(
  rows: BreakdownRowRecord[],
  index: number,
  layout: number,
): string {
  if (layout !== BREAKDOWN_LAYOUT.twoRow) return "";
  const row = rows[index];
  if (row.rowKind === "note" && rows[index + 1]?.rowKind === "detail")
    return "detail-upper";
  if (row.rowKind === "detail" && rows[index - 1]?.rowKind === "note")
    return "detail-lower";
  return "";
}

/** 比較画面でも書式④の1明細（上段・下段）の間に罫線を出さない */
function comparePairClass(
  diffs: BreakdownDiff<BreakdownRowRecord>[],
  index: number,
  layout: number,
): string {
  if (layout !== BREAKDOWN_LAYOUT.twoRow) return "";
  const kind = diffs[index]?.left?.rowKind;
  if (kind === "note" && diffs[index + 1]?.left?.rowKind === "detail")
    return "detail-upper";
  if (kind === "detail" && diffs[index - 1]?.left?.rowKind === "note")
    return "detail-lower";
  return "";
}

/** 比較画面の明細セル。内訳書の設定（書式）どおりに出す */
function renderCompareCells(
  row: BreakdownRowRecord | null,
  changed: string[],
  onlySide: boolean,
  layout: number,
): JSX.Element[] {
  const mark = (field: string): string =>
    onlySide ? "only" : changed.includes(field) ? "changed" : "";
  if (row === null) {
    return [
      <td key="n" className="only" />,
      <td key="d" className="only" />,
      <td key="q" className="only" />,
      <td key="u" className="only" />,
      <td key="p" className="only" />,
      <td key="a" className="only" />,
      <td key="r" className="only" />,
    ];
  }
  if (layout === BREAKDOWN_LAYOUT.twoLine) {
    // 書式①：名称・摘要を上段／下段の2段で見比べる
    return [
      <td key="n" className={mark("name")}>
        {row.rowKind === "subject" ? (
          row.subjectName
        ) : (
          <>
            <div className="upper">{row.nameUpper}</div>
            <div className="lower">{row.nameLower}</div>
          </>
        )}
      </td>,
      <td key="d" className={mark("description")}>
        <div className="upper">{row.descriptionUpper}</div>
        <div className="lower">{row.descriptionLower}</div>
      </td>,
      <td key="q" className={`qty ${mark("quantity")}`}>
        {row.quantity ?? ""}
      </td>,
      <td key="u" className={`unit ${mark("unit")}`}>
        {row.unit}
      </td>,
      <td key="p" className="qty">
        {row.unitPrice ?? ""}
      </td>,
      <td key="a" className="qty">
        {row.amount ?? ""}
      </td>,
      <td key="r" className={mark("remarks")}>
        <div className="upper">{row.remarksUpper}</div>
        <div className="lower">{row.remarksLower}</div>
      </td>,
    ];
  }
  const oneLineName =
    layout === BREAKDOWN_LAYOUT.oneLine || layout === BREAKDOWN_LAYOUT.twoRow;
  const name = oneLineName
    ? row.nameLower
    : [row.nameUpper, row.nameLower].filter((v) => v !== "").join(" ");
  const description = oneLineName
    ? row.descriptionLower
    : [row.descriptionUpper, row.descriptionLower]
        .filter((v) => v !== "")
        .join(" ");
  const remarks = oneLineName
    ? row.remarksLower
    : [row.remarksUpper, row.remarksLower].filter((v) => v !== "").join(" ");
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
    <td key="p" className="qty">
      {row.unitPrice ?? ""}
    </td>,
    <td key="a" className="qty">
      {row.amount ?? ""}
    </td>,
    <td key="r" className={mark("remarks")}>
      {remarks}
    </td>,
  ];
}
