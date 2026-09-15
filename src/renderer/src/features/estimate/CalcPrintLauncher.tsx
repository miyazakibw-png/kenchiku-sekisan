import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EstimateRowDraft,
  FurnitureSheetSummary,
  MasterOptions,
  MiscSheetSummary,
  ProjectSummary,
} from "@shared/types";
import {
  formatNumber,
  resolveInherited,
  roomNamesByRowId,
  toDrafts,
} from "./estimateRows";
import RoomCalcPrintPage from "./RoomCalcPrintPage";
import {
  normalizeManageRows,
  type FireproofManageRow,
} from "../../../../core/fireproof/fireproofEstimate";
import { CALC_TYPE_OPTIONS } from "./FireproofEstimatePage";
import "./EstimatePartsPage.css";

interface Props {
  project: ProjectSummary;
  /** all: 保存済みの計算書を表紙付きで全部／select: 部位別入力表で選んでから */
  mode: "all" | "select";
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

/** 紙にできるのは保存済みの行だけ（小計行は表紙にだけ出す） */
const isSheetRow = (row: EstimateRowDraft): boolean =>
  row.rowType !== "subtotal" && row.id !== null;

/**
 * 工事管理画面から計算書を印刷する入口。
 * 一括なら表紙（部位別入力表）を付けて全部、部屋別なら部位別入力表で選んでから印刷する。
 */
export default function CalcPrintLauncher({
  project,
  mode,
  onBack,
}: Props): JSX.Element {
  const [rows, setRows] = useState<EstimateRowDraft[]>([]);
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [printRows, setPrintRows] = useState<EstimateRowDraft[] | null>(null);
  const [message, setMessage] = useState("");
  /** 部位別雑・金物入力表（一覧）と、印刷に選んだ表 */
  const [miscSheets, setMiscSheets] = useState<MiscSheetSummary[]>([]);
  const [pickedMisc, setPickedMisc] = useState<number[]>([]);
  const [printMisc, setPrintMisc] = useState<number[] | null>(null);
  /** 家具・設備入力表（一覧）と、印刷に選んだ表 */
  const [furnitureSheets, setFurnitureSheets] = useState<
    FurnitureSheetSummary[]
  >([]);
  const [pickedFurniture, setPickedFurniture] = useState<number[]>([]);
  const [printFurniture, setPrintFurniture] = useState<number[] | null>(null);
  /** 耐火被覆・塗装入力表の行（一覧）と、印刷に選んだ行 */
  const [fireproofRows, setFireproofRows] = useState<FireproofManageRow[]>([]);
  const [pickedFireproof, setPickedFireproof] = useState<string[]>([]);
  const [printFireproof, setPrintFireproof] = useState<string[] | null>(null);

  useEffect(() => {
    void (async () => {
      setRows(toDrafts(await window.sekisan.listEstimateRows(project.id)));
      setOptions(await window.sekisan.getMasterOptions(project.id));
      setMiscSheets(await window.sekisan.listMiscSheets(project.id));
      setFurnitureSheets(await window.sekisan.listFurnitureSheets(project.id));
      const fireproof = await window.sekisan.getFireproofSheet(project.id);
      setFireproofRows(
        normalizeManageRows(parseJson(fireproof.estimateJson, [])),
      );
    })();
  }, [project.id]);

  const inherited = useMemo(() => resolveInherited(rows), [rows]);
  const sheetRows = useMemo(() => rows.filter(isSheetRow), [rows]);
  const roomNames = useMemo(() => roomNamesByRowId(rows), [rows]);

  const calcName = useCallback(
    (key: string): string =>
      options?.calcSheets.find((sheet) => sheet.key === key)?.name ?? key,
    [options],
  );

  const toggle = useCallback((id: number): void => {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((each) => each !== id)
        : [...current, id],
    );
  }, []);

  const toggleMisc = useCallback((id: number): void => {
    setPickedMisc((current) =>
      current.includes(id)
        ? current.filter((each) => each !== id)
        : [...current, id],
    );
  }, []);

  const toggleFurniture = useCallback((id: number): void => {
    setPickedFurniture((current) =>
      current.includes(id)
        ? current.filter((each) => each !== id)
        : [...current, id],
    );
  }, []);

  const toggleFireproof = useCallback((id: string): void => {
    setPickedFireproof((current) =>
      current.includes(id)
        ? current.filter((each) => each !== id)
        : [...current, id],
    );
  }, []);

  const printPicked = useCallback((): void => {
    const target = sheetRows.filter(
      (row) => row.id !== null && picked.includes(row.id),
    );
    if (
      target.length === 0 &&
      pickedMisc.length === 0 &&
      pickedFurniture.length === 0 &&
      pickedFireproof.length === 0
    ) {
      setMessage("印刷する計算書にチェックを付けてください");
      return;
    }
    setPrintRows(target);
    setPrintMisc(pickedMisc);
    setPrintFurniture(pickedFurniture);
    setPrintFireproof(pickedFireproof);
  }, [picked, pickedFireproof, pickedFurniture, pickedMisc, sheetRows]);

  if (printRows !== null)
    return (
      <RoomCalcPrintPage
        project={project}
        rows={printRows}
        roomNames={roomNames}
        miscSheetIds={printMisc ?? []}
        furnitureSheetIds={printFurniture ?? []}
        fireproofRowIds={printFireproof ?? []}
        options={options}
        onBack={() => {
          setPrintRows(null);
          setPrintMisc(null);
          setPrintFurniture(null);
          setPrintFireproof(null);
        }}
      />
    );

