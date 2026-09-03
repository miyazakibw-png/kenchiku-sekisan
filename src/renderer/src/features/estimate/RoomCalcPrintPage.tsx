import { useCallback, useEffect, useState } from "react";
import type { EstimateRowDraft, ProjectSummary } from "@shared/types";
import RoomSheetPage from "./RoomSheetPage";
import FrameSheetPage from "./FrameSheetPage";
import GeneralSheetPage from "./GeneralSheetPage";
import PitSheetPage from "./PitSheetPage";
import EstimateCoverSheet from "./EstimateCoverSheet";
import "./RoomCalcPrintPage.css";

interface Props {
  project: ProjectSummary;
  /** 印刷する計算書の行（1行だけ／一括）。部屋別・軸組・汎用のどれでもよい */
  rows: EstimateRowDraft[];
  /** 表紙に出す部位別入力表の全行（一括印刷のときだけ渡す） */
  coverRows?: EstimateRowDraft[] | null;
  onBack: () => void;
}

/**
 * 計算書の印刷画面（A3横）。
 * 選んだ1行、または全部を続けて紙の書式で並べ、そのまま印刷／PDFにする。
 * 部屋別・軸組・汎用のどの計算書でも同じ書式で出す。
 */
export default function RoomCalcPrintPage({
  project,
  rows,
  coverRows = null,
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
        <h2>計算書 印刷</h2>
        <span className="project">
          {project.managementNo} {project.name}（{rows.length} 件・A3横）
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
        {coverRows !== null && (
          <EstimateCoverSheet project={project} rows={coverRows} />
        )}
        {rows.map((row) => {
          const key = row.id ?? `${row.part2}-${row.part3}`;
          const roomName = `${row.part2} ${row.part3}`.trim();
          if (row.calcType === "frame")
            return (
              <FrameSheetPage
                key={key}
                project={project}
                row={row}
                roomName={roomName}
                printMode
                onBack={onBack}
              />
            );
          if (row.calcType === "general")
            return (
              <GeneralSheetPage
                key={key}
                project={project}
                row={row}
                roomName={roomName}
                printMode
                onBack={onBack}
              />
            );
          if (row.calcType === "pit")
            return (
              <PitSheetPage
                key={key}
                project={project}
                row={row}
                roomName={roomName}
                printMode
                onBack={onBack}
              />
            );
          return (
            <RoomSheetPage
              key={key}
              project={project}
              row={row}
              roomName={roomName}
              printMode
              onBack={onBack}
            />
          );
        })}
      </div>
    </div>
  );
}
