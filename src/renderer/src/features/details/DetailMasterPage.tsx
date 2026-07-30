import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Detail, DetailDraft, MasterOptions, Subject } from '@shared/types'
import { useAutoSave } from '../../hooks/useAutoSave'
import {
  copyRow,
  createEmptyRow,
  insertRow,
  moveRow,
  normalizeDetailNumberInput,
  removeRow,
  toDetailDraft,
  toDraftRows,
  updateDetailNumberInput,
  updateRow,
  type DraftRow
} from './rowOperations'
import './DetailMasterPage.css'

const STATUS_LABEL: Record<string, string> = {
  idle: '─',
  dirty: '● 未保存',
  saving: '⏳ 保存中',
  saved: '✔ 保存済み',
  error: '⚠ 保存失敗'
}

interface Props {
  options: MasterOptions
}

export default function DetailMasterPage({ options }: Props): JSX.Element {
  const [subject, setSubject] = useState<Subject | null>(options.subjects[0] ?? null)
  const [rows, setRows] = useState<DraftRow[]>([])
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filter, setFilter] = useState('')
  const dragIndex = useRef<number | null>(null)

  const persist = useCallback(
    async (payload: { subjectId: number; rows: DraftRow[]; deletedIds: number[] }) => {
      const saved: Detail[] = await window.sekisan.saveDetails({
        subjectId: payload.subjectId,
        rows: payload.rows.map(toDetailDraft),
        deletedIds: payload.deletedIds
      })
      setDeletedIds([])
      setRows(toDraftRows(saved))
    },
    []
  )

  const { status, markDirty, saveNow } = useAutoSave({
    data: { subjectId: subject?.id ?? 0, rows, deletedIds },
    onSave: persist,
    enabled: subject !== null
  })

  useEffect(() => {
    if (!subject) return
    let cancelled = false
    void window.sekisan.listDetails(subject.id).then((details) => {
      if (cancelled) return
      setRows(toDraftRows(details))
      setDeletedIds([])
      setSelectedIndex(0)
    })
    return () => {
      cancelled = true
    }
  }, [subject])

  // 未保存の編集を確定してから科目を切り替える（切替時のデータロスト防止）
  const handleSelectSubject = useCallback(
    async (next: Subject) => {
      if (next.id === subject?.id) return
      await saveNow()
      setSubject(next)
    },
    [saveNow, subject]
  )

  const mutate = useCallback(
    (next: DraftRow[]) => {
      setRows(next)
      markDirty()
    },
    [markDirty]
  )

  const handleInsert = useCallback(
    (index: number) => {
      mutate(insertRow(rows, index))
      setSelectedIndex(index)
    },
    [mutate, rows]
  )

  const handleDelete = useCallback(
    (index: number) => {
      const target = rows[index]
      if (!target) return
      if (target.id !== null) setDeletedIds((prev) => [...prev, target.id as number])
      mutate(removeRow(rows, index))
      setSelectedIndex(Math.max(0, index - 1))
    },
    [mutate, rows]
  )

  const handleMove = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= rows.length) return
      mutate(moveRow(rows, from, to))
      setSelectedIndex(to)
    },
    [mutate, rows]
  )

  const handleCopy = useCallback(
    (index: number) => {
      mutate(copyRow(rows, index))
      setSelectedIndex(index + 1)
    },
    [mutate, rows]
  )

  const handleChange = useCallback(
    <K extends keyof DetailDraft>(index: number, field: K, value: DetailDraft[K]) => {
      mutate(updateRow(rows, index, field, value))
    },
    [mutate, rows]
  )

  const handleDetailNumberChange = useCallback(
    (index: number, input: string) => {
      const next = updateDetailNumberInput(rows, index, input)
      if (next !== rows) mutate(next)
    },
    [mutate, rows]
  )

  const handleDetailNumberBlur = useCallback(
    (index: number) => {
      const next = normalizeDetailNumberInput(rows, index)
      if (next !== rows) setRows(next)
    },
    [rows]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault()
        handleMove(index, index - 1)
      } else if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault()
        handleMove(index, index + 1)
      } else if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        handleInsert(index + 1)
      } else if (event.ctrlKey && event.key === 'd') {
        event.preventDefault()
        handleCopy(index)
      } else if (event.ctrlKey && event.key === 'Delete') {
        event.preventDefault()
        handleDelete(index)
      } else if (event.ctrlKey && event.key === 's') {
        event.preventDefault()
        void saveNow()
      }
    },
    [handleCopy, handleDelete, handleInsert, handleMove, saveNow]
  )

  const visibleSubjects = useMemo(() => {
    const keyword = filter.trim()
    if (!keyword) return options.subjects
    return options.subjects.filter(
      (s) => s.name.includes(keyword) || s.code.includes(keyword)
    )
  }, [filter, options.subjects])

  return (
    <div className="detail-master">
      <aside className="subject-pane">
        <input
          className="subject-filter"
          placeholder="🔍 科目を検索"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul className="subject-list">
          {visibleSubjects.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={s.id === subject?.id ? 'subject-item active' : 'subject-item'}
                onClick={() => void handleSelectSubject(s)}
              >
                <span className="subject-code">{s.code}</span>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="grid-pane">
        <header className="grid-toolbar">
          <h2>📋 明細マスター / {subject?.name ?? '科目未選択'}</h2>
          <div className="toolbar-buttons">
            <button type="button" title="行挿入 (Ctrl+Enter)" onClick={() => handleInsert(selectedIndex + 1)}>
              ➕ 行挿入
            </button>
            <button type="button" title="行削除 (Ctrl+Delete)" onClick={() => handleDelete(selectedIndex)}>
              🗑 行削除
            </button>
            <button type="button" title="1行上へ (Alt+↑)" onClick={() => handleMove(selectedIndex, selectedIndex - 1)}>
              ⬆ 1行上
            </button>
            <button type="button" title="1行下へ (Alt+↓)" onClick={() => handleMove(selectedIndex, selectedIndex + 1)}>
              ⬇ 1行下
            </button>
            <button type="button" title="行コピー (Ctrl+D)" onClick={() => handleCopy(selectedIndex)}>
              ⧉ 行コピー
            </button>
            <button type="button" title="今すぐ保存 (Ctrl+S)" onClick={() => void saveNow()}>
              💾 保存
            </button>
            <span className={`save-status status-${status}`}>{STATUS_LABEL[status]}</span>
          </div>
        </header>

        <div className="grid-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th className="col-handle" rowSpan={2}>↕</th>
                <th className="col-no" rowSpan={2}>No.</th>
                <th className="col-number">（部位）</th>
                <th className="col-category" rowSpan={2}>材種区分</th>
                <th className="col-name">部位名（上段）</th>
                <th className="col-description">摘要（上段）</th>
                <th className="col-unit" />
                <th className="col-remarks">備考（上段）</th>
                <th className="col-estimate" rowSpan={2}>積算用表示</th>
                <th className="col-active" rowSpan={2}>有効</th>
              </tr>
              <tr>
                <th className="col-number">明細番号</th>
                <th className="col-name">名称（下段）</th>
                <th className="col-description">摘要（下段）</th>
                <th className="col-unit">単位</th>
                <th className="col-remarks">備考（下段）</th>
              </tr>
            </thead>
            {rows.map((row, index) => (
              <tbody
                key={row.key}
                className={index === selectedIndex ? 'detail-group selected' : 'detail-group'}
                draggable
                onDragStart={() => (dragIndex.current = index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex.current !== null) handleMove(dragIndex.current, index)
                  dragIndex.current = null
                }}
                onFocus={() => setSelectedIndex(index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              >
                <tr className="upper-row">
                  <td className="col-handle" rowSpan={2} title="ドラッグで並び替え">
                    ⠿
                  </td>
                  <td className="col-no" rowSpan={2}>
                    {index + 1}
                  </td>
                  <td className="col-number part-number" />
                  <td className="col-category" rowSpan={2}>
                    <select
                      value={row.materialCategoryId ?? ''}
                      onChange={(e) =>
                        handleChange(
                          index,
                          'materialCategoryId',
                          e.target.value === '' ? null : Number(e.target.value)
                        )
                      }
                    >
                      <option value="">（未設定）</option>
                      {options.materialCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="col-name">
                    <span className="readonly-cell" title="部位名（表示専用）">
                      {row.partName}
                    </span>
                  </td>
                  <td>
                    <input
                      placeholder="摘要（上段）"
                      value={row.descriptionUpper}
                      onChange={(e) => handleChange(index, 'descriptionUpper', e.target.value)}
                    />
                  </td>
                  <td className="col-unit part-number" />
                  <td>
                    <input
                      placeholder="備考（上段）"
                      value={row.remarksUpper}
                      onChange={(e) => handleChange(index, 'remarksUpper', e.target.value)}
                    />
                  </td>
                  <td className="col-estimate" rowSpan={2}>
                    <input
                      value={row.estimateDisplay}
                      onChange={(e) => handleChange(index, 'estimateDisplay', e.target.value)}
                    />
                  </td>
                  <td className="col-active" rowSpan={2}>
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => handleChange(index, 'isActive', e.target.checked)}
                    />
                  </td>
                </tr>
                <tr className="lower-row">
                  <td className="col-number">
                    <input
                      className="num"
                      inputMode="decimal"
                      placeholder="0.00"
                      title="明細番号（小数点以下2桁の数値）"
                      value={row.detailNumberInput}
                      onChange={(e) => handleDetailNumberChange(index, e.target.value)}
                      onBlur={() => handleDetailNumberBlur(index)}
                    />
                  </td>
                  <td>
                    <input
                      placeholder="名称"
                      value={row.name}
                      onChange={(e) => handleChange(index, 'name', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      placeholder="摘要（下段）"
                      value={row.descriptionLower}
                      onChange={(e) => handleChange(index, 'descriptionLower', e.target.value)}
                    />
                  </td>
                  <td className="col-unit">
                    <input
                      list="unit-options"
                      value={row.unit}
                      onChange={(e) => handleChange(index, 'unit', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      placeholder="備考（下段）"
                      value={row.remarksLower}
                      onChange={(e) => handleChange(index, 'remarksLower', e.target.value)}
                    />
                  </td>
                </tr>
              </tbody>
            ))}
            {rows.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={10} className="empty">
                    明細がありません。「➕ 行挿入」で追加してください。
                  </td>
                </tr>
              </tbody>
            )}
          </table>
          <datalist id="unit-options">
            {options.units.map((u) => (
              <option key={u.id} value={u.name} />
            ))}
          </datalist>
        </div>

        <footer className="grid-footer">
          <button type="button" onClick={() => mutate([...rows, createEmptyRow()])}>
            ➕ 最終行に追加
          </button>
          <span>{rows.length} 明細（1明細=2段）</span>
          <span className="hint">
            Ctrl+Enter:行挿入 / Ctrl+Delete:行削除 / Alt+↑↓:行移動 / Ctrl+D:行コピー / Ctrl+S:保存
          </span>
        </footer>
      </section>
    </div>
  )
}
