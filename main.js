const { app, BrowserWindow, ipcMain, dialog, session, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { encryptData, decryptData } = require('./utils/encryption');
// Set userdata path and ensure it exists
const userDataPath = path.join(process.cwd(), 'userdata');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}
app.setPath('userData', userDataPath);
const osc = require('osc');
const debug = require('./utils/debugger');
const OscService = require('./utils/oscService');
const { OSCQueryService } = require('./utils/oscQueryService');
const HyperateAddon = require('./Containers/Hyperate');
const OSCLeashAddon = require('./Containers/OSCLeash');
const VRChatAPIContainer = require('./Containers/VRC-API');
// Logger will be loaded after app is ready
let logger;
const WebSocketManager = require('./utils/websocketManager');
const configManager = require('./utils/configManager');
let mainWindow;
let oscServer;
let oscClient;
let oscService;
let oscQueryService;
let oscEnabled = false;
let wsManager;
let serverConfig = configManager.getServerConfig();
let hyperateAddon;
let oscLeashAddon;
let vrchatApiContainer;
// Custom WebSocket URLs are now persisted across restarts
let isShuttingDown = false;
let hasShownCriticalError = false;

// Helper function to update splash screen progress
function updateSplashProgress(progress, message) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-progress', { progress, message });
  }
}

function createWindow() {
  // Create splash window first
  splashWindow = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  splashWindow.loadFile('renderer/splash.html');
  splashWindow.show();

  updateSplashProgress(0, 'Initializing');

  const windowState = configManager.getWindowState();
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'Assets', 'ARC.ico'),
    title: 'ARC-OSC Client',
    show: false // Start hidden so we can control when it appears
  })
  // Restore maximized state if it was maximized
  if (windowState.maximized) {
    mainWindow.maximize();
  }
  mainWindow.once('ready-to-show', () => {
    // Minimum 3 second splash display
    const minSplashTime = 3000;
    const startTime = Date.now();
    
    updateSplashProgress(100, 'Ready');
    
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, Math.max(0, minSplashTime - (Date.now() - startTime)));
  });
  mainWindow.setMenuBarVisibility(false);

  // Add security for VRC Timeline webview
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    // Set secure CSP for the webview
    webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' https://vrc.tl https://*.vrc.tl; " +
            "script-src 'self' https://vrc.tl https://*.vrc.tl 'unsafe-inline'; " +
            "style-src 'self' https://vrc.tl https://*.vrc.tl 'unsafe-inline'; " +
            "img-src 'self' https: data:; " +
            "font-src 'self' https://vrc.tl https://*.vrc.tl data:; " +
            "connect-src 'self' https://vrc.tl https://*.vrc.tl wss://*.vrc.tl; " +
            "frame-src 'self' https://vrc.tl https://*.vrc.tl; " +
            "object-src 'none'; " +
            "base-uri 'self';"
          ]
        }
      });
    });

    // Disable nodeIntegration and enable security features
    webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('https://vrc.tl')) {
        event.preventDefault();
      }
    });
  });

  if (process.argv.includes('--dev')) {
    mainWindow.loadFile('renderer/index.html');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('renderer/index.html');
  }
  // Save window state on resize and move with throttling to prevent excessive saves
  let saveWindowStateTimeout;
  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Clear any existing timeout
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
    }
    // Set a new timeout to save after 100ms delay
    saveWindowStateTimeout = setTimeout(() => {
      const bounds = mainWindow.getBounds();
      const isMaximized = mainWindow.isMaximized();
      configManager.updateWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: isMaximized
      });
      saveWindowStateTimeout = undefined;
    }, 100);
  };
  // Store timeout globally for cleanup
  global.saveWindowStateTimeout = saveWindowStateTimeout;
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);
  mainWindow.on('close', () => {
    // Save final window state immediately when closing
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout);
      saveWindowStateTimeout = undefined;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      const isMaximized = mainWindow.isMaximized();
      configManager.updateWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: isMaximized
      });
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.on('crashed', (event, killed) => {
    if (hasShownCriticalError) {
      return;
    }
    hasShownCriticalError = true;
    // Log crash details before cleanup
    debug.logRendererCrash({
      reason: 'webContents crashed',
      killed: killed,
      timestamp: new Date().toISOString()
    });
    debug.logCriticalShutdown('Renderer process crashed', 'webContents.crashed');
    cleanup('renderer-crashed');
    dialog.showErrorBox('Application Error', 'The application has encountered an error and will now close.');
    process.exit(1);
  });
  mainWindow.on('unresponsive', () => {
    if (hasShownCriticalError) {
      return;
    }
    hasShownCriticalError = true;
    // Log unresponsive state before cleanup
    debug.logRendererUnresponsive({
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - debug.startTime) / 1000)
    });
    debug.logCriticalShutdown('Renderer process unresponsive', 'window.unresponsive');
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
      // Always ready to forward when connected
      debug.logWebSocketForwarding(`Ready to forward OSC data to server`);
    });
    wsManager.on('osc-data', (data) => {
      sendToRenderer('websocket-osc-data', data);
      // debug.logWebSocketConnection(`Received OSC data: ${data.address} = ${data.value}`);
      // Check if WebSocket forwarding is enabled before processing data from server
      const wsForwardingEnabled = serverConfig.appSettings?.enableWebSocketForwarding || false;
      if (!wsForwardingEnabled) {
        debug.logWebSocketForwarding(`WebSocket forwarding disabled - ignoring incoming OSC data: ${data.address} = ${data.value}`);
        return;
      }
      // Forward received OSC data to VRChat via normal OSC
      if (oscService && oscService.getStatus().isListening) {
        try {
          // Determine the type based on the value
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
            // debug.logWebSocketConnection(`Forwarded WebSocket OSC to VRChat: ${data.address} = ${data.value} (${type})`);
          }
        } catch (error) {
          debug.error(`Failed to forward WebSocket OSC to VRChat: ${error.message}`);
        }
      } else {
        debug.logWebSocketConnection(`Cannot forward OSC to VRChat - OSC service not running`);
      }
    });
    wsManager.on('avatar-change', (data) => {
      console.log('Main process received avatar-change:', data);
      sendToRenderer('websocket-avatar-change', data);
      const displayName = data.name ? `${data.name} (${data.id})` : data.id;
      debug.logWebSocketConnection(`Avatar changed: ${displayName} for user ${data.username || 'Unknown'}`);
    });
    wsManager.on('parameter-update', (data) => {
      sendToRenderer('websocket-parameter-update', data);
    });
    wsManager.on('server-message', (data) => {
      sendToRenderer('websocket-server-message', data);
    });
    wsManager.on('panel-connections-update', (data) => {
      sendToRenderer('websocket-panel-connections-update', data);
    });
    wsManager.on('feedback-update', (data) => {
      sendToRenderer('feedback-update', data);
      debug.info(`Feedback update received: ${data.action} for feedback ${data.feedbackId || 'unknown'}`);
    });
  }
}

