/**
 * VRCX Database Reader (Fallback)
 * Reads VRChat location data from VRCX's SQLite database in read-only mode.
 * Used as a fallback when vrchat-log-watcher is not available.
 */
import debug from '../../services/debugger'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'

interface VrcxLocationRow {
  location: string
  world_name: string
  group_name: string
}

let DatabaseClass: typeof import('better-sqlite3') | null = null
try {
  DatabaseClass = require('better-sqlite3')
} catch {
  debug.info('[VrcxDbReader] better-sqlite3 not available — VRCX fallback disabled')
}
const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'VRCX', 'VRCX.sqlite3')
const LOCATION_QUERY = 'SELECT location, world_name, group_name FROM gamelog_location ORDER BY id DESC LIMIT 1'
function getDbPath(override: string | null): string {
  return override || DB_PATH
}
export function isVrcxAvailable(dbPathOverride: string | null = null): boolean {
  if (!DatabaseClass) return false
  try {
    return fs.existsSync(getDbPath(dbPathOverride))
  } catch {
    return false
  }
}
export function getVrcxCurrentLocation(dbPathOverride: string | null = null): VrcxLocationRow | null {
  if (!DatabaseClass) return null
  const dbPath = getDbPath(dbPathOverride)
  if (!fs.existsSync(dbPath)) return null
  let conn: import('better-sqlite3').Database | null = null
  try {
    conn = new (DatabaseClass as any)(dbPath, { readonly: true, fileMustExist: true })
    const row = conn.prepare(LOCATION_QUERY).get() as VrcxLocationRow | undefined
    return row || null
  } catch (error: unknown) {
    debug.warn(`[VrcxDbReader] Failed to read VRCX database: ${(error as Error).message}`)
    return null
  } finally {
    if (conn) {
      try { conn.close() } catch { /* ignore */ }
    }
  }
}
export function getVrcxWorldName(worldId: string, dbPathOverride: string | null = null): string | null {
  if (!DatabaseClass) return null
  const dbPath = getDbPath(dbPathOverride)
  if (!fs.existsSync(dbPath)) return null
  let conn: import('better-sqlite3').Database | null = null
  try {
    conn = new (DatabaseClass as any)(dbPath, { readonly: true, fileMustExist: true })
    const row = conn.prepare('SELECT name FROM cache_world WHERE id = ? LIMIT 1').get(worldId) as { name: string } | undefined
    return row?.name || null
  } catch {
    return null
  } finally {
    if (conn) {
      try { conn.close() } catch { /* ignore */ }
    }
  }
}
