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
  updateTrackerName,
  updateTrackerState
} = useHyperate()

const newDeviceId = ref('')
const newDeviceName = ref('')
const editingTrackerId = ref<string | null>(null)
const editName = ref('')

const primaryTracker = computed(() => trackers.value.find((tracker) => tracker.isPrimary) ?? null)

const statusLabel = computed(() => {
  const currentStatus = status.value
  if (currentStatus.stopping) return 'Stopping...'
  if (currentStatus.reconnecting) return `Reconnecting (${currentStatus.reconnectAttempts}/${currentStatus.maxReconnectAttempts})`
  if (currentStatus.connected && currentStatus.enabled) return 'Connected and Active'
  if (currentStatus.enabled) return 'Connecting...'
  if (!currentStatus.hasApiKey) return 'No API Key'
  if (currentStatus.lastError) return 'Connection Error'
  return 'Disconnected'
})

const statusIndicatorClass = computed(() => {
  const currentStatus = status.value
  if (currentStatus.lastError) return 'status-error'
  if (currentStatus.connected) return 'status-connected'
  if (currentStatus.enabled || currentStatus.reconnecting || currentStatus.stopping) return 'status-pending'
  return 'status-disconnected'
})

const currentHeartRate = computed(() => {
  if (heartRate.value > 0) return String(heartRate.value)
  if (primaryTracker.value && primaryTracker.value.heartRate > 0) return String(primaryTracker.value.heartRate)
  return '--'
})

const primaryTrackerLabel = computed(() => {
  if (!primaryTracker.value) return 'No primary tracker set'
  return `Primary: ${primaryTracker.value.name || primaryTracker.value.deviceId}`
})

async function handleAddTracker() {
  const deviceId = newDeviceId.value.trim()
  if (!deviceId) return
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
  if (!editingTrackerId.value) return
  await updateTrackerName(editingTrackerId.value, editName.value.trim())
  closeEditModal()
}

