<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHyperate, type HyperateTracker } from '../composables/useHyperate'

const {
  status,
  trackers,
  autostart,
  heartRate,
  toggle,
  toggleAutostart,
  addTracker,
  removeTracker,
  setPrimary,
  updateTrackerName
} = useHyperate()

const newDeviceId = ref('')
const newDeviceName = ref('')
const editingTrackerId = ref<string | null>(null)
const editName = ref('')

const primaryTracker = computed(() => trackers.value.find((tracker) => tracker.isPrimary) ?? null)

const statusClass = computed(() => {
  const currentStatus = status.value
  if (!currentStatus.hasApiKey) return 'status-error'
  if (currentStatus.enabled && currentStatus.connected) return 'status-connected'
  if (currentStatus.stopping) return 'status-stopping'
  if (currentStatus.enabled && (currentStatus.reconnecting || currentStatus.lastError)) return 'status-error'
  if (currentStatus.enabled) return 'status-connecting'
  return 'status-disconnected'
})

const statusText = computed(() => {
  const currentStatus = status.value
  if (!currentStatus.hasApiKey) return 'No API Key - Check secrets.json'
  if (currentStatus.enabled && currentStatus.connected) return 'Connected and Active'
  if (currentStatus.stopping) return 'Stopping...'
  if (currentStatus.enabled && currentStatus.reconnecting) {
    let message = `Reconnecting (${currentStatus.reconnectAttempts}/${currentStatus.maxReconnectAttempts})...`
    if (currentStatus.lastError) {
      message += ` - ${currentStatus.lastError}`
    }
    return message
  }
  if (currentStatus.enabled && currentStatus.lastError) return `Error: ${currentStatus.lastError}`
  if (currentStatus.enabled) return 'Connecting...'
  return 'Stopped'
})

const toggleButtonLabel = computed(() => {
  const currentStatus = status.value
  if (!currentStatus.hasApiKey) return 'Missing API Key'
  if (currentStatus.stopping) return 'Stopping...'
  if (currentStatus.enabled) return 'Stop HypeRate'
  return 'Start HypeRate'
})

const toggleButtonDisabled = computed(() => !status.value.hasApiKey || status.value.stopping)

const currentHeartRate = computed(() => {
  if (status.value.enabled && heartRate.value > 0) return String(heartRate.value)
  if (status.value.enabled && primaryTracker.value && primaryTracker.value.lastHeartRate > 0) {
    return String(primaryTracker.value.lastHeartRate)
  }
  return '--'
})

const primaryTrackerLabel = computed(() => {
  if (!primaryTracker.value) return 'No primary tracker set'
  return `Primary: ${primaryTracker.value.name || primaryTracker.value.deviceId}`
})

async function handleAddTracker() {
  const deviceId = newDeviceId.value.trim()
  if (!deviceId) {
    return
  }
  await addTracker(deviceId, newDeviceName.value.trim() || undefined)
  newDeviceId.value = ''
  newDeviceName.value = ''
}

function openEditModal(tracker: HyperateTracker) {
  editingTrackerId.value = tracker.deviceId
  editName.value = tracker.name || ''
}

function closeEditModal() {
  editingTrackerId.value = null
  editName.value = ''
}

async function saveEdit() {
  if (!editingTrackerId.value) {
    return
  }
  await updateTrackerName(editingTrackerId.value, editName.value.trim())
  closeEditModal()
}

