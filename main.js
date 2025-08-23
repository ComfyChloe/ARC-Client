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
let isShuttingDown = false;
let hasShownCriticalError = false;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'ARC-OSC Client'
  });
  mainWindow.setMenuBarVisibility(false);
  if (process.argv.includes('--dev')) {
    mainWindow.loadFile('renderer/index.html');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('renderer/index.html');
  }
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
      if (oscService && oscService.getStatus().isListening) {
        try {
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
          }
        } catch (error) {
          debug.logError(`Failed to forward WebSocket OSC to VRChat: ${error.message}`);
        }
      } else {
        debug.logWebSocketConnection(`Cannot forward OSC to VRChat - OSC service not running`);
      }
    });
    wsManager.on('avatar-change', (data) => {
      sendToRenderer('websocket-avatar-change', data);
      debug.logWebSocketConnection(`Avatar changed: ${data.avatarId || 'Unknown'}`);
    });
    wsManager.on('parameter-update', (data) => {
      sendToRenderer('websocket-parameter-update', data);
    });
    wsManager.on('server-message', (data) => {
      sendToRenderer('websocket-server-message', data);
    });
  }
}
function initOscServer() {
  if (oscService) {
    debug.info('Stopping existing OSC service before reinitialization...');
    oscService.stop();
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
  });
  oscService.on('messageReceived', (data) => {
    debug.oscMessageReceived(data.address, data.value, data.type);
    const wsConnected = wsManager && wsManager.isConnected;
    if (wsConnected) {
      try {
        const result = wsManager.sendOscData({
          address: data.address,
          value: data.value
        });
        debug.logWebSocketForwarding(`${data.address} = ${data.value} (result: ${JSON.stringify(result)})`);
      } catch (error) {
      }
    } else {
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
  configManager.updateConfig(serverConfig);
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
  initOscServer();
  initOscClient();
  return serverConfig;
});
ipcMain.handle('get-app-settings', () => {
  return configManager.getAppSettings();
});
ipcMain.handle('set-app-settings', (event, newSettings) => {
  const result = configManager.updateAppSettings(newSettings);
  debug.info(`App settings updated: ${JSON.stringify(newSettings)}`);
  if (!result) {
    debug.error('Failed to save app settings to config file');
  }
  return configManager.getAppSettings();
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
ipcMain.handle('clear-debug-logs', () => {
  debug.clearOldLogs();
  debug.info('Debug logs cleared by user request');
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
    debug.logError(`Manual WebSocket OSC send failed: ${error.message}`);
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
    debug.logError(`Test WebSocket send failed: ${error.message}`);
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
      debug.info(`ServerConfig appSettings after update: ${JSON.stringify(serverConfig.appSettings)}`);
      return { success: true, enabled };
    } else {
      throw new Error('Failed to save settings');
    }
  } catch (error) {
    debug.logError(`Failed to update WebSocket forwarding setting: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('enable-osc', () => {
  oscEnabled = true;
  debug.logOscServerStateChange(true);
  debug.info('OSC explicitly enabled by user');
  initOscServer();
  initOscClient();
  return { success: true, message: 'OSC enabled' };
});
ipcMain.handle('disable-osc', () => {
  oscEnabled = false;
  debug.logOscServerStateChange(false);
  try {
    if (oscService) {
      oscService.stop();
      global.oscService = null;
    }
  } catch (error) {
    debug.logError(`Error stopping OSC service: ${error.message}`);
  }
  try {
    if (oscServer) {
      oscServer.close();
      oscServer = undefined;
    }
  } catch (error) {
    debug.logError(`Error closing OSC server: ${error.message}`);
  }
  sendToRenderer('osc-server-status', { 
    status: 'disabled', 
    port: serverConfig.localOscPort 
  });
  return { success: true, message: 'OSC disabled' };
});
app.whenReady().then(() => {
  debug.logAppStartup();
  logger = require('./utils/logger');
  const appSettings = configManager.getAppSettings();
  if (!serverConfig.appSettings) {
    serverConfig.appSettings = appSettings || {};
  }
  oscEnabled = appSettings.enableOscOnStartup;
  debug.info(`OSC startup state from config: ${oscEnabled ? 'enabled' : 'disabled'}`);
  createWindow();
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
function cleanup(source = 'unknown') {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  debug.logAppShutdown(`Cleanup initiated from: ${source}`);
  try {
    if (oscService) {
      oscService.stop();
      global.oscService = null;
    }
  } catch (error) {
    debug.logError(`Error stopping OSC service: ${error.message}`);
  }
  try {
    if (oscServer) {
      oscServer.close();
      oscServer = undefined;
    }
  } catch (error) {
    debug.logError(`Error closing OSC server: ${error.message}`);
  }
  try {
    if (oscClient) {
      oscClient.close();
      oscClient = undefined;
    }
  } catch (error) {
    debug.logError(`Error closing OSC client: ${error.message}`);
  }
  try {
    if (wsManager) {
      wsManager.disconnect();
      wsManager = undefined;
    }
  } catch (error) {
    debug.logError(`Error disconnecting WebSocket: ${error.message}`);
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
  debug.logError(`Uncaught exception: ${error.message}`);
  try {
    cleanup('uncaught-exception');
  } catch (cleanupError) {
    debug.logError(`Error during cleanup: ${cleanupError.message}`);
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
  debug.logError(`Unhandled rejection: ${reason}`);
  try {
    cleanup('unhandled-rejection');
  } catch (cleanupError) {
    debug.logError(`Error during cleanup: ${cleanupError.message}`);
  }
  dialog.showErrorBox('Critical Error', 'An unexpected error occurred. The application will now close.');
  process.exit(1);
});