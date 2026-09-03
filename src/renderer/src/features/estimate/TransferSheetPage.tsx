import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Detail,
  EstimateRow,
  MasterOptions,
  ProjectSummary,
  TransferRowDraft,
} from "@shared/types";
import { resolveMasterName } from "@shared/masters";
import MasterCodeInput, {
  MasterCodeOptions,
} from "../../components/MasterCodeInput";
import PickInput, { type PickEntry } from "../../components/PickInput";
import { buildPastePreview } from "../grid/gridClipboard";
import {
  applyDetail,
  applyEstimateParts,
  buildTransferColumns,
  emptyTransferRow,
  formatQuantity,
  insertTransferRow,
  parseQuantity,
  removeTransferRow,
  resolveTransferInherited,
  toTransferDrafts,
  updateTransferRow,
} from "./transferRows";
import "./EstimatePartsPage.css";
import "./TransferSheetPage.css";
import { useTableResize } from "../../hooks/useTableResize";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { useRowsHistory } from "../../hooks/useRowsHistory";

interface Props {
  project: ProjectSummary;
  options: MasterOptions;
  onBack: () => void;
}

type CallSource = "basic" | "project";

const SOURCE_LABEL: Record<CallSource, string> = {
  basic: "基本マスター（明細）",
  project: "物件専用マスター（明細）",
};

