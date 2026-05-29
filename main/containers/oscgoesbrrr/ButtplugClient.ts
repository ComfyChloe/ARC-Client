/**
 * ButtplugClient - WebSocket client for Intiface Central
 * Implements Buttplug.io protocol v3 for haptic device control
 * 
 * Based on OSCGoesBrrr's Buttplug.ts implementation
 */

import WebSocket from 'ws'
import { EventEmitter } from 'node:events'
import debug from '../../services/debugger'

interface ActiveCallback {
  (data: unknown, error?: Error | null): void
  deviceIndex?: number
}

interface ButtplugDevice {
  DeviceName: string
  DeviceIndex: number
  DeviceMessages?: {
    ScalarCmd?: Array<{ ActuatorType: string }>
    LinearCmd?: unknown[]
    RotateCmd?: unknown[]
    SensorReadCmd?: Array<{ SensorType: string }>
  }
}

/**
 * Represents a single feature/actuator on a haptic device
 */
class DeviceFeature {
  id: string
  deviceId: string
  deviceName: string
  type: 'vibrate' | 'linear' | 'rotate'
  bioDeviceIndex: number
  bioSubIndex: number
  actuatorType: string
  parent: ButtplugClient
  lastLevel: number
  batteryLevel: number | null
  hasBatterySensor: boolean

  constructor(fullFeatureId: string, deviceId: string, deviceName: string, type: 'vibrate' | 'linear' | 'rotate', bioDeviceIndex: number, bioSubIndex: number, actuatorType: string, parent: ButtplugClient) {
    this.id = fullFeatureId
    this.deviceId = deviceId
    this.deviceName = deviceName
    this.type = type
    this.bioDeviceIndex = bioDeviceIndex
    this.bioSubIndex = bioSubIndex
    this.actuatorType = actuatorType
    this.parent = parent
    this.lastLevel = 0
    this.batteryLevel = null
    this.hasBatterySensor = false
  }

  /**
   * Set the intensity level for this feature
   * @param {number} level - Intensity 0-1
   * @param {number} duration - Duration in ms (for linear devices)
   */
  setLevel(level: number, duration: number = 0): void {
    if (!this.parent.wsReady()) return

    let sendPromise: Promise<unknown> | undefined
    if (this.type === 'linear') {
      sendPromise = this.parent.send({
        type: 'LinearCmd',
        DeviceIndex: this.bioDeviceIndex,
        Vectors: [{ Index: this.bioSubIndex, Duration: duration || 100, Position: level }]
      })
    } else if (this.type === 'rotate') {
      sendPromise = this.parent.send({
        type: 'RotateCmd',
        DeviceIndex: this.bioDeviceIndex,
        Rotations: [{ Index: this.bioSubIndex, Speed: Math.abs(level), Clockwise: level >= 0 }]
      })
    } else {
      // Vibrate/Scalar - skip Constrict actuators
      if (this.actuatorType !== 'Constrict') {
        const cmd = {
          type: 'ScalarCmd',
          DeviceIndex: this.bioDeviceIndex,
          Scalars: [{ Index: this.bioSubIndex, Scalar: level, ActuatorType: this.actuatorType }]
        }
        sendPromise = this.parent.send(cmd)
      }
    }
    if (sendPromise) {
      sendPromise.catch(() => {})
    }
    this.lastLevel = level
  }

  getStatus(): string {
    return `${this.deviceName} (${this.type}${this.bioSubIndex > 0 ? `-${this.bioSubIndex}` : ''}): ${(this.lastLevel * 100).toFixed(0)}%`
  }
}

/**
 * ButtplugClient - Manages connection to Intiface Central
 */
class ButtplugClient extends EventEmitter {
  ws: WebSocket | null
  lastMessageId: number
  activeCallbacks: Map<number, ActiveCallback>
  features: Map<string, DeviceFeature>
  usedDeviceIds: Set<string>
  recentlySentCmds: number
  retryTimeout: ReturnType<typeof setTimeout> | null
  connectionTimeout: ReturnType<typeof setTimeout> | null
  scanInterval: ReturnType<typeof setInterval> | null
  logInterval: ReturnType<typeof setInterval> | null
  batteryPollInterval: ReturnType<typeof setInterval> | null
  address: string
  port: number
  useWss: boolean
  serverName: string | null
  serverVersion: string | number | null
  isConnecting: boolean
  isStopped: boolean
  lastError: string | null

