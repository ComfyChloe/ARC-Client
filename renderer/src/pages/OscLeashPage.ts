// ====
// OscLeashPage state factory — sibling script module for OscLeashPage.vue.
// Owns the config draft, tab state, save/reset handlers, deadzone helpers,
// and display formatting. Theme observation is shared via useTheme().
// Shared cross-page state lives in composables/useOscLeash.ts.
// Call createOscLeashPageState() once from <script setup>.
// ====
import { ref, computed, watch } from 'vue'
import { useOscLeash } from '../composables/useOscLeash'
import { useTheme } from '../composables/useTheme'

export function createOscLeashPageState() {
  const {
    status, movement, physbone, config, autostart,
    toggle, toggleAutostart, saveConfig, resetConfig
  } = useOscLeash()
  const { isDarkTheme } = useTheme()
  const activeTab = ref<'movement' | 'timing' | 'advanced'>('movement')
  const saving = ref(false)
  const configDraft = ref<Record<string, any>>({})
  const statusLabel = computed(() => {
    if (status.value.enabled) return 'Running'
    return 'Stopped'
  })
  const runStateColor = computed(() => (movement.value.run ? '#e74c3c' : '#95a5a6'))
  const runStateLabel = computed(() => (movement.value.run ? 'RUNNING' : 'IDLE'))
  const configPreview = computed(() => {
    if (!config.value) {
      return 'Configuration will appear here when OSC Leash is enabled'
    }
    return [
      `runDeadzone=${config.value.runDeadzone}`,
      `walkDeadzone=${config.value.walkDeadzone}`,
      `strengthMultiplier=${config.value.strengthMultiplier}`,
      `upCompensation=${config.value.upCompensation}`,
      `downCompensation=${config.value.downCompensation}`,
      `upDeadzone=${config.value.upDeadzone}`,
      `downDeadzone=${config.value.downDeadzone}`,
      `activeDelay=${config.value.activeDelay}`,
      `inactiveDelay=${config.value.inactiveDelay}`,
      `logging=${config.value.logging}`
    ].join('\n')
  })
  function initDraft() {
    if (config.value) {
      configDraft.value = { ...config.value }
    }
  }
  watch(config, () => {
    initDraft()
  }, { immediate: true })
  function onTabChange(tab: 'movement' | 'timing' | 'advanced') {
    activeTab.value = tab
  }
  async function handleSave() {
    saving.value = true
    await saveConfig(configDraft.value)
    saving.value = false
    initDraft()
  }
  async function handleReset() {
    await resetConfig()
    initDraft()
  }
  function toPercent(value: number): string {
    return `${Math.round(value * 100)}%`
  }
  function formatRateValue(value: number): string {
    return `${value.toFixed(0)}ms`
  }
  function setSharedCompensation(value: number) {
    configDraft.value.upCompensation = value
    configDraft.value.downCompensation = value
  }
  function setSharedDeadzone(value: number) {
    configDraft.value.upDeadzone = value
    configDraft.value.downDeadzone = value
  }
  return {
    // composable state
    status,
    movement,
    physbone,
    config,
    autostart,
    toggle,
    toggleAutostart,
    // theme
    isDarkTheme,
    // page-local state
    activeTab,
    saving,
    configDraft,
    // computed
    statusLabel,
    runStateColor,
    runStateLabel,
    configPreview,
    // handlers
    onTabChange,
    handleSave,
    handleReset,
    // helpers
    toPercent,
    formatRateValue,
    setSharedCompensation,
    setSharedDeadzone
  }
}
