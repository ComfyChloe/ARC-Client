<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useHyperate, type HyperateTracker } from '../composables/useHyperate'
import { useHeartRateChart } from '../composables/useHeartRateChart'
import HeartRateChart from '../components/HeartRateChart.vue'
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
const {
  chartData,
  stats,
  isLive,
  selectedRange,
  selectedStep,
  isCustomRange,
  customFromInput,
  customToInput,
  trackerId,
  loading,
  retentionDays,
  setRange,
  goLive,
  setStep,
  activateCustomRange,
  applyCustomRange,
  setNow,
  onPanOffset,
  onZoom,
  setRetention,
  captureRate,
  setCaptureRate,
  STEP_OPTIONS,
  toDatetimeLocal
} = useHeartRateChart()
const newDeviceId = ref('')
const newDeviceName = ref('')
const editingTrackerId = ref<string | null>(null)
const editName = ref('')
const isDarkTheme = ref(false)
let themeObserver: MutationObserver | null = null
const primaryTracker = computed(() => trackers.value.find((tracker) => tracker.isPrimary) ?? null)
watch(primaryTracker, (pt) => {
  if (pt) trackerId.value = pt.deviceId
}, { immediate: true })

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

function syncThemeState() {
  if (typeof document === 'undefined') {
    return
  }
  isDarkTheme.value = document.body.classList.contains('dark-theme')
}

onMounted(() => {
  syncThemeState()
  themeObserver = new MutationObserver(syncThemeState)
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
})

onUnmounted(() => {
  themeObserver?.disconnect()
  themeObserver = null
})
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
      <div class="chart-controls">
        <div class="hr-range-group">
          <button v-for="preset in ['60s','5m','15m','1h','6h','24h','7d','30d']" :key="preset"
            class="hr-range-btn" :class="{ active: selectedRange === preset && isLive === false && !isCustomRange }"
            @click="setRange(preset)">{{ preset }}</button>
          <button class="hr-range-btn" :class="{ active: isCustomRange }" @click="activateCustomRange">Custom</button>
        </div>
        <div v-if="isCustomRange" class="hr-custom-range">
          <input type="datetime-local" class="hr-datetime-input" :value="customFromInput"
            @input="customFromInput = ($event.target as HTMLInputElement).value" />
          <span class="hr-custom-arrow">→</span>
          <input type="datetime-local" class="hr-datetime-input" :value="customToInput"
            @input="customToInput = ($event.target as HTMLInputElement).value" />
          <button class="btn btn-primary btn-small" @click="applyCustomRange">Apply</button>
          <button class="btn btn-secondary btn-small" @click="setNow">Now</button>
        </div>
        <div class="hr-step-group">
          <button v-for="step in STEP_OPTIONS" :key="step"
            class="hr-range-btn" :class="{ active: selectedStep === step }"
            @click="setStep(step)">{{ step }}</button>
        </div>
        <button class="btn btn-small hr-live-btn" :class="isLive ? 'hr-live-btn-active' : 'hr-live-btn-idle'" @click="isLive ? null : goLive()">
          <span class="hr-live-dot" :class="{ 'hr-live-dot-active': isLive }"></span>
          {{ isLive ? 'Live' : 'Paused' }}
        </button>
        <div class="hr-retention-group">
          <label style="font-size: 12px; color: #666;">Retention:</label>
          <select class="hr-retention-select" :value="retentionDays" @change="setRetention(Number(($event.target as HTMLSelectElement).value))">
            <option :value="1">1 day</option>
            <option :value="3">3 days</option>
            <option :value="7">7 days</option>
            <option :value="30">30 days</option>
            <option :value="-1">Unlimited</option>
          </select>
        </div>
        <div class="hr-retention-group">
          <label style="font-size: 12px; color: #666;">Capture:</label>
          <select class="hr-retention-select" :value="captureRate" @change="setCaptureRate(Number(($event.target as HTMLSelectElement).value))">
            <option :value="500">500ms</option>
            <option :value="1000">1s</option>
            <option :value="2000">2s</option>
            <option :value="5000">5s</option>
            <option :value="10000">10s</option>
            <option :value="30000">30s</option>
          </select>
        </div>
      </div>
      <div class="chart-wrapper">
        <HeartRateChart
          :data="chartData"
          :is-live="isLive"
          :min-bpm="stats.min"
          :max-bpm="stats.max"
          :avg-bpm="stats.avg"
          @pan="onPanOffset"
          @zoom="onZoom"
        />
      </div>
      <div v-if="stats.count > 0" class="chart-stats-row">
        <span class="hr-stat"><span class="hr-stat-label">Min</span> <span class="hr-stat-val" style="color: #2ecc71;">{{ stats.min }}</span></span>
        <span class="hr-stat"><span class="hr-stat-label">Avg</span> <span class="hr-stat-val" style="color: #f39c12;">{{ stats.avg }}</span></span>
        <span class="hr-stat"><span class="hr-stat-label">Max</span> <span class="hr-stat-val" style="color: #3498db;">{{ stats.max }}</span></span>
        <span class="hr-stat"><span class="hr-stat-label">Points</span> <span class="hr-stat-val">{{ stats.count.toLocaleString() }}</span></span>
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
            :class="{
              'tracker-item-primary': tracker.isPrimary,
              'tracker-item-dark': isDarkTheme,
              'tracker-item-primary-dark': isDarkTheme && tracker.isPrimary
            }"
          >
            <div class="hyperate-tracker-copy">
              <strong>{{ tracker.name || tracker.deviceId }}</strong>
              <span v-if="tracker.isPrimary" class="hyperate-primary-badge">PRIMARY</span>
              <br />
              <small class="hyperate-tracker-meta" :class="{ 'hyperate-tracker-meta-dark': isDarkTheme }">ID: {{ tracker.deviceId }}</small>
              <br />
              <small class="hyperate-tracker-meta" :class="{ 'hyperate-tracker-meta-dark': isDarkTheme }">
                Status:
                <span class="hyperate-status-value" :class="tracker.isActive ? 'hyperate-status-active' : 'hyperate-status-inactive'">{{ tracker.isActive ? 'Active' : 'Inactive' }}</span>
                | HR: {{ tracker.lastHeartRate || '--' }} BPM
                | Last Update: {{ formatLastUpdate(tracker) }}
              </small>
            </div>
            <div class="hyperate-tracker-actions">
              <button v-if="!tracker.isPrimary" class="btn btn-secondary btn-small" @click="setPrimary(tracker.deviceId)">Set Primary</button>
              <button class="btn btn-secondary btn-small" @click="openEditModal(tracker)">Edit</button>
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
.chart-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 0;
}
.hr-range-group {
  display: flex;
}
.hr-step-group {
  display: flex;
}
.hr-custom-range {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.hr-datetime-input {
  padding: 4px 6px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  background: #fff;
  color: #333;
}
.hr-custom-arrow {
  color: #666;
  font-size: 12px;
}
.hr-live-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid #ddd;
}
.hr-live-btn-active {
  background: #27ae60;
  color: #fff;
  border-color: #27ae60;
}
.hr-live-btn-idle {
  background: #f0f0f0;
  color: #999;
  border-color: #ddd;
}
.hr-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ccc;
}
.hr-live-dot-active {
  background: #fff;
  animation: hr-dot-pulse 1.5s ease-in-out infinite;
}
@keyframes hr-dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.hr-range-btn {
  padding: 4px 10px;
  border: 1px solid #ddd;
  background: #fff;
  color: #666;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}
.hr-range-btn:first-child {
  border-radius: 4px 0 0 4px;
}
.hr-range-btn:last-child {
  border-radius: 0 4px 4px 0;
}
.hr-range-btn:not(:first-child) {
  border-left: none;
}
.hr-range-btn:hover {
  color: #333;
  background: #f8f8f8;
}
.hr-range-btn.active {
  background: #3498db;
  color: #fff;
  border-color: #3498db;
  font-weight: 600;
}
.hr-retention-group {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
}
.hr-retention-select {
  padding: 3px 6px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  background: #fff;
}
.chart-wrapper {
  height: 280px;
  margin: 4px 0;
}
.chart-stats-row {
  display: flex;
  gap: 16px;
  padding: 8px 0 2px;
  flex-wrap: wrap;
}
.hr-stat {
  font-size: 12px;
}
.hr-stat-label {
  color: #999;
  margin-right: 4px;
}
.hr-stat-val {
  font-weight: 600;
  color: #333;
}
.tracker-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  margin-bottom: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  transition: background-color 0.3s ease;
}

