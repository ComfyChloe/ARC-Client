const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Configuration
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  
  // Server connection
  connectServer: () => ipcRenderer.invoke('connect-server'),
  disconnectServer: () => ipcRenderer.invoke('disconnect-server'),
  authenticate: (credentials) => ipcRenderer.invoke('authenticate', credentials),
  
  // OSC
  sendOsc: (oscData) => ipcRenderer.invoke('send-osc', oscData),
  
  // Avatar management
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
  
  // Cleanup
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
