<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSettings } from '../composables/useSettings'

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
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>Settings</h1>
      <p>Configure your ARC-OSC Client settings</p>
    </div>

    <div class="card">
      <h3>Server Configuration</h3>
      <div class="form-group">
        <label>Quick Server Selection</label>
        <div class="settings-server-buttons">
          <button class="btn" :class="activeServer === 'live' ? 'btn-primary server-btn-active' : 'btn-primary'" type="button" @click="switchToServer('live')">ARC-Live</button>
          <button class="btn" :class="activeServer === 'beta' ? 'btn-secondary server-btn-active' : 'btn-secondary'" type="button" @click="switchToServer('beta')">ARC-Beta</button>
          <button class="btn" :class="activeServer === 'custom' ? 'btn-warning server-btn-active' : 'btn-warning'" type="button" @click="switchToServer('custom')">Custom (Dev)</button>
        </div>
        <div id="current-server-status" class="server-status-box">
          <strong>Current Server:</strong>
          <span>{{ activeServer === 'live' ? 'ARC-Live' : activeServer === 'beta' ? 'ARC-Beta' : 'Custom (Dev)' }}</span>
        </div>
      </div>
      <div class="form-group">
        <label for="server-url-settings">WebSocket Server URL</label>
        <input id="server-url-settings" v-model="customUrl" type="text" @keypress.enter="handleCustomServer" />
        <small>Use Quick Server Selection above for Live/Beta. Manual entry only for custom dev servers.</small>
      </div>
      <button class="btn btn-primary" type="button" @click="handleCustomServer">Apply Custom Server URL</button>
    </div>

    <div class="card">
      <h3>Application Settings</h3>
      <div class="form-group">
        <label for="log-level">Log Level</label>
        <select id="log-level" v-model="pendingLogLevel">
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>
      <button class="btn btn-primary" type="button" @click="handleUpdateApplicationSettings">Update Application Settings</button>
    </div>

    <div class="card">
      <h3>Diagnostics</h3>
      <div class="settings-action-row">
        <button class="btn btn-secondary" type="button" @click="loadDebugStats">Load Debug Stats</button>
        <button class="btn btn-secondary" type="button" @click="loadMemoryStats">Load Memory Stats</button>
        <button class="btn btn-warning" type="button" @click="forceMemoryCleanup">Force Memory Cleanup</button>
        <button class="btn btn-danger" type="button" @click="clearDebugLogs">Clear Debug Logs</button>
      </div>
      <div v-if="debugStats" class="stats-box">
        <h4>Debug Stats</h4>
        <pre>{{ JSON.stringify(debugStats, null, 2) }}</pre>
      </div>
      <div v-if="memoryStats" class="stats-box">
        <h4>Memory Stats</h4>
        <pre>{{ JSON.stringify(memoryStats, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>
