import { ref, onMounted, onUnmounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export interface OscLeashStatus {
  enabled: boolean
  leashCount: number
  activeLeashes: any[]
  discoveredLeashes: any[]
}

export interface OscLeashMovement {
  vertical: number
  horizontal: number
  run: boolean
}

export interface PhysboneInputs {
  stretch: number
  grabbed: boolean
  zPos: number
  zNeg: number
  xPos: number
  xNeg: number
  yPos: number
  yNeg: number
}

export interface OscLeashConfig {
  runDeadzone: number
  walkDeadzone: number
  strengthMultiplier: number
  upCompensation: number
  upDeadzone: number
  downCompensation: number
  downDeadzone: number
  activeDelay: number
  inactiveDelay: number
  logging: boolean
  physboneParameter: string
  verticalParameter: string
  horizontalParameter: string
  runParameter: string
  [key: string]: any
}

export function useOscLeash() {
  const api = useElectronAPI()
  const status = ref<OscLeashStatus>({ enabled: false, leashCount: 0, activeLeashes: [], discoveredLeashes: [] })
  const movement = ref<OscLeashMovement>({ vertical: 0, horizontal: 0, run: false })
  const physbone = ref<PhysboneInputs>({ stretch: 0, grabbed: false, zPos: 0, zNeg: 0, xPos: 0, xNeg: 0, yPos: 0, yNeg: 0 })
  const config = ref<OscLeashConfig | null>(null)
  const autostart = ref(false)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function refreshStatus() {
    const s = await api.oscleashGetStatus()
    status.value = { enabled: false, leashCount: 0, activeLeashes: [], discoveredLeashes: [], ...s }
  }
  async function loadConfig() {
    config.value = await api.oscleashGetConfig()
  }
  async function saveConfig(updated: Partial<OscLeashConfig>) {
    await api.oscleashUpdateConfig(updated)
    await loadConfig()
  }
  async function resetConfig() {
    const defaults: Partial<OscLeashConfig> = {
      runDeadzone: 90,
      walkDeadzone: 15,
      strengthMultiplier: 1.0,
      upCompensation: 0,
      upDeadzone: 0,
      downCompensation: 0,
      downDeadzone: 0,
      activeDelay: 100,
      inactiveDelay: 250,
      logging: false
    }
    await saveConfig(defaults)
  }
  async function refreshAutostart() {
    autostart.value = await api.oscleashGetAutostart()
  }
  async function toggle() {
    if (status.value.enabled) {
      await api.oscleashStop()
    } else {
      await api.oscleashStart()
    }
    await refreshStatus()
  }
  async function toggleAutostart() {
    await api.oscleashSetAutostart(!autostart.value)
    await refreshAutostart()
  }

  function startPolling() {
    pollTimer = setInterval(refreshStatus, 400)
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onMounted(() => {
    refreshStatus()
    loadConfig()
    refreshAutostart()
    startPolling()
    api.onOSCLeashMovement((data: any) => {
      movement.value = { vertical: data.vertical ?? 0, horizontal: data.horizontal ?? 0, run: data.run ?? false }
      if (data.physbone) {
        physbone.value = { ...physbone.value, ...data.physbone }
      }
    })
    api.onOSCLeashStatusUpdate((data: any) => {
      status.value = { ...status.value, ...data }
    })
  })
  onUnmounted(stopPolling)

  return {
    status,
    movement,
    physbone,
    config,
    autostart,
    toggle,
    toggleAutostart,
    loadConfig,
    saveConfig,
    resetConfig,
    refreshStatus
  }
}
