import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo } from '@shared/types'
import './SettingsPage.css'

function sizeText(size: number): string {
  if (size < 1024) return `${size} バイト`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** 設定画面。積算データの保存（バックアップ）と復元を行う */
export default function SettingsPage(): JSX.Element {
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    void window.sekisan.getBackupInfo().then(setInfo)
  }, [])

  useEffect(reload, [reload])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.sekisan.createBackup()
      setMessage(result.message)
      reload()
    } catch (error) {
      setMessage(`保存できませんでした：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.sekisan.restoreBackup()
      setMessage(result.message)
      reload()
    } catch (error) {
      setMessage(`復元できませんでした：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <h2>⚙️ 設定</h2>
      <section className="settings-card">
        <h3>積算データの保存・復元</h3>
        <p className="settings-note">
          パソコンの入替えや故障に備えて、積算データ（工事・マスター・計算書のすべて）を1つのファイルに保存できます。
          ソフトを更新（上書きインストール）してもデータはそのまま使えます。
        </p>
        <table className="settings-table">
          <tbody>
            <tr>
              <th>保存場所</th>
              <td>{info?.databasePath ?? '—'}</td>
            </tr>
            <tr>
              <th>工事件数</th>
              <td>{info ? `${info.projectCount} 件` : '—'}</td>
            </tr>
            <tr>
              <th>データの大きさ</th>
              <td>{info ? sizeText(info.size) : '—'}</td>
            </tr>
          </tbody>
        </table>
        <div className="settings-buttons">
          <button type="button" className="settings-main" disabled={busy} onClick={save}>
            💾 データ保存（バックアップ）
          </button>
          <button type="button" className="settings-warn" disabled={busy} onClick={restore}>
            ♻ データ復元
          </button>
        </div>
        <p className="settings-note">
          復元は、選んだファイルの内容で今のデータを置き換えます（実行前に確認画面が出ます）。
          復元前のデータは自動で退避するので、間違えても元に戻せます。
        </p>
        {message !== '' && <p className="settings-message">{message}</p>}
      </section>
    </div>
  )
}
