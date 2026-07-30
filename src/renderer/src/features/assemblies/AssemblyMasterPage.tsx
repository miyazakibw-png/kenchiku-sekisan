import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AssemblyItemRole, AssemblyMasterOptions, FinishAssembly } from '@shared/types'
import { useAutoSave } from '../../hooks/useAutoSave'
import {
  ROLE_LABELS,
  addItem,
  createItem,
  duplicateAsNew,
  filterAssemblies,
  moveItem,
  removeItem,
  updateItem
} from './assemblyEditor'
import './AssemblyMasterPage.css'

const STATUS_LABEL: Record<string, string> = {
  idle: '',
  dirty: '● 未保存',
  saving: '⏳ 保存中…',
  saved: '✅ 保存済み',
  error: '⚠ 保存失敗'
}

export default function AssemblyMasterPage(): JSX.Element {
  const [options, setOptions] = useState<AssemblyMasterOptions | null>(null)
  const [assemblies, setAssemblies] = useState<FinishAssembly[]>([])
  const [usageCategory, setUsageCategory] = useState<string | null>(null)
  const [partId, setPartId] = useState<number | null>(null)
  const [selected, setSelected] = useState<FinishAssembly | null>(null)

  useEffect(() => {
    void window.sekisan.getAssemblyOptions().then(setOptions)
    void window.sekisan.listAssemblies(null).then(setAssemblies)
  }, [])

  const visible = useMemo(
    () => filterAssemblies(assemblies, { usageCategory, partId }),
    [assemblies, usageCategory, partId]
  )

  const persist = useCallback(async (data: FinishAssembly | null) => {
    if (!data || data.assemblyName.trim() === '') return
    const saved = await window.sekisan.saveAssembly({
      id: data.id > 0 ? data.id : null,
      assemblyCode: data.assemblyCode,
      assemblyName: data.assemblyName,
      partId: data.partId,
      usageCategory: data.usageCategory,
      scope: data.scope,
      projectId: data.projectId,
      note: data.note,
      items: data.items
    })
    setSelected(saved)
    setAssemblies(await window.sekisan.listAssemblies(null))
  }, [])

  const { status, markDirty, saveNow } = useAutoSave({ data: selected, onSave: persist })

  const patch = useCallback(
    (values: Partial<FinishAssembly>) => {
      setSelected((prev) => (prev ? { ...prev, ...values } : prev))
      markDirty()
    },
    [markDirty]
  )

  const handleSelect = useCallback(
    async (assembly: FinishAssembly) => {
      if (assembly.id === selected?.id) return
      await saveNow()
      setSelected(assembly)
    },
    [saveNow, selected]
  )

  const handleNew = useCallback(async () => {
    await saveNow()
    setSelected({
      id: 0,
      assemblyCode: '',
      assemblyName: '',
      partId,
      usageCategory,
      scope: 'basic',
      projectId: null,
      note: '',
      displayOrder: 0,
      items: []
    })
  }, [partId, saveNow, usageCategory])

  const handleDuplicate = useCallback(async () => {
    if (!selected) return
    await saveNow()
    setSelected(duplicateAsNew(selected))
    markDirty()
  }, [markDirty, saveNow, selected])

  const handleDelete = useCallback(async () => {
    if (!selected || selected.id === 0) {
      setSelected(null)
      return
    }
    await window.sekisan.deleteAssembly(selected.id)
    setSelected(null)
    setAssemblies(await window.sekisan.listAssemblies(null))
  }, [selected])

  if (!options) return <div className="placeholder">読み込み中…</div>

  return (
    <div className="assembly-page">
      <aside className="assembly-tree">
        <div className="tree-title">🗂 部位・用途</div>
        <button
          type="button"
          className={usageCategory === null && partId === null ? 'tree-item active' : 'tree-item'}
          onClick={() => {
            setUsageCategory(null)
            setPartId(null)
          }}
        >
          すべて
        </button>
        {options.usageCategories.map((cat) => (
          <div key={cat} className="tree-group">
            <button
              type="button"
              className={
                usageCategory === cat && partId === null ? 'tree-item active' : 'tree-item'
              }
              onClick={() => {
                setUsageCategory(cat)
                setPartId(null)
              }}
            >
              📁 {cat}
            </button>
            {options.parts.map((part) => (
              <button
                key={`${cat}-${part.id}`}
                type="button"
                className={
                  usageCategory === cat && partId === part.id
                    ? 'tree-item child active'
                    : 'tree-item child'
                }
                onClick={() => {
                  setUsageCategory(cat)
                  setPartId(part.id)
                }}
              >
                {part.name}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section className="assembly-main">
        <header className="toolbar">
          <button type="button" onClick={() => void handleNew()}>
            ➕ 新規セット
          </button>
          <button type="button" disabled={!selected} onClick={() => void handleDuplicate()}>
            📄 複製
          </button>
          <button type="button" disabled={!selected} onClick={() => void handleDelete()}>
            🗑 削除
          </button>
          <button type="button" disabled={!selected} onClick={() => void saveNow()}>
            💾 保存
          </button>
          <span className="status">{STATUS_LABEL[status]}</span>
        </header>

        <div className="assembly-body">
          <div className="assembly-list">
            <table className="grid">
              <thead>
                <tr>
                  <th>記号</th>
                  <th>セット名称</th>
                  <th>部位</th>
                  <th>用途</th>
                  <th>区分</th>
                  <th>構成</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr
                    key={a.id}
                    className={a.id === selected?.id ? 'selected' : ''}
                    onClick={() => void handleSelect(a)}
                  >
                    <td>{a.assemblyCode}</td>
                    <td>{a.assemblyName}</td>
                    <td>{options.parts.find((p) => p.id === a.partId)?.name ?? ''}</td>
                    <td>{a.usageCategory ?? ''}</td>
                    <td>{a.scope === 'basic' ? '基本' : '物件'}</td>
                    <td>{a.items.length}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      セットがありません。「➕ 新規セット」で追加してください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="assembly-editor">
              <div className="fields">
                <label>
                  記号
                  <input
                    value={selected.assemblyCode ?? ''}
                    onChange={(e) => patch({ assemblyCode: e.target.value })}
                  />
                </label>
                <label>
                  セット名称
                  <input
                    value={selected.assemblyName}
                    placeholder="例: W-6 地下二重壁軸組"
                    onChange={(e) => patch({ assemblyName: e.target.value })}
                  />
                </label>
                <label>
                  部位
                  <select
                    value={selected.partId ?? ''}
                    onChange={(e) =>
                      patch({ partId: e.target.value === '' ? null : Number(e.target.value) })
                    }
                  >
                    <option value="">（未設定）</option>
                    {options.parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  用途
                  <select
                    value={selected.usageCategory ?? ''}
                    onChange={(e) =>
                      patch({ usageCategory: e.target.value === '' ? null : e.target.value })
                    }
                  >
                    <option value="">（未設定）</option>
                    {options.usageCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  備考
                  <input
                    value={selected.note}
                    onChange={(e) => patch({ note: e.target.value })}
                  />
                </label>
              </div>

              <table className="grid items">
                <thead>
                  <tr>
                    <th className="col-no">No.</th>
                    <th>役割</th>
                    <th>明細</th>
                    <th>単位</th>
                    <th>計算式（P=親数量）</th>
                    <th>係数</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((item, index) => (
                    <tr key={`${item.id ?? 'new'}-${index}`}>
                      <td className="col-no">{index + 1}</td>
                      <td>
                        <select
                          value={item.role}
                          onChange={(e) =>
                            patch({
                              items: updateItem(selected.items, index, {
                                role: e.target.value as AssemblyItemRole
                              })
                            })
                          }
                        >
                          {ROLE_LABELS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={item.detailId}
                          onChange={(e) =>
                            patch({
                              items: updateItem(selected.items, index, {
                                detailId: Number(e.target.value)
                              })
                            })
                          }
                        >
                          {options.details.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{options.details.find((d) => d.id === item.detailId)?.unit ?? ''}</td>
                      <td>
                        <input
                          placeholder="例: P*1.1"
                          value={item.formula}
                          onChange={(e) =>
                            patch({
                              items: updateItem(selected.items, index, { formula: e.target.value })
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          inputMode="decimal"
                          value={item.coefficient}
                          onChange={(e) =>
                            patch({
                              items: updateItem(selected.items, index, {
                                coefficient: Number(e.target.value) || 0
                              })
                            })
                          }
                        />
                      </td>
                      <td className="ops">
                        <button
                          type="button"
                          title="1行上"
                          onClick={() =>
                            patch({ items: moveItem(selected.items, index, index - 1) })
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="1行下"
                          onClick={() =>
                            patch({ items: moveItem(selected.items, index, index + 1) })
                          }
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          title="行削除"
                          onClick={() => patch({ items: removeItem(selected.items, index) })}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
                  {selected.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty">
                        構成明細がありません。「➕ 明細を追加」で追加してください。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <button
                type="button"
                disabled={options.details.length === 0}
                onClick={() =>
                  patch({
                    items: addItem(selected.items, createItem(options.details[0].id))
                  })
                }
              >
                ➕ 明細を追加
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