  constructor() {
    super()
    this.ws = null
    this.lastMessageId = 0
    this.activeCallbacks = new Map()
    this.features = new Map()
    this.usedDeviceIds = new Set()
    this.recentlySentCmds = 0
    this.retryTimeout = null
    this.connectionTimeout = null
    this.scanInterval = null
    this.logInterval = null
    this.batteryPollInterval = null
    this.address = '127.0.0.1'
    this.port = 12345
    this.useWss = false
    this.serverName = null
    this.serverVersion = null
    this.isConnecting = false
    this.isStopped = false
    this.lastError = null
    debug.info('[Buttplug] Client initialized')
  }

  /**
   * Configure connection settings
   * @param {Object} config - { address, port, useWss }
   */
  setConfig(config: { address?: string, port?: number, useWss?: boolean }): void {
    if (config.address) this.address = config.address
    if (config.port) this.port = config.port
    if (config.useWss !== undefined) this.useWss = config.useWss
  }

  /**
   * Start the connection to Intiface
   */
  start(): void {
    this.isStopped = false
    this.retry()
    this.startScanning()
    this.startBatteryPolling()
    // Log command frequency every 15 seconds
    this.logInterval = setInterval(() => {
      if (this.recentlySentCmds > 0) {
        debug.info(`[Buttplug] Sent ${this.recentlySentCmds} commands in the last 15 seconds`)
        this.recentlySentCmds = 0
      }
    }, 15000)
  }

  /**
   * Stop the connection and cleanup
   */
  stop(): void {
    this.isStopped = true
    this.clearTimers()
    this.terminate()
  }