function initOscServer() {
  if (oscService) {
    debug.info('Stopping existing OSC service before reinitialization...');
    oscService.stop();
    oscService = null;
    global.oscService = null;
  }
  if (!oscEnabled) {
    debug.info('OSC is disabled, not initializing server');
    sendToRenderer('osc-server-status', { 
      status: 'disabled', 
      port: serverConfig.legacyOscPort 
    });
    return;
  }
  debug.info(`Initializing OSC service with port ${serverConfig.legacyOscPort}`);
  oscService = new OscService();
  oscService.on('ready', (config) => {
    updateSplashProgress(80, 'OSC service ready');
    debug.logOscServiceReady(config);
    sendToRenderer('osc-server-status', { 
      status: 'connected', 
      port: config.localPort 
    });
    debug.logAdditionalConnections(serverConfig.additionalOscConnections);
    // Update HypeRate addon with OSC service if it's running
    if (hyperateAddon && hyperateAddon.isEnabled()) {
      hyperateAddon.oscService = oscService;
      debug.info('Updated HypeRate addon with OSC service');
    }
    // Update OSCLeash addon with OSC service if it's running
    if (oscLeashAddon && oscLeashAddon.isEnabled()) {
      oscLeashAddon.oscService = oscService;
      debug.info('Updated OSCLeash addon with OSC service');
    }
    
    // Start autostart addons now that OSC service is ready
    const appSettings = configManager.getAppSettings();
    if (appSettings.hyperateAutostart && hyperateAddon && !hyperateAddon.isEnabled()) {
      debug.info('Starting HypeRate addon based on autostart setting (OSC service ready)...');
      hyperateAddon.start(oscService);
    }
    if (appSettings.oscleashAutostart && oscLeashAddon && !oscLeashAddon.isEnabled()) {
      debug.info('Starting OSCLeash addon based on autostart setting (OSC service ready)...');
      oscLeashAddon.start(oscService);
    }
  });

  // OSC receiving functionality removed - only sending is supported

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
  // Initialize and start the service
  if (oscService.initialize(
    serverConfig.legacyOscPort, 
    serverConfig.targetOscPort, 
    serverConfig.targetOscAddress
  )) {
    oscService.setAdditionalConnections(serverConfig.additionalOscConnections);
    oscService.start();
    global.oscService = oscService;
    // Initialize OSC Query service for automatic VRChat discovery
    initOscQueryService();
  }
}
async function initOscQueryService() {
  try {
    // Reuse existing instance if available, otherwise create new one
    if (!oscQueryService) {
      oscQueryService = new OSCQueryService();
      
      // Setup event listeners only once when creating new instance
      oscQueryService.on('started', (info) => {
        debug.info(`OSC Query service started on HTTP port ${info.httpPort}`);
        sendToRenderer('oscquery-status', {
          status: 'started',
          httpPort: info.httpPort,
          oscPort: info.oscPort
        });
      });
      oscQueryService.on('error', (error) => {
        debug.error(`OSC Query service error: ${error.message}`);
        sendToRenderer('oscquery-status', {
          status: 'error',
          error: error.message
        });
      });
      oscQueryService.on('stopped', () => {
        debug.info('OSC Query service stopped');
        sendToRenderer('oscquery-status', {
          status: 'stopped'
        });
      });
      // Setup OSC message forwarding to WebSocket
      oscQueryService.on('osc-message', (oscData) => {
        // Send to renderer for logging (always, regardless of forwarding status)
        sendToRenderer('osc-received', {
          address: oscData.address,
          value: oscData.value,
          type: oscData.type,
          connectionId: null // OSC Query messages don't have a connection ID
        });
        // Check if WebSocket forwarding is enabled
        const wsForwardingEnabled = serverConfig.appSettings?.enableWebSocketForwarding || false;
        if (!wsForwardingEnabled) {
          // Don't forward to WebSocket, but still logged above
          return;
        }
        // Forward to WebSocket if connected
        if (wsManager && wsManager.isConnected) {
          try {
            wsManager.sendOscData({
              address: oscData.address,
              value: oscData.value,
              type: oscData.type
            });
            // Send to renderer for "forwarded" logging
            sendToRenderer('osc-forwarded', {
              address: oscData.address,
              value: oscData.value,
              type: oscData.type,
              connectionId: null
            });
            // Optionally log forwarded messages (commented out to reduce spam)
            // debug.info(`Forwarded OSC to WebSocket: ${oscData.address} = ${oscData.value}`);
          } catch (error) {
            debug.error(`Failed to forward OSC to WebSocket: ${error.message}`);
          }
        }
      });
    } else {
      debug.info('Reusing existing OSC Query service instance');
    }
    // Initialize with legacy port (not actually used - OSC Query auto-assigns ports)
    // Pass bindAddress from config (defaults to 0.0.0.0 in configManager)
    await oscQueryService.initialize(
      serverConfig.legacyOscPort,
      null, // httpPort (auto-assigned)
      serverConfig.oscQueryBindAddress || '0.0.0.0'
    );
    
    // Load and set unsubscriptions from config
    const unsubscriptions = serverConfig.oscQueryUnsubscriptions || [];
    oscQueryService.setUnsubscriptions(unsubscriptions);
    debug.info(`OSC Query unsubscriptions loaded: ${unsubscriptions.length === 0 ? 'None (listening to all)' : unsubscriptions.join(', ')}`);
    
    // Start the service
    await oscQueryService.start();
  } catch (error) {
    debug.error(`Failed to initialize OSC Query service: ${error.message}`);
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

// Shell and clipboard handlers for VRC Timeline
ipcMain.handle('shell-open-external', async (event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle('clipboard-write-text', (event, text) => {
  clipboard.writeText(text);
});

ipcMain.handle('set-config', (event, newConfig) => {
  const oldConfig = { ...serverConfig };
  serverConfig = { ...serverConfig, ...newConfig };
  // Log changes to additional connections
  const oldConnections = oldConfig.additionalOscConnections || [];
  const newConnections = newConfig.additionalOscConnections || [];
  if (oldConnections.length !== newConnections.length) {
    debug.logConnectionCountChange(oldConnections.length, newConnections.length, newConnections);
  }
  debug.logConfigUpdate(oldConfig, newConfig, serverConfig);
  // Save the updated config to file (including custom URLs)
  configManager.updateConfig(serverConfig);
  if (newConfig.websocketServerUrl && (newConfig.websocketServerUrl.includes('127.0.0.1') || newConfig.websocketServerUrl.includes('localhost'))) {
    debug.info('Custom/dev WebSocket URL persisted to config file');
  }
  // Update WebSocket configuration if URL changed
  if (newConfig.websocketServerUrl && oldConfig.websocketServerUrl !== newConfig.websocketServerUrl) {
    debug.info(`WebSocket URL changed from ${oldConfig.websocketServerUrl} to ${newConfig.websocketServerUrl}`);
    if (wsManager) {
      const wasConnected = wsManager.isConnected;
      if (wasConnected) {
        debug.info('Disconnecting WebSocket to apply new URL...');
        wsManager.disconnect();
      }
      // Update the WebSocket manager's configuration
      wsManager.setConfig({
        serverUrl: serverConfig.websocketServerUrl
      });
      debug.info(`WebSocket configuration updated to: ${serverConfig.websocketServerUrl}`);
    }
  }
  // Check if only additional connections changed, if so, just update them
  const portsChanged = (oldConfig.legacyOscPort !== serverConfig.legacyOscPort) ||
                       (oldConfig.targetOscPort !== serverConfig.targetOscPort) ||
                       (oldConfig.targetOscAddress !== serverConfig.targetOscAddress);

  const oscQueryBindAddressChanged = (oldConfig.oscQueryBindAddress !== serverConfig.oscQueryBindAddress);

  const additionalConnectionsChanged = JSON.stringify(oldConfig.additionalOscConnections || []) !== 
                                       JSON.stringify(serverConfig.additionalOscConnections || []);

  // Restart OSC-Query if bind address changed
  if (oscQueryBindAddressChanged) {
    debug.info('OSC-Query bind address changed, restarting OSC-Query service');
    initOscQueryService();
  }

  if (!portsChanged && oscService && oscEnabled && additionalConnectionsChanged) {
    // Only additional connections changed, update them efficiently
    debug.info('Only additional connections changed, updating without restarting OSC service');
    oscService.updateAdditionalConnections(serverConfig.additionalOscConnections);
  } else if (portsChanged || !oscEnabled) {
    // Ports changed or OSC service needs full restart
    debug.info('OSC configuration changed, restarting OSC service');
    initOscServer();
    initOscClient();
  } else if (!additionalConnectionsChanged) {
    debug.info('No OSC configuration changes detected');
  }
  return serverConfig;
});
ipcMain.handle('get-app-settings', () => {
  return configManager.getAppSettings();
});
ipcMain.handle('set-app-settings', (event, newSettings) => {
  // Update the settings in the config manager
  const result = configManager.updateAppSettings(newSettings);
  debug.info(`App settings updated`);
  if (!result) {
    debug.error('Failed to save app settings to config file');
  }
  return configManager.getAppSettings();
});
ipcMain.handle('get-window-state', () => {
  return configManager.getWindowState();
});
ipcMain.handle('set-window-state', (event, windowState) => {
  const result = configManager.updateWindowState(windowState);
  debug.info(`Window state updated: ${JSON.stringify(windowState)}`);
  if (!result) {
    debug.error('Failed to save window state to config file');
  }
  return result;
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

ipcMain.handle('get-last-username', () => {
  const appSettings = configManager.getAppSettings();
  return appSettings.lastUsername || '';
});
ipcMain.handle('set-last-username', (event, username) => {
  try {
    const result = configManager.updateAppSettings({ lastUsername: username });
    debug.info(`Last username saved: ${username}`);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to save last username: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('clear-debug-logs', () => {
  debug.clearOldLogs();
  debug.info('Debug logs cleared by user request');
});

ipcMain.handle('get-memory-stats', () => {
  const memoryUsage = process.memoryUsage();
  return {
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    external: Math.round(memoryUsage.external / 1024 / 1024),
    arrayBuffers: Math.round(memoryUsage.arrayBuffers / 1024 / 1024),
    // Additional memory health indicators
    heapPercentUsed: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
  };
});

ipcMain.handle('force-memory-cleanup', () => {
  try {
    if (global.gc) {
      global.gc();
    }
    const memoryUsage = process.memoryUsage();
    debug.logMemoryCleanup({
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024)
    });
    return { success: true, message: 'Memory cleanup performed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
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
      wsManager = null; // Force re-initialization on reconnect to re-register event handlers
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
    debug.error(`Manual WebSocket OSC send failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Local OSC send handler
ipcMain.handle('osc-send-local', (event, data) => {
  try {
    if (!oscService) {
      throw new Error('OSC service not initialized');
    }
    if (!oscEnabled) {
      throw new Error('OSC service is disabled. Please enable OSC first.');
    }
    const status = oscService.getStatus();
    if (!status.isListening) {
      throw new Error('OSC service is not running');
    }
    
    debug.info(`Manual OSC send locally: ${data.address} = ${data.value} (${data.type})`);
    const success = oscService.sendMessage(data.address, data.value, data.type);
    
    if (success) {
      return { success: true };
    } else {
      throw new Error('Failed to send OSC message');
    }
  } catch (error) {
    debug.error(`Local OSC send failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Add test method
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
    debug.error(`Test WebSocket send failed: ${error.message}`);
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
// VRChat account linking
ipcMain.handle('send-vrchat-link', async (event, vrchatUserId, vrchatUsername) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server');
    }
    
    debug.info(`Sending VRChat account link request: ${vrchatUsername} (${vrchatUserId})`);
    const response = await wsManager.sendVRChatLink(vrchatUserId, vrchatUsername);
    debug.info(`VRChat account linked successfully`);
    return response;
  } catch (error) {
    debug.error(`Failed to link VRChat account: ${error.message}`);
    throw error;
  }
});
// Check VRChat account link status
ipcMain.handle('check-vrchat-link', async (event) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server');
    }
    debug.info(`Checking VRChat account link status`);
    const response = await wsManager.checkVRChatLink();
    debug.info(`VRChat link status: ${response.linked ? 'linked' : 'not linked'}`);
    return response;
  } catch (error) {
    debug.error(`Failed to check VRChat link status: ${error.message}`);
    throw error;
  }
});
// Feedback System IPC Handlers
ipcMain.handle('send-feedback', async (event, feedbackData) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server');
    }
    debug.info(`Submitting feedback: ${feedbackData.type} - ${feedbackData.title}`);
    const response = await wsManager.sendMessage('submit-feedback', feedbackData);
    debug.info(`Feedback submitted successfully`);
    return response;
  } catch (error) {
    debug.error(`Failed to submit feedback: ${error.message}`);
    throw error;
  }
});
ipcMain.handle('get-feedback-list', async (event) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server');
    }
    const response = await wsManager.sendMessage('get-feedback-list', {});
    return response.feedbackList || [];
  } catch (error) {
    debug.error(`Failed to get feedback list: ${error.message}`);
    throw error;
  }
});
ipcMain.handle('vote-feedback', async (event, feedbackId) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server');
    }
    debug.info(`Voting on feedback: ${feedbackId}`);
    const response = await wsManager.sendMessage('vote-feedback', { feedbackId });
    debug.info(`Vote submitted successfully`);
    return response;
  } catch (error) {
    debug.error(`Failed to vote on feedback: ${error.message}`);
    throw error;
  }
});
ipcMain.handle('get-user-feedback-stats', async (event) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server');
    }
    const response = await wsManager.sendMessage('get-user-feedback-stats', {});
    return response.stats || { total: 0, feature: 0, bug: 0, improvement: 0, other: 0 };
  } catch (error) {
    debug.error(`Failed to get user feedback stats: ${error.message}`);
    throw error;
  }
});
ipcMain.handle('get-client-version', () => {
  const packageJson = require('./package.json');
  return packageJson.version;
});

