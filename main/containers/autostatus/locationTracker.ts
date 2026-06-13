/**
 * Location Tracker
 * Tracks the user's current VRChat location using two sources:
 *   1. Primary: vrchat-log-watcher (real-time log file events)
 *   2. Fallback: VRCX SQLite database (polling)
 *
 * All dependencies are lazy-loaded so a missing package never crashes the container.
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
const VRCX_POLL_INTERVAL_MS = 3000
class LocationTracker {
  private callbacks: LocationTrackerCallbacks | null = null
  private currentLocation: LocationState | null = null
  private logWatcher: unknown | null = null
  private logWatcherAvailable = false
  private vrcxPollInterval: ReturnType<typeof setInterval> | null = null
  private vrcxDbPathOverride: string | null = null
  private started = false
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
    debug.info('[LocationTracker] Stopped')
  }
  isRunning(): boolean {
    return this.started && (this.logWatcherAvailable || this.vrcxPollInterval !== null)
  }
  getSource(): LocationSource {
    return this.currentLocation?.source ?? null
  }
  private checkVrcxAvailable(): boolean {
    try {
      const vrcx = require('./vrcxDbReader')
      return vrcx.isVrcxAvailable(this.vrcxDbPathOverride)
    } catch { return false }
  }
  private startLogWatcher(): void {
    try {
      const { VrchatLogWatcher } = require('vrchat-log-watcher')
      const watcher = new VrchatLogWatcher()
      watcher.on('join', (data: { instance: unknown }) => {
        const inst = data.instance as { worldId?: string; type?: string; groupId?: string; region?: string } | null
        if (!inst) return
        const loc: LocationState = {
          worldId: inst.worldId || null,
          worldName: this.tryResolveWorldName(inst.worldId || ''),
          groupName: (inst.type === 'group' || inst.type === 'groupPublic' || inst.type === 'group+') ? (inst.groupId || null) : null,
          instanceType: inst.type || null,
          region: inst.region || null,
          source: 'log-watcher'
        }
        this.setLocation(loc)
      })
      watcher.on('leave', () => this.clearLocation('log-watcher'))
      this.logWatcher = watcher
      this.logWatcherAvailable = true
      debug.info('[LocationTracker] Log watcher initialized')
    } catch (error: unknown) {
      this.logWatcherAvailable = false
      debug.info(`[LocationTracker] Log watcher unavailable: ${(error as Error).message}`)
    }
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
      const { parseLocation } = require('vrchat-location-parser')
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
}
export default LocationTracker
