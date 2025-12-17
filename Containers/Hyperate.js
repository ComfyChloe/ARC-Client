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
    this.reconnectDelay = 10000; // 10 seconds
    this.primaryTracker = this.config.primaryTracker || null;
    this.trackerNames = this.config.trackerNames || {};
    this.trackerStates = this.config.trackerStates || {}; // Store enabled/disabled state
    this.onStatusChange = null; // Callback for status changes
    this.onHeartRateUpdate = null; // Callback for heart rate updates
    debug.info('HypeRate addon initialized');
  }
  /**
   * Set callback for status changes (connected/disconnected)
   * @param {Function} callback - Called with status object
   */
  setStatusChangeCallback(callback) {
    this.onStatusChange = callback;
  }
  /**
   * Set callback for heart rate updates
   * @param {Function} callback - Called with { heartRate, deviceId }
   */
  setHeartRateCallback(callback) {
    this.onHeartRateUpdate = callback;
  }
  /**
   * Notify listeners of status change
   */
  notifyStatusChange() {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(this.getStatus());
    }
  }
  loadSecrets() {
    try {
      const secretsPath = path.join(__dirname, '..', 'secrets.json');
      if (fs.existsSync(secretsPath)) {
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        if (secrets.hyperate && secrets.hyperate.apiKey) {
          debug.info('HypeRate API key loaded from secrets.json');
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
      // Get all unique tracker IDs from both active trackers and saved config
      const savedTrackers = this.config.trackers || [];
      const activeTrackers = Array.from(this.trackers.keys());
      const allTrackers = [...new Set([...savedTrackers, ...activeTrackers])];
      const config = {
        primaryTracker: this.primaryTracker,
        trackers: allTrackers,
        trackerNames: this.trackerNames,
        trackerStates: this.trackerStates
      };
      
      // Update the hyperate section in the main config
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
    this.oscService = oscService; // OSC service is optional
    this.notifyStatusChange(); // Notify UI of state change immediately
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
    this.notifyStatusChange(); // Notify UI of state change immediately
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
        this.notifyStatusChange();
      });
      this.ws.on('close', () => {
        debug.info('HypeRate connection closed');
        this.cleanup();
        this.notifyStatusChange();
        if (this.enabled) {
          this.scheduleReconnect();
        }
      });
      this.ws.on('error', (error) => {
        debug.logError(`HypeRate connection error: ${error.message}`);
        this.cleanup();
        this.notifyStatusChange();
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
    }, 30000); // 30 seconds as recommended
  }
  loadSavedTrackers() {
    // Load trackers from saved config
    if (this.config.trackers && Array.isArray(this.config.trackers)) {
      debug.info(`Loading ${this.config.trackers.length} saved tracker(s): ${this.config.trackers.join(', ')}`);
      this.config.trackers.forEach(deviceId => {
        this.joinChannel(deviceId);
      });
    } else {
      debug.info('No saved trackers found in config');
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
    // Set as primary if no primary exists
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
    // If removing primary tracker, set new primary
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
      // Update tracker data
      if (this.trackers.has(deviceId)) {
        const tracker = this.trackers.get(deviceId);
        tracker.lastHeartRate = heartRate;
        tracker.lastUpdate = Date.now();
        this.trackers.set(deviceId, tracker);
      }
      // Only update lastHeartRate and send to VRChat if this is the primary tracker
      if (deviceId === this.primaryTracker) {
        this.lastHeartRate = heartRate;
        this.sendHeartRateToVRChat(heartRate);
        // Notify renderer of heart rate update
        if (typeof this.onHeartRateUpdate === 'function') {
          this.onHeartRateUpdate({ heartRate, deviceId });
        }
      }
    } catch (error) {
      debug.logError(`Error handling heart rate update: ${error.message}`);
    }
  }
  sendHeartRateToVRChat(heartRate) {
    if (!this.oscService) {
      // OSC service is optional - just log and continue
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
    // Check if tracker already exists in saved trackers or active trackers
    const savedTrackers = this.config.trackers || [];
    if (this.trackers.has(deviceId) || savedTrackers.includes(deviceId)) {
      debug.info(`Tracker ${deviceId} already exists`);
      return true;
    }
    // Save device name if provided
    if (deviceName && deviceName.trim()) {
      this.trackerNames[deviceId] = deviceName.trim();
    }
    // Add to saved trackers list
    if (!savedTrackers.includes(deviceId)) {
      this.config.trackers = [...savedTrackers, deviceId];
    }
    // Set as primary if no primary exists
    if (!this.primaryTracker) {
      this.primaryTracker = deviceId;
    }
    // Save configuration regardless of connection state
    this.saveConfig();
    // Try to join channel if connected, but don't fail if not connected
    if (this.enabled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.joinChannel(deviceId);
      debug.info(`Added and joined HypeRate tracker: ${deviceId}`);
    } else {
      debug.info(`Added HypeRate tracker: ${deviceId} (will connect when HypeRate starts)`);
    }
    return true;
  }
  removeTracker(deviceId) {
    // Check if tracker exists in either active trackers or saved trackers
    const savedTrackers = this.config.trackers || [];
    const existsInActive = this.trackers.has(deviceId);
    const existsInSaved = savedTrackers.includes(deviceId);
    if (!existsInActive && !existsInSaved) {
      debug.warn(`Tracker ${deviceId} not found`);
      return false;
    }
    // Remove from active trackers if connected
    if (existsInActive && this.enabled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.leaveChannel(deviceId);
    } else if (existsInActive) {
      // Remove from active trackers map even if not connected
      this.trackers.delete(deviceId);
    }
    // Remove from saved trackers list
    if (existsInSaved) {
      this.config.trackers = savedTrackers.filter(id => id !== deviceId);
    }
    // Remove device name
    delete this.trackerNames[deviceId];
    // If removing primary tracker, set new primary
    if (this.primaryTracker === deviceId) {
      const remainingTrackers = this.config.trackers || [];
      this.primaryTracker = remainingTrackers.length > 0 ? remainingTrackers[0] : null;
    }
    this.saveConfig();
    debug.info(`Removed HypeRate tracker: ${deviceId}`);
    return true;
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
    // Always return true since we no longer support enabling/disabling individual trackers
    return true;
  }
  setPrimaryTracker(deviceId) {
    const savedTrackers = this.config.trackers || [];
    if (!this.trackers.has(deviceId) && !savedTrackers.includes(deviceId)) {
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
    // Get all saved trackers (both active and inactive)
    const allTrackers = new Set([
      ...Array.from(this.trackers.keys()),
      ...(this.config.trackers || [])
    ]);
    for (const deviceId of allTrackers) {
      const trackerData = this.trackers.get(deviceId);
      // Tracker is only active if HypeRate is enabled AND tracker exists in the active trackers map
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