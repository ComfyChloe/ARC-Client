<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useElectronAPI } from '../composables/useElectronAPI'
const api = useElectronAPI()
const enabled = ref(false)
const connected = ref(false)
const connectionCount = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
async function loadStatus() {
  if (!api) return
  const status = await api.arcLinkGetStatus()
  enabled.value = status.enabled
  connected.value = status.connected
  connectionCount.value = status.connectionCount
}
async function toggleService() {
  if (!api) return
  loading.value = true
  error.value = null
  if (enabled.value) {
    await api.arcLinkStop()
  } else {
    const result = await api.arcLinkStart()
    if (!result.success) {
      error.value = result.error ?? 'Failed to start'
    }
  }
  loading.value = false
  await loadStatus()
}
onMounted(loadStatus)
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>ARC Link</h1>
      <p>Connect friends' avatar parameters together</p>
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
          <span class="status-label">Connections</span>
          <span class="status-value">{{ connectionCount }}</span>
        </div>
      </div>
      <button class="btn" :class="enabled ? 'btn-danger' : 'btn-primary'" :disabled="loading" @click="toggleService">
        {{ loading ? 'Working...' : enabled ? 'Stop' : 'Start' }}
      </button>
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="enabled && connectionCount === 0" class="placeholder-text">No active connections.</p>
    </div>
  </div>
</template>