function trackerStatusSummary(tracker: HyperateTracker) {
  const parts = [`Status: ${tracker.enabled ? 'Active' : 'Disabled'}`]
  if (tracker.heartRate > 0) {
    parts.push(`HR: ${tracker.heartRate} BPM`)
  }
  if (tracker.lastUpdate) {
    parts.push(`Last Update: ${tracker.lastUpdate}`)
  }
  return parts.join(' | ')
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
        <span class="status-indicator" :class="statusIndicatorClass"></span>
        <span>{{ statusLabel }}</span>
      </div>
      <div class="hyperate-status-actions">
        <button class="btn" :class="status.enabled ? 'btn-danger' : 'btn-primary'" :disabled="status.stopping" @click="toggle">
          {{ status.enabled ? 'Stop HypeRate' : 'Start HypeRate' }}
        </button>
        <div class="autostart-toggle-container">
          <span class="hyperate-autostart-label">Auto-start:</span>
          <div class="autostart-toggle-slider" role="button" tabindex="0" @click="toggleAutostart" @keyup.enter="toggleAutostart" @keyup.space.prevent="toggleAutostart">
            <div class="autostart-toggle-option disabled" :class="{ active: !autostart }">Disabled</div>
            <div class="autostart-toggle-option enabled" :class="{ active: autostart }">Enabled</div>
          </div>
        </div>
      </div>
      <p v-if="status.lastError" class="hyperate-error">{{ status.lastError }}</p>
    </div>
    <div class="card">
      <h3>Current Heart Rate</h3>
      <div class="hyperate-heart-rate-panel">
        <div id="current-heartrate" class="hyperate-heart-rate-value">{{ currentHeartRate }}</div>
        <div class="hyperate-heart-rate-unit">BPM</div>
        <div id="primary-tracker-info" class="hyperate-primary-info">{{ primaryTrackerLabel }}</div>
        <div class="hyperate-osc-parameter">
          OSC Parameter:
          <code>/avatar/parameters/ARCOSC/Heartrate/Value</code>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Heart Rate Graph</h3>
      <div class="hyperate-graph-panel">
        <p class="hyperate-graph-title">Graph Visualization</p>
        <p class="hyperate-graph-subtitle">Heart rate graph will be displayed here</p>
      </div>
    </div>
    <div class="card">
      <h3>Device Management</h3>
      <div class="form-group">
        <label for="device-id-input">Device ID:</label>
        <div class="hyperate-device-row">
          <input id="device-id-input" v-model="newDeviceId" type="text" placeholder="Enter device ID" @keyup.enter="handleAddTracker" />
          <input id="device-name-input" v-model="newDeviceName" type="text" placeholder="Device name (optional)" @keyup.enter="handleAddTracker" />
          <button class="btn btn-primary" :disabled="!newDeviceId.trim()" @click="handleAddTracker">Add Tracker</button>
        </div>
        <div class="hyperate-helper-text">
          Get your device ID from the HypeRate app or use "internal-testing" for testing
        </div>
      </div>
      <div class="hyperate-saved-trackers">
        <h4>Saved Trackers</h4>
        <div v-if="trackers.length === 0" id="hyperate-trackers-list">
          <p class="hyperate-empty-trackers">No trackers saved yet</p>
        </div>
        <div v-else id="hyperate-trackers-list">
          <div
            v-for="tracker in trackers"
            :key="tracker.deviceId"
            class="tracker-item"
            :class="{
              'tracker-item-enabled': tracker.enabled,
              'tracker-item-primary': tracker.isPrimary,
              'tracker-item-primary-disabled': tracker.isPrimary && !tracker.enabled
            }"
          >
            <div class="hyperate-tracker-row">
              <div class="hyperate-tracker-copy">
                <div class="hyperate-tracker-name-row">
                  <span class="status-indicator" :class="tracker.enabled ? 'status-connected' : 'status-disconnected'"></span>
                  <strong>{{ tracker.name || tracker.deviceId }}</strong>
                  <span v-if="tracker.isPrimary" class="hyperate-primary-badge">PRIMARY</span>
                </div>
                <div class="hyperate-tracker-id">ID: {{ tracker.deviceId }}</div>
                <div class="hyperate-tracker-status">{{ trackerStatusSummary(tracker) }}</div>
              </div>
              <div class="hyperate-tracker-actions">
                <button v-if="!tracker.enabled" class="btn btn-success btn-small" @click="updateTrackerState(tracker.deviceId, true)">Enable</button>
                <button v-if="tracker.enabled && !tracker.isPrimary" class="btn btn-primary btn-small" @click="setPrimary(tracker.deviceId)">Set Primary</button>
                <button class="btn btn-secondary btn-small" @click="openEditModal(tracker)">Edit</button>
                <button class="btn btn-danger btn-small" @click="removeTracker(tracker.deviceId)">Remove</button>
              </div>
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
.hyperate-error {
  margin: 15px 0 0;
  color: #c0392b;
}
.hyperate-status-actions {
  margin-top: 10px;
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  align-items: center;
}
.hyperate-autostart-label {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.8;
}

.autostart-toggle-container {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.autostart-toggle-slider {
  display: inline-flex;
  background: #ecf0f1;
  border-radius: 6px;
  padding: 3px;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 2px solid #bdc3c7;
  user-select: none;
}

.autostart-toggle-slider:hover {
  border-color: #3498db;
}

.autostart-toggle-option {
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.3s ease;
  color: #7f8c8d;
  background: transparent;
}

.autostart-toggle-option.active {
  background: #3498db;
  color: white;
  box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);
}

.autostart-toggle-option.active.enabled {
  background: #27ae60;
  box-shadow: 0 2px 4px rgba(39, 174, 96, 0.3);
}

.autostart-toggle-option.active.disabled {
  background: #95a5a6;
  box-shadow: 0 2px 4px rgba(149, 165, 166, 0.3);
}

