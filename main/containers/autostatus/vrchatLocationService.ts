/**
 * VRChat Location Service — merged in-house copy of vrchat-log-watcher
 * + vrchat-location-parser. The two are tightly coupled (the watcher
 * emits `parseLocation(content.substring("Joining ".length))`), so we
 * vendor them together rather than maintaining two near-identical
 * copies of the same regex/parser tables.
 *
 * Behavior matches upstream packages verbatim (vendored from
 * vrchat-log-watcher@0.5.1 + vrchat-location-parser@0.2.0) — the
 * only material difference is that we use Node's built-in `node:fs`
 * + `node:path` + `node:os` instead of relying on the upstream
 * packages to do it transitively, and we depend on `tail` directly
 * for file tailing.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { EventEmitter } from 'node:events'
import VDF from 'vdf-parser'
// @ts-ignore — `tail` ships without types; we use it as a CommonJS module.
import * as Tail from 'tail'

// ── Constants ──────────────────────────────────────────────
const VRCHAT_APP_ID = '438100'
const VRCHAT_REGEX_GROUP = 1   // unused, kept for parity

// ── Type definitions ────────────────────────────────────────
export interface InstanceBase {
  worldId: string
  name: string
  type: string
  region?: 'eu' | 'jp' | 'us' | 'use' | string
  nonce?: string
}
export interface InstanceUser extends InstanceBase {
  type: 'friends+' | 'friends' | 'invite+' | 'invite'
  userId: string
}
export interface InstanceGroup extends InstanceBase {
  type: 'group' | 'groupPublic' | 'group+'
  groupId: string
  require18yo?: boolean
}
export type Instance = InstanceBase | InstanceUser | InstanceGroup

export interface WatcherEventDataBase {
  date: Date
  type: string
  data: string
}
export interface WatcherEventDataWithTopic extends WatcherEventDataBase {
  topic: string
  content: string
}
export type WatcherEventData = WatcherEventDataWithTopic | WatcherEventDataBase

// ── Location parser (vendored from vrchat-location-parser) ─

/**
 * Parse a raw instance id (the bit after the colon in a location
 * string) into a structured Instance object.
 */
export function parseInstance(worldId: string, instanceId: string): Instance | null {
  const instanceIdParts = Object.fromEntries(
    instanceId.split('~').map((x) => {
      const m = x.match(/^(?<key>[^\(]+)(\((?<value>[^\)]+)\))?$/)
      if (!m?.groups?.key) return []
      return [m.groups.key, m.groups.value ?? null]
    })
  ) as Record<string, string | null>
  const instanceName = Object.keys(instanceIdParts)[0]
  if (!instanceName) return null
  let instance: Instance = {
    worldId,
    name: instanceName,
    type: 'public',
  }
  if (instanceIdParts.region) {
    instance.region = instanceIdParts.region
  }
  if (instanceIdParts.nonce) {
    instance.nonce = instanceIdParts.nonce
  }
  if (instanceIdParts.hidden) {
    instance = {
      ...instance,
      type: 'friends+',
      userId: instanceIdParts.hidden,
    }
  } else if (instanceIdParts.friends) {
    instance = {
      ...instance,
      type: 'friends',
      userId: instanceIdParts.friends,
    }
  } else if (instanceIdParts.private) {
    instance = {
      ...instance,
      type: instanceIdParts.canRequestInvite ? 'invite+' : 'invite',
      userId: instanceIdParts.private,
    }
  } else if (instanceIdParts.group) {
    instance = {
      ...instance,
      type: instanceIdParts.groupAccessType === 'public'
        ? 'groupPublic'
        : instanceIdParts.groupAccessType === 'plus'
          ? 'group+'
          : 'group',
      groupId: instanceIdParts.group,
      require18yo: 'ageGate' in instanceIdParts,
    }
  }
  return instance
}

/**
 * Parse a full VRChat location string ("wrld_xxx:NUM~region(eu)" or
 * "private" / "offline" / "traveling" / "") into an Instance or null.
 */
export function parseLocation(location: string): Instance | null {
  if (['offline', 'traveling', 'private', ''].includes(location)) return null
  const [worldId, instanceId] = location.split(':')
  return parseInstance(worldId, instanceId)
}

