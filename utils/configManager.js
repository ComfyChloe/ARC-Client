const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const debug = require('./debugger');
class ConfigManager {
  constructor() {
    this.configFile = path.join(app.getPath('userData'), 'config.json');
    this.defaultConfig = {
      localOscPort: 9001,
      targetOscPort: 9000,
      targetOscAddress: '127.0.0.1',
      additionalOscConnections: [],
      websocketServerUrl: 'wss://avatar.comfychloe.uk:48255',
      autoConnect: false,
      logLevel: 'info',
      parameterBlacklist: [],
      appSettings: {
        enableOscOnStartup: false,
        enableWebSocketForwarding: false,
        enableOscLogging: true,
        theme: 'light',
        lastUsername: ''
      },
      windowState: {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined,
        maximized: false
      },
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
    this.config = { ...this.config, ...newConfig };
    return this.saveConfig();
  }
  getServerConfig() {
    return {
      localOscPort: this.config.localOscPort,
      targetOscPort: this.config.targetOscPort,
      targetOscAddress: this.config.targetOscAddress,
      additionalOscConnections: this.config.additionalOscConnections || [],
      websocketServerUrl: this.config.websocketServerUrl,
      appSettings: this.config.appSettings || {}
    };
  }
  getAppSettings() {
    return {
      autoConnect: this.config.autoConnect || false,
      logLevel: this.config.logLevel || 'info',
      enableOscOnStartup: this.config.appSettings?.enableOscOnStartup || false,
      enableWebSocketForwarding: this.config.appSettings?.enableWebSocketForwarding || false,
      theme: this.config.appSettings?.theme || 'light',
      lastUsername: this.config.appSettings?.lastUsername || ''
    };
  }
  updateAppSettings(settings) {
    debug.info(`Updating app settings with: ${JSON.stringify(settings)}`);
    this.config.autoConnect = settings.autoConnect ?? this.config.autoConnect;
    this.config.logLevel = settings.logLevel ?? this.config.logLevel;
    if (!this.config.appSettings) {
      this.config.appSettings = {};
    }
    const oldOscStartup = this.config.appSettings.enableOscOnStartup;
    this.config.appSettings.enableOscOnStartup = 
      settings.enableOscOnStartup ?? this.config.appSettings.enableOscOnStartup;
    if (settings.enableWebSocketForwarding !== undefined) {
      this.config.appSettings.enableWebSocketForwarding = settings.enableWebSocketForwarding;
    }
    if (settings.theme !== undefined) {
      this.config.appSettings.theme = settings.theme;
    }
    if (settings.lastUsername !== undefined) {
      this.config.appSettings.lastUsername = settings.lastUsername;
    }
    if (oldOscStartup !== this.config.appSettings.enableOscOnStartup) {
      debug.info(`OSC startup setting changed: ${oldOscStartup} -> ${this.config.appSettings.enableOscOnStartup}`);
    }
    debug.info(`Final app settings: ${JSON.stringify(this.getAppSettings())}`);
    const saveResult = this.saveConfig();
    debug.info(`Config save result: ${saveResult}`);
    return saveResult;
  }
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
}
module.exports = new ConfigManager();