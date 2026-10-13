import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AggregateRun,
  AggregateView,
  ProjectSummary,
} from "@shared/types";
import { aggregateByPart } from "../../../../core/aggregate/aggregate";
import { displayQuantity } from "../../../../core/room/calcSheet";
import { detailsToEntries } from "./aggregateRows";
import { transferToBreakdown } from "./breakdownTransfer";
import "../estimate/EstimatePartsPage.css";
import "./AggregatePage.css";
import { useTableResize } from "../../hooks/useTableResize";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

/**
 * 部位別集計。集計詳細データ（数量根拠）を部位Ⅱでまとめる。
 * 押入れ・踏み込み・前室のような細かい部屋を、同じ部位Ⅱならひとつにまとめる。
 * 並びは 部位Ⅱ（部位別入力表に出てくる順）→科目ID→部位番号→明細番号。
 * 転記入力表の分は部位Ⅱを持つので入る。部位Ⅱが空の分は「（部位Ⅱなし）」にまとめる。
 */
export default function PartAggregatePage({
  project,
  onBack,
}: Props): JSX.Element {
  const tableRef = useTableResize("table-widths-part-aggregate-v1");
  const [view, setView] = useState<AggregateView>({
    run: null,
    items: [],
    details: [],
  });
  const [runs, setRuns] = useState<AggregateRun[]>([]);
  const [message, setMessage] = useState("");

  const reload = useCallback(
    async (runId?: number) => {
      setView(await window.sekisan.getAggregate(project.id, runId));
      setRuns(await window.sekisan.listAggregateRuns(project.id));
    },
    [project.id],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const groups = useMemo(
    () => aggregateByPart(detailsToEntries(view.details)),
    [view.details],
  );

  const transfer = async (): Promise<void> => {
    const result = await transferToBreakdown(
      project.id,
      "part",
      view.run?.id,
    );
    if (result !== null) setMessage(result);
  };

  return (
    <div className="estimate-page aggregate-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>部位別集計</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <select
          value={view.run?.id ?? ""}
          onChange={(e) => void reload(Number(e.target.value))}
        >
          {runs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.createdAt} の集計
            </option>
          ))}
          {runs.length === 0 && <option value="">未集計</option>}
        </select>
        <button
          type="button"
          onClick={() => void transfer()}
          disabled={runs.length === 0}
          title="このまとめの形（部位Ⅱごとの見出し）で内訳書を作ります"
        >
          ⇩ 内訳書に転記
        </button>
        <span className="message">
          {message ||
            (runs.length === 0 ? "先に集計処理を実行してください。" : "")}
        </span>
      </div>

      <div className="aggregate-body">
        <table className="parts aggregate" ref={tableRef}>
          <thead>
            <tr>
              <th className="no">科目ID</th>
              <th>材種区分</th>
              <th>部位番号／明細番号</th>
              <th>部位名／名称</th>
              <th>摘要</th>
              <th>数量</th>
              <th>単位</th>
              <th>備考</th>
            </tr>
          </thead>
          {groups.flatMap((group) => [
            <tbody key={`h-${group.label}`} className="heading part2">
              <tr>
                <td colSpan={8}>＜{group.label}＞</td>
              </tr>
            </tbody>,
            ...group.items.map((item) => (
              <tbody
                key={`${group.label}-${item.masterKey}`}
                className="row"
              >
                <tr className="detail-upper">
                  <td className="no" rowSpan={2}>
                    {item.subjectId ?? ""}
                  </td>
                  <td rowSpan={2}>{item.materialCategory}</td>
                  <td className="number">
                    {item.partNumber === null ? "" : item.partNumber}
                  </td>
                  <td>{item.partName}</td>
                  <td>{item.descriptionUpper}</td>
                  <td />
                  <td />
                  <td>{item.remarksUpper}</td>
                </tr>
                <tr className="detail-lower">
                  <td className="number">
                    {item.detailNumber === null ? "" : item.detailNumber}
                  </td>
                  <td>{item.name}</td>
                  <td>{item.descriptionLower}</td>
                  <td className="number">{displayQuantity(item.quantity)}</td>
                  <td>{item.unit}</td>
                  <td>{item.remarksLower}</td>
                </tr>
              </tbody>
            )),
          ])}
        </table>
      </div>
    </div>
  );
}
