import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AssemblyMasterOptions,
  Detail,
  FinishAssembly,
  Subject,
} from "@shared/types";
import { formatDetailNumber } from "@shared/detailNumber";
import { assemblySignature } from "@shared/assemblySignature";
import { groupAssembliesByHead } from "../../../../core/masters/assemblyGroup";
import UnitInput, { UnitOptions } from "../../components/UnitInput";
import MasterCodeInput, {
  MasterCodeOptions,
} from "../../components/MasterCodeInput";
import {
  addItem,
  createEmptyItem,
  filterBySubject,
  headItem,
  moveItem,
  removeItem,
  sortAssemblies,
  toAssemblyItems,
  toDraftItems,
  updateCoefficientInput,
  updateItem,
  updateNumberInput,
  type DraftItem,
} from "./assemblyEditor";
import "./AssemblyMasterPage.css";
import { useTableResize } from "../../hooks/useTableResize";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";

interface Props {
  options: AssemblyMasterOptions;
  /** 物件専用のセット明細を扱うときの工事ID（null は基準マスター） */
  projectId?: number | null;
  /** 工事管理画面から開いたときの戻り先 */
  onBack?: () => void;
}

interface EditorState {
  /** 既存セットのID。新規は null */
  id: number | null;
  note: string;
  items: DraftItem[];
}

/** 統合確認（内容がまったく同じセットができた場合） */
interface MergeState {
  keepId: number;
  mergedId: number;
  message: string;
}

