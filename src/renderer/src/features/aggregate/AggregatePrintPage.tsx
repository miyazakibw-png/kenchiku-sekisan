import { useCallback, useEffect, useMemo, useState } from "react";
import type { AggregateItem, ProjectSummary, Subject } from "@shared/types";
import {
  AGGREGATE_PRINT_COLUMNS,
  aggregatePrintRows,
  paginateAggregateRows,
  type AggregatePrintRow,
} from "../../../../core/print/aggregatePrint";
import "./AggregatePrintPage.css";

interface Props {
  project: ProjectSummary;
  items: AggregateItem[];
  subjects: Subject[];
  onBack: () => void;
}

/** A4横の印刷できる大きさ（余白8mmを引いた分。96dpiの画素） */
const PAGE_WIDTH = 1047;
const PAGE_HEIGHT = 733;
const ROW_HEIGHT = 20;
const HEAD_HEIGHT = 22;
const TITLE_HEIGHT = 26;

const NATURAL_WIDTH = AGGREGATE_PRINT_COLUMNS.reduce(
  (total, column) => total + column.width,
  0,
);
const SCALE = PAGE_WIDTH / NATURAL_WIDTH;
/** 1ページに入る行数（どのページにもタイトル行と見出し行を付ける） */
const CAPACITY = Math.floor(
  (PAGE_HEIGHT - TITLE_HEIGHT - HEAD_HEIGHT * SCALE) / (ROW_HEIGHT * SCALE),
);

function PrintRow({ row }: { row: AggregatePrintRow }): JSX.Element {
  if (row.kind === "heading")
    return (
      <tr className="heading">
        <td colSpan={AGGREGATE_PRINT_COLUMNS.length}>{row.text}</td>
      </tr>
    );
  if (row.kind === "room")
    return (
      <tr className="room">
        <td />
        <td />
        <td />
        <td className="room-name">
          {row.continued ? `（続き ${row.itemName}）` : ""}
          {row.roomName}
        </td>
        <td />
        <td className="num">{row.quantity}</td>
        <td />
        <td />
      </tr>
    );
  return (
    <tr className="item">
      <td className="num">{row.subjectId}</td>
      <td>{row.materialCategory}</td>
      <td>{row.number}</td>
      <td>{row.name}</td>
      <td>{row.description}</td>
      <td className="num">{row.quantity}</td>
      <td>{row.unit}</td>
      <td>{row.remarks}</td>
    </tr>
  );
}

/**
 * 集計書の印刷（A4横）。
 * 1明細ごとに、その明細を拾った根拠（部屋＝部位Ⅱ：部位Ⅲ の数量）を下に並べる。
 * 2ページ目以降もタイトル行を付けた続きで、根拠が途中で切れたときは続きの部屋から出す。
 */
export default function AggregatePrintPage({
  project,
  items,
  subjects,
  onBack,
}: Props): JSX.Element {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const body = document.body;
    body.classList.add("print-a4-landscape");
    body.classList.remove("print-a3-landscape", "print-a4-portrait");
    return () => body.classList.remove("print-a4-landscape");
  }, []);

  const pages = useMemo(() => {
    const rows = aggregatePrintRows(items, (subjectId) => {
      const subject = subjects.find((row) => row.id === subjectId);
      return subject ? `${subject.id} ${subject.name}` : "";
    });
    return paginateAggregateRows(rows, CAPACITY);
  }, [items, subjects]);

  const run = useCallback(
    async (job: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        const area = document.querySelector(".app-main");
        if (area instanceof HTMLElement)
          area.style.setProperty("--print-scale", "1");
        await job();
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const name = `${project.managementNo}_${project.name}_集計書`;

  return (
    <div className="aggregate-print-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 戻る
        </button>
        <h2>集計書 印刷</h2>
        <span className="project">
          {project.managementNo} {project.name}（{pages.length} 枚・A4横）
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              window.sekisan.printPaper({ pageSize: "A4", landscape: true }),
            )
          }
        >
          🖨 印刷
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              window.sekisan.printPdf(name, {
                pageSize: "A4",
                landscape: true,
              }),
            )
          }
        >
          📄 PDF
        </button>
      </div>
      <div className="sheets">
        {pages.map((rows, index) => (
          <div className="aggregate-print-sheet" key={index}>
            <div
              className="aggregate-print-title"
              style={{ height: `${TITLE_HEIGHT}px` }}
            >
              <span>
                集計書　{project.managementNo} {project.name}
              </span>
              <span>
                {index + 1} / {pages.length}
              </span>
            </div>
            <div
              className="aggregate-print-body"
              style={{
                transform: `scale(${SCALE})`,
                width: `${NATURAL_WIDTH}px`,
              }}
            >
              <table>
                <colgroup>
                  {AGGREGATE_PRINT_COLUMNS.map((column) => (
                    <col key={column.label} width={column.width} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ height: `${HEAD_HEIGHT}px` }}>
                    {AGGREGATE_PRINT_COLUMNS.map((column) => (
                      <th key={column.label}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, at) => (
                    <PrintRow key={at} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
