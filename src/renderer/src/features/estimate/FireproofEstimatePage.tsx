import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Detail,
  MasterEntry,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import {
  adjacencyVariables,
  BEAM_MARK_COUNT,
  calcBeamRow,
  calcColumnRow,
  beamSheetTotals,
  columnSheetTotals,
  inheritedFloors,
  manageRowQuantity,
  newBeamRow,
  newColumnRow,
  newManageRow,
  normalizeManageRows,
  normalizeWallLabels,
  type FireproofColumnRow,
  type FireproofColumnSheet,
  type FireproofManageDetail,
  type FireproofManageRow,
  type FireproofSheetKind,
} from "../../../../core/fireproof/fireproofEstimate";
import {
  evaluateCalcSheet,
  normalizeSets,
  type CalcSet,
} from "../../../../core/room/calcSheet";
import RoomCalcSheet, { type CalcFocus } from "./RoomCalcSheet";
import { findBeamSize } from "../../../../core/fireproof/fireproofEstimate";
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
  30, 100, 72, 50, 100, 60, 70, 64, 48, 48, 56, 90, 180, 150, 150, 60, 100, 100,
];
/** 計算書先頭の明細行（区分〜備考（上段））の既定の幅 */
export const HEAD_DETAIL_WIDTHS = [
  64, 48, 48, 56, 90, 180, 150, 150, 60, 100, 100,
];
/** 柱入力表（階〜壁取合m＋✔欄3列）の既定の幅 */
const COLUMN_WIDTHS = [36, 100, 150, 44, 44, 110, 200, 70, 70, 44, 44, 44];
/** 梁型入力表（階〜床取合m＋✔欄4列）の既定の幅 */
const BEAM_WIDTHS = [...COLUMN_WIDTHS, 44];

/** 柱入力表と梁型入力表（表のある計算書）の種類 */
export type FireproofTableKind = "column" | "beam";

/** 柱入力表と梁型入力表の違い（あとは全部同じ） */
export const SHEET_KIND: Record<
  FireproofTableKind,
  {
    title: string;
    /** 鉄骨リストのどちらを見るか（柱リスト／梁リスト） */
    listLabel: string;
    symbolPlaceholder: string;
    /** 取合mの名前（壁取合m／床取合m） */
    adjacency: string;
    markCount: number;
    widths: number[];
    storageKey: string;
    /** 取合欄の説明文 */
    markTitle: string;
  }
> = {
  column: {
    title: "柱入力表",
    listLabel: "柱リスト",
    symbolPlaceholder: "C1",
    adjacency: "壁取合m",
    markCount: 3,
    widths: COLUMN_WIDTHS,
    storageKey: "fireproof-column-cols-v3",
    markTitle:
      "面の数（1〜4。□・Ｈ鋼どちらにも使えます）か取合記号（H1〜H4。同じ面数で計算します）を入れます。壁取合mは4面（H4）のとき0、それ以外は有効長×2です",
  },
  beam: {
    title: "梁型入力表",
    listLabel: "梁リスト",
    symbolPlaceholder: "G1",
    adjacency: "床取合m",
    markCount: BEAM_MARK_COUNT,
    widths: BEAM_WIDTHS,
    storageKey: "fireproof-beam-cols-v1",
    markTitle:
      "取合記号（Ｈ鋼：4・3・2・A3／箱型：H4・H3・H2・HA3。A3・HA3は壁付き＝床につかない）を入れます。床取合mは有効長×本数（4:0、3:2、2:1、A3:0、H4:0、H3:2、H2:1、HA3:0）です",
  },
};

/** 計算書の欄で選べる種類（今後増やせるようにここに並べる） */
export const CALC_TYPE_OPTIONS: { kind: FireproofSheetKind; title: string }[] = [
  { kind: "column", title: SHEET_KIND.column.title },
  { kind: "beam", title: SHEET_KIND.beam.title },
  { kind: "general", title: "汎用計算書" },
];

/** 表の幅＝列幅の合計（画面いっぱいに広げず、列を小さくできるようにする） */
function tableStyle(widths: number[]): React.CSSProperties {
  const total = widths.reduce((sum, each) => sum + each, 0);
  return { width: `${total}px`, tableLayout: "fixed" };
}

