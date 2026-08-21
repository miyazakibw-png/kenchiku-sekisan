import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AggregateRun, AggregateView, BasicMasterRow, ProjectSummary } from '@shared/types'
import { buildCheckSheet, toCheckSheetTsv } from '../../../../core/aggregate/checkSheet'
import '../estimate/EstimatePartsPage.css'
import './CheckSheetPage.css'

interface Props {
  project: ProjectSummary
  onBack: () => void
}

/**
 * チェック表（材種区分別）。集計書兼工事マスターの明細を、部位Ⅰ・部位Ⅱごとに
 * 管理用部位（床・巾木・壁・天井…）の列へ振り分けて確認する。
 * Excelの既存書式へそのまま貼り付けられるよう、余白の列と部位ごとの空行を残す。
 */
export default function CheckSheetPage({ project, onBack }: Props): JSX.Element {
  const [view, setView] = useState<AggregateView>({ run: null, items: [], details: [] })
  const [runs, setRuns] = useState<AggregateRun[]>([])
  const [aggregationParts, setAggregationParts] = useState<BasicMasterRow[]>([])
  const [materialCategory, setMaterialCategory] = useState('仕上')
  const [message, setMessage] = useState('')

  const reload = useCallback(
    async (runId?: number) => {
      setView(await window.sekisan.getAggregate(project.id, runId))
      setRuns(await window.sekisan.listAggregateRuns(project.id))
    },
    [project.id]
  )

  useEffect(() => {
    void (async () => {
      const masters = await window.sekisan.listBasicMasters()
      setAggregationParts(masters.aggregationParts)
      await reload()
    })()
  }, [reload])

  const categories = useMemo(() => {
    const found = [...new Set(view.items.map((item) => item.materialCategory))].filter(
      (category) => category !== ''
    )
    return found.includes('仕上') ? found : ['仕上', ...found]
  }, [view.items])

  const sheet = useMemo(
    () => buildCheckSheet(view.items, aggregationParts, materialCategory),
    [aggregationParts, materialCategory, view.items]
  )

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(toCheckSheetTsv(sheet))
    setMessage('コピーしました（Excelへ貼り付けできます）')
  }

  return (
    <div className="estimate-page check-sheet-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 工事管理画面へ
        </button>
        <h2>チェック表</h2>
        <span className="project">
          {project.managementNo} {project.name}
        </span>
        <label>
          材種区分
          <select value={materialCategory} onChange={(e) => setMaterialCategory(e.target.value)}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <select
          value={view.run?.id ?? ''}
          onChange={(e) => void reload(Number(e.target.value))}
        >
          {runs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.createdAt} の集計
            </option>
          ))}
          {runs.length === 0 && <option value="">未集計</option>}
        </select>
        <button type="button" onClick={() => void copy()}>
          📋 Excelへコピー
        </button>
        <span className="message">
          {runs.length === 0 ? '先に集計処理を実行してください。' : message}
        </span>
      </div>

      <table className="parts check-sheet">
        <thead>
          <tr>
            <th colSpan={2}>部位</th>
            {sheet.parts.map((part) => (
              <th key={part.id} colSpan={2}>
                {part.name}
              </th>
            ))}
          </tr>
          <tr>
            <th>部位Ⅰ</th>
            <th>部位Ⅱ</th>
            {sheet.parts.flatMap((part) => [
              <th key={`n${part.id}`}>名称</th>,
              <th key={`q${part.id}`}>数量</th>
            ])}
          </tr>
        </thead>
        {sheet.blocks.map((block, blockIndex) => {
          const rowCount = Math.max(1, ...block.columns.map((column) => column.length))
          return (
            <tbody key={`${block.part1}|${block.part2}`}>
              {Array.from({ length: rowCount }, (_unused, row) => (
                <tr key={row}>
                  {row === 0 && <td rowSpan={rowCount}>{block.part1}</td>}
                  {row === 0 && <td rowSpan={rowCount}>{block.part2}</td>}
                  {block.columns.flatMap((column, columnIndex) => {
                    const cell = column[row]
                    return [
                      <td key={`n${columnIndex}`}>{cell ? cell.name : ''}</td>,
                      <td key={`q${columnIndex}`} className="number">
                        {cell ? cell.quantity.toFixed(2) : ''}
                      </td>
                    ]
                  })}
                </tr>
              ))}
              {blockIndex < sheet.blocks.length - 1 && (
                <tr className="spacer">
                  <td colSpan={2 + sheet.parts.length * 2} />
                </tr>
              )}
            </tbody>
          )
        })}
      </table>
      {sheet.blocks.length === 0 && <p className="note">対象の明細がありません。</p>}
    </div>
  )
}
