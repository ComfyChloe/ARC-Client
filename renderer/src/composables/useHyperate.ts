import { ref, onMounted, onUnmounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export interface HyperateTracker {
  deviceId: string
  name: string | null
  isPrimary: boolean
  isActive: boolean
  lastHeartRate: number
  lastUpdate: number | null
  joinedAt: number | null
}

export interface HyperateStatus {
  enabled: boolean
  connected: boolean
  stopping: boolean
  hasApiKey: boolean
  lastError: string | null
  reconnecting: boolean
  reconnectAttempts: number
  maxReconnectAttempts: number
  lastHeartRate?: number
}

const defaultStatus: HyperateStatus = {
  enabled: false,
  connected: false,
  stopping: false,
  hasApiKey: false,
  lastError: null,
  reconnecting: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 0
}

function normalizeAutostartResult(result: unknown): boolean {
  if (typeof result === 'boolean') {
    return result
  }
  if (result && typeof result === 'object' && 'enabled' in result) {
    return Boolean((result as { enabled?: unknown }).enabled)
  }
  return false
}

export function useHyperate() {
  const api = useElectronAPI()
  const status = ref<HyperateStatus>({ ...defaultStatus })
  const trackers = ref<HyperateTracker[]>([])
  const autostart = ref(false)
  const heartRate = ref(0)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function refreshStatus() {
    const s = await api.hyperateGetStatus()
    status.value = { ...defaultStatus, ...s }
    heartRate.value = status.value.lastHeartRate ?? 0
  }
  async function refreshTrackers() {
    const list = await api.hyperateGetTrackers()
    trackers.value = list ?? []
  }
  async function refreshAutostart() {
    const result = await api.hyperateGetAutostart()
    autostart.value = normalizeAutostartResult(result)
  }
  async function toggle() {
    if (status.value.enabled) {
      status.value = { ...status.value, stopping: true }
      const result = await api.hyperateStop()
      if (!result?.success) {
        status.value = { ...status.value, stopping: false }
      }
    } else {
      status.value = { ...status.value, enabled: true, connected: false, stopping: false }
      const result = await api.hyperateStart()
      if (!result?.success) {
        status.value = { ...status.value, enabled: false, connected: false, stopping: false }
      }
    }
    await refreshStatus()
  }
  async function toggleAutostart() {
    await api.hyperateSetAutostart(!autostart.value)
    await refreshAutostart()
  }
  async function addTracker(deviceId: string, name?: string) {
    await api.hyperateAddTracker(deviceId, name ?? null)
    await refreshTrackers()
  }
  async function removeTracker(deviceId: string) {
    await api.hyperateRemoveTracker(deviceId)
    await refreshTrackers()
  }
  async function setPrimary(deviceId: string) {
    await api.hyperateSetPrimary(deviceId)
    await refreshTrackers()
  }
  async function updateTrackerName(deviceId: string, newName: string) {
    await api.hyperateUpdateTrackerName(deviceId, newName)
    await refreshTrackers()
  }
  async function updateTrackerState(deviceId: string, enabled: boolean) {
    await api.hyperateUpdateTrackerState(deviceId, enabled)
    await refreshTrackers()
  }

  function startPolling() {
    pollTimer = setInterval(async () => {
      await refreshStatus()
      await refreshTrackers()
    }, 2000)
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onMounted(() => {
    refreshStatus()
    refreshTrackers()
    refreshAutostart()
    startPolling()
    api.onHyperateUpdate((data: any) => {
      if (data.type === 'status') {
        status.value = { ...defaultStatus, ...data }
        heartRate.value = data.lastHeartRate ?? heartRate.value
        void refreshTrackers()
      } else if (data.heartRate !== undefined) {
        heartRate.value = data.heartRate
      }
    })
  })
  onUnmounted(() => {
    stopPolling()
    api.removeAllListeners('hyperate-update')
  })

  return {
    status,
    trackers,
    autostart,
    heartRate,
    toggle,
    toggleAutostart,
    addTracker,
    removeTracker,
    setPrimary,
    updateTrackerName,
    updateTrackerState,
    refreshStatus,
    refreshTrackers
  }
}
