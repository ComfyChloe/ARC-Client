const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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
    show: false 
  })
  
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
  
  let saveWindowStateTimeout;
  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
    }
    
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
  
  global.saveWindowStateTimeout = saveWindowStateTimeout;
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);
  mainWindow.on('close', () => {
    
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
      
      debug.logWebSocketForwarding(`Ready to forward OSC data to server`);
    });
    wsManager.on('osc-data', (data) => {
      sendToRenderer('websocket-osc-data', data);
      
      
      const wsForwardingEnabled = serverConfig.appSettings?.enableWebSocketForwarding || false;
      if (!wsForwardingEnabled) {
        debug.logWebSocketForwarding(`WebSocket forwarding disabled - ignoring incoming OSC data: ${data.address} = ${data.value}`);
        return;
      }
      
      if (oscService && oscService.getStatus().isListening) {
        try {
          
          let type = 'f'; 
          if (typeof data.value === 'boolean') {
            type = 'bool';
          } else if (typeof data.value === 'string') {
            type = 's';
          } else if (Number.isInteger(data.value)) {
            type = 'i';
          }
          const success = oscService.sendMessage(data.address, data.value, type);
          if (success) {
            
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
    
    if (hyperateAddon && hyperateAddon.isEnabled()) {
      hyperateAddon.oscService = oscService;
      debug.info('Updated HypeRate addon with OSC service');
    }
  });
  oscService.on('messageReceived', (data) => {
    
    
    oscMessageCounter++;
    if (oscMessageCounter > 10000) { 
      oscMessageCounter = 1; 
    }
    
    if (oscMessageCounter === 1 || oscMessageCounter % 100 === 0) {
      debug.oscMessageReceived(data.address, data.value, data.type);
    }
    
    const wsConnected = wsManager && wsManager.isConnected;
    let wsForwardingEnabled = serverConfig.appSettings?.enableWebSocketForwarding || false;
    
    if (data.connectionId) {
      const connection = serverConfig.additionalOscConnections?.find(conn => conn.id === data.connectionId);
      if (connection && connection.type === 'incoming') {
        
        wsForwardingEnabled = connection.enableWebSocketForwarding || false;
      }
    }
    if (wsConnected && wsForwardingEnabled) {
      
      if (!parameterBlacklist.isBlacklisted(data.address)) {
        try {
          const result = wsManager.sendOscData({
            address: data.address,
            value: data.value
          });
          debug.logWebSocketForwarding(`${data.address} = ${data.value} (result: ${JSON.stringify(result)})`);
          
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
          
        }
      }
    }
    if (!data.connectionId && oscService) {
      oscService.broadcastToAllOutgoing(data.address, data.value, data.type);
    }
    
    const oscReceivedDisplayEnabled = serverConfig.appSettings?.oscReceivedDisplayEnabled !== false;
    if (oscReceivedDisplayEnabled) {
      sendToRenderer('osc-received', { 
        address: data.address, 
        value: data.value,
        connectionId: data.connectionId 
      });
    }
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
  
  const oldConnections = oldConfig.additionalOscConnections || [];
  const newConnections = newConfig.additionalOscConnections || [];
  if (oldConnections.length !== newConnections.length) {
    debug.logConnectionCountChange(oldConnections.length, newConnections.length, newConnections);
  }
  debug.logConfigUpdate(oldConfig, newConfig, serverConfig);
  
  const isCustomUrl = newConfig.websocketServerUrl && newConfig.websocketServerUrl.includes('127.0.0.1');
  
  if (!isCustomUrl) {
    configManager.updateConfig(serverConfig);
  } else {
    
    const configToSave = { ...serverConfig };
    delete configToSave.websocketServerUrl;
    configManager.updateConfig(configToSave);
    debug.info('Custom/dev WebSocket URL not persisted to config file');
  }
  
  if (newConfig.websocketServerUrl && oldConfig.websocketServerUrl !== newConfig.websocketServerUrl) {
    debug.info(`WebSocket URL changed from ${oldConfig.websocketServerUrl} to ${newConfig.websocketServerUrl}`);
    if (wsManager) {
      const wasConnected = wsManager.isConnected;
      if (wasConnected) {
        debug.info('Disconnecting WebSocket to apply new URL...');
        wsManager.disconnect();
      }
      
      wsManager.setConfig({
        serverUrl: serverConfig.websocketServerUrl
      });
      debug.info(`WebSocket configuration updated to: ${serverConfig.websocketServerUrl}`);
    }
  }
  
  const portsChanged = (oldConfig.localOscPort !== serverConfig.localOscPort) ||
                       (oldConfig.targetOscPort !== serverConfig.targetOscPort) ||
                       (oldConfig.targetOscAddress !== serverConfig.targetOscAddress);
  const additionalConnectionsChanged = JSON.stringify(oldConfig.additionalOscConnections || []) !== 
                                       JSON.stringify(serverConfig.additionalOscConnections || []);
  if (!portsChanged && oscService && oscEnabled && additionalConnectionsChanged) {
    
    debug.info('Only additional connections changed, updating without restarting OSC service');
    oscService.updateAdditionalConnections(serverConfig.additionalOscConnections);
  } else if (portsChanged || !oscEnabled) {
    
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
  const parameterCount = oscService ? Object.keys(oscService.getParameters()).length : 0;
  const maxParameterCount = oscService ? oscService.maxParameterCount : 1000;
  return {
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    external: Math.round(memoryUsage.external / 1024 / 1024),
    arrayBuffers: Math.round(memoryUsage.arrayBuffers / 1024 / 1024),
    parameterCount: parameterCount,
    maxParameterCount: maxParameterCount,
    
    heapPercentUsed: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
    parameterPercentUsed: Math.round((parameterCount / maxParameterCount) * 100),
    
    isLogsOnly: true,
    parameterMaxAge: oscService ? Math.round(oscService.maxParameterAge / 1000) : 60 
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

ipcMain.handle('get-parameter-blacklist', () => {
  return parameterBlacklist.getPatterns();
});
ipcMain.handle('add-blacklist-pattern', (event, pattern) => {
  try {
    const success = parameterBlacklist.addPattern(pattern);
    if (success) {
      
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
  
  initOscServer();
  initOscClient();
  return { success: true, message: 'OSC enabled' };
});
ipcMain.handle('disable-osc', () => {
  oscEnabled = false;
  debug.logOscServerStateChange(false);
  
  return new Promise((resolve) => {
    try {
      if (oscService) {
        debug.info('Stopping OSC service and all additional connections...');
        
        setTimeout(() => {
          try {
            oscService.stop();
            oscService = null;
            global.oscService = null;
            debug.info('OSC service stopped successfully');
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
          resolve({ success: true, message: 'OSC disabled' });
        }, 100);
      } else {
        debug.info('OSC service was not running');
        sendToRenderer('osc-server-status', { 
          status: 'disabled', 
          port: serverConfig.localOscPort 
        });
        resolve({ success: true, message: 'OSC was already disabled' });
      }
    } catch (error) {
      debug.error(`Error during OSC disable: ${error.message}`);
      resolve({ success: false, error: error.message });
    }
  });
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
  
  logger = require('./utils/logger');
  
  hyperateAddon = new HyperateAddon();
  
  const appSettings = configManager.getAppSettings();
  
  const config = configManager.getConfig();
  parameterBlacklist.loadBlacklist(config.parameterBlacklist || []);
  
  if (!serverConfig.appSettings) {
    serverConfig.appSettings = appSettings || {};
  } else {
    
    serverConfig.appSettings = { ...appSettings, ...serverConfig.appSettings };
  }
  
  oscEnabled = false;
  
  createWindow();
  
  setupMemoryManagement();
  
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
    
    if (appSettings.hyperateAutostart) {
      debug.info('Starting HypeRate addon based on autostart setting...');
      hyperateAddon.start(oscService);
    }
  }, 500); 
  setTimeout(() => {
    debug.connectionTimeout();
  }, 30000); 
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
function setupMemoryManagement() {
  
  if (global.memoryManagementInterval) {
    clearInterval(global.memoryManagementInterval);
  }
  
  global.memoryManagementInterval = setInterval(() => {
    try {
      
      if (global.gc) {
        global.gc();
      }
      
      if (oscService && typeof oscService.cleanupOldParameters === 'function') {
        oscService.cleanupOldParameters();
      }
      
      const memoryUsage = process.memoryUsage();
      const memoryMB = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      };
      
      if (memoryUsage.heapUsed > 80 * 1024 * 1024) { 
        debug.warn('High memory usage detected', memoryMB);
        
        if (memoryUsage.heapUsed > 120 * 1024 * 1024) { 
          debug.warn('Very high memory usage - forcing aggressive cleanup');
          if (oscService) {
            
            const params = oscService.getParameters();
            const paramEntries = Object.entries(params)
              .filter(([_, param]) => param.timestamp)
              .sort(([_, a], [__, b]) => b.timestamp - a.timestamp)
              .slice(0, 30); 
            oscService.parameters = {};
            paramEntries.forEach(([address, param]) => {
              oscService.parameters[address] = param;
            });
            debug.warn(`Aggressive cleanup: reduced parameters to ${paramEntries.length} for logs view`);
          }
          
          if (global.gc) {
            global.gc();
            setTimeout(() => global.gc && global.gc(), 100);
            setTimeout(() => global.gc && global.gc(), 200);
          }
        }
      }
    } catch (error) {
      debug.error(`Memory management error: ${error.message}`);
    }
  }, 20000); 
}
function cleanup(source = 'unknown') {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  debug.logAppShutdown(`Cleanup initiated from: ${source}`);
  
  if (global.memoryManagementInterval) {
    clearInterval(global.memoryManagementInterval);
    global.memoryManagementInterval = null;
  }
  
  if (global.saveWindowStateTimeout) {
    clearTimeout(global.saveWindowStateTimeout);
    global.saveWindowStateTimeout = null;
  }
  try {
    if (oscService) {
      debug.info('Stopping OSC service during cleanup...');
      oscService.stop();
      oscService = null;
      global.oscService = null;
      debug.info('OSC service cleanup completed');
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
  
  if (global.gc) {
    global.gc();
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
  
  try {
    debug.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
  } catch (debugError) {
    console.error('Failed to log error via debug:', debugError);
    console.error('Original error:', error);
  }
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
  
  try {
    debug.error(`Unhandled rejection: ${reason}`, { stack: reason && reason.stack ? reason.stack : 'No stack trace' });
  } catch (debugError) {
    console.error('Failed to log rejection via debug:', debugError);
    console.error('Original rejection:', reason);
  }
  try {
    cleanup('unhandled-rejection');
  } catch (cleanupError) {
    debug.error(`Error during cleanup: ${cleanupError.message}`);
  }
  dialog.showErrorBox('Critical Error', 'An unexpected error occurred. The application will now close.');
  process.exit(1);
});