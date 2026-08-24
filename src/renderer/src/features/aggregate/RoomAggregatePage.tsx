import { useCallback, useEffect, useMemo, useState } from "react";
import type { AggregateRun, AggregateView, ProjectSummary } from "@shared/types";
import { aggregateByRoom } from "../../../../core/aggregate/aggregate";
import { displayQuantity } from "../../../../core/room/calcSheet";
import { detailsToEntries } from "./aggregateRows";
import "../estimate/EstimatePartsPage.css";
import "./AggregatePage.css";
import { useTableResize } from "../../hooks/useTableResize";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

/**
 * 部屋別集計。集計詳細データ（数量根拠）を部位Ⅲ＝部屋名でまとめる。
 * 並びは 部屋（部位別入力表の入力順）→科目ID→部位番号→明細番号。
 * 転記入力表の分は根拠に出さないので入らない。
 */
export default function RoomAggregatePage({
  project,
  onBack,
}: Props): JSX.Element {
  const tableRef = useTableResize("table-widths-room-aggregate-v1");
  const [view, setView] = useState<AggregateView>({
    run: null,
    items: [],
    details: [],
  });
  const [runs, setRuns] = useState<AggregateRun[]>([]);
  const [roomOrder, setRoomOrder] = useState<string[]>([]);

  const reload = useCallback(
    async (runId?: number) => {
      setView(await window.sekisan.getAggregate(project.id, runId));
      setRuns(await window.sekisan.listAggregateRuns(project.id));
    },
    [project.id],
  );

  useEffect(() => {
    void (async () => {
      const rows = await window.sekisan.listEstimateRows(project.id);
      const order: string[] = [];
      rows.forEach((row) => {
        const room = row.part3.trim();
        if (room !== "" && !order.includes(room)) order.push(room);
      });
      setRoomOrder(order);
      await reload();
    })();
  }, [project.id, reload]);

  const groups = useMemo(
    () => aggregateByRoom(detailsToEntries(view.details), roomOrder),
    [roomOrder, view.details],
  );

  return (
    <div className="estimate-page aggregate-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>部屋別集計</h2>
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
        <span className="message">
          {runs.length === 0 ? "先に集計処理を実行してください。" : ""}
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
            <tbody key={`h-${group.roomName}`} className="heading part2">
              <tr>
                <td colSpan={8}>＜{group.roomName}＞</td>
              </tr>
            </tbody>,
            ...group.items.map((item) => (
              <tbody key={`${group.roomName}-${item.masterKey}`} className="row">
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
