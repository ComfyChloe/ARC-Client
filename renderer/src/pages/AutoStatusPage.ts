// ====
// AutoStatusPage state factory — sibling script module for AutoStatusPage.vue.
// Owns banner computed labels, schedule/location-rule drafts, delete
// confirmation state, telemetry toggle, and the access-type dropdown.
// Shared cross-page state lives in composables/useAutoStatus.ts.
// Call createAutoStatusPageState() once from <script setup>.
// ====
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAutoStatus, STATUS_TYPES, DAY_LABELS, INSTANCE_TYPES } from '../composables/useAutoStatus'
import type { Preset, ScheduleEntry, LocationRule } from '../composables/useAutoStatus'
import { useServerConnection } from '../composables/useServerConnection'
import { useElectronAPI } from '../composables/useElectronAPI'
import { useTheme } from '../composables/useTheme'

export function createAutoStatusPageState() {
  const {
    presets,
    schedule,
    locationRules,
    settings,
    status,
    createPreset,
    updatePreset,
    deletePreset,
    testPreset,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    createLocationRule,
    updateLocationRule,
    deleteLocationRule,
    updateSettings
  } = useAutoStatus()
  const { localAvatarId, confirmedAvatarId } = useServerConnection()
  const activePreset = computed(() => {
    if (!status.value.lastAppliedPresetId) return null
    return presets.value.find((preset) => preset.id === status.value.lastAppliedPresetId) ?? null
  })
  const currentStatusType = computed(() => {
    return STATUS_TYPES.find((type) => type.value === status.value.currentStatus) ?? null
  })
  const bannerTitle = computed(() => {
    return activePreset.value?.name ?? currentStatusType.value?.label ?? 'No Active Preset'
  })
  const bannerSubtitle = computed(() => {
    if (status.value.currentStatusDescription) return status.value.currentStatusDescription
    if (currentStatusType.value) return currentStatusType.value.label
    return 'Waiting for trigger...'
  })
  const newSchedule = ref({
    name: '',
    startTime: '09:00',
    endTime: '17:00',
    presetId: 0,
    fallbackStatusType: ''
  })
  const newDays = ref<Set<number>>(new Set())
  const confirmDeleteId = ref<number | null>(null)
  const editingScheduleId = ref<string | null>(null)
  const editingScheduleName = ref('')
  const confirmDeleteLocationRuleId = ref<string | null>(null)
  const openAccessTypeDropdown = ref<string | null>(null)
  // Autostatus telemetry — gates whether ARC-Client batches and
  // sends clientStatus envelopes to ARC-OSC. The collector always
  // runs in the background and queues events in arrival order, so
  // toggling on flushes the backlog; toggling off stops wire emits
  // while keeping the queue warm.
  const telemetryEnabled = ref(true)
  const telemetryBusy = ref(false)
  const autostatusApi = useElectronAPI()
  const { isDarkTheme } = useTheme()
  async function toggleTelemetry() {
    if (telemetryBusy.value) return
    telemetryBusy.value = true
    try {
      const next = !telemetryEnabled.value
      telemetryEnabled.value = next
      // setAppSettings IPC pushes the toggle to the main process
      // websocketManager immediately (backlog drains in arrival order
      // when transitioning OFF -> ON). No restart required.
      const current = await autostatusApi.getAppSettings()
      current.telemetryEnabled = next
      await autostatusApi.setAppSettings(current)
    } finally {
      telemetryBusy.value = false
    }
  }
  function onPresetFieldChange(preset: Preset, field: keyof Preset, value: string | null) {
    const updated = {
      ...preset,
      [field]: field === 'statusType' && value === '' ? null : value
    }
    void updatePreset(updated)
  }
  function toggleDay(day: number) {
    const updated = new Set(newDays.value)
    if (updated.has(day)) {
      updated.delete(day)
    } else {
      updated.add(day)
    }
    newDays.value = updated
  }
  async function handleAddSchedule() {
    if (newDays.value.size === 0) return
    if (!newSchedule.value.startTime || !newSchedule.value.endTime) return
    const presetId = newSchedule.value.presetId || (presets.value[0]?.id ?? 0)
    if (!presetId) return
    await addSchedule({
      daysOfWeek: Array.from(newDays.value).sort(),
      startTime: newSchedule.value.startTime,
      endTime: newSchedule.value.endTime,
      presetId,
      name: newSchedule.value.name,
      fallbackStatusType: newSchedule.value.fallbackStatusType || null
    })
    newSchedule.value = {
      name: '',
      startTime: '09:00',
      endTime: '17:00',
      presetId: 0,
      fallbackStatusType: ''
    }
    newDays.value = new Set()
  }
  function beginDeletePreset(id: number) {
    confirmDeleteId.value = id
  }
  async function executeDelete() {
    if (confirmDeleteId.value === null) return
    await deletePreset(confirmDeleteId.value)
    confirmDeleteId.value = null
  }
  function cancelDelete() {
    confirmDeleteId.value = null
  }
  function schedulePreset(entry: ScheduleEntry) {
    return presets.value.find((preset) => preset.id === entry.presetId)
  }
  function scheduleStatusType(entry: ScheduleEntry) {
    const preset = schedulePreset(entry)
    return preset ? STATUS_TYPES.find((type) => type.value === preset.statusType) ?? null : null
  }
  function isOvernight(entry: ScheduleEntry) {
    return entry.endTime <= entry.startTime
  }
  function startEditScheduleName(entryId: string, name: string) {
    editingScheduleId.value = entryId
    editingScheduleName.value = name || ''
  }
  async function saveScheduleName(entryId: string) {
    await updateSchedule(entryId, { name: editingScheduleName.value.trim() })
    editingScheduleId.value = null
    editingScheduleName.value = ''
  }
  function locationRulePreset(rule: LocationRule) {
    return presets.value.find((preset) => preset.id === rule.presetId)
  }
  function locationRuleStatusType(rule: LocationRule) {
    const preset = locationRulePreset(rule)
    return preset ? STATUS_TYPES.find((type) => type.value === preset.statusType) ?? null : null
  }
  function onLocationRuleFieldChange(rule: LocationRule, field: keyof LocationRule, value: string | number | boolean | null) {
    void updateLocationRule(rule.id, { [field]: value })
  }
  function toggleAccessType(rule: LocationRule, typeValue: string) {
    const current = rule.matchAccessTypes || []
    const updated = current.includes(typeValue) ? current.filter(t => t !== typeValue) : [...current, typeValue]
    void updateLocationRule(rule.id, { matchAccessTypes: updated })
  }
  function toggleAccessTypeDropdown(ruleId: string) {
    openAccessTypeDropdown.value = openAccessTypeDropdown.value === ruleId ? null : ruleId
  }
  function closeAccessTypeDropdown() {
    openAccessTypeDropdown.value = null
  }
  function onDocumentClick() {
    openAccessTypeDropdown.value = null
  }
  onMounted(() => {
    document.addEventListener('click', onDocumentClick)
    // Pull the persisted autostatus telemetry flag so the banner
    // badge reflects the current state on mount.
    void (async () => {
      try {
        const settings = await autostatusApi.getAppSettings()
        telemetryEnabled.value = settings?.telemetryEnabled ?? true
      } catch { /* fall back to default-on */ }
    })()
  })
  onUnmounted(() => {
    document.removeEventListener('click', onDocumentClick)
  })
  function beginDeleteLocationRule(id: string) {
    confirmDeleteLocationRuleId.value = id
  }
  async function executeDeleteLocationRule() {
    if (confirmDeleteLocationRuleId.value === null) return
    await deleteLocationRule(confirmDeleteLocationRuleId.value)
    confirmDeleteLocationRuleId.value = null
  }
  function cancelDeleteLocationRule() {
    confirmDeleteLocationRuleId.value = null
  }
  function formatAccessType(types: string[] | null): string {
    if (!types || types.length === 0) return 'Any'
    return types.map(t => {
      const found = INSTANCE_TYPES.find(it => it.value === t)
      return found ? found.label : t
    }).join(', ')
  }
  return {
    // composable state
    presets,
    schedule,
    locationRules,
    settings,
    status,
    localAvatarId,
    confirmedAvatarId,
    createPreset,
    updatePreset,
    testPreset,
    deleteSchedule,
    createLocationRule,
    deleteLocationRule,
    updateSettings,
    // constants
    STATUS_TYPES,
    DAY_LABELS,
    INSTANCE_TYPES,
    // computed
    activePreset,
    currentStatusType,
    bannerTitle,
    bannerSubtitle,
    // page-local state
    newSchedule,
    newDays,
    confirmDeleteId,
    editingScheduleId,
    editingScheduleName,
    confirmDeleteLocationRuleId,
    openAccessTypeDropdown,
    telemetryEnabled,
    telemetryBusy,
    isDarkTheme,
    // handlers
    toggleTelemetry,
    onPresetFieldChange,
    toggleDay,
    handleAddSchedule,
    beginDeletePreset,
    executeDelete,
    cancelDelete,
    schedulePreset,
    scheduleStatusType,
    isOvernight,
    startEditScheduleName,
    saveScheduleName,
    locationRulePreset,
    locationRuleStatusType,
    onLocationRuleFieldChange,
    toggleAccessType,
    toggleAccessTypeDropdown,
    closeAccessTypeDropdown,
    beginDeleteLocationRule,
    executeDeleteLocationRule,
    cancelDeleteLocationRule,
    formatAccessType
  }
}
