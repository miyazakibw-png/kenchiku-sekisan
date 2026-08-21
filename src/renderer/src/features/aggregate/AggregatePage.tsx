import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AggregateItem,
  AggregateRun,
  AggregateView,
  ProjectSummary,
  Subject,
} from "@shared/types";
import { checkQuantityUnit } from "../../../../core/aggregate/aggregate";
import { displayQuantity } from "../../../../core/room/calcSheet";
import { sourceLabelOf } from "./aggregateRows";
import "../estimate/EstimatePartsPage.css";
import "./AggregatePage.css";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

/** 明細の前に入れる見出し（科目・部位Ⅰ・部位Ⅱ） */
interface HeadingRow {
  kind: "subject" | "part1" | "part2";
  text: string;
  subjectId: number | null;
}

type Line = { kind: "heading"; heading: HeadingRow } | { kind: "item"; item: AggregateItem };

function buildLines(items: AggregateItem[], subjects: Subject[]): Line[] {
  const lines: Line[] = [];
  let subjectId: number | null | undefined;
  let part1: string | undefined;
  let part2: string | undefined;
  items.forEach((item) => {
    if (subjectId !== item.subjectId) {
      subjectId = item.subjectId;
      part1 = undefined;
      part2 = undefined;
      const subject = subjects.find((row) => row.id === item.subjectId);
      lines.push({
        kind: "heading",
        heading: {
          kind: "subject",
          subjectId: item.subjectId,
          text: subject ? subject.name : "",
        },
      });
    }
    if (part1 !== item.part1) {
      part1 = item.part1;
      part2 = undefined;
      if (item.part1 !== "")
        lines.push({
          kind: "heading",
          heading: { kind: "part1", subjectId: null, text: `（${item.part1}）` },
        });
    }
    if (part2 !== item.part2) {
      part2 = item.part2;
      if (item.part2 !== "")
        lines.push({
          kind: "heading",
          heading: { kind: "part2", subjectId: null, text: `＜${item.part2}＞` },
        });
    }
    lines.push({ kind: "item", item });
  });
  return lines;
}

/**
 * 集計書兼工事マスター。
 * 計算書（部屋別・軸組・汎用）と転記入力表から集計した明細を、科目→部位Ⅰ→部位Ⅱの順に並べる。
 * 行をクリックすると数量根拠（部屋別の内訳）を表示する。
 */
export default function AggregatePage({ project, onBack }: Props): JSX.Element {
  const [view, setView] = useState<AggregateView>({
    run: null,
    items: [],
    details: [],
  });
  const [runs, setRuns] = useState<AggregateRun[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<AggregateItem | null>(null);
  const [message, setMessage] = useState("");

  const reload = useCallback(
    async (runId?: number) => {
      setView(await window.sekisan.getAggregate(project.id, runId));
      setRuns(await window.sekisan.listAggregateRuns(project.id));
    },
    [project.id],
  );

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects());
      await reload();
    })();
  }, [reload]);

  const run = useCallback(async () => {
    const result = await window.sekisan.runAggregation(project.id);
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    setMessage(`集計しました（明細 ${result.items.length} 件）`);
  }, [project.id]);

  const lines = useMemo(
    () => buildLines(view.items, subjects),
    [subjects, view.items],
  );

  /** 選んだ明細の数量根拠（合算前の1件ずつ） */
  const basis = useMemo(
    () =>
      selected === null
        ? []
        : view.details.filter((detail) => detail.masterKey === selected.masterKey),
    [selected, view.details],
  );

  const errorCount = useMemo(
    () =>
      view.items.filter(
        (item) => checkQuantityUnit(item.quantity, item.unit) !== "",
      ).length,
    [view.items],
  );

  return (
    <div className="estimate-page aggregate-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>集計書兼工事マスター</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => void run()}>
          🧮 集計実行
        </button>
        <button
          type="button"
          className={checking ? "on" : ""}
          onClick={() => setChecking(!checking)}
        >
          🎨 数量・単位チェック（{errorCount}件）
        </button>
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
        <span className="message">{message}</span>
      </div>

      <div className="aggregate-body">
        <table className="parts aggregate">
          <thead>
            <tr>
              <th className="no">科目ID</th>
              <th>科目名称</th>
              <th>材種区分</th>
              <th>部位番号／明細番号</th>
              <th>部位名／名称</th>
              <th>摘要</th>
              <th>数量</th>
              <th>単位</th>
              <th>備考</th>
            </tr>
          </thead>
          {lines.map((line, index) => {
            if (line.kind === "heading") {
              const subject = subjects.find(
                (row) => row.id === line.heading.subjectId,
              );
              return (
                <tbody key={`h${index}`} className={`heading ${line.heading.kind}`}>
                  <tr>
                    <td className="no">
                      {line.heading.kind === "subject" ? (subject?.id ?? "") : ""}
                    </td>
                    <td colSpan={8}>{line.heading.text}</td>
                  </tr>
                </tbody>
              );
            }
            const item = line.item;
            const check = checking
              ? checkQuantityUnit(item.quantity, item.unit)
              : "";
            const isSelected = selected?.masterKey === item.masterKey;
            return (
              <tbody
                key={item.id}
                className={`row ${check} ${isSelected ? "selected" : ""}`}
                onClick={() => setSelected(item)}
              >
                <tr className="detail-upper">
                  <td className="no" rowSpan={2}>
                    {item.subjectId ?? ""}
                  </td>
                  <td rowSpan={2} />
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
            );
          })}
        </table>

        <aside className="basis">
          <div className="section-bar">
            <span>数量根拠（部屋ごとの拾い）</span>
          </div>
          {selected === null && <p className="note">明細をクリックしてください。</p>}
          {selected !== null && (
            <>
              <p className="title">
                {selected.partName} {selected.name}　合計{" "}
                {displayQuantity(selected.quantity)} {selected.unit}
              </p>
              <table className="parts">
                <thead>
                  <tr>
                    <th>部屋（部位Ⅱ：部位Ⅲ）</th>
                    <th>数量</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.rooms.map((room) => (
                    <tr key={room.roomName}>
                      <td>{room.roomName}</td>
                      <td className="number">{displayQuantity(room.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="section-bar">
                <span>計算書の拾い1件ごと</span>
              </div>
              <table className="parts">
                <thead>
                  <tr>
                    <th>出所</th>
                    <th>部屋</th>
                    <th>累計</th>
                    <th>掛け率</th>
                    <th>倍率</th>
                    <th>計上</th>
                  </tr>
                </thead>
                <tbody>
                  {basis.map((detail) => (
                    <tr key={detail.id}>
                      <td>{sourceLabelOf(detail.sourceKind)}</td>
                      <td>{`${detail.part2Raw} ${detail.part3}`.trim()}</td>
                      <td className="number">
                        {displayQuantity(detail.setTotal)}
                      </td>
                      <td className="number">{detail.coefficient}</td>
                      <td className="number">{detail.multiplier}</td>
                      <td className="number">
                        {displayQuantity(detail.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note">
                転記入力表の分は集計書には計上しますが、根拠集計（部屋別）には出しません。
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
