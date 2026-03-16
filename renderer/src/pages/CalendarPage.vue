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
  <div class="page-view">
    <div class="header">
      <h1>Calendar</h1>
      <p>View VRChat events and schedules</p>
    </div>
    <div class="card">
      <h3>Calendar Status</h3>
      <div class="status-panel">
        <div class="status-row">
          <span class="status-label">Status</span>
          <span class="status-value">Available</span>
        </div>
        <div v-if="lastFetch" class="status-row">
          <span class="status-label">Last Fetch</span>
          <span class="status-value">{{ lastFetch }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">Events</span>
          <span class="status-value">{{ events.length }}</span>
        </div>
      </div>
      <button class="btn btn-primary" :disabled="loading" @click="fetchEvents">
        {{ loading ? 'Fetching...' : 'Fetch Events' }}
      </button>
      <p v-if="error" class="error-text">{{ error }}</p>
    </div>

    <div class="card">
      <h3>Events</h3>
      <div v-if="events.length > 0" class="event-list">
        <div v-for="(event, i) in events" :key="i" class="event-item">{{ event }}</div>
      </div>
      <p v-else class="placeholder-text">No events available yet.</p>
    </div>
  </div>
 </template>

<style scoped>
.event-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.event-item {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 0.6rem 1rem;
}

.error-text {
  color: #e74c3c;
  margin-top: 12px;
}

.placeholder-text {
  color: #666;
  text-align: center;
  padding: 20px;
}

:global(body.dark-theme) .event-item {
  background: #2b2b2b;
}

:global(body.dark-theme) .placeholder-text {
  color: #bdc3c7;
}
</style>
