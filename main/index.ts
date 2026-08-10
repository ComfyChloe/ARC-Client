import './bootstrap' // MUST be first — sets userData path before service constructors
import { app, BrowserWindow, ipcMain, dialog, session, shell, clipboard } from 'electron'
import path from 'node:path'
import { encryptData, decryptData } from './services/encryption'
import osc from 'osc'
import debug from './services/debugger'
import OscService from './services/oscService'
import { OSCQueryService } from './services/oscQueryService'
import HyperateAddon from './containers/hyperate/hyperate'
import WhisperAddon from './containers/whisper/whisper'
import OSCLeashAddon from './containers/oscleash/oscleash'
import VRChatAPIContainer from './containers/vrchat-api/vrchat-api'
import OscGoesBrrrAddon from './containers/oscgoesbrrr/oscgoesbrrr'
import AutoStatusContainer from './containers/autostatus/autostatus'
import XSOverlayAddon from './containers/xsoverlay/xsoverlay'
import Calendar from './containers/calendar/calendar'
import OpenShock from './containers/openshock/openshock'
import ARCLink from './containers/arclink/arclink'
import WebSocketManager from './services/websocketManager'
import configManager from './services/configManager'
import { initDb, closeDb, getDb } from './services/sqlDbService'
let mainWindow: BrowserWindow | null
let splashWindow: BrowserWindow | null
let oscServer: any
let oscClient: any
let oscService: any
let oscQueryService: any
let oscEnabled = false
let wsManager: any
let serverConfig: any = configManager.getServerConfig()
let hyperateAddon: any
let whisperAddon: any
let oscLeashAddon: any
let vrchatApiContainer: any
let oscGoesBrrrAddon: any
let autoStatusContainer: any
let xsOverlayAddon: any
let calendarContainer: any
let openShockContainer: any
let arcLinkContainer: any
// Custom WebSocket URLs are now persisted across restarts
let isShuttingDown = false
let hasShownCriticalError = false
initDb()
const rendererUrl = process.env.ELECTRON_RENDERER_URL

function loadRendererWindow(window: BrowserWindow, htmlFileName: string) {
  if (rendererUrl) {
    const urlPath = htmlFileName === 'index.html' ? '/' : `/${htmlFileName}`
    void window.loadURL(`${rendererUrl}${urlPath}`)
    return
  }
  void window.loadFile(path.join(__dirname, `../renderer/${htmlFileName}`))
}

// Helper function to update splash screen progress
function updateSplashProgress(progress: number, message: string) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-progress', { progress, message })
  }
}

function syncAutoStatusWithVrchatAccount() {
  if (!autoStatusContainer || !vrchatApiContainer) {
    return
  }
  const currentStatus = vrchatApiContainer.getCurrentUserStatus()
  autoStatusContainer.syncCurrentStatus(currentStatus.status, currentStatus.statusDescription)
}

