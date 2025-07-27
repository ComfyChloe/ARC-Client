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
  localOscPort: 9002,  // Use port 9002 since VRChat is blocking 9001
  targetOscPort: 9000, // Send TO VRChat on port 9000 (where VRChat listens)
  targetOscAddress: '127.0.0.1'
};

// State tracking to prevent duplicate initializations
let oscQueryServerInitialized = false;
let oscUdpPortInitialized = false;
let discoveryInitialized = false;

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

// Initialize OSC Query Server (to communicate with VRChat)
function initOscQueryServer() {
  if (oscQueryServerInitialized) {
    console.log('OSCQuery server already initialized, skipping');
    return;
  }

  if (oscQueryServer) {
    oscQueryServer.stop();
  }
  
  // Don't bind UDP port yet - wait for VRChat to discover us first
  if (oscUDPPort) {
    oscUDPPort.close();
    oscUDPPort = null;
    oscUdpPortInitialized = false;
  }

  // OSCQuery server configuration - let it auto-assign the HTTP port
  const oscQueryHostName = 'ARC-OSC-Client';
  const serviceName = 'ARC-OSC-Client';

  oscQueryServer = new OSCQueryServer({
    // Don't specify httpPort - let the server auto-assign it
    bindAddress: '127.0.0.1',
    rootDescription: 'ARC-OSC Client - VRChat OSC Interface',
    oscQueryHostName,
    oscIp: '127.0.0.1',
    oscPort: serverConfig.localOscPort, // This tells VRChat what port we'll listen on
    oscTransport: 'UDP',
    serviceName
  });

  // Add common VRChat avatar parameters that we want to monitor BEFORE starting the server
  addVRChatParameters();

  oscQueryServer.start().then((hostInfo) => {
    oscQueryServerInitialized = true;
    console.log(`OSC Query Server started (HTTP only for discovery):`);
    console.log(`  - HTTP port (OSCQuery): ${hostInfo.http_port}`);
    console.log(`  - Advertised OSC port: ${hostInfo.osc_port} (not bound yet)`);
    console.log(`  - Service name: ${hostInfo.name}`);
    console.log(`  - Waiting for VRChat to discover this service...`);
    
    // Listen for the first HTTP request from VRChat (only once)
    oscQueryServer.once('first-request', (requestInfo) => {
      console.log(`VRChat has discovered our service! First request from ${requestInfo.remoteAddress}`);
      console.log('Now creating UDP port for OSC data...');
      createOscUdpPort();
    });
    
    sendToRenderer('osc-server-status', { 
      status: 'discovering', 
      port: hostInfo.osc_port,
      httpPort: hostInfo.http_port,
      serviceName: hostInfo.name,
      message: 'Waiting for VRChat discovery'
    });
  }).catch((err) => {
    console.error('OSC Query Server error:', err);
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });
}