function formatLastUpdate(tracker: HyperateTracker) {
  return tracker.lastUpdate ? new Date(tracker.lastUpdate).toLocaleTimeString() : 'Never'
}
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>HypeRate Integration</h1>
      <p>Monitor heart rate from HypeRate devices and send to VRChat</p>
    </div>

    <div class="card">
      <h3>Connection Status</h3>
      <div class="connection-status">
        <span id="hyperate-status" class="status-indicator" :class="statusClass"></span>
        <span id="hyperate-status-text">{{ statusText }}</span>
      </div>
      <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
        <button id="hyperate-toggle-btn" class="btn btn-primary" :disabled="toggleButtonDisabled" @click="toggle">{{ toggleButtonLabel }}</button>
        <div class="autostart-toggle-container">
          <span style="font-size: 13px; font-weight: 600; opacity: 0.8;">Auto-start:</span>
          <div id="hyperate-autostart-toggle" class="autostart-toggle-slider" role="button" tabindex="0" @click="toggleAutostart" @keyup.enter="toggleAutostart" @keyup.space.prevent="toggleAutostart">
            <div id="hyperate-autostart-disabled" class="autostart-toggle-option disabled" :class="{ active: !autostart }">Disabled</div>
            <div id="hyperate-autostart-enabled" class="autostart-toggle-option enabled" :class="{ active: autostart }">Enabled</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Current Heart Rate</h3>
      <div style="text-align: center; padding: 20px;">
        <div id="current-heartrate" style="font-size: 48px; font-weight: bold; color: #e74c3c;" :class="{ 'heart-rate-active': currentHeartRate !== '--' }">{{ currentHeartRate }}</div>
        <div style="font-size: 14px; color: #666; margin-top: 5px;">BPM</div>
        <div id="primary-tracker-info" style="font-size: 12px; color: #999; margin-top: 10px;">{{ primaryTrackerLabel }}</div>
        <div style="font-size: 12px; color: #999; margin-top: 5px;">
          OSC Parameter: <code>/avatar/parameters/ARCOSC/Heartrate/Value</code>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Heart Rate Graph</h3>
      <div style="padding: 20px;">
        <div style="text-align: center; color: #666; padding: 40px 20px;">
          <p style="font-size: 16px; margin-bottom: 10px;">&#128202; Graph Visualization</p>
          <p style="font-size: 12px; opacity: 0.7;">Heart rate graph will be displayed here</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Device Management</h3>
      <div class="form-group">
        <label for="device-id-input">Device ID:</label>
        <div style="display: flex; gap: 10px; margin-top: 5px;" class="hyperate-device-row">
          <input id="device-id-input" v-model="newDeviceId" type="text" placeholder="Enter device ID" style="flex: 1;" @keyup.enter="handleAddTracker" />
          <input id="device-name-input" v-model="newDeviceName" type="text" placeholder="Device name (optional)" style="flex: 1;" @keyup.enter="handleAddTracker" />
          <button class="btn btn-primary" @click="handleAddTracker">Add Tracker</button>
        </div>
        <div style="font-size: 12px; color: #666; margin-top: 5px;">
          Get your device ID from the HypeRate app or use "internal-testing" for testing
        </div>
      </div>

      <div style="margin-top: 20px;">
        <h4>Saved Trackers</h4>
        <div id="hyperate-trackers-list">
          <p v-if="trackers.length === 0" class="hyperate-empty-state">No trackers added yet</p>
          <div
            v-for="tracker in trackers"
            v-else
            :key="tracker.deviceId"
            class="tracker-item"
            :class="{ 'tracker-item-primary': tracker.isPrimary }"
            :style="{
              border: `1px solid ${tracker.isPrimary ? '#2ecc71' : '#ddd'}`,
              borderRadius: '4px',
              padding: '10px',
              marginBottom: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: tracker.isPrimary ? '#f8fff8' : 'white'
            }"
          >
            <div class="hyperate-tracker-copy">
              <strong>{{ tracker.name || tracker.deviceId }}</strong>
              <span v-if="tracker.isPrimary" style="background: #2ecc71; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 5px;">PRIMARY</span>
              <br />
              <small class="hyperate-tracker-meta">ID: {{ tracker.deviceId }}</small>
              <br />
              <small class="hyperate-tracker-meta">
                Status:
                <span class="hyperate-status-value" :class="tracker.isActive ? 'hyperate-status-active' : 'hyperate-status-inactive'">{{ tracker.isActive ? 'Active' : 'Inactive' }}</span>
                | HR: {{ tracker.lastHeartRate || '--' }} BPM
                | Last Update: {{ formatLastUpdate(tracker) }}
              </small>
            </div>
            <div class="hyperate-tracker-actions">
              <button v-if="!tracker.isPrimary" class="btn btn-secondary btn-small" style="margin-right: 5px;" @click="setPrimary(tracker.deviceId)">Set Primary</button>
              <button class="btn btn-secondary btn-small" style="margin-right: 5px;" @click="openEditModal(tracker)">Edit</button>
              <button class="btn btn-danger btn-small" @click="removeTracker(tracker.deviceId)">Remove</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="editingTrackerId" class="modal-overlay" @click.self="closeEditModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="hyperate-modal-title">Edit HypeRate Tracker</h3>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="edit-tracker-name">Tracker Name:</label>
            <input id="edit-tracker-name" v-model="editName" type="text" placeholder="Enter custom name (optional)" @keyup.enter="saveEdit" @keyup.escape="closeEditModal" />
            <small class="hyperate-modal-help">Leave empty to use device ID as display name</small>
          </div>
          <div class="form-group hyperate-modal-field">
            <label for="edit-tracker-id">Device ID:</label>
            <input id="edit-tracker-id" :value="editingTrackerId" class="hyperate-readonly-input" type="text" readonly />
            <small class="hyperate-modal-help">Device ID cannot be changed</small>
          </div>
        </div>
        <div class="modal-footer hyperate-modal-footer">
          <button class="btn btn-secondary" @click="closeEditModal">Cancel</button>
          <button class="btn btn-primary" @click="saveEdit">Save Changes</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tracker-item {
  background: #f8f9fa;
  transition: background-color 0.3s ease;
}

