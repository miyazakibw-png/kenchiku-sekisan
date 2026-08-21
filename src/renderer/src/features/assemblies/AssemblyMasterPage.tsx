import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AssemblyMasterOptions,
  Detail,
  FinishAssembly,
  Subject,
} from "@shared/types";
import { formatDetailNumber } from "@shared/detailNumber";
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

interface Props {
  options: AssemblyMasterOptions;
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

export default function AssemblyMasterPage({ options }: Props): JSX.Element {
  const [assemblies, setAssemblies] = useState<FinishAssembly[]>([]);
  const [subject, setSubject] = useState<Subject | null>(
    options.subjects[0] ?? null,
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [picker, setPicker] = useState<Detail[] | null>(null);
  const [merge, setMerge] = useState<MergeState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setAssemblies(await window.sekisan.listAssemblies(null));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  const openEditor = useCallback((assembly: FinishAssembly) => {
    setSelectedId(assembly.id);
    setEditor({
      id: assembly.id,
      note: assembly.note,
      items: toDraftItems(assembly.items),
    });
  }, []);

  const openPicker = useCallback(async () => {
    if (!subject) return;
    setPicker(await window.sekisan.listDetails(subject.id));
  }, [subject]);

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

  const save = useCallback(async () => {
    if (!editor) return;
    const result = await window.sekisan.saveAssembly({
      id: editor.id,
      scope: "basic",
      projectId: null,
      note: editor.note,
      items: toAssemblyItems(editor.items),
    });
    await reload();
    setEditor(null);
    setSelectedId(result.assembly.id);
    if (result.duplicateOf) {
      setMerge({
        keepId: result.duplicateOf.id,
        mergedId: result.assembly.id,
        message: `既に同じ内容のセットがあります（${headItem(result.duplicateOf)?.name ?? ""}）。既存セットへ統合しますか。`,
      });
    } else {
      setToast("保存しました");
    }
  }, [editor, reload]);

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
          <h2>仕上明細セットマスター</h2>
          <button
            type="button"
            onClick={() => void openPicker()}
            disabled={!subject}
          >
            ➕ 新規セット（明細マスターから）
          </button>
          <span className="hint">
            行をダブルクリック／Enterでセット明細を開きます
          </span>
          <span className="status">{toast ?? ""}</span>
        </div>

        <div className="assembly-body">
          <table className="grid assembly-list">
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
                <th>明細数</th>
              </tr>
            </thead>
            {visible.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={9} className="empty">
                    この科目のセットはまだありません
                  </td>
                </tr>
              </tbody>
            ) : (
              visible.map((assembly, index) => {
                const head = headItem(assembly);
                if (!head) return null;
                return (
                  <tbody
                    key={assembly.id}
                    className={`detail-group ${selectedId === assembly.id ? "selected" : ""}`}
                    tabIndex={0}
                    onClick={() => setSelectedId(assembly.id)}
                    onDoubleClick={() => openEditor(assembly)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openEditor(assembly);
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
                        {assembly.items.length}
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
                    <th>計算式</th>
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
                      <td rowSpan={2}>
                        <input
                          value={item.formula}
                          placeholder="例: P*3"
                          onChange={(e) =>
                            editItems(
                              updateItem(editor.items, index, {
                                formula: e.target.value,
                              }),
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
                セット内の明細は明細マスターから写し取った控えです。ここでの修正は明細マスターには反映されません。
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
