import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AggregateItem,
  AggregateItemEdit,
  AggregateRun,
  AggregateView,
  ProjectSummary,
  Subject,
} from "@shared/types";
import { checkQuantityUnit } from "../../../../core/aggregate/aggregate";
import { displayQuantity } from "../../../../core/room/calcSheet";
import { useColumnWidths } from "../../hooks/useColumnWidths";
import { sourceLabelOf } from "./aggregateRows";
import "../estimate/EstimatePartsPage.css";
import "./AggregatePage.css";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

const COLUMNS = [
  "科目ID",
  "科目名称",
  "材種区分",
  "部位番号／明細番号",
  "部位名／名称",
  "摘要",
  "数量",
  "単位",
  "備考",
] as const;

const COLUMN_WIDTHS = [54, 120, 78, 120, 190, 190, 80, 46, 120];

/** 集計書で直す前の内容（直していない欄は集計結果のまま） */
function initialEdit(item: AggregateItem): AggregateItemEdit {
  return {
    masterKey: item.masterKey,
    subjectId: item.subjectId,
    materialCategory: item.materialCategory,
    partNumber: item.partNumber,
    partName: item.partName,
    detailNumber: item.detailNumber,
    name: item.name,
    descriptionUpper: item.descriptionUpper,
    descriptionLower: item.descriptionLower,
    unit: item.unit,
    remarksUpper: item.remarksUpper,
    remarksLower: item.remarksLower,
  };
}

/** 番号欄の入力（空欄は未入力） */
function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 明細の前に入れる見出し（科目・部位Ⅰ・部位Ⅱ） */
interface HeadingRow {
  kind: "subject" | "part1" | "part2";
  text: string;
  subjectId: number | null;
}

