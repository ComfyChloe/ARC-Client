<script setup lang="ts">
import { ref, computed } from 'vue'
import { useHyperate } from '../composables/useHyperate'
const {
  status, trackers, autostart, heartRate,
  toggle, toggleAutostart,
  addTracker, removeTracker, setPrimary,
  updateTrackerName, updateTrackerState
} = useHyperate()
const newDeviceId = ref('')
const newDeviceName = ref('')
const editingTracker = ref<string | null>(null)
const editName = ref('')
const statusLabel = computed(() => {
  const s = status.value
  if (s.stopping) return 'Stopping...'
  if (s.reconnecting) return `Reconnecting (${s.reconnectAttempts}/${s.maxReconnectAttempts})`
  if (s.connected) return 'Connected'
  if (s.enabled) return 'Connecting...'
  if (!s.hasApiKey) return 'No API Key'
  return 'Stopped'
})
const statusClass = computed(() => {
  const s = status.value
  if (s.connected) return 'status-ok'
  if (s.enabled || s.reconnecting) return 'status-warn'
  return 'status-off'
})
async function handleAddTracker() {
  const id = newDeviceId.value.trim()
  if (!id) return
  await addTracker(id, newDeviceName.value.trim() || undefined)
  newDeviceId.value = ''
  newDeviceName.value = ''
}
function startEdit(deviceId: string, currentName: string) {
  editingTracker.value = deviceId
  editName.value = currentName
}
async function saveEdit(deviceId: string) {
  await updateTrackerName(deviceId, editName.value.trim())
  editingTracker.value = null
}
function cancelEdit() {
  editingTracker.value = null
}
</script>

<template>
  <div class="page">
    <h2>HypeRate</h2>
    <p class="page-desc">Heart rate monitor integration via HypeRate.</p>
    <!-- Status Card -->
    <div class="status-card">
      <div class="status-row">
        <span class="status-label">Status</span>
        <span class="status-value" :class="statusClass">{{ statusLabel }}</span>
      </div>
      <div class="status-row" v-if="heartRate > 0">
        <span class="status-label">Heart Rate</span>
        <span class="heart-rate">
          <span class="heart-icon" :class="{ pulse: status.connected }">&#10084;</span>
          {{ heartRate }} BPM
        </span>
      </div>
      <div class="status-row" v-if="status.lastError">
        <span class="status-label">Error</span>
        <span class="status-value error-text">{{ status.lastError }}</span>
      </div>
    </div>
    <!-- Actions -->
    <div class="actions-row">
      <button class="btn" :class="{ 'btn-danger': status.enabled }" :disabled="status.stopping" @click="toggle">
        {{ status.enabled ? 'Stop' : 'Start' }}
      </button>
      <label class="toggle-label">
        <input type="checkbox" :checked="autostart" @change="toggleAutostart" />
        Autostart
      </label>
    </div>
    <!-- Trackers List -->
    <div class="section">
      <h3>Trackers ({{ trackers.length }})</h3>
      <div v-if="trackers.length === 0" class="empty-state">No trackers added yet.</div>
      <div class="tracker-list">
        <div v-for="t in trackers" :key="t.deviceId" class="tracker-card" :class="{ primary: t.isPrimary }">
          <div class="tracker-header">
            <span v-if="t.isPrimary" class="badge primary-badge">PRIMARY</span>
            <span class="tracker-status-dot" :class="{ active: t.enabled }"></span>
            <template v-if="editingTracker === t.deviceId">
              <input class="edit-input" v-model="editName" @keyup.enter="saveEdit(t.deviceId)" @keyup.escape="cancelEdit" />
              <button class="btn btn-small" @click="saveEdit(t.deviceId)">Save</button>
              <button class="btn btn-small btn-secondary" @click="cancelEdit">Cancel</button>
            </template>
            <template v-else>
              <span class="tracker-name">{{ t.name || t.deviceId }}</span>
              <span class="tracker-id" v-if="t.name">{{ t.deviceId }}</span>
            </template>
          </div>
          <div class="tracker-details">
            <span v-if="t.heartRate">&#10084; {{ t.heartRate }} BPM</span>
            <span v-if="t.lastUpdate" class="tracker-updated">{{ t.lastUpdate }}</span>
          </div>
          <div class="tracker-actions">
            <button class="btn btn-small" @click="startEdit(t.deviceId, t.name)" title="Rename">Rename</button>
            <button class="btn btn-small" v-if="!t.isPrimary" @click="setPrimary(t.deviceId)" title="Set Primary">Set Primary</button>
            <button class="btn btn-small" @click="updateTrackerState(t.deviceId, !t.enabled)">{{ t.enabled ? 'Disable' : 'Enable' }}</button>
            <button class="btn btn-small btn-danger" @click="removeTracker(t.deviceId)" title="Remove">Remove</button>
          </div>
        </div>
      </div>
    </div>
    <!-- Add Tracker -->
    <div class="section">
      <h3>Add Tracker</h3>
      <div class="add-form">
        <input class="input" v-model="newDeviceId" placeholder="Device ID" @keyup.enter="handleAddTracker" />
        <input class="input" v-model="newDeviceName" placeholder="Name (optional)" @keyup.enter="handleAddTracker" />
        <button class="btn" :disabled="!newDeviceId.trim()" @click="handleAddTracker">Add</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-desc {
  color: #999;
  margin-bottom: 1rem;
}
.status-card {
  background: #1e1e2e;
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
  color: #999;
}
.status-value {
  color: #fff;
}
.status-ok {
  color: #4caf50;
}
.status-warn {
  color: #f0c040;
}
.status-off {
  color: #999;
}
.error-text {
  color: #f04040;
}
.heart-rate {
  color: #e94560;
  font-weight: bold;
  font-size: 1.1rem;
}
.heart-icon {
  display: inline-block;
}
.heart-icon.pulse {
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}
.actions-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #ccc;
  cursor: pointer;
  font-size: 0.9rem;
}
.section {
  margin-bottom: 1.5rem;
}
.section h3 {
  margin: 0 0 0.8rem;
  font-size: 1rem;
  color: #ccc;
}
.empty-state {
  color: #666;
  font-style: italic;
  padding: 1rem 0;
}
.tracker-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tracker-card {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 0.8rem 1rem;
  border-left: 3px solid #555;
}
.tracker-card.primary {
  border-left-color: #e94560;
}
.tracker-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}
.tracker-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
}
.tracker-status-dot.active {
  background: #4caf50;
}
.tracker-name {
  font-weight: 600;
  color: #fff;
}
.tracker-id {
  color: #666;
  font-size: 0.8rem;
}
.badge {
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
  text-transform: uppercase;
}
.primary-badge {
  background: #e94560;
  color: #fff;
}
.tracker-details {
  color: #999;
  font-size: 0.85rem;
  display: flex;
  gap: 1rem;
  margin-bottom: 0.4rem;
}
.tracker-updated {
  color: #666;
}
.tracker-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.add-form {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.input {
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 0.45rem 0.7rem;
  color: #fff;
  font-size: 0.9rem;
}
.input:focus {
  outline: none;
  border-color: #5865f2;
}
.edit-input {
  background: #2a2a3e;
  border: 1px solid #5865f2;
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  color: #fff;
  font-size: 0.85rem;
}
.btn {
  background: #5865f2;
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
.btn-small {
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
}
.btn-danger {
  background: #e74c3c;
}
.btn-secondary {
  background: #555;
}
</style>
