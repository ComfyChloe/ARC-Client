/**
 * GameDevice - Parses VRCFury Haptics / TPS / OGB contact data from OSC
 * 
 * Tracks contact values from avatar parameters to calculate haptic intensity.
 * Based on OSCGoesBrrr's GameDevice.ts implementation
 */

const EventEmitter = require('events');
const debug = require('../../utils/debugger');

/**
 * Represents a source of haptic data (a specific contact on the avatar)
 */
class BridgeSource {
  /**
   * @param {'orf'|'pen'|'audio'|'raw'|'touch'} deviceType - Type of device
   * @param {string} deviceName - Unique identifier for the device
   * @param {string} featureName - Name of the specific contact/feature
   * @param {number} value - Current value (0-1)
   */
  constructor(deviceType, deviceName, featureName, value) {
    this.deviceType = deviceType;
    this.deviceName = deviceName;
    this.featureName = featureName;
    this.value = value;
  }

  getUniqueKey() {
    return `${this.deviceType}__${this.deviceName}__${this.featureName}`;
  }
}

/**
 * Detects the length of a penetrator by tracking root/tip proximity
 */
class LengthDetector {
  constructor() {
    this.recordedLength = null;
    this.lastRoot = 0;
    this.lastTip = 0;
  }

  update(rootProx, tipProx) {
    if (typeof rootProx !== 'number' || typeof tipProx !== 'number') return;
    
    // When tip is fully inside and root is partially in, we can calculate length
    if (tipProx > 0.99 && rootProx > 0 && rootProx < 0.99) {
      const newLength = 1 - rootProx;
      if (!this.recordedLength || Math.abs(newLength - this.recordedLength) < 0.1) {
        this.recordedLength = newLength;
      }
    }
    
    this.lastRoot = rootProx;
    this.lastTip = tipProx;
  }

  getLength() {
    return this.recordedLength;
  }
}

/**
 * GameDevice - Tracks a single haptic zone on an avatar
 */
class GameDevice extends EventEmitter {
  /**
   * @param {string} type - 'Orf', 'Pen', or 'Touch'
   * @param {string} id - Unique identifier
   * @param {boolean} isTps - Whether this is a TPS_Internal device
   */
  constructor(type, id, isTps) {
    super();
    this.type = type;
    this.id = id;
    this.isTps = isTps;
    this.values = new Map();
    this.recordedSelfLength = new LengthDetector();
    this.recordedOthersLength = new LengthDetector();
  }

  /**
   * Update a parameter value
   * @param {string} key - Parameter name (e.g., 'TouchOthers', 'PenSelf')
   * @param {*} value - The value
   */
  setValue(key, value) {
    const oldValue = this.values.get(key);
    this.values.set(key, value);

    // Update length detectors for new-style penetration
    if (key === 'PenSelfNewRoot' || key === 'PenSelfNewTip') {
      this.recordedSelfLength.update(
        this.getNumber('PenSelfNewRoot'),
        this.getNumber('PenSelfNewTip')
      );
    }
    if (key === 'PenOthersNewRoot' || key === 'PenOthersNewTip') {
      this.recordedOthersLength.update(
        this.getNumber('PenOthersNewRoot'),
        this.getNumber('PenOthersNewTip')
      );
    }

    if (oldValue !== value) {
      this.emit('change', key, value);
    }
  }

  /**
   * Get value as number
   */
  getNumber(key) {
    const val = this.values.get(key);
    return typeof val === 'number' ? val : undefined;
  }

  /**
   * Get value as boolean
   */
  getBool(key) {
    const val = this.values.get(key);
    return !!val;
  }

  /**
   * Calculate new-style penetration amount
   * @param {boolean} self - Whether to check self or others
   * @returns {number|undefined} Penetration amount 0-1, or undefined if not applicable
   */
  getNewPenAmount(self) {
    const rootProx = this.getNumber(self ? 'PenSelfNewRoot' : 'PenOthersNewRoot');
    const tipProx = this.getNumber(self ? 'PenSelfNewTip' : 'PenOthersNewTip');

    if (typeof rootProx === 'number' && typeof tipProx === 'number' && (rootProx > 0 || tipProx > 0)) {
      const lengthDetector = self ? this.recordedSelfLength : this.recordedOthersLength;
      const len = lengthDetector.getLength();
      
      // If tip is fully inside (> 0.99), we can calculate precise depth
      if (len && tipProx > 0.99) {
        const exposedLength = 1 - rootProx;
        const exposedRatio = exposedLength / len;
        return Math.max(0, Math.min(1, 1 - exposedRatio));
      }
      
      // If we have a recorded length, use it for partial calculation
      if (len && tipProx > 0) {
        // Estimate based on tip proximity and recorded length
        const tipDepth = tipProx * len;
        return Math.max(0, Math.min(1, tipDepth));
      }
      
      // Fallback: Use tip proximity directly as a rough estimate
      // This handles the case where we haven't recorded a length yet
      if (tipProx > 0) {
        return Math.max(0, Math.min(1, tipProx));
      }
      
      return 0;
    }

    return undefined;
  }

