const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Client, Server } = require('node-osc');
const io = require('socket.io-client');
const debug = require('./utils/debugger');
let mainWindow;
let oscServer;
let oscClient;
let socket;
let serverConfig = {
  serverUrl: 'ws://localhost:3000',
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
}
function initOscServer() {
  if (oscServer) {
    oscServer.close();
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
    
    // Log OSC message through debugger
    debug.oscMessageReceived(address, value, type);
    
    if (socket && socket.connected) {
      socket.emit('osc-message', {
        address,
        value,
        type
      });
    }
    
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
}
function connectToServer() {
  if (socket) {
    socket.disconnect();
  }
  
  debug.info('Attempting to connect to ARC-OSC Server', { url: serverConfig.serverUrl });
  
  socket = io(`${serverConfig.serverUrl}/osc`, {
    withCredentials: true,
    transports: ['websocket', 'polling']
  });
  
  socket.on('connect', () => {
    console.log('Connected to ARC-OSC Server');
    debug.info('Successfully connected to ARC-OSC Server');
    sendToRenderer('server-connection', { status: 'connected' });
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from ARC-OSC Server');
    debug.warn('Disconnected from ARC-OSC Server');
    sendToRenderer('server-connection', { status: 'disconnected' });
  });
  socket.on('auth-required', () => {
    debug.info('Authentication required by server');
    sendToRenderer('auth-required');
  });
  
  socket.on('auth-success', (data) => {
    console.log('Authentication successful:', data);
    debug.info('Authentication successful', data);
    sendToRenderer('auth-success', data);
  });
  
  socket.on('auth-failed', (data) => {
    console.log('Authentication failed:', data);
    debug.warn('Authentication failed', data);
    sendToRenderer('auth-failed', data);
  });
  socket.on('parameter-update', (data) => {
    console.log('Parameter update:', data);
    debug.debug('Parameter update received', data);
    sendToRenderer('parameter-update', data);
    if (oscClient && data.address) {
      oscClient.send(data.address, data.value);
      debug.debug('Sent OSC parameter to VRChat', { address: data.address, value: data.value });
    }
  });
  
  socket.on('user-avatar-info', (data) => {
    console.log('User avatar info:', data);
    debug.info('User avatar info received', data);
    sendToRenderer('user-avatar-info', data);
  });
  
  socket.on('error', (error) => {
    console.error('Server error:', error);
    debug.error('Server connection error', error);
    sendToRenderer('server-error', error);
  });
  socket.on('heartbeat', (data) => {
    // Respond to server heartbeat
    socket.emit('heartbeat-response', data);
  });
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
  
  initOscServer();
  initOscClient();
  return serverConfig;
});
ipcMain.handle('connect-server', () => {
  connectToServer();
});
ipcMain.handle('disconnect-server', () => {
  if (socket) {
    socket.disconnect();
  }
});
ipcMain.handle('authenticate', (event, credentials) => {
  if (socket && socket.connected) {
    debug.info('Sending authentication request', { userId: credentials.userId });
    socket.emit('authenticate', credentials);
  } else {
    debug.warn('Authentication attempted but not connected to server');
  }
});
ipcMain.handle('send-osc', (event, oscData) => {
  if (socket && socket.connected) {
    debug.debug('Sending OSC message to server', oscData);
    socket.emit('osc-message', oscData);
  } else {
    debug.warn('OSC send attempted but not connected to server', oscData);
  }
});
ipcMain.handle('get-user-avatar', () => {
  if (socket && socket.connected) {
    socket.emit('get-user-avatar');
  }
});
ipcMain.handle('set-user-avatar', (event, avatarData) => {
  if (socket && socket.connected) {
    socket.emit('set-user-avatar', avatarData);
  }
});
ipcMain.handle('get-parameters', () => {
  if (socket && socket.connected) {
    socket.emit('get-parameters');
  }
});

// Debug-related IPC handlers
ipcMain.handle('get-debug-stats', () => {
  return debug.getStats();
});

ipcMain.handle('clear-debug-logs', () => {
  debug.clearOldLogs();
  debug.info('Debug logs cleared by user request');
});
app.whenReady().then(() => {
  debug.info('ARC-OSC Client starting up');
  createWindow();
  initOscServer();
  initOscClient();
  
  // Set up connection timeout check
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
  if (socket) socket.disconnect();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  debug.info('Application quit requested - cleaning up');
  if (oscServer) oscServer.close();
  if (oscClient) oscClient.close();
  if (socket) socket.disconnect();
});