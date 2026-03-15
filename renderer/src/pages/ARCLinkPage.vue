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
  <div class="page">
    <h2>ARC Link</h2>
    <p class="page-description">Connect friends' avatar parameters together.</p>
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
        <span class="status-label">Connections</span>
        <span class="status-value">{{ connectionCount }}</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn" :class="{ 'btn-danger': enabled }" :disabled="loading" @click="toggleService">
        {{ loading ? 'Working...' : enabled ? 'Stop' : 'Start' }}
      </button>
    </div>
    <p class="error-text" v-if="error">{{ error }}</p>
    <div class="connections-placeholder" v-if="enabled && connectionCount === 0">
      <p class="placeholder-text">No active connections.</p>
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
