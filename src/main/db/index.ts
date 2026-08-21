import { copyFileSync, existsSync, rmSync } from 'fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrations } from './migrations'
import * as schema from './schema'
import { seedInitialData } from './seed'

export type AppDatabase = BetterSQLite3Database<typeof schema>

let sqlite: Database.Database | null = null
let db: AppDatabase | null = null
let dbPath = ''

function applyMigrations(conn: Database.Database): void {
  const current = conn.pragma('user_version', { simple: true }) as number
  for (let version = current; version < migrations.length; version++) {
    conn.exec('BEGIN')
    try {
      conn.exec(migrations[version])
      conn.pragma(`user_version = ${version + 1}`)
      conn.exec('COMMIT')
    } catch (error) {
      conn.exec('ROLLBACK')
      throw error
    }
  }
}

export function initDatabase(filePath: string): AppDatabase {
  dbPath = filePath
  sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  applyMigrations(sqlite)
  db = drizzle(sqlite, { schema })
  seedInitialData(db)
  return db
}

export function getDatabase(): AppDatabase {
  if (!db) throw new Error('データベースが初期化されていません')
  return db
}

export function closeDatabase(): void {
  sqlite?.close()
  sqlite = null
  db = null
}

/** 積算データ（DB）の保存場所 */
export function getDatabasePath(): string {
  return dbPath
}

/** DB を1ファイルにまとめて保存する（使用中でも安全にコピーできる） */
export async function backupDatabaseTo(destPath: string): Promise<void> {
  if (!sqlite) throw new Error('データベースが初期化されていません')
  await sqlite.backup(destPath)
}

export interface BackupCheck {
  ok: boolean
  message: string
  projectCount: number
  version: number
}

/** 復元しようとしているファイルが積算データかどうか調べる */
export function checkBackupFile(filePath: string): BackupCheck {
  if (!existsSync(filePath)) {
    return { ok: false, message: 'ファイルが見つかりません。', projectCount: 0, version: 0 }
  }
  let conn: Database.Database | null = null
  try {
    conn = new Database(filePath, { readonly: true, fileMustExist: true })
    const table = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
      .get() as { name: string } | undefined
    if (!table) {
      return {
        ok: false,
        message: 'このファイルは積算データではありません。',
        projectCount: 0,
        version: 0
      }
    }
    const version = conn.pragma('user_version', { simple: true }) as number
    if (version > migrations.length) {
      return {
        ok: false,
        message: `新しい版のデータです（版 ${version}）。ソフトを更新してから復元してください。`,
        projectCount: 0,
        version
      }
    }
    const counted = conn.prepare('SELECT count(*) AS n FROM projects').get() as { n: number }
    return {
      ok: true,
      message: `工事 ${counted.n} 件（版 ${version}）`,
      projectCount: counted.n,
      version
    }
  } catch {
    return { ok: false, message: 'ファイルを読めませんでした。', projectCount: 0, version: 0 }
  } finally {
    conn?.close()
  }
}

/**
 * バックアップから戻す。今のデータは rollbackPath に退避してから置き換える。
 * 置き換え後は同じ場所で開き直し、必要なら移行（マイグレーション）も行う。
 */
export async function restoreDatabaseFrom(
  sourcePath: string,
  rollbackPath: string
): Promise<void> {
  const target = dbPath
  if (target === '') throw new Error('データベースが初期化されていません')
  await backupDatabaseTo(rollbackPath)
  closeDatabase()
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${target}${suffix}`, { force: true })
  }
  try {
    copyFileSync(sourcePath, target)
    initDatabase(target)
  } catch (error) {
    copyFileSync(rollbackPath, target)
    initDatabase(target)
    throw error
  }
}

export { schema }
