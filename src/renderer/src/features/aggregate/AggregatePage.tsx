import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type {
  AggregateDetail,
  AggregateItem,
  AggregateItemEdit,
  AggregateRun,
  AggregateView,
  MasterOptions,
  ProjectSummary,
  Subject,
} from "@shared/types";
import {
  aggregateQuantityText,
  checkQuantityUnit,
} from "../../../../core/aggregate/aggregate";
import { displayQuantity } from "../../../../core/room/calcSheet";
import { resolveMasterName } from "@shared/masters";
import PickInput, { type PickEntry } from "../../components/PickInput";
import { useColumnWidths } from "../../hooks/useColumnWidths";
import { focusCell } from "../grid/focusCell";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { sourceLabelOf } from "./aggregateRows";
import "../estimate/EstimatePartsPage.css";
import "./AggregatePage.css";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
  /** 数量根拠の1件から、その拾いを書いた計算書（出所）を開く */
  onOpenSource?: (detail: AggregateDetail) => void;
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
  "積算用表示",
] as const;

const COLUMN_WIDTHS = [54, 120, 78, 120, 190, 190, 80, 46, 120, 90];

const EDGE_SPACE = /^\s|\s$/;

/** 前後に空白（全角・半角）がある欄は目印を付ける。見た目が同じでも別の明細になるため */
function spaceMark(text: string): { className?: string; title?: string } {
  return EDGE_SPACE.test(text)
    ? { className: "edge-space", title: "前後に空白があります" }
    : {};
}

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
    estimateDisplay: item.estimateDisplay,
  };
}

/**
 * 積算用表示を持たない入力（転記入力表・部位別雑・金物入力表・家具・設備入力表・耐火被覆の管理表）から来た明細か。
 * これらは積算用表示がいつも空なので、集計書からは直せない。
 */
