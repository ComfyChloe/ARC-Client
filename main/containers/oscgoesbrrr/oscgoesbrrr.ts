/**
 * OscGoesBrrr Addon Container
 * 
 * Integrates Buttplug.io haptic devices with VRChat avatar contacts.
 * Receives OSC data from OSC-Query service and forwards to haptic devices via Intiface.
 * 
 * Based on OSCGoesBrrr by OscToys (CC BY-NC-SA 4.0)
 */

import { EventEmitter } from 'node:events'
import debug from '../../services/debugger'
import configManager from '../../services/configManager'
import { ButtplugClient, DeviceFeature } from './ButtplugClient'
import { GameDeviceManager, BridgeSource } from './GameDevice'

interface DeviceBinding {
  id: string
  type: string
  sources: string[]
  multiplier: number
  idle: number
  linear: boolean
}

interface OGBConfig {
  enabled: boolean
  intifaceAddress: string
  intifacePort: number
  intifaceWss: boolean
  devices: DeviceBinding[]
  audioEnabled: boolean
  audioMultiplier: number
  maxLevelParam: string | null
}

interface MotionEntry {
  time: number
  motion: number
}

/**
 * Default sources to enable for new devices
 */
const DEFAULT_ENABLED_SOURCES: string[] = [
  'touchOthers',
  'penOthers',
  'frotOthers'
]

/**
 * Bridge between game sources and haptic devices
 */
class ToyBridge {
  feature: DeviceFeature
  config: DeviceBinding
  lastLevel: number
  lastPushTime: number
  lastRawLevel: number
  motionLevel: number
  motionHistory: MotionEntry[]
  motionWindowMs: number

  constructor(feature: DeviceFeature, config: DeviceBinding) {
    this.feature = feature
    this.config = config
    this.lastLevel = 0
    this.lastPushTime = 0
    this.lastRawLevel = 0 // For motion calculation
    this.motionLevel = 0
    this.motionHistory = [] // Track motion over time for averaging
    this.motionWindowMs = 500 // Motion averaging window (500ms)
  }

  /**
   * Calculate and push level to the haptic device
   */
  push(sources: BridgeSource[]): void {
    const binding = this.config
    const bindType = binding.type || 'all'
    const enabledSources = binding.sources || DEFAULT_ENABLED_SOURCES
    const multiplier = binding.multiplier ?? 1.0
    const idle = binding.idle ?? 0 // Idle vibration level
    const linear = binding.linear ?? true // True = depth-based, false = motion-based

    // Filter sources based on binding config
    const relevantSources = sources.filter(source => {
      // Filter by device type
      if (bindType !== 'all') {
        if (source.deviceType === 'pen' && bindType !== 'pen') return false
        if (source.deviceType === 'orf' && bindType !== 'orf') return false
      }

      // Filter by enabled source features
      if (!enabledSources.includes(source.featureName)) return false

      return true
    })

    // Calculate max level from all relevant sources
    let rawLevel = 0
    let maxSource: BridgeSource | null = null
    for (const source of relevantSources) {
      if (source.value > rawLevel) {
        rawLevel = source.value
        maxSource = source
      }
    }

    let level = rawLevel

    // Apply motion-based calculation if linear is disabled
    if (!linear) {
      const now = Date.now()
      const motion = Math.abs(rawLevel - this.lastRawLevel)
      
      // Add current motion to history with timestamp
      this.motionHistory.push({ time: now, motion })
      
      // Remove old entries outside the window
      const cutoff = now - this.motionWindowMs
      this.motionHistory = this.motionHistory.filter(entry => entry.time > cutoff)
      
      // Sum all motion in the window and normalize by time
      // This gives us "total movement distance" over the window period
      const totalMotion = this.motionHistory.reduce((sum, entry) => sum + entry.motion, 0)
      
      // Scale: if you move from 0 to 1 and back (2.0 total distance) in the window, that's max
      // Typical thrusting might do 0.5 distance per window, so scale by 2 to make it reach 100%
      level = Math.min(1, totalMotion * 2)
    }

    this.lastRawLevel = rawLevel

    // Apply multiplier
    level = level * multiplier

    // Add idle baseline if contact is active
    if (rawLevel > 0) {
      level = Math.max(level, idle)
    }

    // Clamp to valid range
    level = Math.min(1, Math.max(0, level))

    // Push to device
    this.feature.setLevel(level)
    this.lastLevel = level
    this.lastPushTime = Date.now()
  }
}

