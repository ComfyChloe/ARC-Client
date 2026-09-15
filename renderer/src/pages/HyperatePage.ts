// ====
// HyperatePage state factory — sibling script module for HyperatePage.vue.
// Owns tracker add/edit UI state, status labels, and heart-rate display
// computed values. Charts come from useHeartRateChart, trackers from
// useHyperate, theme observation from useTheme().
// Call createHyperatePageState() once from <script setup>.
// ====
import { computed, ref, watch } from 'vue'
import { useHyperate, type HyperateTracker } from '../composables/useHyperate'
import { useHeartRateChart } from '../composables/useHeartRateChart'
import { useTheme } from '../composables/useTheme'

export function createHyperatePageState() {
  const {
    status,
    trackers,
    autostart,
    heartRate,
    toggle,
    toggleAutostart,
    addTracker,
    removeTracker,
    setPrimary,
    updateTrackerName
  } = useHyperate()
  const {
    chartData,
    stats,
    isLive,
    selectedRange,
    selectedStep,
    isCustomRange,
    customFromInput,
    customToInput,
    trackerId,
    loading,
    retentionDays,
    setRange,
    goLive,
    setStep,
    activateCustomRange,
    applyCustomRange,
    setNow,
    onPanOffset,
    onZoom,
    setRetention,
    captureRate,
    setCaptureRate,
    STEP_OPTIONS,
    toDatetimeLocal
  } = useHeartRateChart()
  const { isDarkTheme } = useTheme()
  const newDeviceId = ref('')
  const newDeviceName = ref('')
  const editingTrackerId = ref<string | null>(null)
  const editName = ref('')
  const primaryTracker = computed(() => trackers.value.find((tracker) => tracker.isPrimary) ?? null)
  watch(primaryTracker, (pt) => {
    if (pt) trackerId.value = pt.deviceId
  }, { immediate: true })
  const statusClass = computed(() => {
    const currentStatus = status.value
    if (!currentStatus.hasApiKey) return 'status-error'
    if (currentStatus.enabled && currentStatus.connected) return 'status-connected'
    if (currentStatus.stopping) return 'status-stopping'
    if (currentStatus.enabled && (currentStatus.reconnecting || currentStatus.lastError)) return 'status-error'
    if (currentStatus.enabled) return 'status-connecting'
    return 'status-disconnected'
  })
  const statusText = computed(() => {
    const currentStatus = status.value
    if (!currentStatus.hasApiKey) return 'No API Key - Check secrets.json'
    if (currentStatus.enabled && currentStatus.connected) return 'Connected and Active'
    if (currentStatus.stopping) return 'Stopping...'
    if (currentStatus.enabled && currentStatus.reconnecting) {
      let message = `Reconnecting (${currentStatus.reconnectAttempts}/${currentStatus.maxReconnectAttempts})...`
      if (currentStatus.lastError) {
        message += ` - ${currentStatus.lastError}`
      }
      return message
    }
    if (currentStatus.enabled && currentStatus.lastError) return `Error: ${currentStatus.lastError}`
    if (currentStatus.enabled) return 'Connecting...'
    return 'Stopped'
  })
  const toggleButtonLabel = computed(() => {
    const currentStatus = status.value
    if (!currentStatus.hasApiKey) return 'Missing API Key'
    if (currentStatus.stopping) return 'Stopping...'
    if (currentStatus.enabled) return 'Stop HypeRate'
    return 'Start HypeRate'
  })
  const toggleButtonDisabled = computed(() => !status.value.hasApiKey || status.value.stopping)
  const currentHeartRate = computed(() => {
    if (status.value.enabled && heartRate.value > 0) return String(heartRate.value)
    if (status.value.enabled && primaryTracker.value && primaryTracker.value.lastHeartRate > 0) {
      return String(primaryTracker.value.lastHeartRate)
    }
    return '--'
  })
  const primaryTrackerLabel = computed(() => {
    if (!primaryTracker.value) return 'No primary tracker set'
    return `Primary: ${primaryTracker.value.name || primaryTracker.value.deviceId}`
  })
  async function handleAddTracker() {
    const deviceId = newDeviceId.value.trim()
    if (!deviceId) {
      return
    }
    await addTracker(deviceId, newDeviceName.value.trim() || undefined)
    newDeviceId.value = ''
    newDeviceName.value = ''
  }
  function openEditModal(tracker: HyperateTracker) {
    editingTrackerId.value = tracker.deviceId
    editName.value = tracker.name || ''
  }
  function closeEditModal() {
    editingTrackerId.value = null
    editName.value = ''
  }
  async function saveEdit() {
    if (!editingTrackerId.value) {
      return
    }
    await updateTrackerName(editingTrackerId.value, editName.value.trim())
    closeEditModal()
  }
  function formatLastUpdate(tracker: HyperateTracker) {
    return tracker.lastUpdate ? new Date(tracker.lastUpdate).toLocaleTimeString() : 'Never'
  }
  return {
    // useHyperate state
    status,
    trackers,
    autostart,
    heartRate,
    toggle,
    toggleAutostart,
    addTracker,
    removeTracker,
    setPrimary,
    // useHeartRateChart state
    chartData,
    stats,
    isLive,
    selectedRange,
    selectedStep,
    isCustomRange,
    customFromInput,
    customToInput,
    loading,
    retentionDays,
    setRange,
    goLive,
    setStep,
    activateCustomRange,
    applyCustomRange,
    setNow,
    onPanOffset,
    onZoom,
    setRetention,
    captureRate,
    setCaptureRate,
    STEP_OPTIONS,
    toDatetimeLocal,
    // theme
    isDarkTheme,
    // page-local state
    newDeviceId,
    newDeviceName,
    editingTrackerId,
    editName,
    // computed
    primaryTracker,
    trackerId,
    statusClass,
    statusText,
    toggleButtonLabel,
    toggleButtonDisabled,
    currentHeartRate,
    primaryTrackerLabel,
    // handlers
    handleAddTracker,
    openEditModal,
    closeEditModal,
    saveEdit,
    formatLastUpdate
  }
}
