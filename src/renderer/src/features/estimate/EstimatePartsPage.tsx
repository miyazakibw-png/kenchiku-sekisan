import { useCallback, useEffect, useMemo, useState } from "react";
import type {
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
  emptyRow,
  formatNumber,
  insertRow,
  moveRow,
  parseMultiplier,
  parseNumber,
  removeRow,
  resolveInherited,
  subtotalRow,
  toDrafts,
  updateRow,
} from "./estimateRows";
import RoomSheetPage from "./RoomSheetPage";
import FrameSheetPage from "./FrameSheetPage";
import GeneralSheetPage from "./GeneralSheetPage";
import "./EstimatePartsPage.css";

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
  const [rows, setRows] = useState<EstimateRowDraft[]>([]);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [clipboard, setClipboard] = useState<EstimateRowDraft[]>([]);
  const [others, setOthers] = useState<ProjectSummary[] | null>(null);
  /** 計算書を開いている行（部位別入力表の行が1部屋＝1計算書） */
  const [openedSheet, setOpenedSheet] = useState<number | null>(null);
  /** チェック列に表示する材種区分（仕上以外でもチェックできる） */
  const [checkCategory, setCheckCategory] = useState(
    options.materialCategories[0]?.name ?? "仕上",
  );
  const columns = useMemo(
    () => buildEstimateColumns(options.formworkCategories),
    [options.formworkCategories],
  );
  const inherited = useMemo(() => resolveInherited(rows), [rows]);

  const reload = useCallback(async () => {
    setRows(toDrafts(await window.sekisan.listEstimateRows(project.id)));
  }, [project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async () => {
    const saved = await window.sekisan.saveEstimateRows({
      projectId: project.id,
      rows,
    });
    setRows(toDrafts(saved));
    setMessage("保存しました");
  }, [project.id, rows]);

  /** Excelの表をそのまま貼り付ける（選択行の部位Ⅰ列から取り込む） */
  const pasteFromExcel = useCallback(async () => {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    const preview = buildPastePreview(rows, columns, text, selected, 0, () =>
      emptyRow(),
    );
    setRows(preview.rows);
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

  /** 計算書は保存済みの行にしか作れないので、必要なら先に保存する */
  const openCalcSheet = useCallback(
    async (index: number) => {
      const row = rows[index];
      if (!row || row.rowType === "subtotal") return;
      if (row.id === null) {
        setRows(
          toDrafts(
            await window.sekisan.saveEstimateRows({
              projectId: project.id,
              rows,
            }),
          ),
        );
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
  ): JSX.Element => (
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
        setRows(updateRow(rows, index, apply(parsed.value)));
      }}
    />
  );

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

  if (openedSheet !== null && rows[openedSheet]) {
    return (
      <RoomSheetPage
        project={project}
        row={rows[openedSheet]}
        roomName={rows[openedSheet].part3}
        onBack={() => {
          setOpenedSheet(null);
          void reload();
        }}
      />
    );
  }

  return (
    <div className="estimate-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>部位別入力表</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button
          type="button"
          onClick={() => setRows(insertRow(rows, selected))}
        >
          ➕ 行挿入
        </button>
        <button
          type="button"
          onClick={() => setRows(insertRow(rows, rows.length))}
        >
          ⤓ 最終行に追加
        </button>
        <button
          type="button"
          onClick={() =>
            setRows([
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
          onClick={() => setRows(removeRow(rows, selected))}
        >
          🗑 行削除
        </button>
        <button
          type="button"
          onClick={() => {
            setRows(moveRow(rows, selected, selected - 1));
            setSelected(Math.max(selected - 1, 0));
          }}
        >
          ↑ 上へ
        </button>
        <button
          type="button"
          onClick={() => {
            setRows(moveRow(rows, selected, selected + 1));
            setSelected(Math.min(selected + 1, rows.length - 1));
          }}
        >
          ↓ 下へ
        </button>
        <button
          type="button"
          onClick={() => {
            setClipboard([rows[selected]].filter(Boolean));
            setMessage("1 行を控えました（行貼り込みで挿入）");
          }}
        >
          ⧉ 行コピー
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => {
            setRows(copyRowsInto(rows, selected + 1, clipboard));
            setMessage(`${clipboard.length} 行を貼り込みました`);
          }}
        >
          ⤵ 行貼り込み
        </button>
        <button type="button" onClick={() => void openOtherProjects()}>
          🏢 他物件から
        </button>
        <button type="button" onClick={() => void openCalcSheet(selected)}>
          📐 計算書を開く
        </button>
        <button type="button" onClick={() => void pasteFromExcel()}>
          📋 Excelから貼り付け
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
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
          床・巾木・壁・柱・梁・張天井・廻り縁は、その部屋の計算書で拾った
          {checkCategory}
          を表示します（計算書の作成後に反映）。
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

      <table className="grid estimate">
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
            {CHECK_COLUMNS.map((label) => (
              <th key={label} className="check" colSpan={2}>
                {label}
              </th>
            ))}
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
                    index === selected ? "selected" : "",
                    isSubtotal ? "subtotal" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onClick={() => setSelected(index)}
                onDoubleClick={() => void openCalcSheet(index)}
              >
                <td className="no">{index + 1}</td>
                <td>
                  <input
                    lang="ja"
                    value={row.part1}
                    placeholder={shown.part1}
                    title="空欄のときは入力のある上の行を引き継ぎます"
                    onChange={(e) =>
                      setRows(updateRow(rows, index, { part1: e.target.value }))
                    }
                  />
                </td>
                <td>
                  <input
                    lang="ja"
                    value={row.part2}
                    placeholder={shown.part2}
                    title="空欄のときは入力のある上の行を引き継ぎます"
                    onChange={(e) =>
                      setRows(updateRow(rows, index, { part2: e.target.value }))
                    }
                  />
                </td>
                <td className="flag">
                  <input
                    type="checkbox"
                    checked={row.part2Split === 1}
                    title="集計時に部位Ⅱ別で仕分ける"
                    onChange={(e) =>
                      setRows(
                        updateRow(rows, index, {
                          part2Split: e.target.checked ? 1 : 0,
                        }),
                      )
                    }
                  />
                </td>
                <td>
                  <MasterCodeInput
                    entries={options.formworkCategories}
                    listId="formwork-list"
                    value={row.formwork}
                    title="型枠分類のIDを入力すると種類名に変換されます"
                    onChange={(value) =>
                      setRows(updateRow(rows, index, { formwork: value }))
                    }
                  />
                </td>
                <td>
                  <input
                    lang="ja"
                    value={row.part3}
                    onChange={(e) =>
                      setRows(updateRow(rows, index, { part3: e.target.value }))
                    }
                  />
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
                  {numberCell(
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
                      onChange={(e) =>
                        setRows(
                          updateRow(rows, index, { calcType: e.target.value }),
                        )
                      }
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
                  <input
                    lang="ja"
                    value={row.note}
                    onChange={(e) =>
                      setRows(updateRow(rows, index, { note: e.target.value }))
                    }
                  />
                </td>
                {CHECK_COLUMNS.map((label) => (
                  <td key={label} className="check" colSpan={2} />
                ))}
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
