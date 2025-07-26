const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { OSCQueryServer, OSCQueryDiscovery, OSCTypeSimple, OSCQAccess } = require('./lib/oscquery');
const osc = require('osc');
const io = require('socket.io-client');

let mainWindow;
let oscQueryServer;
let oscQueryDiscovery;
let oscUDPPort;
let vrchatService = null;
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

// Initialize OSC Query Server (to communicate with VRChat)
function initOscQueryServer() {
  if (oscQueryServer) {
    oscQueryServer.stop();
  }
  
  if (oscUDPPort) {
    oscUDPPort.close();
  }

  // Create OSC UDP port for receiving messages
  oscUDPPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: serverConfig.localOscPort,
    metadata: true
  });

  oscUDPPort.on("ready", function () {
    console.log(`OSC UDP Server listening on port ${serverConfig.localOscPort}`);
  });

  oscUDPPort.on("message", function (oscMsg) {
    console.log('Received OSC:', oscMsg.address, oscMsg.args);
    
    // Extract value from OSC message
    const value = oscMsg.args && oscMsg.args.length > 0 ? oscMsg.args[0].value : null;
    
    // Forward to server via WebSocket
    if (socket && socket.connected) {
      socket.emit('osc-message', {
        address: oscMsg.address,
        value: value,
        type: oscMsg.args && oscMsg.args.length > 0 ? oscMsg.args[0].type : 'f'
      });
    }
    
    // Send to renderer for UI updates
    sendToRenderer('osc-received', { address: oscMsg.address, value: value });
    
    // Update OSC Query server value if the method exists
    try {
      oscQueryServer.setValue(oscMsg.address, 0, value);
    } catch (err) {
      // Method might not exist, try to add it
      try {
        let oscType = OSCTypeSimple.FLOAT;
        if (typeof value === 'boolean') {
          oscType = value ? OSCTypeSimple.TRUE : OSCTypeSimple.FALSE;
        } else if (typeof value === 'string') {
          oscType = OSCTypeSimple.STRING;
        } else if (typeof value === 'number') {
          oscType = Number.isInteger(value) ? OSCTypeSimple.INT : OSCTypeSimple.FLOAT;
        }

        oscQueryServer.addMethod(oscMsg.address, {
          description: `Parameter: ${oscMsg.address}`,
          access: OSCQAccess.READWRITE,
          arguments: [{
            type: oscType,
            value: value
          }]
        });
        
        oscQueryServer.setValue(oscMsg.address, 0, value);
      } catch (addErr) {
        console.error('Error adding OSC Query method:', addErr);
      }
    }
  });

  oscUDPPort.on("error", function (err) {
    console.error('OSC UDP Server error:', err);
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });

  oscUDPPort.open();

  // Generate random port between 11,000 and 58,000 for OSC Query HTTP server
  // But make sure it's different from the OSC UDP port
  let randomHttpPort;
  do {
    randomHttpPort = Math.floor(Math.random() * (58000 - 11000 + 1)) + 11000;
  } while (randomHttpPort === serverConfig.localOscPort);

  // Create OSC Query server with VRChat-compatible settings
  oscQueryServer = new OSCQueryServer({
    httpPort: randomHttpPort, // Random HTTP port
    bindAddress: '0.0.0.0', // Bind to all interfaces so VRChat can discover it
    rootDescription: 'ARC-OSC Client - VRChat OSC Interface',
    oscQueryHostName: 'ARC-OSC-Client',
    oscIp: '127.0.0.1',
    oscPort: serverConfig.localOscPort, // OSC UDP on the configured port
    oscTransport: 'UDP',
    serviceName: 'ARC-OSC-Client'
  });

  // Add common VRChat avatar parameters that we want to monitor BEFORE starting the server
  addVRChatParameters();

  oscQueryServer.start().then((hostInfo) => {
    console.log(`OSC Query Server started on HTTP port ${hostInfo.http_port}, OSC port ${hostInfo.osc_port}`);
    sendToRenderer('osc-server-status', { 
      status: 'connected', 
      port: hostInfo.osc_port,
      httpPort: hostInfo.http_port
    });
  }).catch((err) => {
    console.error('OSC Query Server error:', err);
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });
}

