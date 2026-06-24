import { ref, onMounted, computed } from 'vue'
import { useElectronAPI } from './useElectronAPI'
import { debugLog } from './useDebugLog'

export interface OscConnection {
  id: string
  type: 'incoming' | 'outgoing'
  port: number | null
  address: string
  enabled: boolean
  name: string
  enableWebSocketForwarding: boolean
}

export interface BlockedParam {
  path: string
  source: 'hardcoded' | 'blocklist' | 'suppressed'
  isPanelParam?: boolean
  isInAvatarJson?: boolean
}

const MAX_ADDITIONAL_CONNECTIONS = 20
const oscEnabled = ref(false)
const oscToggling = ref(false)
const oscPort = ref(0)
const oscStatus = ref<'connected' | 'disabled' | 'stopping' | 'error' | 'off'>('off')
const queryRunning = ref(false)
const queryRestarting = ref(false)
const localPort = ref(9001)
const targetPort = ref(9000)
const targetAddress = ref('127.0.0.1')
const oscQueryBindAddress = ref('0.0.0.0')
const additionalConnections = ref<OscConnection[]>([])
const unsubscriptions = ref<string[]>([])
const blockedParams = ref<BlockedParam[]>([])
const lastClearTime = ref<number>(0)
const CLEAR_COOLDOWN_MS = 15 * 60 * 1000
const clearCooldownRemaining = ref<number>(0)
let cooldownInterval: ReturnType<typeof setInterval> | null = null
function _startCooldownTimer() {
  if (cooldownInterval) return
  cooldownInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((lastClearTime.value + CLEAR_COOLDOWN_MS - Date.now()) / 1000))
    clearCooldownRemaining.value = remaining
    if (remaining <= 0 && cooldownInterval) {
      clearInterval(cooldownInterval)
      cooldownInterval = null
    }
  }, 1000)
}
let oscStatusInitialized = false
let oscStatusInitPromise: Promise<void> | null = null

function applyOscStatus(status: any) {
  const isListening = Boolean(status?.enabled ?? status?.isListening)
  const port = status?.port ?? status?.localPort ?? oscPort.value
  oscPort.value = port || 0
  if (isListening) {
    oscEnabled.value = true
    oscStatus.value = 'connected'
    return
  }
  if (status?.status === 'stopping') {
    oscStatus.value = 'stopping'
    return
  }
  if (status?.status === 'error' || status?.error) {
    oscEnabled.value = false
    oscStatus.value = 'error'
    return
  }
  oscEnabled.value = false
  oscStatus.value = 'disabled'
}

