/**
 * GameDevice - Parses VRCFury Haptics / TPS / OGB contact data from OSC
 * 
 * Tracks contact values from avatar parameters to calculate haptic intensity.
 * Based on OSCGoesBrrr's GameDevice.ts implementation
 */

import { EventEmitter } from 'node:events'
import debug from '../../services/debugger'

/**
 * Represents a source of haptic data (a specific contact on the avatar)
 */
class BridgeSource {
  deviceType: string
  deviceName: string
  featureName: string
  value: number

  /**
   * @param {'orf'|'pen'|'audio'|'raw'|'touch'} deviceType - Type of device
   * @param {string} deviceName - Unique identifier for the device
   * @param {string} featureName - Name of the specific contact/feature
   * @param {number} value - Current value (0-1)
   */
  constructor(deviceType: string, deviceName: string, featureName: string, value: number) {
    this.deviceType = deviceType
    this.deviceName = deviceName
    this.featureName = featureName
    this.value = value
  }

  getUniqueKey(): string {
    return `${this.deviceType}__${this.deviceName}__${this.featureName}`
  }
}

/**
 * Detects the length of a penetrator by tracking root/tip proximity
 * Based on the original OscGoesBrrr's GameDeviceLengthDetector
 */
class LengthDetector {
  length: number | null
  recentSamples: number[]
  badPenetratingSample: number | undefined

  constructor() {
    this.length = null
    this.recentSamples = []
    this.badPenetratingSample = undefined
  }

  saveSample(sample: number | undefined): void {
    if (sample === undefined) {
      this.recentSamples = []
    } else {
      this.recentSamples.push(sample)
      if (this.recentSamples.length > 5) {
        this.recentSamples.shift()
      }
    }
    this.updateLengthFromSamples()
  }

  updateLengthFromSamples(): void {
    const sortedSamples = [...this.recentSamples]
    if (sortedSamples.length === 0) {
      // Use bad sample if we have no good samples
      this.length = this.badPenetratingSample ?? null
      return
    }
    
    // Find the most consistent pair of samples
    sortedSamples.sort((a, b) => a - b)
    let smallestDiff = 1
    let smallestDiffIndex = -1
    for (let i = 1; i < sortedSamples.length; i++) {
      const diff = Math.abs(sortedSamples[i] - sortedSamples[i - 1])
      if (diff < smallestDiff) {
        smallestDiff = diff
        smallestDiffIndex = i
      }
    }
    if (smallestDiffIndex >= 0) {
      this.length = sortedSamples[smallestDiffIndex]
    } else if (sortedSamples.length > 0) {
      this.length = sortedSamples[0]
    }
  }

  update(rootProx: number, tipProx: number): void {
    if (typeof rootProx !== 'number' || typeof tipProx !== 'number') {
      this.badPenetratingSample = undefined
      this.saveSample(undefined)
      return
    }
    if (rootProx < 0.01 || tipProx < 0.01) {
      // Nobody in radius, clear recorded length
      this.badPenetratingSample = undefined
      this.saveSample(undefined)
      return
    }
    if (rootProx > 0.95) {
      // Nearly impossible (root is at center of orifice)
      // Keep using whatever we recorded before
      return
    }

    // Calculate length as difference between tip and root proximity
    // The receiver spheres are 1m in size, so this is in meters
    const calculatedLength = tipProx - rootProx
    if (calculatedLength < 0.02) {
      // Too short (broken or backward?), keep previous
      return
    }
    
    if (tipProx > 0.99) {
      // Penetrator is penetrating right now. Only use this length if we don't have better.
      if (this.badPenetratingSample === undefined || calculatedLength > this.badPenetratingSample) {
        this.badPenetratingSample = calculatedLength
        this.updateLengthFromSamples()
      }
    } else {
      // Good sample while not fully penetrating
      this.saveSample(calculatedLength)
    }
  }

  getLength(): number | null {
    return this.length
  }
}

/**
 * GameDevice - Tracks a single haptic zone on an avatar
 */
class GameDevice extends EventEmitter {
  type: string
  id: string
  isTps: boolean
  values: Map<string, unknown>
  recordedSelfLength: LengthDetector
  recordedOthersLength: LengthDetector

  /**
   * @param {string} type - 'Orf', 'Pen', or 'Touch'
   * @param {string} id - Unique identifier
   * @param {boolean} isTps - Whether this is a TPS_Internal device
   */
  constructor(type: string, id: string, isTps: boolean) {
    super()
    this.type = type
    this.id = id
    this.isTps = isTps
    this.values = new Map()
    this.recordedSelfLength = new LengthDetector()
    this.recordedOthersLength = new LengthDetector()
  }