/**
 * OscGoesBrrr Addon - Main container class
 */
class OscGoesBrrrAddon extends EventEmitter {
  enabled: boolean
  buttplugClient: ButtplugClient
  gameDeviceManager: GameDeviceManager
  toyBridges: Map<string, ToyBridge>
  config: OGBConfig
  oscQueryService: EventEmitter | null
  oscMessageHandler: ((data: unknown) => void) | null
  pushInterval: ReturnType<typeof setInterval> | null
  audioLevel: number
  lastAudioTime: number
  onStatusChange: ((status: unknown) => void) | null
  lastError: string | null
  maxLevel: number

  constructor() {
    super()
    this.enabled = false
    this.buttplugClient = new ButtplugClient()
    this.gameDeviceManager = new GameDeviceManager()
    this.toyBridges = new Map() // Map<featureId, ToyBridge>
    this.config = this.loadConfig()
    this.oscQueryService = null
    this.oscMessageHandler = null
    this.pushInterval = null
    this.audioLevel = 0
    this.lastAudioTime = 0
    this.onStatusChange = null
    this.lastError = null
    this.maxLevel = 0 // Track max level across all devices

    // Setup Buttplug client event handlers
    this.buttplugClient.on('connected', () => {
      debug.info('[OGB] Connected to Intiface')
      this.notifyStatusChange()
    })

    this.buttplugClient.on('connecting', () => {
      debug.info('[OGB] Connecting to Intiface...')
      this.notifyStatusChange()
    })

    this.buttplugClient.on('disconnected', () => {
      debug.info('[OGB] Disconnected from Intiface')
      this.notifyStatusChange()
    })

    this.buttplugClient.on('addFeature', (feature: DeviceFeature) => {
      debug.info(`[OGB] Feature added: ${feature.id}`)
      this.createToyBridge(feature)
      this.notifyStatusChange()
    })

    this.buttplugClient.on('removeFeature', (feature: DeviceFeature) => {
      debug.info(`[OGB] Feature removed: ${feature.id}`)
      this.toyBridges.delete(feature.id)
      this.notifyStatusChange()
    })

    this.buttplugClient.on('devicesChanged', () => {
      this.notifyStatusChange()
    })

    // Setup game device manager events
    this.gameDeviceManager.on('update', () => {
      // Don't do anything here - we push on interval
    })

    this.gameDeviceManager.on('cleared', () => {
      debug.info('[OGB] Game devices cleared (avatar change)')
    })

    debug.info('[OGB] OscGoesBrrr addon initialized')
  }

  /**
   * Create a bridge for a haptic device feature
   */
  createToyBridge(feature: DeviceFeature): void {
    // Get or create binding config for this device
    let binding = this.config.devices?.find(d => d.id === feature.deviceId)
    if (!binding) {
      binding = {
        id: feature.deviceId,
        type: 'all',
        sources: [...DEFAULT_ENABLED_SOURCES],
        multiplier: 1.0,
        idle: 0,
        linear: true
      }
      // Save new binding
      if (!this.config.devices) this.config.devices = []
      this.config.devices.push(binding)
      this.saveConfig()
    }

    const bridge = new ToyBridge(feature, binding)
    this.toyBridges.set(feature.id, bridge)
  }

  /**
   * Set status change callback
   */
  setStatusChangeCallback(callback: ((status: unknown) => void) | null): void {
    this.onStatusChange = callback
  }