type Line =
  | { kind: "heading"; heading: HeadingRow }
  | { kind: "item"; item: AggregateItem };

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
          heading: {
            kind: "part1",
            subjectId: null,
            text: `（${item.part1}）`,
          },
        });
    }
    if (part2 !== item.part2) {
      part2 = item.part2;
      if (item.part2 !== "")
        lines.push({
          kind: "heading",
          heading: {
            kind: "part2",
            subjectId: null,
            text: `＜${item.part2}＞`,
          },
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
  const [edits, setEdits] = useState<Record<string, AggregateItemEdit>>({});
  /** 同じ明細マスターから拾った行をまとめて直す（既定は直した行だけ） */
  const [applyToSameDetail, setApplyToSameDetail] = useState(false);
  const [message, setMessage] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const basisRef = useRef<HTMLElement>(null);
  /** 数量根拠を出す高さ（選んだ明細の行に合わせる） */
  const [basisTop, setBasisTop] = useState(0);
  const { widths, startResize } = useColumnWidths(
    "aggregate-columns-v1",
    COLUMN_WIDTHS,
  );

  const reload = useCallback(
    async (runId?: number) => {
      setView(await window.sekisan.getAggregate(project.id, runId));
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      setEdits({});
    },
    [project.id],
  );

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects(project.id));
      await reload();
    })();
  }, [project.id, reload]);

  const run = useCallback(async () => {
    const result = await window.sekisan.runAggregation(project.id);
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    setEdits({});
    setMessage(`集計しました（明細 ${result.items.length} 件）`);
  }, [project.id]);

  /** 集計書の欄を直す（保存を押すまでは画面の中だけ） */
  const editItem = useCallback(
    (item: AggregateItem, patch: Partial<AggregateItemEdit>) => {
      setEdits((current) => ({
        ...current,
        [item.masterKey]: {
          ...(current[item.masterKey] ?? initialEdit(item)),
          ...patch,
        },
      }));
    },
    [],
  );

  /** 直した内容を計算書・工事の明細マスターへ書き戻し、集計をかけ直す */
  const saveEdits = useCallback(async () => {
    const list = Object.values(edits);
    if (view.run === null || list.length === 0) return;
    const result = await window.sekisan.saveAggregateEdits({
      projectId: project.id,
      runId: view.run.id,
      edits: list,
      applyToSameDetail,
    });
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    setEdits({});
    setSelected(null);
    setMessage(
      `${list.length}件を直して計算書・明細マスターへ反映し、集計し直しました`,
    );
  }, [applyToSameDetail, edits, project.id, view.run]);

  const lines = useMemo(
    () => buildLines(view.items, subjects),
    [subjects, view.items],
  );

  /** 選んだ明細の数量根拠（合算前の1件ずつ） */
  const basis = useMemo(
    () =>
      selected === null
        ? []
        : view.details.filter(
            (detail) => detail.masterKey === selected.masterKey,
          ),
    [selected, view.details],
  );

  /** 左端の科目ボタン（計上された工種科目だけを出す） */
  const usedSubjects = useMemo(() => {
    const ids: number[] = [];
    view.items.forEach((item) => {
      if (item.subjectId !== null && !ids.includes(item.subjectId))
        ids.push(item.subjectId);
    });
    return ids.map((id) => ({
      id,
      name: subjects.find((row) => row.id === id)?.name ?? "",
    }));
  }, [subjects, view.items]);

  /** 科目ボタンを押すと、その科目の先頭明細まで表を送る */
  const jumpToSubject = useCallback((subjectId: number) => {
    const body = bodyRef.current;
    if (!body) return;
    const target = body.querySelector<HTMLElement>(
      `[data-subject-head="${subjectId}"]`,
    );
    if (!target) return;
    body.scrollTop +=
      target.getBoundingClientRect().top - body.getBoundingClientRect().top;
  }, []);

  const errorCount = useMemo(
    () =>
      view.items.filter(
        (item) => checkQuantityUnit(item.quantity, item.unit) !== "",
      ).length,
    [view.items],
  );

  /**
   * 数量根拠は選んだ明細の右隣に出す。
   * 画面から外れないよう、表を送ったときは見えている範囲に寄せる。
   */
  const placeBasis = useCallback(() => {
    const body = bodyRef.current;
    const panel = basisRef.current;
    if (!body || !panel) return;
    if (selected === null) {
      setBasisTop(0);
      return;
    }
    const row = body.querySelector<HTMLElement>(
      `[data-master-key="${CSS.escape(selected.masterKey)}"]`,
    );
    if (!row) return;
    const rowTop =
      row.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop;
    const lowest = Math.max(
      body.scrollTop,
      body.scrollTop + body.clientHeight - panel.offsetHeight - 8,
    );
    setBasisTop(Math.max(body.scrollTop, Math.min(rowTop, lowest)));
  }, [selected]);

  useEffect(() => {
    placeBasis();
    const body = bodyRef.current;
    if (!body) return;
    body.addEventListener("scroll", placeBasis);
    return () => body.removeEventListener("scroll", placeBasis);
  }, [basis, placeBasis]);

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
          disabled={Object.keys(edits).length === 0}
          onClick={() => void saveEdits()}
          title="直した内容を元の計算書と工事の明細マスターへ書き戻し、集計をかけ直します"
        >
          💾 修正を保存（{Object.keys(edits).length}件）
        </button>
        <label title="チェックを入れると、同じ工事用明細マスターから拾った他の行（摘要などが古いまま別の行に分かれている分）も、まとめて同じ内容に直します。ふだんは外したまま（直した行だけ変わります）">
          <input
            type="checkbox"
            checked={applyToSameDetail}
            onChange={(e) => setApplyToSameDetail(e.target.checked)}
          />
          同じ明細をまとめて直す
        </label>
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

      <div className="aggregate-body" ref={bodyRef}>
        <nav className="subject-jump">
          {usedSubjects.map((subject) => (
            <button
              key={subject.id}
              type="button"
              title={`${subject.id} ${subject.name} の先頭へ`}
              onClick={() => jumpToSubject(subject.id)}
            >
              {subject.id} {subject.name}
            </button>
          ))}
          {usedSubjects.length === 0 && <span className="note">未集計</span>}
        </nav>
        <table className="parts aggregate">
          <colgroup>
            {COLUMNS.map((label, index) => (
              <col key={label} style={{ width: `${widths[index]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((label, index) => (
                <th key={label} className={index === 0 ? "no" : undefined}>
                  {label}
                  <span
                    className="col-resize"
                    title="ドラッグで列幅を変えられます"
                    onMouseDown={(e) => startResize(index, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          {lines.map((line, index) => {
            if (line.kind === "heading") {
              const subject = subjects.find(
                (row) => row.id === line.heading.subjectId,
              );
              return (
                <tbody
                  key={`h${index}`}
                  className={`heading ${line.heading.kind}`}
                >
                  <tr
                    data-subject-head={
                      line.heading.kind === "subject" && subject
                        ? subject.id
                        : undefined
                    }
                  >
                    <td className="no">
                      {line.heading.kind === "subject"
                        ? (subject?.id ?? "")
                        : ""}
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
            const draft = edits[item.masterKey] ?? initialEdit(item);
            return (
              <tbody
                key={item.id}
                className={`row ${check} ${isSelected ? "selected" : ""}`}
                data-master-key={item.masterKey}
                onClick={() => setSelected(item)}
              >
                <tr className="detail-upper">
                  <td className="no" rowSpan={2}>
                    {draft.subjectId ?? ""}
                  </td>
                  <td rowSpan={2}>
                    <select
                      value={draft.subjectId ?? ""}
                      title="工種科目を選び直せます"
                      onChange={(e) =>
                        editItem(item, { subjectId: toNumber(e.target.value) })
                      }
                    >
                      <option value="">（科目なし）</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.id} {subject.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td rowSpan={2}>
                    <input
                      lang="ja"
                      value={draft.materialCategory}
                      onChange={(e) =>
                        editItem(item, { materialCategory: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="number"
                      value={draft.partNumber === null ? "" : draft.partNumber}
                      onChange={(e) =>
                        editItem(item, { partNumber: toNumber(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      lang="ja"
                      value={draft.partName}
                      onChange={(e) =>
                        editItem(item, { partName: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      lang="ja"
                      value={draft.descriptionUpper}
                      onChange={(e) =>
                        editItem(item, { descriptionUpper: e.target.value })
                      }
                    />
                  </td>
                  <td />
                  <td />
                  <td>
                    <input
                      lang="ja"
                      value={draft.remarksUpper}
                      onChange={(e) =>
                        editItem(item, { remarksUpper: e.target.value })
                      }
                    />
                  </td>
                </tr>
                <tr className="detail-lower">
                  <td>
                    <input
                      className="number"
                      value={
                        draft.detailNumber === null ? "" : draft.detailNumber
                      }
                      onChange={(e) =>
                        editItem(item, {
                          detailNumber: toNumber(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      lang="ja"
                      value={draft.name}
                      onChange={(e) => editItem(item, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      lang="ja"
                      value={draft.descriptionLower}
                      onChange={(e) =>
                        editItem(item, { descriptionLower: e.target.value })
                      }
                    />
                  </td>
                  <td className="number">{displayQuantity(item.quantity)}</td>
                  <td>
                    <input
                      value={draft.unit}
                      onChange={(e) => editItem(item, { unit: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      lang="ja"
                      value={draft.remarksLower}
                      onChange={(e) =>
                        editItem(item, { remarksLower: e.target.value })
                      }
                    />
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>

        <aside
          className="basis"
          ref={basisRef}
          style={{ transform: `translateY(${basisTop}px)` }}
        >
          <div className="section-bar">
            <span>数量根拠（部屋ごとの拾い）</span>
          </div>
          {selected === null && (
            <p className="note">明細をクリックしてください。</p>
          )}
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
                      <td className="number">
                        {displayQuantity(room.quantity)}
                      </td>
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
