import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Detail,
  MasterEntry,
  MasterOptions,
  MiscSheet,
  ProjectSummary,
} from "@shared/types";
import {
  cellValue,
  columnTotal,
  isEmptyColumn,
  miscColumn,
  miscRow,
  syncRowsFromEstimate,
  type MiscColumn,
  type MiscRow,
} from "../../../../core/misc/miscSheet";
import PickInput, { type PickEntry } from "../../components/PickInput";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import "./RoomCalcSheet.css";
import "./EstimatePartsPage.css";
import "./MiscSheetPage.css";

interface Props {
  project: ProjectSummary;
  options: MasterOptions;
  onBack: () => void;
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** マスターの番号でも名前でも選べるようにする（RoomCalcSheetと同じ考え方） */
function pickMaster(
  entries: MasterEntry[],
  text: string,
): { id: number | null; name: string } {
  const value = text.trim();
  if (value === "") return { id: null, name: "" };
  const byId = entries.find((entry) => String(entry.id) === value);
  if (byId) return { id: byId.id, name: byId.name };
  const byName = entries.find((entry) => entry.name === value);
  if (byName) return { id: byName.id, name: byName.name };
  return { id: null, name: value };
}

/** 明細（タテ1列）の見出し。上から順に1行ずつ出す */
type HeadKind = "subject" | "pickupPart" | "detailNumber" | "unit" | "text";

const HEADS: { key: keyof MiscColumn; label: string; kind: HeadKind }[] = [
  { key: "subjectId", label: "科目", kind: "subject" },
  { key: "partNumber", label: "部位ID", kind: "pickupPart" },
  { key: "detailNumber", label: "名称ID", kind: "detailNumber" },
  { key: "partName", label: "部位", kind: "text" },
  { key: "name", label: "名称", kind: "text" },
  { key: "descriptionUpper", label: "摘要(上段)", kind: "text" },
  { key: "descriptionLower", label: "摘要(下段)", kind: "text" },
  { key: "unit", label: "単位", kind: "unit" },
  { key: "remarksUpper", label: "備考(上段)", kind: "text" },
  { key: "remarksLower", label: "備考(下段)", kind: "text" },
];

/** 呼出先（計算書と同じ。この表は1列＝1明細なのでセット明細は使わない） */
type CallSource = "basic" | "project";

const SOURCE_LABEL: Record<CallSource, string> = {
  basic: "基準マスター（明細）",
  project: "工事マスター（明細）",
};

const LEFT_LABELS = [
  "部位Ⅰ",
  "部位Ⅱ",
  "部位Ⅱ別仕訳",
  "部位Ⅲ（部屋名）",
  "倍率",
];
const LEFT_DEFAULTS = [90, 90, 80, 150, 56];
const COLUMN_DEFAULT = 130;
/** 列幅は文字が見えなくなるほど細くできる */
const MIN_WIDTH = 8;

/** 列幅（左の4列＋明細の列ごと）をこのパソコンに覚えておく */
function readWidths(key: string): Record<string, number> {
  const saved = window.localStorage.getItem(key);
  if (saved === null) return {};
  try {
    const parsed: unknown = JSON.parse(saved);
    if (parsed === null || typeof parsed !== "object") return {};
    const result: Record<string, number> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([id, value]) => {
      if (typeof value === "number" && value >= MIN_WIDTH) result[id] = value;
    });
    return result;
  } catch {
    return {};
  }
}

function textOf(column: MiscColumn, key: keyof MiscColumn): string {
  const value = column[key];
  if (value === null) return "";
  return typeof value === "string" ? value : String(value);
}

/**
 * 部位別雑・金物入力表。
 * 明細を1列ずつタテに書き、部屋（部位別入力表の行）をヨコに並べて数量を拾う。
 * 集計では「その部屋の計算書に入れた」のと同じ扱いになる。
 */
