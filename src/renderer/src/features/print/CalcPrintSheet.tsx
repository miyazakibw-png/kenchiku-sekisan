import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { CalcSet, CalcSheetResult } from "../../../../core/room/calcSheet";
import {
  CALC_PRINT_COLUMNS,
  calcPrintRows,
  paginateCalcRows,
  type CalcPrintPage,
  type CalcPrintRow,
} from "../../../../core/print/calcPrint";
import "./CalcPrintSheet.css";

interface Props {
  /** 紙の右上に出す見出し（工事名・部屋名） */
  title: string;
  /** 1枚目の上に入れる図と入力表（スクロールなしで全部出す）。汎用計算書のように上段が無いときは null */
  upper: ReactNode | null;
  /** 上段を包む入れ物の組（画面と同じ見た目にするため、軸組なら frame-sheet-page を足す） */
  upperClass?: string;
  sets: CalcSet[];
  result: CalcSheetResult;
}

/** A3横の印刷できる大きさ（用紙の余白8mmを引いた分。96dpiの画素） */
const PAGE_WIDTH = 1527;
const PAGE_HEIGHT = 1062;
/** 計算書1行の高さ・見出し行の高さ（紙の上での画素） */
const ROW_HEIGHT = 20;
const HEAD_HEIGHT = 22;
const TITLE_HEIGHT = 24;
/** 罫線を細くする割合（0.7倍）。
   印刷では罫線の太さが1画素単位に丸められるため、0.7pxと書いても1pxで出る。
   そこで表を 1/0.7 倍の大きさで組んでから 0.7 倍に縮めて出す。
   文字も列幅も同じ割合で伸縮するので紙の見た目は変わらず、罫線だけが0.7倍になる */
const LINE_FINE = 0.7;
const LAYOUT_SCALE = 1 / LINE_FINE;

/** 画面で伸縮した計算書の列幅（下段計算書と同じ置き場）。無ければ既定幅 */
function screenColumnWidths(): number[] {
  const defaults = CALC_PRINT_COLUMNS.map((column) => column.width);
  try {
    const raw = window.localStorage.getItem("calc-sheet-columns-v2");
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaults;
    const stored = parsed as Record<string, unknown>;
    return defaults.map((width, index) => {
      const value = stored[String(index)];
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : width;
    });
  } catch {
    return defaults;
  }
}

function TitleRow({ title }: { title: string }): JSX.Element {
  return (
    <div className="calc-print-title" style={{ height: `${TITLE_HEIGHT}px` }}>
      {title}
    </div>
  );
}

function DetailRow({ row }: { row: CalcPrintRow }): JSX.Element {
  /** セットの上下は画面と同じく太線の区切りを引く */
  const boundary = `${row.setTop ? " set-top" : ""}${
    row.setBottom ? " set-bottom" : ""
  }`;
  if (row.banner)
    return (
      <tr
        className={`banner${boundary}`}
        style={{ background: row.banner.color }}
      >
        <td colSpan={CALC_PRINT_COLUMNS.length}>{row.banner.text}</td>
      </tr>
    );
  return (
    <tr className={boundary === "" ? undefined : boundary.trim()}>
      <td>{row.setPart}</td>
      <td>{row.materialCategory}</td>
      <td className="num">{row.subjectId}</td>
      <td className="num">{row.partNumber}</td>
      <td className="num">{row.detailNumber}</td>
      <td>{row.partName}</td>
      <td>{row.name}</td>
      <td>{row.descriptionLower}</td>
      <td>{row.descriptionUpper}</td>
      <td>{row.unit}</td>
      <td className="num">{row.coefficient}</td>
      <td className="num">{row.setTotal}</td>
      <td>{row.comment}</td>
      <td>{row.formulaA}</td>
      <td>{row.formulaB}</td>
      <td className="num">{row.value}</td>
      <td className="num">{row.total}</td>
      <td>{row.bSymbol}</td>
      <td>{row.remarksLower}</td>
      <td>{row.remarksUpper}</td>
    </tr>
  );
}

