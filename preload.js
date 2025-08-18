const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  enableOsc: () => ipcRenderer.invoke('enable-osc'),
  disableOsc: () => ipcRenderer.invoke('disable-osc'),
  getOscStatus: () => ipcRenderer.invoke('get-osc-status'),
  setOscForwarding: (enabled) => ipcRenderer.invoke('set-osc-forwarding', enabled),
  // Event listeners
  onOscReceived: (callback) => {
    ipcRenderer.on('osc-received', (event, data) => callback(data));
  },
  onOscServerStatus: (callback) => {
    ipcRenderer.on('osc-server-status', (event, data) => callback(data));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
