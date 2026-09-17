// ====
// OscPage state factory — sibling script module for OscPage.vue.
// Owns OSC test-send state, unsubscription input, blocked-param display
// helpers, and connection grouping computed values.
// Shared cross-page state lives in composables/useOscStatus.ts.
// Call createOscPageState() once from <script setup>.
// ====
import { computed, ref } from 'vue'
import { useElectronAPI } from '../composables/useElectronAPI'
import { useOscStatus, type BlockedParam } from '../composables/useOscStatus'

export function createOscPageState() {
  const api = useElectronAPI()
  const {
    queryRunning,
    queryRestarting,
    localPort, targetPort, targetAddress, oscQueryBindAddress,
    additionalConnections, unsubscriptions, blockedParams,
    updateOscPorts,
    addConnection, removeConnection, toggleConnection,
    toggleConnectionForwarding, updateConnection,
    addUnsubscription, removeUnsubscription, requestUnsuppress,
    clearAllSuppressions, isClearOnCooldown, clearCooldownRemaining,
    MAX_ADDITIONAL_CONNECTIONS
  } = useOscStatus()
  const newUnsubPath = ref('')
  const blockedExpanded = ref(false)
  const oscAddress = ref('')
  const oscValue = ref('')
  const oscType = ref<'float' | 'int' | 'bool'>('float')
  const sendMessage = ref<string | null>(null)
  const incomingConnections = computed(() => additionalConnections.value.filter((conn) => conn.type === 'incoming'))
  const outgoingConnections = computed(() => additionalConnections.value.filter((conn) => conn.type === 'outgoing'))
  const queryStatusText = computed(() => {
    if (queryRestarting.value) return 'OSC-Query service is restarting...'
    return queryRunning.value ? 'OSC-Query service is active and listening to all incoming OSC data' : 'OSC-Query service is currently stopped'
  })
  const blockedEmpty = computed(() => blockedParams.value.length === 0)
  const blockedCountLabel = computed(() => `${blockedParams.value.length} blocked path(s)`)
  const hasSuppressedParams = computed(() => blockedParams.value.some(p => p.source === 'suppressed'))
  const cooldownLabel = computed(() => {
    const s = clearCooldownRemaining.value
    if (s <= 0) return ''
    const m = Math.floor(s / 60)
    const sec = String(s % 60).padStart(2, '0')
    return `Available in ${m}:${sec}`
  })
  async function handleAddUnsub() {
    const path = newUnsubPath.value.trim()
    if (!path) return
    await addUnsubscription(path)
    newUnsubPath.value = ''
  }
  function canUnsuppress(param: BlockedParam): boolean {
    return param.source === 'suppressed'
  }
  function connectionCardTitle(name: string, fallbackPrefix: string, index: number) {
    return name || `${fallbackPrefix} Connection ${index}`
  }
  function blockedBadges(param: BlockedParam) {
    const badges: string[] = []
    if (param.source === 'hardcoded') {
      badges.push('User')
    } else if (param.source === 'blocklist') {
      badges.push('Blocked')
    } else {
      badges.push('Suppressed')
    }
    if (param.isPanelParam) {
      badges.push('Panel')
    }
    if (param.isInAvatarJson) {
      badges.push('Avatar JSON')
    }
    return badges
  }
  async function handleSendOsc() {
    const address = oscAddress.value.trim()
    const rawValue = oscValue.value.trim()
    if (!address || !rawValue) return
    let value: string | number | boolean = rawValue
    let type = 'f'
    if (oscType.value === 'int') {
      value = Number.parseInt(rawValue, 10)
      type = 'i'
    } else if (oscType.value === 'bool') {
      value = rawValue === 'true' || rawValue === '1'
      type = 'bool'
    } else {
      value = Number.parseFloat(rawValue)
      type = 'f'
    }
    const result = await api.sendOscLocal({ address, value, type })
    sendMessage.value = result?.success ? 'OSC message sent successfully.' : result?.error ?? 'Failed to send OSC message.'
  }
  return {
    // composable state
    queryRunning,
    queryRestarting,
    localPort,
    targetPort,
    targetAddress,
    oscQueryBindAddress,
    additionalConnections,
    unsubscriptions,
    blockedParams,
    updateOscPorts,
    addConnection,
    removeConnection,
    toggleConnection,
    toggleConnectionForwarding,
    updateConnection,
    addUnsubscription,
    removeUnsubscription,
    requestUnsuppress,
    clearAllSuppressions,
    isClearOnCooldown,
    MAX_ADDITIONAL_CONNECTIONS,
    // page-local state
    newUnsubPath,
    blockedExpanded,
    oscAddress,
    oscValue,
    oscType,
    sendMessage,
    // computed
    incomingConnections,
    outgoingConnections,
    queryStatusText,
    blockedEmpty,
    blockedCountLabel,
    hasSuppressedParams,
    cooldownLabel,
    // handlers
    handleAddUnsub,
    handleSendOsc,
    // helpers
    canUnsuppress,
    connectionCardTitle,
    blockedBadges
  }
}
