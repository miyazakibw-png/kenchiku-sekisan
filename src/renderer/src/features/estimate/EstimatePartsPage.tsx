import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EstimateRowCheck,
  EstimateRowDraft,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import MasterCodeInput, {
  MasterCodeOptions,
} from "../../components/MasterCodeInput";
import { buildPastePreview } from "../grid/gridClipboard";
import {
  buildEstimateColumns,
  copyRowsInto,
  duplicateRoomFlags,
  emptyRow,
  formatNumber,
  insertRow,
  moveRow,
  overwriteRowsInto,
  parseMultiplier,
  parseNumber,
  removeRow,
  resolveInherited,
  subtotalRow,
  subtotalSums,
  toDrafts,
  updateRow,
} from "./estimateRows";
import RoomSheetPage from "./RoomSheetPage";
import FrameSheetPage from "./FrameSheetPage";
import GeneralSheetPage from "./GeneralSheetPage";
import PitSheetPage from "./PitSheetPage";
import "./EstimatePartsPage.css";
import { useTableResize } from "../../hooks/useTableResize";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { ask } from "../common/askDialog";

interface Props {
  project: ProjectSummary;
  options: MasterOptions;
  onBack: () => void;
}

/** 計算書から拾った数量を表示するチェック列（既定は仕上） */
const CHECK_COLUMNS = ["床", "巾木", "壁", "柱", "梁", "張天井", "廻り縁"];

