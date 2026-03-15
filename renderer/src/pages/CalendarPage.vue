<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useElectronAPI } from '../composables/useElectronAPI'
const api = useElectronAPI()
const loading = ref(false)
const events = ref<any[]>([])
const lastFetch = ref<string | null>(null)
const error = ref<string | null>(null)
async function loadStatus() {
  if (!api) return
  const status = await api.calendarGetStatus()
  events.value = status.events ?? []
  lastFetch.value = status.lastFetch
}
async function fetchEvents() {
  if (!api) return
  loading.value = true
  error.value = null
  const result = await api.calendarFetch()
  loading.value = false
  if (!result.success) {
    error.value = result.error ?? 'Unknown error'
  } else {
    events.value = result.events ?? []
  }
  await loadStatus()
}
onMounted(loadStatus)
</script>

<template>
  <div class="page">
    <h2>Calendar</h2>
    <p class="page-description">VRChat events and schedules.</p>
    <div class="status-card">
      <div class="status-row">
        <span class="status-label">Status</span>
        <span class="status-value coming-soon">Coming Soon</span>
      </div>
      <div class="status-row" v-if="lastFetch">
        <span class="status-label">Last Fetch</span>
        <span class="status-value">{{ lastFetch }}</span>
      </div>
      <div class="status-row">
        <span class="status-label">Events</span>
        <span class="status-value">{{ events.length }}</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn" :disabled="loading" @click="fetchEvents">
        {{ loading ? 'Fetching...' : 'Fetch Events' }}
      </button>
    </div>
    <p class="error-text" v-if="error">{{ error }}</p>
    <div class="event-list" v-if="events.length > 0">
      <div class="event-item" v-for="(event, i) in events" :key="i">
        {{ event }}
      </div>
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
  padding: 0.4rem 0;
}
.status-label {
  color: var(--text-secondary, #999);
}
.status-value {
  color: var(--text-primary, #fff);
}
.coming-soon {
  color: var(--warning, #f0c040);
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
.error-text {
  color: var(--danger, #f04040);
  margin-bottom: 1rem;
}
.event-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.event-item {
  background: var(--bg-card, #1e1e2e);
  border-radius: 6px;
  padding: 0.6rem 1rem;
}
</style>
