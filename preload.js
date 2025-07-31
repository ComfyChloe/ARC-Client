const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  connectServer: () => ipcRenderer.invoke('connect-server'),
  disconnectServer: () => ipcRenderer.invoke('disconnect-server'),
  authenticate: (credentials) => ipcRenderer.invoke('authenticate', credentials),
  sendOsc: (oscData) => ipcRenderer.invoke('send-osc', oscData),
  startOscQuery: () => ipcRenderer.invoke('start-oscquery'),
  stopOscQuery: () => ipcRenderer.invoke('stop-oscquery'),
  getUserAvatar: () => ipcRenderer.invoke('get-user-avatar'),
  setUserAvatar: (avatarData) => ipcRenderer.invoke('set-user-avatar', avatarData),
  getParameters: () => ipcRenderer.invoke('get-parameters'),
  
  // Event listeners
  onServerConnection: (callback) => {
    ipcRenderer.on('server-connection', (event, data) => callback(data));
  },
  onAuthRequired: (callback) => {
    ipcRenderer.on('auth-required', () => callback());
  },
  onAuthSuccess: (callback) => {
    ipcRenderer.on('auth-success', (event, data) => callback(data));
  },
  onAuthFailed: (callback) => {
    ipcRenderer.on('auth-failed', (event, data) => callback(data));
  },
  onParameterUpdate: (callback) => {
    ipcRenderer.on('parameter-update', (event, data) => callback(data));
  },
  onUserAvatarInfo: (callback) => {
    ipcRenderer.on('user-avatar-info', (event, data) => callback(data));
  },
  onOscReceived: (callback) => {
    ipcRenderer.on('osc-received', (event, data) => callback(data));
  },
  onOscServerStatus: (callback) => {
    ipcRenderer.on('osc-server-status', (event, data) => callback(data));
  },
  onServerError: (callback) => {
    ipcRenderer.on('server-error', (event, error) => callback(error));
  },
  onOscQueryStatus: (callback) => {
    ipcRenderer.on('oscquery-status', (event, data) => callback(data));
  },
  onOscQueryRequest: (callback) => {
    ipcRenderer.on('oscquery-request', (event, data) => callback(data));
  },
  
  // Cleanup
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
