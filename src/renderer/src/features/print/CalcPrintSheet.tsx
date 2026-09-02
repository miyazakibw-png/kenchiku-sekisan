import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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

/** 列幅の合計（画面の設定幅。この幅をA3横の幅に合わせて縮める） */
const NATURAL_WIDTH = CALC_PRINT_COLUMNS.reduce(
  (total, column) => total + column.width,
  0,
);
const SCALE = PAGE_WIDTH / NATURAL_WIDTH;

function TitleRow({ title }: { title: string }): JSX.Element {
  return (
    <div className="calc-print-title" style={{ height: `${TITLE_HEIGHT}px` }}>
      {title}
    </div>
  );
}

function DetailRow({ row }: { row: CalcPrintRow }): JSX.Element {
  if (row.banner)
    return (
      <tr className="banner" style={{ background: row.banner.color }}>
        <td colSpan={CALC_PRINT_COLUMNS.length}>{row.banner.text}</td>
      </tr>
    );
  return (
    <tr>
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
function LowerTable({ page }: { page: CalcPrintPage }): JSX.Element {
  return (
    <div
      className="calc-print-lower"
      style={{
        transform: `scale(${SCALE})`,
        width: `${NATURAL_WIDTH}px`,
      }}
    >
      <table>
        <colgroup>
          {CALC_PRINT_COLUMNS.map((column, index) => (
            <col key={`${column.label}-${index}`} width={column.width} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: `${HEAD_HEIGHT}px` }}>
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
    const head = (TITLE_HEIGHT + HEAD_HEIGHT * SCALE) | 0;
    const later = Math.floor((PAGE_HEIGHT - head) / (ROW_HEIGHT * SCALE));
    // 上段が無い計算書（汎用）は1枚目から下段だけを目いっぱい入れる
    if (upper === null) return paginateCalcRows(rows, later, later);
    if (upperHeight === null) return paginateCalcRows([], 0, later);
    const first = Math.floor(
      (PAGE_HEIGHT - upperHeight - head) / (ROW_HEIGHT * SCALE),
    );
    return paginateCalcRows(rows, first, later);
  }, [rows, upper, upperHeight]);

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
          <LowerTable page={page} />
        </div>
      ))}
    </div>
  );
}
