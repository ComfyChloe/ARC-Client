export function useElectronAPI() {
  const api = window.electronAPI
  if (!api) {
    throw new Error('electronAPI not available — not running in Electron context')
  }
  return api
}
