import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FittingDraft, ProjectSummary } from '@shared/types'
import {
  computeFitting,
  duplicateSymbolIndexes,
  expandSymbols
} from '../../../../core/fittings/fitting'
import {
  buildFittingColumns,
  emptyRow,
  formatNumber,
  insertRow,
  parseNumber,
  removeRow,
  sortBySymbol,
  toDrafts,
  updateRow
} from './fittingRows'
import { buildPastePreview } from '../grid/gridClipboard'
import './FittingsPage.css'

interface Props {
  project: ProjectSummary
  onBack: () => void
}

interface SeriesForm {
  prefix: string
  from: string
  to: string
  suffixFrom: string
  suffixTo: string
}

const EMPTY_SERIES: SeriesForm = { prefix: '', from: '1', to: '1', suffixFrom: '', suffixTo: '' }

export default function FittingsPage({ project, onBack }: Props): JSX.Element {
  const [rows, setRows] = useState<FittingDraft[]>([])
  const [selected, setSelected] = useState(0)
  const [message, setMessage] = useState('')
  const [series, setSeries] = useState<SeriesForm | null>(null)
  const columns = useMemo(() => buildFittingColumns(), [])

  const reload = useCallback(async () => {
    setRows(toDrafts(await window.sekisan.listFittings(project.id)))
  }, [project.id])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(async () => {
    const saved = await window.sekisan.saveFittings({ projectId: project.id, rows })
    setRows(toDrafts(saved))
    setMessage('保存しました')
  }, [project.id, rows])

  const duplicates = useMemo(
    () => duplicateSymbolIndexes(rows.map((row) => row.symbol)),
    [rows]
  )

  /** Excelの表をそのまま貼り付ける（選択行の建具記号列から取り込む） */
  const paste = useCallback(
    async (startRow: number) => {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) return
      const preview = buildPastePreview(rows, columns, text, startRow, 0, emptyRow)
      setRows(preview.rows)
      const notes = [
        `${preview.addedRows} 行追加`,
        preview.errorCount > 0 ? `取り込めない値 ${preview.errorCount} 件` : '',
        preview.warningCount > 0 ? `自動計算列 ${preview.warningCount} 件は取り込みません` : ''
      ].filter(Boolean)
      setMessage(`貼り付けました（${notes.join('／')}）`)
    },
    [columns, rows]
  )

  const addSeries = (form: SeriesForm): void => {
    const symbols = expandSymbols({
      prefix: form.prefix.trim(),
      from: Number(form.from),
      to: Number(form.to),
      suffixFrom: form.suffixFrom.trim() || undefined,
      suffixTo: form.suffixTo.trim() || undefined
    })
    if (symbols.length === 0) {
      setMessage('記号と番号を確認してください')
      return
    }
    setRows([...rows, ...symbols.map((symbol) => ({ ...emptyRow(), symbol }))])
    setSeries(null)
    setMessage(`${symbols.length} 行追加しました`)
  }

  const numberCell = (
    index: number,
    value: number | null,
    apply: (parsed: number | null) => Partial<FittingDraft>
  ): JSX.Element => (
    <input
      className="num"
      defaultValue={formatNumber(value)}
      key={`${index}-${formatNumber(value)}`}
      onBlur={(e) => {
        const parsed = parseNumber(e.target.value)
        if (parsed.error) {
          setMessage(parsed.error)
          return
        }
        setRows(updateRow(rows, index, apply(parsed.value)))
      }}
    />
  )

  return (
    <div className="fittings-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>建具表</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <button type="button" onClick={() => setRows(insertRow(rows, selected))}>
          ➕ 行挿入
        </button>
        <button type="button" onClick={() => setRows(insertRow(rows, rows.length))}>
          ⤓ 最終行に追加
        </button>
        <button type="button" onClick={() => setRows(removeRow(rows, selected))}>
          🗑 行削除
        </button>
        <button type="button" onClick={() => setSeries(EMPTY_SERIES)}>
          🔢 記号まとめて入力
        </button>
        <button type="button" onClick={() => setRows(sortBySymbol(rows))}>
          ⇅ 記号で昇順
        </button>
        <button type="button" onClick={() => void paste(selected)}>
          📋 Excelから貼り付け
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
        <span className="status">{message}</span>
      </div>

      {series && (
        <div className="series-form">
          <span>記号</span>
          <input
            value={series.prefix}
            placeholder="SD"
            onChange={(e) => setSeries({ ...series, prefix: e.target.value })}
          />
          <span>番号</span>
          <input
            className="num"
            value={series.from}
            onChange={(e) => setSeries({ ...series, from: e.target.value })}
          />
          <span>〜</span>
          <input
            className="num"
            value={series.to}
            onChange={(e) => setSeries({ ...series, to: e.target.value })}
          />
          <span>枝番（任意）</span>
          <input
            className="num"
            value={series.suffixFrom}
            placeholder="A"
            onChange={(e) => setSeries({ ...series, suffixFrom: e.target.value })}
          />
          <span>〜</span>
          <input
            className="num"
            value={series.suffixTo}
            placeholder="C"
            onChange={(e) => setSeries({ ...series, suffixTo: e.target.value })}
          />
          <button type="button" onClick={() => addSeries(series)}>
            追加
          </button>
          <button type="button" onClick={() => setSeries(null)}>
            取消
          </button>
        </div>
      )}

      <table className="grid fittings">
        <thead>
          <tr>
            <th className="no">No</th>
            <th className="symbol">建具記号</th>
            <th className="num">W</th>
            <th className="num">H</th>
            <th className="num">腰高</th>
            <th className="num calc">面積</th>
            <th className="num calc">巾木減</th>
            <th className="num calc">軸組横補強</th>
            <th className="formula">面積計算（自動計算修正用）</th>
            <th className="formula">巾木長さ（自動計算修正用）</th>
            <th className="note">その他（備考）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const calc = computeFitting(row)
            return (
              <tr
                key={row.id ?? `new-${index}`}
                className={
                  [index === selected ? 'selected' : '', row.fromEstimate === 1 ? 'from-estimate' : '']
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onClick={() => setSelected(index)}
              >
                <td className="no">{index + 1}</td>
                <td>
                  <input
                    className={duplicates.has(index) ? 'duplicate' : undefined}
                    title={duplicates.has(index) ? '建具記号が重複しています' : undefined}
                    value={row.symbol}
                    onChange={(e) => setRows(updateRow(rows, index, { symbol: e.target.value }))}
                  />
                </td>
                <td>{numberCell(index, row.width, (value) => ({ width: value }))}</td>
                <td>{numberCell(index, row.height, (value) => ({ height: value }))}</td>
                <td>{numberCell(index, row.sillHeight, (value) => ({ sillHeight: value }))}</td>
                <td className="num calc">{formatNumber(calc.area)}</td>
                <td className="num calc">{formatNumber(calc.baseboardDeduction)}</td>
                <td className="num calc">{formatNumber(calc.reinforcement)}</td>
                <td>
                  <input
                    className={calc.areaFormulaError ? 'duplicate' : undefined}
                    title={calc.areaFormulaError ? '計算式を確認してください' : undefined}
                    value={row.areaFormula}
                    onChange={(e) =>
                      setRows(updateRow(rows, index, { areaFormula: e.target.value }))
                    }
                  />
                </td>
                <td>
                  <input
                    className={calc.baseboardFormulaError ? 'duplicate' : undefined}
                    title={calc.baseboardFormulaError ? '計算式を確認してください' : undefined}
                    value={row.baseboardFormula}
                    onChange={(e) =>
                      setRows(updateRow(rows, index, { baseboardFormula: e.target.value }))
                    }
                  />
                </td>
                <td>
                  <input
                    value={row.note}
                    onChange={(e) => setRows(updateRow(rows, index, { note: e.target.value }))}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="hint">
        面積・巾木減・軸組横補強は自動計算です（薄黄色）。腰高がある建具は巾木を差し引かず、軸組横補強はW×2、
        巾木減がWと異なる場合は W×2−巾木減＋腰高×2 で算出します。積算入力の計算式では
        <code>&lt;AW-1&gt;</code> のように山カッコを付けて建具と判別します。
      </p>
    </div>
  )
}
