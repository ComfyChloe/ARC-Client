// Minimal, sandbox-safe preload for the splash window. The splash renderer
// only needs to receive progress + version events and request the current
// version once on load \u2014 nothing else. Exposing this tiny surface lets us
// keep `nodeIntegration: false` + `contextIsolation: true` on the splash
// BrowserWindow instead of granting it raw Node access.
import { contextBridge, ipcRenderer } from 'electron'
const splashAPI = {
  onProgress(cb: (data: { progress: number; message: string }) => void): void {
    ipcRenderer.on('splash-progress', (_e, data) => cb(data))
  },
  onVersion(cb: (version: string) => void): void {
    ipcRenderer.on('splash-version', (_e, version) => cb(version))
  },
  getVersion(): Promise<string> {
    return ipcRenderer.invoke('get-client-version')
  }
}
contextBridge.exposeInMainWorld('splashAPI', splashAPI)
