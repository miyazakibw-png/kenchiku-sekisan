import { useCallback, useEffect, useState } from "react";
import type {
  EstimateRow,
  FurnitureSheetSummary,
  ProjectSummary,
} from "@shared/types";
import {
  FURNITURE_KINDS as KINDS,
  furnitureKindLabel,
} from "../../../../core/furniture/furnitureSheet";
import { ask } from "../common/askDialog";
import OtherProjectSheetPicker from "./OtherProjectSheetPicker";
import "./EstimatePartsPage.css";
import "./MiscSheetListPage.css";

interface Props {
  project: ProjectSummary;
  onOpen: (sheetId: number) => void;
  onBack: () => void;
}

/**
 * 家具・設備入力表の管理表。
 * 1工事に何枚でも表を作り、ここから選んで開く。
 */
export default function FurnitureSheetListPage({
  project,
  onOpen,
  onBack,
}: Props): JSX.Element {
  const [sheets, setSheets] = useState<FurnitureSheetSummary[]>([]);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState(0);
  const [clipboard, setClipboard] = useState<number[]>([]);
  const [estimateRows, setEstimateRows] = useState<EstimateRow[]>([]);
  /** 他の物件から表を写す窓 */
  const [pickingOther, setPickingOther] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setSheets(await window.sekisan.listFurnitureSheets(project.id));
    setEstimateRows(await window.sekisan.listEstimateRows(project.id));
  }, [project.id]);

  /** 他の物件の表をこの物件の末尾に写す */
  const copyFromOther = async (sheetIds: number[]): Promise<void> => {
    setSheets(
      await window.sekisan.copyFurnitureSheetsFromProject(project.id, sheetIds),
    );
    setPickingOther(false);
    setMessage(
      `他の物件から ${sheetIds.length} 枚を写しました（いちばん下。建具表への転記は計算書を開いて保存したとき）`,
    );
  };

  const distinct = (values: string[]): string[] =>
    [...new Set(values.map((value) => value.trim()))].filter(
      (value) => value !== "",
    );
  const part1Options = distinct(estimateRows.map((row) => row.part1));
  const part2Options = (part1: string): string[] =>
    distinct(
      estimateRows
        .filter(
          (row) => part1.trim() === "" || row.part1.trim() === part1.trim(),
        )
        .map((row) => row.part2),
    );

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: FurnitureSheetSummary[]): Promise<void> => {
    setSheets(next);
    setSheets(await window.sekisan.saveFurnitureSheetList(project.id, next));
    setMessage("保存しました");
  };

  const add = async (): Promise<void> => {
    await window.sekisan.createFurnitureSheet(
      project.id,
      `家具計算書${sheets.length + 1}`,
      "furniture",
    );
    await load();
    setMessage("表を1枚足しました");
  };

  const remove = async (sheet: FurnitureSheetSummary): Promise<void> => {
    const ok = await ask(
      `「${sheet.name}」を消します。中の入力と建具表へ転記した分も消えます。よろしいですか。`,
    );
    if (!ok) return;
    await window.sekisan.deleteFurnitureSheet(sheet.id);
    await load();
    setMessage("表を消しました");
  };

  const move = async (index: number, step: number): Promise<void> => {
    const to = index + step;
    if (to < 0 || to >= sheets.length) return;
    const next = [...sheets];
    const moved = next.splice(index, 1)[0];
    next.splice(to, 0, moved);
    await save(next);
  };

  const selectionStart = Math.min(selected, selectedEnd);
  const selectionEnd = Math.max(selected, selectedEnd);

  const copy = (): void => {
    const copied = sheets
      .slice(selectionStart, selectionEnd + 1)
      .map((sheet) => sheet.id);
    if (copied.length === 0) return;
    setClipboard(copied);
    setMessage(
      `⧉ ${copied.length} 枚をコピーしました（貼り付けたい行にカーソルを置いて「挿入貼付」「追加貼付」）`,
    );
  };

  const paste = async (mode: "insert" | "append"): Promise<void> => {
    if (clipboard.length === 0) return;
    const at = mode === "insert" ? selectionStart : sheets.length;
    setSheets(
      await window.sekisan.pasteFurnitureSheets(project.id, clipboard, at),
    );
    setMessage(`${clipboard.length} 枚を貼り付けました（中の入力も写します）`);
  };

  const change = (
    index: number,
    patch: Partial<FurnitureSheetSummary>,
  ): void => {
    setSheets(
      sheets.map((sheet, at) =>
        at === index ? { ...sheet, ...patch } : sheet,
      ),
    );
  };

  return (
    <div className="estimate-page misc-list-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>家具・設備入力表（一覧）</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => void add()}>
          ➕ 表を足す
        </button>
        <button
          type="button"
          title="カーソルの行（Shift+クリックで選んだ範囲）の表を、中の入力ごとコピーします"
          onClick={copy}
        >
          ⧉ 表コピー（複数可）
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => void paste("insert")}
        >
          📋 挿入貼付
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => void paste("append")}
        >
          📋 追加貼付
        </button>
        <button
          type="button"
          title="他の物件の一覧から表を選んで、中の入力・設定ごとこの物件に写します"
          onClick={() => setPickingOther(true)}
        >
          🏢 他の物件から表コピー
        </button>
        <button type="button" onClick={() => void save(sheets)}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      {pickingOther && (
        <OtherProjectSheetPicker
          title="他の物件から表コピー（家具・設備入力表）"
          currentProjectId={project.id}
          listSheets={async (projectId) =>
            (await window.sekisan.listFurnitureSheets(projectId)).map(
              (sheet) => ({
                id: sheet.id,
                name: sheet.name,
                detail: [
                  furnitureKindLabel(sheet.kind),
                  [sheet.part1, sheet.part2]
                    .filter((text) => text.trim() !== "")
                    .join(" "),
                  `${sheet.rowCount}行`,
                ]
                  .filter((text) => text !== "")
                  .join("・"),
                note: sheet.note,
              }),
            )
          }
          onCopy={copyFromOther}
          onClose={() => setPickingOther(false)}
        />
      )}

      <table className="grid misc-list">
        <thead>
          <tr>
            <th className="ops">操作</th>
            <th className="no">No</th>
            <th className="name">表の名前（部位Ⅲ）</th>
            <th className="name">種類</th>
            <th className="name">部位Ⅰ</th>
            <th className="name">部位Ⅱ</th>
            <th className="count">仕訳</th>
            <th className="count">倍率</th>
            <th className="count">行数</th>
            <th className="note">メモ</th>
          </tr>
        </thead>
        <tbody>
          {sheets.map((sheet, index) => (
            <tr
              key={sheet.id}
              className={
                index >= selectionStart && index <= selectionEnd
                  ? "selected"
                  : ""
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
              <td className="ops">
                <button type="button" onClick={() => onOpen(sheet.id)}>
                  📂 開く
                </button>
                <button type="button" onClick={() => void move(index, -1)}>
                  ↑
                </button>
                <button type="button" onClick={() => void move(index, 1)}>
                  ↓
                </button>
                <button type="button" onClick={() => void remove(sheet)}>
                  🗑 消す
                </button>
              </td>
              <td className="no">{index + 1}</td>
              <td className="name">
                <input
                  lang="ja"
                  value={sheet.name}
                  onChange={(event) =>
                    change(index, { name: event.target.value })
                  }
                  onBlur={() => void save(sheets)}
                />
              </td>
              <td className="name">
                <select
                  value={sheet.kind}
                  onChange={(event) => {
                    change(index, { kind: event.target.value });
                  }}
                  onBlur={() => void save(sheets)}
                >
                  {KINDS.map((kind) => (
                    <option key={kind.key} value={kind.key}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="name">
                <input
                  lang="ja"
                  list="furniture-part1-options"
                  title="部位別入力表で入力済みの部位Ⅰから選べます（手で書いても可）"
                  value={sheet.part1}
                  onChange={(event) =>
                    change(index, { part1: event.target.value })
                  }
                  onBlur={() => void save(sheets)}
                />
              </td>
              <td className="name">
                <input
                  lang="ja"
                  list={`furniture-part2-options-${sheet.id}`}
                  title="部位別入力表で入力済みの部位Ⅱから選べます（部位Ⅰを入れるとその部位Ⅰの分だけ）"
                  value={sheet.part2}
                  onChange={(event) =>
                    change(index, { part2: event.target.value })
                  }
                  onBlur={() => void save(sheets)}
                />
                <datalist id={`furniture-part2-options-${sheet.id}`}>
                  {part2Options(sheet.part1).map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </td>
              <td className="count">
                <input
                  type="checkbox"
                  title="部位Ⅱ別に仕訳する"
                  checked={sheet.part2Split === 1}
                  onChange={(event) => {
                    const next = sheets.map((row, at) =>
                      at === index
                        ? { ...row, part2Split: event.target.checked ? 1 : 0 }
                        : row,
                    );
                    void save(next);
                  }}
                />
              </td>
              <td className="count">
                <input
                  className="num"
                  value={String(sheet.multiplier)}
                  onChange={(event) =>
                    change(index, {
                      multiplier: Number(event.target.value) || 0,
                    })
                  }
                  onBlur={() => void save(sheets)}
                />
              </td>
              <td className="count">{sheet.rowCount}</td>
              <td className="note">
                <input
                  lang="ja"
                  value={sheet.note}
                  onChange={(event) =>
                    change(index, { note: event.target.value })
                  }
                  onBlur={() => void save(sheets)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="furniture-part1-options">
        {part1Options.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </div>
  );
}