export default function EstimatePartsPage({
  project,
  options,
  onBack,
}: Props): JSX.Element {
  const tableRef = useTableResize("table-widths-estimate-parts-v1");
  /** 計算書を開く前の画面の位置（戻ったときに同じ所を出す） */
  const pageRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef(0);
  const restoreScrollRef = useRef(false);
  const [rows, setRows] = useState<EstimateRowDraft[]>([]);
  const [selected, setSelected] = useState(0);
  /** 複数行選択の終わり（Shift+クリックで広げる） */
  const [selectedEnd, setSelectedEnd] = useState(0);
  const [message, setMessage] = useState("");
  const [clipboard, setClipboard] = useState<EstimateRowDraft[]>([]);
  const [others, setOthers] = useState<ProjectSummary[] | null>(null);
  /** 計算書を開いている行（部位別入力表の行が1部屋＝1計算書） */
  const [openedSheet, setOpenedSheet] = useState<number | null>(null);
  /** 軸組の「置ける部屋」から部屋計算書へ飛んだとき、戻り先の軸組計算書 */
  const [returnSheet, setReturnSheet] = useState<number | null>(null);
  /** チェック列に表示する材種区分（仕上以外でもチェックできる） */
  const [checkCategory, setCheckCategory] = useState(
    options.materialCategories.some((category) => category.name === "仕上")
      ? "仕上"
      : (options.materialCategories[0]?.name ?? "仕上"),
  );
  const columns = useMemo(
    () => buildEstimateColumns(options.formworkCategories),
    [options.formworkCategories],
  );
  const inherited = useMemo(() => resolveInherited(rows), [rows]);
  /** 同じ部屋名（部位Ⅰ＋部位Ⅱ＋部位Ⅲ）が重なっている行 */
  const duplicated = useMemo(() => duplicateRoomFlags(rows), [rows]);
  /** チェック列（1部位＝名称＋数量の2列）。各行の計算書から拾う */
  const [checks, setChecks] = useState<EstimateRowCheck[]>([]);
  /** ↶戻る・↷進む用の履歴 */
  const pastRef = useRef<EstimateRowDraft[][]>([]);
  const futureRef = useRef<EstimateRowDraft[][]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const checkColumns = useMemo(
    () =>
      options.aggregationParts.length > 0
        ? options.aggregationParts.map((part) => part.name)
        : CHECK_COLUMNS,
    [options.aggregationParts],
  );
  const checkOf = useCallback(
    (rowId: number | null, partName: string) => {
      if (rowId === null) return null;
      const found = checks.find((check) => check.estimateRowId === rowId);
      return found?.cells.find((cell) => cell.partName === partName) ?? null;
    },
    [checks],
  );

  /** 小計行に入れる部位ごとの数量合計（ひとつ上の小計行から下の分） */
  const partSums = useMemo(
    () =>
      subtotalSums(rows, checkColumns, (row, partName) => {
        const cell = checkOf(row.id, partName);
        return cell === null ? null : cell.quantity;
      }),
    [rows, checkColumns, checkOf],
  );

  /** 行ごとに中身の入っている計算書の種類（種類を変える前の確認に使う） */
  const [filledSheets, setFilledSheets] = useState<Record<number, string[]>>(
    {},
  );

  const { markSaved } = useSaveOnLeave(rows, () => save());

  const reload = useCallback(async () => {
    const next = toDrafts(await window.sekisan.listEstimateRows(project.id));
    setRows(next);
    markSaved(next);
    setFilledSheets(await window.sekisan.listFilledCalcSheets(project.id));
  }, [markSaved, project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void (async () => {
      setChecks(
        await window.sekisan.getEstimateRowChecks(project.id, checkCategory),
      );
    })();
  }, [checkCategory, project.id, rows]);

  /** 今の行の中身（欄を離れたときなど、描き直しよりあとで使う） */
  const rowsRef = useRef<EstimateRowDraft[]>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  /** 直したときは1つ前の内容を履歴へ積む（↶戻る・↷進む用） */
  const editRows = useCallback((next: EstimateRowDraft[]): void => {
    pastRef.current = [...pastRef.current.slice(-99), rowsRef.current];
    futureRef.current = [];
    setHistoryTick((tick) => tick + 1);
    rowsRef.current = next;
    setRows(next);
  }, []);

  const canUndo = useMemo(
    () => historyTick >= 0 && pastRef.current.length > 0,
    [historyTick],
  );
  const canRedo = useMemo(
    () => historyTick >= 0 && futureRef.current.length > 0,
    [historyTick],
  );

  const undoRows = useCallback((): void => {
    const previous = pastRef.current[pastRef.current.length - 1];
    if (previous === undefined) {
      setMessage("戻せる操作がありません");
      return;
    }
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [rows, ...futureRef.current];
    setHistoryTick((tick) => tick + 1);
    setRows(previous);
    setMessage("1つ前に戻しました（保存すると確定します）");
  }, [rows]);

  const redoRows = useCallback((): void => {
    const next = futureRef.current[0];
    if (next === undefined) {
      setMessage("進める操作がありません");
      return;
    }
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, rows];
    setHistoryTick((tick) => tick + 1);
    setRows(next);
    setMessage("1つ先へ進めました（保存すると確定します）");
  }, [rows]);

  const saveRows = useCallback(
    async (next: EstimateRowDraft[], note: string) => {
      const saved = await window.sekisan.saveEstimateRows({
        projectId: project.id,
        rows: next,
      });
      const drafts = toDrafts(saved);
      setRows(drafts);
      markSaved(drafts);
      // 貼り付けで複製した計算書も「入力済み」として扱う（種類を変える前の確認に使う）
      setFilledSheets(await window.sekisan.listFilledCalcSheets(project.id));
      setMessage(note);
    },
    [markSaved, project.id],
  );

  const save = useCallback(async () => {
    await saveRows(rows, "保存しました");
  }, [rows, saveRows]);

  const selectionStart = Math.min(selected, selectedEnd);
  const selectionEnd = Math.max(selected, selectedEnd);

  /** 行コピー（Shift+クリックで選んだ範囲、無ければカーソルの1行） */
  const copyRows = useCallback(() => {
    const copied = rows.slice(selectionStart, selectionEnd + 1);
    if (copied.length === 0) return;
    setClipboard(copied);
    setMessage(
      `⧉ ${copied.length} 行をコピーしました（貼り付けたい行にカーソルを置いて「上書貼付」「挿入貼付」「追加貼付」）`,
    );
  }, [rows, selectionEnd, selectionStart]);

  /** 貼付はその場で保存して、計算書の中身まで複製する */
  const pasteRows = useCallback(
    async (mode: "over" | "insert" | "append") => {
      const copied = clipboard;
      if (copied.length === 0) return;
      const next =
        mode === "over"
          ? overwriteRowsInto(rows, selectionStart, copied)
          : copyRowsInto(
              rows,
              mode === "insert" ? selectionStart : rows.length,
              copied,
            );
      const where =
        mode === "over"
          ? "カーソルの行から上書き"
          : mode === "insert"
            ? "カーソルの行の上へ挿入"
            : "最終行の下へ追加";
      await saveRows(
        next,
        `${copied.length} 行を${where}しました（計算書の中身も複製）`,
      );
    },
    [clipboard, rows, saveRows, selectionStart],
  );

  /** Excelの表をそのまま貼り付ける（選択行の部位Ⅰ列から取り込む） */
  const pasteFromExcel = useCallback(async () => {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    const preview = buildPastePreview(rows, columns, text, selected, 0, () =>
      emptyRow(),
    );
    editRows(preview.rows);
    const notes = [
      `${preview.addedRows} 行追加`,
      preview.errorCount > 0 ? `取り込めない値 ${preview.errorCount} 件` : "",
    ].filter(Boolean);
    setMessage(`貼り付けました（${notes.join("／")}）`);
  }, [columns, rows, selected]);

  const copyFromOtherProject = useCallback(async (source: ProjectSummary) => {
    const copied = toDrafts(await window.sekisan.listEstimateRows(source.id));
    setClipboard(copied);
    setOthers(null);
    setMessage(
      `${source.managementNo} から ${copied.length} 行を控えました（行貼り込みで挿入）`,
    );
  }, []);

  const openOtherProjects = useCallback(async () => {
    const ledger = await window.sekisan.getProjectLedger();
    setOthers(ledger.projects.filter((row) => row.id !== project.id));
  }, [project.id]);

  // 計算書から戻ったときは、開く前に見ていた位置へ戻す（下の方の部屋でも探し直さずに済む）
  useEffect(() => {
    if (openedSheet !== null || !restoreScrollRef.current) return;
    const page = pageRef.current;
    if (!page || rows.length === 0) return;
    page.scrollTop = scrollRef.current;
    restoreScrollRef.current = false;
  }, [openedSheet, rows]);

  /**
   * 計算書は保存済みの行にしか作れないので、開く前に画面の内容を保存する。
   * 保存しないまま開くと、戻ったときの読み直しで消した行が戻ってしまう。
   */
  const openCalcSheet = useCallback(
    async (index: number) => {
      scrollRef.current = pageRef.current?.scrollTop ?? 0;
      restoreScrollRef.current = true;
      const row = rows[index];
      if (!row || row.rowType === "subtotal") return;
      const saved = toDrafts(
        await window.sekisan.saveEstimateRows({
          projectId: project.id,
          rows,
        }),
      );
      setRows(saved);
      if (!saved[index] || saved[index].id === null) {
        setMessage("保存してから計算書を開いてください");
        return;
      }
      setOpenedSheet(index);
    },
    [project.id, rows],
  );

  const numberCell = (
    index: number,
    value: number | null,
    decimals: number,
    parse: (text: string) => { value: number | null; error?: string },
    apply: (parsed: number | null) => Partial<EstimateRowDraft>,
  ): JSX.Element => {
    const rowId = rows[index]?.id ?? null;
    return (
      <input
        className="num"
        defaultValue={formatNumber(value, decimals)}
        key={`${index}-${formatNumber(value, decimals)}`}
        onBlur={(e) => {
          const parsed = parse(e.target.value);
          if (parsed.error) {
            setMessage(parsed.error);
            return;
          }
          // 欄を離れるまでに行が増えていても、同じ行へ入れる
          const current = rowsRef.current;
          const at =
            rowId === null
              ? index
              : current.findIndex((row) => row.id === rowId);
          if (at < 0) return;
          editRows(updateRow(current, at, apply(parsed.value)));
        }}
      />
    );
  };

  if (openedSheet !== null && rows[openedSheet]?.calcType === "frame") {
    return (
      <FrameSheetPage
        project={project}
        row={rows[openedSheet]}
        roomName={`${rows[openedSheet].part2} ${rows[openedSheet].part3}`.trim()}
        onBack={() => {
          setOpenedSheet(null);
          void reload();
        }}
        onOpenRoomSheet={(estimateRowId) => {
          const index = rows.findIndex((each) => each.id === estimateRowId);
          if (index < 0) {
            setMessage("その部屋の行が見つかりません");
            return;
          }
          setSelected(index);
          setReturnSheet(openedSheet);
          setOpenedSheet(index);
        }}
      />
    );
  }

  if (openedSheet !== null && rows[openedSheet]?.calcType === "general") {
    return (
      <GeneralSheetPage
        project={project}
        row={rows[openedSheet]}
        roomName={`${rows[openedSheet].part2} ${rows[openedSheet].part3}`.trim()}
        onBack={() => {
          setOpenedSheet(null);
          void reload();
        }}
      />
    );
  }

  if (openedSheet !== null && rows[openedSheet]?.calcType === "pit") {
    return (
      <PitSheetPage
        project={project}
        row={rows[openedSheet]}
        roomName={`${rows[openedSheet].part2} ${rows[openedSheet].part3}`.trim()}
        onBack={() => {
          setOpenedSheet(null);
          void reload();
        }}
      />
    );
  }

  if (openedSheet !== null && rows[openedSheet]) {
    return (
      <RoomSheetPage
        project={project}
        row={rows[openedSheet]}
        roomName={rows[openedSheet].part3}
        onCeilingHeightChange={(height) => {
          if (openedSheet === null) return;
          editRows(
            updateRow(rowsRef.current, openedSheet, {
              ceilingHeight: height,
            }),
          );
        }}
        onBack={() => {
          if (returnSheet !== null) {
            setOpenedSheet(returnSheet);
            setReturnSheet(null);
            return;
          }
          setOpenedSheet(null);
          void reload();
        }}
      />
    );
  }

  return (
    <div className="estimate-page" ref={pageRef}>
      <div className="toolbar">
        <div className="left-actions">
          <button type="button" onClick={onBack}>
            ← 工事管理画面へ
          </button>
          <div className="three">
            <button type="button" onClick={() => void openCalcSheet(selected)}>
              📐 計算書を開く
            </button>
            <button type="button" onClick={() => void pasteFromExcel()}>
              📋 Excelから貼り付け
            </button>
            <button type="button" onClick={() => void save()}>
              💾 保存
            </button>
          </div>
        </div>
        <h2>部位別入力表</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button
          type="button"
          disabled={!canUndo}
          title="1つ前の内容に戻します"
          onClick={undoRows}
        >
          ↶ 戻る
        </button>
        <button
          type="button"
          disabled={!canRedo}
          title="戻した内容を1つ先へ進めます"
          onClick={redoRows}
        >
          ↷ 進む
        </button>
        <button
          type="button"
          onClick={() => editRows(insertRow(rows, selected))}
        >
          ➕ 行挿入
        </button>
        <button
          type="button"
          onClick={() => editRows(insertRow(rows, rows.length))}
        >
          ⤓ 最終行に追加
        </button>
        <button
          type="button"
          onClick={() =>
            editRows([
              ...rows.slice(0, selected + 1),
              subtotalRow(),
              ...rows.slice(selected + 1),
            ])
          }
        >
          Σ 小計行
        </button>
        <button
          type="button"
          onClick={() => editRows(removeRow(rows, selected))}
        >
          🗑 行削除
        </button>
        <button
          type="button"
          onClick={() => {
            editRows(moveRow(rows, selected, selected - 1));
            setSelected(Math.max(selected - 1, 0));
          }}
        >
          ↑ 上へ
        </button>
        <button
          type="button"
          onClick={() => {
            editRows(moveRow(rows, selected, selected + 1));
            setSelected(Math.min(selected + 1, rows.length - 1));
          }}
        >
          ↓ 下へ
        </button>
        <button
          type="button"
          title="カーソルの行（Shift+クリックで選んだ範囲）をコピーします"
          onClick={copyRows}
        >
          ⧉ 行コピー（複数可）
        </button>
        <button
          type="button"
          title="カーソルの行から、コピーした行で上書きします"
          disabled={clipboard.length === 0}
          onClick={() => void pasteRows("over")}
        >
          📋 上書貼付
        </button>
        <button
          type="button"
          title="カーソルの行の上へ、コピーした行を挿入します"
          disabled={clipboard.length === 0}
          onClick={() => void pasteRows("insert")}
        >
          📋 挿入貼付
        </button>
        <button
          type="button"
          title="最終行の下へ、コピーした行を足します（カーソル位置に関係なし）"
          disabled={clipboard.length === 0}
          onClick={() => void pasteRows("append")}
        >
          📋 追加貼付
        </button>
        <button type="button" onClick={() => void openOtherProjects()}>
          🏢 他物件から
        </button>
        <span className="status">{message}</span>
      </div>

      <div className="check-setting">
        <span>チェック表示の材種区分</span>
        <select
          value={checkCategory}
          onChange={(e) => setCheckCategory(e.target.value)}
        >
          {options.materialCategories.map((category) => (
            <option key={category.id} value={category.name}>
              {category.name}
            </option>
          ))}
        </select>
        <span className="note">
          部位ごとに「名称」と「数量」の2列で、その行の計算書から拾った
          {checkCategory}
          だけを表示します（計算書の作成後に反映）。
        </span>
      </div>

      {others && (
        <div className="other-projects">
          <span>コピー元の物件</span>
          {others.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => void copyFromOtherProject(row)}
            >
              {row.managementNo} {row.name}
            </button>
          ))}
          <button type="button" onClick={() => setOthers(null)}>
            取消
          </button>
        </div>
      )}

      <MasterCodeOptions
        entries={options.formworkCategories}
        listId="formwork-list"
      />

      <table className="grid estimate" ref={tableRef}>
        <thead>
          <tr>
            <th className="no">No</th>
            <th className="part">部位Ⅰ</th>
            <th className="part">部位Ⅱ</th>
            <th className="flag">部位Ⅱ別仕訳</th>
            <th className="formwork">型枠</th>
            <th className="room">部位Ⅲ（部屋名）</th>
            <th className="num">天井高さ</th>
            <th className="num">倍率</th>
            <th className="calc-type">計算書</th>
            <th className="note">備考</th>
            {checkColumns.map((label) => (
              <th key={label} className="check" colSpan={2}>
                {label}
              </th>
            ))}
          </tr>
          <tr>
            <th colSpan={10} />
            {checkColumns.flatMap((label) => [
              <th key={`n-${label}`} className="check">
                {checkCategory}名称
              </th>,
              <th key={`q-${label}`} className="check">
                数量
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const shown = inherited[index];
            const isSubtotal = row.rowType === "subtotal";
            return (
              <tr
                key={row.id ?? `new-${index}`}
                className={
                  [
                    index >= selectionStart && index <= selectionEnd
                      ? "selected"
                      : "",
                    isSubtotal ? "subtotal" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onClick={(e) => {
                  if (e.shiftKey) {
                    setSelectedEnd(index);
                    return;
                  }
                  setSelected(index);
                  setSelectedEnd(index);
                }}
                onDoubleClick={(e) => {
                  // 入力欄の中でのダブルクリックは文字を選ぶ操作。計算書は開かない
                  if (
                    e.target instanceof HTMLElement &&
                    e.target.closest("input, select, textarea, button") !== null
                  ) {
                    return;
                  }
                  void openCalcSheet(index);
                }}
              >
                <td className="no">
                  <span className="no-cell">
                    <span className="row-no">{index + 1}</span>
                    <span className="row-move">
                      <button
                        type="button"
                        title="この行を1つ上へ"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          editRows(moveRow(rows, index, index - 1));
                          setSelected(index - 1);
                          setSelectedEnd(index - 1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="この行を1つ下へ"
                        disabled={index === rows.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          editRows(moveRow(rows, index, index + 1));
                          setSelected(index + 1);
                          setSelectedEnd(index + 1);
                        }}
                      >
                        ↓
                      </button>
                    </span>
                  </span>
                </td>
                <td>
                  {isSubtotal ? (
                    ""
                  ) : (
                    <input
                      lang="ja"
                      value={row.part1}
                      placeholder={shown.part1}
                      title="空欄のときは入力のある上の行を引き継ぎます"
                      onChange={(e) =>
                        editRows(
                          updateRow(rows, index, { part1: e.target.value }),
                        )
                      }
                    />
                  )}
                </td>
                <td>
                  {isSubtotal ? (
                    ""
                  ) : (
                    <input
                      lang="ja"
                      value={row.part2}
                      placeholder={shown.part2}
                      title="空欄のときは入力のある上の行を引き継ぎます"
                      onChange={(e) =>
                        editRows(
                          updateRow(rows, index, { part2: e.target.value }),
                        )
                      }
                    />
                  )}
                </td>
                <td className="flag">
                  {isSubtotal ? (
                    ""
                  ) : (
                    <input
                      type="checkbox"
                      checked={row.part2Split === 1}
                      title="集計時に部位Ⅱ別で仕分ける"
                      onChange={(e) =>
                        editRows(
                          updateRow(rows, index, {
                            part2Split: e.target.checked ? 1 : 0,
                          }),
                        )
                      }
                    />
                  )}
                </td>
                <td>
                  {isSubtotal ? (
                    ""
                  ) : (
                    <MasterCodeInput
                      entries={options.formworkCategories}
                      listId="formwork-list"
                      value={row.formwork}
                      title="型枠分類のIDを入力すると種類名に変換されます"
                      onChange={(value) =>
                        editRows(updateRow(rows, index, { formwork: value }))
                      }
                    />
                  )}
                </td>
                <td className={duplicated[index] ? "duplicate-room" : ""}>
                  {isSubtotal ? (
                    <span className="subtotal-label">
                      {row.part3 || "小計"}
                    </span>
                  ) : (
                    <>
                      {duplicated[index] && (
                        <span
                          className="duplicate-mark"
                          title="同じ部位Ⅰ＋部位Ⅱ＋部位Ⅲの行が他にもあります。集計は2部屋分になりますが、数量根拠では見分けられません"
                        >
                          ⚠
                        </span>
                      )}
                      <input
                        lang="ja"
                        value={row.part3}
                        onChange={(e) =>
                          editRows(
                            updateRow(rows, index, { part3: e.target.value }),
                          )
                        }
                      />
                    </>
                  )}
                </td>
                <td>
                  {isSubtotal
                    ? ""
                    : numberCell(
                        index,
                        row.ceilingHeight,
                        2,
                        parseNumber,
                        (value) => ({
                          ceilingHeight: value,
                        }),
                      )}
                </td>
                <td>
                  {isSubtotal
                    ? ""
                    : numberCell(
                        index,
                        row.multiplier,
                        0,
                        parseMultiplier,
                        (value) => ({
                          multiplier: value ?? 1,
                        }),
                      )}
                </td>
                <td>
                  {isSubtotal ? (
                    ""
                  ) : (
                    <select
                      value={row.calcType}
                      onChange={(e) => {
                        const filled =
                          row.id === null ? [] : (filledSheets[row.id] ?? []);
                        const picked = e.target.value;
                        if (!filled.includes(row.calcType)) {
                          editRows(
                            updateRow(rows, index, { calcType: picked }),
                          );
                          return;
                        }
                        const before = row.calcType;
                        e.target.value = before;
                        void ask(
                          "入力済みの計算書があります。種類を変えると集計に入らなくなります（中身は残ります）。変えますか？",
                        ).then((ok) => {
                          if (ok)
                            editRows(
                              updateRow(rows, index, { calcType: picked }),
                            );
                        });
                      }}
                    >
                      {options.calcSheets.map((sheet) => (
                        <option key={sheet.key} value={sheet.key}>
                          {sheet.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  {isSubtotal ? (
                    ""
                  ) : (
                    <input
                      lang="ja"
                      value={row.note}
                      onChange={(e) =>
                        editRows(
                          updateRow(rows, index, { note: e.target.value }),
                        )
                      }
                    />
                  )}
                </td>
                {checkColumns.flatMap((label) => {
                  // 小計行は部位ごとの合計だけを出す（名称は出さない）
                  const sum = partSums[index]?.[label];
                  const cell = isSubtotal ? null : checkOf(row.id, label);
                  return [
                    <td key={`n-${label}`} className="check">
                      {cell?.name ?? ""}
                    </td>,
                    <td key={`q-${label}`} className="check number">
                      {isSubtotal
                        ? sum === undefined
                          ? ""
                          : sum.toFixed(2)
                        : cell
                          ? cell.quantity.toFixed(2)
                          : ""}
                    </td>,
                  ];
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        部位Ⅰ・部位Ⅱは空欄なら入力のある上の行を引き継ぎます（薄い文字が引き継ぐ内容）。部位Ⅱ別仕訳に✔を付けた行は
        集計時に部位Ⅱ別で仕分けます（工種科目マスターで「部位Ⅱ分不要」の科目は仕分けません）。型枠は型枠分類のIDを
        入力すると種類名に変換します。倍率は部屋を入力した時点で1、−99〜99で指定できます。部屋名は記号を含めて自由に
        入力できます。
      </p>
    </div>
  );
}
