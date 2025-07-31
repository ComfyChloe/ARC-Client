const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const OscQueryService = require('./utils/oscQueryService');
const DiscoveryService = require('./utils/discoveryService');
const OscUdpService = require('./utils/oscUdpService');
const WebSocketService = require('./utils/websocketService');
const debug = require('./utils/debugger');
let mainWindow;
let serverConfig = {
  serverUrl: 'ws://localhost:3000',
  localOscPort: null,
  targetOscPort: 9000,
  targetOscAddress: '127.0.0.1'
};
let oscQueryService = new OscQueryService();
let discoveryService = new DiscoveryService();
let oscUdpService = new OscUdpService();
let webSocketService = new WebSocketService();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'ARC-OSC Client'
  });

  // Load the renderer
  if (process.argv.includes('--dev')) {
    mainWindow.loadFile('renderer/index.html');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('renderer/index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
function initOscQueryServer() {
  debug.info('Initializing OSC Query Server...');
  debug.clearOldLogs(); // Clear previous session logs
  oscUdpService.setTargetConfig(serverConfig.targetOscAddress, serverConfig.targetOscPort);
  
  oscQueryService.on('sendOsc', (data) => {
    debug.debug('Sending OSC to VRChat', data);
    oscUdpService.sendOscToVRChat(data.address, data.value);
  });
  
  oscQueryService.on('dataReceived', (data) => {
    debug.oscMessageReceived(data.address, data.value, data.type);
    // Forward to server via WebSocket
    webSocketService.sendOscMessage(data);
    // Send to renderer for UI updates
    sendToRenderer('osc-received', { 
      address: data.address, 
      value: data.value,
      stats: debug.getStats()
    });
  });
  
  oscQueryService.on('error', (err) => {
    debug.error('OSC Query Service error', err);
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });
  // Set up WebSocket service event handlers
  setupWebSocketHandlers();
  // Start OSC Query HTTP server with dynamic port assignment
  oscQueryService.start((ports) => {
    const { httpPort, oscPort } = ports;
    debug.oscServiceStarted(httpPort, oscPort);
    serverConfig.localOscPort = oscPort;
    
    // Initialize OSC UDP service for sending only (no receiving)
    oscUdpService.initializeForSendingOnly(() => {
      debug.info(`OSC UDP sender ready - will send to port 9000`);
      discoveryService.startBonjourAdvertisement(httpPort, oscPort);
      discoveryService.startVRChatDiscovery((vrchatService) => {
        debug.vrchatServiceFound(vrchatService, 'Bonjour/HTTP discovery');
        sendToRenderer('vrchat-service-found', vrchatService);
      });
      sendToRenderer('osc-server-status', { 
        status: 'ready', 
        port: oscPort,
        httpPort: httpPort,
        message: 'OSC Query server running - receiving via HTTP, sending via UDP to port 9000'
      });
    });
  });
}

// Setup WebSocket event handlers
function setupWebSocketHandlers() {
  webSocketService.on('server-connection', (data) => {
    sendToRenderer('server-connection', data);
  });
  webSocketService.on('auth-required', () => {
    sendToRenderer('auth-required');
  });
  webSocketService.on('auth-success', (data) => {
    sendToRenderer('auth-success', data);
  });
  webSocketService.on('auth-failed', (data) => {
    sendToRenderer('auth-failed', data);
  });
  webSocketService.on('parameter-update', (data) => {
    sendToRenderer('parameter-update', data);
    if (data.address) {
      oscUdpService.sendOscToVRChat(data.address, data.value);
      oscQueryService.updateOscQueryParameter(data.address, data.value, data.type);
    }
  });
  webSocketService.on('user-avatar-info', (data) => {
    sendToRenderer('user-avatar-info', data);
  });
  webSocketService.on('server-error', (error) => {
    sendToRenderer('server-error', error);
  });
}

function sendToRenderer(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}

// IPC Handlers
ipcMain.handle('get-config', () => {
  return serverConfig;
});

ipcMain.handle('set-config', (event, newConfig) => {
  serverConfig = { ...serverConfig, ...newConfig };
  // Update OSC UDP service target config
  oscUdpService.setTargetConfig(serverConfig.targetOscAddress, serverConfig.targetOscPort);
  return serverConfig;
});

ipcMain.handle('connect-server', () => {
  webSocketService.connect(serverConfig.serverUrl);
});

ipcMain.handle('disconnect-server', () => {
  webSocketService.disconnect();
});

ipcMain.handle('authenticate', (event, credentials) => {
  webSocketService.authenticate(credentials);
});

ipcMain.handle('send-osc', (event, oscData) => {
  // Send to server via WebSocket
  webSocketService.sendOscMessage(oscData);
  
  // Send via OSC UDP to VRChat
  oscUdpService.sendOscToVRChat(oscData.address, oscData.value);
  oscQueryService.updateOscQueryParameter(oscData.address, oscData.value, oscData.type);
});

ipcMain.handle('get-user-avatar', () => {
  webSocketService.getUserAvatar();
});

ipcMain.handle('set-user-avatar', (event, avatarData) => {
  webSocketService.setUserAvatar(avatarData);
});

ipcMain.handle('get-parameters', () => {
  webSocketService.getParameters();
});

ipcMain.handle('get-debug-stats', () => {
  return debug.getStats();
});

// OSC Query Service handlers
ipcMain.handle('start-oscquery', async () => {
  try {
    if (!oscQueryService) {
      oscQueryService = new OscQueryService();
      
      // Set up event forwarding
      debug.on('oscQueryRequested', (path, ip) => {
        if (mainWindow) {
          mainWindow.webContents.send('oscquery-request', { path, ip });
        }
      });
    }
    
    return new Promise((resolve, reject) => {
      oscQueryService.start((result) => {
        if (result.httpPort && result.oscPort) {
          debug.info('OSC Query service started', result);
          if (mainWindow) {
            mainWindow.webContents.send('oscquery-status', {
              status: 'started',
              httpPort: result.httpPort,
              udpPort: result.oscPort
            });
          }
          resolve(result);
        } else {
          reject(new Error('Failed to start OSC Query service'));
        }
      });
    });
  } catch (error) {
    debug.error('Error starting OSC Query service', error);
    if (mainWindow) {
      mainWindow.webContents.send('oscquery-status', {
        status: 'error',
        error: error.message
      });
    }
    throw error;
  }
});

ipcMain.handle('stop-oscquery', async () => {
  try {
    if (oscQueryService) {
      oscQueryService.stop();
      debug.info('OSC Query service stopped');
      if (mainWindow) {
        mainWindow.webContents.send('oscquery-status', {
          status: 'stopped'
        });
      }
    }
    return { success: true };
  } catch (error) {
    debug.error('Error stopping OSC Query service', error);
    if (mainWindow) {
      mainWindow.webContents.send('oscquery-status', {
        status: 'error',
        error: error.message
      });
    }
    throw error;
  }
});

// App event handlers
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  debug.info('Application closing, cleaning up services...');
  discoveryService.stop();
  oscQueryService.stop();
  oscUdpService.close();
  webSocketService.disconnect();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  debug.info('Application preparing to quit, stopping services...');
  discoveryService.stop();
  oscQueryService.stop();
  oscUdpService.close();
  webSocketService.disconnect();
});