.btn-small {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 3px;
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.05);
    color: #e74c3c;
  }

  100% {
    transform: scale(1);
  }
}

#current-heartrate {
  transition: all 0.3s ease;
}

.heart-rate-active {
  animation: pulse 1s ease-in-out;
}

.status-indicator.status-error {
  background-color: #e74c3c !important;
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% {
    opacity: 1;
  }

  51%, 100% {
    opacity: 0.5;
  }
}

#device-id-input {
  font-family: 'Courier New', monospace;
}

.hyperate-tracker-actions {
  display: flex;
  align-items: center;
}

.hyperate-tracker-copy {
  min-width: 0;
}

.hyperate-tracker-meta {
  color: #666;
}

.hyperate-status-active {
  color: #2ecc71;
}

.hyperate-status-inactive {
  color: #95a5a6;
}

.hyperate-empty-state {
  color: #666;
  text-align: center;
  padding: 10px;
}

.hyperate-modal-title {
  color: #2c3e50;
  margin: 0;
}

.hyperate-modal-help {
  color: #666;
}

.hyperate-modal-field {
  margin-top: 15px;
}

.hyperate-readonly-input {
  background-color: #f5f5f5;
}

.hyperate-modal-footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .hyperate-device-row,
  .tracker-item {
    flex-direction: column;
    align-items: stretch !important;
  }

  .hyperate-tracker-actions {
    margin-top: 10px;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 6px;
  }
}

:global(body.dark-theme) .tracker-item {
  background: #34495e;
  border-color: #2c3e50 !important;
}

:global(body.dark-theme) .tracker-item.tracker-item-primary {
  background: #2d4a2d !important;
  border-color: #27ae60 !important;
}

:global(body.dark-theme) .hyperate-modal-title {
  color: #ecf0f1;
}

:global(body.dark-theme) .hyperate-modal-help {
  color: #95a5a6;
}

:global(body.dark-theme) .hyperate-tracker-meta,
:global(body.dark-theme) .hyperate-empty-state {
  color: #bdc3c7;
}

:global(body.dark-theme) .hyperate-status-inactive {
  color: #95a5a6;
}

:global(body.dark-theme) .hyperate-readonly-input {
  background-color: #1e2329;
  color: #7f8c8d;
  border-color: #34495e;
}

:global(body.dark-theme) pre {
  background: #2c3e50 !important;
  color: #ecf0f1 !important;
}
</style>