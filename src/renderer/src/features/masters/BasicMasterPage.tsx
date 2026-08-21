import { useCallback, useEffect, useState } from 'react'
import type { BasicMasterKind, BasicMasterRow, BasicMasters } from '@shared/types'
import { BASIC_MASTER_LIMITS, nextBasicMasterId } from '../../../../core/masters/basicMaster'
import './BasicMasterPage.css'

const TABS: BasicMasterKind[] = [
  'pickupParts',
  'materialCategories',
  'units',
  'aggregationParts',
  'formworkCategories'
]

const EMPTY: BasicMasters = {
  pickupParts: [],
  materialCategories: [],
  units: [],
  aggregationParts: [],
  formworkCategories: []
}

export default function BasicMasterPage(): JSX.Element {
  const [masters, setMasters] = useState<BasicMasters>(EMPTY)
  const [kind, setKind] = useState<BasicMasterKind>('pickupParts')
  const [rows, setRows] = useState<BasicMasterRow[]>([])
  const [selected, setSelected] = useState(0)
  const [messages, setMessages] = useState<string[]>([])

  const load = useCallback((source: BasicMasters, target: BasicMasterKind) => {
    setMasters(source)
    setKind(target)
    setRows(source[target].map((row) => ({ ...row })))
    setSelected(0)
    setMessages([])
  }, [])

  useEffect(() => {
    void window.sekisan.listBasicMasters().then((data) => load(data, 'pickupParts'))
  }, [load])

  const limit = BASIC_MASTER_LIMITS[kind]

  const update = (index: number, patch: Partial<BasicMasterRow>): void =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addRow = (at: number): void => {
    const row: BasicMasterRow = { id: nextBasicMasterId(kind, rows), name: '', note: '' }
    const next = [...rows]
    next.splice(at, 0, row)
    setRows(next)
    setSelected(at)
  }

  const save = async (): Promise<void> => {
    const result = await window.sekisan.saveBasicMaster({ kind, rows })
    setMasters(result.masters)
    setMessages(result.errors.length > 0 ? result.errors : ['保存しました'])
    if (result.errors.length === 0) setRows(result.masters[kind].map((row) => ({ ...row })))
  }

  return (
    <div className="basic-master-page">
      <div className="toolbar">
        <h2>基本マスター</h2>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={tab === kind ? 'tab active' : 'tab'}
            onClick={() => load(masters, tab)}
          >
            {BASIC_MASTER_LIMITS[tab].label}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" onClick={() => addRow(selected)}>
          ➕ 行挿入
        </button>
        <button type="button" onClick={() => addRow(rows.length)}>
          ⤓ 最終行に追加
        </button>
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => {
            setRows(rows.filter((_, i) => i !== selected))
            setSelected(Math.max(0, selected - 1))
          }}
        >
          🗑 行削除
        </button>
        <button type="button" onClick={() => void save()}>
          💾 保存
        </button>
      </div>

      <div className="hint">
        {limit.hint}（番号1〜{limit.maxId}／{limit.maxRows}件まで・現在 {rows.length} 件）
      </div>
      {messages.length > 0 && (
        <ul className={messages[0] === '保存しました' ? 'messages ok' : 'messages'}>
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <table className="basic-master-list">
        <thead>
          <tr>
            <th className="no">番号</th>
            <th className="name">名称</th>
            {kind === 'pickupParts' && <th className="note">備考</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className={index === selected ? 'selected' : undefined}
              onClick={() => setSelected(index)}
            >
              <td className="no">
                <input
                  value={row.id === 0 ? '' : String(row.id)}
                  onChange={(e) => update(index, { id: Number(e.target.value.replace(/\D/g, '')) })}
                />
              </td>
              <td>
                <input value={row.name} onChange={(e) => update(index, { name: e.target.value })} />
              </td>
              {kind === 'pickupParts' && (
                <td>
                  <input
                    value={row.note}
                    onChange={(e) => update(index, { note: e.target.value })}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
