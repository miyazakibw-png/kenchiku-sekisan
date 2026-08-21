import { useEffect, useState } from 'react'
import type { DetailChangeLog, DetailSnapshot, Subject } from '@shared/types'
import '../estimate/EstimatePartsPage.css'
import './DetailChangeHistoryPage.css'

interface Props {
  /** 物件専用マスターの履歴は物件ID、基本マスターの履歴は null */
  projectId: number | null
  onBack: () => void
}

const KIND_LABEL: Record<DetailChangeLog['changeKind'], string> = {
  add: '追加',
  edit: '修正',
  delete: '削除'
}

const COLUMNS: { key: keyof DetailSnapshot; label: string }[] = [
  { key: 'detailNumber', label: '明細番号' },
  { key: 'materialCategory', label: '材種区分' },
  { key: 'partName', label: '部位名' },
  { key: 'name', label: '名称' },
  { key: 'descriptionUpper', label: '摘要（上）' },
  { key: 'descriptionLower', label: '摘要（下）' },
  { key: 'unit', label: '単位' },
  { key: 'remarksUpper', label: '備考（上）' },
  { key: 'remarksLower', label: '備考（下）' },
  { key: 'estimateDisplay', label: '積算用表示' },
  { key: 'isActive', label: '有効' }
]

function cellText(snapshot: DetailSnapshot | null, key: keyof DetailSnapshot): string {
  if (snapshot === null) return ''
  const value = snapshot[key]
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? '○' : '×'
  if (typeof value === 'number') return value.toFixed(2)
  return value
}

/**
 * 明細マスターの修正履歴一覧。
 * 修正した明細を修正した順に並べ、修正前の行と修正後の行を続けて表示する。
 * 修正後の行には背景色を付け、変わった欄は赤文字にする。
 */
export default function DetailChangeHistoryPage({ projectId, onBack }: Props): JSX.Element {
  const [logs, setLogs] = useState<DetailChangeLog[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [newestFirst, setNewestFirst] = useState(true)

  useEffect(() => {
    void (async () => {
      setSubjects(await window.sekisan.listSubjects())
      setLogs(await window.sekisan.listDetailChangeLogs(projectId))
    })()
  }, [projectId])

  const rows = newestFirst ? logs : [...logs].reverse()

  return (
    <div className="estimate-page detail-change-history">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          ← 戻る
        </button>
        <h2>
          📝 修正履歴一覧
          {projectId === null ? '（基本マスター）' : '（この工事の明細マスター）'}
        </h2>
        <button
          type="button"
          className={newestFirst ? 'on' : ''}
          onClick={() => setNewestFirst(!newestFirst)}
        >
          {newestFirst ? '新しい順' : '古い順'}
        </button>
        <span className="message">{logs.length}件</span>
      </div>

      <table className="parts change-history">
        <thead>
          <tr>
            <th className="when">修正日時</th>
            <th className="kind">区分</th>
            <th className="subject">科目</th>
            <th className="stage">前後</th>
            {COLUMNS.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        {rows.map((log) => {
          const subject = subjects.find((item) => item.id === log.subjectId)
          return (
            <tbody key={log.id} className="log">
              <tr className="before">
                <td className="when" rowSpan={2}>
                  {log.changedAt.replace('T', ' ').slice(0, 19)}
                </td>
                <td className="kind" rowSpan={2}>
                  {KIND_LABEL[log.changeKind]}
                </td>
                <td className="subject" rowSpan={2}>
                  {subject?.name ?? log.subjectId}
                </td>
                <td className="stage">修正前</td>
                {COLUMNS.map((column) => (
                  <td key={column.key}>{cellText(log.before, column.key)}</td>
                ))}
              </tr>
              <tr className="after">
                <td className="stage">修正後</td>
                {COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className={log.changedFields.includes(column.key) ? 'changed' : ''}
                  >
                    {cellText(log.after, column.key)}
                  </td>
                ))}
              </tr>
            </tbody>
          )
        })}
      </table>

      {logs.length === 0 && (
        <p className="note">まだ修正履歴はありません（明細マスターを保存すると記録します）。</p>
      )}
    </div>
  )
}
