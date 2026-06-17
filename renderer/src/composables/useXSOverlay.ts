import { ref, onMounted, onUnmounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'
export interface XSOverlayNotificationLogEntry {
  id: number
  title: string
  content: string
  timestamp?: number
  recordedAt?: string
  type: 'panel-connection' | 'panel-disconnection' | 'avatar-change' | 'info' | 'error'
}
export interface XSOverlayAddonStatus {
  enabled: boolean
  connected: boolean
  xsOverlayRunning: boolean
  config: {
    enabled: boolean
    autoStart: boolean
    port: number
    notifications: {
      panelConnections: boolean
      avatarChanges: boolean
    }
    notificationTimeout: number
    notificationHeight: number
    notificationOpacity: number
    notificationVolume: number
    notificationAudioPath: string
  } | null
  notificationLog: XSOverlayNotificationLogEntry[]
}
const defaultStatus: XSOverlayAddonStatus = {
  enabled: false,
  connected: false,
  xsOverlayRunning: false,
  config: null,
  notificationLog: []
}
export function useXSOverlay() {
  const api = useElectronAPI()
  const status = ref<XSOverlayAddonStatus>({ ...defaultStatus })
  const autostart = ref(false)
  const dbLogs = ref<XSOverlayNotificationLogEntry[]>([])
  let pollTimer: ReturnType<typeof setInterval> | null = null
  async function refreshStatus() {
    const s = await api.xsOverlayGetStatus()
    status.value = { ...defaultStatus, ...s }
  }
  async function refreshDbLogs() {
    try {
      const rows = await api.xsOverlayGetNotificationLogs(50) || []
      // DB rows have recorded_at (SQL datetime string) — pass through directly
      dbLogs.value = rows.map((row: any) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        type: row.type,
        recordedAt: row.recorded_at
      }))
    } catch (e: unknown) { console.error('Failed to load XS Overlay logs from DB:', e) }
  }
  async function refreshAutostart() {
    const result = await api.xsOverlayGetAutostart()
    if (result && typeof result === 'object' && 'enabled' in result) {
      autostart.value = Boolean(result.enabled)
    } else if (typeof result === 'boolean') {
      autostart.value = result
    }
  }
  async function toggle() {
    if (status.value.enabled) {
      await api.xsOverlayStop()
    } else {
      await api.xsOverlayStart()
    }
    await refreshStatus()
  }
  async function toggleAutostart() {
    await api.xsOverlaySetAutostart(!autostart.value)
    await refreshAutostart()
  }
  async function updateConfig(newConfig: Partial<XSOverlayAddonStatus['config']>) {
    await api.xsOverlayUpdateConfig(newConfig)
    await refreshStatus()
  }
  function startPolling() {
    stopPolling()
    pollTimer = setInterval(refreshStatus, 3000)
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
  onMounted(() => {
    refreshStatus()
    refreshAutostart()
    refreshDbLogs()
    startPolling()
    api.onXsOverlayStatus((data: any) => {
      status.value = { ...defaultStatus, ...data }
    })
    api.onXsOverlayNotification((entry: XSOverlayNotificationLogEntry) => {
      const existing = status.value.notificationLog
      status.value = {
        ...status.value,
        notificationLog: [entry, ...existing].slice(0, 50)
      }
      refreshDbLogs()
    })
  })
  onUnmounted(() => {
    stopPolling()
    api.removeAllListeners('xsoverlay-status')
    api.removeAllListeners('xsoverlay-notification')
  })
  return {
    status,
    autostart,
    dbLogs,
    toggle,
    toggleAutostart,
    refreshStatus,
    updateConfig
  }
}