.hyperate-heart-rate-panel {
  text-align: center;
  padding: 20px;
}
.hyperate-heart-rate-value {
  font-size: 48px;
  font-weight: bold;
  color: #e74c3c;
}
.hyperate-heart-rate-unit {
  font-size: 14px;
  color: #666;
  margin-top: 5px;
}
.hyperate-primary-info {
  font-size: 12px;
  color: #999;
  margin-top: 10px;
}
.hyperate-osc-parameter {
  font-size: 12px;
  color: #999;
  margin-top: 5px;
}
.hyperate-graph-panel {
  padding: 20px;
}
.hyperate-graph-title {
  text-align: center;
  color: #666;
  padding-top: 40px;
  margin-bottom: 10px;
  font-size: 16px;
}
.hyperate-graph-subtitle {
  text-align: center;
  color: #666;
  opacity: 0.7;
  font-size: 12px;
  padding-bottom: 40px;
}
.hyperate-device-row {
  display: flex;
  gap: 10px;
  margin-top: 5px;
}
.hyperate-device-row input {
  flex: 1;
}
.hyperate-helper-text {
  font-size: 12px;
  color: #666;
  margin-top: 5px;
}
.hyperate-saved-trackers {
  margin-top: 20px;
}
.hyperate-saved-trackers h4 {
  margin-bottom: 10px;
}
.hyperate-empty-trackers {
  color: #666;
  text-align: center;
  padding: 10px;
}
.hyperate-tracker-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.hyperate-tracker-copy {
  min-width: 0;
}
.hyperate-tracker-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hyperate-primary-badge {
  font-size: 10px;
  background: #2ecc71;
  color: #fff;
  padding: 2px 6px;
  border-radius: 10px;
}
.hyperate-tracker-id {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
  word-break: break-all;
}
.hyperate-tracker-status {
  font-size: 12px;
  color: #666;
  margin-top: 5px;
}
.hyperate-tracker-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.tracker-item {
  border: 1px solid #ddd;
  background: #ffffff;
  border-radius: 4px;
  padding: 10px;
  margin-bottom: 10px;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.tracker-item-enabled {
  border-color: #2ecc71;
  background: #f8fff8;
}

.tracker-item-primary-disabled {
  border-color: #3498db;
}

.hyperate-heart-rate-panel code {
  background: rgba(52, 152, 219, 0.08);
  border-radius: 4px;
  padding: 2px 6px;
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
  .hyperate-tracker-row {
    flex-direction: column;
    align-items: stretch;
  }

  .hyperate-tracker-actions {
    justify-content: flex-start;
  }
}

:global(body.dark-theme) .hyperate-heart-rate-unit,
:global(body.dark-theme) .hyperate-helper-text,
:global(body.dark-theme) .hyperate-empty-trackers,
:global(body.dark-theme) .hyperate-tracker-id,
:global(body.dark-theme) .hyperate-tracker-status,
:global(body.dark-theme) .hyperate-graph-title,
:global(body.dark-theme) .hyperate-graph-subtitle,
:global(body.dark-theme) .hyperate-primary-info,
:global(body.dark-theme) .hyperate-osc-parameter,
:global(body.dark-theme) .hyperate-modal-help {
  color: #95a5a6;
}

:global(body.dark-theme) .hyperate-modal-title {
  color: #ecf0f1;
}

:global(body.dark-theme) .autostart-toggle-slider {
  background: #34495e;
  border-color: #2c3e50;
}

:global(body.dark-theme) .autostart-toggle-slider:hover {
  border-color: #3498db;
}

:global(body.dark-theme) .autostart-toggle-option {
  color: #95a5a6;
}

:global(body.dark-theme) .autostart-toggle-option.active {
  background: #3498db;
  color: white;
}

:global(body.dark-theme) .autostart-toggle-option.active.enabled {
  background: #27ae60;
}

:global(body.dark-theme) .autostart-toggle-option.active.disabled {
  background: #7f8c8d;
}

:global(body.dark-theme) .hyperate-heart-rate-panel code {
  background: #34495e;
  color: #ecf0f1;
}

:global(body.dark-theme) .hyperate-readonly-input {
  background-color: #1e2329;
  color: #7f8c8d;
  border-color: #34495e;
}

:global(body.dark-theme) .tracker-item {
  background: #2b2b2b;
  border-color: #454545;
}

:global(body.dark-theme) .tracker-item-enabled {
  background: #2d4a2d;
  border-color: #27ae60;
}

:global(body.dark-theme) .tracker-item-primary-disabled {
  border-color: #2980b9;
}
</style>
