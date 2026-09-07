import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  Detail,
  FurnitureSheet,
  MasterEntry,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import {
  applyFurnitureDetails,
  furnitureCellValue,
  furnitureColumn,
  furnitureColumnTotal,
  furnitureRow,
  furnitureSettings,
  isEmptyFurnitureColumn,
  resolveFurnitureRows,
  rowQuantity,
  type FurnitureColumn,
  type FurnitureDetail,
  type FurnitureRow,
  type FurnitureSettings,
  type FurnitureSymbol,
} from "../../../../core/furniture/furnitureSheet";
import { PickInput, type PickEntry } from "../../components/PickInput";
import { useSaveOnLeave } from "../../hooks/useSaveOnLeave";
import "./RoomCalcSheet.css";
import "./EstimatePartsPage.css";
import "./FurnitureSheetPage.css";

interface Props {
  project: ProjectSummary;
  options: MasterOptions;
  sheetId: number;
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

/** 呼び出し窓（設定・マスター呼出）を見出しのドラッグで動かす */
function useDragWindow(): {
  style: CSSProperties | undefined;
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
} {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (
      event.target instanceof Element &&
      event.target.closest("button, input, select, textarea, label") !== null
    ) {
      return;
    }
    const box = event.currentTarget.parentElement;
    if (!box) return;
    event.preventDefault();
    const rect = box.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const move = (moveEvent: MouseEvent): void =>
      setPosition({
        x: Math.max(0, moveEvent.clientX - offsetX),
        y: Math.max(0, moveEvent.clientY - offsetY),
      });
    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return {
    style:
      position === null
        ? undefined
        : { left: position.x, top: position.y, right: "auto" },
    onMouseDown,
  };
}

/** 入力欄の列（表示・非表示を切り替えられる） */
const INPUT_COLUMNS: { key: string; label: string; forDetail: boolean }[] = [
  { key: "subjectId", label: "科目", forDetail: true },
  { key: "partNumber", label: "部位ID", forDetail: true },
  { key: "detailNumber", label: "名称ID", forDetail: true },
  { key: "part", label: "部位", forDetail: false },
  { key: "partAdd", label: "+部位", forDetail: false },
  { key: "partSymbol", label: "+部位(記号)", forDetail: false },
  { key: "nameSymbol", label: "名称", forDetail: false },
  { key: "width", label: "W", forDetail: false },
  { key: "height", label: "H", forDetail: false },
  { key: "depth", label: "D", forDetail: false },
  { key: "quantity", label: "数量", forDetail: false },
  { key: "unit", label: "単位", forDetail: false },
  { key: "descriptionUpper", label: "摘要(上段)", forDetail: false },
  { key: "remarksLower", label: "備考(下段)", forDetail: false },
];

/** 右側の明細欄の列（数量は「明細:単位」の前に出す） */
const DETAIL_COLUMNS: { key: keyof FurnitureDetail; label: string }[] = [
  { key: "subjectId", label: "科目" },
  { key: "partNumber", label: "部位ID" },
  { key: "detailNumber", label: "名称ID" },
  { key: "partName", label: "部位" },
  { key: "name", label: "名称" },
  { key: "descriptionLower", label: "摘要(下段)" },
  { key: "descriptionUpper", label: "摘要(上段)" },
  { key: "formula", label: "計算式" },
  { key: "unit", label: "単位" },
  { key: "remarksLower", label: "備考(下段)" },
  { key: "remarksUpper", label: "備考(上段)" },
];

/** 明細側に並べる列（数量＋明細欄）。まとめて出す・消すができる */
type DetailCell =
  | { kind: "quantity"; id: string; label: string }
  | { kind: "detail"; id: string; label: string; key: keyof FurnitureDetail };

const DETAIL_CELLS: DetailCell[] = DETAIL_COLUMNS.flatMap((column) => {
  const cell: DetailCell = {
    kind: "detail",
    id: `d:${String(column.key)}`,
    label: `明細:${column.label}`,
    key: column.key,
  };
  return column.key === "unit"
    ? [{ kind: "quantity", id: "d:quantity", label: "明細:数量" }, cell]
    : [cell];
});

/** マスター呼出の元（基準マスター／この工事でできた明細） */
type CallSource = "basic" | "project";

const SOURCE_LABEL: Record<CallSource, string> = {
  basic: "基準マスター（明細）",
  project: "工事マスター（明細）",
};

/** タテ方向の明細（列）の見出し。上から順に1行ずつ出す */
type HeadKind = "subject" | "pickupPart" | "detailNumber" | "unit" | "text";

const COLUMN_HEADS: {
  key: keyof FurnitureColumn;
  label: string;
  kind: HeadKind;
}[] = [
  { key: "subjectId", label: "科目", kind: "subject" },
  { key: "partNumber", label: "部位ID", kind: "pickupPart" },
  { key: "detailNumber", label: "名称ID", kind: "detailNumber" },
  { key: "partName", label: "部位", kind: "text" },
  { key: "name", label: "名称", kind: "text" },
  { key: "descriptionUpper", label: "摘要(上段)", kind: "text" },
  { key: "descriptionLower", label: "摘要(下段)", kind: "text" },
  { key: "unit", label: "単位", kind: "unit" },
  { key: "remarksUpper", label: "備考(上段)", kind: "text" },
  { key: "remarksLower", label: "備考(下段)", kind: "text" },
];

/** 列幅は文字が見えなくなるほど細くできる */
const MIN_WIDTH = 8;
/** 列幅を変えるつまみの幅（見出しの右端からの距離） */
const RESIZE_GRIP = 8;
const OPS_WIDTH = 46;
const NO_WIDTH = 34;
const INPUT_DEFAULT = 80;
const DETAIL_DEFAULT = 100;
const COLUMN_DEFAULT = 90;
/** タテの明細の見出し（科目・部位ID…）を出す列 */
const LABEL_WIDTH = 72;

function readWidths(key: string): Record<string, number> {
  const saved = window.localStorage.getItem(key);
  if (saved === null) return {};
  try {
    const parsed: unknown = JSON.parse(saved);
    if (parsed === null || typeof parsed !== "object") return {};
    const result: Record<string, number> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([id, value]) => {
      if (typeof value === "number" && value >= MIN_WIDTH) result[id] = value;
    });
    return result;
  } catch {
    return {};
  }
}

