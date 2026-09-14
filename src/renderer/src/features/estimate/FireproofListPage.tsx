import { Fragment, useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@shared/types";
import {
  applyFloorCount,
  beamFloorLabels,
  columnFloorLabels,
  emptyFireproofSheet,
  fireproofId,
  formatSizeInput,
  newCommonRow,
  newMember,
  normalizeCommonRows,
  normalizeFloorList,
  resolveCommonRow,
  resolveSize,
  sizeFromInput,
  EMPTY_SIZE,
  type FireproofCommonRow,
  type FireproofFloorList,
  type FireproofMember,
  type FireproofSheet,
  type SteelShape,
} from "../../../../core/fireproof/fireproofList";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import "./EstimatePartsPage.css";
import "./FireproofListPage.css";

interface Props {
  project: ProjectSummary;
  /** 開いたとき下の「階共通リスト」まで送るか */
  focus?: "floor" | "common";
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

const SHAPE_OPTIONS: { value: SteelShape | ""; label: string }[] = [
  { value: "", label: "" },
  { value: "box", label: "□" },
  { value: "h", label: "Ｈ" },
];

interface SizeInputProps {
  size: { shape: SteelShape | ""; first: number | null; second: number | null };
  placeholder: string;
  title: string;
  onChange: (size: { first: number | null; second: number | null }) => void;
}

/**
 * 「250*125」の1マス入力。入力中は打った文字をそのまま残し、
 * 欄から出たときにきれいな形へ直す（打つたびに直すと「*」が消えてしまうため）。
 */
function SizeInput({
  size,
  placeholder,
  title,
  onChange,
}: SizeInputProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => formatSizeInput(size));
  // 表の外から値が変わったとき（戻る・貼付など）は欄に反映する
  useEffect(() => {
    if (!editing) setText(formatSizeInput(size));
  }, [size, editing]);
  return (
    <input
      value={text}
      placeholder={placeholder}
      title={title}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        setText(formatSizeInput(size));
      }}
      onChange={(event) => {
        setText(event.target.value);
        const next = sizeFromInput(size, event.target.value);
        onChange({ first: next.first, second: next.second });
      }}
    />
  );
}

/**
 * 耐火被覆・塗装積算入力のリスト画面。
 * 上：階別リスト（柱リスト・梁リスト）、下：階共通リスト。表ごとに別々にスクロールする。
 */
