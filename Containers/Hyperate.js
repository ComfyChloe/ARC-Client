const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const debug = require('../utils/debugger');
const configManager = require('../utils/configManager');
class HyperateAddon {
  constructor() {
    this.enabled = false;
    this.ws = null;
    this.heartbeatInterval = null;
    this.reconnectTimeout = null;
    this.trackers = new Map();
    this.primaryTracker = null;
    this.secrets = this.loadSecrets();
    this.config = this.loadConfig();
    this.lastHeartRate = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 10000;
    this.primaryTracker = this.config.primaryTracker || null;
    this.trackerNames = this.config.trackerNames || {};
    this.trackerStates = this.config.trackerStates || {};
    debug.info('HypeRate addon initialized');
  }
  loadSecrets() {
    try {
      const secretsPath = path.join(__dirname, '..', 'secrets.json');
      if (fs.existsSync(secretsPath)) {
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        if (secrets.hyperate && secrets.hyperate.apiKey) {
          return secrets;
        }
      }
      debug.warn('HypeRate API key not found in secrets.json');
      return null;
    } catch (error) {
      debug.logError(`Failed to load HypeRate secrets: ${error.message}`);
      return null;
    }
  }
  loadConfig() {
    try {
      const hyperateConfig = configManager.getHyperateConfig();
      if (hyperateConfig) {
        debug.info('HypeRate config loaded from config manager');
        return hyperateConfig;
      }
    } catch (error) {
      debug.logError(`Failed to load HypeRate config: ${error.message}`);
    }
    return {
      enabled: false,
      primaryTracker: null,
      trackers: [],
      trackerNames: {},
      trackerStates: {}
    };
  }
  saveConfig() {
    try {
      const config = {
        primaryTracker: this.primaryTracker,
        trackers: Array.from(this.trackers.keys()),
        trackerNames: this.trackerNames,
        trackerStates: this.trackerStates
      };
      configManager.updateHyperateConfig(config);
      debug.info('HypeRate config saved via config manager');
    } catch (error) {
      debug.logError(`Failed to save HypeRate config: ${error.message}`);
    }
  }
  isEnabled() {
    return this.enabled;
  }
  start(oscService = null) {
    if (!this.secrets || !this.secrets.hyperate || !this.secrets.hyperate.apiKey) {
      debug.logError('Cannot start HypeRate: No API key found in secrets.json');
      return false;
    }
    if (this.enabled) {
      debug.warn('HypeRate addon already running');
      return true;
    }
    this.enabled = true;
    this.oscService = oscService;
    this.connect();
    debug.info('HypeRate addon started');
    return true;
  }
  stop() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    this.disconnect();
    debug.info('HypeRate addon stopped');
  }
  connect() {
    if (!this.secrets || !this.secrets.hyperate || !this.secrets.hyperate.apiKey) {
      debug.logError('Cannot connect to HypeRate: No API key');
      return;
    }
    const apiKey = this.secrets.hyperate.apiKey;
    const apiUrl = `wss://app.hyperate.io/socket/websocket?token=${apiKey}`;
    try {
      this.ws = new WebSocket(apiUrl);
      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        debug.info('Connected to HypeRate WebSocket');
        this.setupHeartbeat();
        this.loadSavedTrackers();
      });
      this.ws.on('close', () => {
        debug.info('HypeRate connection closed');
        this.cleanup();
        if (this.enabled) {
          this.scheduleReconnect();
        }
      });
      this.ws.on('error', (error) => {
        debug.logError(`HypeRate connection error: ${error.message}`);
        this.cleanup();
        if (this.enabled) {
          this.scheduleReconnect();
        }
      });
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          debug.logError(`HypeRate message parse error: ${error.message}`);
        }
      });
      debug.info('Connecting to HypeRate API...');
    } catch (error) {
      debug.logError(`Failed to create HypeRate WebSocket: ${error.message}`);
      this.scheduleReconnect();
    }
  }
  disconnect() {
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
  scheduleReconnect() {
    if (!this.enabled || this.reconnectTimeout) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      debug.logError(`HypeRate: Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping addon.`);
      this.stop();
      return;
    }
    this.reconnectAttempts++;
    debug.info(`HypeRate: Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay / 1000} seconds`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.enabled) {
        this.connect();
      }
    }, this.reconnectDelay);
  }
  setupHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          topic: "phoenix",
          event: "heartbeat",
          payload: {},
          ref: 0
        }));
      }
    }, 30000);
  }
  loadSavedTrackers() {
    if (this.config.trackers && Array.isArray(this.config.trackers)) {
      this.config.trackers.forEach(deviceId => {
        this.joinChannel(deviceId);
      });
    }
  }
  joinChannel(deviceId) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      debug.warn(`Cannot join HypeRate channel ${deviceId}: Not connected`);
      return false;
    }
    const message = {
      topic: `hr:${deviceId}`,
      event: "phx_join",
      payload: {},
      ref: 0
    };
    this.ws.send(JSON.stringify(message));
    this.trackers.set(deviceId, { joinedAt: Date.now(), lastHeartRate: 0 });
    if (!this.primaryTracker) {
      this.primaryTracker = deviceId;
      this.saveConfig();
    }
    debug.info(`Joined HypeRate channel: ${deviceId}`);
    return true;
  }
  leaveChannel(deviceId) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    const message = {
      topic: `hr:${deviceId}`,
      event: "phx_leave",
      payload: {},
      ref: 0
    };
    this.ws.send(JSON.stringify(message));
    this.trackers.delete(deviceId);
    if (this.primaryTracker === deviceId) {
      const remainingTrackers = Array.from(this.trackers.keys());
      this.primaryTracker = remainingTrackers.length > 0 ? remainingTrackers[0] : null;
      this.saveConfig();
    }
    debug.info(`Left HypeRate channel: ${deviceId}`);
    return true;
  }
  handleMessage(data) {
    if (data.event === "hr_update") {
      this.handleHeartRateUpdate(data);
    }
  }
  handleHeartRateUpdate(data) {
    try {
      const deviceId = data.topic.split(":")[1];
      const heartRate = data.payload.hr;
      if (!deviceId || typeof heartRate !== 'number') {
        debug.warn('Invalid heart rate data received');
        return;
      }
      if (this.trackers.has(deviceId)) {
        const tracker = this.trackers.get(deviceId);
        tracker.lastHeartRate = heartRate;
        tracker.lastUpdate = Date.now();
        this.trackers.set(deviceId, tracker);
      }
      if (deviceId === this.primaryTracker) {
        this.lastHeartRate = heartRate;
        this.sendHeartRateToVRChat(heartRate);
      }
    } catch (error) {
      debug.logError(`Error handling heart rate update: ${error.message}`);
    }
  }
  sendHeartRateToVRChat(heartRate) {
    if (!this.oscService) {
      debug.info(`HypeRate: OSC service not available, heart rate: ${heartRate}`);
      return;
    }
    try {
      const address = '/avatar/parameters/ARCOSC/Heartrate/Value';
      const success = this.oscService.sendMessage(address, heartRate, 'f');
      if (success) {
      } else {
        debug.warn(`Failed to send heart rate to VRChat: ${heartRate}`);
      }
    } catch (error) {
      debug.logError(`Error sending heart rate to VRChat: ${error.message}`);
    }
  }
  addTracker(deviceId, deviceName = null) {
    if (!deviceId || typeof deviceId !== 'string') {
      debug.warn('Invalid device ID provided to addTracker');
      return false;
    }
    if (this.trackers.has(deviceId)) {
      debug.info(`Tracker ${deviceId} already exists`);
      return true;
    }
    const success = this.joinChannel(deviceId);
    if (success) {
      if (deviceName && deviceName.trim()) {
        this.trackerNames[deviceId] = deviceName.trim();
      }
      
      this.saveConfig();
    }
    return success;
  }
  removeTracker(deviceId) {
    if (!this.trackers.has(deviceId)) {
      debug.warn(`Tracker ${deviceId} not found`);
      return false;
    }
    const success = this.leaveChannel(deviceId);
    if (success) {
      delete this.trackerNames[deviceId];
      this.saveConfig();
    }
    return success;
  }
  updateTrackerName(deviceId, newName) {
    if (!this.trackers.has(deviceId) && !this.config.trackers.includes(deviceId)) {
      debug.warn(`Cannot update name: ${deviceId} not found`);
      return false;
    }
    if (newName && newName.trim()) {
      this.trackerNames[deviceId] = newName.trim();
    } else {
      delete this.trackerNames[deviceId];
    }
    this.saveConfig();
    debug.info(`Updated tracker name for ${deviceId}: ${newName}`);
    return true;
  }
  updateTrackerState(deviceId, enabled) {
    return true;
  }
  setPrimaryTracker(deviceId) {
    if (!this.trackers.has(deviceId)) {
      debug.warn(`Cannot set primary tracker: ${deviceId} not found`);
      return false;
    }
    this.primaryTracker = deviceId;
    this.saveConfig();
    debug.info(`Set primary tracker to: ${deviceId}`);
    return true;
  }
  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.ws && this.ws.readyState === WebSocket.OPEN,
      trackers: Array.from(this.trackers.keys()),
      primaryTracker: this.primaryTracker,
      lastHeartRate: this.lastHeartRate,
      reconnectAttempts: this.reconnectAttempts,
      hasApiKey: !!(this.secrets && this.secrets.hyperate && this.secrets.hyperate.apiKey)
    };
  }
  getTrackers() {
    const trackerList = [];
    const allTrackers = new Set([
      ...Array.from(this.trackers.keys()),
      ...(this.config.trackers || [])
    ]);
    for (const deviceId of allTrackers) {
      const trackerData = this.trackers.get(deviceId);
      const isActive = this.enabled && !!trackerData;
      trackerList.push({
        deviceId,
        name: this.trackerNames[deviceId] || null,
        isPrimary: deviceId === this.primaryTracker,
        isActive: isActive,
        lastHeartRate: isActive ? (trackerData.lastHeartRate || 0) : 0,
        lastUpdate: isActive ? (trackerData.lastUpdate || trackerData.joinedAt) : null,
        joinedAt: isActive ? trackerData.joinedAt : null
      });
    }
    return trackerList;
  }
}
module.exports = HyperateAddon;