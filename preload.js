const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings) => ipcRenderer.invoke('set-app-settings', settings),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  setWindowState: (windowState) => ipcRenderer.invoke('set-window-state', windowState),
  enableOsc: () => ipcRenderer.invoke('enable-osc'),
  disableOsc: () => ipcRenderer.invoke('disable-osc'),
  getOscStatus: () => ipcRenderer.invoke('get-osc-status'),
  setOscForwarding: (enabled) => ipcRenderer.invoke('set-osc-forwarding', enabled),
  // WebSocket API
  connectServer: (credentials) => ipcRenderer.invoke('websocket-connect', credentials),
  disconnectServer: () => ipcRenderer.invoke('websocket-disconnect'),
  authenticate: (credentials) => ipcRenderer.invoke('websocket-connect', credentials),
  sendOsc: (data) => ipcRenderer.invoke('websocket-send-osc', data),
  sendOscLocal: (data) => ipcRenderer.invoke('osc-send-local', data),
  testWebSocketSend: () => ipcRenderer.invoke('websocket-test-send'),
  sendWebSocketMessage: (event, data) => ipcRenderer.invoke('websocket-send-message', event, data),
  getWebSocketStatus: () => ipcRenderer.invoke('websocket-get-status'),
  getWebSocketForwardingStatus: () => ipcRenderer.invoke('websocket-get-forwarding-status'),
  setWebSocketForwarding: (enabled) => ipcRenderer.invoke('websocket-set-forwarding', enabled),
  // Username storage API
  getLastUsername: () => ipcRenderer.invoke('get-last-username'),
  setLastUsername: (username) => ipcRenderer.invoke('set-last-username', username),
  // Password storage API
  getSavedPassword: () => ipcRenderer.invoke('get-saved-password'),
  setSavedPassword: (password) => ipcRenderer.invoke('set-saved-password', password),
  // OSC Query unsubscription API
  getOscQueryUnsubscriptions: () => ipcRenderer.invoke('get-oscquery-unsubscriptions'),
  setOscQueryUnsubscriptions: (unsubscriptions) => ipcRenderer.invoke('set-oscquery-unsubscriptions', unsubscriptions),
  addOscQueryUnsubscription: (path) => ipcRenderer.invoke('add-oscquery-unsubscription', path),
  removeOscQueryUnsubscription: (path) => ipcRenderer.invoke('remove-oscquery-unsubscription', path),
  // Server-managed blocklist/suppression query API
  getServerBlocklist: () => ipcRenderer.invoke('get-server-blocklist'),
  getServerSuppressions: () => ipcRenderer.invoke('get-server-suppressions'),
  getHardcodedUnsubscriptions: () => ipcRenderer.invoke('get-hardcoded-unsubscriptions'),
  // OSC Query status and control
  getOscQueryStatus: () => ipcRenderer.invoke('get-oscquery-status'),
  oscQueryForceReconnect: () => ipcRenderer.invoke('oscquery-force-reconnect'),
  oscQueryResetAll: () => ipcRenderer.invoke('oscquery-reset-all'),
  // HypeRate API
  hyperateGetStatus: () => ipcRenderer.invoke('hyperate-get-status'),
  hyperateStart: () => ipcRenderer.invoke('hyperate-start'),
  hyperateStop: () => ipcRenderer.invoke('hyperate-stop'),
  hyperateAddTracker: (deviceId, deviceName) => ipcRenderer.invoke('hyperate-add-tracker', deviceId, deviceName),
  hyperateRemoveTracker: (deviceId) => ipcRenderer.invoke('hyperate-remove-tracker', deviceId),
  hyperateGetTrackers: () => ipcRenderer.invoke('hyperate-get-trackers'),
  hyperateSetPrimary: (deviceId) => ipcRenderer.invoke('hyperate-set-primary', deviceId),
  hyperateUpdateTrackerName: (deviceId, newName) => ipcRenderer.invoke('hyperate-update-tracker-name', deviceId, newName),
  hyperateUpdateTrackerState: (deviceId, enabled) => ipcRenderer.invoke('hyperate-update-tracker-state', deviceId, enabled),
  hyperateGetAutostart: () => ipcRenderer.invoke('hyperate-get-autostart'),
  hyperateSetAutostart: (enabled) => ipcRenderer.invoke('hyperate-set-autostart', enabled),
  // OSCLeash API
  oscleashGetStatus: () => ipcRenderer.invoke('oscleash-get-status'),
  oscleashStart: () => ipcRenderer.invoke('oscleash-start'),
  oscleashStop: () => ipcRenderer.invoke('oscleash-stop'),
  oscleashGetConfig: () => ipcRenderer.invoke('oscleash-get-config'),
  oscleashUpdateConfig: (config) => ipcRenderer.invoke('oscleash-update-config', config),
  oscleashGetAutostart: () => ipcRenderer.invoke('oscleash-get-autostart'),
  oscleashSetAutostart: (enabled) => ipcRenderer.invoke('oscleash-set-autostart', enabled),
  // OscGoesBrrr API
  ogbGetStatus: () => ipcRenderer.invoke('ogb-get-status'),
  ogbStart: () => ipcRenderer.invoke('ogb-start'),
  ogbStop: () => ipcRenderer.invoke('ogb-stop'),
  ogbGetDevices: () => ipcRenderer.invoke('ogb-get-devices'),
  ogbGetConfig: () => ipcRenderer.invoke('ogb-get-config'),
  ogbUpdateConfig: (config) => ipcRenderer.invoke('ogb-update-config', config),
  ogbUpdateDeviceBinding: (deviceId, binding) => ipcRenderer.invoke('ogb-update-device-binding', deviceId, binding),
  ogbUpdateIntifaceConfig: (config) => ipcRenderer.invoke('ogb-update-intiface-config', config),
  ogbGetAutostart: () => ipcRenderer.invoke('ogb-get-autostart'),
  ogbSetAutostart: (enabled) => ipcRenderer.invoke('ogb-set-autostart', enabled),
  // Encryption API
  encryptData: (plaintext) => ipcRenderer.invoke('encrypt-data', plaintext),
  decryptData: (encryptedData) => ipcRenderer.invoke('decrypt-data', encryptedData),
  // VRChat API
  vrchatApiGetStatus: () => ipcRenderer.invoke('vrchatapi-get-status'),
  vrchatApiLogin: (credentials) => ipcRenderer.invoke('vrchatapi-login', credentials),
  vrchatApiVerify2FA: (data) => ipcRenderer.invoke('vrchatapi-verify-2fa', data),
  vrchatApiLogout: () => ipcRenderer.invoke('vrchatapi-logout'),
  vrchatApiRestoreSession: () => ipcRenderer.invoke('vrchatapi-restore-session'),
  vrchatApiGetStats: () => ipcRenderer.invoke('vrchatapi-get-stats'),
  // VRChat account linking
  sendVRChatLink: (vrchatUserId, vrchatUsername) => ipcRenderer.invoke('send-vrchat-link', vrchatUserId, vrchatUsername),
  checkVRChatLink: () => ipcRenderer.invoke('check-vrchat-link'),
  // Feedback API
  sendFeedback: (feedbackData) => ipcRenderer.invoke('send-feedback', feedbackData),
  getFeedbackList: () => ipcRenderer.invoke('get-feedback-list'),
  voteFeedback: (feedbackId) => ipcRenderer.invoke('vote-feedback', feedbackId),
  getUserFeedbackStats: () => ipcRenderer.invoke('get-user-feedback-stats'),
  getClientVersion: () => ipcRenderer.invoke('get-client-version'),
  // Error logging
  logRendererError: (error, context) => ipcRenderer.invoke('log-renderer-error', error, context),
  logRendererConsoleError: (args, context) => ipcRenderer.invoke('log-renderer-console-error', args, context),
  // Event listeners
  onOscReceived: (callback) => {
    ipcRenderer.on('osc-received', (event, data) => callback(data));
  },
  onOscForwarded: (callback) => {
    ipcRenderer.on('osc-forwarded', (event, data) => callback(data));
  },
  onOscReceivedBatch: (callback) => {
    ipcRenderer.on('osc-received-batch', (event, data) => callback(data));
  },
  onOscForwardedBatch: (callback) => {
    ipcRenderer.on('osc-forwarded-batch', (event, data) => callback(data));
  },
  onMemoryPressure: (callback) => {
    ipcRenderer.on('memory-pressure', (event, data) => callback(data));
  },
  onOscServerStatus: (callback) => {
    ipcRenderer.on('osc-server-status', (event, data) => callback(data));
  },
  onOscQueryStatus: (callback) => {
    ipcRenderer.on('oscquery-status', (event, data) => callback(data));
  },
  onParameterBlocklistUpdated: (callback) => {
    ipcRenderer.on('parameter-blocklist-updated', (event, data) => callback(data));
  },
  onParametersSuppressed: (callback) => {
    ipcRenderer.on('parameters-suppressed', (event, data) => callback(data));
  },
  onParametersUnsuppressed: (callback) => {
    ipcRenderer.on('parameters-unsuppressed', (event, data) => callback(data));
  },
  onVRChatConnectionStatus: (callback) => {
    ipcRenderer.on('vrchat-connection-status', (event, data) => callback(data));
  },
  onOscFlowStatus: (callback) => {
    ipcRenderer.on('osc-flow-status', (event, data) => callback(data));
  },
  onWebSocketStatus: (callback) => {
    ipcRenderer.on('websocket-status', (event, data) => callback(data));
  },
  onWebSocketError: (callback) => {
    ipcRenderer.on('websocket-error', (event, data) => callback(data));
  },
  onWebSocketAuthenticated: (callback) => {
    ipcRenderer.on('websocket-authenticated', (event, data) => callback(data));
  },
  onWebSocketOscData: (callback) => {
    ipcRenderer.on('websocket-osc-data', (event, data) => callback(data));
  },
  onWebSocketAvatarChange: (callback) => {
    ipcRenderer.on('websocket-avatar-change', (event, data) => callback(data));
  },
  onWebSocketParameterUpdate: (callback) => {
    ipcRenderer.on('websocket-parameter-update', (event, data) => callback(data));
  },
  onWebSocketServerMessage: (callback) => {
    ipcRenderer.on('websocket-server-message', (event, data) => callback(data));
  },
  onWebSocketPanelConnectionsUpdate: (callback) => {
    ipcRenderer.on('websocket-panel-connections-update', (event, data) => callback(data));
  },
  onAppSettings: (callback) => {
    ipcRenderer.on('app-settings', (event, data) => callback(data));
  },
  onOSCLeashMovement: (callback) => {
    ipcRenderer.on('oscleash-movement-data', (event, data) => callback(data));
  },
  onOSCLeashStatusUpdate: (callback) => {
    ipcRenderer.on('oscleash-status-update', (event, data) => callback(data));
  },
  onHyperateUpdate: (callback) => {
    ipcRenderer.on('hyperate-update', (event, data) => callback(data));
  },
  onOgbStatusUpdate: (callback) => {
    ipcRenderer.on('ogb-status-update', (event, data) => callback(data));
  },
  onFeedbackUpdate: (callback) => {
    ipcRenderer.on('feedback-update', (event, data) => callback(data));
  },
  onVRChatPipelineEvent: (callback) => {
    ipcRenderer.on('vrchatapi-pipeline-event', (event, data) => callback(data));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  // Shell and clipboard API for VRC Timeline
  openExternal: (url) => ipcRenderer.invoke('shell-open-external', url),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard-write-text', text)
});
