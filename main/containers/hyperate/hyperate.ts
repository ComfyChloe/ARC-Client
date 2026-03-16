import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import WebSocket from 'ws'
import debug from '../../services/debugger'
import configManager from '../../services/configManager'

interface TrackerData {
  joinedAt: number
  lastHeartRate: number
  lastUpdate?: number
}

interface HyperateSecrets {
  hyperate?: { apiKey: string }
}

interface HyperateConfig {
  enabled: boolean
  primaryTracker: string | null
  trackers: string[]
  trackerNames: Record<string, string>
  trackerStates: Record<string, boolean>
}

interface OscService {
  isListening: boolean
  sendMessage(address: string, value: number, type: string): void
}
class HyperateAddon {
  enabled: boolean
  ws: WebSocket | null
  heartbeatInterval: ReturnType<typeof setInterval> | null
  reconnectTimeout: ReturnType<typeof setTimeout> | null
  trackers: Map<string, TrackerData>
  primaryTracker: string | null
  secrets: HyperateSecrets | null
  config: HyperateConfig
  lastHeartRate: number
  reconnectAttempts: number
  maxReconnectAttempts: number
  reconnectDelay: number
  trackerNames: Record<string, string>
  trackerStates: Record<string, boolean>
  onStatusChange: ((status: ReturnType<HyperateAddon['getStatus']>) => void) | null
  onHeartRateUpdate: ((data: { heartRate: number, deviceId: string }) => void) | null
  lastError: string | null
  reconnecting: boolean
  oscService: OscService | null
  constructor() {
    this.enabled = false
    this.ws = null
    this.heartbeatInterval = null
    this.reconnectTimeout = null
    this.trackers = new Map()
    this.primaryTracker = null
    this.secrets = this.loadSecrets()
    this.config = this.loadConfig()
    this.lastHeartRate = 0
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 10000 // 10 seconds
    this.primaryTracker = this.config.primaryTracker || null
    this.trackerNames = this.config.trackerNames || {}
    this.trackerStates = this.config.trackerStates || {} // Store enabled/disabled state
    this.onStatusChange = null // Callback for status changes
    this.onHeartRateUpdate = null // Callback for heart rate updates
    this.lastError = null // Last error message for UI display
    this.reconnecting = false // Whether currently waiting to reconnect
    this.oscService = null
    debug.info('HypeRate addon initialized')
  }
  setStatusChangeCallback(callback: ((status: ReturnType<HyperateAddon['getStatus']>) => void) | null): void {
    this.onStatusChange = callback
  }
  setHeartRateCallback(callback: ((data: { heartRate: number, deviceId: string }) => void) | null): void {
    this.onHeartRateUpdate = callback
  }
  notifyStatusChange(): void {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(this.getStatus())
    }
  }
  getSecretsCandidatePaths(): string[] {
    const candidatePaths = [
      path.join(process.cwd(), 'secrets.json'),
      path.join(app.getAppPath(), 'secrets.json'),
      path.resolve(__dirname, '..', '..', '..', 'secrets.json')
    ]
    return [...new Set(candidatePaths)]
  }
  loadSecrets(): HyperateSecrets | null {
    try {
      for (const secretsPath of this.getSecretsCandidatePaths()) {
        if (!fs.existsSync(secretsPath)) {
          continue
        }
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'))
        if (secrets.hyperate && secrets.hyperate.apiKey) {
          debug.info(`HypeRate API key loaded from ${secretsPath}`)
          return secrets
        }
      }
      debug.warn('HypeRate API key not found in secrets.json')
      return null
    } catch (error) {
      debug.logError(`Failed to load HypeRate secrets: ${(error as Error).message}`)
      return null
    }
  }
  loadConfig(): HyperateConfig {
    try {
      const hyperateConfig = configManager.getHyperateConfig()
      if (hyperateConfig) {
        debug.info('HypeRate config loaded from config manager')
        return hyperateConfig as unknown as HyperateConfig
      }
    } catch (error) {
      debug.logError(`Failed to load HypeRate config: ${(error as Error).message}`)
    }
    return {
      enabled: false,
      primaryTracker: null,
      trackers: [],
      trackerNames: {},
      trackerStates: {}
    }
  }
  saveConfig(): void {
    try {
      // Get all unique tracker IDs from both active trackers and saved config
      const savedTrackers = this.config.trackers || []
      const activeTrackers = Array.from(this.trackers.keys())
      const allTrackers = [...new Set([...savedTrackers, ...activeTrackers])]
      const config = {
        primaryTracker: this.primaryTracker,
        trackers: allTrackers,
        trackerNames: this.trackerNames,
        trackerStates: this.trackerStates
      }
      
      // Update the hyperate section in the main config
      configManager.updateHyperateConfig(config)
      debug.info('HypeRate config saved via config manager')
    } catch (error) {
      debug.logError(`Failed to save HypeRate config: ${(error as Error).message}`)
    }
  }
  isEnabled(): boolean {
    return this.enabled
  }
  start(oscService: OscService | null = null): boolean {
    this.secrets = this.loadSecrets()
    if (!this.secrets || !this.secrets.hyperate || !this.secrets.hyperate.apiKey) {
      debug.logError('Cannot start HypeRate: No API key found in secrets.json')
      return false
    }
    if (this.enabled) {
      debug.warn('HypeRate addon already running')
      return true
    }
    this.enabled = true
    this.oscService = oscService // OSC service is optional
    this.lastError = null // Clear any previous errors
    this.reconnecting = false
    this.reconnectAttempts = 0
    this.notifyStatusChange() // Notify UI of state change immediately
    this.connect()
    debug.info('HypeRate addon started')
    return true
  }
  stop(): void {
    if (!this.enabled) {
      debug.info('HypeRate addon already stopped')
      return
    }
    debug.info('HypeRate addon stopping...')
    this.enabled = false
    this.reconnecting = false
    this.lastError = null // Clear error on manual stop
    this.disconnect()
    this.notifyStatusChange() // Notify UI of state change immediately
    debug.info('HypeRate addon stopped successfully')
  }
  connect(): void {
    this.secrets = this.loadSecrets()
    if (!this.secrets || !this.secrets.hyperate || !this.secrets.hyperate.apiKey) {
      debug.logError('Cannot connect to HypeRate: No API key')
      return
    }
    const apiKey = this.secrets.hyperate.apiKey
    const apiUrl = `wss://app.hyperate.io/socket/websocket?token=${apiKey}`
    try {
      this.ws = new WebSocket(apiUrl)
      this.ws.on('open', () => {
        this.reconnectAttempts = 0
        this.lastError = null
        this.reconnecting = false
        debug.info('Connected to HypeRate WebSocket')
        this.setupHeartbeat()
        this.loadSavedTrackers()
        this.notifyStatusChange()
      })
      this.ws.on('close', (code: number, reason: Buffer) => {
        debug.info('HypeRate connection closed')
        this.removeAllListeners()
        this.cleanup()
        if (this.enabled && !this.lastError) {
          this.lastError = 'Connection closed unexpectedly'
        }
        this.notifyStatusChange()
        // Only reconnect if still enabled and not manually stopped
        if (this.enabled && !this.reconnecting) {
          this.scheduleReconnect()
        }
      })
      this.ws.on('error', (error: Error) => {
        debug.logError(`HypeRate connection error: ${error.message}`)
        this.lastError = error.message || 'Connection error'
        this.removeAllListeners()
        this.cleanup()
        this.notifyStatusChange()
        // Only reconnect if still enabled and not manually stopped
        if (this.enabled && !this.reconnecting) {
          this.scheduleReconnect()
        }
      })
      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(data.toString())
          this.handleMessage(message)
        } catch (error) {
          debug.logError(`HypeRate message parse error: ${(error as Error).message}`)
        }
      })
      debug.info('Connecting to HypeRate API...')
    } catch (error) {
      debug.logError(`Failed to create HypeRate WebSocket: ${(error as Error).message}`)
      this.scheduleReconnect()
    }
  }
  disconnect(): void {
    debug.info('HypeRate disconnecting...')
    // Leave all active channels before disconnecting
    if (this.ws && (this.ws.readyState === WebSocket.OPEN)) {
      const trackerIds = Array.from(this.trackers.keys())
      if (trackerIds.length > 0) {
        debug.info(`Leaving ${trackerIds.length} active channel(s)...`)
        trackerIds.forEach(deviceId => {
          try {
            const message = {
              topic: `hr:${deviceId}`,
              event: "phx_leave",
              payload: {},
              ref: 0
            }
            this.ws!.send(JSON.stringify(message))
            debug.info(`Left channel: ${deviceId}`)
          } catch (error) {
            debug.warn(`Failed to leave channel ${deviceId}: ${(error as Error).message}`)
          }
        })
      }
    }
    
    // Clear trackers map
    const trackerCount = this.trackers.size
    this.trackers.clear()
    if (trackerCount > 0) {
      debug.info(`Cleared ${trackerCount} tracker(s) from memory`)
    }
    
    // Clean up intervals and timeouts
    this.cleanup()
    
    // Remove all event listeners and close WebSocket
    if (this.ws) {
      this.removeAllListeners()
      const wsState = this.ws.readyState
      if (wsState === WebSocket.OPEN || wsState === WebSocket.CONNECTING) {
        this.ws.close()
        debug.info('WebSocket connection closed')
      } else {
        debug.info(`WebSocket already closed (state: ${wsState})`)
      }
      this.ws = null
    }
    debug.info('HypeRate disconnect completed')
  }
  removeAllListeners(): void {
    if (this.ws) {
      this.ws.removeAllListeners('open')
      this.ws.removeAllListeners('close')
      this.ws.removeAllListeners('error')
      this.ws.removeAllListeners('message')
    }
  }
  cleanup(): void {
    let cleaned = false
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
      cleaned = true
      debug.info('Cleared heartbeat interval')
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
      cleaned = true
      debug.info('Cleared reconnect timeout')
    }
    if (cleaned) {
      debug.info('HypeRate cleanup completed')
    }
  }
  scheduleReconnect(): void {
    if (!this.enabled || this.reconnectTimeout) {
      return
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      debug.logError(`HypeRate: Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping addon.`)
      this.lastError = `Max reconnection attempts (${this.maxReconnectAttempts}) reached`
      this.reconnecting = false
      this.stop()
      return
    }
    this.reconnectAttempts++
    this.reconnecting = true
    this.notifyStatusChange()
    debug.info(`HypeRate: Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay / 1000} seconds`)
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.reconnecting = false
      if (this.enabled) {
        this.connect()
      }
    }, this.reconnectDelay)
  }
  setupHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          topic: "phoenix",
          event: "heartbeat",
          payload: {},
          ref: 0
        }))
      }
    }, 30000) // 30 seconds as recommended
  }
  loadSavedTrackers(): void {
    // Load trackers from saved config
    if (this.config.trackers && Array.isArray(this.config.trackers)) {
      debug.info(`Loading ${this.config.trackers.length} saved tracker(s): ${this.config.trackers.join(', ')}`)
      this.config.trackers.forEach(deviceId => {
        this.joinChannel(deviceId)
      })
    } else {
      debug.info('No saved trackers found in config')
    }
  }
  joinChannel(deviceId: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      debug.warn(`Cannot join HypeRate channel ${deviceId}: Not connected`)
      return false
    }
    const message = {
      topic: `hr:${deviceId}`,
      event: "phx_join",
      payload: {},
      ref: 0
    }
    this.ws.send(JSON.stringify(message))
    this.trackers.set(deviceId, { joinedAt: Date.now(), lastHeartRate: 0 })
    // Set as primary if no primary exists
    if (!this.primaryTracker) {
      this.primaryTracker = deviceId
      this.saveConfig()
    }
    debug.info(`Joined HypeRate channel: ${deviceId}`)
    return true
  }
  leaveChannel(deviceId: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Still remove from trackers even if not connected
      this.trackers.delete(deviceId)
      return false
    }
    const message = {
      topic: `hr:${deviceId}`,
      event: "phx_leave",
      payload: {},
      ref: 0
    }
    this.ws.send(JSON.stringify(message))
    this.trackers.delete(deviceId)
    // If removing primary tracker, set new primary
    if (this.primaryTracker === deviceId) {
      const remainingTrackers = Array.from(this.trackers.keys())
      this.primaryTracker = remainingTrackers.length > 0 ? remainingTrackers[0] : null
      this.saveConfig()
    }
    debug.info(`Left HypeRate channel: ${deviceId}`)
    return true
  }
  handleMessage(data: { event: string, topic: string, payload: unknown }): void {
    if (data.event === "hr_update") {
      this.handleHeartRateUpdate(data as { event: string, topic: string, payload: { hr: number } })
    }
  }
  handleHeartRateUpdate(data: { event: string, topic: string, payload: { hr: number } }): void {
    try {
      const deviceId = data.topic.split(":")[1]
      const heartRate = data.payload.hr
      if (!deviceId || typeof heartRate !== 'number') {
        debug.warn('Invalid heart rate data received')
        return
      }
      // Update tracker data
      if (this.trackers.has(deviceId)) {
        const tracker = this.trackers.get(deviceId)!
        tracker.lastHeartRate = heartRate
        tracker.lastUpdate = Date.now()
        this.trackers.set(deviceId, tracker)
      }
      // Only update lastHeartRate and send to VRChat if this is the primary tracker
      if (deviceId === this.primaryTracker) {
        this.lastHeartRate = heartRate
        this.sendHeartRateToVRChat(heartRate)
        // Notify renderer of heart rate update
        if (typeof this.onHeartRateUpdate === 'function') {
          this.onHeartRateUpdate({ heartRate, deviceId })
        }
      }
    } catch (error) {
      debug.logError(`Error handling heart rate update: ${(error as Error).message}`)
    }
  }
  sendHeartRateToVRChat(heartRate: number): void {
    // Check if OSC service is available and listening before attempting to send
    if (!this.oscService || !this.oscService.isListening) {
      return
    }
    const address = '/avatar/parameters/ARCOSC/Heartrate/Value'
    this.oscService.sendMessage(address, heartRate, 'f')
  }
  addTracker(deviceId: string, deviceName: string | null = null): boolean {
    if (!deviceId || typeof deviceId !== 'string') {
      debug.warn('Invalid device ID provided to addTracker')
      return false
    }
    // Check if tracker already exists in saved trackers or active trackers
    const savedTrackers = this.config.trackers || []
    if (this.trackers.has(deviceId) || savedTrackers.includes(deviceId)) {
      debug.info(`Tracker ${deviceId} already exists`)
      return true
    }
    // Save device name if provided
    if (deviceName && deviceName.trim()) {
      this.trackerNames[deviceId] = deviceName.trim()
    }
    // Add to saved trackers list
    if (!savedTrackers.includes(deviceId)) {
      this.config.trackers = [...savedTrackers, deviceId]
    }
    // Set as primary if no primary exists
    if (!this.primaryTracker) {
      this.primaryTracker = deviceId
    }
    // Save configuration regardless of connection state
    this.saveConfig()
    // Try to join channel if connected, but don't fail if not connected
    if (this.enabled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.joinChannel(deviceId)
      debug.info(`Added and joined HypeRate tracker: ${deviceId}`)
    } else {
      debug.info(`Added HypeRate tracker: ${deviceId} (will connect when HypeRate starts)`)
    }
    return true
  }
  removeTracker(deviceId: string): boolean {
    // Check if tracker exists in either active trackers or saved trackers
    const savedTrackers = this.config.trackers || []
    const existsInActive = this.trackers.has(deviceId)
    const existsInSaved = savedTrackers.includes(deviceId)
    if (!existsInActive && !existsInSaved) {
      debug.warn(`Tracker ${deviceId} not found`)
      return false
    }
    // Remove from active trackers if connected
    if (existsInActive && this.enabled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.leaveChannel(deviceId)
    } else if (existsInActive) {
      // Remove from active trackers map even if not connected
      this.trackers.delete(deviceId)
    }
    // Remove from saved trackers list
    if (existsInSaved) {
      this.config.trackers = savedTrackers.filter(id => id !== deviceId)
    }
    // Remove device name
    delete this.trackerNames[deviceId]
    // If removing primary tracker, set new primary
    if (this.primaryTracker === deviceId) {
      const remainingTrackers = this.config.trackers || []
      this.primaryTracker = remainingTrackers.length > 0 ? remainingTrackers[0] : null
    }
    this.saveConfig()
    debug.info(`Removed HypeRate tracker: ${deviceId}`)
    return true
  }
  updateTrackerName(deviceId: string, newName: string | null): boolean {
    if (!this.trackers.has(deviceId) && !this.config.trackers.includes(deviceId)) {
      debug.warn(`Cannot update name: ${deviceId} not found`)
      return false
    }
    if (newName && newName.trim()) {
      this.trackerNames[deviceId] = newName.trim()
    } else {
      delete this.trackerNames[deviceId]
    }
    this.saveConfig()
    debug.info(`Updated tracker name for ${deviceId}: ${newName}`)
    return true
  }
  updateTrackerState(deviceId: string, enabled: boolean): boolean {
    // Always return true since we no longer support enabling/disabling individual trackers
    return true
  }
  setPrimaryTracker(deviceId: string): boolean {
    const savedTrackers = this.config.trackers || []
    if (!this.trackers.has(deviceId) && !savedTrackers.includes(deviceId)) {
      debug.warn(`Cannot set primary tracker: ${deviceId} not found`)
      return false
    }
    this.primaryTracker = deviceId
    this.saveConfig()
    debug.info(`Set primary tracker to: ${deviceId}`)
    return true
  }
  getStatus() {
    this.secrets = this.loadSecrets()
    return {
      enabled: this.enabled,
      connected: !!(this.ws && this.ws.readyState === WebSocket.OPEN),
      trackers: Array.from(this.trackers.keys()),
      primaryTracker: this.primaryTracker,
      lastHeartRate: this.lastHeartRate,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      hasApiKey: !!(this.secrets && this.secrets.hyperate && this.secrets.hyperate.apiKey),
      lastError: this.lastError,
      reconnecting: this.reconnecting
    }
  }
  getTrackers() {
    const trackerList: {
      deviceId: string
      name: string | null
      isPrimary: boolean
      isActive: boolean
      lastHeartRate: number
      lastUpdate: number | null
      joinedAt: number | null
    }[] = []
    // Get all saved trackers (both active and inactive)
    const allTrackers = new Set([
      ...Array.from(this.trackers.keys()),
      ...(this.config.trackers || [])
    ])
    for (const deviceId of allTrackers) {
      const trackerData = this.trackers.get(deviceId)
      // Tracker is only active if HypeRate is enabled AND tracker exists in the active trackers map
      const isActive = this.enabled && !!trackerData
      trackerList.push({
        deviceId,
        name: this.trackerNames[deviceId] || null,
        isPrimary: deviceId === this.primaryTracker,
        isActive: isActive,
        lastHeartRate: isActive ? (trackerData!.lastHeartRate || 0) : 0,
        lastUpdate: isActive ? (trackerData!.lastUpdate || trackerData!.joinedAt) : null,
        joinedAt: isActive ? trackerData!.joinedAt : null
      })
    }
    return trackerList
  }
}
export default HyperateAddon