import { useEffect, useState } from 'react'
import type { MasterOptions } from '@shared/types'
import DetailMasterPage from './features/details/DetailMasterPage'
import AssemblyMasterPage from './features/assemblies/AssemblyMasterPage'

type NavKey = 'details' | 'assemblies' | 'projects' | 'settings'

const NAV: { key: NavKey; label: string; icon: string; ready: boolean }[] = [
  { key: 'details', label: '明細マスター', icon: '📋', ready: true },
  { key: 'assemblies', label: '仕上明細セット', icon: '🧱', ready: true },
  { key: 'projects', label: '物件管理', icon: '🏢', ready: false },
  { key: 'settings', label: '設定', icon: '⚙️', ready: false }
]

export default function App(): JSX.Element {
  const [options, setOptions] = useState<MasterOptions | null>(null)
  const [nav, setNav] = useState<NavKey>('details')

  useEffect(() => {
    void window.sekisan.getMasterOptions().then(setOptions)
  }, [])

  return (
    <div className="app">
      <nav className="app-nav">
        <div className="app-title">🏗 建築積算システム</div>
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={item.key === nav ? 'nav-item active' : 'nav-item'}
            onClick={() => setNav(item.key)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <main className="app-main">
        {!options ? (
          <div className="placeholder">読み込み中…</div>
        ) : nav === 'details' ? (
          <DetailMasterPage options={options} />
        ) : nav === 'assemblies' ? (
          <AssemblyMasterPage />
        ) : (
          <div className="placeholder">
            {NAV.find((item) => item.key === nav)?.label} は今後実装予定です。
          </div>
        )}
      </main>
    </div>
  )
}