  /**
   * Update a parameter value
   * @param {string} key - Parameter name (e.g., 'TouchOthers', 'PenSelf')
   * @param {*} value - The value
   */
  setValue(key: string, value: unknown): void {
    const oldValue = this.values.get(key)
    this.values.set(key, value)

    // Update length detectors for new-style penetration
    if (key === 'PenSelfNewRoot' || key === 'PenSelfNewTip') {
      this.recordedSelfLength.update(
        this.getNumber('PenSelfNewRoot') ?? 0,
        this.getNumber('PenSelfNewTip') ?? 0
      )
    }
    if (key === 'PenOthersNewRoot' || key === 'PenOthersNewTip') {
      this.recordedOthersLength.update(
        this.getNumber('PenOthersNewRoot') ?? 0,
        this.getNumber('PenOthersNewTip') ?? 0
      )
    }

    if (oldValue !== value) {
      this.emit('change', key, value)
    }
  }

  /**
   * Get value as number
   */
  getNumber(key: string): number | undefined {
    const val = this.values.get(key)
    return typeof val === 'number' ? val : undefined
  }

  /**
   * Get value as boolean
   */
  getBool(key: string): boolean {
    const val = this.values.get(key)
    return !!val
  }

  /**
   * Calculate new-style penetration amount
   * Based on original OscGoesBrrr implementation:
   * - Returns depth 0-1 when fully penetrating (tipProx > 0.99)
   * - Returns 0 during approach (tipProx < 0.99) so legacy PenOthers is used
   * - Returns undefined if new-style parameters aren't being used
   * @param {boolean} self - Whether to check self or others
   * @returns {number|undefined} Penetration amount 0-1, or undefined if not applicable
   */
  getNewPenAmount(self: boolean): number | undefined {
    const rootProx = this.getNumber(self ? 'PenSelfNewRoot' : 'PenOthersNewRoot')
    const tipProx = this.getNumber(self ? 'PenSelfNewTip' : 'PenOthersNewTip')

    if (typeof rootProx === 'number' && typeof tipProx === 'number' && (rootProx > 0 || tipProx > 0)) {
      // Someone with new penetration is nearby, so never use legacy pen
      const lengthDetector = self ? this.recordedSelfLength : this.recordedOthersLength
      const len = lengthDetector.getLength()
      
      if (len && tipProx > 0.99) {
        // Tip is fully inside - calculate depth based on how much root is exposed
        const exposedLength = 1 - rootProx
        const exposedRatio = exposedLength / len
        const depth = Math.max(0, Math.min(1, 1 - exposedRatio))
        return depth
      }
      
      // Tip not fully inside - return 0 to indicate "new style is active but not penetrating"
      // This ensures legacy PenOthers doesn't override during new-style interaction
      return 0
    }

    // New-style parameters aren't being used - return undefined to allow legacy fallback
    return undefined
  }

  /**
   * Get all haptic sources from this device
   * @returns {BridgeSource[]}
   */
  getSources(): BridgeSource[] {
    const sources: BridgeSource[] = []

    if (!this.isTps) {
      if (this.type === 'Orf') {
        // Orifice - receives touch and penetration
        sources.push(new BridgeSource('orf', this.id, 'touchSelf',
          this.getBool('TouchSelfClose') ? this.getNumber('TouchSelf') ?? 0 : 0))
        sources.push(new BridgeSource('orf', this.id, 'touchOthers',
          this.getBool('TouchOthersClose') ? this.getNumber('TouchOthers') ?? 0 : 0))

        // Penetration - legacy and new style
        const penSelfLegacy = this.getNumber('PenSelf')
        const penSelfNew = this.getNewPenAmount(true)
        sources.push(new BridgeSource('orf', this.id, 'penSelf',
          penSelfNew ?? penSelfLegacy ?? 0))

        const penOthersLegacyClose = this.getBool('PenOthersClose') || this.values.get('PenOthersClose') === undefined
        const penOthersLegacy = penOthersLegacyClose ? this.getNumber('PenOthers') : undefined
        const penOthersNew = this.getNewPenAmount(false)
        sources.push(new BridgeSource('orf', this.id, 'penOthers',
          penOthersNew ?? penOthersLegacy ?? 0))

        sources.push(new BridgeSource('orf', this.id, 'frotOthers',
          this.getNumber('FrotOthers') ?? 0))
      }

      if (this.type === 'Pen') {
        // Penetrator - can touch and penetrate
        sources.push(new BridgeSource('pen', this.id, 'touchSelf',
          this.getBool('TouchSelfClose') ? this.getNumber('TouchSelf') ?? 0 : 0))
        sources.push(new BridgeSource('pen', this.id, 'touchOthers',
          this.getBool('TouchOthersClose') ? this.getNumber('TouchOthers') ?? 0 : 0))
        sources.push(new BridgeSource('pen', this.id, 'penSelf',
          this.getNumber('PenSelf') ?? 0))
        sources.push(new BridgeSource('pen', this.id, 'penOthers',
          this.getNumber('PenOthers') ?? 0))
        sources.push(new BridgeSource('pen', this.id, 'frotOthers',
          this.getBool('FrotOthersClose') ? this.getNumber('FrotOthers') ?? 0 : 0))
      }

      if (this.type === 'Touch') {
        // Touch zone only
        sources.push(new BridgeSource('touch', this.id, 'touchSelf',
          this.getNumber('Self') ?? 0))
        sources.push(new BridgeSource('touch', this.id, 'touchOthers',
          this.getNumber('Others') ?? 0))
      }
    } else {
      // TPS Internal (legacy system)
      if (this.type === 'Orf') {
        sources.push(new BridgeSource('orf', this.id, 'penOthers',
          this.getNumber('Depth_In') ?? 0))
      }
      if (this.type === 'Pen') {
        sources.push(new BridgeSource('pen', this.id, 'penOthers',
          this.getNumber('Depth_In') ?? 0))
      }
    }

    return sources
  }

