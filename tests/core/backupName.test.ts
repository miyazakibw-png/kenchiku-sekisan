import { describe, expect, it } from 'vitest'
import { backupFileName, rollbackFileName } from '../../src/core/backup/backupName'

describe('バックアップのファイル名', () => {
  it('日付と時刻から既定名を作る', () => {
    expect(backupFileName(new Date(2026, 7, 21, 9, 5))).toBe('積算データ_20260821_0905.db')
  })

  it('復元前の退避名は接頭辞が付く', () => {
    expect(rollbackFileName(new Date(2026, 11, 3, 18, 30))).toBe('復元前_積算データ_20261203_1830.db')
  })
})
