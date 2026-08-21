import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Detail,
  FinishAssembly,
  MasterOptions,
  Subject,
} from "@shared/types";
import { resolveMasterName } from "@shared/masters";
import {
  calcDetail,
  calcLine,
  calcSet,
  evaluateCalcSheet,
  nextBSymbol,
  setRowCount,
  usedBSymbols,
  type CalcSet,
  type CalcSheetResult,
} from "../../../../core/room/calcSheet";
import "./RoomCalcSheet.css";

/** いま入力しているセル（記号クリックの差し込み先・呼出の位置に使う） */
export interface CalcFocus {
  setId: string;
  /** detail: 明細欄 / formulaA・formulaB: 計算式欄 */
  area: "detail" | "formulaA" | "formulaB";
  index: number;
}

interface Props {
  sets: CalcSet[];
  onChange: (sets: CalcSet[]) => void;
  /** 上段の記号・建具記号（計算式で使える数量） */
  variables: Record<string, number>;
  options: MasterOptions | null;
  projectId: number;
  focus: CalcFocus | null;
  onFocus: (focus: CalcFocus | null) => void;
  result: CalcSheetResult;
  onMessage: (message: string) => void;
}

type CallSource = "basic" | "project" | "assembly";

const SOURCE_LABEL: Record<CallSource, string> = {
  basic: "基本マスター（明細）",
  project: "工事マスター（明細）",
  assembly: "セット明細マスター",
};

