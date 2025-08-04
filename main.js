const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Client, Server } = require('node-osc');
const debug = require('./utils/debugger');
const websocketService = require('./utils/websocketService');
let mainWindow;
let oscServer;
let oscClient;
let oscEnabled = false;
let serverConfig = {
  serverUrl: 'wss://localhost:3000',
  localOscPort: 9001,
  targetOscPort: 9000,
  targetOscAddress: '127.0.0.1'
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
}
function initOscServer() {
  if (oscServer) {
    oscServer.close();
  }
  if (!oscEnabled) {
    sendToRenderer('osc-server-status', { 
      status: 'disabled', 
      port: serverConfig.localOscPort 
    });
    return;
  }
  oscServer = new Server(serverConfig.localOscPort, '0.0.0.0', () => {
    console.log(`OSC Server listening on port ${serverConfig.localOscPort}`);
    debug.oscServiceStarted(serverConfig.localOscPort);
    sendToRenderer('osc-server-status', { 
      status: 'connected', 
      port: serverConfig.localOscPort 
    });
  });
  oscServer.on('message', (msg) => {
    const [address, value] = msg;
    console.log('Received OSC:', address, value);
    // Determine OSC message type
    const type = typeof value === 'boolean' ? 'bool' : 
                 typeof value === 'number' ? 
                   (Number.isInteger(value) ? 'int' : 'float') : 'string';
    debug.oscMessageReceived(address, value, type);
    // Forward OSC message to websocket service
    websocketService.forwardOscMessage({
      address,
      value,
      type
    });
    sendToRenderer('osc-received', { address, value });
  });
  oscServer.on('error', (err) => {
    console.error('OSC Server error:', err);
    debug.error('OSC Server error', { error: err.message, port: serverConfig.localOscPort });
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });
}
function initOscClient() {
  if (oscClient) {
    oscClient.close();
  }
  oscClient = new Client(serverConfig.targetOscAddress, serverConfig.targetOscPort);
  console.log(`OSC Client targeting ${serverConfig.targetOscAddress}:${serverConfig.targetOscPort}`);
  debug.info('OSC Client initialized', {
    targetAddress: serverConfig.targetOscAddress,
    targetPort: serverConfig.targetOscPort
  });
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
  debug.info('Configuration updated', { 
    oldConfig: oldConfig, 
    newConfig: newConfig,
    finalConfig: serverConfig 
  });
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
ipcMain.handle('clear-debug-logs', () => {
  debug.clearOldLogs();
  debug.info('Debug logs cleared by user request');
});
ipcMain.handle('enable-osc', () => {
  oscEnabled = true;
  debug.info('OSC Server enabled by user request');
  initOscServer();
  initOscClient();
});
ipcMain.handle('disable-osc', () => {
  oscEnabled = false;
  debug.info('OSC Server disabled by user request');
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
  debug.info('ARC-OSC Client starting up');
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
  debug.info('Application shutting down - cleaning up connections');
  if (oscServer) oscServer.close();
  if (oscClient) oscClient.close();
  websocketService.cleanup();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('before-quit', () => {
  debug.info('Application quit requested - cleaning up');
  if (oscServer) oscServer.close();
  if (oscClient) oscClient.close();
  websocketService.cleanup();
});