/** 記号の下に出す小さな案内（拾った寸法、または出ない理由） */
export function sizeHint(
  list: FireproofFloorList,
  floor: string,
  symbol: string,
  kind: FireproofTableKind = "column",
): string {
  if (symbol.trim() === "") return "";
  const member = list.members.find(
    (each) => each.symbol.trim() === symbol.trim(),
  );
  if (!member) return "リストにこの記号がありません";
  if (floor.trim() === "") return "階を入れてください";
  if (!list.floors.some((each) => each.label.trim() === floor.trim()))
    return "リストにこの階がありません";
  const size =
    kind === "beam"
      ? findBeamSize(list, floor, symbol)
      : findColumnSize(list, floor, symbol);
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
  const [beamsList, setBeamsList] = useState<FireproofFloorList>({
    floors: [],
    members: [],
  });
  const [rows, setRows] = useState<FireproofManageRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState(0);
  const [clipboard, setClipboard] = useState<FireproofManageRow[]>([]);
  const [opened, setOpened] = useState<{
    index: number;
    kind: FireproofSheetKind;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [numberOptions, setNumberOptions] = useState<Detail[]>([]);
  const history = useUndoRedo<FireproofManageRow[]>();
  const { widths: manageWidths, startResize: startManageResize } =
    useColumnWidths("fireproof-manage-cols-v3", MANAGE_WIDTHS);
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
      setBeamsList(normalizeFloorList(parseJson(record.beamsJson, {})));
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
      beamSheet: {
        ...row.beamSheet,
        rows: row.beamSheet.rows.map((each) => ({ ...each })),
      },
      generalSheet: normalizeSets(row.generalSheet),
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
      calcType: row.calcType,
      detail: { ...row.detail },
      sheet: {
        ...row.sheet,
        rows: row.sheet.rows.map((each) => ({
          ...newColumnRow(),
          ...each,
          id: newColumnRow().id,
        })),
      },
      beamSheet: {
        ...row.beamSheet,
        rows: row.beamSheet.rows.map((each) => ({
          ...newBeamRow(),
          ...each,
          id: newBeamRow().id,
        })),
      },
      generalSheet: normalizeSets(row.generalSheet),
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

  if (opened !== null && rows[opened.index]) {
    const index = opened.index;
    const kind = opened.kind;
    if (kind === "general") {
      return (
        <GeneralSheetView
          project={project}
          row={rows[index]}
          rows={rows}
          part1={inheritedPart1[index] ?? ""}
          columnsList={columnsList}
          beamsList={beamsList}
          options={options}
          onChange={(next) => change(index, next)}
          onBack={() => {
            setOpened(null);
            void save(true);
          }}
          onMessage={setMessage}
        />
      );
    }
    return (
      <ColumnSheetView
        project={project}
        kind={kind}
        row={rows[index]}
        part1={inheritedPart1[index] ?? ""}
        list={kind === "beam" ? beamsList : columnsList}
        options={options}
        detailCell={(key, className) => detailInput(index, key, className)}
        onChange={(next) => change(index, next)}
        onCommit={(next) =>
          commit(rows.map((row, at) => (at === index ? next : row)))
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
        <button
          type="button"
          title="カーソルの行で選んだ計算書を開きます"
          disabled={!rows[start]}
          onClick={() => {
            const row = rows[start];
            if (!row) return;
            setOpened({ index: start, kind: row.calcType });
          }}
        >
          📐 計算書を開く
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
                  ["開く", "open"],
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
                      ? "その行で選んだ計算書の必要数㎡の合計×倍率で自動で出ます（手では打てません）"
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
                  <input
                    lang="ja"
                    value={row.scope}
                    title="積算範囲は自由に書けます（柱・梁型など。名称欄と同じく変換して打てます）"
                    onChange={(event) =>
                      change(index, { scope: event.target.value })
                    }
                  />
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
                  <select
                    value={row.calcType}
                    title="この行で使う計算書を選びます"
                    onChange={(event) =>
                      commit(
                        rows.map((each, at) =>
                          at === index
                            ? {
                                ...each,
                                calcType: event.target
                                  .value as FireproofSheetKind,
                              }
                            : each,
                        ),
                      )
                    }
                  >
                    {CALC_TYPE_OPTIONS.map((each) => (
                      <option key={each.kind} value={each.kind}>
                        {each.title}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="open">
                  <button
                    type="button"
                    title="選んだ計算書を開きます"
                    onClick={() => setOpened({ index, kind: row.calcType })}
                  >
                    📐 開く
                  </button>
                </td>
                <td className="num number">
                  {formatNumber(
                    manageRowQuantity(row, columnsList, beamsList, rows),
                  )}
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
        倍率は未入力なら1です。「計算書」の欄で種類（柱入力表・梁型入力表・汎用計算書）を選んで「📐
        開く」を押すと、先頭行に同じ明細が出て、どちらで直しても両方に反映します。
        数量はその行で選んだ計算書の必要数㎡の合計×倍率です（もう片方の入力は残りますが数量には入りません）。
        汎用計算書は部位別入力表と同じもので、計算式に
        WA・WB・WC（壁取合Ａ・Ｂ・Ｃの合計）、SA・SB・SC・SD（床取合Ａ・Ｂ・Ｃ・Ｄの合計）をはめ込めます（数量はその計算書の合計×倍率）。
      </p>
    </div>
  );
}

/** 柱入力表（1つの明細に対して数量を出す） */
function ColumnSheetView({
  project,
  kind,
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
  kind: FireproofTableKind;
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
  /** 柱入力表と梁型入力表の違い（あとは全部同じ） */
  const config = SHEET_KIND[kind];
  /** この画面で動かす方の入力表（柱＝sheet／梁型＝beamSheet） */
  const sheet = kind === "beam" ? row.beamSheet : row.sheet;
  const withSheet = (nextSheet: FireproofColumnSheet): FireproofManageRow =>
    kind === "beam"
      ? { ...rowRef.current, beamSheet: nextSheet }
      : { ...rowRef.current, sheet: nextSheet };
  const calcRow = kind === "beam" ? calcBeamRow : calcColumnRow;
  const findSize = kind === "beam" ? findBeamSize : findColumnSize;
  const newRow = kind === "beam" ? newBeamRow : newColumnRow;

  const { widths: columnWidths, startResize: startColumnResize } =
    useColumnWidths(config.storageKey, config.widths);
  const start = Math.min(selected, selectedEnd);
  const end = Math.max(selected, selectedEnd);

  const totals =
    kind === "beam"
      ? beamSheetTotals(sheet, list)
      : columnSheetTotals(sheet, list);
  /** 取合mを分ける欄の見出し（柱＝Ａ・Ｂ・Ｃ／梁型＝Ａ・Ｂ・Ｃ・Ｄ） */
  const wallLabels = normalizeWallLabels(sheet.wallLabels, config.markCount);
  /** 階が空欄の行は上の行と同じ階（薄いグレーで出す） */
  const sheetFloors = inheritedFloors(sheet.rows);

  const commitRows = (rows: FireproofColumnRow[]): void => {
    history.push(rowRef.current);
    onCommit(withSheet({ ...sheet, rows }));
  };

  const changeRow = (index: number, patch: Partial<FireproofColumnRow>): void =>
    onChange({
      [kind === "beam" ? "beamSheet" : "sheet"]: {
        ...sheet,
        rows: sheet.rows.map((each, at) =>
          at === index ? { ...each, ...patch } : each,
        ),
      },
    });

  const undo = (): void => {
    const previous = history.undo(rowRef.current);
    if (previous === null) {
      onMessage(`${config.title}：戻せる操作がありません`);
      return;
    }
    onCommit(previous);
  };

  const redo = (): void => {
    const next = history.redo(rowRef.current);
    if (next === null) {
      onMessage(`${config.title}：進める操作がありません`);
      return;
    }
    onCommit(next);
  };

  const copyRows = (): void => {
    const copied = sheet.rows
      .slice(start, end + 1)
      .map((each) => ({ ...each }));
    if (copied.length === 0) return;
    setClipboard(copied);
    onMessage(`⧉ ${config.title}：${copied.length} 行をコピーしました`);
  };

  const pasteRows = (mode: "overwrite" | "insert" | "append"): void => {
    if (clipboard.length === 0) return;
    const fresh = clipboard.map((each) => ({
      ...each,
      id: newRow().id,
    }));
    const next = [...sheet.rows];
    if (mode === "overwrite") next.splice(start, fresh.length, ...fresh);
    if (mode === "insert") next.splice(start, 0, ...fresh);
    if (mode === "append") next.push(...fresh);
    commitRows(next);
    onMessage(`${config.title}：${fresh.length} 行を貼り付けました`);
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
        <h2>{config.title}</h2>
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
          onClick={() => commitRows([...sheet.rows, newRow()])}
        >
          ⤓ 行追加
        </button>
        <button
          type="button"
          onClick={() => {
            const next = [...sheet.rows];
            next.splice(start, 0, newRow());
            commitRows(next);
          }}
        >
          ➕ 行挿入
        </button>
        <button
          type="button"
          onClick={() => commitRows(sheet.rows.filter((_, at) => at !== start))}
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
      <HeadDetailTable detailCell={detailCell} />

      <div className="fireproof-thickness">
        <span>耐火被覆厚み→</span>
        <input
          lang="en"
          value={sheet.thickness === null ? "" : String(sheet.thickness)}
          title="耐火被覆厚みを mm で入れます（例 25。断面必要計算式では m に直して使います。未入力・0 のときは鋼材分だけの式になります）"
          onChange={(event) => {
            const text = toHalfWidth(event.target.value).trim();
            const value = text === "" ? null : Number(text);
            onChange({
              [kind === "beam" ? "beamSheet" : "sheet"]: {
                ...sheet,
                thickness: value === null || Number.isNaN(value) ? null : value,
              },
            });
          }}
        />
        <span className="unit-mm">mm</span>
        {(sheet.thickness === null || sheet.thickness <= 0) && (
          <span className="thickness-note">
            厚みなし＝鋼材分だけの計算書（鉄骨表面の面積）
          </span>
        )}
        <span className="sum">
          必要数㎡ <b>{formatNumber(totals.needed)}</b>
        </span>
        <span className="sum">
          {config.adjacency} <b>{formatNumber(totals.wall)}</b>
        </span>
        {wallLabels.map((label, mark) => (
          <span className="sum" key={mark}>
            {config.adjacency.slice(0, -1)}
            {label} <b>{formatNumber(totals.wallMarks[mark])}</b>
          </span>
        ))}
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
                  [config.adjacency, "num"],
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
              {wallLabels.map((label, mark) => (
                <th key={`mark${mark}`} className="mark">
                  <input
                    className="mark-label"
                    value={label}
                    title={`見出しの名前は書き換えられます。✔を付けた行の${config.adjacency}をこの欄で合計します`}
                    onChange={(event) => {
                      const labels = wallLabels.map((each, index) =>
                        index === mark ? event.target.value : each,
                      );
                      onChange({
                        [kind === "beam" ? "beamSheet" : "sheet"]: {
                          ...sheet,
                          wallLabels: labels,
                        },
                      });
                    }}
                  />
                  <span
                    className="col-resize"
                    title="ドラッグで列幅を変えられます"
                    onMouseDown={(e) => startColumnResize(9 + mark, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((each, index) => {
              // 階が空欄の行は上の行と同じ階として計算する
              const floor = sheetFloors[index] ?? "";
              const calc = calcRow({ ...each, floor }, list, sheet.thickness);
              const size = findSize(list, floor, each.symbol);
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
                      list={`fireproof-floor-list-${kind}`}
                      value={each.floor}
                      placeholder={index > 0 ? floor : ""}
                      title={`直接打てます。▼を押すと鉄骨リストの${config.listLabel}の階から選べます（空欄は上の行と同じ階）`}
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
                      title={
                        size
                          ? `鉄骨リスト：${SHAPE_LABEL[size.shape === "" ? "box" : size.shape]} ${size.first ?? ""}${size.second === null ? "" : `*${size.second}`}`
                          : `鉄骨リストの${config.listLabel}にある記号（${config.symbolPlaceholder}…）を入れます`
                      }
                      onChange={(event) =>
                        changeRow(index, {
                          symbol: toHalfWidth(event.target.value),
                        })
                      }
                    />
                    <span className="size-hint">
                      {sizeHint(list, floor, each.symbol, kind)}
                    </span>
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
                      value={each.mark}
                      title={config.markTitle}
                      onChange={(event) =>
                        changeRow(index, {
                          mark: toHalfWidth(event.target.value).trim(),
                        })
                      }
                    />
                  </td>
                  <td className="formula">
                    <input
                      lang="en"
                      value={each.lengthFormula}
                      title="有効長を打ちます（「3.42」「3.42*2」のように書けます）"
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
                  {wallLabels.map((label, mark) => (
                    <td className="mark" key={mark}>
                      <input
                        type="checkbox"
                        checked={each.wallChecks[mark] === true}
                        title={`この行の${config.adjacency}を${label}の欄で合計します`}
                        onChange={(event) => {
                          const checks = each.wallChecks.map((checked, at) =>
                            at === mark ? event.target.checked : checked,
                          );
                          changeRow(index, { wallChecks: checks });
                        }}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id={`fireproof-floor-list-${kind}`}>
          {floorEntries.map((label, index) => (
            <option key={`${index}-${label}`} value={label} />
          ))}
        </datalist>
        {/* 取合記号表（資料どおり。✔欄の右に独立して出す） */}
        <table className="grid mark-table">
          <thead>
            <tr>
              <th colSpan={3}>取合記号</th>
            </tr>
          </thead>
          <tbody>
            {kind === "beam"
              ? // 梁型（資料の取合記号表どおり。A3・HA3は壁付き＝床につかない）
                (
                  [
                    ["Ｈ鋼", "独立4面", "4"],
                    ["Ｈ鋼", "床付3面", "3"],
                    ["Ｈ鋼", "壁・床付2面", "2"],
                    ["Ｈ鋼", "壁付3面", "A3"],
                    ["箱型", "独立4面", "H4"],
                    ["箱型", "床付3面", "H3"],
                    ["箱型", "壁・床付2面", "H2"],
                    ["箱型", "壁付3面", "HA3"],
                  ] as const
                ).map(([shape, name, mark], index) => (
                  <tr key={index}>
                    <td className="shape">{shape}</td>
                    <td>{name}</td>
                    <td className="code">{mark}</td>
                  </tr>
                ))
              : // 柱（1〜4は□・Ｈ鋼どちらにも使える。箱型はH1〜H4も）
                (
                  [
                    ["□・Ｈ鋼", "面の数", "1〜4"],
                    ["箱型", "面の数", "H1〜H4"],
                  ] as const
                ).map(([shape, name, mark], index) => (
                  <tr key={index}>
                    <td className="shape">{shape}</td>
                    <td>{name}</td>
                    <td className="code">{mark}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {kind === "beam" ? (
          <>
            階は直接打つか▼から鉄骨リストの階を選び、記号に梁リストの記号（G1…）を入れます。記号の右横に拾った寸法（出ない理由）が出ます。
            取合の欄は取合記号（Ｈ鋼：4・3・2・A3／箱型：H4・H3・H2・HA3。右の表参照）を入れます。A3・HA3は壁付き＝床につかない梁型です。
            床取合mの右のＡ・Ｂ・Ｃ・Ｄの欄に✔を付けると、その行の床取合mがその欄で合計されます（上の帯に4種類出ます）。見出しは書き換えられます。
          </>
        ) : (
          <>
            階は直接打つか▼から鉄骨リストの階を選び、記号に柱リストの記号（C1…）を入れます。記号の右横に拾った寸法（出ない理由）が出ます。
            取合の欄は面の数（1〜4。□・Ｈ鋼どちらにも使えます）のほか箱型の記号（H1〜H4。同じ面数で計算します）も入れられます（A3・HA3は梁型側の記号です）。
            壁取合mの右のＡ・Ｂ・Ｃの欄に✔を付けると、その行の壁取合mがその欄で合計されます（上の帯に3種類出ます）。見出しのＡ・Ｂ・Ｃは書き換えられます。
          </>
        )}
        断面必要計算式は資料の図のとおり自動で薄く出します（□：4面
        Ｗ*2+Ｄ*2+厚み*4／3面 Ｗ*2+Ｄ+厚み*2／2面 Ｗ+Ｄ+厚み／1面 Ｄ、Ｈ：4面
        Ｗ*2+Ｄ*4+厚み*4／3面 Ｗ*2+Ｄ*3+厚み*2／2面 Ｗ+Ｄ+Ｄ/2*2+厚み／1面
        Ｄ。厚みは25mmなら0.025）。厚みが未入力・0のときは厚み分を足さず鋼材分だけの式（鉄骨表面の面積）になります。欄に打つとその式が優先します。
        表の列幅は見出しの右端をドラッグして変えられます。
        必要数㎡は断面×計算式(有効長)×倍数、{config.adjacency}は有効長×本数
        {kind === "beam"
          ? "（4:0、3:2、2:1、A3:0、H4:0、H3:2、H2:1、HA3:0）"
          : "（4面（H4）は0、それ以外は2）"}
        です。
      </p>
    </div>
  );
}

/** 計算書先頭の明細行（管理表と同じ明細。どちらで直しても両方に反映） */
function HeadDetailTable({
  detailCell,
}: {
  detailCell: (
    key: keyof FireproofManageDetail,
    className?: string,
  ) => JSX.Element;
}): JSX.Element {
  const { widths, startResize } = useColumnWidths(
    "fireproof-head-detail-cols",
    HEAD_DETAIL_WIDTHS,
  );
  return (
    <table className="grid fireproof-manage head" style={tableStyle(widths)}>
      <colgroup>
        {HEAD_DETAIL_WIDTHS.map((_, index) => (
          <col key={index} style={{ width: `${widths[index]}px` }} />
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
                onMouseDown={(e) => startResize(index, e)}
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
  );
}

/** 汎用計算書（部位別入力表と同じもの。WA〜WC・SA〜SDで取合の合計を拾える） */
function GeneralSheetView({
  project,
  row,
  rows,
  part1,
  columnsList,
  beamsList,
  options,
  onChange,
  onBack,
  onMessage,
}: {
  project: ProjectSummary;
  row: FireproofManageRow;
  rows: FireproofManageRow[];
  part1: string;
  columnsList: FireproofFloorList;
  beamsList: FireproofFloorList;
  options: MasterOptions;
  onChange: (patch: Partial<FireproofManageRow>) => void;
  onBack: () => void;
  onMessage: (text: string) => void;
}): JSX.Element {
  const [calcFocus, setCalcFocus] = useState<CalcFocus | null>(null);
  const [jumpTick, setJumpTick] = useState(0);
  const [warnedKey, setWarnedKey] = useState("");
  /** 取合記号（WA〜WC・SA〜SD）にはめ込む数量＝入力表全体の柱入力表・梁型入力表の欄ごとの合計 */
  const variables = useMemo(
    () => adjacencyVariables(rows, columnsList, beamsList),
    [beamsList, columnsList, rows],
  );
  const result = useMemo(
    () => evaluateCalcSheet(row.generalSheet, variables),
    [row.generalSheet, variables],
  );

  const closePage = (): void => {
    const errorKey = result.errors
      .map((error) => `${error.lineId}:${error.message}`)
      .join("|");
    if (result.errors.length > 0 && errorKey !== warnedKey) {
      const first = result.errors[0];
      const set = row.generalSheet.find((each) => each.id === first.setId);
      const found = set?.lines.findIndex((line) => line.id === first.lineId);
      const index = found === undefined || found < 0 ? 0 : found;
      setCalcFocus({
        setId: first.setId,
        area:
          set?.lines[index] && set.lines[index].formulaA.trim() === ""
            ? "formulaB"
            : "formulaA",
        index,
      });
      setJumpTick((tick) => tick + 1);
      setWarnedKey(errorKey);
      onMessage(
        `計算式の誤りが${result.errors.length}件あります（${first.message}）。誤りの計算式へカーソルを移しました。直さずに閉じるときは、もう一度押してください`,
      );
      return;
    }
    onBack();
  };

  return (
    <div className="estimate-page fireproof-estimate-page">
      <div className="toolbar">
        <button type="button" onClick={closePage}>
          ← 入力管理表へ
        </button>
        <h2>汎用計算書</h2>
        <span className="project">
          {project.managementNo} {project.name}
          {part1 ? `　${part1}` : ""}
        </span>
        <span className="adjacency-symbols">
          {(["WA", "WB", "WC", "SA", "SB", "SC", "SD"] as const).map(
            (symbol) => (
              <span className="sum" key={symbol}>
                {symbol} <b>{formatNumber(variables[symbol] ?? 0)}</b>
              </span>
            ),
          )}
        </span>
      </div>

      <RoomCalcSheet
        sets={row.generalSheet}
        onChange={(sets: CalcSet[]) => onChange({ generalSheet: sets })}
        variables={variables}
        options={options}
        projectId={project.id}
        focus={calcFocus}
        onFocus={setCalcFocus}
        jumpTick={jumpTick}
        result={result}
        onMessage={onMessage}
        hasUpper={false}
        windowTitle={`汎用計算書　${project.managementNo}`}
      />

      <p className="hint">
        汎用計算書は部位別入力表のものと同じです。計算式には数字のほか、WA・WB・WC（この入力表の柱入力表の壁取合Ａ・Ｂ・Ｃの合計）、
        SA・SB・SC・SD（梁型入力表の床取合Ａ・Ｂ・Ｃ・Ｄの合計）、B1〜B100（他セットの累計）がはめ込めます。
        集計にはこの計算書のセット明細（数量＝セット累計×掛け率×倍率）がそのまま載ります（入力管理表の明細欄は未入力でかまいません）。
      </p>
    </div>
  );
}
