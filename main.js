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
  localOscPort: null,  // Will be dynamically assigned by the system
  targetOscPort: 9000,
  targetOscAddress: '127.0.0.1'
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 500,
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

// Initialize OSC UDP communication separately from OSCQuery discovery
function initOscUDPPort() {
  if (oscUDPPort) {
    oscUDPPort.close();
  }

  // Create OSC UDP port for actual OSC message sending/receiving
  // This is completely separate from the OSCQuery discovery mechanism
  oscUDPPort = new osc.UDPPort({
    localAddress: "127.0.0.1",
    // Don't specify a port - let the system assign it dynamically
    metadata: true
  });

  oscUDPPort.on("ready", function () {
    const localInfo = oscUDPPort.options;
    console.log(`OSC UDP Server dynamically assigned to port ${localInfo.localPort}`);
    
    // Update our config to track the dynamically assigned port
    serverConfig.localOscPort = localInfo.localPort;

    // Send a dummy OSC message to VRChat to notify it that we are listening
    const notificationMessage = {
      address: "/avatar/parameters/OSCQueryActive",
      args: [{
        type: "T", // True value
        value: true
      }]
    };

    oscUDPPort.send(notificationMessage, serverConfig.targetOscAddress, serverConfig.targetOscPort);
    
    // Now that we have the actual UDP port, initialize the OSCQuery server
    initOscQueryServerWithPort(localInfo.localPort);
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
    
    // Update OSC Query server value if it exists and if the method exists
    if (oscQueryServer) {
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
    }
  });

  oscUDPPort.on("error", function (err) {
    console.error('OSC UDP Server error:', err);
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });

  // Open the UDP port and let the system assign a port number
  oscUDPPort.open();
}

// Initialize OSCQuery Server using the dynamically assigned UDP port
function initOscQueryServerWithPort(udpPort) {
  if (oscQueryServer) {
    oscQueryServer.stop();
  }

  const oscQueryHostName = 'ARC-OSC-Client';
  const serviceName = 'ARC-OSC-Client';

  // Create OSCQuery server with the dynamically assigned UDP port
  oscQueryServer = new OSCQueryServer({
    // Don't specify httpPort - let the server auto-assign it in the 11000-58000 range
    bindAddress: '127.0.0.1',
    rootDescription: 'ARC-OSC Client - VRChat OSC Interface',
    oscQueryHostName,
    oscIp: '127.0.0.1',
    oscPort: udpPort, // Use the dynamically assigned port from the UDP server
    oscTransport: 'UDP',
    serviceName
  });

  // Add common VRChat avatar parameters that we want to monitor BEFORE starting the server
  addVRChatParameters();

  oscQueryServer.start().then((hostInfo) => {
    console.log(`OSC Query Server started:`);
    console.log(`  - HTTP port (OSCQuery): ${hostInfo.http_port}`);
    console.log(`  - OSC port (UDP data): ${hostInfo.osc_port}`);
    console.log(`  - Service name: ${hostInfo.name}`);
    
    sendToRenderer('osc-server-status', { 
      status: 'connected', 
      port: hostInfo.osc_port,
      httpPort: hostInfo.http_port,
      serviceName: hostInfo.name
    });
  }).catch((err) => {
    console.error('OSC Query Server error:', err);
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });
}

// Main initialization function for OSC functionality
function initOscQueryServer() {
  // Start with the UDP port, which will then initialize the OSCQuery server
  // This ensures the correct flow: 
  // 1. Get a dynamic UDP port
  // 2. Create OSCQuery server with that port
  // 3. Advertise via mDNS
  initOscUDPPort();
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

  // Track discovered services to avoid duplicate logs
  const discoveredServices = new Set();

  oscQueryDiscovery.on('up', (service) => {
    // Ignore our own service (self-discovery) - check for any ARC-OSC-Client service
    // CIAO may rename our service to "ARC-OSC-Client (2)", "ARC-OSC-Client (3)", etc.
    if (service.hostInfo && service.hostInfo.name && 
        (service.hostInfo.name === 'ARC-OSC-Client' || 
         service.hostInfo.name.startsWith('ARC-OSC-Client ('))) {
      return;
    }
    
    // Use address+port+name as unique key
    const key = `${service.address}:${service.port}:${service.hostInfo && service.hostInfo.name}`;
    if (discoveredServices.has(key)) {
      return;
    }
    discoveredServices.add(key);
    
    console.log('Discovered OSC Query service:', {
      name: service.hostInfo?.name || 'Unknown',
      address: service.address,
      httpPort: service.port,
      oscPort: service.hostInfo?.oscPort,
      oscIp: service.hostInfo?.oscIp,
      transport: service.hostInfo?.oscTransport
    });
    
    // Check if this is VRChat (you might want to adjust this condition)
    if (service.hostInfo && service.hostInfo.name && 
        service.hostInfo.name.toLowerCase().includes('vrchat')) {
      vrchatService = service;
      console.log('VRChat OSC Query service found:', {
        name: service.hostInfo.name,
        httpPort: service.port,
        oscPort: service.hostInfo.oscPort,
        oscIp: service.hostInfo.oscIp
      });
      sendToRenderer('vrchat-service-found', service.hostInfo);
    }
  });

  oscQueryDiscovery.on('down', (service) => {
    // Ignore our own service
    if (service.hostInfo && service.hostInfo.name && 
        (service.hostInfo.name === 'ARC-OSC-Client' || 
         service.hostInfo.name.startsWith('ARC-OSC-Client ('))) {
      return;
    }
    const key = `${service.address}:${service.port}:${service.hostInfo && service.hostInfo.name}`;
    discoveredServices.delete(key);
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
  // Store old config for comparison
  const oldConfig = { ...serverConfig };
  
  // Update config
  serverConfig = { ...serverConfig, ...newConfig };
  
  // Always reinitialize OSC server when config changes to ensure proper port assignment
  if (oldConfig.targetOscPort !== serverConfig.targetOscPort || 
      oldConfig.targetOscAddress !== serverConfig.targetOscAddress) {
    console.log("Target OSC configuration changed, reinitializing...");
  }
  
  // We don't need to specify localOscPort anymore - system will assign it
  if (newConfig.localOscPort) {
    console.log("Note: localOscPort is now automatically assigned, your manual setting will be ignored");
  }
  
  // Reinitialize OSC components in the correct order
  if (oscUDPPort) {
    oscUDPPort.close();
    oscUDPPort = null;
  }
  
  if (oscQueryServer) {
    oscQueryServer.stop()
      .then(() => {
        oscQueryServer = null;
        // Start fresh with OSC initialization
        initOscQueryServer();
      })
      .catch(err => {
        console.error("Error stopping OSCQuery server:", err);
        oscQueryServer = null;
        initOscQueryServer();
      });
  } else {
    initOscQueryServer();
  }
  
  // Restart discovery service
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
  
  // First initialize the discovery to find other OSC services (like VRChat)
  initOscQueryDiscovery();
  
  // Then initialize our own OSCQuery server which will:
  // 1. Create a UDP socket with a dynamic port
  // 2. Once the port is assigned, create the OSCQuery server
  // 3. Advertise our service via mDNS
  initOscQueryServer();

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
