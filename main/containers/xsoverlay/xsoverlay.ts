import WebSocket from 'ws'
import debug from '../../services/debugger'
import configManager from '../../services/configManager'
import { getDb } from '../../services/sqlDbService'
interface XSOverlayConfig {
  enabled: boolean
  autoStart: boolean
  port: number
  notifications: {
    panelConnections: boolean
    avatarChanges: boolean
  }
  notificationTimeout: number
  notificationHeight: number
  notificationOpacity: number
  notificationVolume: number
  notificationAudioPath: string
  [key: string]: unknown
}
interface NotificationLogEntry {
  id: number
  title: string
  content: string
  timestamp: number
  type: 'panel-connection' | 'panel-disconnection' | 'avatar-change' | 'info' | 'error'
}
interface XSOverlayAddonStatus {
  enabled: boolean
  connected: boolean
  xsOverlayRunning: boolean
  config: XSOverlayConfig
  notificationLog: NotificationLogEntry[]
}
interface PanelInfo {
  panelName: string
  connectionCount: number
  isActive: boolean
  panelEnabled: boolean
  isPublic: boolean
  hasPassword: boolean
  allowFriends: boolean
  activeLinkCount: number
  friendLinkCount: number
  publicLinkCount: number
  safetyEnabled: boolean
  safety2Enabled: boolean
  safety3Enabled: boolean
  safety4Enabled: boolean
  safety5Enabled: boolean
}
const DEFAULT_CONFIG: XSOverlayConfig = {
  enabled: false,
  autoStart: false,
  port: 42070,
  notifications: {
    panelConnections: true,
    avatarChanges: true
  },
  // Height and audioPath are hardcoded in sendNotification — see there for overrides
  notificationTimeout: 5,
  notificationHeight: 80,
  notificationOpacity: 1,
  notificationVolume: 0.7,
  notificationAudioPath: 'warning'
}
const MAX_LOG_ENTRIES = 50
const RECONNECT_BASE_DELAY = 3000
const RECONNECT_MAX_DELAY = 30000
const RECONNECT_MAX_ATTEMPTS = 10
const AVATAR_DEBOUNCE_MS = 2000
const PING_INTERVAL_MS = 15000
const PONG_TIMEOUT_MS = 5000
class XSOverlayAddon {
  enabled: boolean
  ws: WebSocket | null
  config: XSOverlayConfig
  connected: boolean
  xsOverlayRunning: boolean
  reconnectTimeout: ReturnType<typeof setTimeout> | null
  healthCheckInterval: ReturnType<typeof setInterval> | null
  reconnectAttempts: number
  onStatusChange: ((status: XSOverlayAddonStatus) => void) | null
  onNotificationLog: ((entry: NotificationLogEntry) => void) | null
  previousPanelCounts: Map<string, number>
  previousPanelNames: Map<string, string>
  notificationLog: NotificationLogEntry[]
  notificationIdCounter: number
  lastAvatarNotificationTime: number
  pingInterval: ReturnType<typeof setInterval> | null
  pongReceived: boolean
  logDirty: boolean
  cachedLog: NotificationLogEntry[]
  constructor() {
    this.enabled = false
    this.ws = null
    this.config = this.loadConfig()
    this.connected = false
    this.xsOverlayRunning = false
    this.reconnectTimeout = null
    this.healthCheckInterval = null
    this.reconnectAttempts = 0
    this.onStatusChange = null
    this.onNotificationLog = null
    this.previousPanelCounts = new Map()
    this.previousPanelNames = new Map()
    this.notificationLog = []
    this.notificationIdCounter = 0
    this.lastAvatarNotificationTime = 0
    this.pingInterval = null
    this.pongReceived = true
    this.logDirty = true
    this.cachedLog = []
    debug.info('XS Overlay addon initialized')
  }
  setStatusChangeCallback(callback: ((status: XSOverlayAddonStatus) => void) | null): void {
    this.onStatusChange = callback
  }
  setNotificationLogCallback(callback: ((entry: NotificationLogEntry) => void) | null): void {
    this.onNotificationLog = callback
  }
  notifyStatusChange(): void {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(this.getStatus())
    }
  }
  loadConfig(): XSOverlayConfig {
    try {
      const raw = (configManager as any).config?.xsOverlay
      if (raw) {
        return {
          ...DEFAULT_CONFIG,
          ...raw,
          notifications: { ...DEFAULT_CONFIG.notifications, ...(raw.notifications || {}) }
        }
      }
    } catch (error) {
      // debug.error(`Failed to load XS Overlay config: ${(error as Error).message}`)
    }
    return { ...DEFAULT_CONFIG, notifications: { ...DEFAULT_CONFIG.notifications } }
  }
  saveConfig(): void {
    try {
      configManager.updateConfig({ xsOverlay: this.config } as any)
    } catch (error) {
      // debug.error(`Failed to save XS Overlay config: ${(error as Error).message}`)
    }
  }
  getConfig(): XSOverlayConfig {
    return { ...this.config }
  }
  updateConfig(newConfig: Partial<XSOverlayConfig>): boolean {
    this.config = {
      ...this.config,
      ...newConfig,
      notifications: {
        ...this.config.notifications,
        ...(newConfig.notifications || {})
      }
    }
    this.saveConfig()
    this.notifyStatusChange()
    return true
  }
  getStatus(): XSOverlayAddonStatus {
    if (this.logDirty) {
      this.cachedLog = [...this.notificationLog]
      this.logDirty = false
    }
    return {
      enabled: this.enabled,
      connected: this.connected,
      xsOverlayRunning: this.xsOverlayRunning,
      config: this.getConfig(),
      notificationLog: this.cachedLog
    }
  }
  isEnabled(): boolean {
    return this.enabled
  }
  start(): boolean {
    if (this.enabled) {
      // debug.info('XS Overlay addon already running')
      return true
    }
    this.enabled = true
    this.config.enabled = true
    this.saveConfig()
    this.connect()
    this.startHealthCheck()
    this.notifyStatusChange()
    debug.info('XS Overlay addon started')
    return true
  }
  stop(): void {
    if (!this.enabled) {
      return
    }
    this.enabled = false
    this.config.enabled = false
    this.saveConfig()
    this.disconnect()
    this.stopHealthCheck()
    this.notifyStatusChange()
    debug.info('XS Overlay addon stopped')
  }
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    // Clean up any stale WebSocket in CLOSING/CLOSED state before creating a new one
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.close()
      } catch (_e) { /* ignore */ }
      this.ws = null
    }
    const port = this.config.port || 42070
    const url = `ws://localhost:${port}/?client=ARC-Client`
    // debug.info(`Connecting to XS Overlay WebSocket: ${url}`)
    try {
      this.ws = new WebSocket(url)
      this.ws.on('open', () => {
        this.connected = true
        this.xsOverlayRunning = true
        this.reconnectAttempts = 0
        this.pongReceived = true
        this.startPing()
        // debug.info('Connected to XS Overlay WebSocket')
        this.notifyStatusChange()
      })
      this.ws.on('message', (data: WebSocket.RawData) => {
        debug.info(`XS Overlay message: ${data.toString().substring(0, 200)}`)
      })
      this.ws.on('pong', () => {
        this.pongReceived = true
      })
      this.ws.on('close', () => {
        this.stopPing()
        const wasConnected = this.connected
        this.connected = false
        if (wasConnected) {
          // debug.info('XS Overlay WebSocket disconnected')
        }
        this.notifyStatusChange()
        if (this.enabled) {
          this.scheduleReconnect()
        }
      })
      this.ws.on('error', (error: Error) => {
        this.xsOverlayRunning = false
        if (this.connected) {
          // debug.error(`XS Overlay WebSocket error: ${error.message}`)
        }
        this.connected = false
        this.notifyStatusChange()
      })
    } catch (error) {
      // debug.error(`Failed to create XS Overlay WebSocket: ${(error as Error).message}`)
      this.xsOverlayRunning = false
      this.connected = false
      this.notifyStatusChange()
      if (this.enabled) {
        this.scheduleReconnect()
      }
    }
  }
  disconnect(): void {
    this.stopPing()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close()
        }
      } catch (_e) {
        // Ignore close errors
      }
      this.ws = null
    }
    this.connected = false
    this.reconnectAttempts = 0
  }
  scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      // debug.warn('XS Overlay max reconnect attempts reached, will retry via health check')
      return
    }
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_DELAY)
    this.reconnectAttempts++
    // debug.info(`XS Overlay reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`)
    this.reconnectTimeout = setTimeout(() => {
      if (this.enabled && !this.connected) {
        this.connect()
      }
    }, delay)
  }
  startHealthCheck(): void {
    this.stopHealthCheck()
    this.healthCheckInterval = setInterval(() => {
      if (this.enabled && !this.connected && this.xsOverlayRunning === false) {
        // debug.info('XS Overlay health check: attempting reconnection')
        this.connect()
      }
    }, 15000)
  }
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }
  startPing(): void {
    this.stopPing()
    this.pongReceived = true
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return
      }
      if (!this.pongReceived) {
        // debug.warn('No pong since last ping — connection is dead')
        debug.warn('XS Overlay pong timeout — closing dead connection')
        try { this.ws.terminate() } catch (_e) { /* ignore */ }
        return
      }
      this.pongReceived = false
      try { this.ws.ping() } catch (_e) { /* ignore */ }
    }, PING_INTERVAL_MS)
  }
  stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }
  sendNotification(title: string, content: string, options?: { audioPath?: string; timeout?: number; type?: number }): boolean {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // debug.warn(`Cannot send XS Overlay notification (not connected): ${title}`)
      return false
    }
    const notification = {
      type: options?.type ?? 1,
      title,
      content,
      timeout: options?.timeout ?? this.config.notificationTimeout ?? 5,
      // Hardcoded: height 120px, audioPath "warning" — override if needed
      height: 120,
      opacity: this.config.notificationOpacity ?? 1,
      volume: this.config.notificationVolume ?? 0.7,
      audioPath: 'warning',
      icon: 'default',
      sourceApp: 'ARC-Client'
    }
    const apiMessage = {
      sender: 'ARC-Client',
      target: 'xsoverlay',
      command: 'SendNotification',
      jsonData: JSON.stringify(notification),
      rawData: null
    }
    try {
      this.ws.send(JSON.stringify(apiMessage))
      debug.info(`XS Overlay notification sent: ${title}`)
      return true
    } catch (error) {
      // debug.error(`Failed to send XS Overlay notification: ${(error as Error).message}`)
      return false
    }
  }
  addNotificationLog(title: string, content: string, type: NotificationLogEntry['type']): void {
    const entry: NotificationLogEntry = {
      id: ++this.notificationIdCounter,
      title,
      content,
      timestamp: Date.now(),
      type
    }
    this.notificationLog.unshift(entry)
    if (this.notificationLog.length > MAX_LOG_ENTRIES) {
      this.notificationLog.length = MAX_LOG_ENTRIES
    }
    this.logDirty = true
    // Persist to database so the UI notification log works for all users
    try {
      const db = getDb()
      const now = new Date()
      const pad = (n: number) => n.toString().padStart(2, '0')
      const recordedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      db.prepare('INSERT INTO xs_overlay_notification_log (title, content, type, recorded_at) VALUES (?, ?, ?, ?)').run(entry.title, entry.content, entry.type, recordedAt)
    } catch (_e) {
      // DB may not be initialized yet — in-memory log still works
    }
    if (typeof this.onNotificationLog === 'function') {
      this.onNotificationLog(entry)
    }
  }
  handlePanelConnectionsUpdate(data: Record<string, PanelInfo>): void {
    if (!this.config.notifications.panelConnections) {
      // Still track counts even if notifications disabled, so we don't backfill on re-enable
      this.previousPanelCounts = new Map(
        Object.entries(data).map(([id, info]) => [id, info.connectionCount])
      )
      for (const [id, info] of Object.entries(data)) {
        this.previousPanelNames.set(id, info.panelName)
      }
      return
    }
    for (const [panelId, panelInfo] of Object.entries(data)) {
      const previousCount = this.previousPanelCounts.get(panelId) ?? 0
      const currentCount = panelInfo.connectionCount
      const panelName = panelInfo.panelName || panelId
      if (currentCount > previousCount) {
        const diff = currentCount - previousCount
        const suffix = diff > 1 ? ` (+${diff})` : ''
        const title = 'ARC Client'
        const content = `Panel: ${panelName}\nNew connection${suffix} (${currentCount} active)`
        this.sendNotification(title, content)
        this.addNotificationLog(title, content, 'panel-connection')
      } else if (currentCount < previousCount && previousCount > 0) {
        const diff = previousCount - currentCount
        const suffix = diff > 1 ? ` (-${diff})` : ''
        const title = 'ARC Client'
        const content = `Panel: ${panelName}\nDisconnected${suffix} (${currentCount} active)`
        this.sendNotification(title, content)
        this.addNotificationLog(title, content, 'panel-disconnection')
      }
      this.previousPanelCounts.set(panelId, currentCount)
      this.previousPanelNames.set(panelId, panelName)
    }
    // Check for removed panels (panel deleted while connections existed)
    for (const [panelId] of this.previousPanelCounts) {
      if (!(panelId in data)) {
        const panelName = this.previousPanelNames.get(panelId) || panelId
        const count = this.previousPanelCounts.get(panelId) ?? 0
        if (count > 0) {
          const title = 'ARC Client'
          const content = `Panel: ${panelName}\nPanel removed (${count} connections lost)`
          this.sendNotification(title, content, { audioPath: 'warning' })
          this.addNotificationLog(title, content, 'panel-disconnection')
        }
        this.previousPanelCounts.delete(panelId)
        this.previousPanelNames.delete(panelId)
      }
    }
  }
  handleAvatarChange(data: { id?: string; name?: string; username?: string }): void {
    if (!this.config.notifications.avatarChanges) {
      return
    }
    // Debounce rapid avatar changes
    const now = Date.now()
    if (now - this.lastAvatarNotificationTime < AVATAR_DEBOUNCE_MS) {
      return
    }
    this.lastAvatarNotificationTime = now
    const title = 'ARC Client'
    const content = data.name
      ? `Avatar Changed\n${data.name}${data.username ? ` (${data.username})` : ''}`
      : `Avatar Changed\n${data.id || 'Unknown ID'}${data.username ? ` (${data.username})` : ''}`
    this.sendNotification(title, content)
    this.addNotificationLog(title, content, 'avatar-change')
  }
  destroy(): void {
    this.stop()
    this.disconnect()
    this.stopHealthCheck()
    this.stopPing()
    this.notificationLog = []
    this.cachedLog = []
    this.previousPanelCounts.clear()
    this.previousPanelNames.clear()
    this.onStatusChange = null
    this.onNotificationLog = null
    // debug.info('XS Overlay addon destroyed')
  }
}
export default XSOverlayAddon
export type { XSOverlayAddonStatus, XSOverlayConfig, NotificationLogEntry }