/** 下段の計算書（1枚分）。余った下は手書き用の横罫線で埋める */
function LowerTable({
  page,
  widths,
  scale,
}: {
  page: CalcPrintPage;
  widths: number[];
  scale: number;
}): JSX.Element {
  const total = widths.reduce((sum, width) => sum + width, 0);
  return (
    <div
      className="calc-print-lower"
      style={
        {
          // 大きめに組んでから縮める（紙の上の大きさは今までと同じ）
          transform: `scale(${scale / LAYOUT_SCALE})`,
          width: `${total * LAYOUT_SCALE}px`,
          "--print-layout-scale": LAYOUT_SCALE,
        } as CSSProperties
      }
    >
      <table>
        <colgroup>
          {CALC_PRINT_COLUMNS.map((column, index) => (
            <col
              key={`${column.label}-${index}`}
              width={(widths[index] ?? 0) * LAYOUT_SCALE}
            />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: `${HEAD_HEIGHT * LAYOUT_SCALE}px` }}>
            {CALC_PRINT_COLUMNS.map((column, index) => (
              <th key={`${column.label}-${index}`}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row, index) => (
            <DetailRow key={index} row={row} />
          ))}
          {Array.from({ length: page.blankRows }, (_, index) => (
            <tr className="blank" key={`blank-${index}`}>
              <td colSpan={CALC_PRINT_COLUMNS.length} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 部屋別計算書の印刷書式（A3横）。
 * 1枚目は上段の図と入力表を全部入れ、続けて下段の計算書を出す。
 * 1枚で収まらないときは2枚目以降に下段の続きを出し（見出し行は毎回付ける）、
 * 余った下は手入力できるよう横罫線で埋める。
 */
export default function CalcPrintSheet({
  title,
  upper,
  upperClass = "",
  sets,
  result,
}: Props): JSX.Element {
  const upperRef = useRef<HTMLDivElement>(null);
  const [upperHeight, setUpperHeight] = useState<number | null>(null);
  // 紙の列幅は画面で設定した列幅に合わせ、A3横の幅へ縮める
  const widths = useMemo(() => screenColumnWidths(), []);
  const scale = useMemo(
    () => PAGE_WIDTH / widths.reduce((total, width) => total + width, 0),
    [widths],
  );

  useLayoutEffect(() => {
    const element = upperRef.current;
    if (!element) return;
    const measure = (): void => setUpperHeight(element.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => calcPrintRows(sets, result), [result, sets]);

  const pages = useMemo(() => {
    const head = (TITLE_HEIGHT + HEAD_HEIGHT * scale) | 0;
    const later = Math.floor((PAGE_HEIGHT - head) / (ROW_HEIGHT * scale));
    // 上段が無い計算書（汎用）は1枚目から下段だけを目いっぱい入れる
    if (upper === null) return paginateCalcRows(rows, later, later);
    if (upperHeight === null) return paginateCalcRows([], 0, later);
    const first = Math.floor(
      (PAGE_HEIGHT - upperHeight - head) / (ROW_HEIGHT * scale),
    );
    return paginateCalcRows(rows, first, later);
  }, [rows, scale, upper, upperHeight]);

  return (
    <div className="calc-print-sheet">
      {pages.map((page, index) => (
        <div className="calc-print-page" key={index}>
          <TitleRow
            title={index === 0 ? title : `${title}（続き ${index + 1}）`}
          />
          {index === 0 && upper !== null && (
            <div className="calc-print-upper" ref={upperRef}>
              {/* 画面と同じ並び（図・寸法入力・記号・建具）で出すため、
                  画面の入れ物ごと紙の中に置く */}
              <div className={`room-sheet-page ${upperClass}`.trim()}>
                {upper}
              </div>
            </div>
          )}
          <LowerTable page={page} widths={widths} scale={scale} />
        </div>
      ))}
    </div>
  );
}
