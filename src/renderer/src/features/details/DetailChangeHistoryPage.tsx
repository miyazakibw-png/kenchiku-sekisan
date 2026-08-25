import { useEffect, useState } from "react";
import type { DetailChangeLog, DetailSnapshot, Subject } from "@shared/types";
import "../estimate/EstimatePartsPage.css";
import "./DetailChangeHistoryPage.css";
import { useTableResize } from "../../hooks/useTableResize";

interface Props {
  /** 物件専用マスターの履歴は物件ID、基本マスターの履歴は null */
  projectId: number | null;
  onBack: () => void;
}

const KIND_LABEL: Record<DetailChangeLog["changeKind"], string> = {
  add: "追加",
  edit: "修正",
  delete: "削除",
};

const COLUMNS: { key: keyof DetailSnapshot; label: string }[] = [
  { key: "detailNumber", label: "明細番号" },
  { key: "materialCategory", label: "材種区分" },
  { key: "partName", label: "部位名" },
  { key: "name", label: "名称" },
  { key: "descriptionLower", label: "摘要（下）" },
  { key: "descriptionUpper", label: "摘要（上）" },
  { key: "unit", label: "単位" },
  { key: "remarksLower", label: "備考（下）" },
  { key: "remarksUpper", label: "備考（上）" },
  { key: "estimateDisplay", label: "積算用表示" },
  { key: "isActive", label: "有効" },
];

function cellText(
  snapshot: DetailSnapshot | null,
  key: keyof DetailSnapshot,
): string {
  if (snapshot === null) return "";
  const value = snapshot[key];
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "○" : "×";
  if (typeof value === "number") return value.toFixed(2);
  return value;
}

/**
 * 明細マスターの修正履歴一覧。
 * 修正した明細を修正した順に並べ、修正前の行と修正後の行を続けて表示する。
 * 修正後の行には背景色を付け、変わった欄は赤文字にする。
 */
export default function DetailChangeHistoryPage({
  projectId,
  onBack,
}: Props): JSX.Element {
  const tableRef = useTableResize("table-widths-change-history-v1");
  const [logs, setLogs] = useState<DetailChangeLog[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [newestFirst, setNewestFirst] = useState(true);
  /** true なら修正前・修正後の2行を並べる。false は変わった欄だけの1行 */
  const [showBefore, setShowBefore] = useState(false);
  const hiddenKey = `detail-change-history-hidden-${projectId ?? "basic"}`;
  const [hiddenThrough, setHiddenThrough] = useState(() =>
    Number(window.localStorage.getItem(hiddenKey) ?? "0"),
  );

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects());
      setLogs(await window.sekisan.listDetailChangeLogs(projectId));
    })();
  }, [projectId]);

  /** 記録は消さずに、いま出ている分を画面から見えなくする */
  const clearView = (): void => {
    const newest = logs.reduce((max, log) => Math.max(max, log.id), 0);
    window.localStorage.setItem(hiddenKey, String(newest));
    setHiddenThrough(newest);
  };

  const showAll = (): void => {
    window.localStorage.removeItem(hiddenKey);
    setHiddenThrough(0);
  };

  const visible = logs.filter((log) => log.id > hiddenThrough);
  const rows = newestFirst ? visible : [...visible].reverse();

  return (
    <div className="estimate-page detail-change-history">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 戻る
        </button>
        <h2>
          📝 修正履歴一覧
          {projectId === null
            ? "（基本マスター）"
            : "（この工事の明細マスター）"}
        </h2>
        <button
          type="button"
          className={newestFirst ? "on" : ""}
          onClick={() => setNewestFirst(!newestFirst)}
        >
          {newestFirst ? "新しい順" : "古い順"}
        </button>
        <button
          type="button"
          className={showBefore ? "on" : ""}
          title="修正前の行も並べて見比べます"
          onClick={() => setShowBefore(!showBefore)}
        >
          {showBefore ? "修正前後を表示" : "変わった欄だけ"}
        </button>
        <button
          type="button"
          title="今出ている履歴を画面から見えなくします（記録は残ります）"
          onClick={clearView}
        >
          🧹 表示クリア
        </button>
        {hiddenThrough > 0 && (
          <button
            type="button"
            title="見えなくした分も含めてすべて出します"
            onClick={showAll}
          >
            ↺ すべて表示
          </button>
        )}
        <span className="message">
          {rows.length}件
          {hiddenThrough > 0 && `（非表示 ${logs.length - rows.length}件）`}
        </span>
      </div>

      <table className="parts change-history" ref={tableRef}>
        <thead>
          <tr>
            <th className="when">修正日時</th>
            <th className="kind">区分</th>
            <th className="origin">変更元</th>
            <th className="subject">科目</th>
            {showBefore && <th className="stage">前後</th>}
            {COLUMNS.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        {rows.map((log) => {
          const subject = subjects.find((item) => item.id === log.subjectId);
          const when = log.changedAt.replace("T", " ").slice(0, 19);
          const kind = KIND_LABEL[log.changeKind];
          const subjectName = subject?.name ?? String(log.subjectId);
          if (!showBefore) {
            // 変わった欄だけを出す（削除は消える前の中身をそのまま出す）
            const snapshot = log.after ?? log.before;
            return (
              <tbody key={log.id} className="log">
                <tr className="after">
                  <td className="when">{when}</td>
                  <td className="kind">{kind}</td>
                  <td className="origin">{log.origin}</td>
                  <td className="subject">{subjectName}</td>
                  {COLUMNS.map((column) => {
                    const changed = log.changedFields.includes(column.key);
                    const before = cellText(log.before, column.key);
                    const after = cellText(snapshot, column.key);
                    return (
                      <td
                        key={column.key}
                        className={changed ? "changed" : ""}
                        title={changed ? `修正前：${before || "（空欄）"}` : ""}
                      >
                        {changed && log.changeKind === "edit"
                          ? `${before || "（空欄）"} → ${after || "（空欄）"}`
                          : after}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            );
          }
          return (
            <tbody key={log.id} className="log">
              <tr className="before">
                <td className="when" rowSpan={2}>
                  {when}
                </td>
                <td className="kind" rowSpan={2}>
                  {kind}
                </td>
                <td className="origin" rowSpan={2}>
                  {log.origin}
                </td>
                <td className="subject" rowSpan={2}>
                  {subjectName}
                </td>
                <td className="stage">修正前</td>
                {COLUMNS.map((column) => (
                  <td key={column.key}>{cellText(log.before, column.key)}</td>
                ))}
              </tr>
              <tr className="after">
                <td className="stage">修正後</td>
                {COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className={
                      log.changedFields.includes(column.key) ? "changed" : ""
                    }
                  >
                    {cellText(log.after, column.key)}
                  </td>
                ))}
              </tr>
            </tbody>
          );
        })}
      </table>

      {rows.length === 0 && (
        <p className="note">
          {hiddenThrough > 0
            ? "表示クリアしています（「↺ すべて表示」で戻せます）。"
            : "まだ修正履歴はありません（集計書兼工事マスター・セット明細で直した分だけ記録します）。"}
        </p>
      )}
    </div>
  );
}