export function useOscStatus() {
  const api = useElectronAPI()

  async function loadConfig() {
    const config = await api.getServerConfig()
    localPort.value = config.legacyOscPort ?? 9001
    targetPort.value = config.targetOscPort ?? 9000
    targetAddress.value = config.targetOscAddress ?? '127.0.0.1'
    oscQueryBindAddress.value = config.oscQueryBindAddress ?? '0.0.0.0'
    if (config.additionalOscConnections) {
      additionalConnections.value = config.additionalOscConnections
    }
  }
  async function toggleOsc() {
    if (oscToggling.value) {
      debugLog('OSC toggle already in progress, please wait...', 'warn')
      return
    }
    oscToggling.value = true
    if (oscEnabled.value) {
      await api.disableOsc()
    } else {
      await api.enableOsc()
    }
    const status = await api.getOscStatus()
    applyOscStatus(status)
    debugLog(oscEnabled.value ? `OSC Server enabled` : 'OSC Server disabled')
    oscToggling.value = false
  }
  async function updateOscPorts() {
    await api.setConfig({
      legacyOscPort: localPort.value,
      targetOscPort: targetPort.value,
      targetOscAddress: targetAddress.value,
      oscQueryBindAddress: oscQueryBindAddress.value
    })
  }
  async function oscQueryForceReconnect() {
    await api.oscQueryForceReconnect()
  }
  async function oscQueryResetAll() {
    await api.oscQueryResetAll()
  }
  // Additional connections CRUD
  async function addConnection(type: 'incoming' | 'outgoing') {
    if (additionalConnections.value.length >= MAX_ADDITIONAL_CONNECTIONS) return
    const conn: OscConnection = {
      id: Date.now().toString(),
      type,
      port: null,
      address: type === 'incoming' ? '0.0.0.0' : '127.0.0.1',
      enabled: false,
      name: '',
      enableWebSocketForwarding: false
    }
    additionalConnections.value.push(conn)
    await saveConnections()
  }
  async function removeConnection(id: string) {
    additionalConnections.value = additionalConnections.value.filter(c => c.id !== id)
    await saveConnections()
  }
  async function toggleConnection(id: string, enabled: boolean) {
    const conn = additionalConnections.value.find(c => c.id === id)
    if (conn) {
      conn.enabled = enabled
      await saveConnections()
    }
  }
  async function toggleConnectionForwarding(id: string, enabled: boolean) {
    const conn = additionalConnections.value.find(c => c.id === id)
    if (conn) {
      conn.enableWebSocketForwarding = enabled
      await saveConnections()
    }
  }
  async function updateConnection(id: string, field: string, value: any) {
    const conn = additionalConnections.value.find(c => c.id === id)
    if (conn) {
      ;(conn as any)[field] = field === 'port' ? (value ? parseInt(value) : null) : value
      if (field === 'port' || field === 'address') {
        await saveConnections()
      }
    }
  }
  async function saveConnections() {
    const currentConfig = await api.getServerConfig()
    await api.setConfig({ ...currentConfig, additionalOscConnections: additionalConnections.value })
  }
  // OSC Query unsubscriptions
  async function loadUnsubscriptions() {
    const result = await api.getOscQueryUnsubscriptions()
    if (result?.success) {
      unsubscriptions.value = result.unsubscriptions ?? []
      debugLog(`OSC-Query unsubscriptions loaded: ${result.unsubscriptions?.length === 0 ? 'None (listening to all)' : result.unsubscriptions?.length}`)
    }
  }
  async function addUnsubscription(path: string) {
    if (!path.startsWith('/')) return
    const result = await api.addOscQueryUnsubscription(path)
    if (result?.success) unsubscriptions.value = result.unsubscriptions ?? []
  }
  async function removeUnsubscription(path: string) {
    const result = await api.removeOscQueryUnsubscription(path)
    if (result?.success) unsubscriptions.value = result.unsubscriptions ?? []
  }
  // Blocked parameters
  async function loadBlockedParams() {
    const [bl, sp, hc] = await Promise.all([
      api.getServerBlocklist(),
      api.getServerSuppressions(),
      api.getHardcodedUnsubscriptions()
    ])
    const list: BlockedParam[] = []
    for (const p of (hc?.patterns ?? [])) list.push({ path: p, source: 'hardcoded' })
    for (const p of (bl?.patterns ?? [])) list.push({ path: p, source: 'blocklist' })
    for (const p of (sp?.addresses ?? [])) {
      const meta = sp?.metadata?.[p]
      list.push({ path: p, source: 'suppressed', isPanelParam: meta?.isPanelParam, isInAvatarJson: meta?.isInAvatarJson })
    }
    blockedParams.value = list
  }
  async function requestUnsuppress(address: string) {
    await api.requestUnsuppress(address)
  }
  const isClearOnCooldown = computed(() => clearCooldownRemaining.value > 0)
  async function clearAllSuppressions(): Promise<void> {
    if (isClearOnCooldown.value) return
    const result = await api.clearAllSuppressions()
    if (result?.cooldown && result?.remainingMs) {
      // Server says cooldown is still active — sync client state to server time
      clearCooldownRemaining.value = Math.ceil(result.remainingMs / 1000)
      lastClearTime.value = Date.now() - (CLEAR_COOLDOWN_MS - result.remainingMs)
      _startCooldownTimer()
      return
    }
    if (!result?.success) return
    lastClearTime.value = Date.now()
    clearCooldownRemaining.value = Math.ceil(CLEAR_COOLDOWN_MS / 1000)
    _startCooldownTimer()
    await loadBlockedParams()
  }
  function handleOscServerStatus(data: any) {
    if (data.status === 'connection-ready' || data.status === 'connection-error') {
      const statusText = data.status === 'connection-ready' ? 'Ready' : 'Error'
      debugLog(`Additional OSC ${data.type} connection (${data.name || data.connectionId}): ${statusText} on port ${data.port}`)
      return
    }
    const s = data.status
    oscPort.value = data.port ?? oscPort.value
    if (s === 'connected') {
      oscStatus.value = 'connected'
      oscEnabled.value = true
      debugLog(`OSC Server listening on port ${data.port}`)
    } else if (s === 'stopping') {
      oscStatus.value = 'stopping'
    } else if (s === 'disabled') {
      oscStatus.value = 'disabled'
      oscEnabled.value = false
    } else if (s === 'error') {
      oscStatus.value = 'error'
      oscEnabled.value = false
      debugLog(`OSC Server error: ${data.error}`, 'error')
    } else {
      oscStatus.value = 'off'
      oscEnabled.value = false
    }
  }
  async function initialize() {
    if (oscStatusInitialized) return
    if (oscStatusInitPromise) return oscStatusInitPromise
    oscStatusInitPromise = (async () => {
      await loadConfig()
      await loadUnsubscriptions()
      await loadBlockedParams()
      const status = await api.getOscStatus()
      applyOscStatus(status)
      api.onOscServerStatus(handleOscServerStatus)
      api.onOscQueryStatus((data: any) => {
        if (data.status === 'started') {
          queryRunning.value = true
          queryRestarting.value = false
          debugLog(`OSC-Query service started on HTTP port ${data.httpPort}`)
          loadUnsubscriptions()
        } else if (data.status === 'restarting') {
          queryRunning.value = false
          queryRestarting.value = true
          debugLog('OSC-Query service restarting...')
        } else if (data.status === 'error') {
          queryRestarting.value = false
          debugLog(`OSC-Query service error: ${data.error}`, 'error')
        } else if (data.status === 'stopped') {
          queryRunning.value = false
          queryRestarting.value = false
          debugLog('OSC-Query service stopped')
        }
      })
      api.onParameterBlocklistUpdated(() => loadBlockedParams())
      api.onParametersSuppressed(() => loadBlockedParams())
      api.onParametersUnsuppressed(() => loadBlockedParams())
      oscStatusInitialized = true
    })()
    await oscStatusInitPromise
  }

  onMounted(async () => {
    await initialize()
  })

  return {
    oscEnabled,
    oscToggling,
    oscPort,
    oscStatus,
    queryRunning,
    queryRestarting,
    localPort,
    targetPort,
    targetAddress,
    oscQueryBindAddress,
    additionalConnections,
    unsubscriptions,
    blockedParams,
    clearCooldownRemaining,
    isClearOnCooldown,
    toggleOsc,
    updateOscPorts,
    oscQueryForceReconnect,
    oscQueryResetAll,
    addConnection,
    removeConnection,
    toggleConnection,
    toggleConnectionForwarding,
    updateConnection,
    addUnsubscription,
    removeUnsubscription,
    loadBlockedParams,
    requestUnsuppress,
    clearAllSuppressions,
    MAX_ADDITIONAL_CONNECTIONS
  }
}
