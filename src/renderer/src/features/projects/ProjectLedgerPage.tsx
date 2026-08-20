import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MasterOptions, ProjectField, ProjectSummary } from '@shared/types'
import {
  copyName,
  moveProject,
  normalizeDate,
  sortProjects,
  type LedgerSortKey
} from './projectLedger'
import ProjectWorkspacePage from './ProjectWorkspacePage'
import './ProjectLedgerPage.css'

interface LedgerProps {
  options: MasterOptions
  /** 物件専用ウィンドウのときは、その工事を最初から開く */
  initialProjectId?: number | null
}

export default function ProjectLedgerPage({
  options,
  initialProjectId = null
}: LedgerProps): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [fields, setFields] = useState<ProjectField[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  /** 開いている工事（積算操作画面） */
  const [openedId, setOpenedId] = useState<number | null>(initialProjectId)
  const projectWindow = initialProjectId !== null
  const [fieldEditor, setFieldEditor] = useState<ProjectField[] | null>(null)
  const [sortDescending, setSortDescending] = useState(false)
  const [toast, setToast] = useState('')
  const dragIndex = useRef<number | null>(null)

  const reload = useCallback(async () => {
    const ledger = await window.sekisan.getProjectLedger()
    setProjects(ledger.projects)
    setFields(ledger.fields)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? null,
    [projects, selectedId]
  )

  const persistOrder = useCallback(async (ordered: ProjectSummary[]) => {
    setProjects(ordered)
    setProjects(await window.sekisan.reorderProjects(ordered.map((project) => project.id)))
  }, [])

  const saveProject = useCallback(async (project: ProjectSummary) => {
    const saved = await window.sekisan.saveProject({
      id: project.id,
      projectDate: project.projectDate,
      name: project.name,
      builderName: project.builderName,
      designerName: project.designerName,
      note: project.note,
      fieldValues: project.fieldValues
    })
    setProjects((prev) => prev.map((row) => (row.id === saved.id ? saved : row)))
    setToast('保存しました')
  }, [])

  /** 画面上の編集は行だけを差し替え、確定（フォーカスアウト）で保存する */
  const editRow = useCallback((id: number, patch: Partial<ProjectSummary>) => {
    setProjects((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }, [])

  const editFieldValue = useCallback(
    (project: ProjectSummary, fieldId: number, value: string) =>
      editRow(project.id, {
        fieldValues: { ...project.fieldValues, [fieldId]: value }
      }),
    [editRow]
  )

  const create = useCallback(async () => {
    const created = await window.sekisan.createProject('新規工事')
    await reload()
    setSelectedId(created.id)
    setToast(`管理番号 ${created.managementNo} を作成しました`)
  }, [reload])

  const copy = useCallback(async () => {
    if (!selected) return
    const created = await window.sekisan.copyProject(selected.id, copyName(selected.name))
    await reload()
    setSelectedId(created.id)
    setToast(`${selected.name} をコピーしました（${created.managementNo}）`)
  }, [reload, selected])

  const sortBy = useCallback(
    (key: LedgerSortKey) => {
      const descending = !sortDescending
      setSortDescending(descending)
      void persistOrder(sortProjects(projects, key, descending))
    },
    [persistOrder, projects, sortDescending]
  )

  const move = useCallback(
    (from: number, to: number) => {
      const moved = moveProject(projects, from, to)
      if (moved !== projects) void persistOrder(moved)
    },
    [persistOrder, projects]
  )

  const commitDate = useCallback(
    (project: ProjectSummary, input: string) => {
      const normalized = normalizeDate(input)
      if (!normalized) {
        setToast('日付は 2026-08-17 の形式で入力してください')
        return
      }
      void saveProject({ ...project, projectDate: normalized })
    },
    [saveProject]
  )

  const saveFields = useCallback(async () => {
    if (!fieldEditor) return
    setFields(await window.sekisan.saveProjectFields(fieldEditor))
    setFieldEditor(null)
    await reload()
    setToast('表示項目を保存しました')
  }, [fieldEditor, reload])

  const selectedIndex = projects.findIndex((project) => project.id === selectedId)
  const opened = projects.find((project) => project.id === openedId) ?? null

  if (opened) {
    return (
      <ProjectWorkspacePage
        project={opened}
        fields={fields}
        options={options}
        onSave={(project) => void saveProject(project)}
        onBack={() => {
          if (projectWindow) void window.sekisan.closeWindow()
          else setOpenedId(null)
        }}
        backLabel={projectWindow ? '✕ この工事を閉じる' : undefined}
      />
    )
  }

  return (
    <div className="project-page">
      <div className="toolbar">
        <h2>物件管理台帳</h2>
        <button type="button" onClick={() => void create()}>
          ➕ 新規作成
        </button>
        <button type="button" disabled={!selected} onClick={() => void copy()}>
          ⧉ 既存物件をコピー
        </button>
        <button
          type="button"
          disabled={selectedIndex <= 0}
          onClick={() => move(selectedIndex, selectedIndex - 1)}
        >
          ↑ 上へ
        </button>
        <button
          type="button"
          disabled={selectedIndex < 0 || selectedIndex >= projects.length - 1}
          onClick={() => move(selectedIndex, selectedIndex + 1)}
        >
          ↓ 下へ
        </button>
        <button type="button" onClick={() => setFieldEditor(fields.map((field) => ({ ...field })))}>
          ⚙ 表示項目
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && void window.sekisan.openProjectWindow(selected.id)}
        >
          🗔 工事を開く
        </button>
        <span className="hint">
          ダブルクリックで別ウィンドウ（複数物件を同時に作業できます）／ドラッグ・列見出しで並べ替え
        </span>
        <span className="status">{toast}</span>
      </div>

      <table className="grid project-list">
        <thead>
          <tr>
            <th className="handle" />
            <th onClick={() => sortBy('projectDate')}>日付</th>
            <th onClick={() => sortBy('managementNo')}>管理番号</th>
            <th onClick={() => sortBy('name')}>工事名称</th>
            <th onClick={() => sortBy('builderName')}>建設会社</th>
            <th onClick={() => sortBy('designerName')}>設計事務所</th>
            <th onClick={() => sortBy('note')}>備考</th>
            {fields.map((field) => (
              <th key={field.id}>{field.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.length === 0 && (
            <tr>
              <td colSpan={7 + fields.length} className="empty">
                物件がまだありません。「新規作成」から追加してください。
              </td>
            </tr>
          )}
          {projects.map((project, index) => (
            <tr
              key={project.id}
              draggable
              className={selectedId === project.id ? 'selected' : ''}
              onClick={() => setSelectedId(project.id)}
              onDoubleClick={() => void window.sekisan.openProjectWindow(project.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void window.sekisan.openProjectWindow(project.id)
              }}
              onDragStart={() => {
                dragIndex.current = index
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex.current !== null) move(dragIndex.current, index)
                dragIndex.current = null
              }}
            >
              <td className="handle" title="ドラッグで並べ替え">
                ⋮⋮
              </td>
              <td>
                <input
                  className="date"
                  value={project.projectDate}
                  onChange={(e) => editRow(project.id, { projectDate: e.target.value })}
                  onBlur={(e) => commitDate(project, e.target.value)}
                />
              </td>
              <td className="management-no" title="管理用の自動採番のため変更できません">
                {project.managementNo}
              </td>
              <td>
                <input
                  value={project.name}
                  onChange={(e) => editRow(project.id, { name: e.target.value })}
                  onBlur={() => void saveProject(project)}
                />
              </td>
              <td>
                <input
                  value={project.builderName}
                  onChange={(e) => editRow(project.id, { builderName: e.target.value })}
                  onBlur={() => void saveProject(project)}
                />
              </td>
              <td>
                <input
                  value={project.designerName}
                  onChange={(e) => editRow(project.id, { designerName: e.target.value })}
                  onBlur={() => void saveProject(project)}
                />
              </td>
              <td>
                <input
                  value={project.note}
                  onChange={(e) => editRow(project.id, { note: e.target.value })}
                  onBlur={() => void saveProject(project)}
                />
              </td>
              {fields.map((field) => (
                <td key={field.id}>
                  <input
                    style={{ width: `${field.displayWidth}ch` }}
                    value={project.fieldValues[field.id] ?? ''}
                    onChange={(e) => editFieldValue(project, field.id, e.target.value)}
                    onBlur={() => void saveProject(project)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {fieldEditor && (
        <div className="modal-backdrop" role="dialog">
          <div className="modal fields">
            <header>
              <h3>表示項目（ユーザー定義列）</h3>
              <span className="hint">
                表示文字数は画面に見える範囲の指定です。入力自体は制限しません
              </span>
            </header>
            <div className="modal-body">
              <table className="grid">
                <thead>
                  <tr>
                    <th>タイトル</th>
                    <th>表示文字数（半角）</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldEditor.map((field, index) => (
                    <tr key={field.id > 0 ? field.id : `new-${index}`}>
                      <td>
                        <input
                          value={field.title}
                          onChange={(e) =>
                            setFieldEditor(
                              fieldEditor.map((row, i) =>
                                i === index ? { ...row, title: e.target.value } : row
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          value={field.displayWidth}
                          onChange={(e) =>
                            setFieldEditor(
                              fieldEditor.map((row, i) =>
                                i === index
                                  ? {
                                      ...row,
                                      displayWidth: Number(e.target.value) || 0
                                    }
                                  : row
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() =>
                            setFieldEditor(fieldEditor.filter((_row, i) => i !== index))
                          }
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer>
              <button
                type="button"
                onClick={() =>
                  setFieldEditor([
                    ...fieldEditor,
                    {
                      id: 0,
                      title: '追加項目',
                      displayWidth: 30,
                      displayOrder: fieldEditor.length + 1
                    }
                  ])
                }
              >
                ➕ 表項目を追加
              </button>
              <span className="spacer" />
              <button type="button" onClick={() => setFieldEditor(null)}>
                閉じる
              </button>
              <button type="button" className="primary" onClick={() => void saveFields()}>
                💾 保存
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