  /**
   * Notify listeners of status change
   */
  notifyStatusChange(): void {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(this.getStatus())
    }
    this.emit('status-changed', this.getStatus())
  }

  /**
   * Load configuration from config manager
   */
  loadConfig(): OGBConfig {
    try {
      const ogbConfig = configManager.getOgbConfig?.()
      if (ogbConfig) {
        debug.info('[OGB] Config loaded from config manager')
        return ogbConfig as OGBConfig
      }
    } catch (error) {
      debug.error(`[OGB] Failed to load config: ${(error as Error).message}`)
    }
    return {
      enabled: false,
      intifaceAddress: '127.0.0.1',
      intifacePort: 12345,
      intifaceWss: false,
      devices: [],
      audioEnabled: false,
      audioMultiplier: 1.0,
      maxLevelParam: null
    }
  }

  /**
   * Save configuration
   */
  saveConfig(): void {
    try {
      configManager.updateOgbConfig?.(this.config as unknown as Record<string, unknown>)
      debug.info('[OGB] Config saved')
    } catch (error) {
      debug.error(`[OGB] Failed to save config: ${(error as Error).message}`)
    }
  }

  /**
   * Set the OSC-Query service to receive OSC messages from
   */
  setOscQueryService(service: EventEmitter | null): void {
    // Remove old handler if exists
    if (this.oscQueryService && this.oscMessageHandler) {
      this.oscQueryService.off('osc-message', this.oscMessageHandler)
    }

    this.oscQueryService = service

    if (service && this.enabled) {
      this.oscMessageHandler = (data: unknown) => this.handleOscMessage(data)
      service.on('osc-message', this.oscMessageHandler)
      debug.info('[OGB] Attached to OSC-Query service')
    }
  }

  /**
   * Handle incoming OSC message
   */
  handleOscMessage(data: unknown): void {
    if (!this.enabled) return

    const { address, value } = data as { address: string, value: unknown }

    // Check for avatar change
    if (address === '/avatar/change') {
      debug.info('[OGB] Avatar changed, clearing game devices')
      this.gameDeviceManager.clear()
      return
    }

    // Only process avatar parameters
    if (!address.startsWith('/avatar/parameters/')) return

    // Forward to game device manager
    this.gameDeviceManager.handleOscMessage(address, value)
  }

  /**
   * Push current levels to all haptic devices
   */
  pushToDevices(): void {
    if (!this.enabled) return

    // Get all sources from game devices
    const sources = this.gameDeviceManager.getAllSources()

    // Add audio source if enabled
    if (this.config.audioEnabled && this.audioLevel > 0 && (Date.now() - this.lastAudioTime) < 1000) {
      sources.push(new BridgeSource('audio', 'audio', 'audio', this.audioLevel * (this.config.audioMultiplier || 1.0)))
    }

    // Push to all toy bridges
    let maxLevel = 0
    for (const bridge of this.toyBridges.values()) {
      bridge.push(sources)
      maxLevel = Math.max(maxLevel, bridge.lastLevel)
    }

    this.maxLevel = maxLevel

    // Send max level parameter if configured
    if (this.config.maxLevelParam && this.oscQueryService) {
      // This would need the OSC send capability - for now just emit
      this.emit('max-level', maxLevel)
    }
  }

  /**
   * Start the addon
   */
  start(): { success: boolean, error?: string } {
    if (this.enabled) {
      debug.warn('[OGB] Already running')
      return { success: false, error: 'Already running' }
    }

    debug.info('[OGB] Starting OscGoesBrrr addon...')

    // Configure Buttplug client
    this.buttplugClient.setConfig({
      address: this.config.intifaceAddress || '127.0.0.1',
      port: this.config.intifacePort || 12345,
      useWss: this.config.intifaceWss || false
    })

    // Start Buttplug connection
    this.buttplugClient.start()

    // Attach to OSC-Query service if available
    if (this.oscQueryService) {
      this.oscMessageHandler = (data: unknown) => this.handleOscMessage(data)
      this.oscQueryService.on('osc-message', this.oscMessageHandler)
      debug.info('[OGB] Attached to OSC-Query service for haptic events')
    } else {
      debug.warn('[OGB] No OSC-Query service available - OSC messages will not be received')
    }

    // Start push interval (15 FPS like original OGB)
    this.pushInterval = setInterval(() => {
      this.pushToDevices()
    }, 1000 / 15)

    this.enabled = true
    this.lastError = null
    this.notifyStatusChange()

    debug.info('[OGB] OscGoesBrrr addon started')
    return { success: true }
  }

  /**
   * Stop the addon
   */
  stop(): { success: boolean, error?: string } {
    if (!this.enabled) {
      debug.warn('[OGB] Not running')
      return { success: false, error: 'Not running' }
    }

    debug.info('[OGB] Stopping OscGoesBrrr addon...')

    // Stop push interval
    if (this.pushInterval) {
      clearInterval(this.pushInterval)
      this.pushInterval = null
    }

    // Detach from OSC-Query service
    if (this.oscQueryService && this.oscMessageHandler) {
      this.oscQueryService.off('osc-message', this.oscMessageHandler)
      this.oscMessageHandler = null
    }

    // Stop Buttplug connection
    this.buttplugClient.stop()

    // Clear bridges
    this.toyBridges.clear()

    this.enabled = false
    this.notifyStatusChange()

    debug.info('[OGB] OscGoesBrrr addon stopped')
    return { success: true }
  }

  /**
   * Check if addon is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Update audio level (for audio-reactive haptics)
   */
  setAudioLevel(level: number): void {
    if (typeof level !== 'number' || level < 0 || level > 1 || isNaN(level)) return
    this.audioLevel = level
    this.lastAudioTime = Date.now()
  }

  /**
   * Update Intiface connection settings
   */
  updateIntifaceConfig(config: { address?: string, port?: number, useWss?: boolean }): { success: boolean } {
    let changed = false
    if (config.address !== undefined && config.address !== this.config.intifaceAddress) {
      this.config.intifaceAddress = config.address
      changed = true
    }
    if (config.port !== undefined && config.port !== this.config.intifacePort) {
      this.config.intifacePort = config.port
      changed = true
    }
    if (config.useWss !== undefined && config.useWss !== this.config.intifaceWss) {
      this.config.intifaceWss = config.useWss
      changed = true
    }

    if (changed) {
      this.saveConfig()
      // Reconnect if running
      if (this.enabled) {
        this.buttplugClient.setConfig({
          address: this.config.intifaceAddress,
          port: this.config.intifacePort,
          useWss: this.config.intifaceWss
        })
        this.buttplugClient.retry()
      }
    }

    return { success: true }
  }

  /**
   * Update device binding configuration
   */
  updateDeviceBinding(deviceId: string, binding: Partial<DeviceBinding>): { success: boolean } {
    if (!this.config.devices) this.config.devices = []

    const existingIndex = this.config.devices.findIndex(d => d.id === deviceId)
    if (existingIndex >= 0) {
      this.config.devices[existingIndex] = { ...this.config.devices[existingIndex], ...binding }
    } else {
      this.config.devices.push({ id: deviceId, ...binding } as DeviceBinding)
    }

    // Update existing toy bridges
    for (const [featureId, bridge] of this.toyBridges.entries()) {
      if (bridge.feature.deviceId === deviceId) {
        bridge.config = this.config.devices.find(d => d.id === deviceId) || bridge.config
      }
    }

    this.saveConfig()
    return { success: true }
  }

  /**
   * Get device bindings
   */
  getDeviceBindings(): DeviceBinding[] {
    return this.config.devices || []
  }

  /**
   * Get current status
   */
  getStatus(): unknown {
    const buttplugStatus = this.buttplugClient.getStatus()
    return {
      enabled: this.enabled,
      connected: buttplugStatus.connected,
      connecting: buttplugStatus.connecting,
      serverName: buttplugStatus.serverName,
      serverVersion: buttplugStatus.serverVersion,
      intifaceAddress: this.config.intifaceAddress,
      intifacePort: this.config.intifacePort,
      intifaceWss: this.config.intifaceWss,
      deviceCount: buttplugStatus.deviceCount,
      devices: this.buttplugClient.getDevices(),
      gameDevices: this.gameDeviceManager.getStatus(),
      audioEnabled: this.config.audioEnabled,
      lastError: buttplugStatus.lastError || this.lastError,
      maxLevel: this.maxLevel
    }
  }

  /**
   * Get full configuration
   */
  getConfig(): OGBConfig {
    return { ...this.config }
  }

  /**
   * Update full configuration
   */
  updateConfig(newConfig: Partial<OGBConfig>): { success: boolean } {
    this.config = { ...this.config, ...newConfig }
    this.saveConfig()

    // Update Buttplug client if connection settings changed
    if (this.enabled) {
      this.buttplugClient.setConfig({
        address: this.config.intifaceAddress,
        port: this.config.intifacePort,
        useWss: this.config.intifaceWss
      })
    }

    this.notifyStatusChange()
    return { success: true }
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    this.stop()
    debug.info('[OGB] OscGoesBrrr addon closed')
  }
}

export default OscGoesBrrrAddon