export default function AssemblyMasterPage({
  options,
  projectId = null,
  onBack,
}: Props): JSX.Element {
  const tableRef = useTableResize("table-widths-assembly-list-v1");
  const [assemblies, setAssemblies] = useState<FinishAssembly[]>([]);
  const [subject, setSubject] = useState<Subject | null>(
    options.subjects[0] ?? null,
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [picker, setPicker] = useState<Detail[] | null>(null);
  /** 1行目が同じセットが複数あるときに、どれを開くか選ぶ一覧 */
  const [chooser, setChooser] = useState<FinishAssembly[]>([]);
  const [merge, setMerge] = useState<MergeState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { markSaved, isDirty } = useSaveOnLeave(editor, () => save(true));

  const reload = useCallback(async () => {
    setAssemblies(await window.sekisan.listAssemblies(projectId));
  }, [projectId]);

  useEffect(() => {
    void reload();
    markSaved(null);
  }, [markSaved, reload]);

  const subjectOrderById = useMemo(
    () => new Map(options.subjects.map((s) => [s.id, s.displayOrder])),
    [options.subjects],
  );

  /** 科目で絞り込んだうえで、共通ソートキーによる昇順（切替なし） */
  const visible = useMemo(
    () =>
      sortAssemblies(
        filterBySubject(assemblies, subject?.id ?? null),
        subjectOrderById,
        options.units,
        options.materialCategories,
      ),
    [
      assemblies,
      subject,
      subjectOrderById,
      options.units,
      options.materialCategories,
    ],
  );

  /** 1行目が同じセットは1行にまとめて見せる */
  const groups = useMemo(() => groupAssembliesByHead(visible), [visible]);

  // 科目を変えたら、セットを選ぶ画面は閉じる
  useEffect(() => {
    setChooser([]);
  }, [subject]);

  const openPicker = useCallback(async () => {
    if (!subject) return;
    setPicker(await window.sekisan.listDetails(subject.id, projectId));
  }, [projectId, subject]);

  /** 明細マスターから内容を写し取る（参照ではなく複製なので以後は連動しない） */
  const pickDetail = useCallback(async (detail: Detail) => {
    const item = await window.sekisan.buildAssemblyItem(detail.id);
    const [draft] = toDraftItems([item]);
    setPicker(null);
    setEditor((prev) =>
      prev === null
        ? { id: null, note: "", items: [draft] }
        : { ...prev, items: addItem(prev.items, draft) },
    );
  }, []);

  const save = useCallback(
    async (quiet = false) => {
      if (!editor) return;
      const items = toAssemblyItems(editor.items);
      const before = assemblies.find((a) => a.id === editor.id);
      // 直した明細が他のセットでも使われているときは、どちらを直すか選んでもらう
      const changedKeys = (before?.items ?? []).flatMap((old, index) => {
        const next = items[index];
        if (!next) return [];
        const key = assemblySignature([old]);
        return key === assemblySignature([next]) ? [] : [key];
      });
      const sharing = assemblies.filter(
        (other) =>
          other.id !== editor.id &&
          other.items.some((item) =>
            changedKeys.includes(assemblySignature([item])),
          ),
      );
      // 画面を離れるときの自動保存では確認を出さず、このセットだけ直す
      const applyToAllSets =
        !quiet &&
        sharing.length > 0 &&
        window.confirm(
          `直した明細は他の${sharing.length}件のセットでも使われています。\n` +
            "［OK］この明細を使う全セットを直す\n［キャンセル］このセットだけ直す",
        );
      const result = await window.sekisan.saveAssembly({
        id: editor.id,
        scope: projectId === null ? "basic" : "project",
        projectId,
        note: editor.note,
        items,
        propagate: true,
        applyToAllSets,
      });
      await reload();
      setEditor(null);
      markSaved(null);
      setSelectedId(result.assembly.id);
      if (quiet) return;
      if (result.duplicateOf) {
        setMerge({
          keepId: result.duplicateOf.id,
          mergedId: result.assembly.id,
          message: `既に同じ内容のセットがあります（${headItem(result.duplicateOf)?.name ?? ""}）。既存セットへ統合しますか。`,
        });
      } else {
        setToast(
          result.syncedSets === 0
            ? "保存しました"
            : `保存しました（計算書の${result.syncedSets}セットも直しました）`,
        );
      }
    },
    [assemblies, editor, markSaved, projectId, reload],
  );

  const openEditor = useCallback(
    async (assembly: FinishAssembly) => {
      // 直したまま別のセットへ移るときは先に保存する
      if (isDirty()) await save(true);
      const next: EditorState = {
        id: assembly.id,
        note: assembly.note,
        items: toDraftItems(assembly.items),
      };
      setSelectedId(assembly.id);
      setEditor(next);
      markSaved(next);
    },
    [isDirty, markSaved, save],
  );

  const applyMerge = useCallback(async () => {
    if (!merge) return;
    await window.sekisan.mergeAssemblies(merge.keepId, merge.mergedId);
    setMerge(null);
    setSelectedId(merge.keepId);
    await reload();
    setToast("同じ内容のセットへ統合しました");
  }, [merge, reload]);

  const editItems = useCallback(
    (next: DraftItem[]) =>
      setEditor((prev) => (prev === null ? prev : { ...prev, items: next })),
    [],
  );

  return (
    <div className="assembly-page">
      <aside className="assembly-tree">
        <div className="tree-title">工種科目</div>
        {options.subjects.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`tree-item ${subject?.id === s.id ? "active" : ""}`}
            onClick={() => setSubject(s)}
          >
            {s.code} {s.name}
          </button>
        ))}
      </aside>

      <section className="assembly-main">
        <div className="toolbar">
          <h2>
            仕上明細セットマスター
            {projectId === null ? "" : "（この工事専用）"}
          </h2>
          {onBack && (
            <button type="button" onClick={onBack}>
              ← 工事管理画面へ
            </button>
          )}
          <button
            type="button"
            onClick={() => void openPicker()}
            disabled={!subject}
          >
            ➕ 新規セット（明細マスターから）
          </button>
          <span className="hint">
            1行目が同じセットは1行にまとめています。ダブルクリック／Enterで中のセットを出します
          </span>
          <span className="status">{toast ?? ""}</span>
        </div>

        <div className="assembly-body">
          <table className="grid assembly-list" ref={tableRef}>
            <thead>
              <tr>
                <th>No.</th>
                <th>材種区分</th>
                <th>部位番号／明細番号</th>
                <th>部位名／名称</th>
                <th>摘要</th>
                <th>単位</th>
                <th>掛け率</th>
                <th>備考</th>
                <th>セット</th>
              </tr>
            </thead>
            {groups.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={9} className="empty">
                    この科目のセットはまだありません
                  </td>
                </tr>
              </tbody>
            ) : (
              groups.map((group, index) => {
                const assembly = group.list[0];
                const head = headItem(assembly);
                if (!head) return null;
                // 同じ行のセットが複数あるときだけ、中身を見て選ぶ
                const open = (): void => {
                  if (group.list.length === 1) void openEditor(assembly);
                  else setChooser(group.list);
                };
                return (
                  <tbody
                    key={group.key}
                    className={`detail-group ${group.list.some((a) => a.id === selectedId) ? "selected" : ""}`}
                    tabIndex={0}
                    onClick={() => setSelectedId(assembly.id)}
                    onDoubleClick={open}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") open();
                    }}
                  >
                    <tr className="upper-row">
                      <td rowSpan={2}>{index + 1}</td>
                      <td rowSpan={2}>{head.materialCategory}</td>
                      <td className="num">
                        {formatDetailNumber(head.partNumber)}
                      </td>
                      <td>{head.partName}</td>
                      <td>{head.descriptionUpper}</td>
                      <td rowSpan={2}>{head.unit}</td>
                      <td rowSpan={2} className="num">
                        {head.coefficient}
                      </td>
                      <td>{head.remarksUpper}</td>
                      <td rowSpan={2} className="num">
                        {group.list.length === 1
                          ? `${assembly.items.length}明細`
                          : `${group.list.length}種類`}
                      </td>
                    </tr>
                    <tr>
                      <td className="num">
                        {formatDetailNumber(head.detailNumber)}
                      </td>
                      <td>{head.name}</td>
                      <td>{head.descriptionLower}</td>
                      <td>{head.remarksLower}</td>
                    </tr>
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </section>

      {editor && (
        <div className="modal-backdrop" role="dialog">
          <div className="modal assembly-editor">
            <header>
              <h3>セット明細{editor.id === null ? "（新規）" : ""}</h3>
              <label className="note">
                備考
                <input
                  lang="ja"
                  value={editor.note}
                  onChange={(e) =>
                    setEditor((prev) =>
                      prev === null ? prev : { ...prev, note: e.target.value },
                    )
                  }
                />
              </label>
            </header>

            <div className="modal-body">
              <table className="grid">
                <thead>
                  <tr>
                    <th>行</th>
                    <th>材種区分</th>
                    <th>部位番号／明細番号</th>
                    <th>部位名／名称</th>
                    <th>摘要</th>
                    <th>単位</th>
                    <th>掛け率</th>
                    <th>備考</th>
                    <th>操作</th>
                  </tr>
                </thead>
                {editor.items.map((item, index) => (
                  <tbody key={item.key} className="detail-group">
                    <tr className="upper-row">
                      <td rowSpan={2}>{index + 1}</td>
                      <td rowSpan={2}>
                        <MasterCodeInput
                          entries={options.materialCategories}
                          listId="material-category-options"
                          value={item.materialCategory}
                          onChange={(value) =>
                            editItems(
                              updateItem(editor.items, index, {
                                materialCategory: value,
                              }),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          value={item.partNumberInput}
                          onChange={(e) =>
                            editItems(
                              updateNumberInput(
                                editor.items,
                                index,
                                "partNumber",
                                e.target.value,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          lang="ja"
                          value={item.partName}
                          onChange={(e) =>
                            editItems(
                              updateItem(editor.items, index, {
                                partName: e.target.value,
                              }),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          lang="ja"
                          value={item.descriptionUpper}
                          onChange={(e) =>
                            editItems(
                              updateItem(editor.items, index, {
                                descriptionUpper: e.target.value,
                              }),
                            )
                          }
                        />
                      </td>
                      <td rowSpan={2}>
                        <UnitInput
                          units={options.units}
                          value={item.unit}
                          onChange={(value) =>
                            editItems(
                              updateItem(editor.items, index, { unit: value }),
                            )
                          }
                        />
                      </td>
                      <td rowSpan={2}>
                        <input
                          className="num"
                          value={item.coefficientInput}
                          onChange={(e) =>
                            editItems(
                              updateCoefficientInput(
                                editor.items,
                                index,
                                e.target.value,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          lang="ja"
                          value={item.remarksUpper}
                          onChange={(e) =>
                            editItems(
                              updateItem(editor.items, index, {
                                remarksUpper: e.target.value,
                              }),
                            )
                          }
                        />
                      </td>
                      <td rowSpan={2} className="ops">
                        <button
                          type="button"
                          title="上へ"
                          onClick={() =>
                            editItems(moveItem(editor.items, index, index - 1))
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="下へ"
                          onClick={() =>
                            editItems(moveItem(editor.items, index, index + 1))
                          }
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          title="この明細を削除（最低1明細は残ります）"
                          disabled={editor.items.length <= 1}
                          onClick={() =>
                            editItems(removeItem(editor.items, index))
                          }
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <input
                          className="num"
                          value={item.detailNumberInput}
                          onChange={(e) =>
                            editItems(
                              updateNumberInput(
                                editor.items,
                                index,
                                "detailNumber",
                                e.target.value,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          lang="ja"
                          value={item.name}
                          onChange={(e) =>
                            editItems(
                              updateItem(editor.items, index, {
                                name: e.target.value,
                              }),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          lang="ja"
                          value={item.descriptionLower}
                          onChange={(e) =>
                            editItems(
                              updateItem(editor.items, index, {
                                descriptionLower: e.target.value,
                              }),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          lang="ja"
                          value={item.remarksLower}
                          onChange={(e) =>
                            editItems(
                              updateItem(editor.items, index, {
                                remarksLower: e.target.value,
                              }),
                            )
                          }
                        />
                      </td>
                    </tr>
                  </tbody>
                ))}
              </table>
              <p className="hint">
                セット内の明細は明細マスターから写し取った控えです。ここでの修正は明細マスターには反映されません。計算式はセットには持たせず、呼び出した計算書で入力します。
              </p>
            </div>

            <footer>
              <button type="button" onClick={() => void openPicker()}>
                ➕ 明細マスターから追加
              </button>
              <button
                type="button"
                onClick={() =>
                  subject &&
                  editItems(addItem(editor.items, createEmptyItem(subject.id)))
                }
              >
                ➕ 空行を追加
              </button>
              <span className="spacer" />
              <button type="button" onClick={() => setEditor(null)}>
                閉じる
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void save()}
              >
                💾 保存
              </button>
            </footer>
          </div>
        </div>
      )}

      {chooser.length > 0 && (
        <div className="modal-backdrop" role="dialog">
          <div className="modal picker">
            <header>
              <h3>セット明細を選ぶ（1行目が同じセットが{chooser.length}件）</h3>
            </header>
            <div className="modal-body">
              {chooser.map((assembly, groupIndex) => (
                <table className="grid" key={assembly.id}>
                  <thead>
                    <tr>
                      <th colSpan={6}>
                        {groupIndex + 1}．{assembly.items.length}明細のセット
                        {assembly.note ? `（${assembly.note}）` : ""}
                      </th>
                    </tr>
                    <tr>
                      <th>部位番号／明細番号</th>
                      <th>部位名／名称</th>
                      <th>摘要</th>
                      <th>備考</th>
                      <th>単位</th>
                      <th>掛け率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assembly.items.map((item, itemIndex) => {
                      const open = (): void => {
                        setChooser([]);
                        void openEditor(assembly);
                      };
                      return (
                        <tr
                          key={`${assembly.id}-${itemIndex}`}
                          tabIndex={0}
                          onDoubleClick={open}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") open();
                          }}
                        >
                          <td className="num">
                            {formatDetailNumber(item.partNumber)} /{" "}
                            {formatDetailNumber(item.detailNumber)}
                          </td>
                          <td>
                            {item.partName} / {item.name}
                          </td>
                          <td>
                            {item.descriptionUpper} {item.descriptionLower}
                          </td>
                          <td>
                            {item.remarksUpper} {item.remarksLower}
                          </td>
                          <td>{item.unit}</td>
                          <td className="num">{item.coefficient}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ))}
            </div>
            <footer>
              <span className="hint">
                どの行をダブルクリック／Enterでもそのセットを開きます
              </span>
              <span className="spacer" />
              <button type="button" onClick={() => setChooser([])}>
                閉じる
              </button>
            </footer>
          </div>
        </div>
      )}

      {picker && (
        <div className="modal-backdrop" role="dialog">
          <div className="modal picker">
            <header>
              <h3>明細マスターから選ぶ（{subject?.name}）</h3>
            </header>
            <div className="modal-body">
              <table className="grid">
                <thead>
                  <tr>
                    <th>明細番号</th>
                    <th>名称</th>
                    <th>摘要</th>
                    <th>単位</th>
                  </tr>
                </thead>
                <tbody>
                  {picker.map((detail) => (
                    <tr
                      key={detail.id}
                      tabIndex={0}
                      onDoubleClick={() => void pickDetail(detail)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void pickDetail(detail);
                      }}
                    >
                      <td className="num">
                        {formatDetailNumber(detail.detailNumber)}
                      </td>
                      <td>
                        {detail.partName} / {detail.name}
                      </td>
                      <td>
                        {detail.descriptionUpper} {detail.descriptionLower}
                      </td>
                      <td>{detail.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer>
              <span className="hint">
                行をダブルクリック／Enterで取り込みます
              </span>
              <span className="spacer" />
              <button type="button" onClick={() => setPicker(null)}>
                閉じる
              </button>
            </footer>
          </div>
        </div>
      )}

      {merge && (
        <div className="modal-backdrop" role="dialog">
          <div className="modal confirm">
            <p>{merge.message}</p>
            <footer>
              <button type="button" onClick={() => setMerge(null)}>
                統合しない
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void applyMerge()}
              >
                統合する
              </button>
            </footer>
          </div>
        </div>
      )}

      <UnitOptions units={options.units} />
      <MasterCodeOptions
        entries={options.materialCategories}
        listId="material-category-options"
      />
    </div>
  );
}
