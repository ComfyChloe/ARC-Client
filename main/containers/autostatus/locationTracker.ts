/**
 * Location Tracker
 * Tracks the user's current VRChat location using two sources:
 *   1. Primary: in-house vrchat log watcher (real-time log file events)
 *   2. Fallback: VRCX SQLite database (polling)
 *
 * All dependencies are lazy-loaded
 * so a missing file never crashes the container.
 */
import debug from '../../services/debugger'
export type LocationSource = 'log-watcher' | 'vrcx' | null
export interface LocationState {
  worldId: string | null
  worldName: string | null
  groupName: string | null
  instanceType: string | null
  region: string | null
  source: LocationSource
}
export interface LocationTrackerCallbacks {
  onLocationChange: (location: LocationState) => void
  onLocationLeave: () => void
}
export interface clientStatus {
  state: 'join' | 'leave'
  instanceId: string
  usrId?: string | null
  displayName?: string | null
  clientTs: number
}
const VRCX_POLL_INTERVAL_MS = 3000
const CLIENT_BUFFER_CAP = 100_000
const PENDING_ROSTER_CAP = 1_000
const CLIENT_DRAIN_CHUNK = 10
// Shape of the instance object carried by VrchatLogWatcher 'join' events.
interface WatcherInstance {
  worldId?: string
  type?: string
  groupId?: string
  region?: string
  name?: string
  nonce?: string
}
// Roster-style watcher events mapped to their clientStatus state. New
// roster telemetry plugs in as one entry here — the handler, buffering,
// and overflow capping are shared.
const ROSTER_EVENT_STATES = {
  playerJoined: 'join',
  playerLeft: 'leave',
} as const
class LocationTracker {
  private callbacks: LocationTrackerCallbacks | null = null
  private currentLocation: LocationState | null = null
  private logWatcher: unknown | null = null
  private logWatcherAvailable = false
  private vrcxPollInterval: ReturnType<typeof setInterval> | null = null
  private vrcxDbPathOverride: string | null = null
  private started = false
  private currentInstanceId: string | null = null
  private pendingRoster: {
    type: 'join' | 'leave'
    user: { username?: string | null; userId?: string | null }
    eventTs: number
  }[] = []
  private clientStatusBuffer: clientStatus[] = []
  private lastEventTs: number | null = null
  get current(): LocationState | null {
    return this.currentLocation
  }
  setCallbacks(callbacks: LocationTrackerCallbacks): void {
    this.callbacks = callbacks
  }
  setVrcxDbPath(path: string | null): void {
    this.vrcxDbPathOverride = path
  }
  start(): void {
    if (this.started) return
    this.started = true
    this.startLogWatcher()
    if (!this.logWatcherAvailable) {
      this.startVrcxFallback()
    }
    const source = this.logWatcherAvailable ? 'log-watcher' : (this.checkVrcxAvailable() ? 'vrcx' : 'none')
    debug.info(`[LocationTracker] Started (source: ${source})`)
  }
  stop(): void {
    if (!this.started) return
    this.started = false
    this.stopLogWatcher()
    this.stopVrcxFallback()
    this.currentLocation = null
    this.currentInstanceId = null
    this.pendingRoster = []
    this.clientStatusBuffer = []
    this.lastEventTs = null
    debug.info('[LocationTracker] Stopped')
  }
  isRunning(): boolean {
    return this.started && (this.logWatcherAvailable || this.vrcxPollInterval !== null)
  }
  getSource(): LocationSource {
    return this.currentLocation?.source ?? null
  }
  getCurrentInstanceContext(): { state: 'join'; instanceId: string } | null {
    if (!this.currentInstanceId) return null
    return { state: 'join', instanceId: this.currentInstanceId }
  }
  drainClientStatusBuffer(): void {
    while (this.clientStatusBuffer.length > 0) {
      const chunk = this.clientStatusBuffer.splice(0, CLIENT_DRAIN_CHUNK)
      this.sendClientStatus(chunk)
    }
  }
  flushStatusBuffer(): clientStatus[] {
    if (this.clientStatusBuffer.length === 0) return []
    return this.clientStatusBuffer.splice(0, this.clientStatusBuffer.length)
  }
  getClientStatusBufferLength(): number {
    return this.clientStatusBuffer.length
  }
  private checkVrcxAvailable(): boolean {
    try {
      const vrcx = require('./vrcxDbReader')
      return vrcx.isVrcxAvailable(this.vrcxDbPathOverride)
    } catch { return false }
  }
  private startLogWatcher(): void {
    try {
      const { VrchatLogWatcher } = require('./vrchatLocationService')
      const watcher = new VrchatLogWatcher()
      // Declarative event wiring: watcher event → handler method. New
      // telemetry events plug in as one entry here plus a private
      // handler — no new inline closure blocks in this function.
      const rosterWiring = Object.entries(ROSTER_EVENT_STATES).map(
        ([event, state]) => [event, (data: unknown) => this.handleRosterEvent(state, data)] as const
      )
      const wiring: Array<readonly [string, (data: unknown) => void]> = [
        ['join', (data) => this.handleWatcherJoin(data)],
        ['leave', () => this.handleWatcherLeave()],
        ...rosterWiring,
      ]
      for (const [event, handler] of wiring) {
        watcher.on(event, handler)
      }
      this.logWatcher = watcher
      this.logWatcherAvailable = true
      debug.info('[LocationTracker] Log watcher initialized')
    } catch (error: unknown) {
      this.logWatcherAvailable = false
      debug.info(`[LocationTracker] Log watcher unavailable: ${(error as Error).message}`)
    }
  }
  // ── Log watcher event handlers ───────────────────────────────
  // Location join: record the location, resolve the instance id,
  // flush roster events that arrived before the instance was known,
  // then emit our own join against the resolved instance.
  private handleWatcherJoin(data: unknown): void {
    const inst = (data as { instance?: unknown } | null)?.instance as WatcherInstance | null | undefined
    if (!inst) return
    this.setLocation(this.buildLocationState(inst))
    const instanceId = this.formatInstanceId(inst)
    this.currentInstanceId = instanceId || null
    this.flushPendingRoster(instanceId)
    this.enqueueClientStatus({
      state: 'join',
      usrId: this.readLocalVrchatUserId(),
      instanceId,
      clientTs: Date.now(),
    })
  }
  // Location leave: emit our leave against the last known instance,
  // then drop the instance context and any un-flushed roster events.
  private handleWatcherLeave(): void {
    const instanceId = this.currentInstanceId || ''
    this.clearLocation('log-watcher')
    this.enqueueClientStatus({
      state: 'leave',
      usrId: this.readLocalVrchatUserId(),
      instanceId,
      clientTs: Date.now(),
    })
    this.currentInstanceId = null
    this.pendingRoster = []
  }
  // Roster event (another player joined/left our instance). If the
  // instance is known, emit immediately; otherwise buffer until the
  // next location join resolves the instance id.
  private handleRosterEvent(state: 'join' | 'leave', data: unknown): void {
    const eventTs = this.extractEventTs(data)
    const user = this.extractRosterUser(data)
    if (this.currentInstanceId) {
      this.enqueueClientStatus({
        state,
        usrId: user?.userId ?? null,
        displayName: user?.username ?? null,
        instanceId: this.currentInstanceId,
        clientTs: eventTs,
      })
      return
    }
    this.pendingRoster.push({ type: state, user: user ?? {}, eventTs })
    while (this.pendingRoster.length > PENDING_ROSTER_CAP) {
      this.pendingRoster.shift()
      debug.warn('[LocationTracker] pendingRoster overflow; oldest dropped')
    }
  }
  private buildLocationState(inst: WatcherInstance): LocationState {
    const isGroup = inst.type === 'group' || inst.type === 'groupPublic' || inst.type === 'group+'
    return {
      worldId: inst.worldId || null,
      worldName: this.tryResolveWorldName(inst.worldId || ''),
      groupName: isGroup ? (inst.groupId || null) : null,
      instanceType: inst.type || null,
      region: inst.region || null,
      source: 'log-watcher',
    }
  }
  private formatInstanceId(inst: WatcherInstance): string {
    try {
      const parser = require('./vrchatLocationService')
      return parser.formatInstanceId(inst) || parser.formatLocation(inst) || ''
    } catch (parseErr) {
      debug.warn(`[LocationTracker] formatInstanceId failed: ${(parseErr as Error).message}`)
      return ''
    }
  }
  private flushPendingRoster(instanceId: string): void {
    const queued = this.pendingRoster.splice(0, this.pendingRoster.length)
    for (const q of queued) {
      this.enqueueClientStatus({
        state: q.type,
        usrId: q.user?.userId ?? null,
        displayName: q.user?.username ?? null,
        instanceId,
        clientTs: q.eventTs,
      })
    }
  }
  private extractEventTs(data: unknown): number {
    const date = (data as { date?: Date } | null)?.date
    return typeof date?.getTime === 'function' ? date.getTime() : Date.now()
  }
  private extractRosterUser(data: unknown): { username?: string; userId?: string } | null {
    const user = (data as { user?: unknown } | null)?.user
    if (!user || typeof user !== 'object') return null
    return user as { username?: string; userId?: string }
  }
  private stopLogWatcher(): void {
    if (this.logWatcher) {
      try {
        const w = this.logWatcher as { removeAllListeners: () => void; tail?: { unwatch: () => void } }
        w.tail?.unwatch()
        w.removeAllListeners()
      } catch { /* ignore */ }
      this.logWatcher = null
    }
    this.logWatcherAvailable = false
  }
  private startVrcxFallback(): void {
    if (!this.checkVrcxAvailable()) {
      debug.info('[LocationTracker] VRCX not available, no location tracking source')
      return
    }
    this.vrcxPollInterval = setInterval(() => this.pollVrcx(), VRCX_POLL_INTERVAL_MS)
    setTimeout(() => this.pollVrcx(), 500)
    debug.info('[LocationTracker] VRCX fallback polling started')
  }
  private stopVrcxFallback(): void {
    if (this.vrcxPollInterval) {
      clearInterval(this.vrcxPollInterval)
      this.vrcxPollInterval = null
    }
  }
  private pollVrcx(): void {
    try {
      const vrcx = require('./vrcxDbReader')
      const { parseLocation } = require('./vrchatLocationService')
      const row = vrcx.getVrcxCurrentLocation(this.vrcxDbPathOverride) as { location: string; world_name: string; group_name: string } | null
      if (!row || !row.location) { this.clearLocation('vrcx'); return }
      const parsed = parseLocation(row.location) as { worldId: string; type: string; region?: string } | null
      if (!parsed) { this.clearLocation('vrcx'); return }
      const loc: LocationState = {
        worldId: parsed.worldId,
        worldName: row.world_name || this.tryResolveWorldName(parsed.worldId),
        groupName: row.group_name || null,
        instanceType: parsed.type,
        region: parsed.region || null,
        source: 'vrcx'
      }
      this.setLocation(loc)
    } catch (error: unknown) {
      debug.warn(`[LocationTracker] VRCX poll error: ${(error as Error).message}`)
    }
  }
  private tryResolveWorldName(worldId: string): string | null {
    try {
      const vrcx = require('./vrcxDbReader')
      return vrcx.getVrcxWorldName(worldId, this.vrcxDbPathOverride)
    } catch { return null }
  }
  private setLocation(loc: LocationState): void {
    const prev = this.currentLocation
    const changed = !prev || prev.worldId !== loc.worldId || prev.instanceType !== loc.instanceType || prev.groupName !== loc.groupName
    if (changed) {
      this.currentLocation = loc
      debug.info(`[LocationTracker] Location: ${loc.worldName || loc.worldId} (${loc.instanceType}) [${loc.source}]`)
      this.callbacks?.onLocationChange(loc)
    } else if (prev && loc.source === 'vrcx' && prev.source === 'log-watcher') {
      this.currentLocation = loc
    }
  }
  private clearLocation(source: LocationSource): void {
    if (this.currentLocation) {
      debug.info(`[LocationTracker] Location cleared (source: ${source})`)
      this.currentLocation = null
      this.callbacks?.onLocationLeave()
    }
  }
  private enqueueClientStatus(update: clientStatus): void {
    this.clientStatusBuffer.push(update)
    while (this.clientStatusBuffer.length > CLIENT_BUFFER_CAP) {
      this.clientStatusBuffer.shift()
      debug.warn('[LocationTracker] client status buffer overflow; oldest dropped')
    }
    this.lastEventTs = Date.now()
  }
  private readLocalVrchatUserId(): string | null {
    try {
      const container = (globalThis as any).__arc_auto_status_container
      const status = container?.vrchatApi?.getStatus?.()
      const id = status?.currentUser?.id
      return typeof id === 'string' && id.startsWith('usr_') ? id : null
    } catch { return null }
  }
  private sendClientStatus(updates: clientStatus[]): void {
    if (updates.length === 0) return
    try {
      const websocketManager = require('../../services/websocketManager').default
      websocketManager?.sendClientStatus?.(updates)
    } catch (err) {
      debug.warn(`[LocationTracker] sendClientStatus failed: ${(err as Error).message}`)
    }
  }
  // Read-only accessor for the websocket manager's diag snapshot.
  getLastEventTs(): number | null {
    return this.lastEventTs
  }
}
// Module-level singleton so the websocket manager (and the
// request-clientStatus reply handler) can reach the active tracker
// without coupling to the autostatus container's import path.
let activeTracker: LocationTracker | null = null
export function setActive(tracker: LocationTracker | null): void {
    activeTracker = tracker
}
export function getActive(): LocationTracker | null {
    return activeTracker
}
export default LocationTracker