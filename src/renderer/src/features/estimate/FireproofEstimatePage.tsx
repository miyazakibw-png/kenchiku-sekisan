import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Detail,
  MasterEntry,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import {
  calcColumnRow,
  columnSheetTotals,
  manageRowQuantity,
  newColumnRow,
  newManageRow,
  normalizeManageRows,
  type FireproofColumnRow,
  type FireproofManageDetail,
  type FireproofManageRow,
} from "../../../../core/fireproof/fireproofEstimate";
import {
  normalizeFloorList,
  SHAPE_LABEL,
  toHalfWidth,
  type FireproofFloorList,
} from "../../../../core/fireproof/fireproofList";
import { findColumnSize } from "../../../../core/fireproof/fireproofEstimate";
import PickInput, { type PickEntry } from "../../components/PickInput";
import { useColumnWidths } from "../../hooks/useColumnWidths";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import "./EstimatePartsPage.css";
import "./FireproofListPage.css";
import "./FireproofEstimatePage.css";

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

/** マスターの番号でも名前でも選べるようにする（他の入力表と同じ考え方） */
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

function formatNumber(value: number | null, decimals = 2): string {
  return value === null ? "" : value.toFixed(decimals);
}

/** 入力管理表の列（No〜備考（上段））の既定の幅 */
const MANAGE_WIDTHS = [
  30, 100, 72, 50, 90, 70, 64, 48, 48, 56, 90, 180, 150, 150, 60, 100, 100,
];
/** 計算書先頭の明細行（区分〜備考（上段））の既定の幅 */
const HEAD_DETAIL_WIDTHS = [64, 48, 48, 56, 90, 180, 150, 150, 60, 100, 100];
/** 柱入力表（階〜壁取合m）の既定の幅 */
const COLUMN_WIDTHS = [36, 100, 80, 44, 44, 110, 200, 70, 70];

/** 表の幅＝列幅の合計（画面いっぱいに広げず、列を小さくできるようにする） */
function tableStyle(widths: number[]): React.CSSProperties {
  const total = widths.reduce((sum, each) => sum + each, 0);
  return { width: `${total}px`, tableLayout: "fixed" };
}

/** 記号の下に出す小さな案内（拾った寸法、または出ない理由） */
function sizeHint(
  list: FireproofFloorList,
  floor: string,
  symbol: string,
): string {
  if (symbol.trim() === "") return "";
  const member = list.members.find(
    (each) => each.symbol.trim() === symbol.trim(),
  );
  if (!member) return "リストにこの記号がありません";
  if (
    floor.trim() !== "" &&
    !list.floors.some((each) => each.label.trim() === floor.trim())
  )
    return "リストにこの階がありません";
  const size = findColumnSize(list, floor, symbol);
  if (!size || size.first === null) return "リストに寸法が入っていません";
  const shape = SHAPE_LABEL[size.shape === "" ? "box" : size.shape];
  return `${shape}${size.first}${size.second === null ? "" : `*${size.second}`}`;
}

/**
 * 耐火被覆・塗装入力表。
 * 上：入力管理表（1行＝1明細。積算範囲ごとに数量を出す）
 * 「計算書」を押すと、その行の柱入力表を開く。
 */
