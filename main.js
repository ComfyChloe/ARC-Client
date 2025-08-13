const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const osc = require('osc');
const debug = require('./utils/debugger');
const websocketService = require('./utils/websocketService');
const OscService = require('./utils/oscService');
const logger = require('./utils/logger');
let mainWindow;
let oscServer;
let oscClient;
let oscService;
let oscEnabled = false;
let serverConfig = {
  serverUrl: 'wss://localhost:3000',
  localOscPort: 9001,
  targetOscPort: 9000,
  targetOscAddress: '127.0.0.1',
  additionalOscConnections: []
};
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
    if (oscEnabled && oscServer) {
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
  });
  mainWindow.webContents.on('crashed', () => {
    dialog.showErrorBox('Application Error', 'The application has encountered an error and will now close.');
    app.quit();
  });
  mainWindow.on('unresponsive', () => {
    dialog.showErrorBox('Application Unresponsive', 'The application is not responding and will now close.');
    app.quit();
  });
}
function initOscServer() {
  if (oscService) {
    oscService.stop();
    global.oscService = null;
  }
  if (!oscEnabled) {
    sendToRenderer('osc-server-status', { 
      status: 'disabled', 
      port: serverConfig.localOscPort 
    });
    return;
  }
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
    websocketService.forwardOscMessage({
      address: data.address,
      value: data.value,
      type: data.type,
      connectionId: data.connectionId
    });
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
    const status = logger.handleOscError(err);
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
  websocketService.updateOscClient(oscClient);
}
function sendToRenderer(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}
ipcMain.handle('get-config', () => {
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
  websocketService.updateConfig(serverConfig);
  initOscServer();
  initOscClient();
  return serverConfig;
});
ipcMain.handle('connect-server', () => {
  websocketService.connect();
});
ipcMain.handle('disconnect-server', () => {
  websocketService.disconnect();
});
ipcMain.handle('authenticate', (event, credentials) => {
  return websocketService.authenticate(credentials);
});
ipcMain.handle('send-osc', (event, oscData) => {
  websocketService.sendOsc(oscData);
});
ipcMain.handle('get-user-avatar', () => {
  websocketService.getUserAvatar();
});
ipcMain.handle('get-parameters', () => {
  websocketService.getParameters();
});
ipcMain.handle('set-user-avatar', (event, avatarData) => {
  websocketService.setUserAvatar(avatarData);
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
ipcMain.handle('enable-osc', () => {
  oscEnabled = true;
  debug.logOscServerStateChange(true);
  initOscServer();
  initOscClient();
});
ipcMain.handle('disable-osc', () => {
  oscEnabled = false;
  debug.logOscServerStateChange(false);
  if (oscService) {
    oscService.stop();
    global.oscService = null;
  }
  if (oscServer) {
    oscServer.close();
    oscServer = undefined;
  }
  sendToRenderer('osc-server-status', { 
    status: 'disabled', 
    port: serverConfig.localOscPort 
  });
});
app.whenReady().then(() => {
  debug.logAppStartup();
  createWindow();
  if (oscEnabled) {
    initOscServer();
    initOscClient();
  } else {
    sendToRenderer('osc-server-status', { 
      status: 'disabled', 
      port: serverConfig.localOscPort 
    });
  }
  websocketService.initialize(serverConfig, sendToRenderer, oscClient);
  setTimeout(() => {
    debug.connectionTimeout();
  }, 30000); // Check after 30 seconds
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on('window-all-closed', () => {
  debug.logAppShutdown();
  if (oscServer) oscServer.close();
  if (oscClient) oscClient.close();
  websocketService.cleanup();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('before-quit', () => {
  debug.logAppShutdown('Application quit requested');
  if (oscServer) oscServer.close();
  if (oscClient) oscClient.close();
  websocketService.cleanup();
});
process.on('uncaughtException', (error) => {
  logger.logError(error);
  dialog.showErrorBox('Critical Error', 'An unexpected error occurred. The application will now close.');
  app.quit();
});
process.on('unhandledRejection', (reason) => {
  logger.logError(reason);
  dialog.showErrorBox('Critical Error', 'An unexpected error occurred. The application will now close.');
  app.quit();
});