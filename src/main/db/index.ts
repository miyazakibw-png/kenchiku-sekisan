import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrations } from "./migrations";
import * as schema from "./schema";
import { seedInitialData } from "./seed";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let db: AppDatabase | null = null;

function applyMigrations(conn: Database.Database): void {
  const current = conn.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < migrations.length; version++) {
    conn.exec("BEGIN");
    try {
      conn.exec(migrations[version]);
      conn.pragma(`user_version = ${version + 1}`);
      conn.exec("COMMIT");
    } catch (error) {
      conn.exec("ROLLBACK");
      throw error;
    }
  }
}

export function initDatabase(filePath: string): AppDatabase {
  sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  applyMigrations(sqlite);
  db = drizzle(sqlite, { schema });
  seedInitialData(db);
  return db;
}

export function getDatabase(): AppDatabase {
  if (!db) throw new Error("データベースが初期化されていません");
  return db;
}

export function closeDatabase(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
}

export { schema };
