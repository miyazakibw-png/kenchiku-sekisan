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
import UnitInput, { UnitOptions } from '../../components/UnitInput'
import { useUndoRedo } from '../../hooks/useUndoRedo'
import {
  buildPastePreview,
  copyRangeAsTsv,
  isInRange,
  normalizeRange,
  type CellRange,
  type PastePreview
} from '../grid/gridClipboard'
import { buildDetailColumns, sortByDetailNumber } from './detailColumns'
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

/** Undo/Redoで復元する画面状態 */
interface HistorySnapshot {
  rows: DraftRow[]
  deletedIds: number[]
}

export default function DetailMasterPage({ options }: Props): JSX.Element {
  const [subject, setSubject] = useState<Subject | null>(options.subjects[0] ?? null)
  const [rows, setRows] = useState<DraftRow[]>([])
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filter, setFilter] = useState('')
  const dragIndex = useRef<number | null>(null)
  const [selectedCol, setSelectedCol] = useState(0)
  const [range, setRange] = useState<CellRange | null>(null)
  const [sortAscending, setSortAscending] = useState(false)
  const [preview, setPreview] = useState<PastePreview<DraftRow> | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const history = useUndoRedo<HistorySnapshot>()

  const columns = useMemo(
    () => buildDetailColumns(options.materialCategories, options.units),
    [options.materialCategories, options.units]
  )

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

  const snapshotRef = useRef<HistorySnapshot>({ rows, deletedIds })
  snapshotRef.current = { rows, deletedIds }

  /**
   * 履歴からの復元。
   * 保存済みの行が復元後に存在しない場合は削除対象へ加える
   * （加えないと次回の自動保存でDBから読み直され復活してしまう）。
   */
  const restore = useCallback((snapshot: HistorySnapshot) => {
    const keptIds = new Set(snapshot.rows.map((row) => row.id).filter((id): id is number => id !== null))
    const removedIds = snapshotRef.current.rows
      .map((row) => row.id)
      .filter((id): id is number => id !== null && !keptIds.has(id))
    setRows(snapshot.rows)
    setDeletedIds([...new Set([...snapshot.deletedIds, ...removedIds])])
  }, [])

  const mutate = useCallback(
    (next: DraftRow[]) => {
      history.push(snapshotRef.current)
      setRows(sortAscending ? sortByDetailNumber(next) : next)
      markDirty()
    },
    [history, markDirty, sortAscending]
  )

  const handleUndo = useCallback(() => {
    const previous = history.undo(snapshotRef.current)
    if (previous === null) return
    restore(previous)
    markDirty()
  }, [history, markDirty, restore])

  const handleRedo = useCallback(() => {
    const next = history.redo(snapshotRef.current)
    if (next === null) return
    restore(next)
    markDirty()
  }, [history, markDirty, restore])

  const handleToggleSort = useCallback(() => {
    const next = !sortAscending
    setSortAscending(next)
    if (next) mutate(sortByDetailNumber(rows))
  }, [mutate, rows, sortAscending])

  const selectCell = useCallback((rowIndex: number, col: number, extend: boolean) => {
    setSelectedIndex(rowIndex)
    setSelectedCol(col)
    setRange((prev) =>
      extend && prev
        ? { ...prev, endRow: rowIndex, endCol: col }
        : { startRow: rowIndex, startCol: col, endRow: rowIndex, endCol: col }
    )
  }, [])

  // Shift+クリック直後のフォーカスで範囲が1セルへ縮小しないよう、押下時の状態を引き継ぐ
  const extendRef = useRef(false)

  const cellProps = useCallback(
    (rowIndex: number, col: number) => ({
      className: isInRange(range, rowIndex, col) ? 'cell in-range' : 'cell',
      onMouseDown: (e: React.MouseEvent) => {
        extendRef.current = e.shiftKey
        selectCell(rowIndex, col, e.shiftKey)
      },
      onFocus: () => {
        selectCell(rowIndex, col, extendRef.current)
        extendRef.current = false
      }
    }),
    [range, selectCell]
  )

  const handleCopyRange = useCallback(async () => {
    const target = range ?? {
      startRow: selectedIndex,
      startCol: selectedCol,
      endRow: selectedIndex,
      endCol: selectedCol
    }
    const tsv = copyRangeAsTsv(rows, columns, target)
    await navigator.clipboard.writeText(tsv)
    const r = normalizeRange(target)
    setToast(`📋 ${r.endRow - r.startRow + 1}行 × ${r.endCol - r.startCol + 1}列をコピーしました`)
  }, [columns, range, rows, selectedCol, selectedIndex])

  const handlePasteRequest = useCallback(async () => {
    const text = await navigator.clipboard.readText()
    if (!text) return
    setPreview(
      buildPastePreview(rows, columns, text, selectedIndex, selectedCol, createEmptyRow)
    )
  }, [columns, rows, selectedCol, selectedIndex])

  const handlePasteConfirm = useCallback(() => {
    if (!preview) return
    mutate(preview.rows)
    setToast(
      `✅ ${preview.cells.length}行を貼り付けました（追加 ${preview.addedRows} 行）。Ctrl+Z で元に戻せます`
    )
    setPreview(null)
  }, [mutate, preview])

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
      } else if (event.ctrlKey && event.key === 'c') {
        void handleCopyRange()
      } else if (event.ctrlKey && event.key === 'v') {
        event.preventDefault()
        void handlePasteRequest()
      } else if (event.ctrlKey && event.key === 'z') {
        event.preventDefault()
        handleUndo()
      } else if (event.ctrlKey && event.key === 'y') {
        event.preventDefault()
        handleRedo()
      }
    },
    [
      handleCopy,
      handleCopyRange,
      handleDelete,
      handleInsert,
      handleMove,
      handlePasteRequest,
      handleRedo,
      handleUndo,
      saveNow
    ]
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
            <button
              type="button"
              title="選択範囲をExcel形式でコピー (Ctrl+C)"
              onClick={() => void handleCopyRange()}
            >
              📋 コピー
            </button>
            <button
              type="button"
              title="Excelから範囲貼り付け (Ctrl+V)"
              onClick={() => void handlePasteRequest()}
            >
              📥 貼り付け
            </button>
            <button
              type="button"
              title="元に戻す (Ctrl+Z)"
              disabled={!history.canUndo}
              onClick={handleUndo}
            >
              ↩ 戻す
            </button>
            <button
              type="button"
              title="やり直す (Ctrl+Y)"
              disabled={!history.canRedo}
              onClick={handleRedo}
            >
              ↪ 進む
            </button>
            <button
              type="button"
              title="明細番号の昇順で表示する"
              className={sortAscending ? 'toggle on' : 'toggle'}
              onClick={handleToggleSort}
            >
              {sortAscending ? '🔢 昇順表示 ON' : '🔢 昇順表示 OFF'}
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
                  <td
                    {...cellProps(index, 8)}
                    className={`col-category ${cellProps(index, 8).className}`}
                    rowSpan={2}
                  >
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
                  <td {...cellProps(index, 1)}>
                    <span className="readonly-cell" title="部位名（表示専用）">
                      {row.partName}
                    </span>
                  </td>
                  <td {...cellProps(index, 3)}>
                    <input
                      placeholder="摘要（上段）"
                      value={row.descriptionUpper}
                      onChange={(e) => handleChange(index, 'descriptionUpper', e.target.value)}
                    />
                  </td>
                  <td className="col-unit part-number" />
                  <td {...cellProps(index, 6)}>
                    <input
                      placeholder="備考（上段）"
                      value={row.remarksUpper}
                      onChange={(e) => handleChange(index, 'remarksUpper', e.target.value)}
                    />
                  </td>
                  <td
                    {...cellProps(index, 9)}
                    className={`col-estimate ${cellProps(index, 9).className}`}
                    rowSpan={2}
                  >
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
                  <td
                    {...cellProps(index, 0)}
                    className={`col-number ${cellProps(index, 0).className}`}
                  >
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
                  <td {...cellProps(index, 2)}>
                    <input
                      placeholder="名称"
                      value={row.name}
                      onChange={(e) => handleChange(index, 'name', e.target.value)}
                    />
                  </td>
                  <td {...cellProps(index, 4)}>
                    <input
                      placeholder="摘要（下段）"
                      value={row.descriptionLower}
                      onChange={(e) => handleChange(index, 'descriptionLower', e.target.value)}
                    />
                  </td>
                  <td
                    {...cellProps(index, 5)}
                    className={`col-unit ${cellProps(index, 5).className}`}
                  >
                    <UnitInput
                      units={options.units}
                      value={row.unit}
                      onChange={(value) => handleChange(index, 'unit', value)}
                    />
                  </td>
                  <td {...cellProps(index, 7)}>
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
          <UnitOptions units={options.units} />
        </div>

        <footer className="grid-footer">
          <button type="button" onClick={() => mutate([...rows, createEmptyRow()])}>
            ➕ 最終行に追加
          </button>
          <span>{rows.length} 明細（1明細=2段）</span>
          <span className="hint">
            Ctrl+Enter:行挿入 / Ctrl+Delete:行削除 / Alt+↑↓:行移動 / Ctrl+D:行コピー / Ctrl+S:保存 /
            Ctrl+C:コピー / Ctrl+V:貼り付け / Ctrl+Z:戻す / Ctrl+Y:進む（Shift+クリックで範囲選択）
          </span>
        </footer>
      </section>

      {preview && (
        <div className="paste-preview-backdrop" role="dialog">
          <div className="paste-preview">
            <h3>📥 貼り付けプレビュー</h3>
            <p>
              {preview.cells.length}行 × {preview.cells[0]?.length ?? 0}列 を{' '}
              {preview.startRow + 1}行目・「{preview.columns[preview.startCol]?.label ?? ''}」列から
              貼り付けます（新規追加 {preview.addedRows} 行）。
              {preview.errorCount > 0 && (
                <strong className="error"> ⛔ エラー {preview.errorCount} 件（赤いセル・取り込みません）</strong>
              )}
              {preview.warningCount > 0 && (
                <strong className="warning">
                  {' '}
                  ⚠ 警告 {preview.warningCount} 件（黄色いセル・取り込みます）
                </strong>
              )}
            </p>
            <div className="preview-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    {preview.cells[0]?.map((_, c) => (
                      <th key={c}>{preview.columns[preview.startCol + c]?.label ?? '（列なし）'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.cells.map((line, r) => (
                    <tr key={r}>
                      {line.map((cell, c) => (
                        <td
                          key={c}
                          className={cell.error ? 'invalid' : cell.warning ? 'warned' : ''}
                          title={cell.error ?? cell.warning}
                        >
                          {cell.value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="preview-actions">
              <button type="button" onClick={() => setPreview(null)}>
                ✖ キャンセル
              </button>
              <button type="button" onClick={handlePasteConfirm}>
                ✅ 貼り付けを確定
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => {
              handleUndo()
              setToast(null)
            }}
          >
            ↩ 元に戻す
          </button>
          <button type="button" onClick={() => setToast(null)}>
            ✖
          </button>
        </div>
      )}
    </div>
  )
}
