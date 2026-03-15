import { ref, onMounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

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

export function useOscStatus() {
  const api = useElectronAPI()
  const oscEnabled = ref(false)
  const oscToggling = ref(false)
  const oscPort = ref(0)
  const oscStatus = ref<'connected' | 'disabled' | 'stopping' | 'error' | 'off'>('off')
  const queryRunning = ref(false)
  // Config values
  const localPort = ref(9001)
  const targetPort = ref(9000)
  const targetAddress = ref('127.0.0.1')
  const oscQueryBindAddress = ref('0.0.0.0')
  // Additional connections
  const additionalConnections = ref<OscConnection[]>([])
  // OSC Query unsubscriptions
  const unsubscriptions = ref<string[]>([])
  // Blocked/suppressed parameters
  const blockedParams = ref<BlockedParam[]>([])

  async function loadConfig() {
    const config = await api.getServerConfig()
    localPort.value = config.localOscPort ?? 9001
    targetPort.value = config.targetOscPort ?? 9000
    targetAddress.value = config.targetOscAddress ?? '127.0.0.1'
    oscQueryBindAddress.value = config.oscQueryBindAddress ?? '0.0.0.0'
    if (config.additionalOscConnections) {
      additionalConnections.value = config.additionalOscConnections
    }
  }
  async function toggleOsc() {
    if (oscToggling.value) return
    oscToggling.value = true
    if (oscEnabled.value) {
      await api.disableOsc()
      oscEnabled.value = false
    } else {
      await api.enableOsc()
      oscEnabled.value = true
    }
    oscToggling.value = false
  }
  async function updateOscPorts() {
    await api.setConfig({
      localOscPort: localPort.value,
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
    if (result?.success) unsubscriptions.value = result.unsubscriptions ?? []
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
  function handleOscServerStatus(data: any) {
    if (data.status === 'connection-ready' || data.status === 'connection-error') return
    const s = data.status
    oscPort.value = data.port ?? oscPort.value
    if (s === 'connected') {
      oscStatus.value = 'connected'
      oscEnabled.value = true
    } else if (s === 'stopping') {
      oscStatus.value = 'stopping'
    } else if (s === 'disabled') {
      oscStatus.value = 'disabled'
      oscEnabled.value = false
    } else if (s === 'error') {
      oscStatus.value = 'error'
      oscEnabled.value = false
    } else {
      oscStatus.value = 'off'
      oscEnabled.value = false
    }
  }

  onMounted(async () => {
    await loadConfig()
    await loadUnsubscriptions()
    await loadBlockedParams()
    // Check initial OSC status
    const status = await api.getOscStatus()
    if (status?.enabled) {
      oscEnabled.value = true
      oscStatus.value = 'connected'
      oscPort.value = status.port ?? 0
    }
    api.onOscServerStatus(handleOscServerStatus)
    api.onOscQueryStatus((data: any) => {
      if (data.status === 'started') {
        queryRunning.value = true
        loadUnsubscriptions()
      } else if (data.status === 'stopped') {
        queryRunning.value = false
      }
    })
    api.onParameterBlocklistUpdated(() => loadBlockedParams())
    api.onParametersSuppressed(() => loadBlockedParams())
    api.onParametersUnsuppressed(() => loadBlockedParams())
  })

  return {
    oscEnabled,
    oscToggling,
    oscPort,
    oscStatus,
    queryRunning,
    localPort,
    targetPort,
    targetAddress,
    oscQueryBindAddress,
    additionalConnections,
    unsubscriptions,
    blockedParams,
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
    MAX_ADDITIONAL_CONNECTIONS
  }
}
