const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Client, Server } = require('node-osc');
const io = require('socket.io-client');
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
    sendToRenderer('osc-server-status', { 
      status: 'connected', 
      port: serverConfig.localOscPort 
    });
  });
  oscServer.on('message', (msg) => {
    const [address, value] = msg;
    console.log('Received OSC:', address, value);
    if (socket && socket.connected) {
      socket.emit('osc-message', {
        address,
        value,
        type: typeof value === 'boolean' ? 'bool' : 
              typeof value === 'number' ? 
                (Number.isInteger(value) ? 'int' : 'float') : 'string'
      });
    }
    sendToRenderer('osc-received', { address, value });
  });
  oscServer.on('error', (err) => {
    console.error('OSC Server error:', err);
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });
}
function initOscClient() {
  if (oscClient) {
    oscClient.close();
  }

  oscClient = new Client(serverConfig.targetOscAddress, serverConfig.targetOscPort);
  console.log(`OSC Client targeting ${serverConfig.targetOscAddress}:${serverConfig.targetOscPort}`);
}
function connectToServer() {
  if (socket) {
    socket.disconnect();
  }
  socket = io(`${serverConfig.serverUrl}/osc`, {
    withCredentials: true,
    transports: ['websocket', 'polling']
  });
  socket.on('connect', () => {
    console.log('Connected to ARC-OSC Server');
    sendToRenderer('server-connection', { status: 'connected' });
  });
  socket.on('disconnect', () => {
    console.log('Disconnected from ARC-OSC Server');
    sendToRenderer('server-connection', { status: 'disconnected' });
  });
  socket.on('auth-required', () => {
    sendToRenderer('auth-required');
  });
  socket.on('auth-success', (data) => {
    console.log('Authentication successful:', data);
    sendToRenderer('auth-success', data);
  });
  socket.on('auth-failed', (data) => {
    console.log('Authentication failed:', data);
    sendToRenderer('auth-failed', data);
  });
  socket.on('parameter-update', (data) => {
    console.log('Parameter update:', data);
    sendToRenderer('parameter-update', data);
    if (oscClient && data.address) {
      oscClient.send(data.address, data.value);
    }
  });
  socket.on('user-avatar-info', (data) => {
    console.log('User avatar info:', data);
    sendToRenderer('user-avatar-info', data);
  });
  socket.on('error', (error) => {
    console.error('Server error:', error);
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
  serverConfig = { ...serverConfig, ...newConfig };
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
    socket.emit('authenticate', credentials);
  }
});
ipcMain.handle('send-osc', (event, oscData) => {
  if (socket && socket.connected) {
    socket.emit('osc-message', oscData);
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
app.whenReady().then(() => {
  createWindow();
  initOscServer();
  initOscClient();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on('window-all-closed', () => {
  if (oscServer) oscServer.close();
  if (oscClient) oscClient.close();
  if (socket) socket.disconnect();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('before-quit', () => {
  if (oscServer) oscServer.close();
  if (oscClient) oscClient.close();
  if (socket) socket.disconnect();
});