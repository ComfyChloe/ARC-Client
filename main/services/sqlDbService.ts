// =============================================================================
// sqlDbService — Shared SQLite database singleton for ARC-Client
// =============================================================================
//
// PURPOSE:
//   Provides a single, shared SQLite connection that ALL addons and services
//   in the main process can use. Avoids multiple DB files and connections.
//
// ARCHITECTURE:
//   - One database file: userData/app.db
//   - One connection, one WAL file, one checkpoint thread
//   - Addon-specific table creation and queries live in each addon's own
//     module (e.g., hyperate.ts manages heartrate_log directly).
//   - This service ONLY manages the connection lifecycle.
//
// USAGE:
//   1. App startup (index.ts, after bootstrap):
//        initDb()
//   2. Inside any addon:
//        import { getDb } from '../services/sqlDbService'
//        const db = getDb()  // throws if not initialized
//        db.prepare('CREATE TABLE IF NOT EXISTS ...').run()
//   3. App shutdown (cleanup):
//        closeDb()
//
// TABLE NAMING:
//   Each addon owns its own table(s). Use a descriptive name.
//   Core tables (heartrate_log) are created here on startup so they always
//   exist regardless of whether the owning addon has been started this session.
//
// RULES:
//   - Always use parameterized queries (no string interpolation)
//   - WAL mode: concurrent reads are safe, writes are serialized
// =============================================================================

import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'
import debug from './debugger'

let db: Database.Database | null = null

function getDbPath(): string {
  return path.join(app.getPath('userData'), 'app.db')
}

/** Open the shared SQLite database. Safe to call multiple times (no-op if open). */
export function initDb(): void {
  if (db) return
  try {
    const dbPath = getDbPath()
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 5000')
    db.exec(`
      CREATE TABLE IF NOT EXISTS heartrate_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tracker_id TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        heart_rate INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hr_tracker_time ON heartrate_log(tracker_id, recorded_at);

      CREATE TABLE IF NOT EXISTS openshock_control_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shocker_id TEXT NOT NULL,
        shocker_name TEXT NOT NULL,
        control_type TEXT NOT NULL,
        intensity INTEGER,
        duration INTEGER,
        success INTEGER NOT NULL DEFAULT 1,
        error_message TEXT,
        recorded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_os_ctrl_time ON openshock_control_log(recorded_at);

      CREATE TABLE IF NOT EXISTS xs_overlay_notification_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_xso_time ON xs_overlay_notification_log(recorded_at);
    `)
    debug.info('[SqlDbService] Opened database at ' + dbPath + ' (tables ready)')
  } catch (error) {
    debug.error(`[SqlDbService] Failed to open database: ${(error as Error).message}`)
    db = null
  }
}

/** Return the active database connection. @throws if not initialized. */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('[SqlDbService] Database not initialized — call initDb() first')
  }
  return db
}

/** Check if the database is currently open (non-throwing). */
export function isReady(): boolean {
  return db !== null
}

/** Close the shared database. WAL checkpoint before close. Safe to call multiple times. */
export function closeDb(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    debug.info('[SqlDbService] Database closed')
  } catch (error) {
    debug.error(`[SqlDbService] Error closing database: ${(error as Error).message}`)
  }
  db = null
}
