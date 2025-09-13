const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
// Set userdata path and ensure it exists
const userDataPath = path.join(process.cwd(), 'userdata');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}
app.setPath('userData', userDataPath);
const osc = require('osc');
const debug = require('./utils/debugger');
const OscService = require('./utils/oscService');
const parameterBlacklist = require('./utils/parameterBlacklist');
const HyperateAddon = require('./Containers/Hyperate');
// Logger will be loaded after app is ready
let logger;
const WebSocketManager = require('./utils/websocketManager');
const configManager = require('./utils/configManager');
let mainWindow;
let oscServer;
let oscClient;
let oscService;
let oscEnabled = false;
let wsManager;
let serverConfig = configManager.getServerConfig();
let hyperateAddon;
// On startup, if websocketServerUrl is a custom/dev URL, reset it to default (live)
if (serverConfig.websocketServerUrl && serverConfig.websocketServerUrl.includes('127.0.0.1')) {
  serverConfig.websocketServerUrl = 'wss://avatar.comfychloe.uk:48255';
  debug.info('Custom WebSocket URL detected on startup, reset to live server');
}
let isShuttingDown = false;
let hasShownCriticalError = false;
function createWindow() {
  const windowState = configManager.getWindowState();
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'ARC-OSC Client',
    show: false // Start hidden so we can control when it appears
  })
  // Restore maximized state if it was maximized
  if (windowState.maximized) {
    mainWindow.maximize();
  }
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.setMenuBarVisibility(false);
  if (process.argv.includes('--dev')) {
    mainWindow.loadFile('renderer/index.html');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('renderer/index.html');
  }
  // Save window state on resize and move with throttling to prevent excessive saves
  let saveWindowStateTimeout;
  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Clear any existing timeout
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
    }
    // Set a new timeout to save after 100ms delay
    saveWindowStateTimeout = setTimeout(() => {
      const bounds = mainWindow.getBounds();
      const isMaximized = mainWindow.isMaximized();
      configManager.updateWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: isMaximized
      });
      saveWindowStateTimeout = undefined;
    }, 100);
  };
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);
  mainWindow.on('close', () => {
    // Save final window state immediately when closing
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
      saveWindowStateTimeout = undefined;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      const isMaximized = mainWindow.isMaximized();
      configManager.updateWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: isMaximized
      });
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.once('did-finish-load', () => {
    // Send the current app settings to the renderer
    const appSettings = configManager.getAppSettings();
    sendToRenderer('app-settings', appSettings);
    if (oscEnabled && oscService) {
      sendToRenderer('osc-server-status', { 
        status: 'connected', 
        port: serverConfig.localOscPort 
      });
    } else {
      sendToRenderer('osc-server-status', { 
        status: oscEnabled ? 'disconnected' : 'disabled', 
        port: serverConfig.localOscPort 
      });
    }
    sendToRenderer('websocket-status', {
      status: 'disconnected'
    });
  });
  mainWindow.webContents.on('crashed', () => {
    if (hasShownCriticalError) {
      return;
    }
    hasShownCriticalError = true;
    cleanup('renderer-crashed');
    dialog.showErrorBox('Application Error', 'The application has encountered an error and will now close.');
    process.exit(1);
  });
  mainWindow.on('unresponsive', () => {
    if (hasShownCriticalError) {
      return;
    }
    hasShownCriticalError = true;
    cleanup('renderer-unresponsive');
    dialog.showErrorBox('Application Unresponsive', 'The application is not responding and will now close.');
    process.exit(1);
  });
}
function initWebSocket() {
  if (!wsManager) {
    wsManager = new WebSocketManager();
    wsManager.setConfig({
      serverUrl: serverConfig.websocketServerUrl
    });
    wsManager.on('connection-status', (data) => {
      sendToRenderer('websocket-status', data);
      if (data.status === 'connected') {
        debug.logWebSocketConnection('Connected to WebSocket server');
        debug.info(`WebSocket connection established, isConnected: ${wsManager.isConnected}`);
      } else if (data.status === 'disconnected') {
        debug.logWebSocketConnection('Disconnected from WebSocket server');
      }
    });
    wsManager.on('connection-error', (data) => {
      sendToRenderer('websocket-error', data);
      debug.logWebSocketConnection(`Connection error: ${data.error} (Attempt ${data.attempts}/${data.maxAttempts})`);
    });
    wsManager.on('authenticated', (data) => {
      sendToRenderer('websocket-authenticated', data);
      debug.logWebSocketConnection(`Authenticated as ${data.username} in room ${data.room}`);
      // Always ready to forward when connected
      debug.logWebSocketForwarding(`Ready to forward OSC data to server`);
    });
    wsManager.on('osc-data', (data) => {
      sendToRenderer('websocket-osc-data', data);
      // debug.logWebSocketConnection(`Received OSC data: ${data.address} = ${data.value}`);
      // Check if WebSocket forwarding is enabled before processing data from server
      const wsForwardingEnabled = serverConfig.appSettings?.enableWebSocketForwarding || false;
      if (!wsForwardingEnabled) {
        debug.logWebSocketForwarding(`WebSocket forwarding disabled - ignoring incoming OSC data: ${data.address} = ${data.value}`);
        return;
      }
      // Forward received OSC data to VRChat via normal OSC
      if (oscService && oscService.getStatus().isListening) {
        try {
          // Determine the type based on the value
          let type = 'f'; // default to float
          if (typeof data.value === 'boolean') {
            type = 'bool';
          } else if (typeof data.value === 'string') {
            type = 's';
          } else if (Number.isInteger(data.value)) {
            type = 'i';
          }
          const success = oscService.sendMessage(data.address, data.value, type);
          if (success) {
            // debug.logWebSocketConnection(`Forwarded WebSocket OSC to VRChat: ${data.address} = ${data.value} (${type})`);
          }
        } catch (error) {
          debug.error(`Failed to forward WebSocket OSC to VRChat: ${error.message}`);
        }
      } else {
        debug.logWebSocketConnection(`Cannot forward OSC to VRChat - OSC service not running`);
      }
    });
    wsManager.on('avatar-change', (data) => {
      console.log('Main process received avatar-change:', data);
      sendToRenderer('websocket-avatar-change', data);
      const displayName = data.name ? `${data.name} (${data.id})` : data.id;
      debug.logWebSocketConnection(`Avatar changed: ${displayName} for user ${data.username || 'Unknown'}`);
    });
    wsManager.on('parameter-update', (data) => {
      sendToRenderer('websocket-parameter-update', data);
    });
    wsManager.on('server-message', (data) => {
      sendToRenderer('websocket-server-message', data);
    });
  }
}
// OSC message rate limiting for debug logging
let oscMessageCounter = 0;
function initOscServer() {
  if (oscService) {
    debug.info('Stopping existing OSC service before reinitialization...');
    oscService.stop();
    oscService = null;
    global.oscService = null;
  }
  if (!oscEnabled) {
    debug.info('OSC is disabled, not initializing server');
    sendToRenderer('osc-server-status', { 
      status: 'disabled', 
      port: serverConfig.localOscPort 
    });
    return;
  }
  debug.info(`Initializing OSC service with port ${serverConfig.localOscPort}`);
  oscService = new OscService();
  oscService.on('ready', (config) => {
    debug.logOscServiceReady(config);
    sendToRenderer('osc-server-status', { 
      status: 'connected', 
      port: config.localPort 
    });
    debug.logAdditionalConnections(serverConfig.additionalOscConnections);
    // Update HypeRate addon with OSC service if it's running
    if (hyperateAddon && hyperateAddon.isEnabled()) {
      hyperateAddon.oscService = oscService;
      debug.info('Updated HypeRate addon with OSC service');
    }
  });
  oscService.on('messageReceived', (data) => {
    // Reduce debug logging frequency for OSC messages to prevent excessive I/O
    // Only log every 100th message or if it's the first message
    oscMessageCounter++;
    if (oscMessageCounter === 1 || oscMessageCounter % 100 === 0) {
      debug.oscMessageReceived(data.address, data.value, data.type);
    }
    // Only forward to WebSocket if both OSC and WebSocket forwarding are enabled
    const wsConnected = wsManager && wsManager.isConnected;
    let wsForwardingEnabled = serverConfig.appSettings?.enableWebSocketForwarding || false;
    // If this message comes from an additional connection, check its individual forwarding setting
    if (data.connectionId) {
      const connection = serverConfig.additionalOscConnections?.find(conn => conn.id === data.connectionId);
      if (connection && connection.type === 'incoming') {
        // For incoming additional connections, use their individual WebSocket forwarding setting
        wsForwardingEnabled = connection.enableWebSocketForwarding || false;
      }
    }
    if (wsConnected && wsForwardingEnabled) {
      // Check if the parameter is blacklisted before forwarding
      if (!parameterBlacklist.isBlacklisted(data.address)) {
        try {
          const result = wsManager.sendOscData({
            address: data.address,
            value: data.value
          });
          debug.logWebSocketForwarding(`${data.address} = ${data.value} (result: ${JSON.stringify(result)})`);
          // Send forwarded message to renderer for the new forwarded log
          sendToRenderer('osc-forwarded', { 
            address: data.address, 
            value: data.value,
            connectionId: data.connectionId,
            timestamp: Date.now()
          });
        } catch (error) {
          debug.error(`Failed to forward OSC to WebSocket: ${error.message}`);
        }
      } else {
        debug.logWebSocketForwarding(`Parameter blacklisted - not forwarding: ${data.address}`);
      }
    } else {
      if (wsConnected && !wsForwardingEnabled) {
        if (data.connectionId) {
          debug.logWebSocketForwarding(`Additional connection WebSocket forwarding disabled - not forwarding: ${data.address}`);
        } else {
          // debug.logWebSocketForwarding(`WebSocket forwarding disabled - not forwarding: ${data.address}`);
        }
      }
    }
    if (!data.connectionId && oscService) {
      oscService.broadcastToAllOutgoing(data.address, data.value, data.type);
    }
    sendToRenderer('osc-received', { 
      address: data.address, 
      value: data.value,
      connectionId: data.connectionId 
    });
  });
  oscService.on('additionalPortReady', (data) => {
    debug.logAdditionalPortReady(data);
    sendToRenderer('osc-server-status', { 
      status: 'connection-ready', 
      connectionId: data.connectionId,
      type: data.type,
      port: data.port,
      address: data.address,
      name: data.name
    });
  });
  oscService.on('additionalPortError', (data) => {
    debug.logAdditionalPortError(data);
    sendToRenderer('osc-server-status', { 
      status: 'connection-error', 
      connectionId: data.connectionId,
      type: data.type,
      port: data.port,
      name: data.name,
      error: data.error.message 
    });
  });
  oscService.on('error', (err) => {
    const status = logger ? logger.handleOscError(err) : { status: 'error', error: err.message };
    sendToRenderer('osc-server-status', status);
  });
  // Initialize and start the service
  if (oscService.initialize(
    serverConfig.localOscPort, 
    serverConfig.targetOscPort, 
    serverConfig.targetOscAddress
  )) {
    oscService.setAdditionalConnections(serverConfig.additionalOscConnections);
    oscService.start();
    global.oscService = oscService;
  }
}
function initOscClient() {
  if (oscClient) {
    oscClient.close();
  }
  oscClient = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: 0,
    remoteAddress: serverConfig.targetOscAddress,
    remotePort: serverConfig.targetOscPort
  });
  oscClient.open();
  console.log(`OSC Client targeting ${serverConfig.targetOscAddress}:${serverConfig.targetOscPort}`);
  debug.logOscClientInit(serverConfig.targetOscAddress, serverConfig.targetOscPort);
}
function sendToRenderer(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}
ipcMain.handle('get-config', () => {
  return configManager.getConfig();
});
ipcMain.handle('get-server-config', () => {
  return serverConfig;
});
ipcMain.handle('set-config', (event, newConfig) => {
  const oldConfig = { ...serverConfig };
  serverConfig = { ...serverConfig, ...newConfig };
  // Log changes to additional connections
  const oldConnections = oldConfig.additionalOscConnections || [];
  const newConnections = newConfig.additionalOscConnections || [];
  if (oldConnections.length !== newConnections.length) {
    debug.logConnectionCountChange(oldConnections.length, newConnections.length, newConnections);
  }
  debug.logConfigUpdate(oldConfig, newConfig, serverConfig);
  // Check if this is a custom/dev URL that shouldn't persist
  const isCustomUrl = newConfig.websocketServerUrl && newConfig.websocketServerUrl.includes('127.0.0.1');
  // Save the updated config to file (excluding custom URLs)
  if (!isCustomUrl) {
    configManager.updateConfig(serverConfig);
  } else {
    // For custom URLs, save everything except the websocket URL
    const configToSave = { ...serverConfig };
    delete configToSave.websocketServerUrl;
    configManager.updateConfig(configToSave);
    debug.info('Custom/dev WebSocket URL not persisted to config file');
  }
  // Update WebSocket configuration if URL changed
  if (newConfig.websocketServerUrl && oldConfig.websocketServerUrl !== newConfig.websocketServerUrl) {
    debug.info(`WebSocket URL changed from ${oldConfig.websocketServerUrl} to ${newConfig.websocketServerUrl}`);
    if (wsManager) {
      const wasConnected = wsManager.isConnected;
      if (wasConnected) {
        debug.info('Disconnecting WebSocket to apply new URL...');
        wsManager.disconnect();
      }
      // Update the WebSocket manager's configuration
      wsManager.setConfig({
        serverUrl: serverConfig.websocketServerUrl
      });
      debug.info(`WebSocket configuration updated to: ${serverConfig.websocketServerUrl}`);
    }
  }
  // Check if only additional connections changed, if so, just update them
  const portsChanged = (oldConfig.localOscPort !== serverConfig.localOscPort) ||
                       (oldConfig.targetOscPort !== serverConfig.targetOscPort) ||
                       (oldConfig.targetOscAddress !== serverConfig.targetOscAddress);
  const additionalConnectionsChanged = JSON.stringify(oldConfig.additionalOscConnections || []) !== 
                                       JSON.stringify(serverConfig.additionalOscConnections || []);
  if (!portsChanged && oscService && oscEnabled && additionalConnectionsChanged) {
    // Only additional connections changed, update them efficiently
    debug.info('Only additional connections changed, updating without restarting OSC service');
    oscService.updateAdditionalConnections(serverConfig.additionalOscConnections);
  } else if (portsChanged || !oscEnabled) {
    // Ports changed or OSC service needs full restart
    debug.info('OSC configuration changed, restarting OSC service');
    initOscServer();
    initOscClient();
  } else if (!additionalConnectionsChanged) {
    debug.info('No OSC configuration changes detected');
  }
  return serverConfig;
});
ipcMain.handle('get-app-settings', () => {
  return configManager.getAppSettings();
});
ipcMain.handle('set-app-settings', (event, newSettings) => {
  // Update the settings in the config manager
  const result = configManager.updateAppSettings(newSettings);
  debug.info(`App settings updated`);
  if (!result) {
    debug.error('Failed to save app settings to config file');
  }
  return configManager.getAppSettings();
});
ipcMain.handle('get-window-state', () => {
  return configManager.getWindowState();
});
ipcMain.handle('set-window-state', (event, windowState) => {
  const result = configManager.updateWindowState(windowState);
  debug.info(`Window state updated: ${JSON.stringify(windowState)}`);
  if (!result) {
    debug.error('Failed to save window state to config file');
  }
  return result;
});
ipcMain.handle('get-debug-stats', () => {
  return debug.getStats();
});
ipcMain.handle('get-osc-status', () => {
  if (oscService) {
    const status = oscService.getStatus();
    debug.logOscServiceStatus(status);
    return status;
  }
  return { error: 'OSC service not initialized' };
});
ipcMain.handle('set-osc-forwarding', (event, enabled) => {
  if (oscService) {
    oscService.setForwardingEnabled(enabled);
    debug.logOscForwardingChange(enabled);
    return { success: true, enabled: oscService.isForwardingEnabled() };
  }
  return { success: false, error: 'OSC service not initialized' };
});
ipcMain.handle('get-last-username', () => {
  const appSettings = configManager.getAppSettings();
  return appSettings.lastUsername || '';
});
ipcMain.handle('set-last-username', (event, username) => {
  try {
    const result = configManager.updateAppSettings({ lastUsername: username });
    debug.info(`Last username saved: ${username}`);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to save last username: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('clear-debug-logs', () => {
  debug.clearOldLogs();
  debug.info('Debug logs cleared by user request');
});
ipcMain.handle('get-memory-stats', () => {
  const memoryUsage = process.memoryUsage();
  return {
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    external: Math.round(memoryUsage.external / 1024 / 1024),
    parameterCount: oscService ? Object.keys(oscService.getParameters()).length : 0
  };
});
ipcMain.handle('force-memory-cleanup', () => {
  try {
    if (global.gc) {
      global.gc();
    }
    if (oscService && typeof oscService.cleanupOldParameters === 'function') {
      oscService.cleanupOldParameters();
    }
    const memoryUsage = process.memoryUsage();
    debug.logMemoryCleanup({
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      parameterCount: oscService ? Object.keys(oscService.getParameters()).length : 0
    });
    return { success: true, message: 'Memory cleanup performed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('websocket-connect', async (event, credentials) => {
  try {
    initWebSocket();
    const result = await wsManager.connect(credentials);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('websocket-disconnect', () => {
  try {
    if (wsManager) {
      const result = wsManager.disconnect();
      return result;
    }
    return { success: true, message: 'Already disconnected' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('websocket-send-osc', (event, data) => {
  try {
    if (wsManager) {
      debug.info(`Manual OSC send via WebSocket: ${JSON.stringify(data)}`);
      return wsManager.sendOscData(data);
    }
    throw new Error('WebSocket not connected');
  } catch (error) {
    debug.error(`Manual WebSocket OSC send failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// Add test method
ipcMain.handle('websocket-test-send', () => {
  try {
    if (wsManager && wsManager.isConnected) {
      const testData = {
        address: "/avatar/parameters/test",
        value: 1.0
      };
      debug.info(`Sending test WebSocket data: ${JSON.stringify(testData)}`);
      const result = wsManager.sendOscData(testData);
      debug.info(`Test send result: ${JSON.stringify(result)}`);
      return result;
    }
    throw new Error('WebSocket not connected');
  } catch (error) {
    debug.error(`Test WebSocket send failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('websocket-send-message', (event, eventName, data) => {
  try {
    if (wsManager) {
      return wsManager.sendMessage(eventName, data);
    }
    throw new Error('WebSocket not connected');
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('websocket-get-status', () => {
  if (wsManager) {
    return wsManager.getStatus();
  }
  return {
    isConnected: false,
    isAuthenticated: false,
    currentUser: null,
    reconnectAttempts: 0,
    serverUrl: serverConfig.websocketServerUrl
  };
});
ipcMain.handle('websocket-get-forwarding-status', () => {
  const enableForwarding = serverConfig.appSettings?.enableWebSocketForwarding || false;
  return {
    enabled: enableForwarding,
    isConnected: wsManager ? wsManager.isConnected : false,
    canForward: enableForwarding && wsManager && wsManager.isConnected
  };
});
ipcMain.handle('websocket-set-forwarding', (event, enabled) => {
  try {
    debug.info(`Setting WebSocket forwarding to: ${enabled}`);
    const newSettings = { enableWebSocketForwarding: enabled };
    const result = configManager.updateAppSettings(newSettings);
    if (result) {
      // Ensure appSettings exists
      if (!serverConfig.appSettings) {
        serverConfig.appSettings = {};
      }
      serverConfig.appSettings.enableWebSocketForwarding = enabled;
      debug.logWebSocketForwarding(`WebSocket forwarding ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true, enabled };
    } else {
      throw new Error('Failed to save settings');
    }
  } catch (error) {
    debug.error(`Failed to update WebSocket forwarding setting: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// Parameter blacklist IPC handlers
ipcMain.handle('get-parameter-blacklist', () => {
  return parameterBlacklist.getPatterns();
});
ipcMain.handle('add-blacklist-pattern', (event, pattern) => {
  try {
    const success = parameterBlacklist.addPattern(pattern);
    if (success) {
      // Save to config
      const patterns = parameterBlacklist.getPatterns();
      configManager.updateConfig({ parameterBlacklist: patterns });
      debug.info(`Added blacklist pattern: ${pattern}`);
    }
    return { success, patterns: parameterBlacklist.getPatterns() };
  } catch (error) {
    debug.error(`Failed to add blacklist pattern: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('remove-blacklist-pattern', (event, pattern) => {
  try {
    const success = parameterBlacklist.removePattern(pattern);
    if (success) {
      // Save to config
      const patterns = parameterBlacklist.getPatterns();
      configManager.updateConfig({ parameterBlacklist: patterns });
      debug.info(`Removed blacklist pattern: ${pattern}`);
    }
    return { success, patterns: parameterBlacklist.getPatterns() };
  } catch (error) {
    debug.error(`Failed to remove blacklist pattern: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('clear-parameter-blacklist', () => {
  try {
    parameterBlacklist.clear();
    configManager.updateConfig({ parameterBlacklist: [] });
    debug.info('Cleared parameter blacklist');
    return { success: true, patterns: [] };
  } catch (error) {
    debug.error(`Failed to clear blacklist: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('enable-osc', () => {
  oscEnabled = true;
  debug.logOscServerStateChange(true);
  debug.info('OSC explicitly enabled by user');
  // Ensure any existing service is properly cleaned up before creating new one
  if (oscService) {
    debug.info('Cleaning up existing OSC service before enabling...');
    try {
      oscService.stop();
      oscService = null;
      global.oscService = null;
    } catch (error) {
      debug.error(`Error cleaning up existing OSC service: ${error.message}`);
    }
  }
  // Force initialization of OSC service
  initOscServer();
  initOscClient();
  return { success: true, message: 'OSC enabled' };
});
ipcMain.handle('disable-osc', () => {
  oscEnabled = false;
  debug.logOscServerStateChange(false);
  try {
    if (oscService) {
      debug.info('Stopping OSC service and all additional connections...');
      oscService.stop();
      oscService = null;
      global.oscService = null;
    }
  } catch (error) {
    debug.error(`Error stopping OSC service: ${error.message}`);
  }
  try {
    if (oscServer) {
      oscServer.close();
      oscServer = null;
    }
  } catch (error) {
    debug.error(`Error closing OSC server: ${error.message}`);
  }
  try {
    if (oscClient) {
      oscClient.close();
      oscClient = null;
    }
  } catch (error) {
    debug.error(`Error closing OSC client: ${error.message}`);
  }
  sendToRenderer('osc-server-status', { 
    status: 'disabled', 
    port: serverConfig.localOscPort 
  });
  debug.info('OSC service fully disabled - all connections closed');
  return { success: true, message: 'OSC disabled' };
});
ipcMain.handle('get-saved-password', () => {
  const savedPassword = configManager.getSavedPassword();
  return { password: savedPassword };
});

ipcMain.handle('set-saved-password', (event, password) => {
  try {
    const result = configManager.setSavedPassword(password);
    if (result) {
      debug.info(`Password ${password ? 'saved' : 'cleared'} in configuration`);
      return { success: true };
    } else {
      throw new Error('Failed to save password to config file');
    }
  } catch (error) {
    debug.error(`Failed to save password: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// HypeRate addon IPC handlers
ipcMain.handle('hyperate-get-status', () => {
  if (hyperateAddon) {
    return hyperateAddon.getStatus();
  }
  return { enabled: false, connected: false, hasApiKey: false };
});
ipcMain.handle('hyperate-start', () => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    // Pass OSC service if available, but don't require it
    const result = hyperateAddon.start(oscService);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to start HypeRate addon: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-stop', () => {
  try {
    if (hyperateAddon) {
      hyperateAddon.stop();
    }
    return { success: true };
  } catch (error) {
    debug.error(`Failed to stop HypeRate addon: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-add-tracker', (event, deviceId, deviceName = null) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.addTracker(deviceId, deviceName);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to add HypeRate tracker: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-remove-tracker', (event, deviceId) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.removeTracker(deviceId);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to remove HypeRate tracker: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-update-tracker-name', (event, deviceId, newName) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.updateTrackerName(deviceId, newName);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to update HypeRate tracker name: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-update-tracker-state', (event, deviceId, enabled) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.updateTrackerState(deviceId, enabled);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to update HypeRate tracker state: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-get-trackers', () => {
  try {
    if (hyperateAddon) {
      return hyperateAddon.getTrackers();
    }
    return [];
  } catch (error) {
    debug.error(`Failed to get HypeRate trackers: ${error.message}`);
    return [];
  }
});
ipcMain.handle('hyperate-set-primary', (event, deviceId) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.setPrimaryTracker(deviceId);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to set primary HypeRate tracker: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// HypeRate auto-start IPC handlers
ipcMain.handle('hyperate-get-autostart', () => {
  try {
    const appSettings = configManager.getAppSettings();
    return { enabled: appSettings.hyperateAutostart || false };
  } catch (error) {
    debug.error(`Failed to get HypeRate autostart setting: ${error.message}`);
    return { enabled: false };
  }
});
ipcMain.handle('hyperate-set-autostart', (event, enabled) => {
  try {
    const result = configManager.updateAppSettings({ hyperateAutostart: enabled });
    if (result) {
      debug.info(`HypeRate autostart ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true, enabled };
    } else {
      throw new Error('Failed to save autostart setting');
    }
  } catch (error) {
    debug.error(`Failed to set HypeRate autostart: ${error.message}`);
    return { success: false, error: error.message };
  }
});
app.whenReady().then(() => {
  debug.logAppStartup();
  // Load logger after app is ready
  logger = require('./utils/logger');
  // Initialize HypeRate addon
  hyperateAddon = new HyperateAddon();
  // Get app settings from config
  const appSettings = configManager.getAppSettings();
  // Load parameter blacklist from config
  const config = configManager.getConfig();
  parameterBlacklist.loadBlacklist(config.parameterBlacklist || []);
  // Ensure serverConfig has appSettings
  if (!serverConfig.appSettings) {
    serverConfig.appSettings = appSettings || {};
  } else {
    // Merge app settings to ensure all settings are available
    serverConfig.appSettings = { ...appSettings, ...serverConfig.appSettings };
  }
  // Initialize OSC server
  oscEnabled = false;
  // Important: Window before initializing OSC service
  createWindow();
  // Set up periodic memory management
  setupMemoryManagement();
  // Initialize OSC after a short delay to ensure the window is ready
  setTimeout(() => {
    if (oscEnabled) {
      debug.info('Starting OSC service based on saved config...');
      initOscServer();
      initOscClient();
    } else {
      sendToRenderer('osc-server-status', { 
        status: 'disabled', 
        port: serverConfig.localOscPort 
      });
    }
    // Start HypeRate if auto-start is enabled
    if (appSettings.hyperateAutostart) {
      debug.info('Starting HypeRate addon based on autostart setting...');
      hyperateAddon.start(oscService);
    }
  }, 500); // Short delay to ensure window is ready
  setTimeout(() => {
    debug.connectionTimeout();
  }, 30000); // Check after 30 seconds
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
function setupMemoryManagement() {
  // Set up periodic garbage collection and memory cleanup
  setInterval(() => {
    try {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      // Clean up OSC parameters if service exists
      if (oscService && typeof oscService.cleanupOldParameters === 'function') {
        oscService.cleanupOldParameters();
      }
      // Log memory usage periodically
      const memoryUsage = process.memoryUsage();
      const memoryMB = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      };
      // Only log if memory usage is concerning
      if (memoryUsage.heapUsed > 200 * 1024 * 1024) { // Over 200MB heap
        debug.warn('High memory usage detected', memoryMB);
      }
    } catch (error) {
      debug.error(`Memory management error: ${error.message}`);
    }
  }, 60000); // Every minute
}
function cleanup(source = 'unknown') {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  debug.logAppShutdown(`Cleanup initiated from: ${source}`);
  try {
    if (oscService) {
      oscService.stop();
      oscService = null;
      global.oscService = null;
    }
  } catch (error) {
    debug.error(`Error stopping OSC service: ${error.message}`);
  }
  try {
    if (oscServer) {
      oscServer.close();
      oscServer = null;
    }
  } catch (error) {
    debug.error(`Error closing OSC server: ${error.message}`);
  }
  try {
    if (oscClient) {
      oscClient.close();
      oscClient = null;
    }
  } catch (error) {
    debug.error(`Error closing OSC client: ${error.message}`);
  }
  try {
    if (wsManager) {
      wsManager.disconnect();
      wsManager = null;
    }
  } catch (error) {
    debug.error(`Error disconnecting WebSocket: ${error.message}`);
  }
  try {
    if (hyperateAddon) {
      hyperateAddon.stop();
      hyperateAddon = null;
    }
  } catch (error) {
    debug.error(`Error stopping HypeRate addon: ${error.message}`);
  }
}
app.on('window-all-closed', () => {
  cleanup('window-all-closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('before-quit', (event) => {
  cleanup('before-quit');
});
process.on('uncaughtException', (error) => {
  if (hasShownCriticalError) {
    process.exit(1);
    return;
  }
  hasShownCriticalError = true;
  if (logger) {
    logger.logError(error);
  }
  debug.error(`Uncaught exception: ${error.message}`);
  try {
    cleanup('uncaught-exception');
  } catch (cleanupError) {
    debug.error(`Error during cleanup: ${cleanupError.message}`);
  }
  dialog.showErrorBox('Critical Error', 'An unexpected error occurred. The application will now close.');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  if (hasShownCriticalError) {
    process.exit(1);
    return;
  }
  hasShownCriticalError = true;
  if (logger) {
    logger.logError(reason);
  }
  debug.error(`Unhandled rejection: ${reason}`);
  try {
    cleanup('unhandled-rejection');
  } catch (cleanupError) {
    debug.error(`Error during cleanup: ${cleanupError.message}`);
  }
  dialog.showErrorBox('Critical Error', 'An unexpected error occurred. The application will now close.');
  process.exit(1);
});