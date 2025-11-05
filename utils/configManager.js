const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const debug = require('./debugger');
class ConfigManager {
  constructor() {
    this.configFile = path.join(app.getPath('userData'), 'config.json');
    this.defaultConfig = {
      legacyOscPort: 9001,
      targetOscPort: 9000,
      targetOscAddress: '127.0.0.1',
      additionalOscConnections: [],
      websocketServerUrl: 'wss://avatar.comfychloe.uk:48255',
      logLevel: 'info',
      appSettings: {
        enableWebSocketForwarding: false,
        hyperateAutostart: false,
        oscleashAutostart: false,
        theme: 'light',
        lastUsername: '',
        savedPassword: ''
      },
      oscQueryUnsubscriptions: [],
      windowState: {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined,
        maximized: false
      },
      // HypeRate configuration
      hyperate: {
        primaryTracker: null,
        trackers: [],
        trackerNames: {},
        trackerStates: {}
      },
      // OSCLeash configuration
      oscleash: {
        RunDeadzone: 0.70,
        WalkDeadzone: 0.15,
        StrengthMultiplier: 1.2,
        UpDownCompensation: 1.0,
        UpDownDeadzone: 0.5,
        ActiveDelay: 20,
        InactiveDelay: 500,
        Logging: false,
        PhysboneParameters: ["Leash"],
        DirectionalParameters: {
          Z_Positive_Param: "Leash_Z+",
          Z_Negative_Param: "Leash_Z-",
          X_Positive_Param: "Leash_X+",
          X_Negative_Param: "Leash_X-",
          Y_Positive_Param: "Leash_Y+",
          Y_Negative_Param: "Leash_Y-"
        }
      },
      // Version for future migration support
      configVersion: 1
    };
    this.config = { ...this.defaultConfig };
    debug.info(`Config file path: ${this.configFile}`);
    this.loadConfig();
  }
  loadConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        const loadedConfig = JSON.parse(data);
        this.config = { ...this.defaultConfig, ...loadedConfig };
        debug.info(`Config loaded from ${this.configFile}`);
        return this.config;
      } else {
        debug.info('No config file found, using default config');
        this.saveConfig();
        return this.config;
      }
    } catch (error) {
      debug.logError(`Error loading config: ${error.message}`);
      return this.defaultConfig;
    }
  }
  saveConfig() {
    try {
      const userDataDir = path.dirname(this.configFile);
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
        debug.info(`Created directory: ${userDataDir}`);
      }
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf8');
      debug.info(`Config saved to ${this.configFile}`);
      return true;
    } catch (error) {
      debug.logError(`Error saving config: ${error.message}`);
      return false;
    }
  }
  getConfig() {
    return { ...this.config };
  }
  updateConfig(newConfig) {
    // Merge new config with existing config
    this.config = { ...this.config, ...newConfig };
    // Save the updated config
    return this.saveConfig();
  }
  // Get specific config sections
  getServerConfig() {
    return {
      legacyOscPort: this.config.legacyOscPort || 9001,
      targetOscPort: this.config.targetOscPort,
      targetOscAddress: this.config.targetOscAddress,
      additionalOscConnections: this.config.additionalOscConnections || [],
      websocketServerUrl: this.config.websocketServerUrl,
      oscQueryUnsubscriptions: this.config.oscQueryUnsubscriptions || [],
      appSettings: this.config.appSettings || {}
    };
  }
  getAppSettings() {
    return {
      logLevel: this.config.logLevel || 'info',
      enableWebSocketForwarding: this.config.appSettings?.enableWebSocketForwarding || false,
      hyperateAutostart: this.config.appSettings?.hyperateAutostart || false,
      oscleashAutostart: this.config.appSettings?.oscleashAutostart || false,
      theme: this.config.appSettings?.theme || 'light',
      lastUsername: this.config.appSettings?.lastUsername || '',
      savedPassword: this.config.appSettings?.savedPassword || ''
    };
  }
  updateAppSettings(settings) {
    //debug.info(`Updating app settings with: ${JSON.stringify(settings)}`); // commented out as it shows userpassword in console.
    this.config.logLevel = settings.logLevel ?? this.config.logLevel;
    if (!this.config.appSettings) {
      this.config.appSettings = {};
    }
    // Update WebSocket forwarding (transmit) setting
    if (settings.enableWebSocketForwarding !== undefined) {
      this.config.appSettings.enableWebSocketForwarding = settings.enableWebSocketForwarding;
    }
    // Update HypeRate autostart setting
    if (settings.hyperateAutostart !== undefined) {
      this.config.appSettings.hyperateAutostart = settings.hyperateAutostart;
    }
    // Update OSC Leash autostart setting
    if (settings.oscleashAutostart !== undefined) {
      this.config.appSettings.oscleashAutostart = settings.oscleashAutostart;
    }
    // Update theme setting
    if (settings.theme !== undefined) {
      this.config.appSettings.theme = settings.theme;
    }
    if (settings.lastUsername !== undefined) {
      this.config.appSettings.lastUsername = settings.lastUsername;
    }
    
    if (settings.savedPassword !== undefined) {
      this.config.appSettings.savedPassword = settings.savedPassword;
    }
    debug.info(`Final app settings`);
    const saveResult = this.saveConfig();
    debug.info(`Config save result: ${saveResult}`);
    return saveResult;
  }
  // Window state management
  getWindowState() {
    return {
      width: this.config.windowState?.width || 1200,
      height: this.config.windowState?.height || 800,
      x: this.config.windowState?.x,
      y: this.config.windowState?.y,
      maximized: this.config.windowState?.maximized || false
    };
  }
  updateWindowState(windowState) {
    if (!this.config.windowState) {
      this.config.windowState = {};
    }
    this.config.windowState = {
      ...this.config.windowState,
      ...windowState
    };
    debug.info(`Window state updated: ${JSON.stringify(this.config.windowState)}`);
    return this.saveConfig();
  }
  // Password management methods
  getSavedPassword() {
    return this.config.appSettings?.savedPassword || '';
  }
  
  setSavedPassword(password) {
    if (!this.config.appSettings) {
      this.config.appSettings = {};
    }
    this.config.appSettings.savedPassword = password || '';
    debug.info(`Saved password ${password ? 'updated' : 'cleared'} in configuration`);
    return this.saveConfig();
  }
  
  // HypeRate configuration methods
  getHyperateConfig() {
    if (!this.config.hyperate) {
      this.config.hyperate = {
        primaryTracker: null,
        trackers: [],
        trackerNames: {},
        trackerStates: {}
      };
    }
    return { ...this.config.hyperate };
  }
  
  updateHyperateConfig(hyperateConfig) {
    if (!this.config.hyperate) {
      this.config.hyperate = {};
    }
    this.config.hyperate = {
      ...this.config.hyperate,
      ...hyperateConfig
    };
    debug.info('HypeRate config updated in configuration manager');
    return this.saveConfig();
  }

  // OSCLeash configuration methods
  getOSCLeashConfig() {
    if (!this.config.oscleash) {
      this.config.oscleash = {
        RunDeadzone: 0.70,
        WalkDeadzone: 0.15,
        StrengthMultiplier: 1.2,
        UpDownCompensation: 1.0,
        UpDownDeadzone: 0.5,
        ActiveDelay: 20,
        InactiveDelay: 500,
        Logging: false,
        PhysboneParameters: ["Leash"],
        DirectionalParameters: {
          Z_Positive_Param: "Leash_Z+",
          Z_Negative_Param: "Leash_Z-",
          X_Positive_Param: "Leash_X+",
          X_Negative_Param: "Leash_X-",
          Y_Positive_Param: "Leash_Y+",
          Y_Negative_Param: "Leash_Y-"
        }
      };
    }
    return { ...this.config.oscleash };
  }

  updateOSCLeashConfig(oscLeashConfig) {
    if (!this.config.oscleash) {
      this.config.oscleash = {};
    }
    this.config.oscleash = {
      ...this.config.oscleash,
      ...oscLeashConfig
    };
    debug.info('OSCLeash config updated in configuration manager');
    return this.saveConfig();
  }
}
module.exports = new ConfigManager();