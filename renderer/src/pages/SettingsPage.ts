// ====
// SettingsPage state factory — sibling script module for SettingsPage.vue.
// Owns the custom-server URL draft, pending log level, debug/memory stats
// display state, and their load/apply handlers.
// Shared state lives in composables/useSettings.ts.
// Call createSettingsPageState() once from <script setup>.
// ====
import { ref, watch } from 'vue'
import { useSettings } from '../composables/useSettings'

export function createSettingsPageState() {
  const {
    serverUrl, activeServer, logLevel,
    switchToServer,
    updateCustomServerUrl, updateLogLevel,
    getDebugStats, getMemoryStats, forceMemoryCleanup, clearDebugLogs
  } = useSettings()
  const customUrl = ref('')
  const pendingLogLevel = ref<'info' | 'warn' | 'error'>('info')
  const debugStats = ref<any>(null)
  const memoryStats = ref<any>(null)
  watch(serverUrl, (value) => {
    customUrl.value = value
  }, { immediate: true })
  watch(logLevel, (value) => {
    pendingLogLevel.value = value === 'warning' ? 'warn' : (value as 'info' | 'warn' | 'error')
  }, { immediate: true })
  async function handleCustomServer() {
    const url = customUrl.value.trim()
    if (!url) return
    await updateCustomServerUrl(url)
  }
  async function handleUpdateApplicationSettings() {
    await updateLogLevel(pendingLogLevel.value)
  }
  async function loadDebugStats() {
    debugStats.value = await getDebugStats()
  }
  async function loadMemoryStats() {
    memoryStats.value = await getMemoryStats()
  }
  return {
    serverUrl,
    activeServer,
    logLevel,
    switchToServer,
    forceMemoryCleanup,
    clearDebugLogs,
    customUrl,
    pendingLogLevel,
    debugStats,
    memoryStats,
    handleCustomServer,
    handleUpdateApplicationSettings,
    loadDebugStats,
    loadMemoryStats
  }
}