export default function RoomCalcSheet({
  sets,
  onChange,
  variables,
  options,
  projectId,
  focus,
  onFocus,
  result,
  onMessage,
}: Props): JSX.Element {
  const [callOpen, setCallOpen] = useState(false);
  const [source, setSource] = useState<CallSource>("basic");
  const [insertMode, setInsertMode] = useState(false);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);
  const [assemblies, setAssemblies] = useState<FinishAssembly[]>([]);

  const subjects: Subject[] = options?.subjects ?? [];

  useEffect(() => {
    if (!callOpen) return;
    void (async () => {
      if (source === "assembly") {
        const basic = await window.sekisan.listAssemblies(null);
        const project = await window.sekisan.listAssemblies(projectId);
        setAssemblies([...basic, ...project]);
        return;
      }
      if (subjectId === null) {
        setDetails([]);
        return;
      }
      setDetails(await window.sekisan.listDetails(subjectId));
    })();
  }, [callOpen, projectId, source, subjectId]);

  const used = useMemo(() => usedBSymbols(sets), [sets]);

  const updateSet = useCallback(
    (setId: string, patch: Partial<CalcSet>): void =>
      onChange(
        sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)),
      ),
    [onChange, sets],
  );

  /** カーソルのあるセット（無ければ最後のセット） */
  const currentSet = useMemo(
    () =>
      sets.find((set) => set.id === focus?.setId) ??
      sets[sets.length - 1] ??
      null,
    [focus?.setId, sets],
  );

  /** 明細を1つ呼び出す（上書き基準・空きが無ければ自動で挿入） */
  const callDetail = useCallback(
    (detail: Detail) => {
      const target = currentSet;
      const item = calcDetail({
        sourceDetailId: detail.id,
        subjectId: detail.subjectId,
        detailNumber: detail.detailNumber,
        materialCategory: detail.materialCategory,
        name: detail.name,
        descriptionUpper: detail.descriptionUpper,
        descriptionLower: detail.descriptionLower,
        unit: detail.unit,
        remarksUpper: detail.remarksUpper,
        remarksLower: detail.remarksLower,
        estimateDisplay: detail.estimateDisplay,
      });
      if (!target) {
        const created = calcSet(1);
        created.details = [item];
        onChange([...sets, created]);
        onFocus({ setId: created.id, area: "detail", index: 1 });
        return;
      }
      const at =
        focus && focus.setId === target.id && focus.area === "detail"
          ? focus.index
          : target.details.findIndex((row) => row.name.trim() === "");
      const details2 = [...target.details];
      if (insertMode || at < 0 || at >= details2.length) {
        const position = at < 0 ? details2.length : at;
        details2.splice(position, 0, item);
        onFocus({ setId: target.id, area: "detail", index: position + 1 });
      } else {
        details2[at] = item;
        onFocus({ setId: target.id, area: "detail", index: at + 1 });
      }
      updateSet(target.id, { details: details2 });
      onMessage(`${detail.name} を呼び出しました`);
    },
    [
      currentSet,
      focus,
      insertMode,
      onChange,
      onFocus,
      onMessage,
      sets,
      updateSet,
    ],
  );

  /** セット明細をまとめて呼び出す（元の行数に関わらず1セット＝1回分） */
  const callAssembly = useCallback(
    (assembly: FinishAssembly) => {
      const created = calcSet(0);
      created.partName = assembly.items[0]?.partName ?? "";
      created.partNumber = assembly.items[0]?.partNumber ?? null;
      created.details = assembly.items.map((item) =>
        calcDetail({
          sourceDetailId: item.sourceDetailId,
          subjectId: item.subjectId,
          detailNumber: item.detailNumber,
          materialCategory: item.materialCategory,
          name: item.name,
          descriptionUpper: item.descriptionUpper,
          descriptionLower: item.descriptionLower,
          unit: item.unit,
          remarksUpper: item.remarksUpper,
          remarksLower: item.remarksLower,
          estimateDisplay: item.estimateDisplay,
          coefficient: item.coefficient,
        }),
      );
      created.lines = [calcLine()];
      const at = sets.findIndex((set) => set.id === currentSet?.id);
      const next = [...sets];
      if (insertMode || at < 0) {
        next.splice(at < 0 ? next.length : at, 0, created);
      } else {
        // 上書きは元のセット1つ分を丸ごと置き換える（計算式は残す）
        created.lines = sets[at].lines;
        next[at] = created;
      }
      onChange(next);
      onFocus({ setId: created.id, area: "detail", index: 0 });
      onMessage(
        `${assembly.items[0]?.name ?? "セット明細"} を${insertMode ? "挿入" : "上書き"}呼出しました`,
      );
    },
    [currentSet?.id, insertMode, onChange, onFocus, onMessage, sets],
  );

  /** カーソルの位置で判断して行を足す（明細欄なら明細、計算式欄なら計算行） */
  const addRow = useCallback(
    (insert: boolean) => {
      const target = currentSet;
      if (!target) {
        onChange([...sets, calcSet()]);
        return;
      }
      const area = focus?.area ?? "detail";
      if (area === "detail") {
        const details2 = [...target.details];
        const position = insert ? (focus?.index ?? 0) : details2.length;
        details2.splice(position, 0, calcDetail());
        updateSet(target.id, { details: details2 });
      } else {
        const lines = [...target.lines];
        const position = insert ? (focus?.index ?? 0) : lines.length;
        lines.splice(position, 0, calcLine());
        updateSet(target.id, { lines });
      }
    },
    [currentSet, focus, onChange, sets, updateSet],
  );

  return (
    <div className="room-calc-sheet">
      <div className="section-bar">
        <span>セット明細計算表（部位のある行がセットの先頭です）</span>
        <button type="button" onClick={() => onChange([...sets, calcSet()])}>
          ＋ セット明細（2明細）
        </button>
        <button type="button" onClick={() => addRow(false)}>
          ＋ 行追加
        </button>
        <button type="button" onClick={() => addRow(true)}>
          ↥ 行挿入
        </button>
        <button
          type="button"
          className={callOpen ? "on" : ""}
          onClick={() => setCallOpen(!callOpen)}
        >
          📂 マスター呼出
        </button>
        <span className="hint">
          記号は上段の表をクリックすると計算式へ入ります
        </span>
      </div>

      <table className="grid calc">
        <thead>
          <tr>
            <th className="part">部位</th>
            <th className="no">明細番号</th>
            <th>名称</th>
            <th>摘要</th>
            <th className="unit">単位</th>
            <th>備考</th>
            <th className="formula">計算式Ａ</th>
            <th className="formula-b">Ｂ</th>
            <th className="comment">コメント</th>
            <th className="num">結果</th>
            <th className="num">累計</th>
            <th className="bsym">記号</th>
            <th />
          </tr>
        </thead>
        {sets.map((set, setIndex) => (
          <tbody
            key={set.id}
            className={setIndex % 2 === 0 ? "set even" : "set odd"}
          >
            {Array.from({ length: setRowCount(set) }, (_, rowIndex) => {
              const detail = set.details[rowIndex];
              const line = set.lines[rowIndex];
              const lineResult = line ? result.lines.get(line.id) : undefined;
              return (
                <tr key={`${set.id}-${rowIndex}`}>
                  <td className="part">
                    {rowIndex === 0 ? (
                      <input
                        list="calc-parts"
                        value={set.partName}
                        placeholder="番号で入力"
                        title="部位マスターの番号を入力すると名称に変換します。空欄にすると上のセットに含まれます"
                        onChange={(e) => {
                          const parts = options?.pickupParts ?? [];
                          const name = resolveMasterName(parts, e.target.value);
                          updateSet(set.id, {
                            partName: name,
                            partNumber:
                              parts.find((part) => part.name === name)?.id ??
                              null,
                          });
                        }}
                      />
                    ) : null}
                  </td>
                  {detail ? (
                    <>
                      <td className="no">
                        {detail.detailNumber === null
                          ? ""
                          : detail.detailNumber.toFixed(2)}
                      </td>
                      <td>
                        <input
                          value={detail.name}
                          onFocus={() =>
                            onFocus({
                              setId: set.id,
                              area: "detail",
                              index: rowIndex,
                            })
                          }
                          onChange={(e) =>
                            updateSet(set.id, {
                              details: set.details.map((row, index) =>
                                index === rowIndex
                                  ? { ...row, name: e.target.value }
                                  : row,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={detail.descriptionUpper}
                          onChange={(e) =>
                            updateSet(set.id, {
                              details: set.details.map((row, index) =>
                                index === rowIndex
                                  ? { ...row, descriptionUpper: e.target.value }
                                  : row,
                              ),
                            })
                          }
                        />
                      </td>
                      <td className="unit">
                        <input
                          list="calc-units"
                          value={detail.unit}
                          onChange={(e) =>
                            updateSet(set.id, {
                              details: set.details.map((row, index) =>
                                index === rowIndex
                                  ? {
                                      ...row,
                                      unit: resolveMasterName(
                                        (options?.units ?? []).map((unit) => ({
                                          id: unit.id,
                                          name: unit.name,
                                        })),
                                        e.target.value,
                                      ),
                                    }
                                  : row,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={detail.remarksUpper}
                          onChange={(e) =>
                            updateSet(set.id, {
                              details: set.details.map((row, index) =>
                                index === rowIndex
                                  ? { ...row, remarksUpper: e.target.value }
                                  : row,
                              ),
                            })
                          }
                        />
                      </td>
                    </>
                  ) : (
                    <td className="empty" colSpan={5} />
                  )}
                  {line ? (
                    <>
                      <td className="formula">
                        <input
                          value={line.formulaA}
                          onFocus={() =>
                            onFocus({
                              setId: set.id,
                              area: "formulaA",
                              index: rowIndex,
                            })
                          }
                          onChange={(e) =>
                            updateSet(set.id, {
                              lines: set.lines.map((row, index) =>
                                index === rowIndex
                                  ? { ...row, formulaA: e.target.value }
                                  : row,
                              ),
                            })
                          }
                        />
                      </td>
                      <td className="formula-b">
                        <input
                          value={line.formulaB}
                          title="ＡとＢの両方に入力すると Ａ×Ｂ になります"
                          onFocus={() =>
                            onFocus({
                              setId: set.id,
                              area: "formulaB",
                              index: rowIndex,
                            })
                          }
                          onChange={(e) =>
                            updateSet(set.id, {
                              lines: set.lines.map((row, index) =>
                                index === rowIndex
                                  ? { ...row, formulaB: e.target.value }
                                  : row,
                              ),
                            })
                          }
                        />
                      </td>
                      <td className="comment">
                        <input
                          maxLength={20}
                          value={line.comment}
                          onChange={(e) =>
                            updateSet(set.id, {
                              lines: set.lines.map((row, index) =>
                                index === rowIndex
                                  ? { ...row, comment: e.target.value }
                                  : row,
                              ),
                            })
                          }
                        />
                      </td>
                      <td
                        className={[
                          "num",
                          (lineResult?.value ?? 0) < 0 ? "minus" : "",
                          lineResult?.error ? "error" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        title={lineResult?.error}
                      >
                        {lineResult?.error !== ""
                          ? lineResult?.error
                          : lineResult?.text}
                      </td>
                      <td className="num">{lineResult?.totalText ?? ""}</td>
                      <td className="bsym">
                        <input
                          value={line.bSymbol}
                          placeholder="B1"
                          title="この計算結果を他のセットで使うための記号（B1〜B100）"
                          onChange={(e) => {
                            const symbol = e.target.value.trim().toUpperCase();
                            if (
                              symbol !== "" &&
                              symbol !== line.bSymbol &&
                              used.has(symbol)
                            ) {
                              onMessage(`${symbol} は既に使われています`);
                              return;
                            }
                            updateSet(set.id, {
                              lines: set.lines.map((row, index) =>
                                index === rowIndex
                                  ? { ...row, bSymbol: symbol }
                                  : row,
                              ),
                            });
                          }}
                        />
                        {rowIndex === 0 && (
                          <button
                            type="button"
                            title="空いている番号を割り当てます"
                            onClick={() =>
                              updateSet(set.id, {
                                lines: set.lines.map((row, index) =>
                                  index === rowIndex
                                    ? { ...row, bSymbol: nextBSymbol(sets) }
                                    : row,
                                ),
                              })
                            }
                          >
                            B
                          </button>
                        )}
                      </td>
                    </>
                  ) : (
                    <td className="empty" colSpan={6} />
                  )}
                  <td>
                    {rowIndex === 0 && (
                      <button
                        type="button"
                        title="このセット明細を削除します"
                        onClick={() =>
                          onChange(sets.filter((each) => each.id !== set.id))
                        }
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>

      <datalist id="calc-parts">
        {(options?.pickupParts ?? []).map((part) => (
          <option key={part.id} value={part.name}>
            {part.id}
          </option>
        ))}
      </datalist>
      <datalist id="calc-units">
        {(options?.units ?? []).map((unit) => (
          <option key={unit.id} value={unit.name}>
            {unit.id}
          </option>
        ))}
      </datalist>

      {callOpen && (
        <div className="call-window">
          <div className="section-bar">
            <span>マスター呼出</span>
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
            <label>
              <input
                type="checkbox"
                checked={!insertMode}
                onChange={() => setInsertMode(false)}
              />
              上書き呼出
            </label>
            <label>
              <input
                type="checkbox"
                checked={insertMode}
                onChange={() => setInsertMode(true)}
              />
              挿入呼出
            </label>
            <button type="button" onClick={() => setCallOpen(false)}>
              ✕ 閉じる
            </button>
          </div>
          {source === "assembly" ? (
            <ul className="call-list">
              {assemblies.map((assembly) => (
                <li
                  key={`${assembly.scope}-${assembly.id}`}
                  tabIndex={0}
                  onDoubleClick={() => callAssembly(assembly)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") callAssembly(assembly);
                  }}
                >
                  <span className="scope">
                    {assembly.scope === "basic" ? "基準" : "工事"}
                  </span>
                  <span className="part">
                    {assembly.items[0]?.partName ?? ""}
                  </span>
                  <span className="name">{assembly.items[0]?.name ?? ""}</span>
                  <span className="count">{assembly.items.length}明細</span>
                </li>
              ))}
            </ul>
          ) : source === "project" ? (
            <p className="note">
              工事マスターは基本マスターからの複製機能を作る工程でつなぎます。今は基本マスターとセット明細マスターから呼び出せます。
            </p>
          ) : (
            <>
              <div className="call-subject">
                <span>工種科目（番号で入力）</span>
                <input
                  list="calc-subjects"
                  onChange={(e) => {
                    const text = e.target.value.trim();
                    const byNumber = subjects.find(
                      (subject) => String(subject.id) === text,
                    );
                    const byName = subjects.find(
                      (subject) => subject.name === text,
                    );
                    setSubjectId((byNumber ?? byName)?.id ?? null);
                  }}
                />
                <datalist id="calc-subjects">
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.name}>
                      {subject.id}
                    </option>
                  ))}
                </datalist>
              </div>
              <ul className="call-list">
                {details.map((detail) => (
                  <li
                    key={detail.id}
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
            </>
          )}
          <p className="note">
            選んでダブルクリック（またはEnter）で呼び出します。呼出画面は閉じないので続けて呼び出せます。
          </p>
        </div>
      )}

      <p className="note">
        計算式には上段の記号（FA・WA1 など）、建具記号（&lt;AW1&gt;
        …建具表から直接引用）、他セットの累計（B1〜B100）が使えます。結果は小数2桁で四捨五入し、累計は表示されている数字を合計します。マイナスは赤、式の誤りは紫で表示します。
      </p>
      <CalcVariablesHint variables={variables} />
    </div>
  );
}

function CalcVariablesHint({
  variables,
}: {
  variables: Record<string, number>;
}): JSX.Element {
  const count = Object.keys(variables).length;
  return (
    <p className="note dim">
      計算式に使える記号：{count}件（上段の表と建具表）
    </p>
  );
}

export { evaluateCalcSheet };