  if (mode === "all") {
    if (rows.length === 0) return <div className="estimate-page" />;
    if (
      sheetRows.length === 0 &&
      miscSheets.length === 0 &&
      furnitureSheets.length === 0 &&
      fireproofRows.length === 0
    )
      return (
        <div className="estimate-page">
          <div className="toolbar">
            <button type="button" onClick={onBack}>
              ← 工事管理画面へ
            </button>
            <h2>計算書一括印刷</h2>
            <span className="status">印刷できる計算書がありません</span>
          </div>
        </div>
      );
    return (
      <RoomCalcPrintPage
        project={project}
        rows={sheetRows}
        coverRows={rows}
        roomNames={roomNames}
        miscSheetIds={miscSheets.map((sheet) => sheet.id)}
        furnitureSheetIds={furnitureSheets.map((sheet) => sheet.id)}
        fireproofRowIds={fireproofRows.map((row) => row.id)}
        options={options}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="estimate-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>部屋別計算書印刷</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button
          type="button"
          onClick={() => {
            setPicked(
              sheetRows
                .map((row) => row.id)
                .filter((id): id is number => id !== null),
            );
            setPickedMisc(miscSheets.map((sheet) => sheet.id));
            setPickedFurniture(furnitureSheets.map((sheet) => sheet.id));
            setPickedFireproof(fireproofRows.map((row) => row.id));
          }}
        >
          ☑ 全部選ぶ
        </button>
        <button
          type="button"
          onClick={() => {
            setPicked([]);
            setPickedMisc([]);
            setPickedFurniture([]);
            setPickedFireproof([]);
          }}
        >
          ☐ 全部外す
        </button>
        <button type="button" onClick={printPicked}>
          🖨 選んだ計算書を印刷（
          {picked.length +
            pickedMisc.length +
            pickedFurniture.length +
            pickedFireproof.length}
          件）
        </button>
        <span className="status">{message}</span>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th className="pick">印刷</th>
            <th className="no">No</th>
            <th>部位Ⅰ</th>
            <th>部位Ⅱ</th>
            <th>部位Ⅲ（部屋名）</th>
            <th className="num">天井高さ</th>
            <th>計算書</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const shown = inherited[index];
            if (!isSheetRow(row) || row.id === null)
              return (
                <tr className="subtotal" key={`sub-${index}`}>
                  <td className="pick" />
                  <td className="no">{index + 1}</td>
                  <td />
                  <td />
                  <td>{row.part3 || "小計"}</td>
                  <td className="num" />
                  <td />
                  <td>{row.note}</td>
                </tr>
              );
            const id = row.id;
            return (
              <tr key={id}>
                <td className="pick">
                  <input
                    type="checkbox"
                    checked={picked.includes(id)}
                    onChange={() => toggle(id)}
                  />
                </td>
                <td className="no">{index + 1}</td>
                <td>{row.part1 || shown.part1}</td>
                <td>{row.part2 || shown.part2}</td>
                <td>{row.part3}</td>
                <td className="num">
                  {row.ceilingHeight === null
                    ? ""
                    : formatNumber(row.ceilingHeight, 2)}
                </td>
                <td>{calcName(row.calcType)}</td>
                <td>{row.note}</td>
              </tr>
            );
          })}
          {miscSheets.map((sheet, index) => (
            <tr key={`misc-${sheet.id}`}>
              <td className="pick">
                <input
                  type="checkbox"
                  checked={pickedMisc.includes(sheet.id)}
                  onChange={() => toggleMisc(sheet.id)}
                />
              </td>
              <td className="no">{rows.length + index + 1}</td>
              <td />
              <td />
              <td>{sheet.name}</td>
              <td className="num" />
              <td>部位別雑・金物入力表</td>
              <td>{sheet.note}</td>
            </tr>
          ))}
          {furnitureSheets.map((sheet, index) => (
            <tr key={`furniture-${sheet.id}`}>
              <td className="pick">
                <input
                  type="checkbox"
                  checked={pickedFurniture.includes(sheet.id)}
                  onChange={() => toggleFurniture(sheet.id)}
                />
              </td>
              <td className="no">
                {rows.length + miscSheets.length + index + 1}
              </td>
              <td>{sheet.part1}</td>
              <td>{sheet.part2}</td>
              <td>{sheet.name}</td>
              <td className="num" />
              <td>家具・設備入力表</td>
              <td>{sheet.note}</td>
            </tr>
          ))}
          {(() => {
            // 耐火被覆・塗装入力表：1行＝計算書1画面分（部位Ⅰは空欄なら上を引き継ぐ）
            let part1 = "";
            return fireproofRows.map((row, index) => {
              if (row.part1.trim() !== "") part1 = row.part1;
              const kindName =
                CALC_TYPE_OPTIONS.find((option) => option.kind === row.calcType)
                  ?.title ?? "";
              const label =
                [row.detail.partName, row.detail.name]
                  .filter((text) => text.trim() !== "")
                  .join("　") || row.scope;
              return (
                <tr key={`fireproof-${row.id}`}>
                  <td className="pick">
                    <input
                      type="checkbox"
                      checked={pickedFireproof.includes(row.id)}
                      onChange={() => toggleFireproof(row.id)}
                    />
                  </td>
                  <td className="no">
                    {rows.length +
                      miscSheets.length +
                      furnitureSheets.length +
                      index +
                      1}
                  </td>
                  <td>{part1}</td>
                  <td />
                  <td>{label}</td>
                  <td className="num" />
                  <td>耐火被覆・塗装入力表（{kindName}）</td>
                  <td />
                </tr>
              );
            });
          })()}
        </tbody>
      </table>
    </div>
  );
}