export default function FireproofEstimatePage({
  project,
  options,
  onBack,
}: Props): JSX.Element {
  const [recordId, setRecordId] = useState<number | null>(null);
  /** 鉄骨リストの中身（寸法を拾うのに使う。この画面では直さない） */
  const listRef = useRef<{
    floorCount: number;
    columnsJson: string;
    beamsJson: string;
    commonJson: string;
    note: string;
  }>({
    floorCount: 0,
    columnsJson: "{}",
    beamsJson: "{}",
    commonJson: "[]",
    note: "",
  });
  const [columnsList, setColumnsList] = useState<FireproofFloorList>({
    floors: [],
    members: [],
  });
  const [rows, setRows] = useState<FireproofManageRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState(0);
  const [clipboard, setClipboard] = useState<FireproofManageRow[]>([]);
  const [opened, setOpened] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [numberOptions, setNumberOptions] = useState<Detail[]>([]);
  const history = useUndoRedo<FireproofManageRow[]>();
  const { widths: manageWidths, startResize: startManageResize } =
    useColumnWidths("fireproof-manage-cols", MANAGE_WIDTHS);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    void (async () => {
      const record = await window.sekisan.getFireproofSheet(project.id);
      setRecordId(record.id);
      listRef.current = {
        floorCount: record.floorCount,
        columnsJson: record.columnsJson,
        beamsJson: record.beamsJson,
        commonJson: record.commonJson,
        note: record.note,
      };
      setColumnsList(normalizeFloorList(parseJson(record.columnsJson, {})));
      setRows(normalizeManageRows(parseJson(record.estimateJson, [])));
    })();
  }, [project.id]);

  const save = useCallback(
    async (silent = false): Promise<void> => {
      if (recordId === null) return;
      const base = listRef.current;
      await window.sekisan.saveFireproofSheet({
        id: recordId,
        floorCount: base.floorCount,
        columnsJson: base.columnsJson,
        beamsJson: base.beamsJson,
        commonJson: base.commonJson,
        estimateJson: JSON.stringify(rowsRef.current),
        note: base.note,
      });
      markSaved(rowsRef.current);
      if (!silent) setMessage("保存しました");
    },
    [recordId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { markSaved } = useSaveOnLeave(rows, () => save(true));

  useEffect(() => {
    if (recordId !== null) markSaved(rowsRef.current);
    // 読み込み直後の中身を保存済みの基準にする
  }, [recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: FireproofManageRow[]): void => {
    history.push(rowsRef.current);
    setRows(next);
  };

  /** 入力欄を打っている間は履歴に積まない（欄ごとの細かい戻りを作らない） */
  const change = (index: number, patch: Partial<FireproofManageRow>): void =>
    setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const changeDetail = (
    index: number,
    patch: Partial<FireproofManageDetail>,
  ): void =>
    setRows(
      rows.map((row, at) =>
        at === index ? { ...row, detail: { ...row.detail, ...patch } } : row,
      ),
    );

  const start = Math.min(selected, selectedEnd);
  const end = Math.max(selected, selectedEnd);

  const undo = (): void => {
    const previous = history.undo(rowsRef.current);
    if (previous === null) {
      setMessage("戻せる操作がありません");
      return;
    }
    setRows(previous);
    setMessage("1つ前に戻しました");
  };

  const redo = (): void => {
    const next = history.redo(rowsRef.current);
    if (next === null) {
      setMessage("進める操作がありません");
      return;
    }
    setRows(next);
    setMessage("1つ先へ進めました");
  };

  const copyRows = (): void => {
    const copied = rows.slice(start, end + 1).map((row) => ({
      ...row,
      detail: { ...row.detail },
      sheet: {
        ...row.sheet,
        rows: row.sheet.rows.map((each) => ({ ...each })),
      },
    }));
    if (copied.length === 0) return;
    setClipboard(copied);
    setMessage(
      `⧉ ${copied.length} 行をコピーしました（貼り付け先の行を選んで「上書貼付」「挿入貼付」「追加貼付」）`,
    );
  };

  const pasteRows = (mode: "overwrite" | "insert" | "append"): void => {
    if (clipboard.length === 0) return;
    const fresh = clipboard.map((row) => ({
      ...newManageRow(),
      part1: row.part1,
      scope: row.scope,
      multiplier: row.multiplier,
      detail: { ...row.detail },
      sheet: {
        ...row.sheet,
        rows: row.sheet.rows.map((each) => ({
          ...newColumnRow(),
          ...each,
          id: newColumnRow().id,
        })),
      },
    }));
    const next = [...rows];
    if (mode === "overwrite") next.splice(start, fresh.length, ...fresh);
    if (mode === "insert") next.splice(start, 0, ...fresh);
    if (mode === "append") next.push(...fresh);
    commit(next);
    setMessage(`${fresh.length} 行を貼り付けました`);
  };

  /** 部位1は空欄なら入力のある上の行を引き継ぐ（部位別入力表と同じ） */
  const inheritedPart1 = useMemo(() => {
    let last = "";
    return rows.map((row) => {
      if (row.part1.trim() !== "") last = row.part1;
      return last;
    });
  }, [rows]);

  const subjectEntries: PickEntry[] = useMemo(
    () =>
      options.subjects.map((subject) => ({
        value: String(subject.id),
        label: `${subject.id}　${subject.name}`,
      })),
    [options.subjects],
  );
  const pickupPartEntries: PickEntry[] = useMemo(
    () =>
      options.pickupParts.map((part) => ({
        value: String(part.id),
        label: `${part.id}　${part.name}`,
      })),
    [options.pickupParts],
  );
  const unitEntries: PickEntry[] = useMemo(
    () =>
      options.units.map((unit) => ({
        value: unit.name,
        label: `${unit.id}　${unit.name}`,
      })),
    [options.units],
  );
  const materialEntries: PickEntry[] = useMemo(
    () =>
      options.materialCategories.map((category) => ({
        value: category.name,
        label: `${category.id}　${category.name}`,
      })),
    [options.materialCategories],
  );
  const numberEntries: PickEntry[] = useMemo(
    () =>
      numberOptions.map((item) => ({
        value: item.detailNumber?.toFixed(2) ?? "",
        label: `${item.partName} ${item.name} ${item.descriptionLower}`.trim(),
      })),
    [numberOptions],
  );

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

  /** 名称ID（明細番号）でマスターの明細を呼び出す */
  const applyDetailNumber = useCallback(
    async (index: number, text: string): Promise<void> => {
      const row = rowsRef.current[index];
      if (!row) return;
      const value = text.trim();
      if (value === "") {
        changeDetail(index, { detailNumber: null });
        return;
      }
      const number = Number.parseFloat(value);
      if (Number.isNaN(number)) {
        setMessage("名称ID（明細番号）は数字で入れてください");
        return;
      }
      const targets =
        row.detail.subjectId === null
          ? options.subjects.map((subject) => subject.id)
          : [row.detail.subjectId];
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
          found = hits[0];
          break;
        }
        if (found) break;
      }
      if (!found) {
        changeDetail(index, { detailNumber: number });
        setMessage(`名称ID ${value} の明細が見つかりません`);
        return;
      }
      const detail = found;
      setRows(
        rowsRef.current.map((each, at) =>
          at === index
            ? {
                ...each,
                detail: {
                  ...each.detail,
                  subjectId: detail.subjectId,
                  detailNumber: detail.detailNumber,
                  materialCategory:
                    detail.materialCategory || each.detail.materialCategory,
                  partNumber:
                    options.pickupParts.find(
                      (part) => part.name === detail.partName,
                    )?.id ?? each.detail.partNumber,
                  partName: detail.partName || each.detail.partName,
                  name: detail.name,
                  descriptionUpper: detail.descriptionUpper,
                  descriptionLower: detail.descriptionLower,
                  unit: detail.unit || each.detail.unit,
                  remarksUpper: detail.remarksUpper,
                  remarksLower: detail.remarksLower,
                },
              }
            : each,
        ),
      );
      setMessage(`${detail.name} を呼び出しました`);
    },
    [options.pickupParts, options.subjects, project.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (opened !== null && rows[opened]) {
    return (
      <ColumnSheetView
        project={project}
        row={rows[opened]}
        part1={inheritedPart1[opened] ?? ""}
        list={columnsList}
        options={options}
        detailCell={(key, className) => detailInput(opened, key, className)}
        onChange={(next) => change(opened, next)}
        onCommit={(next) =>
          commit(rows.map((row, at) => (at === opened ? next : row)))
        }
        onBack={() => {
          setOpened(null);
          void save(true);
        }}
        onMessage={setMessage}
      />
    );
  }

  /** 明細の1マス（管理表と計算書の先頭行で同じものを使う＝相互連動） */
  function detailInput(
    index: number,
    key: keyof FireproofManageDetail,
    className?: string,
  ): JSX.Element {
    const detail = rows[index]?.detail;
    if (!detail) return <></>;
    if (key === "materialCategory") {
      return (
        <PickInput
          entries={materialEntries}
          halfWidth
          className={className}
          value={detail.materialCategory}
          title="材種区分。番号を打つと名称に変わります"
          onCommit={(text) =>
            changeDetail(index, {
              materialCategory: pickMaster(options.materialCategories, text)
                .name,
            })
          }
        />
      );
    }
    if (key === "subjectId") {
      return (
        <PickInput
          entries={subjectEntries}
          halfWidth
          className={className}
          value={detail.subjectId === null ? "" : String(detail.subjectId)}
          title="工種科目のID（一覧から選べます）"
          onCommit={(text) => {
            const id = Number.parseInt(text.trim(), 10);
            changeDetail(index, {
              subjectId: Number.isNaN(id) ? null : id,
            });
          }}
        />
      );
    }
    if (key === "partNumber") {
      return (
        <PickInput
          entries={pickupPartEntries}
          halfWidth
          className={className}
          value={detail.partNumber === null ? "" : String(detail.partNumber)}
          title="明細用部位のID。入れると部位名にマスターの文字が入ります"
          onCommit={(text) => {
            const picked = pickMaster(options.pickupParts, text);
            changeDetail(index, {
              partNumber: picked.id,
              partName: picked.id === null ? detail.partName : picked.name,
            });
          }}
        />
      );
    }
    if (key === "detailNumber") {
      return (
        <PickInput
          entries={numberEntries}
          halfWidth
          commitOnBlur
          className={className}
          value={detail.detailNumber?.toFixed(2) ?? ""}
          title="明細番号を入れるとマスターの明細を呼び出します（科目を入れると一覧から選べます）"
          onFocus={() => void loadNumberOptions(detail.subjectId)}
          onCommit={(text) => {
            if (text.trim() === (detail.detailNumber?.toFixed(2) ?? "")) return;
            void applyDetailNumber(index, text);
          }}
        />
      );
    }
    if (key === "unit") {
      return (
        <PickInput
          entries={unitEntries}
          halfWidth
          className={className}
          value={detail.unit}
          title="単位。番号を打つと名称に変わります"
          onCommit={(text) =>
            changeDetail(index, {
              unit: pickMaster(options.units, text).name,
            })
          }
        />
      );
    }
    return (
      <input
        lang="ja"
        className={className}
        value={String(detail[key] ?? "")}
        onChange={(event) => changeDetail(index, { [key]: event.target.value })}
      />
    );
  }

  return (
    <div className="estimate-page fireproof-estimate-page">
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
        <h2>耐火被覆・塗装入力表</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" disabled={!history.canUndo} onClick={undo}>
          ↶ 戻る
        </button>
        <button type="button" disabled={!history.canRedo} onClick={redo}>
          ↷ 進む
        </button>
        <button type="button" onClick={() => commit([...rows, newManageRow()])}>
          ⤓ 行追加
        </button>
        <button
          type="button"
          onClick={() => {
            const next = [...rows];
            next.splice(start, 0, newManageRow());
            commit(next);
          }}
        >
          ➕ 行挿入
        </button>
        <button
          type="button"
          onClick={() => commit(rows.filter((_, at) => at !== start))}
        >
          🗑 行削除
        </button>
        <button
          type="button"
          title="カーソルの行（Shift+クリックで範囲）をコピーします"
          onClick={copyRows}
        >
          ⧉ 行コピー（複数可）
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteRows("overwrite")}
        >
          📋 上書貼付
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteRows("insert")}
        >
          📋 挿入貼付
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteRows("append")}
        >
          📋 追加貼付
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      <div className="section-scroll">
        <table
          className="grid fireproof-manage"
          style={tableStyle(manageWidths)}
        >
          <colgroup>
            {MANAGE_WIDTHS.map((_, index) => (
              <col key={index} style={{ width: `${manageWidths[index]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {(
                [
                  ["No", "no"],
                  ["部位1", "part1"],
                  ["積算範囲", "scope"],
                  ["倍率", "num"],
                  ["計算書", "sheet"],
                  ["数量（自動）", "num"],
                  ["区分", "material"],
                  ["科目", "id"],
                  ["部位ID", "id"],
                  ["名称ID", "id"],
                  ["部位", "part"],
                  ["名称", "name"],
                  ["摘要（下段）", "desc"],
                  ["摘要（上段）", "desc"],
                  ["単位", "unit"],
                  ["備考（下段）", "note"],
                  ["備考（上段）", "note"],
                ] as const
              ).map(([label, cls], index) => (
                <th
                  key={label}
                  className={cls}
                  title={
                    label === "数量（自動）"
                      ? "柱入力表の必要数㎡の合計×倍率で自動で出ます（手では打てません）"
                      : undefined
                  }
                >
                  {label}
                  <span
                    className="col-resize"
                    title="ドラッグで列幅を変えられます"
                    onMouseDown={(e) => startManageResize(index, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id}
                className={
                  index >= start && index <= end ? "selected" : undefined
                }
                onMouseDown={(event) => {
                  if (event.shiftKey) {
                    setSelectedEnd(index);
                    return;
                  }
                  setSelected(index);
                  setSelectedEnd(index);
                }}
              >
                <td className="no">{index + 1}</td>
                <td className="part1">
                  <input
                    lang="ja"
                    value={row.part1}
                    placeholder={inheritedPart1[index]}
                    title="空欄のときは入力のある上の行を引き継ぎます"
                    onChange={(event) =>
                      change(index, { part1: event.target.value })
                    }
                  />
                </td>
                <td className="scope">
                  <select
                    value={row.scope}
                    onChange={(event) =>
                      commit(
                        rows.map((each, at) =>
                          at === index
                            ? {
                                ...each,
                                scope:
                                  event.target.value === "column"
                                    ? "column"
                                    : "",
                              }
                            : each,
                        ),
                      )
                    }
                  >
                    <option value="column">柱</option>
                    <option value="">（未選択）</option>
                  </select>
                </td>
                <td className="num">
                  <input
                    lang="en"
                    className="num"
                    value={
                      row.multiplier === null ? "" : String(row.multiplier)
                    }
                    placeholder="1"
                    title="未入力は1として計算します"
                    onChange={(event) => {
                      const text = toHalfWidth(event.target.value).trim();
                      const value = text === "" ? null : Number(text);
                      change(index, {
                        multiplier:
                          value === null || Number.isNaN(value) ? null : value,
                      });
                    }}
                  />
                </td>
                <td className="sheet">
                  <button
                    type="button"
                    disabled={row.scope !== "column"}
                    onClick={() => setOpened(index)}
                  >
                    📐 柱入力表
                  </button>
                </td>
                <td className="num number">
                  {formatNumber(manageRowQuantity(row, columnsList))}
                </td>
                <td className="material">
                  {detailInput(index, "materialCategory")}
                </td>
                <td className="id">{detailInput(index, "subjectId")}</td>
                <td className="id">{detailInput(index, "partNumber")}</td>
                <td className="id">{detailInput(index, "detailNumber")}</td>
                <td className="part">{detailInput(index, "partName")}</td>
                <td className="name">{detailInput(index, "name")}</td>
                <td className="desc">
                  {detailInput(index, "descriptionLower")}
                </td>
                <td className="desc">
                  {detailInput(index, "descriptionUpper")}
                </td>
                <td className="unit">{detailInput(index, "unit")}</td>
                <td className="note">{detailInput(index, "remarksLower")}</td>
                <td className="note">{detailInput(index, "remarksUpper")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        1行が1明細です。部位1は空欄なら入力のある上の行を引き継ぎます（部位Ⅱ別仕訳・部位Ⅲはありません）。
        倍率は未入力なら1です。「計算書」で柱入力表を開くと、先頭行に同じ明細が出て、どちらで直しても両方に反映します。
        数量は柱入力表の必要数㎡の合計×倍率です。
      </p>
    </div>
  );
}

/** 柱入力表（1つの明細に対して数量を出す） */
function ColumnSheetView({
  project,
  row,
  part1,
  list,
  onChange,
  onCommit,
  onBack,
  onMessage,
  detailCell,
}: {
  project: ProjectSummary;
  row: FireproofManageRow;
  part1: string;
  list: FireproofFloorList;
  options: MasterOptions;
  onChange: (patch: Partial<FireproofManageRow>) => void;
  onCommit: (next: FireproofManageRow) => void;
  onBack: () => void;
  onMessage: (text: string) => void;
  detailCell: (
    key: keyof FireproofManageDetail,
    className?: string,
  ) => JSX.Element;
}): JSX.Element {
  const history = useUndoRedo<FireproofManageRow>();
  const rowRef = useRef(row);
  rowRef.current = row;
  const [selected, setSelected] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState(0);
  const [clipboard, setClipboard] = useState<FireproofColumnRow[]>([]);
  const { widths: headWidths, startResize: startHeadResize } = useColumnWidths(
    "fireproof-head-detail-cols",
    HEAD_DETAIL_WIDTHS,
  );
  const { widths: columnWidths, startResize: startColumnResize } =
    useColumnWidths("fireproof-column-cols", COLUMN_WIDTHS);
  const start = Math.min(selected, selectedEnd);
  const end = Math.max(selected, selectedEnd);

  const totals = columnSheetTotals(row.sheet, list);

  const commitRows = (rows: FireproofColumnRow[]): void => {
    history.push(rowRef.current);
    onCommit({ ...rowRef.current, sheet: { ...rowRef.current.sheet, rows } });
  };

  const changeRow = (index: number, patch: Partial<FireproofColumnRow>): void =>
    onChange({
      sheet: {
        ...row.sheet,
        rows: row.sheet.rows.map((each, at) =>
          at === index ? { ...each, ...patch } : each,
        ),
      },
    });

  const undo = (): void => {
    const previous = history.undo(rowRef.current);
    if (previous === null) {
      onMessage("柱入力表：戻せる操作がありません");
      return;
    }
    onCommit(previous);
  };

  const redo = (): void => {
    const next = history.redo(rowRef.current);
    if (next === null) {
      onMessage("柱入力表：進める操作がありません");
      return;
    }
    onCommit(next);
  };

  const copyRows = (): void => {
    const copied = row.sheet.rows
      .slice(start, end + 1)
      .map((each) => ({ ...each }));
    if (copied.length === 0) return;
    setClipboard(copied);
    onMessage(`⧉ 柱入力表：${copied.length} 行をコピーしました`);
  };

  const pasteRows = (mode: "overwrite" | "insert" | "append"): void => {
    if (clipboard.length === 0) return;
    const fresh = clipboard.map((each) => ({
      ...each,
      id: newColumnRow().id,
    }));
    const next = [...row.sheet.rows];
    if (mode === "overwrite") next.splice(start, fresh.length, ...fresh);
    if (mode === "insert") next.splice(start, 0, ...fresh);
    if (mode === "append") next.push(...fresh);
    commitRows(next);
    onMessage(`柱入力表：${fresh.length} 行を貼り付けました`);
  };

  /** 階の候補（鉄骨リストの柱リストの階） */
  const floorEntries = list.floors
    .map((floor) => floor.label)
    .filter((label) => label.trim() !== "");

  return (
    <div className="estimate-page fireproof-estimate-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 入力管理表へ
        </button>
        <h2>柱入力表</h2>
        <span className="project">
          {project.managementNo} {project.name}
          {part1 ? `　${part1}` : ""}
        </span>
        <button type="button" disabled={!history.canUndo} onClick={undo}>
          ↶ 戻る
        </button>
        <button type="button" disabled={!history.canRedo} onClick={redo}>
          ↷ 進む
        </button>
        <button
          type="button"
          onClick={() => commitRows([...row.sheet.rows, newColumnRow()])}
        >
          ⤓ 行追加
        </button>
        <button
          type="button"
          onClick={() => {
            const next = [...row.sheet.rows];
            next.splice(start, 0, newColumnRow());
            commitRows(next);
          }}
        >
          ➕ 行挿入
        </button>
        <button
          type="button"
          onClick={() =>
            commitRows(row.sheet.rows.filter((_, at) => at !== start))
          }
        >
          🗑 行削除
        </button>
        <button
          type="button"
          title="カーソルの行（Shift+クリックで範囲）をコピーします"
          onClick={copyRows}
        >
          ⧉ 行コピー（複数可）
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteRows("overwrite")}
        >
          📋 上書貼付
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteRows("insert")}
        >
          📋 挿入貼付
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteRows("append")}
        >
          📋 追加貼付
        </button>
      </div>

      {/* 先頭行：管理表と同じ明細（どちらで直しても両方に反映） */}
      <table
        className="grid fireproof-manage head"
        style={tableStyle(headWidths)}
      >
        <colgroup>
          {HEAD_DETAIL_WIDTHS.map((_, index) => (
            <col key={index} style={{ width: `${headWidths[index]}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {(
              [
                ["区分", "material"],
                ["科目", "id"],
                ["部位ID", "id"],
                ["名称ID", "id"],
                ["部位", "part"],
                ["名称", "name"],
                ["摘要（下段）", "desc"],
                ["摘要（上段）", "desc"],
                ["単位", "unit"],
                ["備考（下段）", "note"],
                ["備考（上段）", "note"],
              ] as const
            ).map(([label, cls], index) => (
              <th key={label} className={cls}>
                {label}
                <span
                  className="col-resize"
                  title="ドラッグで列幅を変えられます"
                  onMouseDown={(e) => startHeadResize(index, e)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="material">{detailCell("materialCategory")}</td>
            <td className="id">{detailCell("subjectId")}</td>
            <td className="id">{detailCell("partNumber")}</td>
            <td className="id">{detailCell("detailNumber")}</td>
            <td className="part">{detailCell("partName")}</td>
            <td className="name">{detailCell("name")}</td>
            <td className="desc">{detailCell("descriptionLower")}</td>
            <td className="desc">{detailCell("descriptionUpper")}</td>
            <td className="unit">{detailCell("unit")}</td>
            <td className="note">{detailCell("remarksLower")}</td>
            <td className="note">{detailCell("remarksUpper")}</td>
          </tr>
        </tbody>
      </table>

      <div className="fireproof-thickness">
        <span>耐火被覆厚み→</span>
        <input
          lang="en"
          value={
            row.sheet.thickness === null ? "" : String(row.sheet.thickness)
          }
          placeholder="25"
          title="mmで入れます（断面必要計算式では m に直して使います）"
          onChange={(event) => {
            const text = toHalfWidth(event.target.value).trim();
            const value = text === "" ? null : Number(text);
            onChange({
              sheet: {
                ...row.sheet,
                thickness: value === null || Number.isNaN(value) ? null : value,
              },
            });
          }}
        />
        <span className="sum">
          必要数㎡ <b>{formatNumber(totals.needed)}</b>
        </span>
        <span className="sum">
          壁取合m <b>{formatNumber(totals.wall)}</b>
        </span>
      </div>

      <div className="section-scroll">
        <table
          className="grid fireproof-column"
          style={tableStyle(columnWidths)}
        >
          <colgroup>
            {COLUMN_WIDTHS.map((_, index) => (
              <col key={index} style={{ width: `${columnWidths[index]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {(
                [
                  ["階", "floor"],
                  ["コメント", "comment"],
                  ["記号", "symbol"],
                  ["倍数", "count"],
                  ["取合", "faces"],
                  ["計算式(有効長)", "formula"],
                  ["断面必要計算式", "section"],
                  ["必要数㎡", "num"],
                  ["壁取合m", "num"],
                ] as const
              ).map(([label, cls], index) => (
                <th key={label} className={cls}>
                  {label}
                  <span
                    className="col-resize"
                    title="ドラッグで列幅を変えられます"
                    onMouseDown={(e) => startColumnResize(index, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row.sheet.rows.map((each, index) => {
              const calc = calcColumnRow(each, list, row.sheet.thickness);
              const size = findColumnSize(list, each.floor, each.symbol);
              return (
                <tr
                  key={each.id}
                  className={
                    index >= start && index <= end ? "selected" : undefined
                  }
                  onMouseDown={(event) => {
                    if (event.shiftKey) {
                      setSelectedEnd(index);
                      return;
                    }
                    setSelected(index);
                    setSelectedEnd(index);
                  }}
                >
                  <td className="floor">
                    <input
                      lang="en"
                      inputMode="text"
                      list="fireproof-floor-list"
                      value={each.floor}
                      title="直接打てます。▼を押すと鉄骨リストの柱リストの階から選べます"
                      onChange={(event) =>
                        changeRow(index, {
                          floor: toHalfWidth(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="comment">
                    <input
                      lang="ja"
                      value={each.comment}
                      onChange={(event) =>
                        changeRow(index, { comment: event.target.value })
                      }
                    />
                  </td>
                  <td className="symbol">
                    <input
                      lang="en"
                      value={each.symbol}
                      placeholder="C1"
                      title={
                        size
                          ? `鉄骨リスト：${SHAPE_LABEL[size.shape === "" ? "box" : size.shape]} ${size.first ?? ""}${size.second === null ? "" : `*${size.second}`}`
                          : "鉄骨リストの柱リストにある記号を入れます"
                      }
                      onChange={(event) =>
                        changeRow(index, {
                          symbol: toHalfWidth(event.target.value),
                        })
                      }
                    />
                    <div className="size-hint">
                      {sizeHint(list, each.floor, each.symbol)}
                    </div>
                  </td>
                  <td className="count">
                    <input
                      lang="en"
                      className="num"
                      value={each.count === null ? "" : String(each.count)}
                      onChange={(event) => {
                        const text = toHalfWidth(event.target.value).trim();
                        const value = text === "" ? null : Number(text);
                        changeRow(index, {
                          count:
                            value === null || Number.isNaN(value)
                              ? null
                              : value,
                        });
                      }}
                    />
                  </td>
                  <td className="faces">
                    <input
                      lang="en"
                      className="num"
                      value={each.faces === null ? "" : String(each.faces)}
                      title="耐火被覆を吹く面の数（1〜4）。壁取合mは4面のとき0、それ以外は有効長×2です"
                      onChange={(event) => {
                        const text = toHalfWidth(event.target.value).trim();
                        const value = text === "" ? null : Number(text);
                        changeRow(index, {
                          faces:
                            value === null || Number.isNaN(value)
                              ? null
                              : value,
                        });
                      }}
                    />
                  </td>
                  <td className="formula">
                    <input
                      lang="en"
                      value={each.lengthFormula}
                      placeholder="3.42"
                      onChange={(event) =>
                        changeRow(index, {
                          lengthFormula: toHalfWidth(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="section">
                    <input
                      lang="en"
                      value={each.sectionFormula}
                      placeholder={calc.sectionText}
                      title="空欄のときは階・記号・取合・厚みから自動で作ります（□型）。直すとこの行はその式を使います"
                      onChange={(event) =>
                        changeRow(index, {
                          sectionFormula: toHalfWidth(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="num number">{formatNumber(calc.needed)}</td>
                  <td className="num number">{formatNumber(calc.wall)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="fireproof-floor-list">
          {floorEntries.map((label, index) => (
            <option key={`${index}-${label}`} value={label} />
          ))}
        </datalist>
      </div>
      <p className="hint">
        階は直接打つか▼から鉄骨リストの階を選び、記号に柱リストの記号（C1…）を入れます。記号の下に拾った寸法（出ない理由）が出ます。
        断面必要計算式は資料の図のとおり自動で薄く出します（□：4面
        Ｗ*2+Ｄ*2+厚み*4／3面 Ｗ*2+Ｄ+厚み*2／2面 Ｗ+Ｄ+厚み／1面 Ｄ、Ｈ：4面
        Ｗ*2+Ｄ*4+厚み*4／3面 Ｗ*2+Ｄ*3+厚み*2／2面 Ｗ+Ｄ+Ｄ/2*2+厚み／1面
        Ｄ。厚みは25mmなら0.025）。そのまま計算に使い、欄に打つとその式が優先します。
        表の列幅は見出しの右端をドラッグして変えられます。
        必要数㎡は断面×計算式(有効長)×倍数、壁取合mは有効長×2（取合が4のときは0）です。
      </p>
    </div>
  );
}