  clearTimers(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }
    if (this.scanInterval) {
      clearInterval(this.scanInterval)
      this.scanInterval = null
    }
    if (this.logInterval) {
      clearInterval(this.logInterval)
      this.logInterval = null
    }
    if (this.batteryPollInterval) {
      clearInterval(this.batteryPollInterval)
      this.batteryPollInterval = null
    }
  }

  /**
   * Attempt to connect to Intiface
   */
  retry(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }

    this.terminate()
    this.isConnecting = true

    const protocol = this.useWss ? 'wss' : 'ws'
    const uri = `${protocol}://${this.address}:${this.port}`

    let ws: WebSocket
    try {
      ws = this.ws = new WebSocket(uri)
    } catch (e) {
      debug.error(`[Buttplug] Init exception: ${(e as Error).message}`)
      this.lastError = (e as Error).message
      this.isConnecting = false
      this.delayRetry()
      return
    }

    ws.on('message', (data: WebSocket.RawData) => this.onReceive(data))

    ws.on('error', (e: Error) => {
      debug.error(`[Buttplug] WebSocket error: ${e.message}`)
      this.lastError = e.message
      this.delayRetry()
    })

    ws.on('close', () => {
      for (const callback of this.activeCallbacks.values()) {
        callback(null, new Error('Connection closed'))
      }
      this.activeCallbacks.clear()
      this.clearDevices()
      this.isConnecting = false
      this.emit('disconnected')
      this.delayRetry()
    })

    ws.on('open', async () => {
      this.clearDevices()
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
      }
      this.isConnecting = false
      this.lastError = null
      debug.info('[Buttplug] Connected to Intiface')

      try {
        // Handshake
        const serverInfo = await this.send({
          type: 'RequestServerInfo',
          ClientName: 'ARC-Client',
          MessageVersion: 3
        }) as Record<string, unknown> | null
        if (serverInfo && serverInfo.type === 'ServerInfo') {
          this.serverName = serverInfo.ServerName as string
          this.serverVersion = (serverInfo.ServerVersion || serverInfo.MajorVersion) as string | number
          debug.info(`[Buttplug] Server: ${this.serverName} v${this.serverVersion}`)
        }

        // Request existing devices
        await this.send({ type: 'RequestDeviceList' })
        this.emit('connected')
      } catch (e) {
        debug.error(`[Buttplug] Handshake failed: ${(e as Error).message}`)
        this.lastError = (e as Error).message
        // Don't rethrow - let the connection attempt continue
      }
    })

    // Connection timeout
    this.connectionTimeout = setTimeout(() => {
      debug.warn('[Buttplug] Connection timed out')
      this.lastError = 'Connection timed out'
      this.isConnecting = false
      this.delayRetry()
    }, 5000)
  }

  /**
   * Handle received WebSocket message
   */
  onReceive(data: WebSocket.RawData): void {
    try {
      const jsonStr = data.toString()
      const packets = JSON.parse(jsonStr)

      for (const packet of packets) {
        for (const [type, body] of Object.entries(packet)) {
          this.handlePacket({ type, ...(body as Record<string, unknown>) })
        }
      }
    } catch (e) {
      debug.error(`[Buttplug] Parse error: ${(e as Error).message}`)
    }
  }

  /**
   * Handle individual Buttplug message
   */
  handlePacket(params: Record<string, unknown>): void {
    const type = params.type

    // Log non-Ok messages (and periodically log Ok for debugging)
    if (type !== 'Ok') {
      debug.info(`[Buttplug] <- ${type}: ${JSON.stringify(params)}`)
    }

    if (type === 'DeviceRemoved') {
      this.removeDevice(params.DeviceIndex as number)
    } else if (type === 'DeviceAdded') {
      this.addDevice(params as unknown as ButtplugDevice)
    } else if (type === 'DeviceList') {
      for (const d of (params.Devices as ButtplugDevice[]) || []) {
        this.addDevice(d)
      }
    } else if (type === 'Error') {
      debug.error(`[Buttplug] Server error: ${params.ErrorMessage}`)
      this.lastError = params.ErrorMessage as string
    } else if (type === 'SensorReading') {
      this.handleSensorReading(params)
    }

    // Handle callbacks (check for Id !== undefined/null, not just truthy,
    // since Buttplug protocol uses Id=0)
    const id = params.Id as number | undefined
    if (id != null && this.activeCallbacks.has(id)) {
      const cb = this.activeCallbacks.get(id)!
      this.activeCallbacks.delete(id)
      if (type === 'Error') {
        cb(null, new Error((params.ErrorMessage as string) || 'Unknown error'))
      } else {
        cb(params)
      }
    }
  }

  /**
   * Send a Buttplug message
   * @param {Object} message - Message object with type property
   * @returns {Promise<Object>} Response message
   */
  async send(message: { type: string, [key: string]: unknown }): Promise<unknown> {
    const { type, ...params } = message
    if (!this.wsReady() || !this.ws) return null

    const id = ++this.lastMessageId
    if (this.lastMessageId > 1000000000) this.lastMessageId = 1

    const newArgs = { Id: id, ...params }

    // Track high-frequency commands
    if (['ScalarCmd', 'LinearCmd', 'RotateCmd', 'FleshlightLaunchFW12Cmd'].includes(type)) {
      this.recentlySentCmds++
    } else if (!['StartScanning', 'StopScanning'].includes(type)) {
      debug.info(`[Buttplug] -> ${type}: ${JSON.stringify(newArgs)}`)
    }

    const json = [{ [type]: newArgs }]
    this.ws.send(JSON.stringify(json))

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.activeCallbacks.delete(id)
        reject(new Error('Timeout after 5000ms'))
      }, 5000)

      const callback: ActiveCallback = (data: unknown, error?: Error | null) => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(data)
      }
      // Track device index so removeDevice() can reject pending callbacks
      callback.deviceIndex = params.DeviceIndex as number | undefined
      this.activeCallbacks.set(id, callback)
    })
  }

  /**
   * Check if WebSocket is ready
   */
  wsReady(): boolean {
    return !!(this.ws && this.ws.readyState === WebSocket.OPEN)
  }

  /**
   * Terminate the WebSocket connection
   */
  terminate(): void {
    if (this.ws) {
      this.ws.terminate()
      this.ws = null
    }
  }

  /**
   * Schedule a retry after delay
   */
  delayRetry(): void {
    if (this.isStopped || this.retryTimeout) return
    this.terminate()
    this.isConnecting = true
    this.emit('connecting')
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null
      if (!this.isStopped) {
        debug.info('[Buttplug] Attempting reconnection...')
        this.retry()
      }
    }, 5000)
  }

  /**
   * Start continuous device scanning
   */
  startScanning(): void {
    if (this.scanInterval) return

    const doScan = async (): Promise<void> => {
      if (!this.wsReady()) return
      try {
        await this.send({ type: 'StartScanning' })
        await new Promise(r => setTimeout(r, 10000))
        if (this.wsReady()) {
          await this.send({ type: 'StopScanning' })
        }
      } catch (e) {
        debug.error(`[Buttplug] Scan error: ${(e as Error).message}`)
        // Don't propagate - connection loss is handled by ws events
      }
    }

    // Initial scan (wrapped to catch any errors)
    doScan().catch(e => {
      debug.error(`[Buttplug] Initial scan error: ${(e as Error).message}`)
    })

    // Scan every 15 seconds
    this.scanInterval = setInterval(() => {
      doScan().catch(e => {
        debug.error(`[Buttplug] Periodic scan error: ${(e as Error).message}`)
      })
    }, 15000)
  }

  /**
   * Start periodic battery polling
   */
  startBatteryPolling(): void {
    if (this.batteryPollInterval) return

    const pollBatteries = async (): Promise<void> => {
      if (!this.wsReady()) return
      
      // Get unique device indexes that have battery sensors
      const deviceIndexes = new Set<number>()
      for (const feature of this.features.values()) {
        if (feature.hasBatterySensor) {
          deviceIndexes.add(feature.bioDeviceIndex)
        }
      }

      // Poll each device's battery
      for (const deviceIndex of deviceIndexes) {
        try {
          await this.send({
            type: 'SensorReadCmd',
            DeviceIndex: deviceIndex,
            SensorIndex: 0,
            SensorType: 'Battery'
          })
        } catch (e) {
          // Silently ignore battery read errors
        }
      }
    }

    // Poll every 60 seconds (wrapped to catch errors)
    this.batteryPollInterval = setInterval(() => {
      pollBatteries().catch(e => {
        debug.error(`[Buttplug] Battery poll error: ${(e as Error).message}`)
      })
    }, 60000)
    
    // Initial poll after 2 seconds (give devices time to connect)
    setTimeout(() => {
      pollBatteries().catch(e => {
        debug.error(`[Buttplug] Initial battery poll error: ${(e as Error).message}`)
      })
    }, 2000)
  }

  /**
   * Handle sensor reading response
   */
  handleSensorReading(params: Record<string, unknown>): void {
    const deviceIndex = params.DeviceIndex as number
    const data = (params.Data || params.data || []) as number[]
    
    if (data.length === 0) return
    
    // Battery level is typically the first (and only) sensor value
    const batteryLevel = Math.round(data[0])
    
    // Update all features for this device
    for (const feature of this.features.values()) {
      if (feature.bioDeviceIndex === deviceIndex) {
        feature.batteryLevel = batteryLevel
      }
    }
    
    this.emit('devicesChanged')
  }

  /**
   * Clear all devices
   */
  clearDevices(): void {
    for (const feature of this.features.values()) {
      this.emit('removeFeature', feature)
    }
    this.usedDeviceIds.clear()
    this.features.clear()
    this.emit('devicesChanged')
  }

  /**
   * Remove a device by index
   */
  removeDevice(bioDeviceIndex: number): void {
    // Reject any pending callbacks for this device to prevent timeout-based
    // unhandled promise rejections (commands sent right before disconnect)
    for (const [id, callback] of this.activeCallbacks.entries()) {
      if (callback.deviceIndex === bioDeviceIndex) {
        this.activeCallbacks.delete(id)
        callback(null, new Error('Device removed'))
      }
    }
    const removing: string[] = []
    for (const [id, feature] of this.features.entries()) {
      if (feature.bioDeviceIndex === bioDeviceIndex) {
        removing.push(id)
      }
    }
    for (const id of removing) {
      const feature = this.features.get(id)!
      this.emit('removeFeature', feature)
      this.usedDeviceIds.delete(feature.deviceId)
      this.features.delete(id)
    }
    if (removing.length > 0) {
      this.emit('devicesChanged')
    }
  }

  /**
   * Add a device from Buttplug message
   */
  addDevice(d: ButtplugDevice): void {
    const name = d.DeviceName
    const baseId = name.toLowerCase().replace(/\s+/g, '')

    // Find unique ID
    let id: string
    for (let i = 0; ; i++) {
      id = baseId + (i === 0 ? '' : i)
      if (!this.usedDeviceIds.has(id)) break
    }
    this.usedDeviceIds.add(id)

    // Check for battery sensor
    const hasBattery = (d.DeviceMessages?.SensorReadCmd || []).some(s => s.SensorType === 'Battery')

    let featureNum = 0

    // Add scalar/vibrate features
    const scalarCmds = d.DeviceMessages?.ScalarCmd || []
    for (let i = 0; i < scalarCmds.length; i++) {
      const feature = new DeviceFeature(
        `${id}-${featureNum++}`,
        id,
        name,
        'vibrate',
        d.DeviceIndex,
        i,
        scalarCmds[i].ActuatorType,
        this
      )
      feature.hasBatterySensor = hasBattery
      this.features.set(feature.id, feature)
      this.emit('addFeature', feature)
    }

    // Add linear features
    const linearCmds = d.DeviceMessages?.LinearCmd || []
    for (let i = 0; i < linearCmds.length; i++) {
      const feature = new DeviceFeature(
        `${id}-${featureNum++}`,
        id,
        name,
        'linear',
        d.DeviceIndex,
        i,
        '',
        this
      )
      this.features.set(feature.id, feature)
      this.emit('addFeature', feature)
    }

    // Add rotate features
    const rotateCmds = d.DeviceMessages?.RotateCmd || []
    for (let i = 0; i < rotateCmds.length; i++) {
      const feature = new DeviceFeature(
        `${id}-${featureNum++}`,
        id,
        name,
        'rotate',
        d.DeviceIndex,
        i,
        '',
        this
      )
      this.features.set(feature.id, feature)
      this.emit('addFeature', feature)
    }

    debug.info(`[Buttplug] Device added: ${name} with ${featureNum} features`)
    this.emit('devicesChanged')
  }

  /**
   * Get all device features
   */
  getFeatures(): DeviceFeature[] {
    return Array.from(this.features.values())
  }

  /**
   * Get unique devices (grouped by deviceId)
   */
  getDevices(): Array<{ id: string, name: string, batteryLevel: number | null, features: Array<{ id: string, type: string, actuatorType: string, lastLevel: number }> }> {
    const devices = new Map<string, { id: string, name: string, batteryLevel: number | null, features: Array<{ id: string, type: string, actuatorType: string, lastLevel: number }> }>()
    for (const feature of this.features.values()) {
      if (!devices.has(feature.deviceId)) {
        devices.set(feature.deviceId, {
          id: feature.deviceId,
          name: feature.deviceName,
          batteryLevel: feature.batteryLevel,
          features: []
        })
      }
      devices.get(feature.deviceId)!.features.push({
        id: feature.id,
        type: feature.type,
        actuatorType: feature.actuatorType,
        lastLevel: feature.lastLevel
      })
    }
    return Array.from(devices.values())
  }

  /**
   * Get connection status
   */
  getStatus(): { connected: boolean, connecting: boolean, address: string, port: number, useWss: boolean, serverName: string | null, serverVersion: string | number | null, deviceCount: number, lastError: string | null } {
    return {
      connected: this.wsReady(),
      connecting: this.isConnecting,
      address: this.address,
      port: this.port,
      useWss: this.useWss,
      serverName: this.serverName,
      serverVersion: this.serverVersion,
      deviceCount: this.features.size,
      lastError: this.lastError
    }
  }
}

export { ButtplugClient, DeviceFeature }