function getAssetPath(...segments: string[]) {
  return path.join(app.getAppPath(), ...segments)
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
      // Splash window runs sandboxed; only a tiny `splashAPI` is exposed via
      // the dedicated preload below. No raw Node access is needed here.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../preload/splash.js')
    }
  })
  loadRendererWindow(splashWindow, 'splash.html')
  splashWindow.show()
  updateSplashProgress(0, 'Initializing')
  const windowState = configManager.getWindowState()
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, '../preload/index.js')
    },
    icon: getAssetPath('Assets', 'ARC.ico'),
    title: 'ARC-OSC Client',
    show: false // Start hidden so we can control when it appears
  })
  // Restore maximized state if it was maximized
  if (windowState.maximized) {
    mainWindow.maximize()
  }
  mainWindow.once('ready-to-show', () => {
    // Minimum 3 second splash display
    const minSplashTime = 3000
    const startTime = Date.now()
    updateSplashProgress(100, 'Ready')
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close()
        splashWindow = null
      }
      mainWindow!.show()
      mainWindow!.focus()
    }, Math.max(0, minSplashTime - (Date.now() - startTime)))
  })
  mainWindow.setMenuBarVisibility(false)
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
      })
    })
    // Disable nodeIntegration and enable security features
    webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('https://vrc.tl')) {
        event.preventDefault()
      }
    })
  })
  if (rendererUrl) {
    loadRendererWindow(mainWindow, 'index.html')
    mainWindow.webContents.openDevTools()
  } else {
    loadRendererWindow(mainWindow, 'index.html')
  }
  // Save window state on resize and move with throttling to prevent excessive saves
  let saveWindowStateTimeout: ReturnType<typeof setTimeout> | undefined
  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Clear any existing timeout
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout)
    }
    // Set a new timeout to save after 100ms delay
    saveWindowStateTimeout = setTimeout(() => {
      const bounds = mainWindow!.getBounds()
      const isMaximized = mainWindow!.isMaximized()
      configManager.updateWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: isMaximized
      })
      saveWindowStateTimeout = undefined
    }, 100)
  }
  // Store timeout globally for cleanup
  ;(global as any).saveWindowStateTimeout = saveWindowStateTimeout
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('maximize', saveWindowState)
  mainWindow.on('unmaximize', saveWindowState)
  mainWindow.on('close', () => {
    // Save final window state immediately when closing
    if (saveWindowStateTimeout) {
      clearTimeout(saveWindowStateTimeout)
      saveWindowStateTimeout = undefined
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds()
      const isMaximized = mainWindow.isMaximized()
      configManager.updateWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: isMaximized
      })
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    if (hasShownCriticalError) {
      return
    }
    hasShownCriticalError = true
    // Log crash details before cleanup
    debug.logRendererCrash({
      reason: details.reason,
      exitCode: details.exitCode,
      timestamp: new Date().toISOString()
    })
    debug.logCriticalShutdown(`Renderer process gone: ${details.reason}`, 'webContents.render-process-gone')
    // Only force quit on actual crashes, not clean exits
    if (details.reason !== 'clean-exit') {
      cleanup('renderer-process-gone')
      const errorMessage = debug.formatCrashDialogMessage(
        'Renderer Process Crashed',
        `Reason: ${details.reason}\nExit Code: ${details.exitCode}`
      )
      const shouldRestart = showCrashDialog('Application Error', errorMessage)
      if (shouldRestart) {
        relaunchApp()
      } else {
        process.exit(1)
      }
    }
  })
  mainWindow.on('unresponsive', () => {
    if (hasShownCriticalError) {
      return
    }
    hasShownCriticalError = true
    // Log unresponsive state before cleanup
    debug.logRendererUnresponsive({
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - debug.startTime) / 1000)
    })
    debug.logCriticalShutdown('Renderer process unresponsive', 'window.unresponsive')
    cleanup('renderer-unresponsive')
    const errorMessage = debug.formatCrashDialogMessage(
      'Application Unresponsive',
      'The application stopped responding and could not recover.'
    )
    const shouldRestart = showCrashDialog('Application Unresponsive', errorMessage)
    if (shouldRestart) {
      relaunchApp()
    } else {
      process.exit(1)
    }
  })
}
function initWebSocket() {
  if (!wsManager) {
    wsManager = new WebSocketManager()
    wsManager.setConfig({
      serverUrl: serverConfig.websocketServerUrl
    })
    wsManager.on('connection-status', (data: any) => {
      sendToRenderer('websocket-status', data)
      if (data.status === 'connected') {
        debug.logWebSocketConnection('Connected to WebSocket server')
        debug.info(`WebSocket connection established, isConnected: ${wsManager.isConnected}`)
      } else if (data.status === 'disconnected') {
        debug.logWebSocketConnection('Disconnected from WebSocket server')
      }
    })
    wsManager.on('connection-error', (data: any) => {
      sendToRenderer('websocket-error', data)
      debug.logWebSocketConnection(`Connection error: ${data.error} (Attempt ${data.attempts})`)
    })
    wsManager.on('authenticated', (data: any) => {
      sendToRenderer('websocket-authenticated', data)
      debug.logWebSocketConnection(`Authenticated as ${data.username} in room ${data.room}`)
      // Always ready to forward when connected
      debug.logWebSocketForwarding(`Ready to forward OSC data to server`)
    })
    wsManager.on('osc-data', (data: any) => {
      sendToRenderer('websocket-osc-data', data)
      // Check if WebSocket forwarding is enabled before processing data from server
      const wsForwardingEnabled = serverConfig.appSettings?.enableWebSocketForwarding || false
      if (!wsForwardingEnabled) {
        debug.logWebSocketForwarding(`WebSocket forwarding disabled - ignoring incoming OSC data: ${data.address} = ${data.value}`)
        return
      }
      // Forward received OSC data to VRChat via normal OSC
      if (oscService && oscService.getStatus().isListening) {
        try {
          // Determine the type based on the value
          let type = 'f' // default to float
          if (typeof data.value === 'boolean') {
            type = 'bool'
          } else if (typeof data.value === 'string') {
            type = 's'
          } else if (Number.isInteger(data.value)) {
            type = 'i'
          }
          oscService.sendMessage(data.address, data.value, type)
        } catch (error: any) {
          debug.error(`Failed to forward WebSocket OSC to VRChat: ${error.message}`)
        }
      } else {
        debug.logWebSocketConnection(`Cannot forward OSC to VRChat - OSC service not running`)
      }
    })
    wsManager.on('avatar-change', (data: any) => {
      console.log('Main process received avatar-change:', data)
      sendToRenderer('websocket-avatar-change', data)
      const displayName = data.name ? `${data.name} (${data.id})` : data.id
      debug.logWebSocketConnection(`Avatar changed: ${displayName} for user ${data.username || 'Unknown'}`)
      if (xsOverlayAddon && xsOverlayAddon.isEnabled()) {
        xsOverlayAddon.handleAvatarChange(data)
      }
    })
    wsManager.on('parameter-update', (data: any) => {
      sendToRenderer('websocket-parameter-update', data)
    })
    wsManager.on('server-message', (data: any) => {
      sendToRenderer('websocket-server-message', data)
    })
    wsManager.on('panel-connections-update', (data: any) => {
      sendToRenderer('websocket-panel-connections-update', data)
      if (xsOverlayAddon && xsOverlayAddon.isEnabled()) {
        xsOverlayAddon.handlePanelConnectionsUpdate(data)
      }
    })
    wsManager.on('feedback-update', (data: any) => {
      sendToRenderer('feedback-update', data)
      debug.info(`Feedback update received: ${data.action} for feedback ${data.feedbackId || 'unknown'}`)
    })
    // Handle server-managed parameter blocklist
    wsManager.on('parameter-blocklist', (data: any) => {
      if (oscQueryService && data && Array.isArray(data.patterns)) {
        oscQueryService.setServerBlocklist(data.patterns)
        debug.info(`Server blocklist received: ${data.patterns.length} pattern(s)`)
        sendToRenderer('parameter-blocklist-updated', {
          patterns: data.patterns,
          source: 'server'
        })
      }
    })
    // Handle server-managed parameter suppressions (rate monitoring)
    wsManager.on('suppress-parameters', (data: any) => {
      if (oscQueryService && data && Array.isArray(data.addresses)) {
        oscQueryService.addServerSuppressions(data.addresses, data.metadata)
        debug.info(`Server suppressed ${data.addresses.length} parameter(s): ${data.addresses.join(', ')}`)
        sendToRenderer('parameters-suppressed', {
          addresses: data.addresses,
          metadata: data.metadata || {},
          source: 'server'
        })
      }
    })
    // Handle server-managed parameter unsuppressions
    wsManager.on('unsuppress-parameters', (data: any) => {
      if (oscQueryService && data && Array.isArray(data.addresses)) {
        oscQueryService.removeServerSuppressions(data.addresses)
        debug.info(`Server unsuppressed ${data.addresses.length} parameter(s): ${data.addresses.join(', ')}`)
        sendToRenderer('parameters-unsuppressed', {
          addresses: data.addresses,
          source: 'server'
        })
      }
    })
    // Handle server denying an unsuppress request
    wsManager.on('unsuppress-denied', (data: any) => {
      debug.info(`Unsuppress denied for ${data?.address}: ${data?.reason}`)
      sendToRenderer('unsuppress-denied', data)
    })
  }
}
function initOscServer() {
  if (oscService) {
    debug.info('Stopping existing OSC service before reinitialization...')
    oscService.stop()
    oscService = null
    ;(global as any).oscService = null
  }
  if (!oscEnabled) {
    debug.info('OSC is disabled, not initializing server')
    sendToRenderer('osc-server-status', {
      status: 'disabled',
      port: serverConfig.legacyOscPort
    })
    return
  }
  debug.info(`Initializing OSC service with port ${serverConfig.legacyOscPort}`)
  oscService = new OscService()
  oscService.on('ready', async (config: any) => {
    updateSplashProgress(80, 'OSC service ready')
    debug.logOscServiceReady(config)
    sendToRenderer('osc-server-status', {
      status: 'connected',
      port: config.localPort
    })
    debug.logAdditionalConnections(serverConfig.additionalOscConnections)
    // Update HypeRate addon with OSC service if it's running
    if (hyperateAddon && hyperateAddon.isEnabled()) {
      hyperateAddon.oscService = oscService
      debug.info('Updated HypeRate addon with OSC service')
    }
    // Update OSCLeash addon with OSC service if it's running
    if (oscLeashAddon && oscLeashAddon.isEnabled()) {
      oscLeashAddon.oscService = oscService
      debug.info('Updated OSCLeash addon with OSC service')
    }
    // Update Whisper addon with OSC service if it's running
    if (whisperAddon && whisperAddon.isEnabled()) {
      whisperAddon.oscService = oscService
      debug.info('Updated Whisper addon with OSC service')
    }
    // Start autostart addons now that OSC service is ready
    const appSettings = configManager.getAppSettings()
    if (appSettings.hyperateAutostart && hyperateAddon && !hyperateAddon.isEnabled()) {
      debug.info('Starting HypeRate addon based on autostart setting (OSC service ready)...')
      hyperateAddon.start(oscService)
    }
    if (appSettings.whisperAutostart && whisperAddon && !whisperAddon.isEnabled()) {
      // Awaited + logged so prod-startup failures (asar path,
      // worker spawn hang, init timeout) are visible in the
      // Electron log. Without the await, the return value was
      // silently dropped and the renderer would sit at
      // "Starting..." forever with no diagnostic trail.
      debug.info('[autostart] whisper: starting (oscService ready)')
      const ok = await whisperAddon.start(oscService)
      const status = whisperAddon.getStatus()
      debug.info(
        `[autostart] whisper: start returned ${ok}; engineState=${status.engineState}` +
          (status.lastError ? `; lastError=${status.lastError}` : '')
      )
    }
    if (appSettings.oscleashAutostart && oscLeashAddon && !oscLeashAddon.isEnabled()) {
      debug.info('Starting OSCLeash addon based on autostart setting (OSC-Query ready)...')
      oscLeashAddon.start(oscQueryService, oscService)
    }
  })
  oscService.on('additionalPortReady', (data: any) => {
    debug.logAdditionalPortReady(data)
    sendToRenderer('osc-server-status', {
      status: 'connection-ready',
      connectionId: data.connectionId,
      type: data.type,
      port: data.port,
      address: data.address,
      name: data.name
    })
  })
  oscService.on('additionalPortError', (data: any) => {
    debug.logAdditionalPortError(data)
    sendToRenderer('osc-server-status', {
      status: 'connection-error',
      connectionId: data.connectionId,
      type: data.type,
      port: data.port,
      name: data.name,
      error: data.error.message
    })
  })
  oscService.on('error', (err: any) => {
    const status = debug.handleOscError(err)
    sendToRenderer('osc-server-status', status)
  })
  // Initialize and start the service
  if (oscService.initialize(
    serverConfig.legacyOscPort,
    serverConfig.targetOscPort,
    serverConfig.targetOscAddress
  )) {
    oscService.setAdditionalConnections(serverConfig.additionalOscConnections)
    oscService.start()
    ;(global as any).oscService = oscService
    // Initialize OSC Query service for automatic VRChat discovery
    void initOscQueryService()
  }
}
async function initOscQueryService() {
  try {
    // Reuse existing instance if available, otherwise create new one
    if (!oscQueryService) {
      oscQueryService = new OSCQueryService()
      // Setup event listeners only once when creating new instance
      oscQueryService.on('started', (info: any) => {
        debug.info(`OSC Query service started on HTTP port ${info.httpPort}`)
        sendToRenderer('oscquery-status', {
          status: 'started',
          httpPort: info.httpPort,
          oscPort: info.oscPort
        })
      })
      oscQueryService.on('error', (error: any) => {
        debug.error(`OSC Query service error: ${error.message}`)
        sendToRenderer('oscquery-status', {
          status: 'error',
          error: error.message
        })
      })
      oscQueryService.on('stopped', () => {
        debug.info('OSC Query service stopped')
        sendToRenderer('oscquery-status', {
          status: 'stopped'
        })
      })
      // VRChat connection state events
      oscQueryService.on('vrchat-addresses-changed', (addresses: any) => {
        debug.info(`VRChat addresses changed: OSCQuery=${addresses.oscQueryAddress}, OSC=${addresses.oscAddress}`)
        sendToRenderer('vrchat-connection-status', {
          connected: !!addresses.oscQueryAddress,
          oscQueryAddress: addresses.oscQueryAddress,
          oscAddress: addresses.oscAddress
        })
      })
      oscQueryService.on('vrchat-connection-lost', () => {
        debug.warn('VRChat connection lost - will attempt to rediscover')
        sendToRenderer('vrchat-connection-status', {
          connected: false,
          reason: 'connection-lost'
        })
      })
      oscQueryService.on('vrchat-restarted', (info: any) => {
        debug.info(`VRChat restarted: ${info.oldServiceName} -> ${info.newServiceName}`)
        sendToRenderer('vrchat-connection-status', {
          connected: true,
          restarted: true,
          oldServiceName: info.oldServiceName,
          newServiceName: info.newServiceName
        })
      })
      // OSC data flow monitoring events
      oscQueryService.on('osc-flow-warning', (info: any) => {
        debug.warn(`No OSC data received for ${Math.round(info.timeout / 1000)}s`)
        sendToRenderer('osc-flow-status', {
          status: 'warning',
          timeout: info.timeout,
          lastMessageTime: info.lastMessageTime
        })
      })
      oscQueryService.on('osc-flow-timeout', (info: any) => {
        debug.error(`OSC data flow timeout after ${Math.round(info.timeout / 1000)}s - triggering reconnection`)
        sendToRenderer('osc-flow-status', {
          status: 'timeout',
          timeout: info.timeout,
          lastMessageTime: info.lastMessageTime
        })
      })
      // Setup OSC message forwarding to WebSocket
      oscQueryService.on('osc-message', (oscData: any) => {
        // AutoStatus: intercept vrc-status parameter
        if (autoStatusContainer) {
          if (oscData.address === '/avatar/change') {
            autoStatusContainer.recordAvatarChange()
          }
          autoStatusContainer.handleOscMessage(oscData)
        }
        // Send to renderer for logging
        sendToRenderer('osc-received', {
          address: oscData.address,
          value: oscData.value,
          type: oscData.type,
          connectionId: null
        })
        // Check if WebSocket forwarding is enabled
        const wsForwardingEnabled = serverConfig.appSettings?.enableWebSocketForwarding || false
        if (!wsForwardingEnabled) {
          return
        }
        // Forward to WebSocket if connected
        if (wsManager && wsManager.isConnected) {
          try {
            if (oscQueryService.isLocalOnly(oscData.address)) {
              return
            }
            wsManager.sendOscData({
              address: oscData.address,
              value: oscData.value,
              type: oscData.type
            })
            sendToRenderer('osc-forwarded', {
              address: oscData.address,
              value: oscData.value,
              type: oscData.type,
              connectionId: null
            })
          } catch (error: any) {
            debug.error(`Failed to forward OSC to WebSocket: ${error.message}`)
          }
        }
      })
    } else {
      debug.info('Reusing existing OSC Query service instance')
    }
    // Stop the service if it's running before re-initializing so HTTP and UDP
    // servers are fully torn down before the new bind address is applied
    if (oscQueryService.isRunning) {
      await oscQueryService.stop()
    }
    // Initialize with legacy port
    await oscQueryService.initialize(
      serverConfig.legacyOscPort,
      null, // httpPort (auto-assigned)
      serverConfig.oscQueryBindAddress || '0.0.0.0'
    )
    // Load and set unsubscriptions from config
    const unsubscriptions = serverConfig.oscQueryUnsubscriptions || []
    oscQueryService.setUnsubscriptions(unsubscriptions)
    debug.info(`OSC Query unsubscriptions loaded: ${unsubscriptions.length === 0 ? 'None (listening to all)' : unsubscriptions.join(', ')}`)
    // Start the service
    await oscQueryService.start()
    // Attach OscGoesBrrr addon to OSC-Query service
    if (oscGoesBrrrAddon) {
      oscGoesBrrrAddon.setOscQueryService(oscQueryService)
      debug.info('OscGoesBrrr addon attached to OSC-Query service')
      // Start OGB if autostart is enabled
      const appSettings = configManager.getAppSettings()
      if (appSettings.ogbAutostart && !oscGoesBrrrAddon.isEnabled()) {
        debug.info('Starting OscGoesBrrr addon based on autostart setting...')
        oscGoesBrrrAddon.start()
      }
    }
  } catch (error: any) {
    debug.error(`Failed to initialize OSC Query service: ${error.message}`)
  }
}
function initOscClient() {
  if (oscClient) {
    oscClient.close()
  }
  oscClient = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: 0,
    remoteAddress: serverConfig.targetOscAddress,
    remotePort: serverConfig.targetOscPort
  })
  oscClient.open()
  console.log(`OSC Client targeting ${serverConfig.targetOscAddress}:${serverConfig.targetOscPort}`)
  debug.logOscClientInit(serverConfig.targetOscAddress, serverConfig.targetOscPort)
}
// OSC IPC batching: accumulate high-frequency messages and flush at 10Hz
const oscIpcBatch = {
  received: new Map<string, any>(),
  forwarded: new Map<string, any>()
}
function setupOscIpcBatching() {
  if ((global as any).oscIpcBatchInterval) {
    clearInterval((global as any).oscIpcBatchInterval)
  }
  ;(global as any).oscIpcBatchInterval = setInterval(() => {
    if (oscIpcBatch.received.size > 0) {
      const batch = Array.from(oscIpcBatch.received.values())
      oscIpcBatch.received.clear()
      sendToRendererDirect('osc-received-batch', batch)
    }
    if (oscIpcBatch.forwarded.size > 0) {
      const batch = Array.from(oscIpcBatch.forwarded.values())
      oscIpcBatch.forwarded.clear()
      sendToRendererDirect('osc-forwarded-batch', batch)
    }
  }, 100) // 10Hz flush rate
}
function sendToRendererDirect(channel: string, data: any) {
  if (mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents &&
      !mainWindow.webContents.isDestroyed()) {
    try {
      mainWindow.webContents.send(channel, data)
    } catch (error: any) {
      if (!isShuttingDown) {
        debug.warn(`Failed to send ${channel} to renderer: ${error.message}`)
      }
    }
  }
}
function sendToRenderer(channel: string, data: any) {
  // Batch high-frequency OSC channels to reduce IPC pressure on renderer
  if (channel === 'osc-received') {
    oscIpcBatch.received.set(data.address, data)
    return
  }
  if (channel === 'osc-forwarded') {
    oscIpcBatch.forwarded.set(data.address, data)
    return
  }
  sendToRendererDirect(channel, data)
}
// ────────── IPC Handlers ──────────
ipcMain.handle('get-config', () => {
  return configManager.getConfig()
})
ipcMain.handle('get-server-config', () => {
  return serverConfig
})
// Shell and clipboard handlers for VRC Timeline
ipcMain.handle('shell-open-external', async (_event, url: string) => {
  await shell.openExternal(url)
})
ipcMain.handle('clipboard-write-text', (_event, text: string) => {
  clipboard.writeText(text)
})
ipcMain.handle('set-config', (_event, newConfig: any) => {
  const oldConfig = { ...serverConfig }
  serverConfig = { ...serverConfig, ...newConfig }
  // Log changes to additional connections
  const oldConnections = oldConfig.additionalOscConnections || []
  const newConnections = newConfig.additionalOscConnections || []
  if (oldConnections.length !== newConnections.length) {
    debug.logConnectionCountChange(oldConnections.length, newConnections.length, newConnections)
  }
  debug.logConfigUpdate(oldConfig, newConfig, serverConfig)
  // Save the updated config to file (including custom URLs)
  configManager.updateConfig(serverConfig)
  if (newConfig.websocketServerUrl && (newConfig.websocketServerUrl.includes('127.0.0.1') || newConfig.websocketServerUrl.includes('localhost'))) {
    debug.info('Custom/dev WebSocket URL persisted to config file')
  }
  // Update WebSocket configuration if URL changed
  if (newConfig.websocketServerUrl && oldConfig.websocketServerUrl !== newConfig.websocketServerUrl) {
    debug.info(`WebSocket URL changed from ${oldConfig.websocketServerUrl} to ${newConfig.websocketServerUrl}`)
    if (wsManager) {
      const wasConnected = wsManager.isConnected
      if (wasConnected) {
        debug.info('Disconnecting WebSocket to apply new URL...')
        wsManager.disconnect()
      }
      wsManager.setConfig({
        serverUrl: serverConfig.websocketServerUrl
      })
      debug.info(`WebSocket configuration updated to: ${serverConfig.websocketServerUrl}`)
    }
  }
  // Check if only additional connections changed
  const portsChanged = (oldConfig.legacyOscPort !== serverConfig.legacyOscPort) ||
                       (oldConfig.targetOscPort !== serverConfig.targetOscPort) ||
                       (oldConfig.targetOscAddress !== serverConfig.targetOscAddress)
  const oscQueryBindAddressChanged = (oldConfig.oscQueryBindAddress !== serverConfig.oscQueryBindAddress)
  const additionalConnectionsChanged = JSON.stringify(oldConfig.additionalOscConnections || []) !==
                                       JSON.stringify(serverConfig.additionalOscConnections || [])
  // Restart OSC-Query if bind address changed
  if (oscQueryBindAddressChanged) {
    debug.info('OSC-Query bind address changed, restarting OSC-Query service')
    sendToRenderer('oscquery-status', { status: 'restarting' })
    void initOscQueryService()
  }
  if (!portsChanged && oscService && oscEnabled && additionalConnectionsChanged) {
    debug.info('Only additional connections changed, updating without restarting OSC service')
    oscService.updateAdditionalConnections(serverConfig.additionalOscConnections)
  } else if (portsChanged || !oscEnabled) {
    debug.info('OSC configuration changed, restarting OSC service')
    initOscServer()
    initOscClient()
  } else if (!additionalConnectionsChanged) {
    debug.info('No OSC configuration changes detected')
  }
  return serverConfig
})
ipcMain.handle('get-app-settings', () => {
  return configManager.getAppSettings()
})
ipcMain.handle('set-app-settings', (_event, newSettings: any) => {
  const result = configManager.updateAppSettings(newSettings)
  debug.info(`App settings updated`)
  if (!result) {
    debug.error('Failed to save app settings to config file')
  }
  return configManager.getAppSettings()
})
ipcMain.handle('get-window-state', () => {
  return configManager.getWindowState()
})
ipcMain.handle('set-window-state', (_event, windowState: any) => {
  const result = configManager.updateWindowState(windowState)
  debug.info(`Window state updated: ${JSON.stringify(windowState)}`)
  if (!result) {
    debug.error('Failed to save window state to config file')
  }
  return result
})
ipcMain.handle('get-debug-stats', () => {
  return debug.getStats()
})
ipcMain.handle('get-osc-status', () => {
  if (oscService) {
    const status = oscService.getStatus()
    debug.logOscServiceStatus(status)
    return status
  }
  return { error: 'OSC service not initialized' }
})
// OSC Query status and control handlers
ipcMain.handle('get-oscquery-status', () => {
  if (oscQueryService) {
    return oscQueryService.getStatus()
  }
  return { error: 'OSC Query service not initialized', isRunning: false }
})
ipcMain.handle('oscquery-force-reconnect', () => {
  if (oscQueryService) {
    const result = oscQueryService.forceReconnect()
    debug.info(`OSC Query force reconnect: ${result ? 'success' : 'failed'}`)
    return { success: result }
  }
  return { success: false, error: 'OSC Query service not initialized' }
})
ipcMain.handle('oscquery-reset-all', async () => {
  if (oscQueryService) {
    if (oscQueryService.isRunning) {
      await oscQueryService.stop()
    }
    oscQueryService.resetAll()
    debug.info('OSC Query service reset - re-initializing with new ports')
    await initOscQueryService()
    return { success: true }
  }
  return { success: false, error: 'OSC Query service not initialized' }
})
ipcMain.handle('get-last-username', () => {
  const appSettings = configManager.getAppSettings()
  return appSettings.lastUsername || ''
})
ipcMain.handle('set-last-username', (_event, username: string) => {
  try {
    const result = configManager.updateAppSettings({ lastUsername: username })
    debug.info(`Last username saved: ${username}`)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to save last username: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('clear-debug-logs', () => {
  debug.clearOldLogs()
  debug.info('Debug logs cleared by user request')
})
ipcMain.handle('get-memory-stats', () => {
  const memoryUsage = process.memoryUsage()
  return {
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    external: Math.round(memoryUsage.external / 1024 / 1024),
    arrayBuffers: Math.round(memoryUsage.arrayBuffers / 1024 / 1024),
    heapPercentUsed: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
  }
})
ipcMain.handle('force-memory-cleanup', () => {
  try {
    if ((global as any).gc) {
      ;(global as any).gc()
    }
    const memoryUsage = process.memoryUsage()
    debug.logMemoryCleanup({
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024)
    })
    return { success: true, message: 'Memory cleanup performed' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
ipcMain.handle('websocket-connect', async (_event, credentials: any) => {
  try {
    initWebSocket()
    const result = await wsManager.connect(credentials)
    return result
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
ipcMain.handle('websocket-disconnect', () => {
  try {
    if (wsManager) {
      const result = wsManager.disconnect()
      wsManager = null
      return result
    }
    return { success: true, message: 'Already disconnected' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
ipcMain.handle('websocket-send-osc', (_event, data: any) => {
  try {
    if (wsManager) {
      debug.info(`Manual OSC send via WebSocket: ${JSON.stringify(data)}`)
      return wsManager.sendOscData(data)
    }
    throw new Error('WebSocket not connected')
  } catch (error: any) {
    debug.error(`Manual WebSocket OSC send failed: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// Local OSC send handler
ipcMain.handle('osc-send-local', (_event, data: any) => {
  try {
    if (!oscService) {
      throw new Error('OSC service not initialized')
    }
    if (!oscEnabled) {
      throw new Error('OSC service is disabled. Please enable OSC first.')
    }
    const status = oscService.getStatus()
    if (!status.isListening) {
      throw new Error('OSC service is not running')
    }
    debug.info(`Manual OSC send locally: ${data.address} = ${data.value} (${data.type})`)
    const success = oscService.sendMessage(data.address, data.value, data.type)
    if (success) {
      return { success: true }
    } else {
      throw new Error('Failed to send OSC message')
    }
  } catch (error: any) {
    debug.error(`Local OSC send failed: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('websocket-test-send', () => {
  try {
    if (wsManager && wsManager.isConnected) {
      const testData = {
        address: "/avatar/parameters/test",
        value: 1.0
      }
      debug.info(`Sending test WebSocket data: ${JSON.stringify(testData)}`)
      const result = wsManager.sendOscData(testData)
      debug.info(`Test send result: ${JSON.stringify(result)}`)
      return result
    }
    throw new Error('WebSocket not connected')
  } catch (error: any) {
    debug.error(`Test WebSocket send failed: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('websocket-send-message', (_event, eventName: string, data: any) => {
  try {
    if (wsManager) {
      return wsManager.sendMessage(eventName, data)
    }
    throw new Error('WebSocket not connected')
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
ipcMain.handle('websocket-get-status', () => {
  if (wsManager) {
    return wsManager.getStatus()
  }
  return {
    isConnected: false,
    isAuthenticated: false,
    currentUser: null,
    reconnectAttempts: 0,
    serverUrl: serverConfig.websocketServerUrl
  }
})
ipcMain.handle('websocket-get-forwarding-status', () => {
  const enableForwarding = serverConfig.appSettings?.enableWebSocketForwarding || false
  return {
    enabled: enableForwarding,
    isConnected: wsManager ? wsManager.isConnected : false,
    canForward: enableForwarding && wsManager && wsManager.isConnected
  }
})
// VRChat account linking
ipcMain.handle('send-vrchat-link', async (_event, vrchatUserId: string, vrchatUsername: string) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server')
    }
    debug.info(`Sending VRChat account link request: ${vrchatUsername} (${vrchatUserId})`)
    const response = await wsManager.sendVRChatLink(vrchatUserId, vrchatUsername)
    debug.info(`VRChat account linked successfully`)
    return response
  } catch (error: any) {
    debug.error(`Failed to link VRChat account: ${error.message}`)
    throw error
  }
})
ipcMain.handle('check-vrchat-link', async () => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server')
    }
    //debug.info(`Checking VRChat account link status`)
    const response = await wsManager.checkVRChatLink()
    //debug.info(`VRChat link status: ${response.linked ? 'linked' : 'not linked'}`)
    return response
  } catch (error: any) {
    debug.error(`Failed to check VRChat link status: ${error.message}`)
    throw error
  }
})
// Feedback System IPC Handlers
ipcMain.handle('send-feedback', async (_event, feedbackData: any) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server')
    }
    debug.info(`Submitting feedback: ${feedbackData.type} - ${feedbackData.title}`)
    const response = await wsManager.sendMessage('submit-feedback', feedbackData)
    debug.info(`Feedback submitted successfully`)
    return response
  } catch (error: any) {
    debug.error(`Failed to submit feedback: ${error.message}`)
    throw error
  }
})
ipcMain.handle('get-feedback-list', async () => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server')
    }
    const response = await wsManager.sendMessage('get-feedback-list', {})
    return response.feedbackList || []
  } catch (error: any) {
    debug.error(`Failed to get feedback list: ${error.message}`)
    throw error
  }
})
ipcMain.handle('vote-feedback', async (_event, feedbackId: string) => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server')
    }
    debug.info(`Voting on feedback: ${feedbackId}`)
    const response = await wsManager.sendMessage('vote-feedback', { feedbackId })
    debug.info(`Vote submitted successfully`)
    return response
  } catch (error: any) {
    debug.error(`Failed to vote on feedback: ${error.message}`)
    throw error
  }
})
ipcMain.handle('get-user-feedback-stats', async () => {
  try {
    if (!wsManager || !wsManager.isConnected) {
      throw new Error('Not connected to ARC WebSocket server')
    }
    const response = await wsManager.sendMessage('get-user-feedback-stats', {})
    return response.stats || { total: 0, feature: 0, bug: 0, improvement: 0, other: 0 }
  } catch (error: any) {
    debug.error(`Failed to get user feedback stats: ${error.message}`)
    throw error
  }
})
ipcMain.handle('get-client-version', () => {
  return app.getVersion()
})
// Error logging IPC handlers
ipcMain.handle('log-renderer-error', (_event, error: any, context: any) => {
  try {
    debug.logRendererError(error, context)
    return { success: true }
  } catch (err: any) {
    console.error('Failed to log renderer error:', err)
    return { success: false, error: err.message }
  }
})
ipcMain.handle('log-renderer-console-error', (_event, args: any, context: any) => {
  try {
    debug.logRendererConsoleError(args, context)
    return { success: true }
  } catch (err: any) {
    console.error('Failed to log renderer console error:', err)
    return { success: false, error: err.message }
  }
})
ipcMain.handle('websocket-set-forwarding', (_event, enabled: boolean) => {
  try {
    debug.info(`Setting WebSocket forwarding to: ${enabled}`)
    const newSettings = { enableWebSocketForwarding: enabled }
    const result = configManager.updateAppSettings(newSettings)
    if (result) {
      if (!serverConfig.appSettings) {
        serverConfig.appSettings = {}
      }
      serverConfig.appSettings.enableWebSocketForwarding = enabled
      debug.logWebSocketForwarding(`WebSocket forwarding ${enabled ? 'enabled' : 'disabled'}`)
      return { success: true, enabled }
    } else {
      throw new Error('Failed to save settings')
    }
  } catch (error: any) {
    debug.error(`Failed to update WebSocket forwarding setting: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('enable-osc', () => {
  oscEnabled = true
  debug.logOscServerStateChange(true)
  debug.info('OSC explicitly enabled by user')
  configManager.updateAppSettings({ oscAutostart: true })
  if (oscService) {
    debug.info('Cleaning up existing OSC service before enabling...')
    try {
      oscService.stop()
      oscService = null
      ;(global as any).oscService = null
    } catch (error: any) {
      debug.error(`Error cleaning up existing OSC service: ${error.message}`)
    }
  }
  initOscServer()
  initOscClient()
  return { success: true, message: 'OSC enabled' }
})
ipcMain.handle('disable-osc', async () => {
  oscEnabled = false
  debug.logOscServerStateChange(false)
  configManager.updateAppSettings({ oscAutostart: false })
  sendToRenderer('osc-server-status', {
    status: 'stopping',
    port: serverConfig.legacyOscPort
  })
  try {
    if (oscService) {
      debug.info('Stopping OSC service and all additional connections...')
      await new Promise(resolve => setTimeout(resolve, 100))
      try {
        oscService.stop()
        oscService = null
        ;(global as any).oscService = null
        debug.info('OSC service stopped successfully')
      } catch (error: any) {
        debug.error(`Error stopping OSC service: ${error.message}`)
      }
      try {
        if (oscServer) {
          oscServer.close()
          oscServer = null
        }
      } catch (error: any) {
        debug.error(`Error closing OSC server: ${error.message}`)
      }
      try {
        if (oscClient) {
          oscClient.close()
          oscClient = null
        }
      } catch (error: any) {
        debug.error(`Error closing OSC client: ${error.message}`)
      }
      try {
        if (oscQueryService) {
          await oscQueryService.stop()
          debug.info('OSC Query service stopped and ready for reuse')
        }
      } catch (error: any) {
        debug.error(`Error stopping OSC Query service: ${error.message}`)
      }
      sendToRenderer('osc-server-status', {
        status: 'disabled',
        port: serverConfig.legacyOscPort
      })
      debug.info('OSC service fully disabled - all connections closed')
      return { success: true, message: 'OSC disabled' }
    } else {
      debug.info('OSC service was not running')
      sendToRenderer('osc-server-status', {
        status: 'disabled',
        port: serverConfig.legacyOscPort
      })
      return { success: true, message: 'OSC was already disabled' }
    }
  } catch (error: any) {
    debug.error(`Error during OSC disable: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// OSC Query unsubscription management
ipcMain.handle('get-oscquery-unsubscriptions', () => {
  try {
    if (oscQueryService) {
      return {
        success: true,
        unsubscriptions: oscQueryService.getUserUnsubscriptions()
      }
    }
    return {
      success: true,
      unsubscriptions: serverConfig.oscQueryUnsubscriptions || []
    }
  } catch (error: any) {
    debug.error(`Failed to get OSC Query unsubscriptions: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('add-oscquery-unsubscription', (_event, oscPath: string) => {
  try {
    const currentUnsubs = serverConfig.oscQueryUnsubscriptions || []
    if (currentUnsubs.includes(oscPath)) {
      return { success: true, message: 'Unsubscription already exists', unsubscriptions: currentUnsubs }
    }
    const newUnsubs = [...currentUnsubs, oscPath]
    serverConfig.oscQueryUnsubscriptions = newUnsubs
    configManager.updateConfig({ oscQueryUnsubscriptions: newUnsubs })
    if (oscQueryService && oscQueryService.isRunning) {
      oscQueryService.addUnsubscription(oscPath)
    }
    debug.info(`Added OSC Query unsubscription: ${oscPath}`)
    return { success: true, unsubscriptions: newUnsubs }
  } catch (error: any) {
    debug.error(`Failed to add OSC Query unsubscription: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('remove-oscquery-unsubscription', (_event, oscPath: string) => {
  try {
    const currentUnsubs = serverConfig.oscQueryUnsubscriptions || []
    const newUnsubs = currentUnsubs.filter((sub: string) => sub !== oscPath)
    serverConfig.oscQueryUnsubscriptions = newUnsubs
    configManager.updateConfig({ oscQueryUnsubscriptions: newUnsubs })
    if (oscQueryService && oscQueryService.isRunning) {
      oscQueryService.removeUnsubscription(oscPath)
    }
    debug.info(`Removed OSC Query unsubscription: ${oscPath}`)
    return { success: true, unsubscriptions: newUnsubs }
  } catch (error: any) {
    debug.error(`Failed to remove OSC Query unsubscription: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// Server-managed blocklist/suppression query handlers
ipcMain.handle('get-server-blocklist', () => {
  if (!oscQueryService) return { patterns: [] }
  return { patterns: oscQueryService.getServerBlocklist() }
})
ipcMain.handle('get-server-suppressions', () => {
  if (!oscQueryService) return { addresses: [], metadata: {} }
  return {
    addresses: oscQueryService.getServerSuppressions(),
    metadata: oscQueryService.getServerSuppressionMetadata()
  }
})
ipcMain.handle('request-unsuppress', (_event, address: string) => {
  if (!wsManager) return { success: false, error: 'Not connected to server' }
  try {
    wsManager.requestUnsuppress(address)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
ipcMain.handle('clear-all-suppressions', async () => {
  if (!wsManager) return { success: false, error: 'Not connected to server' }
  try {
    return await wsManager.requestClearAllSuppressions()
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
ipcMain.handle('panel-state-set', async (_event, kind: string, value: boolean) => {
  if (!wsManager) return { success: false, error: 'Not connected to server' }
  try {
    return await wsManager.setPanelState(kind, value)
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
ipcMain.handle('get-hardcoded-unsubscriptions', () => {
  if (!oscQueryService) return { patterns: [] }
  return { patterns: oscQueryService.getHardcodedUnsubscriptions() }
})
ipcMain.handle('get-saved-password', () => {
  const savedPassword = configManager.getSavedPassword()
  return { password: savedPassword }
})
ipcMain.handle('set-saved-password', (_event, password: string) => {
  try {
    const result = configManager.setSavedPassword(password)
    if (result) {
      debug.info(`Password ${password ? 'saved' : 'cleared'} in configuration`)
      return { success: true }
    } else {
      throw new Error('Failed to save password to config file')
    }
  } catch (error: any) {
    debug.error(`Failed to save password: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// HypeRate addon IPC handlers
ipcMain.handle('hyperate-get-status', () => {
  if (hyperateAddon) {
    return hyperateAddon.getStatus()
  }
  return { enabled: false, connected: false, hasApiKey: false }
})
ipcMain.handle('hyperate-start', () => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' }
    }
    const result = hyperateAddon.start(oscService)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to start HypeRate addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('hyperate-stop', () => {
  try {
    if (hyperateAddon) {
      hyperateAddon.stop()
    }
    return { success: true }
  } catch (error: any) {
    debug.error(`Failed to stop HypeRate addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('hyperate-add-tracker', (_event, deviceId: string, deviceName: string | null = null) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' }
    }
    const result = hyperateAddon.addTracker(deviceId, deviceName)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to add HypeRate tracker: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('hyperate-remove-tracker', (_event, deviceId: string) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' }
    }
    const result = hyperateAddon.removeTracker(deviceId)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to remove HypeRate tracker: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('hyperate-update-tracker-name', (_event, deviceId: string, newName: string) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' }
    }
    const result = hyperateAddon.updateTrackerName(deviceId, newName)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to update HypeRate tracker name: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('hyperate-update-tracker-state', (_event, deviceId: string, enabled: boolean) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' }
    }
    const result = hyperateAddon.updateTrackerState(deviceId, enabled)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to update HypeRate tracker state: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('hyperate-get-trackers', () => {
  try {
    if (hyperateAddon) {
      return hyperateAddon.getTrackers()
    }
    return []
  } catch (error: any) {
    debug.error(`Failed to get HypeRate trackers: ${error.message}`)
    return []
  }
})
ipcMain.handle('hyperate-set-primary', (_event, deviceId: string) => {
  try {
    if (!hyperateAddon) {
      return { success: false, error: 'HypeRate addon not initialized' }
    }
    const result = hyperateAddon.setPrimaryTracker(deviceId)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to set primary HypeRate tracker: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('hyperate-get-autostart', () => {
  try {
    const appSettings = configManager.getAppSettings()
    return { enabled: appSettings.hyperateAutostart || false }
  } catch (error: any) {
    debug.error(`Failed to get HypeRate autostart setting: ${error.message}`)
    return { enabled: false }
  }
})
ipcMain.handle('hyperate-set-autostart', (_event, enabled: boolean) => {
  try {
    const result = configManager.updateAppSettings({ hyperateAutostart: enabled })
    if (result) {
      debug.info(`HypeRate autostart ${enabled ? 'enabled' : 'disabled'}`)
      return { success: true, enabled }
    } else {
      throw new Error('Failed to save autostart setting')
    }
  } catch (error: any) {
    debug.error(`Failed to set HypeRate autostart: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// HypeRate history IPC handlers
ipcMain.handle('hyperate-get-history', (_event, trackerId: string, fromMs: number, toMs: number, maxPoints?: number) => {
  try {
    if (!hyperateAddon) return { readings: [] }
    return { readings: hyperateAddon.getHistory(trackerId, fromMs, toMs, maxPoints) }
  } catch (error: any) {
    debug.error(`Failed to get HypeRate history: ${error.message}`)
    return { readings: [] }
  }
})
ipcMain.handle('hyperate-get-stats', (_event, trackerId: string, fromMs: number, toMs: number) => {
  try {
    if (!hyperateAddon) return { min: null, max: null, avg: null, count: 0, firstAt: null, lastAt: null }
    return hyperateAddon.getHistoryStats(trackerId, fromMs, toMs)
  } catch (error: any) {
    debug.error(`Failed to get HypeRate stats: ${error.message}`)
    return { min: null, max: null, avg: null, count: 0, firstAt: null, lastAt: null }
  }
})
ipcMain.handle('hyperate-get-history-config', () => {
  try {
    if (!hyperateAddon) return { retentionDays: 7 }
    return { retentionDays: hyperateAddon.getHistoryRetention() }
  } catch (error: any) {
    debug.error(`Failed to get HypeRate history config: ${error.message}`)
    return { retentionDays: 7 }
  }
})
ipcMain.handle('hyperate-set-history-config', (_event, config: { retentionDays: number }) => {
  try {
    if (!hyperateAddon) return { success: false }
    hyperateAddon.setHistoryRetention(config.retentionDays)
    return { success: true }
  } catch (error: any) {
    debug.error(`Failed to set HypeRate history config: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// HypeRate capture rate IPC handlers
ipcMain.handle('hyperate-get-capture-rate', () => {
  try {
    if (!hyperateAddon) return { rateMs: 2000 }
    return { rateMs: hyperateAddon.getCaptureRate() }
  } catch (error: any) {
    debug.error(`Failed to get HypeRate capture rate: ${error.message}`)
    return { rateMs: 2000 }
  }
})
ipcMain.handle('hyperate-set-capture-rate', (_event, config: { rateMs: number }) => {
  try {
    if (!hyperateAddon) return { success: false }
    hyperateAddon.setCaptureRate(config.rateMs)
    return { success: true }
  } catch (error: any) {
    debug.error(`Failed to set HypeRate capture rate: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// Whisper addon IPC handlers (Vosk removed — Whisper is the only speech-recognition engine)
ipcMain.handle('whisper-get-status', () => {
  if (whisperAddon) {
    return whisperAddon.getStatus()
  }
  return null
})
ipcMain.handle('whisper-preflight', async () => {
  // Two-tier preflight:
  //   1. Cheap — does the worker JS file exist at any known location?
  //   2. Live — actually spawn a throwaway worker, ping it with
  //      `{type:'preflight'}`, wait up to 3s for a response, then
  //      terminate. This catches asar-path issues where the file
  //      exists virtually but `new Worker()` hangs or silently fails.
  //      Without tier 2, the user would see "Starting..." forever
  //      in prod builds even though preflight reported ok.
  if (!whisperAddon) {
    return { ok: false, bundledLibsOk: false, dllPath: null, lastError: 'Whisper addon not yet initialised' }
  }
  try {
    const cheap = whisperAddon.preflight()
    if (!cheap.ok) {
      return {
        ok: cheap.ok,
        bundledLibsOk: cheap.bundledLibsOk,
        dllPath: cheap.bridgePath,
        lastError: cheap.lastError
      }
    }
    const live = await whisperAddon.runLivePreflight()
    return {
      ok: live.ok,
      bundledLibsOk: live.bundledLibsOk,
      dllPath: live.bridgePath,
      lastError: live.lastError
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    debug.error(`Whisper preflight failed: ${message}`)
    return { ok: false, bundledLibsOk: false, dllPath: null, lastError: message }
  }
})
ipcMain.handle('whisper-start', async () => {
  try {
    if (!whisperAddon) {
      return { success: false, error: 'Whisper addon not initialized' }
    }
    const result = await whisperAddon.start(oscService)
    return { success: result, error: result ? undefined : whisperAddon.getStatus().lastError }
  } catch (error: any) {
    debug.error(`Failed to start Whisper addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('whisper-stop', () => {
  try {
    if (whisperAddon) {
      whisperAddon.stop()
    }
    return { success: true }
  } catch (error: any) {
    debug.error(`Failed to stop Whisper addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('whisper-get-config', () => {
  if (whisperAddon) {
    return whisperAddon.getConfig()
  }
  return null
})
ipcMain.handle('whisper-update-config', (_event, config: any) => {
  try {
    if (!whisperAddon) {
      return { success: false, error: 'Whisper addon not initialized' }
    }
    const result = whisperAddon.updateConfig(config)
    return { success: result, error: result ? undefined : whisperAddon.getStatus().lastError }
  } catch (error: any) {
    debug.error(`Failed to update Whisper config: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('whisper-download-model', async () => {
  try {
    if (!whisperAddon) {
      return { success: false, error: 'Whisper addon not initialized' }
    }
    return await whisperAddon.downloadModel()
  } catch (error: any) {
    debug.error(`Failed to download Whisper model: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('whisper-set-input-device', (_event, deviceId: string | null) => {
  try {
    if (!whisperAddon) {
      return { success: false, error: 'Whisper addon not initialized' }
    }
    const result = whisperAddon.setInputDevice(deviceId)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to set Whisper input device: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('whisper-get-autostart', () => {
  try {
    const appSettings = configManager.getAppSettings()
    return { enabled: appSettings.whisperAutostart || false }
  } catch (error: any) {
    debug.error(`Failed to get Whisper autostart: ${error.message}`)
    return { enabled: false }
  }
})
ipcMain.handle('whisper-set-autostart', (_event, enabled: boolean) => {
  try {
    const result = configManager.updateAppSettings({ whisperAutostart: enabled })
    if (result) {
      debug.info(`Whisper autostart ${enabled ? 'enabled' : 'disabled'}`)
      return { success: true, enabled }
    } else {
      throw new Error('Failed to save autostart setting')
    }
  } catch (error: any) {
    debug.error(`Failed to set Whisper autostart: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// Renderer -> main: Int16 PCM chunks from the AudioWorklet. The
// supervisor forwards them to the Node whisper worker_thread via
// transferable ArrayBuffer (zero-copy). See
// main/containers/whisper/whisper.ts for the worker supervisor and
// main/containers/whisper/whisper-worker.js for the actual binding.
ipcMain.on('whisper-audio-chunk', (_event, chunk: ArrayBuffer, sampleRate: number, level: number): void => {
  try {
    if (whisperAddon && whisperAddon.isEnabled()) {
      whisperAddon.acceptAudio(Buffer.from(chunk), sampleRate, level)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    debug.error(`Failed to process Whisper audio chunk: ${message}`)
  }
})
// OSCLeash addon IPC handlers
ipcMain.handle('oscleash-get-status', () => {
  if (oscLeashAddon) {
    return oscLeashAddon.getStatus()
  }
  return { enabled: false, leashCount: 0, activeLeashes: [] }
})
ipcMain.handle('oscleash-start', () => {
  try {
    if (!oscLeashAddon) {
      return { success: false, error: 'OSCLeash addon not initialized' }
    }
    if (!oscQueryService) {
      return { success: false, error: 'OSC-Query service not available' }
    }
    if (!oscService) {
      return { success: false, error: 'OSC service not available' }
    }
    const result = oscLeashAddon.start(oscQueryService, oscService)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to start OSCLeash addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('oscleash-stop', () => {
  try {
    if (oscLeashAddon) {
      oscLeashAddon.stop()
    }
    return { success: true }
  } catch (error: any) {
    debug.error(`Failed to stop OSCLeash addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('oscleash-get-config', () => {
  try {
    if (oscLeashAddon) {
      return oscLeashAddon.getConfig()
    }
    return null
  } catch (error: any) {
    debug.error(`Failed to get OSCLeash config: ${error.message}`)
    return null
  }
})
ipcMain.handle('oscleash-update-config', (_event, newConfig: any) => {
  try {
    if (!oscLeashAddon) {
      return { success: false, error: 'OSCLeash addon not initialized' }
    }
    const result = oscLeashAddon.updateConfig(newConfig)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to update OSCLeash config: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('oscleash-get-autostart', () => {
  try {
    const appSettings = configManager.getAppSettings()
    return { enabled: appSettings.oscleashAutostart || false }
  } catch (error: any) {
    debug.error(`Failed to get OSCLeash autostart setting: ${error.message}`)
    return { enabled: false }
  }
})
ipcMain.handle('oscleash-set-autostart', (_event, enabled: boolean) => {
  try {
    const result = configManager.updateAppSettings({ oscleashAutostart: enabled })
    if (result) {
      debug.info(`OSCLeash autostart ${enabled ? 'enabled' : 'disabled'}`)
      return { success: true, enabled }
    } else {
      throw new Error('Failed to save autostart setting')
    }
  } catch (error: any) {
    debug.error(`Failed to set OSCLeash autostart: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// OscGoesBrrr addon IPC handlers
ipcMain.handle('ogb-get-status', () => {
  if (oscGoesBrrrAddon) {
    return oscGoesBrrrAddon.getStatus()
  }
  return { enabled: false, connected: false, deviceCount: 0 }
})
ipcMain.handle('ogb-start', () => {
  try {
    if (!oscGoesBrrrAddon) {
      return { success: false, error: 'OscGoesBrrr addon not initialized' }
    }
    const result = oscGoesBrrrAddon.start()
    return result
  } catch (error: any) {
    debug.error(`Failed to start OscGoesBrrr addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('ogb-stop', () => {
  try {
    if (oscGoesBrrrAddon) {
      oscGoesBrrrAddon.stop()
    }
    return { success: true }
  } catch (error: any) {
    debug.error(`Failed to stop OscGoesBrrr addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('ogb-get-devices', () => {
  try {
    if (oscGoesBrrrAddon) {
      return oscGoesBrrrAddon.getStatus().devices || []
    }
    return []
  } catch (error: any) {
    debug.error(`Failed to get OscGoesBrrr devices: ${error.message}`)
    return []
  }
})
ipcMain.handle('ogb-get-config', () => {
  try {
    if (oscGoesBrrrAddon) {
      return oscGoesBrrrAddon.getConfig()
    }
    return configManager.getOgbConfig()
  } catch (error: any) {
    debug.error(`Failed to get OscGoesBrrr config: ${error.message}`)
    return {}
  }
})
ipcMain.handle('ogb-update-config', (_event, config: any) => {
  try {
    if (!oscGoesBrrrAddon) {
      return { success: false, error: 'OscGoesBrrr addon not initialized' }
    }
    const result = oscGoesBrrrAddon.updateConfig(config)
    return result
  } catch (error: any) {
    debug.error(`Failed to update OscGoesBrrr config: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('ogb-update-device-binding', (_event, deviceId: string, binding: any) => {
  try {
    if (!oscGoesBrrrAddon) {
      return { success: false, error: 'OscGoesBrrr addon not initialized' }
    }
    const result = oscGoesBrrrAddon.updateDeviceBinding(deviceId, binding)
    return result
  } catch (error: any) {
    debug.error(`Failed to update OscGoesBrrr device binding: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('ogb-update-intiface-config', (_event, config: any) => {
  try {
    if (!oscGoesBrrrAddon) {
      return { success: false, error: 'OscGoesBrrr addon not initialized' }
    }
    const result = oscGoesBrrrAddon.updateIntifaceConfig(config)
    return result
  } catch (error: any) {
    debug.error(`Failed to update Intiface config: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('ogb-get-autostart', () => {
  try {
    const appSettings = configManager.getAppSettings()
    return { enabled: appSettings.ogbAutostart || false }
  } catch (error: any) {
    debug.error(`Failed to get OscGoesBrrr autostart setting: ${error.message}`)
    return { enabled: false }
  }
})
ipcMain.handle('ogb-set-autostart', (_event, enabled: boolean) => {
  try {
    const result = configManager.updateAppSettings({ ogbAutostart: enabled })
    if (result) {
      debug.info(`OscGoesBrrr autostart ${enabled ? 'enabled' : 'disabled'}`)
      return { success: true, enabled }
    } else {
      throw new Error('Failed to save autostart setting')
    }
  } catch (error: any) {
    debug.error(`Failed to set OscGoesBrrr autostart: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// Encryption/Decryption IPC handlers
ipcMain.handle('encrypt-data', (_event, plaintext: string) => {
  return encryptData(plaintext)
})
ipcMain.handle('decrypt-data', (_event, encryptedData: string) => {
  return decryptData(encryptedData)
})
// VRChat API IPC handlers
ipcMain.handle('vrchatapi-get-status', () => {
  try {
    if (vrchatApiContainer) {
      return vrchatApiContainer.getStatus()
    }
    return { enabled: false, authenticated: false, currentUser: null }
  } catch (error: any) {
    debug.error(`Failed to get VRChat API status: ${error.message}`)
    return { enabled: false, authenticated: false, currentUser: null }
  }
})
ipcMain.handle('vrchatapi-login', async (_event, credentials: any) => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' }
    }
    const { username, password, rememberCredentials } = credentials
    const result = await vrchatApiContainer.login(username, password, rememberCredentials)
    if (result?.success) {
      syncAutoStatusWithVrchatAccount()
    }
    return result
  } catch (error: any) {
    debug.error(`VRChat API login error: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('vrchatapi-verify-2fa', async (_event, data: any) => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' }
    }
    const { code, type } = data
    const result = await vrchatApiContainer.verify2FA(code, type)
    if (result?.success) {
      syncAutoStatusWithVrchatAccount()
    }
    return result
  } catch (error: any) {
    debug.error(`VRChat API 2FA verification error: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('vrchatapi-logout', async () => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' }
    }
    const result = await vrchatApiContainer.logout()
    if (result?.success && autoStatusContainer) {
      autoStatusContainer.syncCurrentStatus(null, null)
    }
    return result
  } catch (error: any) {
    debug.error(`VRChat API logout error: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('vrchatapi-restore-session', async () => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' }
    }
    const result = await vrchatApiContainer.restoreSession()
    if (result?.success) {
      syncAutoStatusWithVrchatAccount()
    }
    return result
  } catch (error: any) {
    debug.error(`VRChat API session restore error: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('vrchatapi-get-stats', async () => {
  try {
    if (!vrchatApiContainer) {
      return { success: false, error: 'VRChat API container not initialized' }
    }
    const result = await vrchatApiContainer.getStats()
    return result
  } catch (error: any) {
    debug.error(`VRChat API get stats error: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// --- AutoStatus IPC Handlers ---
ipcMain.handle('autostatus-get-config', () => {
  if (!autoStatusContainer) return { presets: [], schedule: [], locationRules: [], settings: {} }
  return {
    presets: autoStatusContainer.getPresets(),
    schedule: autoStatusContainer.getSchedule(),
    locationRules: autoStatusContainer.getLocationRules(),
    settings: autoStatusContainer.getSettings()
  }
})
ipcMain.handle('autostatus-get-status', () => {
  if (!autoStatusContainer) return {}
  return autoStatusContainer.getStatus()
})
ipcMain.handle('autostatus-set-preset', async (_event, presetData: any) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.setPreset(presetData)
})
ipcMain.handle('autostatus-delete-preset', async (_event, presetId: string) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.deletePreset(Number(presetId))
})
ipcMain.handle('autostatus-test-preset', async (_event, presetId: string) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.applyPreset(Number(presetId), 'manual')
})
ipcMain.handle('autostatus-add-schedule', async (_event, entry: any) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.addScheduleEntry(entry)
})
ipcMain.handle('autostatus-update-schedule', async (_event, entryId: string, updates: any) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.updateScheduleEntry(entryId, updates)
})
ipcMain.handle('autostatus-delete-schedule', async (_event, entryId: string) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.deleteScheduleEntry(entryId)
})
ipcMain.handle('autostatus-update-settings', async (_event, settings: any) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.updateSettings(settings)
})
// Location Rule IPC handlers
ipcMain.handle('autostatus-get-location-rules', () => {
  if (!autoStatusContainer) return []
  return autoStatusContainer.getLocationRules()
})
ipcMain.handle('autostatus-add-location-rule', async (_event, rule: any) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.addLocationRule(rule)
})
ipcMain.handle('autostatus-update-location-rule', async (_event, ruleId: string, updates: any) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.updateLocationRule(ruleId, updates)
})
ipcMain.handle('autostatus-delete-location-rule', async (_event, ruleId: string) => {
  if (!autoStatusContainer) return { success: false, error: 'Not initialized' }
  return autoStatusContainer.deleteLocationRule(ruleId)
})
// Calendar IPC handlers
ipcMain.handle('calendar-fetch', async () => {
  if (!calendarContainer) return { success: false, error: 'Not initialized' }
  return calendarContainer.fetchEvents()
})
ipcMain.handle('calendar-get-status', async () => {
  if (!calendarContainer) return { success: false, error: 'Not initialized' }
  return calendarContainer.getEvents()
})
// OpenShock IPC handlers
ipcMain.handle('openshock-get-status', async () => {
  if (!openShockContainer) return { enabled: false, connected: false, hasApiToken: false, deviceCount: 0, baseUrl: '' }
  return openShockContainer.getStatus()
})
ipcMain.handle('openshock-start', async (_event, apiToken: string) => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  return openShockContainer.start(apiToken)
})
ipcMain.handle('openshock-stop', async () => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  return openShockContainer.stop()
})
ipcMain.handle('openshock-clear-saved-token', async () => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  return { success: openShockContainer.clearSavedToken() }
})
ipcMain.handle('openshock-list-shockers', async () => {
  if (!openShockContainer) return []
  try {
    return await openShockContainer.listOwnShockers()
  } catch (error: any) {
    debug.error(`OpenShock: Failed to list shockers: ${error.message}`)
    return []
  }
})
ipcMain.handle('openshock-list-shockers-shared', async () => {
  if (!openShockContainer) return []
  try {
    return await openShockContainer.listSharedShockers()
  } catch (error: any) {
    debug.error(`OpenShock: Failed to list shared shockers: ${error.message}`)
    return []
  }
})
ipcMain.handle('openshock-create-share-link', async (_event, shockerId: string, permissions: any, limits: any) => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  try {
    return await openShockContainer.createShareCode(shockerId, permissions, limits)
  } catch (error: any) {
    debug.error(`OpenShock: Failed to create share link: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('openshock-login', async (_event, email: string, password: string) => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  return openShockContainer.loginWithCredentials(email, password)
})
ipcMain.handle('openshock-logout', async () => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  return openShockContainer.logout()
})
ipcMain.handle('openshock-get-login-status', async () => {
  if (!openShockContainer) return { loggedIn: false, username: null }
  return openShockContainer.getLoginStatus()
})
ipcMain.handle('openshock-clear-saved-credentials', async () => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  openShockContainer.logout()
  return { success: true }
})
ipcMain.handle('openshock-send-control', async (_event, shocks: any[]) => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  try {
    await openShockContainer.sendControl(shocks)
    // Log each shock to the database
    try {
      const db = getDb()
      const insert = db.prepare(
        'INSERT INTO openshock_control_log (shocker_id, shocker_name, control_type, intensity, duration, success, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      const devices = openShockContainer.devices || []
      for (const shock of shocks) {
        let shockerName = shock.id
        for (const dev of devices) {
          const s = (dev.shockers || []).find((sh: any) => sh.id === shock.id)
          if (s) { shockerName = s.name; break }
        }
        insert.run(shock.id, shockerName, shock.type, shock.intensity ?? null, shock.duration ?? null, 1, Date.now())
      }
    } catch (dbErr: any) {
      debug.error(`OpenShock: Failed to log control to DB: ${dbErr.message}`)
    }
    return { success: true }
  } catch (error: any) {
    debug.error(`OpenShock: Failed to send control: ${error.message}`)
    // Log failed attempts too
    try {
      const db = getDb()
      const insert = db.prepare(
        'INSERT INTO openshock_control_log (shocker_id, shocker_name, control_type, intensity, duration, success, error_message, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      for (const shock of shocks) {
        insert.run(shock.id, shock.id, shock.type, shock.intensity ?? null, shock.duration ?? null, 0, error.message, Date.now())
      }
    } catch { /* ignore DB logging failure */ }
    return { success: false, error: error.message }
  }
})
ipcMain.handle('openshock-pause-shocker', async (_event, shockerId: string, pause: boolean) => {
  if (!openShockContainer) return false
  return openShockContainer.pauseShocker(shockerId, pause)
})
ipcMain.handle('openshock-list-shares', async (_event, shockerId: string) => {
  if (!openShockContainer) return []
  return openShockContainer.listShockerShares(shockerId)
})
ipcMain.handle('openshock-delete-share', async (_event, shockerId: string, sharedWithUserId: string) => {
  if (!openShockContainer) return
  return openShockContainer.deleteShareCode(shockerId, sharedWithUserId)
})
ipcMain.handle('openshock-pause-share', async (_event, shockerId: string, sharedWithUserId: string, pause: boolean) => {
  if (!openShockContainer) return false
  return openShockContainer.pauseShare(shockerId, sharedWithUserId, pause)
})
ipcMain.handle('openshock-list-tokens', async () => {
  if (!openShockContainer) return []
  return openShockContainer.listTokens()
})
ipcMain.handle('openshock-create-token', async (_event, name: string, permissions: any) => {
  if (!openShockContainer) return { success: false, error: 'Not initialized' }
  return openShockContainer.createToken(name, permissions)
})
ipcMain.handle('openshock-delete-token', async (_event, tokenId: string) => {
  if (!openShockContainer) return
  return openShockContainer.deleteToken(tokenId)
})
ipcMain.handle('openshock-get-logs', async (_event, shockerId: string, page?: number, size?: number) => {
  if (!openShockContainer) return []
  return openShockContainer.getShockerLogs(shockerId, page ?? 1, size ?? 20)
})
// Control log query handlers
ipcMain.handle('openshock-get-control-logs', async (_event, limit: number = 50, offset: number = 0) => {
  try {
    const db = getDb()
    return db.prepare('SELECT * FROM openshock_control_log ORDER BY recorded_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  } catch (error: any) {
    debug.error(`Failed to get control logs: ${error.message}`)
    return []
  }
})
ipcMain.handle('xsoverlay-get-notification-logs', async (_event, limit: number = 50, offset: number = 0) => {
  try {
    const db = getDb()
    return db.prepare('SELECT * FROM xs_overlay_notification_log ORDER BY recorded_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  } catch (error: any) {
    debug.error(`Failed to get notification logs: ${error.message}`)
    return []
  }
})
// ARCLink IPC handlers
ipcMain.handle('arclink-start', async () => {
  if (!arcLinkContainer) return { success: false, error: 'Not initialized' }
  return arcLinkContainer.start()
})
ipcMain.handle('arclink-stop', async () => {
  if (!arcLinkContainer) return { success: false, error: 'Not initialized' }
  return arcLinkContainer.stop()
})
ipcMain.handle('arclink-get-status', async () => {
  if (!arcLinkContainer) return { success: false, error: 'Not initialized' }
  return arcLinkContainer.getStatus()
})
// XS Overlay IPC handlers
ipcMain.handle('xsoverlay-get-status', () => {
  if (xsOverlayAddon) {
    return xsOverlayAddon.getStatus()
  }
  return { enabled: false, connected: false, xsOverlayRunning: false, config: null, notificationLog: [] }
})
ipcMain.handle('xsoverlay-start', () => {
  try {
    if (!xsOverlayAddon) {
      return { success: false, error: 'XS Overlay addon not initialized' }
    }
    const result = xsOverlayAddon.start()
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to start XS Overlay addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('xsoverlay-stop', () => {
  try {
    if (xsOverlayAddon) {
      xsOverlayAddon.stop()
    }
    return { success: true }
  } catch (error: any) {
    debug.error(`Failed to stop XS Overlay addon: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('xsoverlay-get-config', () => {
  try {
    if (xsOverlayAddon) {
      return xsOverlayAddon.getConfig()
    }
    return null
  } catch (error: any) {
    debug.error(`Failed to get XS Overlay config: ${error.message}`)
    return null
  }
})
ipcMain.handle('xsoverlay-update-config', (_event, newConfig: any) => {
  try {
    if (!xsOverlayAddon) {
      return { success: false, error: 'XS Overlay addon not initialized' }
    }
    const result = xsOverlayAddon.updateConfig(newConfig)
    return { success: result }
  } catch (error: any) {
    debug.error(`Failed to update XS Overlay config: ${error.message}`)
    return { success: false, error: error.message }
  }
})
ipcMain.handle('xsoverlay-get-autostart', () => {
  try {
    const appSettings = configManager.getAppSettings()
    return { enabled: appSettings.xsOverlayAutostart || false }
  } catch (error: any) {
    debug.error(`Failed to get XS Overlay autostart setting: ${error.message}`)
    return { enabled: false }
  }
})
ipcMain.handle('xsoverlay-set-autostart', (_event, enabled: boolean) => {
  try {
    const result = configManager.updateAppSettings({ xsOverlayAutostart: enabled })
    if (result) {
      debug.info(`XS Overlay autostart ${enabled ? 'enabled' : 'disabled'}`)
      return { success: true, enabled }
    } else {
      throw new Error('Failed to save autostart setting')
    }
  } catch (error: any) {
    debug.error(`Failed to set XS Overlay autostart: ${error.message}`)
    return { success: false, error: error.message }
  }
})
// ────────── App Lifecycle ──────────
app.whenReady().then(async () => {
  debug.logAppStartup()
  // Create splash window immediately after log cleanup
  createWindow()

  // Auto-grant microphone (and related media) permissions so the speech bridge can
  // start capture without showing the OS permission prompt. This applies to every
  // renderer session the app creates — the user can still revoke mic access from
  // the OS settings if they want.
  const grantMediaPermissions = (permission: string) => {
    const allowed = permission === 'media' || permission === 'audioCapture' || permission === 'mediaKeySystem'
    debug.info(`[permissions] ${permission} -> ${allowed ? 'granted' : 'denied'}`)
    return allowed
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    try { callback(grantMediaPermissions(permission)) } catch (err) { debug.error(`[permissions] handler error: ${(err as Error).message}`); callback(false) }
  })
  // Some Chromium versions use the device-permission handler for media-device
  // enumeration. Auto-grant on our own origin so navigator.mediaDevices.enumerateDevices
  // returns full labels without prompting the user.
  session.defaultSession.setDevicePermissionHandler?.((details) => {
    debug.info(`[permissions] device-permission requested for ${details.deviceType} on ${details.origin}`)
    return true
  })

  // Start OSC IPC batching and memory management
  setupOscIpcBatching()
  // Initialize addons
  updateSplashProgress(20, 'Initializing addons')
  hyperateAddon = new HyperateAddon()
  whisperAddon = new WhisperAddon()
  // Surface the worker file path the addon resolved to. In prod this
  // is the asar-unpacked path; if it points inside the asar (a
  // regression), the asar-detection in resolveWorkerFile() logs a
  // warning we want to see during startup.
  {
    const status = whisperAddon.getStatus()
    const bridgePath = status.bridgePath ?? ''
    const dir = bridgePath ? path.dirname(bridgePath) : '(none)'
    debug.info(`[whisper] constructor: bridgePathDir=${dir}; bridgePath=${bridgePath || 'NOT FOUND'}`)
    if (bridgePath && bridgePath.includes('.asar') && !bridgePath.includes('app.asar.unpacked')) {
      debug.warn(
        '[whisper] WARNING: bridgePath appears to point inside the asar virtual FS. ' +
          'Worker spawn will likely fail silently. Run with --enable-logging to confirm.'
      )
    }
  }
  oscLeashAddon = new OSCLeashAddon()
  vrchatApiContainer = new VRChatAPIContainer()
  oscGoesBrrrAddon = new OscGoesBrrrAddon()
  autoStatusContainer = new AutoStatusContainer()
  xsOverlayAddon = new XSOverlayAddon()
  calendarContainer = new Calendar()
  openShockContainer = new OpenShock()
  arcLinkContainer = new ARCLink()
  await calendarContainer.init()
  await openShockContainer.init()
  await arcLinkContainer.init()
  // Set up HypeRate status and heart rate callbacks
  hyperateAddon.setStatusChangeCallback((status: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hyperate-update', { type: 'status', ...status })
    }
  })
  hyperateAddon.setHeartRateCallback((data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hyperate-update', data)
    }
  })
  // Set up Whisper callbacks (mirror Vosk shape exactly — Vosk removed)
  whisperAddon.setStatusChangeCallback((status: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whisper-update', { type: 'status', ...status })
    }
  })
  whisperAddon.setResultCallback((result: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whisper-update', { type: 'result', ...result })
    }
  })
  whisperAddon.setDownloadProgressCallback((progress: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whisper-update', { type: 'download-progress', ...progress })
    }
  })
  whisperAddon.setCaptureControlCallback((control: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whisper-capture-control', control)
    }
  })
  // Dedicated level channel. Previously levels were sent through
  // whisper-capture-control {action:'update', gain:<level>}, which
  // the renderer's whisperCapture.ts listener applied as a SETGAIN
  // to the AudioWorklet — feedback loop with loud mics. Split
  // into a separate IPC channel so capture-control and level
  // reporting never mix.
  whisperAddon.setLevelCallback((level: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whisper-update', { type: 'level', value: level })
    }
  })
  // Dedicated level channel. Previously levels were sent through
  // whisper-capture-control {action:'update', gain:<level>}, which
  // the renderer's whisperCapture.ts listener applied as a SETGAIN
  // to the AudioWorklet — feedback loop with loud mics. Split
  // into a separate IPC channel so capture-control and level
  // reporting never mix.
  whisperAddon.setLevelCallback((level: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whisper-update', { type: 'level', value: level })
    }
  })
  // Set up OSCLeash status and movement callbacks
  oscLeashAddon.setStatusChangeCallback((status: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oscleash-status-update', status)
    }
  })
  oscLeashAddon.setMovementCallback((data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oscleash-movement-data', data)
    }
  })
  // Set up OscGoesBrrr status callback
  oscGoesBrrrAddon.setStatusChangeCallback((status: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ogb-status-update', status)
    }
  })
  // Set up AutoStatus callbacks and start
  autoStatusContainer.setStatusChangeCallback((status: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('autostatus-update', status)
    }
  })
  autoStatusContainer.start(vrchatApiContainer)
  // Set up XS Overlay status and notification callbacks
  xsOverlayAddon.setStatusChangeCallback((status: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('xsoverlay-status', status)
    }
  })
  xsOverlayAddon.setNotificationLogCallback((entry: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('xsoverlay-notification', entry)
    }
  })
  // Set up pipeline event forwarding
  vrchatApiContainer.setPipelineEventCallback((event: string, data: any) => {
    if (event === 'user-update' && autoStatusContainer && data?.user) {
      autoStatusContainer.handleExternalStatusChange(
        data.user.status || null,
        data.user.statusDescription || null
      )
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vrchatapi-pipeline-event', { event, data })
    }
  })
  // Get app settings from config
  updateSplashProgress(30, 'Loading configuration')
  const appSettings = configManager.getAppSettings()
  // Ensure serverConfig has appSettings
  if (!serverConfig.appSettings) {
    serverConfig.appSettings = appSettings || {}
  } else {
    serverConfig.appSettings = { ...appSettings, ...serverConfig.appSettings }
  }
  // Restore OSC enabled state from saved config
  if (appSettings.oscAutostart) {
    oscEnabled = true
    debug.info('OSC autostart enabled from saved config')
  }
  // Start XS Overlay if autostart is enabled
  if (appSettings.xsOverlayAutostart && !xsOverlayAddon.isEnabled()) {
    debug.info('Starting XS Overlay addon based on autostart setting...')
    xsOverlayAddon.start()
  }
  const needsOscForAutostart = appSettings.hyperateAutostart || appSettings.oscleashAutostart
  // Wait for main window to finish loading
  updateSplashProgress(40, 'Loading interface')
  await new Promise<void>(resolve => {
    if (mainWindow!.webContents.isLoading()) {
      mainWindow!.webContents.once('did-finish-load', resolve)
    } else {
      resolve()
    }
  })
  // Send settings to renderer now that window is ready
  updateSplashProgress(50, 'Configuring settings')
  sendToRenderer('app-settings', appSettings)
  if (!oscEnabled) {
    sendToRenderer('osc-server-status', {
      status: 'disabled',
      port: serverConfig.legacyOscPort
    })
  }
  sendToRenderer('websocket-status', {
    status: 'disconnected'
  })
  // Set up periodic memory management
  updateSplashProgress(60, 'Setting up memory management')
  setupMemoryManagement()
  // Initialize OSC services
  updateSplashProgress(70, 'Preparing services')
  if (oscEnabled) {
    debug.info('Starting OSC service...')
    initOscServer()
    initOscClient()
  } else {
    if (needsOscForAutostart) {
      debug.info('Autostart features are enabled but OSC is disabled. Please enable OSC to use autostart functionality.')
    }
  }
  updateSplashProgress(90, 'Finishing up')
  // Deferred status sync
  setTimeout(() => {
    if (oscEnabled && oscService) {
      sendToRenderer('osc-server-status', {
        status: 'connected',
        port: serverConfig.legacyOscPort
      })
    } else {
      sendToRenderer('osc-server-status', {
        status: 'disabled',
        port: serverConfig.legacyOscPort
      })
    }
  }, 1500)
  // Schedule mDNS discovery after UI is fully loaded
  setTimeout(() => {
    if (oscQueryService && oscQueryService.isRunning) {
      debug.info('Triggering OSC Query mDNS discovery for VRChat awareness...')
      oscQueryService.triggerDiscovery()
    }
  }, 5000)
  setTimeout(() => {
    debug.connectionTimeout()
  }, 30000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})
function setupMemoryManagement() {
  if ((global as any).memoryManagementInterval) {
    clearInterval((global as any).memoryManagementInterval)
  }
  ;(global as any).memoryManagementInterval = setInterval(() => {
    try {
      if ((global as any).gc) {
        ;(global as any).gc()
      }
      const memoryUsage = process.memoryUsage()
      const memoryMB = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      }
      if (memoryUsage.heapUsed > 80 * 1024 * 1024) {
        debug.warn(`High memory usage detected: ${JSON.stringify(memoryMB)}`)
        if (memoryUsage.heapUsed > 120 * 1024 * 1024) {
          debug.warn('Very high memory usage - forcing aggressive cleanup')
          if ((global as any).gc) {
            ;(global as any).gc()
            setTimeout(() => (global as any).gc && (global as any).gc(), 100)
            setTimeout(() => (global as any).gc && (global as any).gc(), 200)
          }
        }
      }
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        try {
          const rendererMetrics = (mainWindow.webContents as any).getProcessMemoryInfo()
          rendererMetrics.then((info: any) => {
            const rendererPrivateMB = Math.round(info.private / 1024)
            if (rendererPrivateMB > 512) {
              debug.warn(`Renderer memory high: ${rendererPrivateMB}MB - triggering proactive cleanup`)
              sendToRenderer('memory-pressure', { level: 'high', memoryMB: rendererPrivateMB })
            }
          }).catch(() => {})
        } catch {
          // Renderer may be unavailable during shutdown
        }
      }
    } catch (error: any) {
      debug.error(`Memory management error: ${error.message}`)
    }
  }, 20000)
}
function showCrashDialog(title: string, message: string): boolean {
  try {
    const result = dialog.showMessageBoxSync({
      type: 'error',
      title: title,
      message: title,
      detail: message,
      buttons: ['Restart Application', 'Close'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    return result === 0
  } catch {
    dialog.showErrorBox(title, message)
    return true
  }
}
function relaunchApp() {
  try {
    debug.info('Attempting to relaunch application...')
    app.relaunch()
    app.exit(0)
  } catch (relaunchError: any) {
    debug.error(`Failed to relaunch application: ${relaunchError.message}`)
    process.exit(1)
  }
}
function cleanup(source = 'unknown') {
  if (isShuttingDown) {
    return
  }
  isShuttingDown = true
  debug.logAppShutdown(`Cleanup initiated from: ${source}`)
  if ((global as any).memoryManagementInterval) {
    clearInterval((global as any).memoryManagementInterval)
    ;(global as any).memoryManagementInterval = null
  }
  if ((global as any).saveWindowStateTimeout) {
    clearTimeout((global as any).saveWindowStateTimeout)
    ;(global as any).saveWindowStateTimeout = null
  }
  try {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
  } catch (error: any) {
    debug.error(`Error closing splash window: ${error.message}`)
  }
  try {
    if (oscService) {
      debug.info('Stopping OSC service during cleanup...')
      oscService.stop()
      oscService = null
      ;(global as any).oscService = null
      debug.info('OSC service cleanup completed')
    }
  } catch (error: any) {
    debug.error(`Error stopping OSC service: ${error.message}`)
  }
  try {
    if (oscQueryService) {
      debug.info('Stopping OSC Query service during cleanup...')
      oscQueryService.stop()
      oscQueryService = null
      debug.info('OSC Query service cleanup completed')
    }
  } catch (error: any) {
    debug.error(`Error stopping OSC Query service: ${error.message}`)
  }
  try {
    if (oscServer) {
      oscServer.close()
      oscServer = null
    }
  } catch (error: any) {
    debug.error(`Error closing OSC server: ${error.message}`)
  }
  try {
    if (oscClient) {
      oscClient.close()
      oscClient = null
    }
  } catch (error: any) {
    debug.error(`Error closing OSC client: ${error.message}`)
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    try {
      mainWindow.webContents.removeAllListeners()
    } catch (error: any) {
      debug.error(`Error removing renderer listeners: ${error.message}`)
    }
  }
  try {
    if (wsManager) {
      wsManager.disconnect()
      wsManager = null
    }
  } catch (error: any) {
    debug.error(`Error disconnecting WebSocket: ${error.message}`)
  }
  try {
    if (hyperateAddon) {
      debug.info('Stopping HypeRate addon during cleanup...')
      hyperateAddon.stop()
      hyperateAddon = null
      debug.info('HypeRate addon cleanup completed')
    }
  } catch (error: any) {
    debug.error(`Error stopping HypeRate addon: ${error.message}`)
    debug.error(`HypeRate cleanup stack trace: ${error.stack}`)
    hyperateAddon = null
  }
  try {
    if (whisperAddon) {
      debug.info('Stopping Whisper addon during cleanup...')
      whisperAddon.stop()
      whisperAddon = null
      debug.info('Whisper addon cleanup completed')
    }
  } catch (error: any) {
    debug.error(`Error stopping Whisper addon: ${error.message}`)
    whisperAddon = null
  }
  try {
    if (xsOverlayAddon) {
      debug.info('Stopping XS Overlay addon during cleanup...')
      xsOverlayAddon.destroy()
      xsOverlayAddon = null
      debug.info('XS Overlay addon cleanup completed')
    }
  } catch (error: any) {
    debug.error(`Error stopping XS Overlay addon: ${error.message}`)
    xsOverlayAddon = null
  }
  try {
    if (vrchatApiContainer) {
      vrchatApiContainer.stop()
      vrchatApiContainer = null
    }
  } catch (error: any) {
    debug.error(`Error stopping VRChat API container: ${error.message}`)
  }
  try {
    if (oscGoesBrrrAddon) {
      debug.info('Stopping OscGoesBrrr addon during cleanup...')
      oscGoesBrrrAddon.stop()
      oscGoesBrrrAddon = null
      debug.info('OscGoesBrrr addon cleanup completed')
    }
  } catch (error: any) {
    debug.error(`Error stopping OscGoesBrrr addon: ${error.message}`)
    oscGoesBrrrAddon = null
  }
  try {
    if (oscLeashAddon) {
      debug.info('Stopping OSCLeash addon during cleanup...')
      oscLeashAddon.stop()
      oscLeashAddon = null
      debug.info('OSCLeash addon cleanup completed')
    }
  } catch (error: any) {
    debug.error(`Error stopping OSCLeash addon: ${error.message}`)
    oscLeashAddon = null
  }
  try {
    if (calendarContainer) {
      calendarContainer.close()
      calendarContainer = null
    }
  } catch (error: any) {
    debug.error(`Error stopping Calendar container: ${error.message}`)
    calendarContainer = null
  }
  try {
    if (openShockContainer) {
      openShockContainer.close()
      openShockContainer = null
    }
  } catch (error: any) {
    debug.error(`Error stopping OpenShock container: ${error.message}`)
    openShockContainer = null
  }
  try {
    if (arcLinkContainer) {
      arcLinkContainer.close()
      arcLinkContainer = null
    }
  } catch (error: any) {
    debug.error(`Error stopping ARCLink container: ${error.message}`)
    arcLinkContainer = null
  }
  if ((global as any).oscIpcBatchInterval) {
    clearInterval((global as any).oscIpcBatchInterval)
    ;(global as any).oscIpcBatchInterval = null
  }
  try {
    closeDb()
  } catch (error: any) {
    debug.error(`Error closing database: ${error.message}`)
  }
  if ((global as any).gc) {
    ;(global as any).gc()
  }
}
app.on('window-all-closed', () => {
  cleanup('window-all-closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
app.on('before-quit', () => {
  cleanup('before-quit')
})
process.on('uncaughtException', (error) => {
  if (hasShownCriticalError) {
    process.exit(1)
    return
  }
  hasShownCriticalError = true
  try {
    debug.logUncaughtException(error, 'main')
    debug.logCriticalShutdown('Uncaught exception', 'process.uncaughtException')
  } catch (_debugError) {
    console.error('Failed to log error via debug:', _debugError)
    console.error('Original error:', error)
  }
  try {
    cleanup('uncaught-exception')
  } catch (cleanupError: any) {
    try {
      debug.error(`Error during cleanup: ${cleanupError.message}`)
    } catch {
      console.error('Cleanup error:', cleanupError)
    }
  }
  const errorMessage = debug.formatCrashDialogMessage(
    'Uncaught Exception',
    error.message || String(error)
  )
  const shouldRestart = showCrashDialog('Critical Error', errorMessage)
  if (shouldRestart) {
    relaunchApp()
  } else {
    process.exit(1)
  }
})
process.on('unhandledRejection', (reason: any, _promise) => {
  if (hasShownCriticalError) {
    process.exit(1)
    return
  }
  hasShownCriticalError = true
  try {
    debug.logUnhandledRejection(reason, _promise, 'main')
    debug.logCriticalShutdown('Unhandled promise rejection', 'process.unhandledRejection')
  } catch (_debugError) {
    console.error('Failed to log rejection via debug:', _debugError)
    console.error('Original rejection:', reason)
  }
  try {
    cleanup('unhandled-rejection')
  } catch (cleanupError: any) {
    try {
      debug.error(`Error during cleanup: ${cleanupError.message}`)
    } catch {
      console.error('Cleanup error:', cleanupError)
    }
  }
  const reasonMessage = reason && reason.message ? reason.message : String(reason)
  const errorMessage = debug.formatCrashDialogMessage(
    'Unhandled Promise Rejection',
    reasonMessage
  )
  const shouldRestart = showCrashDialog('Critical Error', errorMessage)
  if (shouldRestart) {
    relaunchApp()
  } else {
    process.exit(1)
  }
})