// Create UDP port only when VRChat has discovered us and is ready to send data
function createOscUdpPort() {
  if (oscUdpPortInitialized || oscUDPPort) {
    console.log('UDP port already exists, skipping creation');
    return;
  }

  oscUdpPortInitialized = true;
  console.log(`Creating OSC UDP port on ${serverConfig.localOscPort} (VRChat is ready to send data)`);

  // Create OSC UDP port for receiving messages
  oscUDPPort = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: serverConfig.localOscPort,
    metadata: true
  });

  oscUDPPort.on("ready", function () {
    console.log(`OSC UDP Server now listening on port ${serverConfig.localOscPort}`);
    console.log(`VRChat can now send OSC data to this port`);
    console.log(`Will send OSC messages to VRChat on ${serverConfig.targetOscAddress}:${serverConfig.targetOscPort}`);

    sendToRenderer('osc-server-status', { 
      status: 'connected', 
      port: serverConfig.localOscPort,
      message: 'Ready to receive OSC data from VRChat'
    });
    
    // If VRChat service is available, explicitly tell it to send data to our port
    if (vrchatService) {
      notifyVRChatAboutOurPort(vrchatService);
    }

    // Send a dummy OSC message to VRChat to notify it that we are listening
    const notificationMessage = {
      address: "/avatar/parameters/OSCQueryActive",
      args: [{
        type: "T", // True value
        value: true
      }]
    };

    oscUDPPort.send(notificationMessage, serverConfig.targetOscAddress, serverConfig.targetOscPort);
    console.log("Sent OSCQueryActive notification to VRChat");

    // Send periodic heartbeat to VRChat to maintain connection
    setInterval(() => {
      try {
        oscUDPPort.send(notificationMessage, serverConfig.targetOscAddress, serverConfig.targetOscPort);
        console.log("Sent heartbeat to VRChat");
      } catch (err) {
        console.error("Error sending heartbeat to VRChat:", err);
      }
    }, 30000); // Every 30 seconds
  });

  oscUDPPort.on("message", function (oscMsg) {
    // Special handling for voice parameter as it comes frequently
    if (oscMsg.address === '/input/Voice') {
      console.log('Received Voice OSC data:', oscMsg.args[0].value);
    } else {
      console.log('Received OSC:', oscMsg.address, oscMsg.args);
    }
    
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
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${serverConfig.localOscPort} is already in use. VRChat might already be using it, or another OSC application is running.`);
      console.error('Try closing VRChat, other OSC apps, or change the localOscPort in config.');
    }
    sendToRenderer('osc-server-status', { status: 'error', error: err.message });
  });

  oscUDPPort.open();
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
  if (discoveryInitialized) {
    console.log('OSCQuery discovery already initialized, skipping');
    return;
  }

  if (oscQueryDiscovery) {
    oscQueryDiscovery.stop();
  }

  discoveryInitialized = true;
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
      
      // Update our target config to match VRChat's actual OSC port
      if (service.hostInfo.oscPort !== serverConfig.targetOscPort) {
        console.log(`Updating target OSC port from ${serverConfig.targetOscPort} to ${service.hostInfo.oscPort}`);
        serverConfig.targetOscPort = service.hostInfo.oscPort;
      }
      
      // If we have a UDP port listening, tell VRChat about it
      if (oscUDPPort) {
        notifyVRChatAboutOurPort(service);
      }
      
      // Try to query VRChat's available parameters
      queryVRChatParameters(service);
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

// Explicitly tell VRChat where to send OSC data
async function notifyVRChatAboutOurPort(service) {
  try {
    console.log('Explicitly telling VRChat to send data to our port...');
    const axios = require('axios');
    const vrcHttpPort = service.port;
    const vrcAddress = service.address;
    
    // First, get VRChat's configuration to see what we're dealing with
    const hostInfoUrl = `http://${vrcAddress}:${vrcHttpPort}/?HOST_INFO`;
    const hostInfo = await axios.get(hostInfoUrl);
    console.log('VRChat HOST_INFO:', hostInfo.data);
    
    // VRChat OSCQuery protocol requires a specific format for streaming request
    // We need to send ?STREAMING as a URL parameter, not in the body
    // See: https://github.com/vrchat/oscquery/issues/5
    const streamingUrl = `http://${vrcAddress}:${vrcHttpPort}/?STREAMING=127.0.0.1:${serverConfig.localOscPort}`;
    await axios.get(streamingUrl);
    console.log(`Sent correct streaming request to VRChat: 127.0.0.1:${serverConfig.localOscPort}`);
    
    // Additionally, explicitly subscribe to voice
    const voiceUrl = `http://${vrcAddress}:${vrcHttpPort}/input/Voice?VALUE`;
    await axios.get(voiceUrl);
    console.log('Explicitly subscribed to /input/Voice');
  } catch (err) {
    console.warn('Failed to notify VRChat about our port:', err.message);
    if (err.response) {
      console.warn('Response status:', err.response.status);
      console.warn('Response data:', err.response.data);
    }
  }
}