/** 非表示にした列（次に開いたときも同じにする） */
const HIDDEN_KEY = "furniture-hidden";

function readHidden(): string[] {
  const saved = window.localStorage.getItem(HIDDEN_KEY);
  if (saved === null) return [];
  try {
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function detailText(
  detail: FurnitureDetail,
  key: keyof FurnitureDetail,
): string {
  const value = detail[key];
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

function columnText(
  column: FurnitureColumn,
  key: keyof FurnitureColumn,
): string {
  const value = column[key];
  if (value === null) return "";
  return typeof value === "string" ? value : String(value);
}

/** 記号と表示文字の対応表（＋部位・名称） */
function SymbolTable({
  title,
  symbols,
  onChange,
}: {
  title: string;
  symbols: FurnitureSymbol[];
  onChange: (next: FurnitureSymbol[]) => void;
}): JSX.Element {
  const rows = [...symbols, { symbol: "", text: "" }];
  /** 同じ記号は使えない（この計算書は記号→文字で置き換えるため） */
  const duplicated = new Set(
    symbols
      .map((item) => item.symbol.trim())
      .filter(
        (symbol, index, all) =>
          symbol !== "" && all.indexOf(symbol) !== index,
      ),
  );
  const change = (index: number, patch: Partial<FurnitureSymbol>): void => {
    const next = [...symbols];
    if (index === symbols.length) next.push({ symbol: "", text: "", ...patch });
    else next[index] = { ...next[index], ...patch };
    onChange(
      next.filter((item) => item.symbol !== "" || item.text !== ""),
    );
  };
  return (
    <div className="symbol-table">
      <b>{title}</b>
      <table>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${title}${index}`}>
              <td>
                <input
                  className={
                    duplicated.has(row.symbol.trim()) ? "duplicated" : ""
                  }
                  title={
                    duplicated.has(row.symbol.trim())
                      ? "同じ記号が2つ以上あります"
                      : "記号（英数字）"
                  }
                  value={row.symbol}
                  onChange={(event) =>
                    change(index, { symbol: event.target.value })
                  }
                />
              </td>
              <td>→</td>
              <td>
                <input
                  lang="ja"
                  value={row.text}
                  onChange={(event) =>
                    change(index, { text: event.target.value })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 家具計算書（システム収納などの拾い）。
 * 左の入力欄から右の明細欄（ヨコ1行＝1明細）を自動で作り、右は手で直せる。
 * さらにその右に、部位別雑・金物入力表と同じタテ方向の明細（列）を拾える。
 */
export default function FurnitureSheetPage({
  project,
  options,
  sheetId,
  onBack,
}: Props): JSX.Element {
  const [sheet, setSheet] = useState<FurnitureSheet | null>(null);
  const [rows, setRows] = useState<FurnitureRow[]>([]);
  const [columns, setColumns] = useState<FurnitureColumn[]>([]);
  const [settings, setSettings] = useState<FurnitureSettings>(
    furnitureSettings(),
  );
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [showSettings, setShowSettings] = useState(false);
  const settingsDrag = useDragWindow();
  const callDrag = useDragWindow();
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState(0);
  const [pickedColumn, setPickedColumn] = useState<string | null>(null);
  /** タテ明細の名称ID欄の候補（選んだ科目の明細） */
  const [numberOptions, setNumberOptions] = useState<Detail[]>([]);
  /** マスター呼出画面（部位別雑・金物入力表と同じ作り） */
  const [callOpen, setCallOpen] = useState(false);
  const [callSource, setCallSource] = useState<CallSource>("basic");
  const [callInsert, setCallInsert] = useState(false);
  const [callSubjectId, setCallSubjectId] = useState<number | null>(null);
  const [callSubjectNumber, setCallSubjectNumber] = useState("");
  const [callDetails, setCallDetails] = useState<Detail[]>([]);
  const widthKey = `furniture-widths:${project.id}`;
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    readWidths(`furniture-widths:${project.id}`),
  );
  const widthRef = useRef(widths);
  widthRef.current = widths;

  const { markSaved } = useSaveOnLeave({ rows, columns, settings }, () =>
    save(true),
  );

  const save = useCallback(
    async (quiet = false): Promise<void> => {
      if (!sheet) return;
      const saved = await window.sekisan.saveFurnitureSheet({
        id: sheet.id,
        name: sheet.name,
        part1: sheet.part1,
        part2: sheet.part2,
        part2Split: sheet.part2Split,
        multiplier: sheet.multiplier,
        kind: sheet.kind,
        rowsJson: JSON.stringify(rows),
        columnsJson: JSON.stringify(columns),
        settingsJson: JSON.stringify(settings),
        note: sheet.note,
      });
      setSheet(saved);
      markSaved({ rows, columns, settings });
      if (!quiet)
        setMessage("保存しました（建具表へ転記し、集計実行で集計書に入ります）");
    },
    [columns, markSaved, rows, settings, sheet],
  );

  useEffect(() => {
    void (async () => {
      const loaded = await window.sekisan.getFurnitureSheet(sheetId);
      const loadedRows = parseJson<FurnitureRow[]>(loaded.rowsJson, []);
      const nextRows = loadedRows.length > 0 ? loadedRows : [furnitureRow()];
      const loadedColumns = parseJson<FurnitureColumn[]>(
        loaded.columnsJson,
        [],
      );
      const nextColumns =
        loadedColumns.length > 0 ? loadedColumns : [furnitureColumn()];
      const saved = parseJson<Partial<FurnitureSettings>>(
        loaded.settingsJson,
        {},
      );
      // 古い保存（記号表が無い・空）でも初めの並びが出るようにする
      const base = furnitureSettings();
      const nextSettings: FurnitureSettings = {
        ...base,
        ...saved,
        partSymbols:
          saved.partSymbols === undefined || saved.partSymbols.length === 0
            ? base.partSymbols
            : saved.partSymbols,
        nameSymbols:
          saved.nameSymbols === undefined || saved.nameSymbols.length === 0
            ? base.nameSymbols
            : saved.nameSymbols,
      };
      setSheet(loaded);
      setRows(nextRows);
      setColumns(nextColumns);
      setSettings(nextSettings);
      markSaved({
        rows: nextRows,
        columns: nextColumns,
        settings: nextSettings,
      });
    })();
  }, [markSaved, sheetId]);

  useEffect(() => {
    window.localStorage.setItem(widthKey, JSON.stringify(widths));
  }, [widthKey, widths]);
  useEffect(() => {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
  }, [hidden]);

  /** 右端をドラッグして列幅を変える */
  const startResize = useCallback(
    (id: string, defaultWidth: number, event: React.MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = widthRef.current[id] ?? defaultWidth;
      const move = (e: MouseEvent): void =>
        setWidths({
          ...widthRef.current,
          [id]: Math.max(MIN_WIDTH, startWidth + e.clientX - startX),
        });
      const up = (): void => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [],
  );

  /** 見出しの右端近く（つまみ）を押したときだけ列幅の変更を始める */
  const resizeAtEdge = useCallback(
    (id: string, defaultWidth: number, event: React.MouseEvent): void => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.right - event.clientX <= RESIZE_GRIP) {
        startResize(id, defaultWidth, event);
      }
    },
    [startResize],
  );

  const widthOf = (id: string, defaultWidth: number): number =>
    widths[id] ?? defaultWidth;

  /** 右の明細欄は左の入力欄から作る（手で直した欄はそのまま残る） */
  const view = useMemo(
    () => applyFurnitureDetails(rows, settings),
    [rows, settings],
  );
  const resolved = useMemo(() => resolveFurnitureRows(view), [view]);

  const subjectEntries = useMemo<PickEntry[]>(
    () =>
      options.subjects.map((subject) => ({
        value: String(subject.id),
        label: subject.name,
      })),
    [options.subjects],
  );
  const pickupPartEntries = useMemo<PickEntry[]>(
    () =>
      options.pickupParts.map((part) => ({
        value: String(part.id),
        label: `${part.name}${part.note ? `　${part.note}` : ""}`,
      })),
    [options.pickupParts],
  );
  const unitEntries = useMemo<PickEntry[]>(
    () => options.units.map((unit) => ({ value: unit.name, label: unit.name })),
    [options.units],
  );
  const numberEntries = useMemo<PickEntry[]>(
    () =>
      numberOptions.map((item) => ({
        value: item.detailNumber?.toFixed(2) ?? "",
        label: `${item.partName} ${item.name} ${item.descriptionLower}`.trim(),
      })),
    [numberOptions],
  );

  /** 名称ID欄に入ったとき、その科目の明細を候補として読み込む（工事→基準の順） */
  const loadNumberOptions = useCallback(
    async (subjectId: number | null): Promise<void> => {
      if (subjectId === null) {
        setNumberOptions([]);
        return;
      }
      const forProject = await window.sekisan.listDetails(subjectId, project.id);
      const basic = await window.sekisan.listDetails(subjectId, null);
      const numbers = new Set(forProject.map((row) => row.detailNumber));
      setNumberOptions([
        ...forProject,
        ...basic.filter((row) => !numbers.has(row.detailNumber)),
      ]);
    },
    [project.id],
  );

  // 呼出画面に出す明細（基準マスター＝全明細／工事マスター＝この工事でできた明細）
  useEffect(() => {
    if (!callOpen || callSubjectId === null) {
      setCallDetails([]);
      return;
    }
    void (async () =>
      setCallDetails(
        callSource === "project"
          ? await window.sekisan.listProjectDetailsInUse(
              callSubjectId,
              project.id,
            )
          : await window.sekisan.listDetails(callSubjectId, project.id),
      ))();
  }, [callOpen, callSource, callSubjectId, project.id]);

  /** 呼出画面からタテ明細（列）に入れる（上書き呼出＝選んでいる列／挿入呼出＝その左に足す） */
  const callDetail = useCallback(
    (detail: Detail): void => {
      const patch: Partial<FurnitureColumn> = {
        subjectId: detail.subjectId,
        materialCategory: detail.materialCategory,
        partNumber:
          detail.partNumber ??
          options.pickupParts.find((part) => part.name === detail.partName)
            ?.id ??
          null,
        detailNumber: detail.detailNumber,
        partName: detail.partName,
        name: detail.name,
        descriptionUpper: detail.descriptionUpper,
        descriptionLower: detail.descriptionLower,
        unit: detail.unit,
        remarksUpper: detail.remarksUpper,
        remarksLower: detail.remarksLower,
        sourceDetailId: detail.id,
      };
      setColumns((current) => {
        const at = current.findIndex((column) => column.id === pickedColumn);
        if (at < 0) {
          const created = furnitureColumn(patch);
          setPickedColumn(created.id);
          return [...current, created];
        }
        if (callInsert) {
          const created = furnitureColumn(patch);
          setPickedColumn(created.id);
          return [...current.slice(0, at), created, ...current.slice(at)];
        }
        if (isEmptyFurnitureColumn(current[at])) {
          return current.map((column, index) =>
            index === at ? { ...column, ...patch } : column,
          );
        }
        const created = furnitureColumn(patch);
        setPickedColumn(created.id);
        return [...current.slice(0, at + 1), created, ...current.slice(at + 1)];
      });
      setMessage(`${detail.name} を呼び出しました`);
    },
    [callInsert, options.pickupParts, pickedColumn],
  );

  const editRow = (index: number, patch: Partial<FurnitureRow>): void => {
    setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  };

  /** 右の明細欄を手で直す（直した欄は自動作成で上書きしない） */
  const editDetail = (
    index: number,
    patch: Partial<FurnitureDetail>,
  ): void => {
    setRows(
      rows.map((row, at) => {
        if (at !== index) return row;
        const edited = [...row.detail.edited];
        Object.keys(patch).forEach((key) => {
          if (key !== "formula" && !edited.includes(key)) edited.push(key);
        });
        return {
          ...row,
          detail: { ...view[index].detail, ...patch, edited },
        };
      }),
    );
  };

  const addRow = (at: number): void => {
    const next = [...rows];
    next.splice(at, 0, furnitureRow());
    setRows(next);
    setPicked(at);
  };

  const removeRow = (at: number): void => {
    if (rows.length <= 1) return;
    setRows(rows.filter((_row, index) => index !== at));
  };

  const moveRow = (at: number, step: number): void => {
    const to = at + step;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const moved = next.splice(at, 1)[0];
    next.splice(to, 0, moved);
    setRows(next);
    setPicked(to);
  };

  const editColumn = (id: string, patch: Partial<FurnitureColumn>): void =>
    setColumns(
      columns.map((column) =>
        column.id === id ? { ...column, ...patch } : column,
      ),
    );

  /** タテ方向の明細（列）を足す */
  const addColumn = (): void => {
    const created = furnitureColumn();
    setColumns([...columns, created]);
    setPickedColumn(created.id);
    setMessage("タテの明細を足しました");
  };

  /** タテの明細は少なくとも1列は残す（入力欄が見えるように） */
  const removeColumn = (id: string): void => {
    const rest = columns.filter((column) => column.id !== id);
    setColumns(rest.length > 0 ? rest : [furnitureColumn()]);
    if (pickedColumn === id) setPickedColumn(null);
  };

  const moveColumn = (step: number): void => {
    const at = columns.findIndex((column) => column.id === pickedColumn);
    const to = at + step;
    if (at < 0 || to < 0 || to >= columns.length) return;
    const next = [...columns];
    const [moved] = next.splice(at, 1);
    next.splice(to, 0, moved);
    setColumns(next);
  };

  /** タテの明細のマス（行×列）に数量（計算式も可）を入れる */
  const editCell = (rowId: string, columnId: string, text: string): void =>
    setRows(
      rows.map((row) =>
        row.id === rowId
          ? { ...row, values: { ...(row.values ?? {}), [columnId]: text } }
          : row,
      ),
    );

  /** 名称ID（明細番号）を入れたら、その明細をマスターから呼び出して列に入れる */
  const applyDetailNumber = useCallback(
    async (column: FurnitureColumn, text: string): Promise<void> => {
      const value = text.trim();
      if (value === "") {
        setColumns((current) =>
          current.map((each) =>
            each.id === column.id ? { ...each, detailNumber: null } : each,
          ),
        );
        return;
      }
      const number = Number.parseFloat(value);
      if (Number.isNaN(number)) {
        setMessage("名称ID（明細番号）は数字で入れてください");
        return;
      }
      const targets =
        column.subjectId === null
          ? options.subjects.map((subject) => subject.id)
          : [column.subjectId];
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
          const part = column.partName.trim();
          found =
            (part === ""
              ? undefined
              : hits.find((item) => item.partName.trim() === part)) ?? hits[0];
          break;
        }
        if (found) break;
      }
      const detail = found;
      if (detail === undefined) {
        setColumns((current) =>
          current.map((each) =>
            each.id === column.id ? { ...each, detailNumber: number } : each,
          ),
        );
        setMessage(`名称ID ${value} の明細が見つかりません`);
        return;
      }
      const keepPart = column.partNumber !== null || column.partName !== "";
      setColumns((current) =>
        current.map((each) =>
          each.id === column.id
            ? {
                ...each,
                sourceDetailId: detail.id,
                subjectId: detail.subjectId,
                detailNumber: detail.detailNumber,
                materialCategory:
                  detail.materialCategory || each.materialCategory,
                partNumber: keepPart
                  ? each.partNumber
                  : (options.pickupParts.find(
                      (part) => part.name === detail.partName,
                    )?.id ?? null),
                partName: keepPart ? each.partName : detail.partName,
                name: detail.name,
                descriptionUpper: detail.descriptionUpper,
                descriptionLower: detail.descriptionLower,
                unit: detail.unit || each.unit,
                remarksUpper: detail.remarksUpper,
                remarksLower: detail.remarksLower,
              }
            : each,
        ),
      );
      setMessage(`${detail.name} を呼び出しました`);
    },
    [options.pickupParts, options.subjects, project.id],
  );

  const visible = (key: string): boolean => !hidden.includes(key);

  const toggleColumnView = (key: string): void => {
    setHidden(
      hidden.includes(key)
        ? hidden.filter((item) => item !== key)
        : [...hidden, key],
    );
  };

  const changeSettings = (patch: Partial<FurnitureSettings>): void => {
    setSettings({ ...settings, ...patch });
  };

  const inputColumns = INPUT_COLUMNS.filter((column) => visible(column.key));
  const detailCells = visible("detail") ? DETAIL_CELLS : [];
  const headRowCount = COLUMN_HEADS.length + 1;

  const tableWidth =
    OPS_WIDTH +
    NO_WIDTH +
    inputColumns.reduce(
      (sum, column) => sum + widthOf(column.key, INPUT_DEFAULT),
      0,
    ) +
    detailCells.reduce((sum, cell) => sum + widthOf(cell.id, DETAIL_DEFAULT), 0) +
    LABEL_WIDTH +
    columns.reduce((sum, column) => sum + widthOf(column.id, COLUMN_DEFAULT), 0);

  /** タテの明細（列）の1マス分の入力欄 */
  const headCell = (
    column: FurnitureColumn,
    head: (typeof COLUMN_HEADS)[number],
  ): JSX.Element => {
    if (head.kind === "subject") {
      return (
        <PickInput
          entries={subjectEntries}
          halfWidth
          value={column.subjectId === null ? "" : String(column.subjectId)}
          title="科目"
          onFocus={() => setPickedColumn(column.id)}
          onCommit={(text) => {
            const id = Number.parseInt(text.trim(), 10);
            editColumn(column.id, { subjectId: Number.isNaN(id) ? null : id });
          }}
        />
      );
    }
    if (head.kind === "pickupPart") {
      return (
        <PickInput
          entries={pickupPartEntries}
          halfWidth
          value={column.partNumber === null ? "" : String(column.partNumber)}
          title="部位ID"
          onFocus={() => setPickedColumn(column.id)}
          onCommit={(text) => {
            const found = pickMaster(options.pickupParts, text);
            editColumn(column.id, {
              partNumber: found.id,
              partName: found.id === null ? column.partName : found.name,
            });
          }}
        />
      );
    }
    if (head.kind === "detailNumber") {
      return (
        <PickInput
          entries={numberEntries}
          halfWidth
          commitOnBlur
          value={column.detailNumber?.toFixed(2) ?? ""}
          title="名称ID（明細番号）を入れるとマスターの明細を呼び出します（科目を入れると一覧から選べます）"
          onFocus={() => {
            setPickedColumn(column.id);
            void loadNumberOptions(column.subjectId);
          }}
          onCommit={(text) => {
            if (text.trim() === (column.detailNumber?.toFixed(2) ?? "")) return;
            void applyDetailNumber(column, text);
          }}
        />
      );
    }
    if (head.kind === "unit") {
      return (
        <PickInput
          entries={unitEntries}
          halfWidth
          value={column.unit}
          title="単位"
          onFocus={() => setPickedColumn(column.id)}
          onCommit={(text) =>
            editColumn(column.id, {
              unit: pickMaster(options.units, text).name,
            })
          }
        />
      );
    }
    return (
      <input
        lang="ja"
        value={columnText(column, head.key)}
        placeholder={head.label}
        title={head.label}
        onFocus={() => setPickedColumn(column.id)}
        onChange={(event) =>
          editColumn(column.id, {
            [head.key]: event.target.value,
          } as Partial<FurnitureColumn>)
        }
      />
    );
  };

  if (!sheet)
    return <div className="estimate-page furniture-page">読み込み中…</div>;

  return (
    <div className="estimate-page furniture-page">
      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            void save(true).then(onBack);
          }}
        >
          ← 家具・設備入力表（一覧）へ
        </button>
        <h2>家具計算書</h2>
        <span className="project">
          {sheet.name}／{project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => addRow(picked + 1)}>
          ＋ 行を足す
        </button>
        <button type="button" onClick={() => removeRow(picked)}>
          － 行を消す
        </button>
        <button type="button" onClick={() => moveRow(picked, -1)}>
          ↑
        </button>
        <button type="button" onClick={() => moveRow(picked, 1)}>
          ↓
        </button>
        <button
          type="button"
          title="右側にタテ方向の明細（部位別雑・金物入力表と同じ形）を足します"
          onClick={addColumn}
        >
          ➕ タテ明細
        </button>
        <button
          type="button"
          title="選んでいるタテの明細を左へ動かします"
          onClick={() => moveColumn(-1)}
        >
          ← 明細
        </button>
        <button
          type="button"
          title="選んでいるタテの明細を右へ動かします"
          onClick={() => moveColumn(1)}
        >
          明細 →
        </button>
        <button
          type="button"
          className={callOpen ? "on" : ""}
          title="タテの明細にマスターの明細を呼び出します"
          onClick={() => setCallOpen(!callOpen)}
        >
          📂 マスター呼出
        </button>
        <button
          type="button"
          className={showSettings ? "on" : ""}
          onClick={() => setShowSettings(!showSettings)}
        >
          ⚙ 設定
        </button>
        <button type="button" onClick={() => window.print()}>
          🖨 印刷
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      <div className="furniture-columns">
        表示する列：
        {INPUT_COLUMNS.map((column) => (
          <label key={column.key}>
            <input
              type="checkbox"
              checked={visible(column.key)}
              onChange={() => toggleColumnView(column.key)}
            />
            {column.label}
          </label>
        ))}
        <label className="detail-toggle">
          <input
            type="checkbox"
            checked={visible("detail")}
            onChange={() => toggleColumnView("detail")}
          />
          明細（数量〜備考(上段)）
        </label>
        <button
          type="button"
          className="width-reset"
          title="変えた列幅をもとに戻します"
          onClick={() => setWidths({})}
        >
          列幅を戻す
        </button>
      </div>

      {callOpen && (
        <div className="room-calc-sheet no-print">
          <div className="call-window" style={callDrag.style}>
            <div
              className="section-bar drag"
              onMouseDown={callDrag.onMouseDown}
              title="この見出しをドラッグすると呼出画面を動かせます"
            >
              <span>マスター呼出（タテ明細・見出しをドラッグで移動）</span>
              {(Object.keys(SOURCE_LABEL) as CallSource[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={callSource === key ? "on" : ""}
                  onClick={() => setCallSource(key)}
                >
                  {SOURCE_LABEL[key]}
                </button>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={!callInsert}
                  onChange={() => setCallInsert(false)}
                />
                上書き呼出
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={callInsert}
                  onChange={() => setCallInsert(true)}
                />
                挿入呼出
              </label>
              <span className="call-target">
                書込先：
                {pickedColumn === null ||
                !columns.some((column) => column.id === pickedColumn)
                  ? "（新しいタテ明細）"
                  : `タテ明細 ${columns.findIndex((column) => column.id === pickedColumn) + 1}列目`}
              </span>
              <button type="button" onClick={() => setCallOpen(false)}>
                ✕ 閉じる
              </button>
            </div>
            <div className="call-subject">
              <span>工種科目</span>
              <input
                className="num"
                value={callSubjectNumber}
                title="工種科目の番号を入れると、その科目の明細を出します"
                onChange={(e) => {
                  const text = e.target.value.trim();
                  setCallSubjectNumber(e.target.value);
                  const found = options.subjects.find(
                    (subject) => String(subject.id) === text,
                  );
                  setCallSubjectId(found?.id ?? null);
                }}
              />
              <select
                value={callSubjectId === null ? "" : String(callSubjectId)}
                onChange={(e) => {
                  const id = Number.parseInt(e.target.value, 10);
                  setCallSubjectId(Number.isNaN(id) ? null : id);
                  setCallSubjectNumber(Number.isNaN(id) ? "" : String(id));
                }}
              >
                <option value="">（工種科目を選ぶ）</option>
                {options.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.id}：{subject.name}
                  </option>
                ))}
              </select>
              <span className="count">{callDetails.length}件</span>
            </div>
            <div className="call-scroll">
              <table className="call-table">
                <thead>
                  <tr>
                    <th className="no">部位ID</th>
                    <th className="no">番号</th>
                    <th>部位名／名称</th>
                    <th>摘要</th>
                    <th className="unit">単位</th>
                    <th>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {callDetails.map((detail, index) => (
                    <tr
                      key={`${detail.id}-${index}`}
                      tabIndex={0}
                      onDoubleClick={() => callDetail(detail)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") callDetail(detail);
                      }}
                    >
                      <td className="no">{detail.partNumber ?? ""}</td>
                      <td className="no">
                        {detail.detailNumber?.toFixed(2) ?? ""}
                      </td>
                      <td>
                        <div className="upper">{detail.partName}</div>
                        <div className="lower">{detail.name}</div>
                      </td>
                      <td>
                        <div className="upper">{detail.descriptionUpper}</div>
                        <div className="lower">{detail.descriptionLower}</div>
                      </td>
                      <td className="unit">{detail.unit}</td>
                      <td>
                        <div className="upper">{detail.remarksUpper}</div>
                        <div className="lower">{detail.remarksLower}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              選んでダブルクリック（またはEnter）でタテの明細に呼び出します。呼出画面は閉じないので続けて呼び出せます。
            </p>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="furniture-settings no-print" style={settingsDrag.style}>
          <div
            className="settings-bar drag"
            onMouseDown={settingsDrag.onMouseDown}
            title="この見出しをドラッグすると設定の窓を動かせます"
          >
            <b>家具計算書の設定</b>
            <span>（見出しをドラッグで移動。開いたまま入力できます）</span>
              <button type="button" onClick={() => setShowSettings(false)}>
                ✕ 閉じる
              </button>
            </div>
            <table>
              <tbody>
                <tr>
                  <td>部位の前後付加文字</td>
                  <td>
                    <input
                      lang="ja"
                      value={settings.partPrefix}
                      onChange={(event) =>
                        changeSettings({ partPrefix: event.target.value })
                      }
                    />
                    ＋部位＋
                    <input
                      lang="ja"
                      value={settings.partSuffix}
                      onChange={(event) =>
                        changeSettings({ partSuffix: event.target.value })
                      }
                    />
                  </td>
                  <td>+部位の前後付加文字</td>
                  <td>
                    <input
                      lang="ja"
                      value={settings.addPrefix}
                      onChange={(event) =>
                        changeSettings({ addPrefix: event.target.value })
                      }
                    />
                    ＋部位＋
                    <input
                      lang="ja"
                      value={settings.addSuffix}
                      onChange={(event) =>
                        changeSettings({ addSuffix: event.target.value })
                      }
                    />
                  </td>
                </tr>
                <tr>
                  <td>W・H・Dの表示文字</td>
                  <td colSpan={3}>
                    <input
                      value={settings.widthLabel}
                      onChange={(event) =>
                        changeSettings({ widthLabel: event.target.value })
                      }
                    />
                    <input
                      value={settings.heightLabel}
                      onChange={(event) =>
                        changeSettings({ heightLabel: event.target.value })
                      }
                    />
                    <input
                      value={settings.depthLabel}
                      onChange={(event) =>
                        changeSettings({ depthLabel: event.target.value })
                      }
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="symbol-tables">
              <SymbolTable
                title="+部位の記号"
                symbols={settings.partSymbols}
                onChange={(partSymbols) => changeSettings({ partSymbols })}
              />
              <SymbolTable
                title="名称の記号"
                symbols={settings.nameSymbols}
                onChange={(nameSymbols) => changeSettings({ nameSymbols })}
              />
            </div>
        </div>
      )}

      <div className="furniture-table-wrap">
        <table className="furniture-table" style={{ width: tableWidth }}>
          <colgroup>
            <col className="ops-col" style={{ width: OPS_WIDTH }} />
            <col style={{ width: NO_WIDTH }} />
            {inputColumns.map((column) => (
              <col
                key={column.key}
                style={{ width: widthOf(column.key, INPUT_DEFAULT) }}
              />
            ))}
            {detailCells.map((cell) => (
              <col
                key={cell.id}
                style={{ width: widthOf(cell.id, DETAIL_DEFAULT) }}
              />
            ))}
            <col className="vlabel-col" style={{ width: LABEL_WIDTH }} />
            {columns.map((column) => (
              <col
                key={column.id}
                style={{ width: widthOf(column.id, COLUMN_DEFAULT) }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="ops-col" rowSpan={headRowCount}>
                操作
              </th>
              <th rowSpan={headRowCount}>番号</th>
              {inputColumns.map((column) => (
                <th
                  key={column.key}
                  rowSpan={headRowCount}
                  className={column.forDetail ? "no-print" : ""}
                  onMouseDown={(event) =>
                    resizeAtEdge(column.key, INPUT_DEFAULT, event)
                  }
                >
                  <span className="cellbox">
                    {column.label}
                    <span className="resizer" />
                  </span>
                </th>
              ))}
              {detailCells.map((cell) => (
                <th
                  key={cell.id}
                  rowSpan={headRowCount}
                  className="side"
                  onMouseDown={(event) =>
                    resizeAtEdge(cell.id, DETAIL_DEFAULT, event)
                  }
                >
                  <span className="cellbox">
                    {cell.label}
                    <span className="resizer" />
                  </span>
                </th>
              ))}
              <th className="vlabel">{COLUMN_HEADS[0].label}</th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={pickedColumn === column.id ? "vcol on" : "vcol"}
                  onClick={() => setPickedColumn(column.id)}
                  onMouseDown={(event) =>
                    resizeAtEdge(column.id, COLUMN_DEFAULT, event)
                  }
                >
                  <span className="cellbox">
                    {headCell(column, COLUMN_HEADS[0])}
                    <span className="resizer" />
                  </span>
                </th>
              ))}
            </tr>
            {COLUMN_HEADS.slice(1).map((head) => (
                <tr key={String(head.key)}>
                  <th className="vlabel">{head.label}</th>
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      className={
                        pickedColumn === column.id ? "vcol on" : "vcol"
                      }
                      onClick={() => setPickedColumn(column.id)}
                    >
                      {headCell(column, head)}
                    </th>
                  ))}
                </tr>
              ))}
            <tr className="vcol-total">
              <th className="vlabel">合計</th>
              {columns.map((column) => (
                  <th key={column.id} className="vcol num">
                    {isEmptyFurnitureColumn(column) &&
                    !rows.some((row) => (row.values?.[column.id] ?? "").trim() !== "")
                      ? ""
                      : furnitureColumnTotal(rows, column.id).toFixed(2)}
                    <button
                      type="button"
                      className="drop"
                      title="このタテの明細（列）を消します"
                      onClick={() => removeColumn(column.id)}
                    >
                      🗑
                    </button>
                  </th>
                ))}
              </tr>
          </thead>
          <tbody>
            {view.map((row, index) => {
              const quantity = rowQuantity(row, resolved[index]);
              return (
                <tr
                  key={row.id}
                  className={quantity === null ? "title-row" : ""}
                  onMouseDown={() => setPicked(index)}
                >
                  <td className="ops-col">
                    <button type="button" onClick={() => addRow(index + 1)}>
                      ＋
                    </button>
                    <button type="button" onClick={() => removeRow(index)}>
                      －
                    </button>
                  </td>
                  <td className="num">{index + 1}</td>
                  {visible("subjectId") && (
                    <td className="no-print">
                      <PickInput
                        entries={subjectEntries}
                        halfWidth
                        value={
                          rows[index].subjectId === null
                            ? ""
                            : String(rows[index].subjectId)
                        }
                        placeholder={
                          resolved[index].subjectId === null
                            ? ""
                            : String(resolved[index].subjectId)
                        }
                        onCommit={(text) => {
                          const id = Number.parseInt(text.trim(), 10);
                          editRow(index, {
                            subjectId: Number.isNaN(id) ? null : id,
                          });
                        }}
                      />
                    </td>
                  )}
                  {visible("partNumber") && (
                    <td className="no-print">
                      <PickInput
                        entries={pickupPartEntries}
                        halfWidth
                        value={
                          rows[index].partNumber === null
                            ? ""
                            : String(rows[index].partNumber)
                        }
                        placeholder={
                          resolved[index].partNumber === null
                            ? ""
                            : String(resolved[index].partNumber)
                        }
                        onCommit={(text) => {
                          const found = pickMaster(options.pickupParts, text);
                          editRow(index, { partNumber: found.id });
                        }}
                      />
                    </td>
                  )}
                  {visible("detailNumber") && (
                    <td className="num no-print">
                      <input
                        value={
                          rows[index].detailNumber === null
                            ? ""
                            : String(rows[index].detailNumber)
                        }
                        placeholder={
                          resolved[index].detailNumber === null
                            ? ""
                            : resolved[index].detailNumber.toFixed(2)
                        }
                        title="空欄のときは上の行に0.01を足します"
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          editRow(index, {
                            detailNumber:
                              event.target.value.trim() === "" ||
                              Number.isNaN(value)
                                ? null
                                : value,
                          });
                        }}
                      />
                    </td>
                  )}
                  {visible("part") && (
                    <td>
                      <input
                        value={rows[index].part}
                        placeholder={resolved[index].part}
                        onChange={(event) =>
                          editRow(index, { part: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {visible("partAdd") && (
                    <td>
                      <input
                        value={rows[index].partAdd}
                        onChange={(event) =>
                          editRow(index, { partAdd: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {visible("partSymbol") && (
                    <td>
                      <input
                        value={rows[index].partSymbol}
                        title="設定の記号表で文字に変わります"
                        onChange={(event) =>
                          editRow(index, { partSymbol: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {visible("nameSymbol") && (
                    <td>
                      <input
                        lang="ja"
                        value={rows[index].nameSymbol}
                        title="設定の記号表で文字に変わります（表に無い文字はそのまま出ます）"
                        onChange={(event) =>
                          editRow(index, { nameSymbol: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {visible("width") && (
                    <td className="num">
                      <input
                        value={rows[index].width}
                        onChange={(event) =>
                          editRow(index, { width: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {visible("height") && (
                    <td className="num">
                      <input
                        value={rows[index].height}
                        onChange={(event) =>
                          editRow(index, { height: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {visible("depth") && (
                    <td className="num">
                      <input
                        value={rows[index].depth}
                        onChange={(event) =>
                          editRow(index, { depth: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {visible("quantity") && (
                    <td className="num">
                      <input
                        value={rows[index].quantity}
                        placeholder={resolved[index].quantity}
                        title="0はタイトル行になり、集計しません"
                        onChange={(event) =>
                          editRow(index, { quantity: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {visible("unit") && (
                    <td>
                      <PickInput
                        entries={unitEntries}
                        value={rows[index].unit}
                        placeholder={resolved[index].unit}
                        onCommit={(text) =>
                          editRow(index, {
                            unit: pickMaster(options.units, text).name,
                          })
                        }
                      />
                    </td>
                  )}
                  {visible("descriptionUpper") && (
                    <td>
                      <input
                        lang="ja"
                        value={rows[index].descriptionUpper}
                        onChange={(event) =>
                          editRow(index, {
                            descriptionUpper: event.target.value,
                          })
                        }
                      />
                    </td>
                  )}
                  {visible("remarksLower") && (
                    <td>
                      <input
                        lang="ja"
                        value={rows[index].remarksLower}
                        onChange={(event) =>
                          editRow(index, { remarksLower: event.target.value })
                        }
                      />
                    </td>
                  )}
                  {detailCells.map((cell) =>
                    cell.kind === "quantity" ? (
                      <td key={cell.id} className="num detail">
                        {quantity === null ? "" : quantity}
                      </td>
                    ) : (
                      <td
                        key={cell.id}
                        className={`detail${
                          row.detail.edited.includes(String(cell.key))
                            ? " edited"
                            : ""
                        }`}
                      >
                        <input
                          lang="ja"
                          value={detailText(row.detail, cell.key)}
                          title="ここを直しても左の入力欄には返しません"
                          onChange={(event) => {
                            const text = event.target.value;
                            if (
                              cell.key === "subjectId" ||
                              cell.key === "partNumber" ||
                              cell.key === "detailNumber"
                            ) {
                              const value = Number(text);
                              editDetail(index, {
                                [cell.key]:
                                  text.trim() === "" || Number.isNaN(value)
                                    ? null
                                    : value,
                              });
                              return;
                            }
                            editDetail(index, { [cell.key]: text });
                          }}
                        />
                      </td>
                    ),
                  )}
                  <td className="vlabel" />
                  {columns.map((column) => {
                    const text = rows[index].values?.[column.id] ?? "";
                    const value = furnitureCellValue(row, text);
                    return (
                      <td
                        key={column.id}
                        className={
                          text !== "" && value === null
                            ? "num vcell error"
                            : "num vcell"
                        }
                        title={
                          value === null ? "" : `計算結果 ${value.toFixed(2)}`
                        }
                      >
                        <input
                          value={text}
                          title="数字か計算式。W・H・Dでこの行の寸法（mに直した値）が使えます（例：W*H）"
                          onFocus={() => setPickedColumn(column.id)}
                          onChange={(event) =>
                            editCell(row.id, column.id, event.target.value)
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint">
        ヨコの1行＝家具1件の明細（左の入力から自動で作ります）。
        右端のタテの列（科目〜備考の見出し）は、部位別雑・金物入力表と同じように
        家具に付く関連明細をタテに拾います（［➕ タテ明細］で列を足します。どちらも集計に入ります）。
      </p>
    </div>
  );
}