export default function MiscSheetPage({
  project,
  options,
  onBack,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<MiscSheet | null>(null);
  const [columns, setColumns] = useState<MiscColumn[]>([]);
  const [rows, setRows] = useState<MiscRow[]>([]);
  const [message, setMessage] = useState("");
  /** カーソル（選んでいる明細の列と部屋の行） */
  const [pickedColumn, setPickedColumn] = useState<string | null>(null);
  const [pickedRow, setPickedRow] = useState<string | null>(null);
  /** 名称ID欄の候補（選んだ科目の明細） */
  const [numberOptions, setNumberOptions] = useState<Detail[]>([]);
  /** マスター呼出画面（計算書と同じ作り） */
  const [callOpen, setCallOpen] = useState(false);
  const [callSource, setCallSource] = useState<CallSource>("basic");
  const [callInsert, setCallInsert] = useState(false);
  const [callSubjectId, setCallSubjectId] = useState<number | null>(null);
  const [callSubjectNumber, setCallSubjectNumber] = useState("");
  const [callDetails, setCallDetails] = useState<Detail[]>([]);
  const widthKey = `misc-widths:${project.id}`;
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    readWidths(`misc-widths:${project.id}`),
  );
  const widthRef = useRef(widths);
  widthRef.current = widths;

  const { markSaved } = useSaveOnLeave({ columns, rows }, () => save(true));

  const save = useCallback(
    async (quiet = false): Promise<void> => {
      if (!sheet) return;
      const saved = await window.sekisan.saveMiscSheet({
        id: sheet.id,
        columnsJson: JSON.stringify(columns),
        rowsJson: JSON.stringify(rows),
        note: sheet.note,
      });
      setSheet(saved);
      markSaved({ columns, rows });
      if (!quiet) setMessage("保存しました（集計実行で集計書に入ります）");
    },
    [columns, markSaved, rows, sheet],
  );

  useEffect(() => {
    void (async () => {
      const loaded = await window.sekisan.getMiscSheet(project.id);
      const nextColumns = parseJson<MiscColumn[]>(loaded.columnsJson, []);
      const nextRows = parseJson<MiscRow[]>(loaded.rowsJson, []);
      const columnsOrOne =
        nextColumns.length > 0 ? nextColumns : [miscColumn()];
      setSheet(loaded);
      setColumns(columnsOrOne);
      setRows(nextRows);
      markSaved({ columns: columnsOrOne, rows: nextRows });
    })();
  }, [markSaved, project.id]);

  useEffect(() => {
    window.localStorage.setItem(widthKey, JSON.stringify(widths));
  }, [widthKey, widths]);

  // 呼出画面に出す明細（基準マスター＝全明細／工事マスター＝この工事でできた明細）
  useEffect(() => {
    if (!callOpen || callSubjectId === null) {
      setCallDetails([]);
      return;
    }
    void (async () =>
      setCallDetails(
        callSource === "project"
          ? await window.sekisan.listProjectDetailsInUse(
              callSubjectId,
              project.id,
            )
          : await window.sekisan.listDetails(callSubjectId, project.id),
      ))();
  }, [callOpen, callSource, callSubjectId, project.id]);

  /** 見出しの右端をドラッグして列幅を変える */
  const startResize = useCallback(
    (id: string, defaultWidth: number, event: React.MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = widthRef.current[id] ?? defaultWidth;
      const move = (e: MouseEvent): void =>
        setWidths({
          ...widthRef.current,
          [id]: Math.max(MIN_WIDTH, startWidth + e.clientX - startX),
        });
      const up = (): void => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [],
  );

  const widthOf = (id: string, defaultWidth: number): number =>
    widths[id] ?? defaultWidth;

  /** 部位別入力表の部屋を取り込む（入れてある数量はそのまま残す） */
  const loadRooms = useCallback(async (): Promise<void> => {
    const estimateRows = await window.sekisan.listEstimateRows(project.id);
    setRows((current) => {
      const next = syncRowsFromEstimate(current, estimateRows);
      setMessage(`部位別入力表から ${next.length} 行を出しました`);
      return next;
    });
  }, [project.id]);

  const editColumn = useCallback(
    (id: string, patch: Partial<MiscColumn>): void =>
      setColumns((current) =>
        current.map((column) =>
          column.id === id ? { ...column, ...patch } : column,
        ),
      ),
    [],
  );

  const editRow = useCallback(
    (id: string, patch: Partial<MiscRow>): void =>
      setRows((current) =>
        current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      ),
    [],
  );

  const editCell = useCallback(
    (rowId: string, columnId: string, text: string): void =>
      setRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? { ...row, values: { ...row.values, [columnId]: text } }
            : row,
        ),
      ),
    [],
  );

  /** 行を足す（カーソルの行の下／いちばん下） */
  const addRow = useCallback(
    (insert: boolean): void => {
      const created = miscRow();
      setRows((current) => {
        const at = current.findIndex((row) => row.id === pickedRow);
        if (!insert || at < 0) return [...current, created];
        return [...current.slice(0, at), created, ...current.slice(at)];
      });
      setPickedRow(created.id);
      setMessage(insert ? "行を挿入しました" : "行を足しました");
    },
    [pickedRow],
  );

  /** 明細（列）を足す（カーソルの列の左／いちばん右） */
  const addColumn = useCallback(
    (insert: boolean): void => {
      const created = miscColumn();
      setColumns((current) => {
        const at = current.findIndex((column) => column.id === pickedColumn);
        if (!insert || at < 0) return [...current, created];
        return [...current.slice(0, at), created, ...current.slice(at)];
      });
      setPickedColumn(created.id);
      setMessage(insert ? "明細を挿入しました" : "明細を足しました");
    },
    [pickedColumn],
  );

  /** 選んだ明細（列）を左右へ動かす */
  const moveColumn = useCallback(
    (step: number): void =>
      setColumns((current) => {
        const at = current.findIndex((column) => column.id === pickedColumn);
        const to = at + step;
        if (at < 0 || to < 0 || to >= current.length) return current;
        const next = [...current];
        const [moved] = next.splice(at, 1);
        next.splice(to, 0, moved);
        return next;
      }),
    [pickedColumn],
  );

  /** 名称ID欄に入ったとき、その科目の明細を候補として読み込む */
  const loadNumberOptions = useCallback(
    async (subjectId: number | null): Promise<void> => {
      if (subjectId === null) {
        setNumberOptions([]);
        return;
      }
      const forProject = await window.sekisan.listDetails(
        subjectId,
        project.id,
      );
      const basic = await window.sekisan.listDetails(subjectId, null);
      const numbers = new Set(forProject.map((row) => row.detailNumber));
      setNumberOptions([
        ...forProject,
        ...basic.filter((row) => !numbers.has(row.detailNumber)),
      ]);
    },
    [project.id],
  );

  /** 名称ID（明細番号）を入れたら、その明細をマスターから呼び出して列に入れる */
  const applyDetailNumber = useCallback(
    async (column: MiscColumn, text: string): Promise<void> => {
      const value = text.trim();
      if (value === "") {
        editColumn(column.id, { detailNumber: null });
        return;
      }
      const number = Number.parseFloat(value);
      if (Number.isNaN(number)) {
        setMessage("名称ID（明細番号）は数字で入れてください");
        return;
      }
      editColumn(column.id, { detailNumber: number });
      const targets =
        column.subjectId === null
          ? options.subjects.map((subject) => subject.id)
          : [column.subjectId];
      let found: Detail | undefined;
      for (const subjectKey of targets) {
        for (const scope of [project.id, null]) {
          const list = await window.sekisan.listDetails(subjectKey, scope);
          const hits = list.filter(
            (item) =>
              item.detailNumber !== null &&
              Math.abs(item.detailNumber - number) < 0.005,
          );
          if (hits.length === 0) continue;
          const part = column.partName.trim();
          found =
            (part === ""
              ? undefined
              : hits.find((item) => item.partName.trim() === part)) ?? hits[0];
          break;
        }
        if (found) break;
      }
      if (!found) {
        setMessage(`名称ID ${value} の明細が見つかりません`);
        return;
      }
      const keepPart = column.partNumber !== null || column.partName !== "";
      editColumn(column.id, {
        sourceDetailId: found.id,
        subjectId: found.subjectId,
        detailNumber: found.detailNumber,
        materialCategory: found.materialCategory || column.materialCategory,
        partNumber: keepPart
          ? column.partNumber
          : (options.pickupParts.find((part) => part.name === found.partName)
              ?.id ?? null),
        partName: keepPart ? column.partName : found.partName,
        name: found.name,
        descriptionUpper: found.descriptionUpper,
        descriptionLower: found.descriptionLower,
        unit: found.unit || column.unit,
        remarksUpper: found.remarksUpper,
        remarksLower: found.remarksLower,
      });
      setMessage(`${found.name} を呼び出しました`);
    },
    [editColumn, options.pickupParts, options.subjects, project.id],
  );

  /** 呼出画面から明細を入れる（上書き呼出＝選んだ列／挿入呼出＝その左に足す） */
  const callDetail = useCallback(
    (detail: Detail): void => {
      const patch: Partial<MiscColumn> = {
        subjectId: detail.subjectId,
        materialCategory: detail.materialCategory,
        partNumber:
          detail.partNumber ??
          options.pickupParts.find((part) => part.name === detail.partName)
            ?.id ??
          null,
        detailNumber: detail.detailNumber,
        partName: detail.partName,
        name: detail.name,
        descriptionUpper: detail.descriptionUpper,
        descriptionLower: detail.descriptionLower,
        unit: detail.unit,
        remarksUpper: detail.remarksUpper,
        remarksLower: detail.remarksLower,
        sourceDetailId: detail.id,
      };
      setColumns((current) => {
        const at = current.findIndex((column) => column.id === pickedColumn);
        // 挿入呼出は左へ、上書き呼出は空の列へ。
        // すでに入っている列にいるときは、その右へ新しい明細を作る
        if (at < 0) {
          const created = miscColumn(patch);
          setPickedColumn(created.id);
          return [...current, created];
        }
        if (callInsert) {
          const created = miscColumn(patch);
          setPickedColumn(created.id);
          return [...current.slice(0, at), created, ...current.slice(at)];
        }
        if (isEmptyColumn(current[at])) {
          return current.map((column, index) =>
            index === at ? { ...column, ...patch } : column,
          );
        }
        const created = miscColumn(patch);
        setPickedColumn(created.id);
        return [...current.slice(0, at + 1), created, ...current.slice(at + 1)];
      });
      setMessage(`${detail.name} を呼び出しました`);
    },
    [callInsert, options.pickupParts, pickedColumn],
  );

  const totals = useMemo(
    () =>
      new Map(
        columns.map((column) => [
          column.id,
          columnTotal({ columns, rows }, column.id),
        ]),
      ),
    [columns, rows],
  );

  const subjectEntries: PickEntry[] = useMemo(
    () =>
      options.subjects.map((subject) => ({
        value: String(subject.id),
        label: subject.name,
      })),
    [options.subjects],
  );
  const pickupPartEntries: PickEntry[] = useMemo(
    () =>
      options.pickupParts.map((part) => ({
        value: String(part.id),
        label: `${part.name}${part.note ? `　${part.note}` : ""}`,
      })),
    [options.pickupParts],
  );
  const aggregationPartEntries: PickEntry[] = useMemo(
    () =>
      options.aggregationParts.map((part) => ({
        value: part.name,
        label: `${part.id}　${part.name}`,
      })),
    [options.aggregationParts],
  );
  const unitEntries: PickEntry[] = useMemo(
    () =>
      options.units.map((unit) => ({
        value: unit.name,
        label: `${unit.id}　${unit.name}`,
      })),
    [options.units],
  );
  const numberEntries: PickEntry[] = useMemo(
    () =>
      numberOptions.map((item) => ({
        value: item.detailNumber?.toFixed(2) ?? "",
        label: `${item.partName} ${item.name} ${item.descriptionLower}`.trim(),
      })),
    [numberOptions],
  );

  /** 明細（列）の1マス分の入力欄 */
  const headCell = (
    column: MiscColumn,
    head: HeadKind,
    key: keyof MiscColumn,
  ): JSX.Element => {
    if (head === "subject") {
      return (
        <PickInput
          entries={subjectEntries}
          halfWidth
          value={column.subjectId === null ? "" : String(column.subjectId)}
          title={
            options.subjects.find((item) => item.id === column.subjectId)
              ?.name ?? "工種科目のID（一覧から選べます）"
          }
          onFocus={() => setPickedColumn(column.id)}
          onCommit={(text) => {
            const id = Number.parseInt(text.trim(), 10);
            editColumn(column.id, {
              subjectId: Number.isNaN(id) ? null : id,
            });
          }}
        />
      );
    }
    if (head === "pickupPart") {
      return (
        <PickInput
          entries={pickupPartEntries}
          halfWidth
          value={column.partNumber === null ? "" : String(column.partNumber)}
          title="明細用部位のID。入れると部位名にマスターの文字が入ります"
          onFocus={() => setPickedColumn(column.id)}
          onCommit={(text) => {
            const picked = pickMaster(options.pickupParts, text);
            editColumn(column.id, {
              partNumber: picked.id,
              partName: picked.id === null ? column.partName : picked.name,
            });
          }}
        />
      );
    }
    if (head === "detailNumber") {
      return (
        <PickInput
          entries={numberEntries}
          halfWidth
          commitOnBlur
          value={column.detailNumber?.toFixed(2) ?? ""}
          title="明細番号を入れるとマスターの明細を呼び出します（科目を入れると一覧から選べます）"
          onFocus={() => {
            setPickedColumn(column.id);
            void loadNumberOptions(column.subjectId);
          }}
          onCommit={(text) => {
            if (text.trim() === (column.detailNumber?.toFixed(2) ?? "")) return;
            void applyDetailNumber(column, text);
          }}
        />
      );
    }
    if (head === "unit") {
      return (
        <PickInput
          entries={unitEntries}
          halfWidth
          value={column.unit}
          title="単位。番号を打つと名称に変わります"
          onFocus={() => setPickedColumn(column.id)}
          onCommit={(text) =>
            editColumn(column.id, {
              name: column.name,
              unit: pickMaster(options.units, text).name,
            })
          }
        />
      );
    }
    return (
      <input
        lang="ja"
        value={textOf(column, key)}
        onFocus={() => setPickedColumn(column.id)}
        onChange={(e) =>
          editColumn(column.id, {
            [key]: e.target.value,
          } as Partial<MiscColumn>)
        }
      />
    );
  };

  return (
    <div className="estimate-page misc-page">
      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              await save(true);
              onBack();
            })();
          }}
        >
          ← 工事管理画面へ
        </button>
        <h2>部位別雑・金物入力表</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => void loadRooms()}>
          📄 部位別入力表から転記
        </button>
        <button type="button" onClick={() => addRow(false)}>
          ⤓ 行追加
        </button>
        <button type="button" onClick={() => addRow(true)}>
          ⇱ 行挿入
        </button>
        <button type="button" onClick={() => addColumn(false)}>
          ➕ 明細追加
        </button>
        <button type="button" onClick={() => addColumn(true)}>
          ⇲ 明細挿入
        </button>
        <button
          type="button"
          title="選んでいる明細を左へ動かします"
          onClick={() => moveColumn(-1)}
        >
          ← 明細
        </button>
        <button
          type="button"
          title="選んでいる明細を右へ動かします"
          onClick={() => moveColumn(1)}
        >
          明細 →
        </button>
        <button
          type="button"
          className={callOpen ? "on" : ""}
          onClick={() => setCallOpen(!callOpen)}
        >
          📂 マスター呼出
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      {callOpen && (
        <div className="room-calc-sheet">
          <div className="call-window">
            <div className="section-bar">
              <span>マスター呼出</span>
              {(Object.keys(SOURCE_LABEL) as CallSource[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={callSource === key ? "on" : ""}
                  onClick={() => setCallSource(key)}
                >
                  {SOURCE_LABEL[key]}
                </button>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={!callInsert}
                  onChange={() => setCallInsert(false)}
                />
                上書き呼出
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={callInsert}
                  onChange={() => setCallInsert(true)}
                />
                挿入呼出
              </label>
              <span className="call-target">
                書込先：
                {pickedColumn === null
                  ? "（新しい明細）"
                  : `${columns.findIndex((column) => column.id === pickedColumn) + 1}列目`}
              </span>
              <button type="button" onClick={() => setCallOpen(false)}>
                ✕ 閉じる
              </button>
            </div>
            <div className="call-subject">
              <span>工種科目</span>
              <input
                className="num"
                value={callSubjectNumber}
                title="工種科目の番号を入れると、その科目の明細を出します"
                onChange={(e) => {
                  const text = e.target.value.trim();
                  setCallSubjectNumber(e.target.value);
                  const found = options.subjects.find(
                    (subject) => String(subject.id) === text,
                  );
                  setCallSubjectId(found?.id ?? null);
                }}
              />
              <select
                value={callSubjectId === null ? "" : String(callSubjectId)}
                onChange={(e) => {
                  const id = Number.parseInt(e.target.value, 10);
                  setCallSubjectId(Number.isNaN(id) ? null : id);
                  setCallSubjectNumber(Number.isNaN(id) ? "" : String(id));
                }}
              >
                <option value="">（工種科目を選ぶ）</option>
                {options.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.id}：{subject.name}
                  </option>
                ))}
              </select>
              <span className="count">{callDetails.length}件</span>
            </div>
            <div className="call-scroll">
              <table className="call-table">
                <thead>
                  <tr>
                    <th className="no">部位ID</th>
                    <th className="no">番号</th>
                    <th>部位名／名称</th>
                    <th>摘要</th>
                    <th className="unit">単位</th>
                    <th>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {callDetails.map((detail, index) => (
                    <tr
                      key={`${detail.id}-${index}`}
                      tabIndex={0}
                      onDoubleClick={() => callDetail(detail)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") callDetail(detail);
                      }}
                    >
                      <td className="no">{detail.partNumber ?? ""}</td>
                      <td className="no">
                        {detail.detailNumber?.toFixed(2) ?? ""}
                      </td>
                      <td>
                        <div className="upper">{detail.partName}</div>
                        <div className="lower">{detail.name}</div>
                      </td>
                      <td>
                        <div className="upper">{detail.descriptionUpper}</div>
                        <div className="lower">{detail.descriptionLower}</div>
                      </td>
                      <td className="unit">{detail.unit}</td>
                      <td>
                        <div className="upper">{detail.remarksUpper}</div>
                        <div className="lower">{detail.remarksLower}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              選んでダブルクリック（またはEnter）で呼び出します。呼出画面は閉じないので続けて呼び出せます。
            </p>
          </div>
        </div>
      )}

      <div className="misc-table-wrap">
        <table className="grid misc">
          <colgroup>
            {LEFT_LABELS.map((label, index) => (
              <col
                key={label}
                style={{ width: widthOf(`left${index}`, LEFT_DEFAULTS[index]) }}
              />
            ))}
            <col style={{ width: widthOf("label", 110) }} />
            {columns.map((column) => (
              <col
                key={column.id}
                style={{ width: widthOf(column.id, COLUMN_DEFAULT) }}
              />
            ))}
          </colgroup>
          <thead>
            {HEADS.map((head, headIndex) => (
              <tr key={String(head.key)}>
                <th className="head-label" colSpan={LEFT_LABELS.length + 1}>
                  {head.label}
                </th>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    className={pickedColumn === column.id ? "col on" : "col"}
                    onClick={() => setPickedColumn(column.id)}
                  >
                    <span className="cellbox">
                      {headCell(column, head.kind, head.key)}
                      {headIndex === 0 && (
                        <span
                          className="resizer"
                          onMouseDown={(e) =>
                            startResize(column.id, COLUMN_DEFAULT, e)
                          }
                        />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
            <tr className="total-row">
              {LEFT_LABELS.map((label, index) => (
                <th key={label} className="left">
                  <span className="cellbox">
                    {label}
                    <span
                      className="resizer"
                      onMouseDown={(e) =>
                        startResize(`left${index}`, LEFT_DEFAULTS[index], e)
                      }
                    />
                  </span>
                </th>
              ))}
              <th className="head-label">合計</th>
              {columns.map((column) => (
                <th key={column.id} className="num">
                  {isEmptyColumn(column)
                    ? ""
                    : (totals.get(column.id) ?? 0).toFixed(2)}
                  <button
                    type="button"
                    className="drop"
                    title="この明細（列）を消します"
                    onClick={() =>
                      setColumns((current) =>
                        current.filter((each) => each.id !== column.id),
                      )
                    }
                  >
                    🗑
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={pickedRow === row.id ? "on" : undefined}
              >
                <td className="part">
                  <PickInput
                    entries={aggregationPartEntries}
                    halfWidth
                    value={row.part1}
                    onFocus={() => setPickedRow(row.id)}
                    onCommit={(text) =>
                      editRow(row.id, {
                        part1: pickMaster(options.aggregationParts, text).name,
                      })
                    }
                  />
                </td>
                <td className="part">
                  <PickInput
                    entries={aggregationPartEntries}
                    halfWidth
                    value={row.part2}
                    onFocus={() => setPickedRow(row.id)}
                    onCommit={(text) =>
                      editRow(row.id, {
                        part2: pickMaster(options.aggregationParts, text).name,
                      })
                    }
                  />
                </td>
                <td className="flag">
                  <input
                    type="checkbox"
                    checked={row.part2Split}
                    onFocus={() => setPickedRow(row.id)}
                    onChange={(e) =>
                      editRow(row.id, { part2Split: e.target.checked })
                    }
                  />
                </td>
                <td className="room">
                  <span className="cellbox">
                    <input
                      lang="ja"
                      value={row.part3}
                      onFocus={() => setPickedRow(row.id)}
                      onChange={(e) =>
                        editRow(row.id, { part3: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="drop"
                      title="この行を消します"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((each) => each.id !== row.id),
                        )
                      }
                    >
                      🗑
                    </button>
                  </span>
                </td>
                <td className="multiplier">
                  <input
                    value={String(row.multiplier)}
                    title="倍率"
                    onFocus={() => setPickedRow(row.id)}
                    onChange={(e) => {
                      const parsed = Number.parseFloat(e.target.value);
                      editRow(row.id, {
                        multiplier: Number.isNaN(parsed) ? 0 : parsed,
                      });
                    }}
                  />
                </td>
                <td className="label" />
                {columns.map((column) => {
                  const text = row.values[column.id] ?? "";
                  const value = cellValue(text);
                  return (
                    <td
                      key={column.id}
                      className={
                        text !== "" && value === null ? "num error" : "num"
                      }
                      title={
                        value === null ? "" : `計算結果 ${value.toFixed(2)}`
                      }
                    >
                      <input
                        value={text}
                        onFocus={() => {
                          setPickedRow(row.id);
                          setPickedColumn(column.id);
                        }}
                        onChange={(e) =>
                          editCell(row.id, column.id, e.target.value)
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint">
        ヨコの行は「📄
        部位別入力表から転記」で部屋を出します（行追加・行挿入で自分でも足せます）。
        交わるマスに数量（計算式も入ります）を入れると、その部屋の計算書に入れたのと同じ扱いで集計します。
      </p>
    </div>
  );
}
