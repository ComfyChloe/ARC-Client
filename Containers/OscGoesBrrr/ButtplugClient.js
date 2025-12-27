/**
 * ButtplugClient - WebSocket client for Intiface Central
 * Implements Buttplug.io protocol v3 for haptic device control
 * 
 * Based on OSCGoesBrrr's Buttplug.ts implementation
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const debug = require('../../utils/debugger');

/**
 * Represents a single feature/actuator on a haptic device
 */
class DeviceFeature {
  constructor(fullFeatureId, deviceId, deviceName, type, bioDeviceIndex, bioSubIndex, actuatorType, parent) {
    this.id = fullFeatureId;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.type = type; // 'vibrate', 'linear', 'rotate'
    this.bioDeviceIndex = bioDeviceIndex;
    this.bioSubIndex = bioSubIndex;
    this.actuatorType = actuatorType;
    this.parent = parent;
    this.lastLevel = 0;
  }

  /**
   * Set the intensity level for this feature
   * @param {number} level - Intensity 0-1
   * @param {number} duration - Duration in ms (for linear devices)
   */
  setLevel(level, duration = 0) {
    if (!this.parent.wsReady()) return;

    if (this.type === 'linear') {
      this.parent.send({
        type: 'LinearCmd',
        DeviceIndex: this.bioDeviceIndex,
        Vectors: [{ Index: this.bioSubIndex, Duration: duration || 100, Position: level }]
      });
    } else if (this.type === 'rotate') {
      this.parent.send({
        type: 'RotateCmd',
        DeviceIndex: this.bioDeviceIndex,
        Rotations: [{ Index: this.bioSubIndex, Speed: Math.abs(level), Clockwise: level >= 0 }]
      });
    } else {
      // Vibrate/Scalar - skip Constrict actuators
      if (this.actuatorType !== 'Constrict') {
        this.parent.send({
          type: 'ScalarCmd',
          DeviceIndex: this.bioDeviceIndex,
          Scalars: [{ Index: this.bioSubIndex, Scalar: level, ActuatorType: this.actuatorType }]
        });
      }
    }
    this.lastLevel = level;
  }

  getStatus() {
    return `${this.deviceName} (${this.type}${this.bioSubIndex > 0 ? `-${this.bioSubIndex}` : ''}): ${(this.lastLevel * 100).toFixed(0)}%`;
  }
}

/**
 * ButtplugClient - Manages connection to Intiface Central
 */
class ButtplugClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.lastMessageId = 0;
    this.activeCallbacks = new Map();
    this.features = new Map(); // Map<featureId, DeviceFeature>
    this.usedDeviceIds = new Set();
    this.recentlySentCmds = 0;
    this.retryTimeout = null;
    this.connectionTimeout = null;
    this.scanInterval = null;
    this.logInterval = null;
    this.address = '127.0.0.1';
    this.port = 12345;
    this.useWss = false;
    this.serverName = null;
    this.serverVersion = null;
    this.isConnecting = false;
    this.lastError = null;
    debug.info('[Buttplug] Client initialized');
  }

  /**
   * Configure connection settings
   * @param {Object} config - { address, port, useWss }
   */
  setConfig(config) {
    if (config.address) this.address = config.address;
    if (config.port) this.port = config.port;
    if (config.useWss !== undefined) this.useWss = config.useWss;
    debug.info(`[Buttplug] Config updated: ${this.useWss ? 'wss' : 'ws'}://${this.address}:${this.port}`);
  }

  /**
   * Start the connection to Intiface
   */
  start() {
    this.retry();
    this.startScanning();
    // Log command frequency every 15 seconds
    this.logInterval = setInterval(() => {
      if (this.recentlySentCmds > 0) {
        debug.info(`[Buttplug] Sent ${this.recentlySentCmds} commands in the last 15 seconds`);
        this.recentlySentCmds = 0;
      }
    }, 15000);
  }

  /**
   * Stop the connection and cleanup
   */
  stop() {
    this.clearTimers();
    this.terminate();
    debug.info('[Buttplug] Client stopped');
  }

  clearTimers() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.logInterval) {
      clearInterval(this.logInterval);
      this.logInterval = null;
    }
  }

  /**
   * Attempt to connect to Intiface
   */
  retry() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    this.terminate();
    this.isConnecting = true;

    const protocol = this.useWss ? 'wss' : 'ws';
    const uri = `${protocol}://${this.address}:${this.port}`;
    debug.info(`[Buttplug] Opening connection to ${uri}`);

    let ws;
    try {
      ws = this.ws = new WebSocket(uri);
    } catch (e) {
      debug.error(`[Buttplug] Init exception: ${e.message}`);
      this.lastError = e.message;
      this.isConnecting = false;
      this.delayRetry();
      return;
    }

    ws.on('message', (data) => this.onReceive(data));

    ws.on('error', (e) => {
      debug.error(`[Buttplug] WebSocket error: ${e.message}`);
      this.lastError = e.message;
      this.delayRetry();
    });

    ws.on('close', () => {
      for (const callback of this.activeCallbacks.values()) {
        callback(null, new Error('Connection closed'));
      }
      this.activeCallbacks.clear();
      this.clearDevices();
      debug.info('[Buttplug] Connection closed');
      this.isConnecting = false;
      this.emit('disconnected');
      this.delayRetry();
    });

    ws.on('open', async () => {
      this.clearDevices();
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this.isConnecting = false;
      this.lastError = null;
      debug.info('[Buttplug] Connected to Intiface');

      try {
        // Handshake
        const serverInfo = await this.send({
          type: 'RequestServerInfo',
          ClientName: 'ARC-Client',
          MessageVersion: 3
        });
        if (serverInfo && serverInfo.type === 'ServerInfo') {
          this.serverName = serverInfo.ServerName;
          this.serverVersion = serverInfo.ServerVersion || serverInfo.MajorVersion;
          debug.info(`[Buttplug] Server: ${this.serverName} v${this.serverVersion}`);
        }

        // Request existing devices
        await this.send({ type: 'RequestDeviceList' });
        this.emit('connected');
      } catch (e) {
        debug.error(`[Buttplug] Handshake failed: ${e.message}`);
        this.lastError = e.message;
      }
    });

    // Connection timeout
    this.connectionTimeout = setTimeout(() => {
      debug.warn('[Buttplug] Connection timed out');
      this.lastError = 'Connection timed out';
      this.isConnecting = false;
      this.delayRetry();
    }, 5000);
  }

  /**
   * Handle received WebSocket message
   */
  onReceive(data) {
    try {
      const jsonStr = data.toString();
      const packets = JSON.parse(jsonStr);

      for (const packet of packets) {
        for (const [type, body] of Object.entries(packet)) {
          this.handlePacket({ type, ...body });
        }
      }
    } catch (e) {
      debug.error(`[Buttplug] Parse error: ${e.message}`);
    }
  }

  /**
   * Handle individual Buttplug message
   */
  handlePacket(params) {
    const type = params.type;

    // Log non-Ok messages
    if (type !== 'Ok') {
      debug.info(`[Buttplug] <- ${type}: ${JSON.stringify(params)}`);
    }

    if (type === 'DeviceRemoved') {
      this.removeDevice(params.DeviceIndex);
    } else if (type === 'DeviceAdded') {
      this.addDevice(params);
    } else if (type === 'DeviceList') {
      for (const d of params.Devices || []) {
        this.addDevice(d);
      }
    } else if (type === 'Error') {
      debug.error(`[Buttplug] Server error: ${params.ErrorMessage}`);
      this.lastError = params.ErrorMessage;
    }

    // Handle callbacks
    const id = params.Id;
    if (id && this.activeCallbacks.has(id)) {
      const cb = this.activeCallbacks.get(id);
      this.activeCallbacks.delete(id);
      cb(params);
    }
  }

  /**
   * Send a Buttplug message
   * @param {Object} message - Message object with type property
   * @returns {Promise<Object>} Response message
   */
  async send(message) {
    const { type, ...params } = message;
    if (!this.wsReady() || !this.ws) return null;

    const id = ++this.lastMessageId;
    if (this.lastMessageId > 1000000000) this.lastMessageId = 1;

    const newArgs = { Id: id, ...params };

    // Track high-frequency commands
    if (['ScalarCmd', 'LinearCmd', 'RotateCmd', 'FleshlightLaunchFW12Cmd'].includes(type)) {
      this.recentlySentCmds++;
    } else if (['StartScanning', 'StopScanning'].includes(type)) {
      // Debug level only for scanning commands
      debug.debug(`[Buttplug] -> ${type}: ${JSON.stringify(newArgs)}`);
    } else {
      debug.info(`[Buttplug] -> ${type}: ${JSON.stringify(newArgs)}`);
    }

    const json = [{ [type]: newArgs }];
    this.ws.send(JSON.stringify(json));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.activeCallbacks.delete(id);
        reject(new Error('Timeout after 5000ms'));
      }, 5000);

      this.activeCallbacks.set(id, (data, error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(data);
      });
    });
  }

  /**
   * Check if WebSocket is ready
   */
  wsReady() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Terminate the WebSocket connection
   */
  terminate() {
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
  }

  /**
   * Schedule a retry after delay
   */
  delayRetry() {
    if (this.retryTimeout) return;
    this.terminate();
    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.retry();
    }, 3000);
  }

  /**
   * Start continuous device scanning
   */
  startScanning() {
    if (this.scanInterval) return;

    const doScan = async () => {
      if (!this.wsReady()) return;
      try {
        await this.send({ type: 'StartScanning' });
        await new Promise(r => setTimeout(r, 10000));
        if (this.wsReady()) {
          await this.send({ type: 'StopScanning' });
        }
      } catch (e) {
        debug.error(`[Buttplug] Scan error: ${e.message}`);
      }
    };

    // Initial scan
    doScan();

    // Scan every 15 seconds
    this.scanInterval = setInterval(doScan, 15000);
  }

  /**
   * Clear all devices
   */
  clearDevices() {
    for (const feature of this.features.values()) {
      this.emit('removeFeature', feature);
    }
    this.usedDeviceIds.clear();
    this.features.clear();
    this.emit('devicesChanged');
  }

  /**
   * Remove a device by index
   */
  removeDevice(bioDeviceIndex) {
    const removing = [];
    for (const [id, feature] of this.features.entries()) {
      if (feature.bioDeviceIndex === bioDeviceIndex) {
        removing.push(id);
      }
    }
    for (const id of removing) {
      const feature = this.features.get(id);
      this.emit('removeFeature', feature);
      this.usedDeviceIds.delete(feature.deviceId);
      this.features.delete(id);
    }
    if (removing.length > 0) {
      this.emit('devicesChanged');
    }
  }

  /**
   * Add a device from Buttplug message
   */
  addDevice(d) {
    const name = d.DeviceName;
    const baseId = name.toLowerCase().replace(/\s+/g, '');

    // Find unique ID
    let id;
    for (let i = 0; ; i++) {
      id = baseId + (i === 0 ? '' : i);
      if (!this.usedDeviceIds.has(id)) break;
    }
    this.usedDeviceIds.add(id);

    let featureNum = 0;

    // Add scalar/vibrate features
    const scalarCmds = d.DeviceMessages?.ScalarCmd || [];
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
      );
      this.features.set(feature.id, feature);
      this.emit('addFeature', feature);
    }

    // Add linear features
    const linearCmds = d.DeviceMessages?.LinearCmd || [];
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
      );
      this.features.set(feature.id, feature);
      this.emit('addFeature', feature);
    }

    // Add rotate features
    const rotateCmds = d.DeviceMessages?.RotateCmd || [];
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
      );
      this.features.set(feature.id, feature);
      this.emit('addFeature', feature);
    }

    debug.info(`[Buttplug] Device added: ${name} with ${featureNum} features`);
    this.emit('devicesChanged');
  }

  /**
   * Get all device features
   */
  getFeatures() {
    return Array.from(this.features.values());
  }

  /**
   * Get unique devices (grouped by deviceId)
   */
  getDevices() {
    const devices = new Map();
    for (const feature of this.features.values()) {
      if (!devices.has(feature.deviceId)) {
        devices.set(feature.deviceId, {
          id: feature.deviceId,
          name: feature.deviceName,
          features: []
        });
      }
      devices.get(feature.deviceId).features.push({
        id: feature.id,
        type: feature.type,
        actuatorType: feature.actuatorType,
        lastLevel: feature.lastLevel
      });
    }
    return Array.from(devices.values());
  }

  /**
   * Get connection status
   */
  getStatus() {
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
    };
  }
}

module.exports = { ButtplugClient, DeviceFeature };