  /**
   * Get all haptic sources from this device
   * @returns {BridgeSource[]}
   */
  getSources() {
    const sources = [];

    if (!this.isTps) {
      if (this.type === 'Orf') {
        // Orifice - receives touch and penetration
        sources.push(new BridgeSource('orf', this.id, 'touchSelf',
          this.getBool('TouchSelfClose') ? this.getNumber('TouchSelf') ?? 0 : 0));
        sources.push(new BridgeSource('orf', this.id, 'touchOthers',
          this.getBool('TouchOthersClose') ? this.getNumber('TouchOthers') ?? 0 : 0));

        // Penetration - legacy and new style
        const penSelfLegacy = this.getNumber('PenSelf');
        const penSelfNew = this.getNewPenAmount(true);
        sources.push(new BridgeSource('orf', this.id, 'penSelf',
          penSelfNew ?? penSelfLegacy ?? 0));

        const penOthersLegacyClose = this.getBool('PenOthersClose') || this.values.get('PenOthersClose') === undefined;
        const penOthersLegacy = penOthersLegacyClose ? this.getNumber('PenOthers') : undefined;
        const penOthersNew = this.getNewPenAmount(false);
        sources.push(new BridgeSource('orf', this.id, 'penOthers',
          penOthersNew ?? penOthersLegacy ?? 0));

        sources.push(new BridgeSource('orf', this.id, 'frotOthers',
          this.getNumber('FrotOthers') ?? 0));
      }

      if (this.type === 'Pen') {
        // Penetrator - can touch and penetrate
        sources.push(new BridgeSource('pen', this.id, 'touchSelf',
          this.getBool('TouchSelfClose') ? this.getNumber('TouchSelf') ?? 0 : 0));
        sources.push(new BridgeSource('pen', this.id, 'touchOthers',
          this.getBool('TouchOthersClose') ? this.getNumber('TouchOthers') ?? 0 : 0));
        sources.push(new BridgeSource('pen', this.id, 'penSelf',
          this.getNumber('PenSelf') ?? 0));
        sources.push(new BridgeSource('pen', this.id, 'penOthers',
          this.getNumber('PenOthers') ?? 0));
        sources.push(new BridgeSource('pen', this.id, 'frotOthers',
          this.getBool('FrotOthersClose') ? this.getNumber('FrotOthers') ?? 0 : 0));
      }

      if (this.type === 'Touch') {
        // Touch zone only
        sources.push(new BridgeSource('touch', this.id, 'touchSelf',
          this.getNumber('Self') ?? 0));
        sources.push(new BridgeSource('touch', this.id, 'touchOthers',
          this.getNumber('Others') ?? 0));
      }
    } else {
      // TPS Internal (legacy system)
      if (this.type === 'Orf') {
        sources.push(new BridgeSource('orf', this.id, 'penOthers',
          this.getNumber('Depth_In') ?? 0));
      }
      if (this.type === 'Pen') {
        sources.push(new BridgeSource('pen', this.id, 'penOthers',
          this.getNumber('Depth_In') ?? 0));
      }
    }

    return sources;
  }

  /**
   * Get status string for UI
   */
  getStatus() {
    const sources = this.getSources();
    const activeSources = sources.filter(s => s.value > 0);
    if (activeSources.length === 0) {
      return `${this.type}/${this.id}: idle`;
    }
    const details = activeSources.map(s => `${s.featureName}=${(s.value * 100).toFixed(0)}%`).join(', ');
    return `${this.type}/${this.id}: ${details}`;
  }
}

/**
 * GameDeviceManager - Tracks all game devices from OSC parameters
 */
class GameDeviceManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.lastUpdate = 0;
  }

  /**
   * Parse an OSC address and update the relevant game device
   * @param {string} address - OSC address (e.g., /avatar/parameters/OGB/Orf/MyOrf/TouchOthers)
   * @param {*} value - Parameter value
   */
  handleOscMessage(address, value) {
    // Remove /avatar/parameters/ prefix if present
    let paramPath = address;
    if (paramPath.startsWith('/avatar/parameters/')) {
      paramPath = paramPath.substring('/avatar/parameters/'.length);
    }

    const split = paramPath.split('/');
    
    // Parse OGB format: OGB/<type>/<id>/<contactType>
    if (split[0] === 'OGB' || split[0] === 'TPS_Internal') {
      const isTps = split[0] === 'TPS_Internal';
      const type = split[1];
      const id = split[2];
      const contactType = split.slice(3).join('/');

      if (!type || !id || !contactType) return;

      const key = `${isTps ? 'tps' : 'ogb'}__${type}__${id}`;
      let device = this.devices.get(key);

      if (!device) {
        device = new GameDevice(type, id, isTps);
        this.devices.set(key, device);
        this.emit('deviceAdded', device);
      }

      device.setValue(contactType, value);
      this.lastUpdate = Date.now();
      this.emit('update');
    }

    // Parse VFH format: VFH/Zone/<type>/<id>/<contactType>
    if (split[0] === 'VFH' && split[1] === 'Zone') {
      const type = split[2];
      const id = split[3];
      const contactType = split[4];

      if (!type || !id || !contactType) return;

      const key = `vfh__${type}__${id}`;
      let device = this.devices.get(key);

      if (!device) {
        device = new GameDevice(type, id, false);
        this.devices.set(key, device);
        this.emit('deviceAdded', device);
      }

      device.setValue(contactType, value);
      this.lastUpdate = Date.now();
      this.emit('update');
    }
  }

  /**
   * Get all devices
   */
  getDevices() {
    return Array.from(this.devices.values());
  }

  /**
   * Get all sources from all devices
   * Filters out TPS devices if OGB devices exist for same zone
   */
  getAllSources() {
    const allDevices = this.getDevices();
    const hasOGBDevice = allDevices.some(d => !d.isTps);

    const sources = [];
    for (const device of allDevices) {
      // Skip TPS if we have OGB (prefer OGB)
      if (hasOGBDevice && device.isTps) continue;
      sources.push(...device.getSources());
    }

    return sources;
  }

  /**
   * Clear all devices (on avatar change)
   */
  clear() {
    this.devices.clear();
    this.emit('cleared');
  }

  /**
   * Get status for all devices
   */
  getStatus() {
    return this.getDevices().map(d => d.getStatus());
  }
}

module.exports = { GameDevice, GameDeviceManager, BridgeSource, LengthDetector };