/**
 * Format a structured Instance back into the canonical instance id
 * string (the bit after the colon).
 */
export function formatInstanceId(instance: Instance): string {
  let instanceId = instance.name
  switch (instance.type) {
    case 'friends+': {
      const u = instance as InstanceUser
      instanceId += `~hidden(${u.userId})`
      break
    }
    case 'friends': {
      const u = instance as InstanceUser
      instanceId += `~friends(${u.userId})`
      break
    }
    case 'invite+': {
      const u = instance as InstanceUser
      instanceId += `~private(${u.userId})~canRequestInvite`
      break
    }
    case 'invite': {
      const u = instance as InstanceUser
      instanceId += `~private(${u.userId})`
      break
    }
    case 'group':
    case 'groupPublic':
    case 'group+': {
      const g = instance as InstanceGroup
      instanceId += `~group(${g.groupId})`
      if (g.type === 'groupPublic') {
        instanceId += '~groupAccessType(public)'
      } else if (g.type === 'group+') {
        instanceId += '~groupAccessType(plus)'
      } else {
        instanceId += '~groupAccessType(members)'
      }
      if (g.require18yo) {
        instanceId += '~ageGate'
      }
      break
    }
  }
  if (instance.region) {
    instanceId += `~region(${instance.region})`
  }
  if (instance.nonce) {
    instanceId += `~nonce(${instance.nonce})`
  }
  return instanceId
}

/**
 * Format a structured Instance back into a full location string
 * ("worldId:instanceId").
 */
export function formatLocation(instance: Instance): string {
  return `${instance.worldId}:${formatInstanceId(instance)}`
}

// ── Log watcher (vendored from vrchat-log-watcher) ─────────

function returnPathIfExists(p: string): string | null {
  return fs.existsSync(p) ? p : null
}

function getVrchatLogDir(): string | null {
  if (process.platform === 'win32') {
    return returnPathIfExists(
      path.join(os.homedir(), 'Appdata', 'LocalLow', 'VRChat', 'VRChat')
    )
  }
  if (process.platform === 'linux') {
    const libraryFoldersPath = path.join(
      os.homedir(),
      '.steam',
      'steam',
      'steamapps',
      'libraryfolders.vdf'
    )
    if (!fs.existsSync(libraryFoldersPath)) return null
    const libraryFoldersText = fs.readFileSync(libraryFoldersPath).toString()
    const libraryFoldersConfig: any = VDF.parse(libraryFoldersText)
    const libraries: any[] = Object.values(libraryFoldersConfig.libraryfolders ?? {})
    // Upstream used Array.prototype.findLast which requires ES2023;
    // manual loop keeps us on the current TS lib target.
    let library: any | undefined
    for (let i = libraries.length - 1; i >= 0; i--) {
      const l = libraries[i]
      const appIds: string[] = Object.keys(l?.apps ?? {})
      for (let j = appIds.length - 1; j >= 0; j--) {
        if (appIds[j] === VRCHAT_APP_ID) { library = l; break }
      }
      if (library) break
    }
    if (!library?.path) return null
    return returnPathIfExists(
      path.join(
        library.path,
        'steamapps',
        'compatdata',
        '438100',
        'pfx',
        'drive_c',
        'users',
        'steamuser',
        'AppData',
        'LocalLow',
        'VRChat',
        'VRChat'
      )
    )
  }
  return null
}

function isVrchatLogFile(filename: string): boolean {
  return filename.startsWith('output_log_')
}

