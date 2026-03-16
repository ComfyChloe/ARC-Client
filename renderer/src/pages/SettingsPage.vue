<script setup lang="ts">
import { ref } from 'vue'
import { useSettings } from '../composables/useSettings'

const {
  serverUrl, activeServer, theme, snowEnabled, logLevel,
  clientVersion, runtimeDisplay,
  toggleTheme, toggleSnow, switchToServer,
  updateCustomServerUrl, updateLogLevel,
  getDebugStats, getMemoryStats, forceMemoryCleanup, clearDebugLogs
} = useSettings()

const customUrl = ref('')
const debugStats = ref<any>(null)
const memoryStats = ref<any>(null)

async function handleCustomServer() {
  const url = customUrl.value.trim()
  if (!url) return
  await updateCustomServerUrl(url)
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
      <h3>Server</h3>
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
        <input id="server-url-settings" v-model="customUrl" type="text" :placeholder="serverUrl" @keypress.enter="handleCustomServer" />
        <small>Use Quick Server Selection above for Live or Beta. Manual entry is for custom development servers.</small>
      </div>
      <button class="btn btn-primary" type="button" @click="handleCustomServer">Apply Custom Server URL</button>
    </div>

    <div class="card">
      <h3>Application Settings</h3>
      <div class="form-group">
        <label for="theme-select">Theme</label>
        <select id="theme-select" :value="theme" @change="toggleTheme">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div class="form-group">
        <label for="log-level">Log Level</label>
        <select id="log-level" :value="logLevel" @change="(e: Event) => updateLogLevel((e.target as HTMLSelectElement).value)">
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
      </div>
      <div class="form-group settings-inline-group">
        <label>Snow Overlay</label>
        <button class="btn btn-secondary" type="button" @click="toggleSnow">{{ snowEnabled ? 'Disable Snow' : 'Enable Snow' }}</button>
      </div>
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

    <div class="card">
      <h3>Client Information</h3>
      <div class="info-row">
        <span>Client Version</span>
        <span>{{ clientVersion || 'Unknown' }}</span>
      </div>
      <div class="info-row">
        <span>Runtime</span>
        <span class="runtime-timer">{{ runtimeDisplay }}</span>
      </div>
    </div>
  </div>
</template>