function lacksEstimateDisplay(detail: AggregateDetail): boolean {
  if (detail.sourceKind === "transfer") return true;
  if (detail.sourceKind === "misc") return true;
  if (detail.sourceKind === "furniture") return true;
  return (
    detail.sourceKind === "fireproof" && detail.traceId.split(":").length === 2
  );
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
  let unused: boolean | undefined;
  items.forEach((item) => {
    if (subjectId !== item.subjectId) {
      subjectId = item.subjectId;
      part1 = undefined;
      part2 = undefined;
      unused = undefined;
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
    // 不要明細は工種科目の最後にまとめる（内訳書へは飛ばさない）
    if (unused !== item.unused && item.unused) {
      unused = item.unused;
      part1 = undefined;
      part2 = undefined;
      lines.push({
        kind: "heading",
        heading: { kind: "part1", subjectId: null, text: "【不要明細】" },
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
export default function AggregatePage({
  project,
  onBack,
  onOpenSource,
}: Props): JSX.Element {
  const [view, setView] = useState<AggregateView>({
    run: null,
    items: [],
    details: [],
  });
  const [runs, setRuns] = useState<AggregateRun[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<MasterOptions["units"]>([]);
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<AggregateItem | null>(null);
  const [edits, setEdits] = useState<Record<string, AggregateItemEdit>>({});
  const [message, setMessage] = useState("");
  /** 手入力行の付け直しモード（次にクリックした明細が新しい付き先） */
  const [moving, setMoving] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const basisRef = useRef<HTMLElement>(null);
  /** 数量根拠を出す高さ（選んだ明細の行に合わせる） */
  const [basisTop, setBasisTop] = useState(0);
  const { widths, startResize } = useColumnWidths(
    "aggregate-columns-v2",
    COLUMN_WIDTHS,
  );

  const { markSaved } = useSaveOnLeave(edits, () => saveEdits(true));

  const reload = useCallback(
    async (runId?: number) => {
      setView(await window.sekisan.getAggregate(project.id, runId));
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      setEdits({});
      markSaved({});
    },
    [markSaved, project.id],
  );

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects(project.id));
      setUnits((await window.sekisan.getMasterOptions(project.id)).units);
      await reload();
    })();
  }, [project.id, reload]);

  const run = useCallback(async () => {
    const result = await window.sekisan.runAggregation(project.id);
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    setEdits({});
    markSaved({});
    setMessage(`集計しました（明細 ${result.items.length} 件）`);
  }, [markSaved, project.id]);

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
  const saveEdits = useCallback(
    async (quiet = false) => {
      const list = Object.values(edits);
      if (view.run === null || list.length === 0) return;
      const result = await window.sekisan.saveAggregateEdits({
        projectId: project.id,
        runId: view.run.id,
        edits: list,
      });
      setView(result);
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      setEdits({});
      markSaved({});
      setSelected(null);
      if (quiet) return;
      setMessage(
        `${list.length}件を直して計算書・明細マスターへ反映し、集計し直しました`,
      );
    },
    [edits, markSaved, project.id, view.run],
  );

  /** 選んだ明細の上下に、手入力の明細行を挿入する（集計をかけ直しても残る） */
  const insertManual = useCallback(
    async (before: boolean) => {
      if (selected === null || view.run === null) return;
      const result = await window.sekisan.insertAggregateManualItem({
        projectId: project.id,
        runId: view.run.id,
        afterMasterKey: selected.masterKey,
        before,
      });
      setView(result);
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      setMessage(
        `選んだ明細の${before ? "上" : "下"}に明細行を挿入しました（集計をかけ直しても残ります。摘要・名称・数量などを直接入れられます）`,
      );
    },
    [project.id, selected, view.run],
  );

  /** 手で挿入した明細行の付け直し（次にクリックした明細へ付き替える） */
  const moveManual = useCallback(
    async (anchor: AggregateItem) => {
      if (selected === null || !selected.manual) return;
      if (anchor.masterKey === selected.masterKey) {
        setMoving(false);
        setMessage("付け直しをやめました");
        return;
      }
      const result = await window.sekisan.moveAggregateManualItem({
        projectId: project.id,
        masterKey: selected.masterKey,
        anchorMasterKey: anchor.masterKey,
      });
      setView(result);
      setRuns(await window.sekisan.listAggregateRuns(project.id));
      setMoving(false);
      setSelected(
        result.items.find((item) => item.masterKey === selected.masterKey) ??
          null,
      );
      setMessage(
        "明細行を付け直しました（選んだ明細の上付き・下付きはそのままです）",
      );
    },
    [project.id, selected],
  );

  /** 行クリック：付け直しモードなら付き替え、ふだんは選択 */
  const clickRow = useCallback(
    (item: AggregateItem) => {
      if (moving) {
        void moveManual(item);
        return;
      }
      setSelected(item);
    },
    [moveManual, moving],
  );

  /** 手で挿入した明細行を消す（手入力行を選んだときだけ押せる） */
  const deleteManual = useCallback(async () => {
    if (selected === null || !selected.manual) return;
    if (
      !window.confirm(
        "手で挿入した明細行を消します。元に戻せません。よいですか？",
      )
    )
      return;
    const result = await window.sekisan.deleteAggregateManualItem({
      projectId: project.id,
      masterKey: selected.masterKey,
    });
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    setSelected(null);
    setMessage("手で挿入した明細行を消しました");
  }, [project.id, selected]);

  /** 不要明細の印を付ける／外す（内訳書へ飛ばさなくなる） */
  const toggleUnused = useCallback(async () => {
    if (selected === null) return;
    const result = await window.sekisan.setDetailUnused({
      projectId: project.id,
      masterKey: selected.masterKey,
      unused: !selected.unused,
    });
    setView(result);
    setRuns(await window.sekisan.listAggregateRuns(project.id));
    setSelected(
      result.items.find((item) => item.masterKey === selected.masterKey) ??
        null,
    );
    setMessage(
      selected.unused
        ? "不要の印を外しました（内訳書へ飛びます）"
        : "不要明細にしました（工種科目の最後にまとめ、内訳書へは飛ばしません）",
    );
  }, [project.id, selected]);

  const lines = useMemo(
    () => buildLines(view.items, subjects),
    [subjects, view.items],
  );

  /** 単位マスターの呼び出し一覧（計算書の単位欄と同じ並び） */
  const unitEntries: PickEntry[] = useMemo(
    () =>
      units.map((unit) => ({
        value: unit.name,
        label: `${unit.id}　${unit.name}`,
      })),
    [units],
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

  /** 積算用表示を直せない明細（集計キー） */
  const fixedEstimateDisplay = useMemo(
    () =>
      new Set(
        view.details
          .filter(lacksEstimateDisplay)
          .map((detail) => detail.masterKey),
      ),
    [view.details],
  );

  /**
   * 積算用表示欄まわりのカーソル移動（2行組＋縦結合セルなので専用に処理）。
   * ・積算用表示で↑↓＝上下の明細の積算用表示へ
   * ・備考（下段）から→＝積算用表示へ（積算用表示から←は備考欄下へ）
   * ・積算用表示から→は既定のまま（全体共通の移動に任せる）
   */
  const onTableKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const all =
      field.value.length > 0 && start === 0 && end === field.value.length;
    const atStart =
      start === null || end === null ? true : all || (start === 0 && end === 0);
    const atEnd =
      start === null || end === null
        ? true
        : all || (start === field.value.length && start === end);

    if (field.dataset.unit !== undefined) {
      // 単位欄の↑↓は同じ単位欄の上下の明細へ移る
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const inputs = Array.from(
          field
            .closest("table")
            ?.querySelectorAll<HTMLInputElement>("input[data-unit]") ?? [],
        );
        const target =
          inputs[inputs.indexOf(field) + (event.key === "ArrowDown" ? 1 : -1)];
        if (!target) return;
        event.preventDefault();
        focusCell(target);
        target.select();
      }
      return;
    }
    if (field.dataset.estimateDisplay !== undefined) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const inputs = Array.from(
          field
            .closest("table")
            ?.querySelectorAll<HTMLInputElement>(
              "input[data-estimate-display]",
            ) ?? [],
        );
        const target =
          inputs[inputs.indexOf(field) + (event.key === "ArrowDown" ? 1 : -1)];
        if (!target) return;
        event.preventDefault();
        focusCell(target);
        target.select();
        return;
      }
      if (event.key === "ArrowLeft" && atStart) {
        const target = field
          .closest("tbody")
          ?.querySelector<HTMLInputElement>("input[data-remarks-lower]");
        if (!target) return;
        event.preventDefault();
        focusCell(target);
        target.select();
      }
      return;
    }
    if (
      field.dataset.remarksLower !== undefined &&
      event.key === "ArrowRight" &&
      atEnd
    ) {
      const target = field
        .closest("tbody")
        ?.querySelector<HTMLInputElement>("input[data-estimate-display]");
      if (!target) return;
      event.preventDefault();
      focusCell(target);
      target.select();
    }
  }, []);

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
          title="この画面を開いたまま、内訳書を別の窓で開きます（内訳書を見ながらこちらを直すときに使います）"
          onClick={() =>
            void window.sekisan.openProjectWindow(project.id, "statement")
          }
        >
          📑 内訳書を開く
        </button>
        <button
          type="button"
          disabled={Object.keys(edits).length === 0}
          onClick={() => void saveEdits()}
          title="直した内容を元の計算書と工事の明細マスターへ書き戻し、集計をかけ直します"
        >
          💾 修正を保存（{Object.keys(edits).length}件）
        </button>
        <button
          type="button"
          disabled={selected === null}
          onClick={() => void toggleUnused()}
          title="不要になった明細に印を付けます。印を付けた明細は工種科目の最後にまとめ、内訳書へは飛ばしません（計算書はそのまま残ります）"
        >
          {selected?.unused ? "↩ 不要を外す" : "🚫 不要明細にする"}
        </button>
        <button
          type="button"
          disabled={selected === null || view.run === null}
          onClick={() => void insertManual(false)}
          title="選んだ明細の下に新しい明細行を挿入します。計算書を持たない手入力の行なので、集計をかけ直しても消えずに残ります（摘要・名称・数量などを直接入れ、修正を保存で登録します）"
        >
          ＋ 下に明細行を挿入
        </button>
        <button
          type="button"
          disabled={selected === null || view.run === null}
          onClick={() => void insertManual(true)}
          title="選んだ明細の上に新しい明細行を挿入します。同じ明細が並ぶ場面で、その前に＜共通仕様＞のような説明行を付けたいときに使います"
        >
          ＋ 上に明細行を挿入
        </button>
        <button
          type="button"
          className={moving ? "on" : ""}
          disabled={selected?.manual !== true}
          onClick={() => {
            if (moving) {
              setMoving(false);
              setMessage("付け直しをやめました");
              return;
            }
            setMoving(true);
            setMessage(
              "付け直す先の明細をクリックしてください（同じ行を押すとやめます）",
            );
          }}
          title="選んだ手入力行を別の明細の上下に付け直します。明細の順番が変わったときに、説明行を付け替えるのに使います（上付き・下付きはそのまま）"
        >
          ⇅ 行を付け直す
        </button>
        <button
          type="button"
          disabled={selected?.manual !== true}
          onClick={() => void deleteManual()}
          title="手で挿入した明細行を消します（緑色の「手」印が付いた行を選んだときだけ押せます）"
        >
          🗑 手入力行を消す
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
        <table className="parts aggregate" onKeyDown={onTableKeyDown}>
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
                    <td colSpan={COLUMNS.length - 1}>{line.heading.text}</td>
                  </tr>
                </tbody>
              );
            }
            const item = line.item;
            const check = checking
              ? checkQuantityUnit(item.quantity, item.unit)
              : "";
            const isSelected = selected?.masterKey === item.masterKey;
            const unusedClass = item.unused ? "unused" : "";
            const manualClass = item.manual ? "manual" : "";
            const draft = edits[item.masterKey] ?? initialEdit(item);
            return (
              <tbody
                key={item.id}
                className={`row ${check} ${unusedClass} ${manualClass} ${isSelected ? "selected" : ""}`}
                data-master-key={item.masterKey}
                onClick={() => clickRow(item)}
              >
                <tr className="detail-upper">
                  <td className="no" rowSpan={2}>
                    {draft.subjectId ?? ""}
                    {item.manual && (
                      <span
                        className="manual-mark"
                        title="手で挿入した明細行（計算書を持たない手入力の行）"
                      >
                        手
                      </span>
                    )}
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
                      {...spaceMark(draft.materialCategory)}
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
                      {...spaceMark(draft.partName)}
                      onChange={(e) =>
                        editItem(item, { partName: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      lang="ja"
                      value={draft.descriptionUpper}
                      {...spaceMark(draft.descriptionUpper)}
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
                      {...spaceMark(draft.remarksUpper)}
                      onChange={(e) =>
                        editItem(item, { remarksUpper: e.target.value })
                      }
                    />
                  </td>
                  <td
                    rowSpan={2}
                    className="estimate-display"
                    title={
                      fixedEstimateDisplay.has(item.masterKey)
                        ? "積算用表示。転記入力表などから来た明細は積算用表示を持たないので直せません"
                        : "積算用表示。違うと同じ明細でも別の行になります"
                    }
                  >
                    {fixedEstimateDisplay.has(item.masterKey) ? (
                      <span {...spaceMark(item.estimateDisplay)}>
                        {item.estimateDisplay}
                      </span>
                    ) : (
                      <input
                        lang="ja"
                        data-estimate-display
                        value={draft.estimateDisplay ?? ""}
                        {...spaceMark(draft.estimateDisplay ?? "")}
                        onChange={(e) =>
                          editItem(item, { estimateDisplay: e.target.value })
                        }
                      />
                    )}
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
                      {...spaceMark(draft.name)}
                      onChange={(e) => editItem(item, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      lang="ja"
                      value={draft.descriptionLower}
                      {...spaceMark(draft.descriptionLower)}
                      onChange={(e) =>
                        editItem(item, { descriptionLower: e.target.value })
                      }
                    />
                  </td>
                  <td className="number">
                    {item.manual ? (
                      <input
                        className="number"
                        title="数量。手入力行は計算書を持たないので直接入れます"
                        value={draft.quantity ?? item.quantity}
                        onChange={(e) =>
                          editItem(item, {
                            quantity: toNumber(e.target.value) ?? 0,
                          })
                        }
                      />
                    ) : (
                      aggregateQuantityText(item.quantity, draft.unit)
                    )}
                  </td>
                  <td>
                    <PickInput
                      entries={unitEntries}
                      halfWidth
                      popupSide="right"
                      dataAttrs={{ "data-unit": "" }}
                      value={draft.unit}
                      title="単位。一覧から選べます。番号を打つと単位の文字に変わります"
                      onCommit={(text) =>
                        editItem(item, {
                          unit: resolveMasterName(units, text),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      lang="ja"
                      data-remarks-lower
                      value={draft.remarksLower}
                      {...spaceMark(draft.remarksLower)}
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
                      <td className="source">
                        {onOpenSource ? (
                          <button
                            type="button"
                            className="link"
                            title={`${sourceLabelOf(detail.sourceKind)} を開く`}
                            onClick={() => onOpenSource(detail)}
                          >
                            📐 {sourceLabelOf(detail.sourceKind)}
                          </button>
                        ) : (
                          sourceLabelOf(detail.sourceKind)
                        )}
                      </td>
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
