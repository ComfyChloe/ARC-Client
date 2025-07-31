const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Import utility services
const OscQueryService = require('./utils/oscQueryService');
const DiscoveryService = require('./utils/discoveryService');
const OscUdpService = require('./utils/oscUdpService');
const WebSocketService = require('./utils/websocketService');

let mainWindow;
let serverConfig = {
  serverUrl: 'ws://localhost:3000',
  localOscPort: 9001,
  targetOscPort: 9000,
  targetOscAddress: '127.0.0.1'
};

// Service instances
let oscQueryService = new OscQueryService();
let discoveryService = new DiscoveryService();
let oscUdpService = new OscUdpService();
let webSocketService = new WebSocketService();

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

// Initialize OSC Query Server
function initOscQueryServer() {
  // Set up OSC UDP service target config
  oscUdpService.setTargetConfig(serverConfig.targetOscAddress, serverConfig.targetOscPort);
  
  // Set up OSC Query service event handlers
  oscQueryService.on('sendOsc', (data) => {
    oscUdpService.sendOscToVRChat(data.address, data.value);
  });

  oscQueryService.on('error', (err) => {
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });

  // Set up WebSocket service event handlers
  setupWebSocketHandlers();

  // Start OSC Query HTTP server
  oscQueryService.start((httpPort) => {
    // Start Bonjour advertisement
    discoveryService.startBonjourAdvertisement(httpPort, serverConfig.localOscPort);
    
    // Start VRChat discovery
    discoveryService.startVRChatDiscovery((vrchatService) => {
      console.log('VRChat found, starting OSC UDP service...');
      registerWithVRChat(vrchatService);
      sendToRenderer('vrchat-service-found', vrchatService);
    });
    
    sendToRenderer('osc-server-status', { 
      status: 'http-ready', 
      port: null,
      httpPort: httpPort
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
    
    // Send to VRChat via OSC UDP
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

// Register with VRChat
function registerWithVRChat(vrchatService) {
  console.log('Registering with VRChat OSC Query service...');
  
  // Find available port and start OSC UDP server
  oscUdpService.findAvailablePort(serverConfig.localOscPort, (port) => {
    console.log(`Starting OSC UDP on available port: ${port}`);
    
    oscUdpService.createOscUDPPort(
      port,
      // onReady callback
      (assignedPort) => {
        oscQueryService.setAssignedOscPort(assignedPort);
        discoveryService.updateBonjourService(oscQueryService.httpPort, assignedPort);
        
        sendToRenderer('osc-server-status', { 
          status: 'connected', 
          port: assignedPort,
          httpPort: oscQueryService.httpPort
        });
        
        console.log('OSC Query service fully ready - VRChat should now detect us');
      },
      // onMessage callback
      (oscData) => {
        // Update OSC Query data structure
        oscQueryService.updateOscQueryParameter(oscData.address, oscData.value, oscData.type);
        
        // Forward to server via WebSocket
        webSocketService.sendOscMessage(oscData);
        
        // Send to renderer for UI updates
        sendToRenderer('osc-received', { address: oscData.address, value: oscData.value });
      },
      // onError callback
      (err) => {
        sendToRenderer('osc-server-status', { status: 'error', error: err.message });
      }
    );
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
  // Reinitialize connections with new config
  initOscQueryServer();
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

// App event handlers
app.whenReady().then(() => {
  createWindow();
  initOscQueryServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  discoveryService.stop();
  oscQueryService.stop();
  oscUdpService.close();
  webSocketService.disconnect();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  discoveryService.stop();
  oscQueryService.stop();
  oscUdpService.close();
  webSocketService.disconnect();
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  discoveryService.stop();
  oscQueryService.stop();
  oscUdpService.close();
  if (socket) socket.disconnect();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  discoveryService.stop();
  oscQueryService.stop();
  oscUdpService.close();
  if (socket) socket.disconnect();
});
function initOscQueryDiscovery() {
  console.log('Starting VRChat discovery with Bonjour...');
  
  // Browse for VRChat OSC Query services
  vrchatBrowser = bonjour.find({ type: 'oscjson', protocol: 'tcp' }, (service) => {
    console.log('Found OSC Query service:', service);
    
    // Check if this is VRChat (look for VRChat in the name)
    if (service.name && service.name.toLowerCase().includes('vrchat')) {
      console.log('Found VRChat OSC Query service via Bonjour:', service);
      
      vrchatService = {
        address: '127.0.0.1', // Always use localhost for VRChat
        port: service.port,
        info: service
      };
      
      // Try to get VRChat's OSC Query data, but don't fail if it doesn't work
      getVRChatOscQueryData(vrchatService, (data) => {
        if (data) {
          vrchatService.oscData = data;
          console.log('Retrieved VRChat OSC Query data');
        }
        
        // Register our service with VRChat
        registerWithVRChat(vrchatService);
        
        sendToRenderer('vrchat-service-found', vrchatService);
      });
    } else if (service.name && service.name.includes('ARC-OSC-Client')) {
      // This is our own service, ignore it
      console.log('Ignoring our own service advertisement');
    }
  });

  // Also try direct HTTP scanning as fallback
  setTimeout(() => {
    if (!vrchatService) {
      console.log('Bonjour discovery incomplete, trying direct HTTP scan...');
      scanForVRChatHTTP();
    }
  }, 3000);
  
  console.log('OSC Query Discovery with Bonjour started');
}

// Fallback HTTP scanning for VRChat
function scanForVRChatHTTP() {
  const commonPorts = [9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010];
  let foundVRChat = false;
  
  const checkPort = (port, index) => {
    setTimeout(() => {
      if (foundVRChat || vrchatService) return;
      
      const testUrl = `http://127.0.0.1:${port}`;
      
      const req = http.get(testUrl, { 
        timeout: 1000,
        headers: {
          'User-Agent': 'ARC-OSC-Client/1.0',
          'Accept': 'application/json',
          'Connection': 'close'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.DESCRIPTION && (
              parsed.DESCRIPTION.toLowerCase().includes('vrchat') ||
              parsed.DESCRIPTION.toLowerCase().includes('avatar') ||
              (parsed.CONTENTS && parsed.CONTENTS.avatar)
            )) {
              foundVRChat = true;
              vrchatService = { 
                address: '127.0.0.1', 
                port: port, 
                info: { name: 'VRChat-HTTP-Scan' },
                oscData: parsed
              };
              console.log('Found VRChat OSC Query service via HTTP scan:', vrchatService);
              
              // Register our service with VRChat
              registerWithVRChat(vrchatService);
              
              sendToRenderer('vrchat-service-found', vrchatService);
            }
          } catch (err) {
            // Not VRChat or invalid JSON
          }
        });
      });
      
      req.on('error', () => {
        // Port not responding
      });
      
      req.on('timeout', () => {
        req.destroy();
      });
      
    }, index * 100); // Stagger requests
  };
  
  commonPorts.forEach(checkPort);
  
  // If no VRChat found after 5 seconds, fall back to default port
  setTimeout(() => {
    if (!foundVRChat && !vrchatService) {
      console.log('VRChat not found, using default OSC port configuration');
      // Check if port is available before binding
      findAvailablePort(serverConfig.localOscPort, (port) => {
        console.log(`Using available port: ${port}`);
        createOscUDPPort(port);
      });
    }
  }, 5000);
}

// Update Bonjour service when OSC port changes
function updateBonjourService() {
  if (bonjourService) {
    // Stop current service
    bonjourService.stop();
  }
  
  // Restart with updated port info
  bonjourService = bonjour.publish({
    name: 'ARC-OSC-Client',
    type: 'oscjson',
    protocol: 'tcp',
    port: httpPort,
    host: '127.0.0.1',
    txt: {
      txtvers: '1',
      oscport: (assignedOscPort || serverConfig.localOscPort).toString(),
      oscip: '127.0.0.1',
      osctransport: 'UDP'
    }
  });
  
  bonjourService.on('up', () => {
    console.log(`Bonjour service updated with OSC port: ${assignedOscPort || serverConfig.localOscPort}`);
  });
  
  bonjourService.on('error', (err) => {
    console.error('Bonjour service update error:', err);
  });
}

// Create OSC UDP Port after finding available port
function createOscUDPPort(port) {
  if (oscUDPPort) {
    oscUDPPort.close();
  }

  assignedOscPort = port;
  
  // Create OSC UDP port for receiving messages
  oscUDPPort = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: port,
    metadata: true
  });

  oscUDPPort.on("ready", function () {
    console.log(`OSC UDP Server listening on port ${port}`);
    
    // Update Bonjour service with actual port
    updateBonjourService();
    
    sendToRenderer('osc-server-status', { 
      status: 'connected', 
      port: port,
      httpPort: httpPort
    });
    
    console.log('OSC Query service fully ready - VRChat should now detect us');
  });

  oscUDPPort.on("message", function (oscMsg) {
    console.log('Received OSC:', oscMsg.address, oscMsg.args);
    
    // Extract value from OSC message
    const value = oscMsg.args && oscMsg.args.length > 0 ? oscMsg.args[0].value : null;
    
    // Update our OSC Query data structure
    updateOscQueryParameter(oscMsg.address, value, oscMsg.args[0]?.type || 'f');
    
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
  });

  oscUDPPort.on("error", function (err) {
    console.error('OSC UDP Server error:', err);
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });

  oscUDPPort.open();
}

// Update OSC Query parameter in data structure
function updateOscQueryParameter(address, value, oscType = 'f') {
  const pathParts = address.split('/').filter(part => part.length > 0);
  let current = oscQueryData.CONTENTS;
  
  // Navigate/create the path structure
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];
    if (!current[part]) {
      current[part] = {
        DESCRIPTION: `Container: ${part}`,
        FULL_PATH: '/' + pathParts.slice(0, i + 1).join('/'),
        ACCESS: 0,
        CONTENTS: {}
      };
    }
    current = current[part].CONTENTS;
  }
  
  // Set the final parameter
  const paramName = pathParts[pathParts.length - 1];
  if (paramName) {
    let typeInfo = getTypeInfo(value, oscType);
    
    current[paramName] = {
      DESCRIPTION: `Parameter: ${address}`,
      FULL_PATH: address,
      ACCESS: 3, // Read/Write
      TYPE: typeInfo.type,
      VALUE: [value]
    };
    
    if (typeInfo.range) {
      current[paramName].RANGE = typeInfo.range;
    }
  }
}

// Get type information for OSC Query
function getTypeInfo(value, oscType) {
  if (typeof value === 'boolean' || oscType === 'T' || oscType === 'F') {
    return { type: 'T', range: [{ MIN: false, MAX: true }] };
  } else if (typeof value === 'number') {
    if (Number.isInteger(value) || oscType === 'i') {
      return { type: 'i', range: [{ MIN: -2147483648, MAX: 2147483647 }] };
    } else {
      return { type: 'f', range: [{ MIN: -1.0, MAX: 1.0 }] };
    }
  } else if (typeof value === 'string' || oscType === 's') {
    return { type: 's' };
  }
  return { type: 'f', range: [{ MIN: -1.0, MAX: 1.0 }] };
}

// Get OSC Query data for a specific path
function getOscQueryPath(requestPath) {
  if (requestPath === '/') {
    return {
      ...oscQueryData,
      OSC_PORT: serverConfig.localOscPort,
      OSC_TRANSPORT: 'UDP'
    };
  }
  
  const pathParts = requestPath.split('/').filter(part => part.length > 0);
  let current = oscQueryData.CONTENTS;
  
  for (const part of pathParts) {
    if (current[part]) {
      current = current[part];
      if (current.CONTENTS) {
        current = current.CONTENTS;
      } else {
        // This is a leaf node (parameter)
        return current;
      }
    } else {
      return null;
    }
  }
  
  return current;
}

// Send OSC message to VRChat
function sendOscToVRChat(address, value) {
  if (!oscUDPPort) {
    console.warn('OSC UDP port not ready, cannot send message');
    return;
  }
  
  try {
    let oscType = 'f';
    let oscValue = value;
    
    if (typeof value === 'boolean') {
      oscType = value ? 'T' : 'F';
      oscValue = value;
    } else if (typeof value === 'string') {
      oscType = 's';
    } else if (typeof value === 'number') {
      oscType = Number.isInteger(value) ? 'i' : 'f';
    }
    
    const oscMessage = {
      address: address,
      args: [{
        type: oscType,
        value: oscValue
      }]
    };

    oscUDPPort.send(oscMessage, serverConfig.targetOscAddress, serverConfig.targetOscPort);
    console.log(`Sent OSC to VRChat: ${address} = ${value}`);
  } catch (err) {
    console.error('Error sending OSC to VRChat:', err);
  }
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
    
    // Send to VRChat via OSC UDP only if port is ready
    if (oscUDPPort && data.address) {
      sendOscToVRChat(data.address, data.value);
      
      // Update our OSC Query data structure
      updateOscQueryParameter(data.address, data.value, data.type);
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
  
  // Send via OSC UDP to VRChat only if port is ready
  if (oscUDPPort) {
    sendOscToVRChat(oscData.address, oscData.value);
    
    // Update our OSC Query data structure
    updateOscQueryParameter(oscData.address, oscData.value, oscData.type);
  } else {
    console.warn('OSC UDP port not ready, message queued');
    // Could implement a queue here if needed
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
  // Only start HTTP server first, OSC UDP will be created after VRChat discovery
  initOscQueryServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (bonjourService) bonjourService.stop();
  if (vrchatBrowser) vrchatBrowser.stop();
  if (oscQueryHttpServer) oscQueryHttpServer.close();
  if (oscUDPPort) oscUDPPort.close();
  if (socket) socket.disconnect();
  bonjour.destroy();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (bonjourService) bonjourService.stop();
  if (vrchatBrowser) vrchatBrowser.stop();
  if (oscQueryHttpServer) oscQueryHttpServer.close();
  if (oscUDPPort) oscUDPPort.close();
  if (socket) socket.disconnect();
  bonjour.destroy();
});
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
  // Only start HTTP server first, OSC UDP will be created after VRChat discovery
  initOscQueryServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (bonjourService) bonjourService.stop();
  if (vrchatBrowser) vrchatBrowser.stop();
  if (oscQueryHttpServer) oscQueryHttpServer.close();
  if (oscUDPPort) oscUDPPort.close();
  if (socket) socket.disconnect();
  bonjour.destroy();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (bonjourService) bonjourService.stop();
  if (vrchatBrowser) vrchatBrowser.stop();
  if (oscQueryHttpServer) oscQueryHttpServer.close();
  if (oscUDPPort) oscUDPPort.close();
  if (socket) socket.disconnect();
  bonjour.destroy();
});
