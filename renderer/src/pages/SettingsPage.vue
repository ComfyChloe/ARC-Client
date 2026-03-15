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
  <div class="page">
    <h2>Settings</h2>

    <!-- Server Selection -->
    <div class="section">
      <h3>Server</h3>
      <div class="server-buttons">
        <button class="btn" :class="activeServer === 'live' ? 'btn-success' : 'btn-secondary'" @click="switchToServer('live')">Live</button>
        <button class="btn" :class="activeServer === 'beta' ? 'btn-success' : 'btn-secondary'" @click="switchToServer('beta')">Beta</button>
        <button class="btn" :class="activeServer === 'custom' ? 'btn-success' : 'btn-secondary'" @click="switchToServer('custom')">Custom</button>
      </div>
      <div class="server-url-display">
        <span class="label">Current:</span>
        <span class="mono">{{ serverUrl }}</span>
      </div>
      <div v-if="activeServer === 'custom'" class="form-row">
        <input v-model="customUrl" type="text" class="input" placeholder="wss://your-server:48255" @keypress.enter="handleCustomServer" />
        <button class="btn btn-primary" @click="handleCustomServer">Apply</button>
      </div>
    </div>

    <!-- Appearance -->
    <div class="section">
      <h3>Appearance</h3>
      <div class="setting-row">
        <span>Theme</span>
        <button class="btn btn-secondary" @click="toggleTheme">
          {{ theme === 'dark' ? 'Switch to Light' : 'Switch to Dark' }}
        </button>
      </div>
      <div class="setting-row">
        <span>Snow Overlay</span>
        <button class="btn btn-secondary" @click="toggleSnow">
          {{ snowEnabled ? 'Disable Snow' : 'Enable Snow' }}
        </button>
      </div>
    </div>

    <!-- Log Level -->
    <div class="section">
      <h3>Logging</h3>
      <div class="setting-row">
        <span>Log Level</span>
        <select :value="logLevel" class="input" @change="(e: Event) => updateLogLevel((e.target as HTMLSelectElement).value)">
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>
    </div>

    <!-- Debug & Diagnostics -->
    <div class="section">
      <h3>Diagnostics</h3>
      <div class="btn-row">
        <button class="btn btn-secondary" @click="loadDebugStats">Load Debug Stats</button>
        <button class="btn btn-secondary" @click="loadMemoryStats">Load Memory Stats</button>
        <button class="btn btn-warning" @click="forceMemoryCleanup">Force Memory Cleanup</button>
        <button class="btn btn-danger" @click="clearDebugLogs">Clear Debug Logs</button>
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

    <!-- Info -->
    <div class="section info-section">
      <div class="info-row">
        <span>Client Version</span>
        <span class="mono">{{ clientVersion || 'Unknown' }}</span>
      </div>
      <div class="info-row">
        <span>Runtime</span>
        <span class="runtime-timer">{{ runtimeDisplay }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section { margin-bottom: 20px; }
.section h3 { margin: 0 0 10px; font-size: 1rem; color: #e0e0f0; }
.server-buttons { display: flex; gap: 8px; margin-bottom: 10px; }
.server-url-display { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 0.85rem; }
.server-url-display .label { color: #888; }
.mono { font-family: monospace; font-size: 0.85rem; color: #88c0d0; }
.form-row { display: flex; gap: 8px; margin-bottom: 8px; }
.form-row .input { flex: 1; }
.input {
  padding: 8px 12px; border-radius: 4px; border: 1px solid #555;
  background: #2a2a3e; color: #fff; font-size: 0.9rem;
}
.setting-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #333; }
.btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.stats-box { background: #2a2a3e; padding: 12px; border-radius: 6px; margin-bottom: 10px; }
.stats-box h4 { margin: 0 0 6px; font-size: 0.9rem; color: #a0a0b8; }
.stats-box pre { margin: 0; font-size: 0.8rem; color: #bdc3c7; white-space: pre-wrap; word-break: break-all; }
.info-section { background: #2a2a3e; padding: 12px; border-radius: 6px; }
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; }
</style>
