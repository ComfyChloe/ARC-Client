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

type RawOscLeashConfig = {
  RunDeadzone?: number
  WalkDeadzone?: number
  StrengthMultiplier?: number
  UpDownCompensation?: number
  UpDownDeadzone?: number
  ActiveDelay?: number
  InactiveDelay?: number
  Logging?: boolean
  PhysboneParameters?: string[]
  DirectionalParameters?: {
    Z_Positive_Param?: string
    Z_Negative_Param?: string
    X_Positive_Param?: string
    X_Negative_Param?: string
    Y_Positive_Param?: string
    Y_Negative_Param?: string
  }
  runDeadzone?: number
  walkDeadzone?: number
  strengthMultiplier?: number
  upCompensation?: number
  downCompensation?: number
  upDeadzone?: number
  downDeadzone?: number
  activeDelay?: number
  inactiveDelay?: number
  logging?: boolean
  physboneParameter?: string
  verticalParameter?: string
  horizontalParameter?: string
  runParameter?: string
}

const DEFAULT_OSC_LEASH_CONFIG: OscLeashConfig = {
  runDeadzone: 70,
  walkDeadzone: 15,
  strengthMultiplier: 1.2,
  upCompensation: 1.0,
  downCompensation: 1.0,
  upDeadzone: 50,
  downDeadzone: 50,
  activeDelay: 20,
  inactiveDelay: 500,
  logging: false,
  physboneParameter: 'Leash',
  verticalParameter: 'Leash_Z+',
  horizontalParameter: 'Leash_X+',
  runParameter: '/input/Run'
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

function toPercent(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return Math.round(value * 100)
}

function normalizeOscLeashConfig(result: unknown): OscLeashConfig | null {
  if (!result || typeof result !== 'object') {
    return null
  }
  const raw = result as RawOscLeashConfig
  const directionalParameters = raw.DirectionalParameters ?? {}
  return {
    runDeadzone: typeof raw.runDeadzone === 'number' ? raw.runDeadzone : toPercent(raw.RunDeadzone, DEFAULT_OSC_LEASH_CONFIG.runDeadzone),
    walkDeadzone: typeof raw.walkDeadzone === 'number' ? raw.walkDeadzone : toPercent(raw.WalkDeadzone, DEFAULT_OSC_LEASH_CONFIG.walkDeadzone),
    strengthMultiplier: typeof raw.strengthMultiplier === 'number' ? raw.strengthMultiplier : raw.StrengthMultiplier ?? DEFAULT_OSC_LEASH_CONFIG.strengthMultiplier,
    upCompensation: typeof raw.upCompensation === 'number' ? raw.upCompensation : raw.UpDownCompensation ?? DEFAULT_OSC_LEASH_CONFIG.upCompensation,
    downCompensation: typeof raw.downCompensation === 'number' ? raw.downCompensation : raw.UpDownCompensation ?? DEFAULT_OSC_LEASH_CONFIG.downCompensation,
    upDeadzone: typeof raw.upDeadzone === 'number' ? raw.upDeadzone : toPercent(raw.UpDownDeadzone, DEFAULT_OSC_LEASH_CONFIG.upDeadzone),
    downDeadzone: typeof raw.downDeadzone === 'number' ? raw.downDeadzone : toPercent(raw.UpDownDeadzone, DEFAULT_OSC_LEASH_CONFIG.downDeadzone),
    activeDelay: typeof raw.activeDelay === 'number' ? raw.activeDelay : raw.ActiveDelay ?? DEFAULT_OSC_LEASH_CONFIG.activeDelay,
    inactiveDelay: typeof raw.inactiveDelay === 'number' ? raw.inactiveDelay : raw.InactiveDelay ?? DEFAULT_OSC_LEASH_CONFIG.inactiveDelay,
    logging: typeof raw.logging === 'boolean' ? raw.logging : raw.Logging ?? DEFAULT_OSC_LEASH_CONFIG.logging,
    physboneParameter: raw.physboneParameter ?? raw.PhysboneParameters?.[0] ?? DEFAULT_OSC_LEASH_CONFIG.physboneParameter,
    verticalParameter: raw.verticalParameter ?? directionalParameters.Z_Positive_Param ?? DEFAULT_OSC_LEASH_CONFIG.verticalParameter,
    horizontalParameter: raw.horizontalParameter ?? directionalParameters.X_Positive_Param ?? DEFAULT_OSC_LEASH_CONFIG.horizontalParameter,
    runParameter: raw.runParameter ?? DEFAULT_OSC_LEASH_CONFIG.runParameter
  }
}

function serializeOscLeashConfig(config: OscLeashConfig): RawOscLeashConfig {
  return {
    RunDeadzone: Number(config.runDeadzone) / 100,
    WalkDeadzone: Number(config.walkDeadzone) / 100,
    StrengthMultiplier: Number(config.strengthMultiplier),
    UpDownCompensation: Number(config.upCompensation),
    UpDownDeadzone: Number(config.upDeadzone) / 100,
    ActiveDelay: Number(config.activeDelay),
    InactiveDelay: Number(config.inactiveDelay),
    Logging: Boolean(config.logging),
    PhysboneParameters: [config.physboneParameter || DEFAULT_OSC_LEASH_CONFIG.physboneParameter],
    DirectionalParameters: {
      Z_Positive_Param: config.verticalParameter || DEFAULT_OSC_LEASH_CONFIG.verticalParameter,
      Z_Negative_Param: 'Leash_Z-',
      X_Positive_Param: config.horizontalParameter || DEFAULT_OSC_LEASH_CONFIG.horizontalParameter,
      X_Negative_Param: 'Leash_X-',
      Y_Positive_Param: 'Leash_Y+',
      Y_Negative_Param: 'Leash_Y-'
    }
  }
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
    config.value = normalizeOscLeashConfig(await api.oscleashGetConfig())
  }
  async function saveConfig(updated: Partial<OscLeashConfig>) {
    const mergedConfig = {
      ...DEFAULT_OSC_LEASH_CONFIG,
      ...(config.value ?? {}),
      ...updated
    } as OscLeashConfig
    await api.oscleashUpdateConfig(serializeOscLeashConfig(mergedConfig))
    await loadConfig()
  }
  async function resetConfig() {
    const defaults: Partial<OscLeashConfig> = {
      runDeadzone: DEFAULT_OSC_LEASH_CONFIG.runDeadzone,
      walkDeadzone: 15,
      strengthMultiplier: DEFAULT_OSC_LEASH_CONFIG.strengthMultiplier,
      upCompensation: DEFAULT_OSC_LEASH_CONFIG.upCompensation,
      upDeadzone: DEFAULT_OSC_LEASH_CONFIG.upDeadzone,
      downCompensation: DEFAULT_OSC_LEASH_CONFIG.downCompensation,
      downDeadzone: DEFAULT_OSC_LEASH_CONFIG.downDeadzone,
      activeDelay: DEFAULT_OSC_LEASH_CONFIG.activeDelay,
      inactiveDelay: DEFAULT_OSC_LEASH_CONFIG.inactiveDelay,
      logging: DEFAULT_OSC_LEASH_CONFIG.logging,
      physboneParameter: DEFAULT_OSC_LEASH_CONFIG.physboneParameter,
      verticalParameter: DEFAULT_OSC_LEASH_CONFIG.verticalParameter,
      horizontalParameter: DEFAULT_OSC_LEASH_CONFIG.horizontalParameter,
      runParameter: DEFAULT_OSC_LEASH_CONFIG.runParameter
    }
    await saveConfig(defaults)
  }
  async function refreshAutostart() {
    const result = await api.oscleashGetAutostart()
    autostart.value = normalizeAutostartResult(result)
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