// Add common VRChat parameters to monitor
function addVRChatParameters() {
  // Add the avatar parameter container first
  try {
    oscQueryServer.addMethod('/avatar', {
      description: 'VRChat Avatar parameters container',
      access: OSCQAccess.NO_VALUE,
    });
  } catch (err) {
    // Container might already exist
  }

  try {
    oscQueryServer.addMethod('/avatar/parameters', {
      description: 'VRChat Avatar parameters',
      access: OSCQAccess.NO_VALUE,
    });
  } catch (err) {
    // Container might already exist
  }

  // Common VRChat avatar parameters - these are the standard ones VRChat expects
  const commonParams = [
    // Input parameters (what VRChat sends)
    { path: '/avatar/parameters/VRCEmote', type: OSCTypeSimple.INT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/GestureLeft', type: OSCTypeSimple.INT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/GestureRight', type: OSCTypeSimple.INT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/GestureLeftWeight', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/GestureRightWeight', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/AngularY', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/VelocityX', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/VelocityY', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/VelocityZ', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/Upright', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/Grounded', type: OSCTypeSimple.TRUE, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/Seated', type: OSCTypeSimple.TRUE, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/AFK', type: OSCTypeSimple.TRUE, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/InStation', type: OSCTypeSimple.TRUE, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/Viseme', type: OSCTypeSimple.INT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/Voice', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/MuteSelf', type: OSCTypeSimple.TRUE, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/VRMode', type: OSCTypeSimple.INT, access: OSCQAccess.READONLY },
    { path: '/avatar/parameters/TrackingType', type: OSCTypeSimple.INT, access: OSCQAccess.READONLY },
    
    // Commonly used custom parameters that might be writable
    { path: '/avatar/parameters/VRCFaceBlendH', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READWRITE },
    { path: '/avatar/parameters/VRCFaceBlendV', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READWRITE },
    
    // Add some example custom avatar parameters that applications commonly use
    { path: '/avatar/parameters/Example_Bool', type: OSCTypeSimple.TRUE, access: OSCQAccess.READWRITE },
    { path: '/avatar/parameters/Example_Int', type: OSCTypeSimple.INT, access: OSCQAccess.READWRITE },
    { path: '/avatar/parameters/Example_Float', type: OSCTypeSimple.FLOAT, access: OSCQAccess.READWRITE },
  ];

  // Add input container
  try {
    oscQueryServer.addMethod('/input', {
      description: 'VRChat Input parameters container',
      access: OSCQAccess.NO_VALUE,
    });
  } catch (err) {
    // Container might already exist
  }

  // Input parameters (for receiving input from external applications)
  const inputParams = [
    { path: '/input/Jump', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/Run', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/ComfortLeft', type: OSCTypeSimple.FLOAT, access: OSCQAccess.WRITEONLY },
    { path: '/input/ComfortRight', type: OSCTypeSimple.FLOAT, access: OSCQAccess.WRITEONLY },
    { path: '/input/DropRight', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/UseRight', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/GrabRight', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/DropLeft', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/UseLeft', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/GrabLeft', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/PanicButton', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/QuickMenuToggleLeft', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/QuickMenuToggleRight', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
    { path: '/input/Voice', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
  ];

  // Add chatbox container and parameters
  try {
    oscQueryServer.addMethod('/chatbox', {
      description: 'VRChat Chatbox parameters container',
      access: OSCQAccess.NO_VALUE,
    });
  } catch (err) {
    // Container might already exist
  }

  const chatboxParams = [
    { path: '/chatbox/input', type: OSCTypeSimple.STRING, access: OSCQAccess.WRITEONLY },
    { path: '/chatbox/typing', type: OSCTypeSimple.TRUE, access: OSCQAccess.WRITEONLY },
  ];

  // Combine all parameters
  const allParams = [...commonParams, ...inputParams, ...chatboxParams];

  allParams.forEach(param => {
    try {
      oscQueryServer.addMethod(param.path, {
        description: `VRChat parameter: ${param.path}`,
        access: param.access,
        arguments: [{
          type: param.type
        }]
      });
    } catch (err) {
      // Method might already exist, ignore
      console.log(`Parameter ${param.path} already exists or failed to add:`, err.message);
    }
  });

  console.log(`Added ${allParams.length} VRChat OSC parameters to OSC Query server`);
}

// Initialize OSC Query Discovery (to find and communicate with VRChat)
function initOscQueryDiscovery() {
  if (oscQueryDiscovery) {
    oscQueryDiscovery.stop();
  }

  oscQueryDiscovery = new OSCQueryDiscovery();
  
  oscQueryDiscovery.on('up', (service) => {
    console.log('Discovered OSC Query service:', service.hostInfo);
    // Check if this is VRChat (you might want to adjust this condition)
    if (service.hostInfo.name && service.hostInfo.name.toLowerCase().includes('vrchat')) {
      vrchatService = service;
      console.log('VRChat OSC Query service found:', service.hostInfo);
      sendToRenderer('vrchat-service-found', service.hostInfo);
    }
  });

  oscQueryDiscovery.on('down', (service) => {
    console.log('OSC Query service went down:', service.hostInfo);
    if (vrchatService && vrchatService.address === service.address && vrchatService.port === service.port) {
      vrchatService = null;
      sendToRenderer('vrchat-service-lost');
    }
  });

  oscQueryDiscovery.start();
  console.log('OSC Query Discovery started');
}

// Connect to ARC-OSC Server
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
    
    // Send to VRChat via OSC UDP
    if (data.address) {
      try {
        // Create OSC message
        const oscMessage = {
          address: data.address,
          args: [{
            type: typeof data.value === 'boolean' ? (data.value ? 'T' : 'F') :
                  typeof data.value === 'string' ? 's' :
                  typeof data.value === 'number' ? 
                    (Number.isInteger(data.value) ? 'i' : 'f') : 'f',
            value: data.value
          }]
        };

        // Send via UDP to VRChat
        oscUDPPort.send(oscMessage, serverConfig.targetOscAddress, serverConfig.targetOscPort);
        
        // Also update our OSC Query server for discoverability
        try {
          let oscType = OSCTypeSimple.FLOAT;
          if (typeof data.value === 'boolean') {
            oscType = data.value ? OSCTypeSimple.TRUE : OSCTypeSimple.FALSE;
          } else if (typeof data.value === 'string') {
            oscType = OSCTypeSimple.STRING;
          } else if (typeof data.value === 'number') {
            oscType = Number.isInteger(data.value) ? OSCTypeSimple.INT : OSCTypeSimple.FLOAT;
          }

          oscQueryServer.addMethod(data.address, {
            description: `Parameter: ${data.address}`,
            access: OSCQAccess.READWRITE,
            arguments: [{
              type: oscType,
              value: data.value
            }]
          });
          
          oscQueryServer.setValue(data.address, 0, data.value);
        } catch (oscQueryErr) {
          // OSC Query update failed, but OSC message was sent
          console.warn('OSC Query update failed:', oscQueryErr);
        }
      } catch (err) {
        console.error('Error sending OSC message:', err);
      }
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

// IPC Handlers
ipcMain.handle('get-config', () => {
  return serverConfig;
});

ipcMain.handle('set-config', (event, newConfig) => {
  serverConfig = { ...serverConfig, ...newConfig };
  // Reinitialize connections with new config
  initOscQueryServer();
  initOscQueryDiscovery();
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
  
  // Send via OSC UDP to VRChat
  if (oscData.address) {
    try {
      // Create OSC message
      const oscMessage = {
        address: oscData.address,
        args: [{
          type: typeof oscData.value === 'boolean' ? (oscData.value ? 'T' : 'F') :
                typeof oscData.value === 'string' ? 's' :
                typeof oscData.value === 'number' ? 
                  (Number.isInteger(oscData.value) ? 'i' : 'f') : 'f',
          value: oscData.value
        }]
      };

      // Send via UDP to VRChat
      oscUDPPort.send(oscMessage, serverConfig.targetOscAddress, serverConfig.targetOscPort);
      
      // Also update our OSC Query server for discoverability
      try {
        let oscType = OSCTypeSimple.FLOAT;
        if (typeof oscData.value === 'boolean') {
          oscType = oscData.value ? OSCTypeSimple.TRUE : OSCTypeSimple.FALSE;
        } else if (typeof oscData.value === 'string') {
          oscType = OSCTypeSimple.STRING;
        } else if (typeof oscData.value === 'number') {
          oscType = Number.isInteger(oscData.value) ? OSCTypeSimple.INT : OSCTypeSimple.FLOAT;
        }

        oscQueryServer.addMethod(oscData.address, {
          description: `Parameter: ${oscData.address}`,
          access: OSCQAccess.READWRITE,
          arguments: [{
            type: oscType,
            value: oscData.value
          }]
        });
        
        oscQueryServer.setValue(oscData.address, 0, oscData.value);
      } catch (oscQueryErr) {
        // OSC Query update failed, but OSC message was sent
        console.warn('OSC Query update failed:', oscQueryErr);
      }
    } catch (err) {
      console.error('Error sending OSC message:', err);
    }
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

// App event handlers
app.whenReady().then(() => {
  createWindow();
  initOscQueryServer();
  initOscQueryDiscovery();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (oscQueryServer) oscQueryServer.stop();
  if (oscQueryDiscovery) oscQueryDiscovery.stop();
  if (oscUDPPort) oscUDPPort.close();
  if (socket) socket.disconnect();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (oscQueryServer) oscQueryServer.stop();
  if (oscQueryDiscovery) oscQueryDiscovery.stop();
  if (oscUDPPort) oscUDPPort.close();
  if (socket) socket.disconnect();
});