function getLatestLogfile(logDir: string): string | null {
  const files = fs
    .readdirSync(logDir)
    .filter(isVrchatLogFile)
    .map((x) => ({
      filename: x,
      createdAt: fs.statSync(path.join(logDir, x)).ctime.getTime(),
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
  const top = files[0]
  if (!top) return null
  return path.join(logDir, top.filename)
}

const LINE_REGEX =
  /^(?<date>\d{4}\.\d{2}\.\d{2} \d{2}\:\d{2}\:\d{2}) (?<type>[a-zA-Z]+) +-  (?<data>.*)$/
const LINE_DATA_REGEX =
  /^\[(?<topic>[a-zA-Z0-9 ]+)\] (?<content>.*)$/

export class VrchatLogWatcher extends EventEmitter {
  static lineRegex = LINE_REGEX
  static lineDataRegex = LINE_DATA_REGEX

  private vrchatLogDir: string
  private currentLogFile: string | null = null
  private tail: any = null

  constructor() {
    super()
    const logdir = getVrchatLogDir()
    if (!logdir) {
      throw new Error('VRChat log dir missing')
    }
    this.vrchatLogDir = logdir
    this.currentLogFile = getLatestLogfile(this.vrchatLogDir)
    this.watchFile()
    fs.watch(this.vrchatLogDir, (event, filename) => {
      if (!filename || event !== 'rename') return
      if (!isVrchatLogFile(filename)) return
      const newLogFile = getLatestLogfile(this.vrchatLogDir)
      if (newLogFile === null) return
      // Skip if unchanged (both may be null on the very first call).
      if (newLogFile === this.currentLogFile) return
      this.currentLogFile = newLogFile
      this.watchFile()
    })
  }

  watchFile = (): void => {
    if (this.tail) {
      this.tail.unwatch()
      this.tail = null
    }
    if (!this.currentLogFile) return
    // The `tail` package has `fromBeginning` as a constructor flag —
    // we always tail the active log file from end-of-file.
    this.tail = new (Tail as any).Tail(this.currentLogFile, { fromBeginning: false })
    this.tail.on('line', (data: string) => {
      this.emit('raw', data)
      this.parseLine(data)
    })
    this.tail.on('error', () => {
      this.tail?.unwatch()
    })
  }

  parseLine = (line: string): void => {
    const m = line.match(LINE_REGEX)
    if (!m?.groups?.date || !m?.groups?.type || !m?.groups?.data) return
    let type = m.groups.type.toLocaleLowerCase()
    if (type === 'error') type = 'err'
    const data: WatcherEventDataBase = {
      date: new Date(m.groups.date),
      type,
      data: m.groups.data.trim(),
    }
    const msgMatch = data.data.match(LINE_DATA_REGEX)
    if (msgMatch?.groups?.topic && msgMatch.groups.content) {
      const dataWithTopic: WatcherEventDataWithTopic = {
        ...data,
        topic: msgMatch.groups.topic,
        content: msgMatch.groups.content,
      }
      this.emit('data', dataWithTopic)
      this.emit(data.type, dataWithTopic)
      this.parseSpecialEvents(dataWithTopic)
      return
    }
    this.emit('data', data)
    this.emit(data.type, data)
    this.parseSpecialEvents(data)
  }

  parseSpecialEvents = (data: WatcherEventData): void => {
    // Special events only carry a topic; the no-topic path is a no-op.
    if (!('topic' in data) || !data.topic) return
    if (data.type === 'debug' && (data.topic === 'String Download' || data.topic === 'Image Download')) {
      const m = data.content.match(/Attempting to load (image|String) from URL '(?<url>[^']+)'/)
      if (m?.groups?.url) {
        const eventname = data.topic === 'String Download' ? 'stringLoad' : 'imageLoad'
        this.emit(eventname, { ...data, url: m.groups.url })
        return
      }
    }
    if (data.type === 'debug' && data.topic === 'Behaviour' && data.content.startsWith('Joining wrld_')) {
      const instance = parseLocation(data.content.substring('Joining '.length))
      if (instance) {
        this.emit('join', { ...data, instance })
      }
      return
    }
    if (data.type === 'debug' && data.topic === 'Behaviour' && data.content === 'Unloading scenes') {
      this.emit('leave', data)
      return
    }
    if (
      data.type === 'debug' &&
      data.topic === 'Behaviour' &&
      (data.content.startsWith('OnPlayerJoined ') || data.content.startsWith('OnPlayerLeft '))
    ) {
      const eventname = data.content.startsWith('OnPlayerJoined ') ? 'playerJoined' : 'playerLeft'
      const m = data.content.match(
        /OnPlayer(Joined|Left) (?<username>[^(]+)(\((?<userId>[^)]+)\))?/
      )
      if (m?.groups?.username) {
        const user = m.groups.userId
          ? { username: m.groups.username.trim(), userId: m.groups.userId }
          : { username: m.groups.username.trim() }
        this.emit(eventname, { ...data, user })
      }
    }
  }
}