  /**
   * Get status string for UI
   */
  getStatus(): string {
    const sources = this.getSources()
    const activeSources = sources.filter(s => s.value > 0)
    if (activeSources.length === 0) {
      return `${this.type}/${this.id}: idle`
    }
    const details = activeSources.map(s => `${s.featureName}=${(s.value * 100).toFixed(0)}%`).join(', ')
    return `${this.type}/${this.id}: ${details}`
  }
}

/**
 * GameDeviceManager - Tracks all game devices from OSC parameters
 */
class GameDeviceManager extends EventEmitter {
  devices: Map<string, GameDevice>
  lastUpdate: number

  constructor() {
    super()
    this.devices = new Map()
    this.lastUpdate = 0
  }

  /**
   * Parse an OSC address and update the relevant game device
   * @param {string} address - OSC address (e.g., /avatar/parameters/OGB/Orf/MyOrf/TouchOthers)
   * @param {*} value - Parameter value
   */
  handleOscMessage(address: string, value: unknown): void {
    // Remove /avatar/parameters/ prefix if present
    let paramPath = address
    if (paramPath.startsWith('/avatar/parameters/')) {
      paramPath = paramPath.substring('/avatar/parameters/'.length)
    }

    const split = paramPath.split('/')
    
    // Parse OGB format: OGB/<type>/<id>/<contactType>
    if (split[0] === 'OGB' || split[0] === 'TPS_Internal') {
      const isTps = split[0] === 'TPS_Internal'
      const type = split[1]
      const id = split[2]
      const contactType = split.slice(3).join('/')

      if (!type || !id || !contactType) return

      const key = `${isTps ? 'tps' : 'ogb'}__${type}__${id}`
      let device = this.devices.get(key)

      if (!device) {
        device = new GameDevice(type, id, isTps)
        this.devices.set(key, device)
        this.emit('deviceAdded', device)
      }

      device.setValue(contactType, value)
      this.lastUpdate = Date.now()
      this.emit('update')
    }

    // Parse VFH format: VFH/Zone/<type>/<id>/<contactType>
    if (split[0] === 'VFH' && split[1] === 'Zone') {
      const type = split[2]
      const id = split[3]
      const contactType = split[4]

      if (!type || !id || !contactType) return

      const key = `vfh__${type}__${id}`
      let device = this.devices.get(key)

      if (!device) {
        device = new GameDevice(type, id, false)
        this.devices.set(key, device)
        this.emit('deviceAdded', device)
      }

      device.setValue(contactType, value)
      this.lastUpdate = Date.now()
      this.emit('update')
    }
  }

  /**
   * Get all devices
   */
  getDevices(): GameDevice[] {
    return Array.from(this.devices.values())
  }

  /**
   * Get all sources from all devices
   * Filters out TPS devices if OGB devices exist for same zone
   */
  getAllSources(): BridgeSource[] {
    const allDevices = this.getDevices()
    const hasOGBDevice = allDevices.some(d => !d.isTps)

    const sources: BridgeSource[] = []
    for (const device of allDevices) {
      // Skip TPS if we have OGB (prefer OGB)
      if (hasOGBDevice && device.isTps) continue
      sources.push(...device.getSources())
    }

    return sources
  }

  /**
   * Clear all devices (on avatar change)
   */
  clear(): void {
    this.devices.clear()
    this.emit('cleared')
  }

  /**
   * Get status for all devices
   */
  getStatus(): string[] {
    return this.getDevices().map(d => d.getStatus())
  }
}

export { GameDevice, GameDeviceManager, BridgeSource, LengthDetector }
