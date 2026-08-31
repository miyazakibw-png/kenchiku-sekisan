import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EstimateRowDraft,
  MasterOptions,
  ProjectSummary,
} from "@shared/types";
import { formatNumber, resolveInherited, toDrafts } from "./estimateRows";
import RoomCalcPrintPage from "./RoomCalcPrintPage";
import "./EstimatePartsPage.css";

interface Props {
  project: ProjectSummary;
  /** all: 保存済みの計算書を表紙付きで全部／select: 部位別入力表で選んでから */
  mode: "all" | "select";
  onBack: () => void;
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

  useEffect(() => {
    void (async () => {
      setRows(toDrafts(await window.sekisan.listEstimateRows(project.id)));
      setOptions(await window.sekisan.getMasterOptions(project.id));
    })();
  }, [project.id]);

  const inherited = useMemo(() => resolveInherited(rows), [rows]);
  const sheetRows = useMemo(() => rows.filter(isSheetRow), [rows]);

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

  const printPicked = useCallback((): void => {
    const target = sheetRows.filter(
      (row) => row.id !== null && picked.includes(row.id),
    );
    if (target.length === 0) {
      setMessage("印刷する計算書にチェックを付けてください");
      return;
    }
    setPrintRows(target);
  }, [picked, sheetRows]);

  if (printRows !== null)
    return (
      <RoomCalcPrintPage
        project={project}
        rows={printRows}
        onBack={() => setPrintRows(null)}
      />
    );

  if (mode === "all") {
    if (rows.length === 0) return <div className="estimate-page" />;
    if (sheetRows.length === 0)
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
          onClick={() =>
            setPicked(
              sheetRows
                .map((row) => row.id)
                .filter((id): id is number => id !== null),
            )
          }
        >
          ☑ 全部選ぶ
        </button>
        <button type="button" onClick={() => setPicked([])}>
          ☐ 全部外す
        </button>
        <button type="button" onClick={printPicked}>
          🖨 選んだ計算書を印刷（{picked.length}件）
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
        </tbody>
      </table>
    </div>
  );
}
