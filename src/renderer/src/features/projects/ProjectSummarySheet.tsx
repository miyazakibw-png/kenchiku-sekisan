/**
 * 工事概要の印刷書式（A4縦）。
 * 右上に印刷日、項目は罫線つきで上から並べ、下の余りは大きな備考欄にする。
 */

import "./ProjectSummarySheet.css";

export interface SummaryLine {
  label: string;
  value: string;
}

interface Props {
  lines: readonly SummaryLine[];
  /** 下の大きな備考欄に出す文字 */
  note?: string;
  /** 右上に出す印刷日（既定は今日） */
  printedOn?: Date;
  onBack: () => void;
}

/** 2026/8/27 の形にする */
export function printDateText(date: Date): string {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export default function ProjectSummarySheet({
  lines,
  note,
  printedOn,
  onBack,
}: Props): JSX.Element {
  return (
    <div className="summary-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 積算操作
        </button>
        <h2>工事概要</h2>
        <span className="status">
          用紙をA4縦にして「🖨 印刷」または「📄 PDF」を押してください
        </span>
      </div>

      <div className="summary-sheet">
        <div className="summary-sheet-date">
          {printDateText(printedOn ?? new Date())}
        </div>
        <table className="summary-sheet-table">
          <tbody>
            {lines.map((line, index) => (
              <tr key={`${line.label}-${index}`}>
                <th>{line.label}</th>
                <td>{line.value}</td>
              </tr>
            ))}
            <tr className="summary-sheet-note">
              <th>備考</th>
              <td>{note ?? ""}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
