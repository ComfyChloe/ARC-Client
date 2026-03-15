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
  <div class="page">
    <h2>OpenShock</h2>
    <p class="page-description">OpenShock device integration.</p>
    <div class="status-card">
      <div class="status-row">
        <span class="status-label">Enabled</span>
        <span class="status-dot" :class="enabled ? 'dot-green' : 'dot-gray'"></span>
      </div>
      <div class="status-row">
        <span class="status-label">Connected</span>
        <span class="status-dot" :class="connected ? 'dot-green' : 'dot-gray'"></span>
      </div>
      <div class="status-row">
        <span class="status-label">Devices</span>
        <span class="status-value">{{ deviceCount }}</span>
      </div>
    </div>
    <div class="api-key-form">
      <label class="input-label" for="openshock-key">API Key</label>
      <input
        id="openshock-key"
        v-model="apiKey"
        type="password"
        class="input-field"
        placeholder="Enter OpenShock API key"
        :disabled="enabled"
      />
    </div>
    <div class="actions">
      <button v-if="!enabled" class="btn" :disabled="loading || !apiKey.trim()" @click="startService">
        {{ loading ? 'Connecting...' : 'Connect' }}
      </button>
      <button v-else class="btn btn-danger" :disabled="loading" @click="stopService">
        {{ loading ? 'Stopping...' : 'Disconnect' }}
      </button>
    </div>
    <p class="error-text" v-if="error">{{ error }}</p>
    <div class="device-list-placeholder" v-if="enabled && deviceCount === 0">
      <p class="placeholder-text">No devices found.</p>
    </div>
  </div>
</template>

<style scoped>
.page-description {
  color: var(--text-secondary, #999);
  margin-bottom: 1rem;
}
.status-card {
  background: var(--bg-card, #1e1e2e);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0;
}
.status-label {
  color: var(--text-secondary, #999);
}
.status-value {
  color: var(--text-primary, #fff);
}
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot-green {
  background: var(--success, #40c040);
}
.dot-gray {
  background: var(--text-secondary, #555);
}
.api-key-form {
  margin-bottom: 1rem;
}
.input-label {
  display: block;
  color: var(--text-secondary, #999);
  margin-bottom: 0.3rem;
  font-size: 0.85rem;
}
.input-field {
  width: 100%;
  padding: 0.5rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--border, #333);
  background: var(--bg-input, #181825);
  color: var(--text-primary, #fff);
  font-size: 0.9rem;
  box-sizing: border-box;
}
.input-field:disabled {
  opacity: 0.5;
}
.actions {
  margin-bottom: 1rem;
}
.btn {
  background: var(--accent, #5865f2);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1.2rem;
  cursor: pointer;
  font-size: 0.9rem;
}
.btn:hover {
  opacity: 0.9;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-danger {
  background: var(--danger, #f04040);
}
.error-text {
  color: var(--danger, #f04040);
  margin-bottom: 1rem;
}
.placeholder-text {
  color: var(--text-secondary, #999);
  font-style: italic;
}
</style>
