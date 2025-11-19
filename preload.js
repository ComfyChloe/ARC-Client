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
  // VRChat API
  vrchatApiGetStatus: () => ipcRenderer.invoke('vrchatapi-get-status'),
  vrchatApiLogin: (credentials) => ipcRenderer.invoke('vrchatapi-login', credentials),
  vrchatApiVerify2FA: (data) => ipcRenderer.invoke('vrchatapi-verify-2fa', data),
  vrchatApiLogout: () => ipcRenderer.invoke('vrchatapi-logout'),
  vrchatApiRestoreSession: () => ipcRenderer.invoke('vrchatapi-restore-session'),
  vrchatApiGetStats: () => ipcRenderer.invoke('vrchatapi-get-stats'),
  // Event listeners
  onOscReceived: (callback) => {
    ipcRenderer.on('osc-received', (event, data) => callback(data));
  },
  onOscForwarded: (callback) => {
    ipcRenderer.on('osc-forwarded', (event, data) => callback(data));
  },
  onOscServerStatus: (callback) => {
    ipcRenderer.on('osc-server-status', (event, data) => callback(data));
  },
  onOscQueryStatus: (callback) => {
    ipcRenderer.on('oscquery-status', (event, data) => callback(data));
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
  onAppSettings: (callback) => {
    ipcRenderer.on('app-settings', (event, data) => callback(data));
  },
  onOSCLeashMovement: (callback) => {
    ipcRenderer.on('oscleash-movement-data', (event, data) => callback(data));
  },
  onHyperateUpdate: (callback) => {
    ipcRenderer.on('hyperate-update', (event, data) => callback(data));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