// Error logging IPC handlers
ipcMain.handle('log-renderer-error', (event, error, context) => {
  try {
    debug.logRendererError(error, context);
    return { success: true };
  } catch (err) {
    console.error('Failed to log renderer error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('log-renderer-console-error', (event, args, context) => {
  try {
    debug.logRendererConsoleError(args, context);
    return { success: true };
  } catch (err) {
    console.error('Failed to log renderer console error:', err);
    return { success: false, error: err.message };
  }
});
ipcMain.handle('websocket-set-forwarding', (event, enabled) => {
  try {
    debug.info(`Setting WebSocket forwarding to: ${enabled}`);
    const newSettings = { enableWebSocketForwarding: enabled };
    const result = configManager.updateAppSettings(newSettings);
    if (result) {
      // Ensure appSettings exists
      if (!serverConfig.appSettings) {
        serverConfig.appSettings = {};
      }
      serverConfig.appSettings.enableWebSocketForwarding = enabled;
      debug.logWebSocketForwarding(`WebSocket forwarding ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true, enabled };
    } else {
      throw new Error('Failed to save settings');
    }
  } catch (error) {
    debug.error(`Failed to update WebSocket forwarding setting: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('enable-osc', () => {
  oscEnabled = true;
  debug.logOscServerStateChange(true);
  debug.info('OSC explicitly enabled by user');
  // Ensure any existing service is properly cleaned up before creating new one
  if (oscService) {
    debug.info('Cleaning up existing OSC service before enabling...');
    try {
      oscService.stop();
      oscService = null;
      global.oscService = null;
    } catch (error) {
      debug.error(`Error cleaning up existing OSC service: ${error.message}`);
    }
  }
  // Force initialization of OSC service
  initOscServer();
  initOscClient();
  return { success: true, message: 'OSC enabled' };
});
ipcMain.handle('disable-osc', async () => {
  oscEnabled = false;
  debug.logOscServerStateChange(false);
  // Immediately notify UI that we're stopping
  sendToRenderer('osc-server-status', { 
    status: 'stopping', 
    port: serverConfig.legacyOscPort 
  });
  // More controlled shutdown sequence
  try {
    if (oscService) {
      debug.info('Stopping OSC service and all additional connections...');
      // Give the service a moment to complete any pending operations
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        oscService.stop();
        oscService = null;
        global.oscService = null;
        debug.info('OSC service stopped successfully');
      } catch (error) {
        debug.error(`Error stopping OSC service: ${error.message}`);
      }
      // Clean up other OSC components
      try {
        if (oscServer) {
          oscServer.close();
          oscServer = null;
        }
      } catch (error) {
        debug.error(`Error closing OSC server: ${error.message}`);
      }
      try {
        if (oscClient) {
          oscClient.close();
          oscClient = null;
        }
      } catch (error) {
        debug.error(`Error closing OSC client: ${error.message}`);
      }
      // Stop OSC Query service and WAIT for it to fully complete
      try {
        if (oscQueryService) {
          await oscQueryService.stop();
          // Don't set to null yet - we'll reuse the instance
          debug.info('OSC Query service stopped and ready for reuse');
        }
      } catch (error) {
        debug.error(`Error stopping OSC Query service: ${error.message}`);
      }
      sendToRenderer('osc-server-status', { 
        status: 'disabled', 
        port: serverConfig.legacyOscPort 
      });
      debug.info('OSC service fully disabled - all connections closed');
      return { success: true, message: 'OSC disabled' };
    } else {
      debug.info('OSC service was not running');
      sendToRenderer('osc-server-status', { 
        status: 'disabled', 
        port: serverConfig.legacyOscPort 
      });
      return { success: true, message: 'OSC was already disabled' };
    }
  } catch (error) {
    debug.error(`Error during OSC disable: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// OSC Query subscription management IPC handlers
// OSC Query unsubscription management
ipcMain.handle('get-oscquery-unsubscriptions', () => {
  try {
    if (oscQueryService) {
      return { 
        success: true, 
        unsubscriptions: oscQueryService.getUnsubscriptions() 
      };
    }
    // Return from config if service isn't running
    return { 
      success: true, 
      unsubscriptions: serverConfig.oscQueryUnsubscriptions || [] 
    };
  } catch (error) {
    debug.error(`Failed to get OSC Query unsubscriptions: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-oscquery-unsubscriptions', (event, unsubscriptions) => {
  try {
    if (!Array.isArray(unsubscriptions)) {
      throw new Error('Unsubscriptions must be an array');
    }
    
    // Update config
    serverConfig.oscQueryUnsubscriptions = unsubscriptions;
    const result = configManager.updateConfig({ oscQueryUnsubscriptions: unsubscriptions });
    
    if (!result) {
      throw new Error('Failed to save unsubscriptions to config');
    }
    
    // Update active service if running
    if (oscQueryService && oscQueryService.isRunning) {
      oscQueryService.setUnsubscriptions(unsubscriptions);
      debug.info(`OSC Query unsubscriptions updated: ${unsubscriptions.length === 0 ? 'None (listening to all)' : unsubscriptions.join(', ')}`);
    }
    
    return { success: true, unsubscriptions };
  } catch (error) {
    debug.error(`Failed to set OSC Query unsubscriptions: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-oscquery-unsubscription', (event, path) => {
  try {
    const currentUnsubs = serverConfig.oscQueryUnsubscriptions || [];
    
    if (currentUnsubs.includes(path)) {
      return { success: true, message: 'Unsubscription already exists', unsubscriptions: currentUnsubs };
    }
    
    const newUnsubs = [...currentUnsubs, path];
    serverConfig.oscQueryUnsubscriptions = newUnsubs;
    configManager.updateConfig({ oscQueryUnsubscriptions: newUnsubs });
    
    if (oscQueryService && oscQueryService.isRunning) {
      oscQueryService.addUnsubscription(path);
    }
    
    debug.info(`Added OSC Query unsubscription: ${path}`);
    return { success: true, unsubscriptions: newUnsubs };
  } catch (error) {
    debug.error(`Failed to add OSC Query unsubscription: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-oscquery-unsubscription', (event, path) => {
  try {
    const currentUnsubs = serverConfig.oscQueryUnsubscriptions || [];
    const newUnsubs = currentUnsubs.filter(sub => sub !== path);
    
    serverConfig.oscQueryUnsubscriptions = newUnsubs;
    configManager.updateConfig({ oscQueryUnsubscriptions: newUnsubs });
    
    if (oscQueryService && oscQueryService.isRunning) {
      oscQueryService.removeUnsubscription(path);
    }
    
    debug.info(`Removed OSC Query unsubscription: ${path}`);
    return { success: true, unsubscriptions: newUnsubs };
  } catch (error) {
    debug.error(`Failed to remove OSC Query unsubscription: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('get-saved-password', () => {
  const savedPassword = configManager.getSavedPassword();
  return { password: savedPassword };
});

ipcMain.handle('set-saved-password', (event, password) => {
  try {
    const result = configManager.setSavedPassword(password);
    if (result) {
      debug.info(`Password ${password ? 'saved' : 'cleared'} in configuration`);
      return { success: true };
    } else {
      throw new Error('Failed to save password to config file');
    }
  } catch (error) {
    debug.error(`Failed to save password: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// HypeRate addon IPC handlers
ipcMain.handle('hyperate-get-status', () => {
  if (hyperateAddon) {
    return hyperateAddon.getStatus();
  }
  return { enabled: false, connected: false, hasApiKey: false };
});
ipcMain.handle('hyperate-start', () => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    // Pass OSC service if available, but don't require it
    const result = hyperateAddon.start(oscService);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to start HypeRate addon: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-stop', () => {
  try {
    if (hyperateAddon) {
      hyperateAddon.stop();
    }
    return { success: true };
  } catch (error) {
    debug.error(`Failed to stop HypeRate addon: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-add-tracker', (event, deviceId, deviceName = null) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.addTracker(deviceId, deviceName);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to add HypeRate tracker: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-remove-tracker', (event, deviceId) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.removeTracker(deviceId);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to remove HypeRate tracker: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-update-tracker-name', (event, deviceId, newName) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.updateTrackerName(deviceId, newName);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to update HypeRate tracker name: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-update-tracker-state', (event, deviceId, enabled) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.updateTrackerState(deviceId, enabled);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to update HypeRate tracker state: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('hyperate-get-trackers', () => {
  try {
    if (hyperateAddon) {
      return hyperateAddon.getTrackers();
    }
    return [];
  } catch (error) {
    debug.error(`Failed to get HypeRate trackers: ${error.message}`);
    return [];
  }
});
ipcMain.handle('hyperate-set-primary', (event, deviceId) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' };
    }
    const result = hyperateAddon.setPrimaryTracker(deviceId);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to set primary HypeRate tracker: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// HypeRate auto-start IPC handlers
ipcMain.handle('hyperate-get-autostart', () => {
  try {
    const appSettings = configManager.getAppSettings();
    return { enabled: appSettings.hyperateAutostart || false };
  } catch (error) {
    debug.error(`Failed to get HypeRate autostart setting: ${error.message}`);
    return { enabled: false };
  }
});
ipcMain.handle('hyperate-set-autostart', (event, enabled) => {
  try {
    const result = configManager.updateAppSettings({ hyperateAutostart: enabled });
    if (result) {
      debug.info(`HypeRate autostart ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true, enabled };
    } else {
      throw new Error('Failed to save autostart setting');
    }
  } catch (error) {
    debug.error(`Failed to set HypeRate autostart: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// OSCLeash addon IPC handlers
ipcMain.handle('oscleash-get-status', () => {
  if (oscLeashAddon) {
    return oscLeashAddon.getStatus();
  }
  return { enabled: false, leashCount: 0, activeLeashes: [] };
});
ipcMain.handle('oscleash-start', () => {
  try {
    if (!oscLeashAddon) {
      return { success: false, error: 'OSCLeash addon not initialized' };
    }
    if (!oscService) {
      return { success: false, error: 'OSC service not available' };
    }
    const result = oscLeashAddon.start(oscService);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to start OSCLeash addon: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('oscleash-stop', () => {
  try {
    if (oscLeashAddon) {
      oscLeashAddon.stop();
    }
    return { success: true };
  } catch (error) {
    debug.error(`Failed to stop OSCLeash addon: ${error.message}`);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('oscleash-get-config', () => {
  try {
    if (oscLeashAddon) {
      return oscLeashAddon.getConfig();
    }
    return null;
  } catch (error) {
    debug.error(`Failed to get OSCLeash config: ${error.message}`);
    return null;
  }
});
ipcMain.handle('oscleash-update-config', (event, newConfig) => {
  try {
    if (!oscLeashAddon) {
      return { success: false, error: 'OSCLeash addon not initialized' };
    }
    const result = oscLeashAddon.updateConfig(newConfig);
    return { success: result };
  } catch (error) {
    debug.error(`Failed to update OSCLeash config: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// OSCLeash auto-start IPC handlers
ipcMain.handle('oscleash-get-autostart', () => {
  try {
    const appSettings = configManager.getAppSettings();
    return { enabled: appSettings.oscleashAutostart || false };
  } catch (error) {
    debug.error(`Failed to get OSCLeash autostart setting: ${error.message}`);
    return { enabled: false };
  }
});

ipcMain.handle('oscleash-set-autostart', (event, enabled) => {
  try {
    const result = configManager.updateAppSettings({ oscleashAutostart: enabled });
    if (result) {
      debug.info(`OSCLeash autostart ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true, enabled };
    } else {
      throw new Error('Failed to save autostart setting');
    }
  } catch (error) {
    debug.error(`Failed to set OSCLeash autostart: ${error.message}`);
    return { success: false, error: error.message };
  }
});
// Encryption/Decryption IPC handlers
ipcMain.handle('encrypt-data', (event, plaintext) => {
  return encryptData(plaintext);
});
ipcMain.handle('decrypt-data', (event, encryptedData) => {
  return decryptData(encryptedData);
});
// VRChat API IPC handlers
ipcMain.handle('vrchatapi-get-status', () => {
  try {
    if (vrchatApiContainer) {
      return vrchatApiContainer.getStatus();
    }
    return { enabled: false, authenticated: false, currentUser: null };
  } catch (error) {
    debug.error(`Failed to get VRChat API status: ${error.message}`);
    return { enabled: false, authenticated: false, currentUser: null };
  }
});

ipcMain.handle('vrchatapi-login', async (event, credentials) => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' };
    }
    
    const { username, password, rememberCredentials } = credentials;
    const result = await vrchatApiContainer.login(username, password, rememberCredentials);
    
    return result;
  } catch (error) {
    debug.error(`VRChat API login error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vrchatapi-verify-2fa', async (event, data) => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' };
    }
    
    const { code, type } = data;
    const result = await vrchatApiContainer.verify2FA(code, type);
    
    return result;
  } catch (error) {
    debug.error(`VRChat API 2FA verification error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vrchatapi-logout', async () => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' };
    }
    
    const result = await vrchatApiContainer.logout();
    return result;
  } catch (error) {
    debug.error(`VRChat API logout error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vrchatapi-restore-session', async () => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' };
    }
    
    const result = await vrchatApiContainer.restoreSession();
    return result;
  } catch (error) {
    debug.error(`VRChat API session restore error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// VRChat API - Get Stats
ipcMain.handle('vrchatapi-get-stats', async () => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' };
    }
    
    const result = await vrchatApiContainer.getStats();
    return result;
  } catch (error) {
    debug.error(`VRChat API get stats error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(async () => {
  debug.logAppStartup();
  
  // Create splash window immediately after log cleanup
  createWindow();
  // Load logger after app is ready
  updateSplashProgress(10, 'Loading logger');
  logger = require('./utils/logger');
  // Initialize addons
  updateSplashProgress(20, 'Initializing addons');
  hyperateAddon = new HyperateAddon();
  oscLeashAddon = new OSCLeashAddon();
  vrchatApiContainer = new VRChatAPIContainer();
  
  // Set up HypeRate status and heart rate callbacks to update renderer in real-time
  hyperateAddon.setStatusChangeCallback((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hyperate-update', { type: 'status', ...status });
    }
  });
  hyperateAddon.setHeartRateCallback((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hyperate-update', data);
    }
  });
  
  // Set up OSCLeash status and movement callbacks to update renderer in real-time
  oscLeashAddon.setStatusChangeCallback((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oscleash-status-update', status);
    }
  });
  oscLeashAddon.setMovementCallback((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oscleash-movement-data', data);
    }
  });
  
  // Set up pipeline event forwarding
  vrchatApiContainer.setPipelineEventCallback((event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vrchatapi-pipeline-event', { event, data });
    }
  });
  
  // Get app settings from config
  updateSplashProgress(30, 'Loading configuration');
  const appSettings = configManager.getAppSettings();
  
  // Ensure serverConfig has appSettings
  if (!serverConfig.appSettings) {
    serverConfig.appSettings = appSettings || {};
  } else {
    // Merge app settings to ensure all settings are available
    serverConfig.appSettings = { ...appSettings, ...serverConfig.appSettings };
  }
  
  // Check if OSC should be enabled for autostart features
  const needsOscForAutostart = appSettings.hyperateAutostart || appSettings.oscleashAutostart;
  // Wait for main window to finish loading
  updateSplashProgress(40, 'Loading interface');
  await new Promise(resolve => {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', resolve);
    } else {
      resolve();
    }
  });
  // Send settings to renderer now that window is ready
  updateSplashProgress(50, 'Configuring settings');
  sendToRenderer('app-settings', appSettings);
  sendToRenderer('osc-server-status', { 
    status: 'disabled', 
    port: serverConfig.legacyOscPort 
  });
  sendToRenderer('websocket-status', {
    status: 'disconnected'
  });
  // Set up periodic memory management
  updateSplashProgress(60, 'Setting up memory management');
  setupMemoryManagement();
  // Initialize OSC services
  updateSplashProgress(70, 'Preparing services');
  if (oscEnabled) {
    debug.info('Starting OSC service...');
    initOscServer();
    initOscClient();
    // Inform user if autostart features are enabled but OSC is disabled
    if (needsOscForAutostart) {
      debug.info('Autostart features are enabled but OSC is disabled. Please enable OSC to use autostart functionality.');
    }
  } else {
    sendToRenderer('osc-server-status', { 
      status: 'disabled', 
      port: serverConfig.legacyOscPort 
    });
  }
  
  updateSplashProgress(90, 'Finishing up');
  // Schedule mDNS discovery after UI is fully loaded
  setTimeout(() => {
    if (oscQueryService && oscQueryService.isRunning) {
      debug.info('Triggering OSC Query mDNS discovery for VRChat awareness...');
      oscQueryService.triggerDiscovery();
    }
  }, 5000);
  setTimeout(() => {
    debug.connectionTimeout();
  }, 30000); // Check after 30 seconds
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
function setupMemoryManagement() {
  // Clear any existing interval to prevent duplicates
  if (global.memoryManagementInterval) {
    clearInterval(global.memoryManagementInterval);
  }

  // Set up periodic garbage collection and memory cleanup
  global.memoryManagementInterval = setInterval(() => {
    try {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Log memory usage periodically for monitoring
      const memoryUsage = process.memoryUsage();
      const memoryMB = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      };

      // Log if memory usage is concerning
      if (memoryUsage.heapUsed > 80 * 1024 * 1024) { // Over 80MB heap
        debug.warn('High memory usage detected', memoryMB);

        // Force additional cleanup if memory is very high
        if (memoryUsage.heapUsed > 120 * 1024 * 1024) { // Over 120MB
          debug.warn('Very high memory usage - forcing aggressive cleanup');
          
          // Force garbage collection multiple times
          if (global.gc) {
            global.gc();
            setTimeout(() => global.gc && global.gc(), 100);
            setTimeout(() => global.gc && global.gc(), 200);
          }
        }
      }
    } catch (error) {
      debug.error(`Memory management error: ${error.message}`);
    }
  }, 20000); // 20 seconds
}
function cleanup(source = 'unknown') {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  debug.logAppShutdown(`Cleanup initiated from: ${source}`);
  // Clear memory management interval
  if (global.memoryManagementInterval) {
    clearInterval(global.memoryManagementInterval);
    global.memoryManagementInterval = null;
  }
  // Clear window state save timeout
  if (global.saveWindowStateTimeout) {
    clearTimeout(global.saveWindowStateTimeout);
    global.saveWindowStateTimeout = null;
  }
  // Close splash window if still open
  try {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  } catch (error) {
    debug.error(`Error closing splash window: ${error.message}`);
  }
  try {
    if (oscService) {
      debug.info('Stopping OSC service during cleanup...');
      oscService.stop();
      oscService = null;
      global.oscService = null;
      debug.info('OSC service cleanup completed');
    }
  } catch (error) {
    debug.error(`Error stopping OSC service: ${error.message}`);
  }
  try {
    if (oscQueryService) {
      debug.info('Stopping OSC Query service during cleanup...');
      oscQueryService.stop();
      oscQueryService = null;
      debug.info('OSC Query service cleanup completed');
    }
  } catch (error) {
    debug.error(`Error stopping OSC Query service: ${error.message}`);
  }
  try {
    if (oscServer) {
      oscServer.close();
      oscServer = null;
    }
  } catch (error) {
    debug.error(`Error closing OSC server: ${error.message}`);
  }
  try {
    if (oscClient) {
      oscClient.close();
      oscClient = null;
    }
  } catch (error) {
    debug.error(`Error closing OSC client: ${error.message}`);
  }
  try {
    if (wsManager) {
      wsManager.disconnect();
      wsManager = null;
    }
  } catch (error) {
    debug.error(`Error disconnecting WebSocket: ${error.message}`);
  }
  try {
    if (hyperateAddon) {
      hyperateAddon.stop();
      hyperateAddon = null;
    }
  } catch (error) {
    debug.error(`Error stopping HypeRate addon: ${error.message}`);
  }
  try {
    if (vrchatApiContainer) {
      // Stop the container but preserve session for next startup
      vrchatApiContainer.stop();
      vrchatApiContainer = null;
    }
  } catch (error) {
    debug.error(`Error stopping VRChat API container: ${error.message}`);
  }
  // Force garbage collection before exit
  if (global.gc) {
    global.gc();
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
  // Log comprehensive error details
  try {
    debug.logUncaughtException(error, 'main');
    debug.logCriticalShutdown('Uncaught exception', 'process.uncaughtException');
  } catch (debugError) {
    console.error('Failed to log error via debug:', debugError);
    console.error('Original error:', error);
  }
  try {
    cleanup('uncaught-exception');
  } catch (cleanupError) {
    try {
      debug.error(`Error during cleanup: ${cleanupError.message}`);
    } catch (e) {
      console.error('Cleanup error:', cleanupError);
    }
  }
  dialog.showErrorBox('Critical Error', 'An unexpected error occurred. The application will now close.');
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  if (hasShownCriticalError) {
    process.exit(1);
    return;
  }
  hasShownCriticalError = true;
  // Log comprehensive rejection details
  try {
    debug.logUnhandledRejection(reason, promise, 'main');
    debug.logCriticalShutdown('Unhandled promise rejection', 'process.unhandledRejection');
  } catch (debugError) {
    console.error('Failed to log rejection via debug:', debugError);
    console.error('Original rejection:', reason);
  }
  try {
    cleanup('unhandled-rejection');
  } catch (cleanupError) {
    try {
      debug.error(`Error during cleanup: ${cleanupError.message}`);
    } catch (e) {
      console.error('Cleanup error:', cleanupError);
    }
  }
  dialog.showErrorBox('Critical Error', 'An unexpected error occurred. The application will now close.');
  process.exit(1);
});