.tracker-item-primary {
  border-color: #2ecc71;
  background: #f8fff8;
}

.tracker-item-dark {
  background: #34495e;
  border-color: #2c3e50;
  color: #ecf0f1;
}

.tracker-item-primary-dark {
  background: #2d4a2d;
  border-color: #27ae60;
}

.hyperate-primary-badge {
  background: #2ecc71;
  color: #fff;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  margin-left: 5px;
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
  gap: 5px;
}

.hyperate-tracker-copy {
  min-width: 0;
}

.hyperate-tracker-meta {
  color: #666;
}

.hyperate-tracker-meta-dark {
  color: #bdc3c7;
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

:global(body.dark-theme) .hyperate-primary-badge {
  background: #2ecc71;
  color: #fff;
}

:global(body.dark-theme) .hyperate-modal-title {
  color: #ecf0f1;
}

:global(body.dark-theme) .hyperate-modal-help {
  color: #95a5a6;
}

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
:global(body.dark-theme) .hr-range-btn {
  border-color: #454545;
  background: #2c3e50;
  color: #95a5a6;
}
:global(body.dark-theme) .hr-range-btn:hover {
  color: #ecf0f1;
  background: #34495e;
}
:global(body.dark-theme) .hr-range-btn.active {
  background: #3498db;
  color: #fff;
  border-color: #3498db;
}
:global(body.dark-theme) .hr-retention-select {
  border-color: #454545;
  background: #2c3e50;
  color: #ecf0f1;
}
:global(body.dark-theme) .hr-stat-val {
  color: #ecf0f1;
}
:global(body.dark-theme) .hr-datetime-input {
  border-color: #454545;
  background: #2c3e50;
  color: #ecf0f1;
}
:global(body.dark-theme) .hr-custom-arrow {
  color: #95a5a6;
}
:global(body.dark-theme) .hr-live-btn-idle {
  background: #2c3e50;
  color: #95a5a6;
  border-color: #454545;
}
:global(body.dark-theme) .hr-live-dot {
  background: #555;
}
</style>