export default function TransferSheetPage({
  project,
  options,
  onBack,
}: Props): JSX.Element {
  const tableRef = useTableResize("table-widths-transfer-sheet-v1");
  const [rows, setRows] = useState<TransferRowDraft[]>([]);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [callOpen, setCallOpen] = useState(false);
  const [source, setSource] = useState<CallSource>("basic");
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);
  const [partsOpen, setPartsOpen] = useState(false);
  const [estimateRows, setEstimateRows] = useState<EstimateRow[]>([]);
  /** 明細IDで呼び出すための明細マスター（科目ごとに一度だけ読む） */
  const [detailCache, setDetailCache] = useState<Record<number, Detail[]>>({});

  const history = useRowsHistory(rows, setRows);

  const inherited = useMemo(() => resolveTransferInherited(rows), [rows]);

  const { markSaved } = useSaveOnLeave(rows, () => save(true));

  const reload = useCallback(async () => {
    const next = toTransferDrafts(
      await window.sekisan.listTransferRows(project.id),
    );
    setRows(next);
    markSaved(next);
  }, [markSaved, project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!callOpen || subjectId === null) {
      setDetails([]);
      return;
    }
    void (async () =>
      setDetails(
        source === "project"
          ? await window.sekisan.listProjectDetailsInUse(subjectId, project.id)
          : await window.sekisan.listDetails(subjectId, project.id),
      ))();
  }, [callOpen, project.id, source, subjectId]);

  const save = useCallback(
    async (quiet = false) => {
      const saved = await window.sekisan.saveTransferRows({
        projectId: project.id,
        rows,
      });
      const next = toTransferDrafts(saved);
      setRows(next);
      markSaved(next);
      if (quiet) return;
      setMessage("保存しました（集計書兼工事マスターに計上します）");
    },
    [markSaved, project.id, rows],
  );

  /** 部位別入力表に入力した部位（A〜G）を呼び出して転記する */
  const openParts = useCallback(async () => {
    setEstimateRows(
      (await window.sekisan.listEstimateRows(project.id)).filter(
        (row) => row.rowType !== "subtotal",
      ),
    );
    setPartsOpen(true);
  }, [project.id]);

  const update = useCallback(
    (index: number, patch: Partial<TransferRowDraft>): void =>
      history.edit((current) => updateTransferRow(current, index, patch)),
    [history],
  );

  const callDetail = useCallback(
    (detail: Detail) => {
      history.edit((current) => {
        if (current.length === 0) {
          return [applyDetail(emptyTransferRow(), detail)];
        }
        const at = Math.min(selected, current.length - 1);
        return current.map((row, index) =>
          index === at ? applyDetail(row, detail) : row,
        );
      });
      setMessage(`${detail.name} を転記しました`);
    },
    [history, selected],
  );

  /**
   * 明細IDを打って明細マスターから呼び出す。
   * 科目（打った行、無ければ上の行から引き継いだ科目）の明細を探す。
   */
  const callDetailNumber = useCallback(
    async (index: number, subject: number | null, text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") {
        update(index, { detailNumber: null });
        return;
      }
      const parsed = Number.parseFloat(trimmed);
      if (Number.isNaN(parsed)) {
        setMessage("明細IDは数字で入れてください");
        return;
      }
      update(index, { detailNumber: parsed });
      if (subject === null) {
        setMessage("科目IDを先に入れてください（明細を探せません）");
        return;
      }
      const list =
        detailCache[subject] ??
        (await window.sekisan.listDetails(subject, project.id));
      setDetailCache((current) => ({ ...current, [subject]: list }));
      const found = list.find((detail) => detail.detailNumber === parsed);
      if (!found) {
        setMessage(`明細ID ${trimmed} は科目 ${subject} にありません`);
        return;
      }
      history.edit((current) =>
        current.map((row, at) =>
          at === index ? applyDetail(row, found) : row,
        ),
      );
      setMessage(`${found.name} を呼び出しました`);
    },
    [detailCache, history, project.id, update],
  );

  const materialEntries = useMemo(
    () =>
      options.materialCategories.map((item) => ({
        id: item.id,
        name: item.name,
      })),
    [options.materialCategories],
  );
  const unitEntries = useMemo(
    () => options.units.map((unit) => ({ id: unit.id, name: unit.name })),
    [options.units],
  );
  const subjectEntries: PickEntry[] = useMemo(
    () =>
      options.subjects.map((subject) => ({
        value: String(subject.id),
        label: subject.name,
      })),
    [options.subjects],
  );

  const pasteColumns = useMemo(
    () =>
      buildTransferColumns(materialEntries, unitEntries, options.pickupParts),
    [materialEntries, options.pickupParts, unitEntries],
  );

  /** エクセルの表をそのまま貼り付ける（選んでいる行の科目ID列から取り込む） */
  const pasteFromExcel = useCallback(async () => {
    const text = await navigator.clipboard.readText();
    if (text.trim() === "") return;
    const preview = buildPastePreview(
      rows,
      pasteColumns,
      text,
      Math.min(selected, Math.max(rows.length - 1, 0)),
      0,
      () => emptyTransferRow(),
    );
    history.edit(preview.rows);
    const notes = [
      `${preview.addedRows} 行追加`,
      preview.errorCount > 0 ? `取り込めない値 ${preview.errorCount} 件` : "",
    ].filter((note) => note !== "");
    setMessage(`貼り付けました（${notes.join("／")}）`);
  }, [history, pasteColumns, rows, selected]);

  return (
    <div className="estimate-page transfer-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>転記入力表</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button
          type="button"
          disabled={!history.canUndo}
          title="1つ前の内容に戻します"
          onClick={() => {
            setMessage(
              history.undo()
                ? "1つ前に戻しました（保存すると確定します）"
                : "戻せる操作がありません",
            );
          }}
        >
          ↶ 戻る
        </button>
        <button
          type="button"
          disabled={!history.canRedo}
          title="戻した内容を1つ先へ進めます"
          onClick={() => {
            setMessage(
              history.redo()
                ? "1つ先へ進めました（保存すると確定します）"
                : "進める操作がありません",
            );
          }}
        >
          ↷ 進む
        </button>
        <button
          type="button"
          onClick={() => history.edit(insertTransferRow(rows, selected))}
        >
          ➕ 行挿入
        </button>
        <button
          type="button"
          onClick={() => history.edit(insertTransferRow(rows, rows.length))}
        >
          ⤓ 最終行に追加
        </button>
        <button
          type="button"
          onClick={() => history.edit(removeTransferRow(rows, selected))}
        >
          🗑 行削除
        </button>
        <button type="button" onClick={() => void openParts()}>
          📄 部位別入力表から
        </button>
        <button
          type="button"
          className={callOpen ? "on" : ""}
          onClick={() => setCallOpen(!callOpen)}
        >
          📂 マスター呼出
        </button>
        <button
          type="button"
          title="エクセルでコピーした表を、選んでいる行の科目IDから取り込みます（列の順番：科目ID・仕上区分・部位ID・明細ID・部位名・名称・摘要上・摘要下・数量・単位・備考上・備考下）"
          onClick={() => void pasteFromExcel()}
        >
          📋 エクセルから貼付
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      <MasterCodeOptions
        entries={options.formworkCategories}
        listId="transfer-formwork"
      />
      <MasterCodeOptions
        entries={materialEntries}
        listId="transfer-materials"
      />
      <MasterCodeOptions entries={unitEntries} listId="transfer-units" />
      <MasterCodeOptions
        entries={options.pickupParts}
        listId="transfer-parts"
      />

      {partsOpen && (
        <div className="call-window">
          <div className="section-bar">
            <span>部位別入力表から呼び出す部位（A〜G）</span>
            <button type="button" onClick={() => setPartsOpen(false)}>
              ✕ 閉じる
            </button>
          </div>
          <ul className="call-list">
            {estimateRows.map((row) => (
              <li
                key={row.id}
                tabIndex={0}
                onDoubleClick={() => {
                  setRows((current) =>
                    current.map((item, index) =>
                      index === selected ? applyEstimateParts(item, row) : item,
                    ),
                  );
                  setMessage(`${row.part2} ${row.part3} の部位を転記しました`);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  setRows((current) =>
                    current.map((item, index) =>
                      index === selected ? applyEstimateParts(item, row) : item,
                    ),
                  );
                }}
              >
                <span className="scope">{row.part1}</span>
                <span className="part">{row.part2}</span>
                <span className="name">{row.part3}</span>
                <span className="count">{row.formwork}</span>
              </li>
            ))}
          </ul>
          <p className="note">
            ダブルクリック（またはEnter）で選んでいる行に部位Ⅰ〜Ⅲ・型枠・部位Ⅱ別仕訳を転記します。
          </p>
        </div>
      )}

      {callOpen && (
        <div className="call-window">
          <div className="section-bar">
            <span>マスター呼出（1明細ずつ。セット明細は呼び出しません）</span>
            {(Object.keys(SOURCE_LABEL) as CallSource[]).map((key) => (
              <button
                key={key}
                type="button"
                className={source === key ? "on" : ""}
                onClick={() => setSource(key)}
              >
                {SOURCE_LABEL[key]}
              </button>
            ))}
            <button type="button" onClick={() => setCallOpen(false)}>
              ✕ 閉じる
            </button>
          </div>
          <div className="call-subject">
            <span>工種科目（番号で入力）</span>
            <input
              list="transfer-subjects"
              onChange={(e) => {
                const text = e.target.value.trim();
                const found =
                  options.subjects.find(
                    (subject) => String(subject.id) === text,
                  ) ??
                  options.subjects.find((subject) => subject.name === text);
                setSubjectId(found?.id ?? null);
              }}
            />
            <datalist id="transfer-subjects">
              {options.subjects.map((subject) => (
                <option key={subject.id} value={subject.name}>
                  {subject.id}
                </option>
              ))}
            </datalist>
          </div>
          <ul className="call-list">
            {details.map((detail, detailIndex) => (
              <li
                key={`${detail.id}-${detailIndex}`}
                tabIndex={0}
                onDoubleClick={() => callDetail(detail)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") callDetail(detail);
                }}
              >
                <span className="scope">
                  {detail.detailNumber?.toFixed(2) ?? ""}
                </span>
                <span className="part">{detail.partName}</span>
                <span className="name">{detail.name}</span>
                <span className="count">{detail.unit}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <table className="grid transfer" ref={tableRef}>
        <thead>
          <tr>
            <th className="no">No</th>
            <th className="part">部位Ⅰ</th>
            <th className="part">部位Ⅱ</th>
            <th className="flag">部位Ⅱ別仕訳</th>
            <th className="formwork">型枠</th>
            <th className="room">部位Ⅲ</th>
            <th className="subject">科目ID</th>
            <th className="material">仕上区分</th>
            <th className="no" title="上段に部位ID、下段に明細ID">
              部位ID／明細ID
            </th>
            <th className="name">部位名／名称</th>
            <th>摘要</th>
            <th className="num">数量</th>
            <th className="unit">単位</th>
            <th className="num future" title="将来用（単価）">
              単価
            </th>
            <th className="num future" title="将来用（金額）">
              金額
            </th>
            <th>備考</th>
            <th className="memo" title="どこにも連動しないメモ">
              メモ
            </th>
          </tr>
        </thead>
        {rows.map((row, index) => {
          const shown = inherited[index];
          const isSelected = index === selected;
          return (
            <tbody
              key={row.id ?? `new-${index}`}
              className={isSelected ? "row selected" : "row"}
              onClick={() => setSelected(index)}
            >
              <tr className="detail-upper">
                <td className="no" rowSpan={2}>
                  {index + 1}
                </td>
                <td rowSpan={2}>
                  <input
                    lang="ja"
                    value={row.part1}
                    placeholder={shown.part1}
                    title="空欄のときは入力のある上の行を引き継ぎます"
                    onChange={(e) => update(index, { part1: e.target.value })}
                  />
                </td>
                <td rowSpan={2}>
                  <input
                    lang="ja"
                    value={row.part2}
                    placeholder={shown.part2}
                    title="空欄のときは入力のある上の行を引き継ぎます"
                    onChange={(e) => update(index, { part2: e.target.value })}
                  />
                </td>
                <td className="flag" rowSpan={2}>
                  <input
                    type="checkbox"
                    checked={row.part2Split === 1}
                    title="集計時に部位Ⅱ別で仕分ける"
                    onChange={(e) =>
                      update(index, { part2Split: e.target.checked ? 1 : 0 })
                    }
                  />
                </td>
                <td rowSpan={2}>
                  <MasterCodeInput
                    entries={options.formworkCategories}
                    listId="transfer-formwork"
                    value={row.formwork}
                    title="型枠分類のIDを入力すると種類名に変換されます"
                    onChange={(value) => update(index, { formwork: value })}
                  />
                </td>
                <td rowSpan={2}>
                  <input
                    lang="ja"
                    value={row.part3}
                    placeholder={shown.part3}
                    onChange={(e) => update(index, { part3: e.target.value })}
                  />
                </td>
                <td className="subject" rowSpan={2}>
                  <PickInput
                    entries={subjectEntries}
                    value={row.subjectId === null ? "" : String(row.subjectId)}
                    placeholder={
                      shown.subjectId === null
                        ? "番号"
                        : String(shown.subjectId)
                    }
                    title={
                      options.subjects.find(
                        (subject) => subject.id === row.subjectId,
                      )?.name ?? "工種科目のID（一覧から選べます）"
                    }
                    onCommit={(value) => {
                      const parsed = Number.parseInt(value.trim(), 10);
                      update(index, {
                        subjectId: Number.isNaN(parsed) ? null : parsed,
                      });
                    }}
                  />
                </td>
                <td className="material" rowSpan={2}>
                  <input
                    lang="ja"
                    list="transfer-materials"
                    value={row.materialCategory}
                    placeholder={shown.materialCategory}
                    onChange={(e) =>
                      update(index, {
                        materialCategory: resolveMasterName(
                          materialEntries,
                          e.target.value,
                        ),
                      })
                    }
                  />
                </td>
                <td className="no">
                  <input
                    className="num"
                    value={row.partId === null ? "" : String(row.partId)}
                    onChange={(e) => {
                      const text = e.target.value.trim();
                      const parsed = Number.parseInt(text, 10);
                      const id = Number.isNaN(parsed) ? null : parsed;
                      const part = options.pickupParts.find(
                        (item) => item.id === id,
                      );
                      update(index, {
                        partId: id,
                        partName: part ? part.name : row.partName,
                      });
                    }}
                  />
                </td>
                <td>
                  <input
                    lang="ja"
                    list="transfer-parts"
                    value={row.partName}
                    onChange={(e) =>
                      update(index, { partName: e.target.value })
                    }
                  />
                </td>
                <td>
                  <input
                    lang="ja"
                    value={row.descriptionUpper}
                    onChange={(e) =>
                      update(index, { descriptionUpper: e.target.value })
                    }
                  />
                </td>
                <td className="num" />
                <td className="unit" />
                <td className="num future" />
                <td className="num future" />
                <td>
                  <input
                    lang="ja"
                    value={row.remarks}
                    title="備考の上段"
                    onChange={(e) => update(index, { remarks: e.target.value })}
                  />
                </td>
                <td className="memo" rowSpan={2}>
                  <input
                    lang="ja"
                    value={row.memo}
                    title="ここに書くだけで、どこにも連動しません"
                    onChange={(e) => update(index, { memo: e.target.value })}
                  />
                </td>
              </tr>
              <tr className="detail-lower">
                <td className="no">
                  <input
                    className="num"
                    key={`d-${index}-${row.detailNumber ?? ""}`}
                    defaultValue={
                      row.detailNumber === null
                        ? ""
                        : row.detailNumber.toFixed(2)
                    }
                    title="明細IDを入れると、その科目の明細マスターから名称・摘要・単位を呼び出します"
                    onBlur={(e) =>
                      void callDetailNumber(
                        index,
                        row.subjectId ?? shown.subjectId,
                        e.target.value,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    lang="ja"
                    value={row.name}
                    onChange={(e) => update(index, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    lang="ja"
                    value={row.descriptionLower}
                    onChange={(e) =>
                      update(index, { descriptionLower: e.target.value })
                    }
                  />
                </td>
                <td className="num">
                  <input
                    className="num"
                    key={`q-${index}-${formatQuantity(row.quantity)}`}
                    defaultValue={formatQuantity(row.quantity)}
                    onBlur={(e) => {
                      const parsed = parseQuantity(e.target.value);
                      if (parsed.error) {
                        setMessage(parsed.error);
                        return;
                      }
                      update(index, { quantity: parsed.value });
                    }}
                  />
                </td>
                <td className="unit">
                  <input
                    list="transfer-units"
                    value={row.unit}
                    onChange={(e) =>
                      update(index, {
                        unit: resolveMasterName(unitEntries, e.target.value),
                      })
                    }
                  />
                </td>
                <td className="num future" title="将来用（単価）" />
                <td className="num future" title="将来用（金額）" />
                <td>
                  <input
                    lang="ja"
                    value={row.remarksLower}
                    title="備考の下段"
                    onChange={(e) =>
                      update(index, { remarksLower: e.target.value })
                    }
                  />
                </td>
              </tr>
            </tbody>
          );
        })}
      </table>

      <p className="hint">
        Ａ〜Ｉ（部位Ⅰ〜部位Ⅲ・型枠・科目ID・仕上区分）は入力が無ければ入力のある上の行と同じ扱いです（薄い文字が引き継ぐ内容）。
        明細は全て1明細入力で、セット明細は呼び出しません。単価・金額は将来用の空欄です。メモはどこにも連動しません。
        ここで入力したものは集計書兼工事マスターにのみ計上し、根拠集計には出しません。
      </p>
    </div>
  );
}
