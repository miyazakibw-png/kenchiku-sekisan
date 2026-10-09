import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EstimateRow,
  FurnitureSheet,
  FurnitureSheetSummary,
  ProjectSummary,
} from "@shared/types";
import {
  FURNITURE_KINDS as KINDS,
  furnitureKindLabel,
  isFittingDetailSheet,
} from "../../../../core/furniture/furnitureSheet";
import { ask } from "../common/askDialog";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import { useColumnWidths } from "./columnWidths";
import OtherProjectSheetPicker from "./OtherProjectSheetPicker";
import "./EstimatePartsPage.css";
import "./MiscSheetListPage.css";

/** 一覧の列（右端の「消す」列はボタンだけ置く空の見出し） */
const LIST_COLUMNS: {
  key: string;
  label: string;
  className: string;
  defaultWidth: number;
}[] = [
  { key: "ops", label: "操作", className: "ops", defaultWidth: 150 },
  { key: "no", label: "No", className: "no", defaultWidth: 40 },
  { key: "part1", label: "部位Ⅰ", className: "name", defaultWidth: 110 },
  { key: "part2", label: "部位Ⅱ", className: "name", defaultWidth: 110 },
  { key: "split", label: "仕訳", className: "count", defaultWidth: 50 },
  { key: "name", label: "表の名前（部位Ⅲ）", className: "name", defaultWidth: 170 },
  { key: "kind", label: "種類", className: "name", defaultWidth: 150 },
  { key: "multiplier", label: "倍率", className: "count", defaultWidth: 56 },
  { key: "rows", label: "行数", className: "count", defaultWidth: 50 },
  { key: "note", label: "メモ", className: "note", defaultWidth: 240 },
  { key: "del", label: "", className: "ops del", defaultWidth: 64 },
];

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
  const { widthOf, resizeAtEdge } = useColumnWidths(
    `furniture-list-widths:${project.id}`,
  );

  /** ↶戻る・↷進む用の履歴（一覧の行・並びをまとめて1つの履歴にする） */
  const history = useUndoRedo<FurnitureSheetSummary[]>();
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  /** 消した表の中身（↶戻るで作り直すために控える。ID→表全体） */
  const graves = useRef(new Map<number, FurnitureSheet>());
  /** 同じ欄への続けての入力を履歴1つにまとめるための目印 */
  const editKey = useRef<string | null>(null);
  /** 戻る・進むの途中（連打しても順番が崩れないよう一度に1つ） */
  const applying = useRef(false);

  /** 変更前の一覧を履歴へ積む（keyがあるときは同じ欄の連続入力を1つにまとめる） */
  const pushHistory = useCallback(
    (key?: string): void => {
      if (key !== undefined && editKey.current === key) return;
      history.push(sheetsRef.current);
      editKey.current = key ?? null;
    },
    [history],
  );

  const load = useCallback(async (): Promise<void> => {
    // 建具明細作成表は建具表の「建具明細作成」から開くので、ここの一覧には出さない
    setSheets(
      (await window.sekisan.listFurnitureSheets(project.id)).filter(
        (sheet) => !isFittingDetailSheet(sheet.kind),
      ),
    );
    setEstimateRows(await window.sekisan.listEstimateRows(project.id));
  }, [project.id]);

  /** 他の物件の表をこの物件の末尾に写す */
  const copyFromOther = async (sheetIds: number[]): Promise<void> => {
    pushHistory();
    setSheets(
      (
        await window.sekisan.copyFurnitureSheetsFromProject(
          project.id,
          sheetIds,
        )
      ).filter((sheet) => !isFittingDetailSheet(sheet.kind)),
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
    editKey.current = null;
    setSheets(next);
    setSheets(
      (await window.sekisan.saveFurnitureSheetList(project.id, next)).filter(
        (sheet) => !isFittingDetailSheet(sheet.kind),
      ),
    );
    setMessage("保存しました");
  };

  const add = async (): Promise<void> => {
    pushHistory();
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
    // 戻るで戻せるよう、消す前に表の中身を控える
    graves.current.set(
      sheet.id,
      await window.sekisan.getFurnitureSheet(sheet.id),
    );
    pushHistory();
    await window.sekisan.deleteFurnitureSheet(sheet.id);
    await load();
    setMessage("表を消しました（↶ 戻るで戻せます）");
  };

  const move = async (index: number, step: number): Promise<void> => {
    const to = index + step;
    if (to < 0 || to >= sheets.length) return;
    pushHistory();
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
    pushHistory();
    const at = mode === "insert" ? selectionStart : sheets.length;
    setSheets(
      (
        await window.sekisan.pasteFurnitureSheets(project.id, clipboard, at)
      ).filter((sheet) => !isFittingDetailSheet(sheet.kind)),
    );
    setMessage(`${clipboard.length} 枚を貼り付けました（中の入力も写します）`);
  };

  const change = (
    index: number,
    patch: Partial<FurnitureSheetSummary>,
  ): void => {
    const sheet = sheets[index];
    pushHistory(
      sheet === undefined
        ? undefined
        : `${sheet.id}:${Object.keys(patch).join(",")}`,
    );
    setSheets(
      sheets.map((sheet, at) =>
        at === index ? { ...sheet, ...patch } : sheet,
      ),
    );
  };

  /**
   * 履歴の一覧へ戻す・進める。履歴の後に足した表は消し（中身は控える）、
   * 履歴にある消した表は控えた中身から作り直す（IDは新しく振られ、履歴の中も合わせる）。
   */
  const applyList = useCallback(
    async (target: FurnitureSheetSummary[]): Promise<void> => {
      const currentIds = new Set(
        sheetsRef.current.map((sheet) => sheet.id),
      );
      const targetIds = new Set(target.map((sheet) => sheet.id));
      for (const sheet of sheetsRef.current) {
        if (targetIds.has(sheet.id)) continue;
        graves.current.set(
          sheet.id,
          await window.sekisan.getFurnitureSheet(sheet.id),
        );
        await window.sekisan.deleteFurnitureSheet(sheet.id);
      }
      const idMap = new Map<number, number>();
      for (const sheet of target) {
        if (currentIds.has(sheet.id)) continue;
        const grave = graves.current.get(sheet.id);
        const created = await window.sekisan.createFurnitureSheet(
          project.id,
          sheet.name,
          sheet.kind,
        );
        if (grave !== undefined) {
          await window.sekisan.saveFurnitureSheet({
            id: created.id,
            name: grave.name,
            part1: grave.part1,
            part2: grave.part2,
            part2Split: grave.part2Split,
            multiplier: grave.multiplier,
            kind: grave.kind,
            rowsJson: grave.rowsJson,
            columnsJson: grave.columnsJson,
            settingsJson: grave.settingsJson,
            note: grave.note,
          });
        }
        idMap.set(sheet.id, created.id);
      }
      const resolved = target.map((sheet) => ({
        ...sheet,
        id: idMap.get(sheet.id) ?? sheet.id,
      }));
      setSheets(
        (
          await window.sekisan.saveFurnitureSheetList(project.id, resolved)
        ).filter((sheet) => !isFittingDetailSheet(sheet.kind)),
      );
      if (idMap.size > 0) {
        history.map((snap) =>
          snap.map((sheet) => ({
            ...sheet,
            id: idMap.get(sheet.id) ?? sheet.id,
          })),
        );
      }
      setSelected((at) => Math.min(at, Math.max(resolved.length - 1, 0)));
      setSelectedEnd((at) => Math.min(at, Math.max(resolved.length - 1, 0)));
    },
    [history, project.id],
  );

  const undo = async (): Promise<void> => {
    if (applying.current) return;
    const previous = history.undo(sheetsRef.current);
    if (previous === null) {
      setMessage("戻せる操作がありません");
      return;
    }
    applying.current = true;
    try {
      await applyList(previous);
      setMessage("1つ前に戻しました");
    } finally {
      applying.current = false;
    }
  };

  const redo = async (): Promise<void> => {
    if (applying.current) return;
    const next = history.redo(sheetsRef.current);
    if (next === null) {
      setMessage("進める操作がありません");
      return;
    }
    applying.current = true;
    try {
      await applyList(next);
      setMessage("1つ先へ進めました");
    } finally {
      applying.current = false;
    }
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
        <button
          type="button"
          disabled={!history.canUndo}
          title="1つ前の内容に戻します（消した表も中身ごと戻ります）"
          onClick={() => void undo()}
        >
          ↶ 戻る
        </button>
        <button
          type="button"
          disabled={!history.canRedo}
          title="戻した内容を1つ先へ進めます"
          onClick={() => void redo()}
        >
          ↷ 進む
        </button>
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
            (await window.sekisan.listFurnitureSheets(projectId))
              .filter((sheet) => !isFittingDetailSheet(sheet.kind))
              .map((sheet) => ({
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
              }))
          }
          onCopy={copyFromOther}
          onClose={() => setPickingOther(false)}
        />
      )}

      <table className="grid misc-list">
        <colgroup>
          {LIST_COLUMNS.map((column) => (
            <col
              key={column.key}
              style={{ width: widthOf(column.key, column.defaultWidth) }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {LIST_COLUMNS.map((column) => (
              <th
                key={column.key}
                className={column.className}
                title="右端をドラッグして列の幅を変えます"
                onMouseDown={(event) =>
                  resizeAtEdge(column.key, column.defaultWidth, event)
                }
              >
                <span className="cellbox">
                  {column.label}
                  <span className="resizer" />
                </span>
              </th>
            ))}
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
              </td>
              <td className="no">{index + 1}</td>
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
              <td className="ops del">
                <button type="button" onClick={() => void remove(sheet)}>
                  🗑 消す
                </button>
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