export default function FireproofListPage({
  project,
  focus = "floor",
  onBack,
}: Props): JSX.Element {
  const [recordId, setRecordId] = useState<number | null>(null);
  const [sheet, setSheet] = useState<FireproofSheet>(emptyFireproofSheet());
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const commonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const record = await window.sekisan.getFireproofSheet(project.id);
      setRecordId(record.id);
      setSheet({
        floorCount: record.floorCount,
        columns: normalizeFloorList(parseJson(record.columnsJson, {})),
        beams: normalizeFloorList(parseJson(record.beamsJson, {})),
        common: normalizeCommonRows(parseJson(record.commonJson, [])),
      });
      setNote(record.note);
    })();
  }, [project.id]);

  useEffect(() => {
    if (focus === "common") commonRef.current?.scrollIntoView();
  }, [focus, recordId]);

  const save = async (silent = false): Promise<void> => {
    if (recordId === null) return;
    await window.sekisan.saveFireproofSheet({
      id: recordId,
      floorCount: sheet.floorCount,
      columnsJson: JSON.stringify(sheet.columns),
      beamsJson: JSON.stringify(sheet.beams),
      commonJson: JSON.stringify(sheet.common),
      note,
    });
    markSaved({ sheet, note });
    if (!silent) setMessage("保存しました");
  };

  const { markSaved } = useSaveOnLeave({ sheet, note }, () => save(true));

  useEffect(() => {
    if (recordId !== null) markSaved({ sheet, note });
    // 読み込み直後の中身を保存済みの基準にする
  }, [recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 階数を直す（柱は最上階→1階、梁は最上段をＲにして1つずらす） */
  const changeFloorCount = (count: number): void => {
    setSheet((current) => ({
      ...current,
      floorCount: count,
      columns: applyFloorCount(current.columns, columnFloorLabels(count)),
      beams: applyFloorCount(current.beams, beamFloorLabels(count)),
    }));
  };

  return (
    <div className="estimate-page fireproof-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>耐火被覆・塗装積算入力（リスト）</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <label className="floor-count">
          階数
          <input
            type="number"
            min={0}
            value={sheet.floorCount === 0 ? "" : sheet.floorCount}
            onChange={(event) =>
              changeFloorCount(Math.max(0, Number(event.target.value) || 0))
            }
          />
        </label>
        <span className="hint">
          階数を入れると階別リストの行を作ります（中2階・塔屋は「階の行追加」で足せます）
        </span>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      {/* 左を上下に分けて柱・梁、右に階共通を縦長に出す（UP図の配置） */}
      <div className="fireproof-body">
        <div className="fireproof-floor">
          <FloorListSection
            title="柱リスト"
            kind="column"
            sizeLabels={["Ｗ", "Ｄ"]}
            list={sheet.columns}
            onChange={(next) =>
              setSheet((current) => ({ ...current, columns: next }))
            }
            onMessage={setMessage}
          />
          <FloorListSection
            title="梁リスト"
            kind="beam"
            sizeLabels={["Ｈ", "Ｗ"]}
            list={sheet.beams}
            onChange={(next) =>
              setSheet((current) => ({ ...current, beams: next }))
            }
            onMessage={setMessage}
          />
        </div>
        <div className="fireproof-common" ref={commonRef}>
          <CommonListSection
            rows={sheet.common}
            onChange={(next) =>
              setSheet((current) => ({ ...current, common: next }))
            }
            onMessage={setMessage}
          />
        </div>
      </div>
    </div>
  );
}

interface FloorSectionProps {
  title: string;
  kind: "column" | "beam";
  /** 寸法の呼び名（柱＝Ｗ・Ｄ、梁＝Ｈ・Ｗ） */
  sizeLabels: [string, string];
  list: FireproofFloorList;
  onChange: (next: FireproofFloorList) => void;
  onMessage: (text: string) => void;
}

/** 階別リスト（柱・梁）。階をタテ、部材記号（C1・G1…）をヨコに並べる */
function FloorListSection({
  title,
  kind,
  sizeLabels,
  list,
  onChange,
  onMessage,
}: FloorSectionProps): JSX.Element {
  const history = useUndoRedo<FireproofFloorList>();
  const listRef = useRef(list);
  listRef.current = list;
  /** カーソルの列と、Shift+クリックで広げた端 */
  const [selected, setSelected] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState(0);
  const [clipboard, setClipboard] = useState<FireproofMember[]>([]);

  const commit = (next: FireproofFloorList): void => {
    history.push(listRef.current);
    onChange(next);
  };

  const undo = (): void => {
    const previous = history.undo(listRef.current);
    if (previous === null) {
      onMessage(`${title}：戻せる操作がありません`);
      return;
    }
    onChange(previous);
    onMessage(`${title}：1つ前に戻しました`);
  };

  const redo = (): void => {
    const next = history.redo(listRef.current);
    if (next === null) {
      onMessage(`${title}：進める操作がありません`);
      return;
    }
    onChange(next);
    onMessage(`${title}：1つ先へ進めました`);
  };

  const start = Math.min(selected, selectedEnd);
  const end = Math.max(selected, selectedEnd);

  const setMembers = (members: FireproofMember[]): void =>
    commit({ ...list, members });

  const addMember = (): void => setMembers([...list.members, newMember()]);

  const insertMember = (): void => {
    const members = [...list.members];
    members.splice(start, 0, newMember());
    setMembers(members);
  };

  const removeMember = (index: number): void =>
    setMembers(list.members.filter((_, at) => at !== index));

  /** 部材記号をヨコに1つ動かす */
  const moveMember = (index: number, step: number): void => {
    const to = index + step;
    if (to < 0 || to >= list.members.length) return;
    const members = [...list.members];
    const moved = members.splice(index, 1)[0];
    members.splice(to, 0, moved);
    setMembers(members);
  };

  const copyMembers = (): void => {
    const copied = list.members
      .slice(start, end + 1)
      .map((member) => ({ ...member, sizes: { ...member.sizes } }));
    if (copied.length === 0) return;
    setClipboard(copied);
    onMessage(
      `⧉ ${title}：${copied.length} 列をコピーしました（貼り付け先の列を選んで「上書貼付」「挿入貼付」「追加貼付」）`,
    );
  };

  const pasteMembers = (mode: "overwrite" | "insert" | "append"): void => {
    if (clipboard.length === 0) return;
    const fresh = clipboard.map((member) => ({
      ...member,
      id: fireproofId("m"),
      sizes: { ...member.sizes },
    }));
    const members = [...list.members];
    if (mode === "overwrite") members.splice(start, fresh.length, ...fresh);
    if (mode === "insert") members.splice(start, 0, ...fresh);
    if (mode === "append") members.push(...fresh);
    setMembers(members);
    onMessage(`${title}：${fresh.length} 列を貼り付けました`);
  };

  /** 階の行（中2階・塔屋など手で足す行） */
  const addFloor = (at: number): void => {
    const floors = [...list.floors];
    floors.splice(at, 0, { id: fireproofId("f"), label: "", manual: true });
    commit({ ...list, floors });
  };

  const removeFloor = (index: number): void => {
    const floors = list.floors.filter((_, at) => at !== index);
    commit({ ...list, floors });
  };

  const changeFloorLabel = (index: number, label: string): void => {
    const floors = list.floors.map((floor, at) =>
      at === index ? { ...floor, label } : floor,
    );
    onChange({ ...list, floors });
  };

  const changeSize = (
    memberIndex: number,
    floorId: string,
    patch: Partial<typeof EMPTY_SIZE>,
  ): void => {
    const members = list.members.map((member, at) =>
      at === memberIndex
        ? {
            ...member,
            sizes: {
              ...member.sizes,
              [floorId]: { ...(member.sizes[floorId] ?? EMPTY_SIZE), ...patch },
            },
          }
        : member,
    );
    onChange({ ...list, members });
  };

  return (
    <section className="fireproof-section">
      <div className="section-bar">
        <h3>{title}</h3>
        <button type="button" disabled={!history.canUndo} onClick={undo}>
          ↶ 戻る
        </button>
        <button type="button" disabled={!history.canRedo} onClick={redo}>
          ↷ 進む
        </button>
        <button type="button" onClick={addMember}>
          ＋ リスト追加
        </button>
        <button type="button" onClick={insertMember}>
          ⇤ リスト挿入
        </button>
        <button
          type="button"
          title="選んだ列（Shift+クリックで範囲）をコピーします"
          onClick={copyMembers}
        >
          ⧉ リストコピー（複数可）
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteMembers("overwrite")}
        >
          📋 上書貼付
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteMembers("insert")}
        >
          📋 挿入貼付
        </button>
        <button
          type="button"
          disabled={clipboard.length === 0}
          onClick={() => pasteMembers("append")}
        >
          📋 追加貼付
        </button>
        <button
          type="button"
          title="中2階・塔屋などの行を、いちばん上に足します"
          onClick={() => addFloor(0)}
        >
          ＋ 階の行追加
        </button>
      </div>

      <div className="section-scroll">
        <table className="grid fireproof">
          <thead>
            <tr>
              <th className="floor" rowSpan={2}>
                階
              </th>
              <th className="ops" rowSpan={2}>
                操作
              </th>
              {list.members.map((member, index) => (
                <th
                  key={member.id}
                  colSpan={2}
                  className={index >= start && index <= end ? "selected" : ""}
                  onMouseDown={(event) => {
                    if (event.shiftKey) {
                      setSelectedEnd(index);
                      return;
                    }
                    setSelected(index);
                    setSelectedEnd(index);
                  }}
                >
                  <div className="symbol">
                    <input
                      lang="ja"
                      value={member.symbol}
                      placeholder={kind === "column" ? "Ｃ1" : "Ｇ1"}
                      onChange={(event) =>
                        onChange({
                          ...list,
                          members: list.members.map((each, at) =>
                            at === index
                              ? { ...each, symbol: event.target.value }
                              : each,
                          ),
                        })
                      }
                    />
                    <button type="button" onClick={() => moveMember(index, -1)}>
                      ←
                    </button>
                    <button type="button" onClick={() => moveMember(index, 1)}>
                      →
                    </button>
                    <button type="button" onClick={() => removeMember(index)}>
                      🗑
                    </button>
                  </div>
                </th>
              ))}
            </tr>
            <tr>
              {list.members.map((member) => (
                <Fragment key={member.id}>
                  <th className="shape">形状</th>
                  <th className="size">
                    {sizeLabels[0]}＊{sizeLabels[1]}
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.floors.map((floor, floorIndex) => (
              <tr key={floor.id}>
                <td className="floor">
                  <input
                    lang="ja"
                    value={floor.label}
                    onChange={(event) =>
                      changeFloorLabel(floorIndex, event.target.value)
                    }
                  />
                </td>
                <td className="ops">
                  <button
                    type="button"
                    title="この行の上へ行を足す"
                    onClick={() => addFloor(floorIndex)}
                  >
                    ⇤
                  </button>
                  <button
                    type="button"
                    title="この行を消す"
                    onClick={() => removeFloor(floorIndex)}
                  >
                    🗑
                  </button>
                </td>
                {list.members.map((member, memberIndex) => {
                  const size = member.sizes[floor.id] ?? EMPTY_SIZE;
                  const resolved = resolveSize(
                    member,
                    list.floors,
                    floorIndex,
                    kind,
                  );
                  const selectedColumn =
                    memberIndex >= start && memberIndex <= end;
                  return (
                    <Fragment key={member.id}>
                      <td
                        className={`shape${selectedColumn ? " selected" : ""}`}
                      >
                        <select
                          value={size.shape}
                          onChange={(event) =>
                            changeSize(memberIndex, floor.id, {
                              shape: event.target.value as SteelShape | "",
                            })
                          }
                        >
                          {SHAPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label === ""
                                ? `（${resolved.shape === "box" ? "□" : "Ｈ"}）`
                                : option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td
                        key={`${member.id}z`}
                        className={`size${selectedColumn ? " selected" : ""}`}
                      >
                        <SizeInput
                          size={size}
                          placeholder={
                            resolved.first === null
                              ? `${sizeLabels[0]}＊${sizeLabels[1]}`
                              : `${resolved.first}＊${resolved.second ?? ""}`
                          }
                          title={`${sizeLabels[0]}＊${sizeLabels[1]} を1マスに打ちます（例 250*125）。空欄は下の階の数字を使います`}
                          onChange={(next) =>
                            changeSize(memberIndex, floor.id, next)
                          }
                        />
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {list.floors.length === 0 && (
          <p className="note">階数を入れると行ができます。</p>
        )}
      </div>
    </section>
  );
}

interface CommonSectionProps {
  rows: FireproofCommonRow[];
  onChange: (next: FireproofCommonRow[]) => void;
  onMessage: (text: string) => void;
}

/** 階共通リスト（階で分けない部材。Ｐ1・Ｂ1…を1つの表に書く） */
function CommonListSection({
  rows,
  onChange,
  onMessage,
}: CommonSectionProps): JSX.Element {
  const history = useUndoRedo<FireproofCommonRow[]>();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [selected, setSelected] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState(0);
  const [clipboard, setClipboard] = useState<FireproofCommonRow[]>([]);

  const commit = (next: FireproofCommonRow[]): void => {
    history.push(rowsRef.current);
    onChange(next);
  };

  const start = Math.min(selected, selectedEnd);
  const end = Math.max(selected, selectedEnd);

  const undo = (): void => {
    const previous = history.undo(rowsRef.current);
    if (previous === null) {
      onMessage("階共通リスト：戻せる操作がありません");
      return;
    }
    onChange(previous);
    onMessage("階共通リスト：1つ前に戻しました");
  };

  const redo = (): void => {
    const next = history.redo(rowsRef.current);
    if (next === null) {
      onMessage("階共通リスト：進める操作がありません");
      return;
    }
    onChange(next);
    onMessage("階共通リスト：1つ先へ進めました");
  };

  const copyRows = (): void => {
    const copied = rows.slice(start, end + 1).map((row) => ({ ...row }));
    if (copied.length === 0) return;
    setClipboard(copied);
    onMessage(
      `⧉ 階共通リスト：${copied.length} 行をコピーしました（貼り付け先の行を選んで「上書貼付」「挿入貼付」「追加貼付」）`,
    );
  };

  const pasteRows = (mode: "overwrite" | "insert" | "append"): void => {
    if (clipboard.length === 0) return;
    const fresh = clipboard.map((row) => ({ ...row, id: fireproofId("c") }));
    const next = [...rows];
    if (mode === "overwrite") next.splice(start, fresh.length, ...fresh);
    if (mode === "insert") next.splice(start, 0, ...fresh);
    if (mode === "append") next.push(...fresh);
    commit(next);
    onMessage(`階共通リスト：${fresh.length} 行を貼り付けました`);
  };

  const change = (index: number, patch: Partial<FireproofCommonRow>): void =>
    onChange(
      rows.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );

  return (
    <section className="fireproof-section">
      <div className="section-bar">
        <h3>階共通リスト</h3>
        <button type="button" disabled={!history.canUndo} onClick={undo}>
          ↶ 戻る
        </button>
        <button type="button" disabled={!history.canRedo} onClick={redo}>
          ↷ 進む
        </button>
        <button type="button" onClick={() => commit([...rows, newCommonRow()])}>
          ＋ リスト行追加
        </button>
        <button
          type="button"
          onClick={() => {
            const next = [...rows];
            next.splice(start, 0, newCommonRow());
            commit(next);
          }}
        >
          ⇤ リスト行挿入
        </button>
        <button
          type="button"
          title="選んだ行（Shift+クリックで範囲）をコピーします"
          onClick={copyRows}
        >
          ⧉ リストコピー（複数可）
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
        <span className="hint">
          柱・梁と同じ部材でも、階で分けないものはこの表に書きます（形状の初期はＨ）
        </span>
      </div>

      <div className="section-scroll common">
        <table className="grid fireproof">
          <thead>
            <tr>
              <th className="ops">操作</th>
              <th className="symbol">記号</th>
              <th className="shape">形状</th>
              <th className="size">Ｗ＊Ｄ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const resolved = resolveCommonRow(row);
              return (
                <tr
                  key={row.id}
                  className={index >= start && index <= end ? "selected" : ""}
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
                    <button
                      type="button"
                      onClick={() =>
                        commit(rows.filter((_, at) => at !== index))
                      }
                    >
                      🗑
                    </button>
                  </td>
                  <td className="symbol">
                    <input
                      lang="ja"
                      value={row.symbol}
                      placeholder="Ｐ1"
                      onChange={(event) =>
                        change(index, { symbol: event.target.value })
                      }
                    />
                  </td>
                  <td className="shape">
                    <select
                      value={row.shape}
                      onChange={(event) =>
                        change(index, {
                          shape: event.target.value as SteelShape | "",
                        })
                      }
                    >
                      {SHAPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label === ""
                            ? `（${resolved.shape === "box" ? "□" : "Ｈ"}）`
                            : option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="size">
                    <SizeInput
                      size={row}
                      placeholder="Ｗ＊Ｄ"
                      title="Ｗ＊Ｄ を1マスに打ちます（例 250*125）"
                      onChange={(next) => change(index, next)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="note">「＋ リスト行追加」で行を足します。</p>
        )}
      </div>
    </section>
  );
}
