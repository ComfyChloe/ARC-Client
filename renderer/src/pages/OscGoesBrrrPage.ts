// ====
// OscGoesBrrrPage state factory — sibling script module for OscGoesBrrrPage.vue.
// Owns intiface draft fields, status labels, device-source toggling, and
// the polling-safe per-field watches. Shared state lives in
// composables/useOscGoesBrrr.ts.
// Call createOscGoesBrrrPageState() once from <script setup>.
// ====
import { computed, ref, watch } from 'vue'
import { useOscGoesBrrr, ALL_SOURCES } from '../composables/useOscGoesBrrr'

export function createOscGoesBrrrPageState() {
  const {
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
  } = useOscGoesBrrr()
  const intifaceAddress = ref('')
  const intifacePort = ref(12345)
  const intifaceWss = ref(false)
  const statusLabel = computed(() => {
    if (status.value.connecting) return 'Connecting'
    if (status.value.connected) return 'Connected'
    if (status.value.lastError) return 'Error'
    return 'Stopped'
  })
  const statusClass = computed(() => {
    if (status.value.lastError) return 'status-disconnected'
    if (status.value.connecting) return 'status-pending'
    if (status.value.connected) return 'status-connected'
    return 'status-disconnected'
  })
  // Watch each intiface field as an individual primitive so Vue uses Object.is comparisons.
  // This prevents the 1s polling loop (which replaces status.value entirely) from
  // resetting user input when the backend value hasn't actually changed.
  watch(() => status.value.intifaceAddress, (val) => { intifaceAddress.value = val }, { immediate: true })
  watch(() => status.value.intifacePort, (val) => { intifacePort.value = val }, { immediate: true })
  watch(() => status.value.intifaceWss, (val) => { intifaceWss.value = val }, { immediate: true })
  watch(status, (currentStatus) => {
    if (!selectedDeviceId.value && currentStatus.devices.length > 0) {
      void selectDevice(currentStatus.devices[0].id)
    }
  }, { immediate: true, deep: true })
  function populateIntifaceForm() {
    intifaceAddress.value = status.value.intifaceAddress
    intifacePort.value = status.value.intifacePort
    intifaceWss.value = status.value.intifaceWss
  }
  async function saveIntiface() {
    await updateIntifaceSettings(intifaceAddress.value, intifacePort.value, intifaceWss.value)
  }
  function toggleSource(src: string) {
    const idx = deviceBinding.value.sources.indexOf(src)
    if (idx >= 0) deviceBinding.value.sources.splice(idx, 1)
    else deviceBinding.value.sources.push(src)
  }
  async function handleSelectDevice(event: Event) {
    const deviceId = (event.target as HTMLSelectElement).value
    if (!deviceId) return
    await selectDevice(deviceId)
  }
  return {
    ALL_SOURCES,
    status,
    autostart,
    selectedDeviceId,
    deviceBinding,
    toggle,
    toggleAutostart,
    selectDevice,
    saveDeviceBinding,
    refreshStatus,
    intifaceAddress,
    intifacePort,
    intifaceWss,
    statusLabel,
    statusClass,
    populateIntifaceForm,
    saveIntiface,
    toggleSource,
    handleSelectDevice
  }
}
