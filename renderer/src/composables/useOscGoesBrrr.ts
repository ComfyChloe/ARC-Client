import { ref, onMounted, onUnmounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export interface OgbFeature {
  type: string
  lastLevel: number
}

export interface OgbDevice {
  id: string
  name: string
  batteryLevel: number | null
  features: OgbFeature[]
}

export interface OgbDeviceBinding {
  type: string
  sources: string[]
  multiplier: number
  idle: number
  linear: boolean
}

export interface OgbStatus {
  enabled: boolean
  connected: boolean
  connecting: boolean
  deviceCount: number
  devices: OgbDevice[]
  gameDevices: string[]
  serverName: string | null
  serverVersion: string | null
  intifaceAddress: string
  intifacePort: number
  intifaceWss: boolean
  lastError: string | null
  maxLevel: number
}

const defaultStatus: OgbStatus = {
  enabled: false,
  connected: false,
  connecting: false,
  deviceCount: 0,
  devices: [],
  gameDevices: [],
  serverName: null,
  serverVersion: null,
  intifaceAddress: '127.0.0.1',
  intifacePort: 12345,
  intifaceWss: false,
  lastError: null,
  maxLevel: 0
}

const DEFAULT_BINDING: OgbDeviceBinding = {
  type: 'all',
  sources: ['touchOthers', 'penOthers', 'frotOthers'],
  multiplier: 1.0,
  idle: 0,
  linear: true
}

export const ALL_SOURCES = ['touchSelf', 'touchOthers', 'penSelf', 'penOthers', 'frotOthers'] as const

export function useOscGoesBrrr() {
  const api = useElectronAPI()
  const status = ref<OgbStatus>({ ...defaultStatus })
  const autostart = ref(false)
  const selectedDeviceId = ref<string | null>(null)
  const deviceBinding = ref<OgbDeviceBinding>({ ...DEFAULT_BINDING })
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function refreshStatus() {
    const s = await api.ogbGetStatus()
    status.value = { ...defaultStatus, ...s }
  }
  async function refreshAutostart() {
    const result = await api.ogbGetAutostart()
    autostart.value = result.enabled ?? false
  }
  async function toggle() {
    if (status.value.enabled) {
      await api.ogbStop()
    } else {
      status.value = { ...status.value, enabled: true, connected: false, connecting: true }
      const result = await api.ogbStart()
      if (!result.success) {
        status.value = { ...status.value, enabled: false, connecting: false }
      }
    }
    await refreshStatus()
  }
  async function toggleAutostart() {
    await api.ogbSetAutostart(!autostart.value)
    await refreshAutostart()
  }
  async function selectDevice(deviceId: string) {
    selectedDeviceId.value = deviceId
    const config = await api.ogbGetConfig()
    const binding = config.devices?.find((d: any) => d.id === deviceId)
    deviceBinding.value = binding ? { ...DEFAULT_BINDING, ...binding } : { ...DEFAULT_BINDING }
  }
  async function saveDeviceBinding() {
    if (!selectedDeviceId.value) return
    await api.ogbUpdateDeviceBinding(selectedDeviceId.value, { ...deviceBinding.value })
  }
  async function updateIntifaceSettings(address: string, port: number, useWss: boolean) {
    const result = await api.ogbUpdateIntifaceConfig({ address, port, useWss })
    if (result.success) {
      status.value = { ...status.value, intifaceAddress: address, intifacePort: port, intifaceWss: useWss }
    }
    return result
  }

  function startPolling() {
    pollTimer = setInterval(refreshStatus, 1000)
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
    startPolling()
    api.onOgbStatusUpdate((data: any) => {
      status.value = { ...defaultStatus, ...data }
    })
  })
  onUnmounted(() => {
    stopPolling()
    api.removeAllListeners('ogb-status-update')
  })

  return {
    status,
    autostart,
    selectedDeviceId,
    deviceBinding,
    toggle,
    toggleAutostart,
    selectDevice,
    saveDeviceBinding,
    updateIntifaceSettings,
    refreshStatus
  }
}
