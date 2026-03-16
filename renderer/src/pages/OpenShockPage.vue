<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useElectronAPI } from '../composables/useElectronAPI'
const api = useElectronAPI()
const apiKey = ref('')
const enabled = ref(false)
const connected = ref(false)
const hasApiKey = ref(false)
const deviceCount = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
async function loadStatus() {
  if (!api) return
  const status = await api.openShockGetStatus()
  enabled.value = status.enabled
  connected.value = status.connected
  hasApiKey.value = status.hasApiKey
  deviceCount.value = status.deviceCount
}
async function startService() {
  if (!api || !apiKey.value.trim()) return
  loading.value = true
  error.value = null
  const result = await api.openShockStart(apiKey.value.trim())
  loading.value = false
  if (!result.success) {
    error.value = result.error ?? 'Failed to start'
  }
  await loadStatus()
}
async function stopService() {
  if (!api) return
  loading.value = true
  error.value = null
  await api.openShockStop()
  loading.value = false
  await loadStatus()
}
onMounted(loadStatus)
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>OpenShock Integration</h1>
      <p>OpenShock device integration</p>
    </div>

    <div class="card">
      <h3>Connection Status</h3>
      <div class="status-panel">
        <div class="status-row">
          <span class="status-label">Enabled</span>
          <span class="status-value" :class="enabled ? '' : 'disabled'">{{ enabled ? 'Enabled' : 'Disabled' }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Connected</span>
          <span class="status-value" :class="connected ? '' : 'disabled'">{{ connected ? 'Connected' : 'Disconnected' }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Has API Key</span>
          <span class="status-value" :class="hasApiKey ? '' : 'disabled'">{{ hasApiKey ? 'Yes' : 'No' }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Devices</span>
          <span class="status-value">{{ deviceCount }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>API Configuration</h3>
      <div class="form-group">
        <label for="openshock-key">API Key</label>
        <input id="openshock-key" v-model="apiKey" type="password" placeholder="Enter OpenShock API key" :disabled="enabled" />
      </div>
      <button v-if="!enabled" class="btn btn-primary" :disabled="loading || !apiKey.trim()" @click="startService">
        {{ loading ? 'Connecting...' : 'Connect' }}
      </button>
      <button v-else class="btn btn-danger" :disabled="loading" @click="stopService">
        {{ loading ? 'Stopping...' : 'Disconnect' }}
      </button>
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="enabled && deviceCount === 0" class="placeholder-text">No devices found.</p>
    </div>
  </div>
</template>
