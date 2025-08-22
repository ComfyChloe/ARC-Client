const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings) => ipcRenderer.invoke('set-app-settings', settings),
  enableOsc: () => ipcRenderer.invoke('enable-osc'),
  disableOsc: () => ipcRenderer.invoke('disable-osc'),
  getOscStatus: () => ipcRenderer.invoke('get-osc-status'),
  setOscForwarding: (enabled) => ipcRenderer.invoke('set-osc-forwarding', enabled),
  connectServer: (credentials) => ipcRenderer.invoke('websocket-connect', credentials),
  disconnectServer: () => ipcRenderer.invoke('websocket-disconnect'),
  authenticate: (credentials) => ipcRenderer.invoke('websocket-connect', credentials),
  sendOsc: (data) => ipcRenderer.invoke('websocket-send-osc', data),
  testWebSocketSend: () => ipcRenderer.invoke('websocket-test-send'),
  sendWebSocketMessage: (event, data) => ipcRenderer.invoke('websocket-send-message', event, data),
  getWebSocketStatus: () => ipcRenderer.invoke('websocket-get-status'),
  getWebSocketForwardingStatus: () => ipcRenderer.invoke('websocket-get-forwarding-status'),
  setWebSocketForwarding: (enabled) => ipcRenderer.invoke('websocket-set-forwarding', enabled),
  onOscReceived: (callback) => {
    ipcRenderer.on('osc-received', (event, data) => callback(data));
  },
  onOscServerStatus: (callback) => {
    ipcRenderer.on('osc-server-status', (event, data) => callback(data));
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
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