// Query VRChat's OSCQuery service to see available parameters
async function queryVRChatParameters(service) {
  try {
    console.log('Querying VRChat OSCQuery service for available parameters...');
    await service.update();
    const flatParams = service.flat();
    console.log(`VRChat has ${flatParams.length} available OSC parameters:`);
    
    // Look for avatar parameters specifically
    const avatarParams = flatParams.filter(p => p.full_path && p.full_path.startsWith('/avatar/parameters/'));
    // Add input parameters (like /input/Voice)
    const inputParams = flatParams.filter(p => p.full_path && p.full_path.startsWith('/input/'));
    
    console.log(`Found ${avatarParams.length} avatar parameters and ${inputParams.length} input parameters:`);
    avatarParams.slice(0, 10).forEach(param => {
      const args = param.arguments ? param.arguments.map(a => a.type).join(',') : 'no args';
      console.log(`  ${param.full_path} (${args})`);
    });

    // Subscribe to parameters by making HTTP GET requests to ?VALUE
    if (avatarParams.length > 0 || inputParams.length > 0) {
      const axios = require('axios');
      const vrcHttpPort = service.port;
      const vrcAddress = service.address;
      let subscribeCount = 0;
      
      // Combine all parameters we want to subscribe to
      const allParamsToSubscribe = [...avatarParams, ...inputParams];
      console.log(`Subscribing to ${allParamsToSubscribe.length} total parameters...`);
      
      // First explicitly subscribe to Voice if it exists
      const voiceParam = allParamsToSubscribe.find(p => p.full_path === '/input/Voice');
      if (voiceParam) {
        const voiceUrl = `http://${vrcAddress}:${vrcHttpPort}/input/Voice?VALUE`;
        axios.get(voiceUrl).then(() => {
          console.log('Explicitly subscribed to /input/Voice - this should enable voice data');
        }).catch(err => {
          console.warn('Failed to subscribe to Voice parameter:', err.message);
        });
      }
      
      // Subscribe to all other parameters
      for (const param of allParamsToSubscribe) {
        // Skip Voice since we already handled it
        if (param.full_path === '/input/Voice') continue;
        
        const url = `http://${vrcAddress}:${vrcHttpPort}${param.full_path}?VALUE`;
        axios.get(url).then(() => {
          subscribeCount++;
          if (subscribeCount <= 5) {
            console.log(`Subscribed to ${param.full_path}`);
          }
        }).catch(err => {
          if (subscribeCount <= 5) {
            console.warn(`Failed to subscribe to ${param.full_path}:`, err.message);
          }
        });
      }
      
      // Log summary
      if (allParamsToSubscribe.length > 5) {
        console.log(`...and subscribed to ${allParamsToSubscribe.length - 5} more parameters.`);
      }
    } else {
      console.log('No avatar parameters found - VRChat might not be in a world with an avatar loaded');
      console.log('First 5 available parameters:');
      flatParams.slice(0, 5).forEach(param => {
        const args = param.arguments ? param.arguments.map(a => a.type).join(',') : 'no args';
        console.log(`  ${param.full_path} (${args})`);
      });
    }
    
    if (flatParams.length > 10) {
      console.log(`  ... and ${flatParams.length - 10} more parameters`);
    }
  } catch (err) {
    console.warn('Could not query VRChat parameters:', err.message);
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
  
  // Reset state flags to allow re-initialization with new config
  oscQueryServerInitialized = false;
  oscUdpPortInitialized = false;
  discoveryInitialized = false;
  
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
  // Reset state flags
  oscQueryServerInitialized = false;
  oscUdpPortInitialized = false;
  discoveryInitialized = false;
  
  if (oscQueryServer) oscQueryServer.stop();
  if (oscQueryDiscovery) oscQueryDiscovery.stop();
  if (oscUDPPort) oscUDPPort.close();
  if (socket) socket.disconnect();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Reset state flags
  oscQueryServerInitialized = false;
  oscUdpPortInitialized = false;
  discoveryInitialized = false;
  
  if (oscQueryServer) oscQueryServer.stop();
  if (oscQueryDiscovery) oscQueryDiscovery.stop();
  if (oscUDPPort) oscUDPPort.close();
  if (socket) socket.disconnect();
});
