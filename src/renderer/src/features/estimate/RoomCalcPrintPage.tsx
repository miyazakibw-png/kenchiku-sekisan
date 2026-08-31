import { useCallback, useEffect, useState } from "react";
import type { EstimateRowDraft, ProjectSummary } from "@shared/types";
import RoomSheetPage from "./RoomSheetPage";
import "./RoomCalcPrintPage.css";

interface Props {
  project: ProjectSummary;
  /** 印刷する部屋（1部屋だけ／全部屋）。部屋計算書の行だけを渡す */
  rows: EstimateRowDraft[];
  onBack: () => void;
}

/**
 * 部屋別計算書の印刷画面（A3横）。
 * 選んだ1部屋、または全部屋を続けて紙の書式で並べ、そのまま印刷／PDFにする。
 */
export default function RoomCalcPrintPage({
  project,
  rows,
  onBack,
}: Props): JSX.Element {
  const [busy, setBusy] = useState(false);

  // この画面は用紙を選べない（A3横固定の書式）
  useEffect(() => {
    const body = document.body;
    body.classList.add("print-a3-landscape");
    body.classList.remove("print-a4-portrait", "print-a4-landscape");
    return () => body.classList.remove("print-a3-landscape");
  }, []);

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

  const name = `${project.managementNo}_${project.name}_計算書`;

  return (
    <div className="room-calc-print-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 戻る
        </button>
        <h2>部屋別計算書 印刷</h2>
        <span className="project">
          {project.managementNo} {project.name}（{rows.length} 部屋・A3横）
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              window.sekisan.printPaper({ pageSize: "A3", landscape: true }),
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
                pageSize: "A3",
                landscape: true,
              }),
            )
          }
        >
          📄 PDF
        </button>
      </div>
      <div className="sheets">
        {rows.map((row) => (
          <RoomSheetPage
            key={row.id ?? `${row.part2}-${row.part3}`}
            project={project}
            row={row}
            roomName={`${row.part2} ${row.part3}`.trim()}
            printMode
            onBack={onBack}
          />
        ))}
      </div>
    </div>
  );
}
