import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export interface OpenShockShocker {
  id: string
  name: string
  rfid: string
  createdOn: string
  model: string
  isPaused: boolean
}

export interface OpenShockDevice {
  id: string
  name: string
  createdOn: string
  shockers: OpenShockShocker[]
}

export interface OpenShockStatus {
  enabled: boolean
  connected: boolean
  hasApiToken: boolean
  deviceCount: number
  baseUrl: string
  loggedIn: boolean
  loggedInUsername: string | null
}

const defaultStatus: OpenShockStatus = {
  enabled: false,
  connected: false,
  hasApiToken: false,
  deviceCount: 0,
  baseUrl: 'https://api.openshock.app',
  loggedIn: false,
  loggedInUsername: null
}

export function useOpenShock() {
  const api = useElectronAPI()
  const status = ref<OpenShockStatus>({ ...defaultStatus })
  const devices = ref<OpenShockDevice[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const activeTab = ref<'control' | 'linksharing' | 'logs'>('control')

  const allShockers = computed(() => {
    const shockers: Array<{ shocker: OpenShockShocker; device: OpenShockDevice }> = []
    for (const device of devices.value) {
      for (const shocker of device.shockers) {
        shockers.push({ shocker, device })
      }
    }
    return shockers
  })

  async function refreshStatus() {
    const s = await api.openShockGetStatus()
    status.value = { ...defaultStatus, ...s }
  }

  async function refreshShockers() {
    try {
      const list = await api.openShockListShockers()
      devices.value = list ?? []
    } catch (e: unknown) {
      error.value = (e as Error).message
    }
  }

  async function connect(apiToken: string) {
    loading.value = true
    error.value = null
    try {
      const result = await api.openShockStart(apiToken)
      if (!result?.success) {
        error.value = result?.error || 'Failed to connect'
      }
      await refreshStatus()
      await refreshShockers()
    } catch (e: unknown) {
      error.value = (e as Error).message
    }
    loading.value = false
  }

  async function disconnect() {
    await api.openShockStop()
    devices.value = []
    await refreshStatus()
  }

  async function clearSavedToken() {
    await api.openShockClearSavedToken()
    await refreshStatus()
  }

  async function sendControl(shocks: Array<{ id: string; type: string; intensity?: number; duration?: number }>) {
    error.value = null
    try {
      await api.openShockSendControl(shocks)
    } catch (e: unknown) {
      error.value = (e as Error).message
    }
  }

  async function quickCommand(shockerId: string, type: 'Shock' | 'Vibrate' | 'Sound' | 'Stop', intensity = 10, duration = 500) {
    await sendControl([{ id: shockerId, type, intensity, duration }])
  }

  async function createShareLink(shockerId: string, permissions: { shock: boolean; vibrate: boolean; sound: boolean; live: boolean }, limits: { intensity: number; duration: number }): Promise<{ success: boolean; url?: string; shareCode?: string; error?: string; sessionExpired?: boolean } | null> {
    error.value = null
    try {
      return await api.openShockCreateShareLink(shockerId, permissions, limits)
    } catch (e: unknown) {
      error.value = (e as Error).message
      return null
    }
  }

  async function login(email: string, password: string): Promise<{ success: boolean; username?: string; error?: string }> {
    loading.value = true
    error.value = null
    try {
      const result = await api.openShockLogin(email, password)
      await refreshStatus()
      loading.value = false
      return result
    } catch (e: unknown) {
      loading.value = false
      error.value = (e as Error).message
      return { success: false, error: (e as Error).message }
    }
  }

  async function logout() {
    await api.openShockLogout()
    await refreshStatus()
  }

  async function clearSavedCredentials() {
    await api.openShockClearSavedCredentials()
    await refreshStatus()
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null

  function startPolling() {
    pollTimer = setInterval(async () => {
      await refreshStatus()
    }, 10000)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onMounted(async () => {
    await refreshStatus()
    if (status.value.hasApiToken) {
      await refreshShockers()
    }
    startPolling()
  })

  onUnmounted(() => {
    stopPolling()
  })

  return {
    status,
    devices,
    allShockers,
    loading,
    error,
    activeTab,
    refreshStatus,
    refreshShockers,
    connect,
    disconnect,
    clearSavedToken,
    sendControl,
    quickCommand,
    createShareLink,
    login,
    logout,
    clearSavedCredentials
  }
}
