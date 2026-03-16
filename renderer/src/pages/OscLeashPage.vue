<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useOscLeash } from '../composables/useOscLeash'
const {
  status, movement, physbone, config, autostart,
  toggle, toggleAutostart, saveConfig, resetConfig
} = useOscLeash()
const activeTab = ref<'movement' | 'timing' | 'advanced'>('movement')
const saving = ref(false)
const configDraft = ref<Record<string, any>>({})
const statusLabel = computed(() => {
  if (status.value.enabled) return 'Running'
  return 'Stopped'
})
const runStateColor = computed(() => (movement.value.run ? '#e74c3c' : '#95a5a6'))
const runStateLabel = computed(() => (movement.value.run ? 'RUNNING' : 'IDLE'))
const configPreview = computed(() => {
  if (!config.value) {
    return 'Configuration will appear here when OSC Leash is enabled'
  }
  return [
    `runDeadzone=${config.value.runDeadzone}`,
    `walkDeadzone=${config.value.walkDeadzone}`,
    `strengthMultiplier=${config.value.strengthMultiplier}`,
    `upCompensation=${config.value.upCompensation}`,
    `downCompensation=${config.value.downCompensation}`,
    `upDeadzone=${config.value.upDeadzone}`,
    `downDeadzone=${config.value.downDeadzone}`,
    `activeDelay=${config.value.activeDelay}`,
    `inactiveDelay=${config.value.inactiveDelay}`,
    `logging=${config.value.logging}`
  ].join('\n')
})
function initDraft() {
  if (config.value) {
    configDraft.value = { ...config.value }
  }
}
watch(config, () => {
  initDraft()
}, { immediate: true })
function onTabChange(tab: 'movement' | 'timing' | 'advanced') {
  activeTab.value = tab
}
async function handleSave() {
  saving.value = true
  await saveConfig(configDraft.value)
  saving.value = false
  initDraft()
}
async function handleReset() {
  await resetConfig()
  initDraft()
}
function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}
function formatRateValue(value: number): string {
  return `${value.toFixed(0)}ms`
}
function setSharedCompensation(value: number) {
  configDraft.value.upCompensation = value
  configDraft.value.downCompensation = value
}
function setSharedDeadzone(value: number) {
  const normalized = value / 100
  configDraft.value.upDeadzone = normalized
  configDraft.value.downDeadzone = normalized
}
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>OSC Leash</h1>
      <p>VRChat physbone-based movement control system.</p>
    </div>
    <div class="card">
      <h3>Connection Status</h3>
      <div class="connection-status">
        <span class="status-indicator" :class="status.enabled ? 'status-connected' : 'status-disconnected'"></span>
        <span>{{ status.enabled ? 'Enabled' : 'Disabled' }}</span>
      </div>
      <div class="oscleash-control-row">
        <button class="btn" :class="status.enabled ? 'btn-danger' : 'btn-primary'" @click="toggle">
          {{ status.enabled ? 'Disable OSC Leash' : 'Enable OSC Leash' }}
        </button>
        <div class="autostart-toggle-container">
          <span class="autostart-toggle-label">Auto-start:</span>
          <div class="autostart-toggle-slider" role="button" tabindex="0" @click="toggleAutostart" @keyup.enter="toggleAutostart" @keyup.space.prevent="toggleAutostart">
            <div class="autostart-toggle-option disabled" :class="{ active: !autostart }">Disabled</div>
            <div class="autostart-toggle-option enabled" :class="{ active: autostart }">Enabled</div>
          </div>
        </div>
      </div>
      <div class="oscleash-note-box">
        <small>
          <strong>Note:</strong> OSC service must be enabled for OSC Leash to function properly.
        </small>
      </div>
    </div>
    <div class="card">
      <h3>Leash Status</h3>
      <div v-if="status.discoveredLeashes?.length" class="oscleash-leash-list">
        <div v-for="leash in status.discoveredLeashes" :key="leash.name || leash.id" class="oscleash-leash-item">
          <div>
            <strong>{{ leash.name || leash.id }}</strong>
            <div class="oscleash-subtext">Stretch: {{ Math.round((leash.stretch ?? 0) * 100) }}%</div>
          </div>
          <span class="oscleash-badge" :class="leash.grabbed ? 'grabbed' : 'released'">{{ leash.grabbed ? 'Grabbed' : 'Released' }}</span>
        </div>
      </div>
      <div v-else class="oscleash-empty-state">
        {{ status.enabled ? 'No leash status available yet.' : 'OSC Leash is disabled. Enable it to see leash status.' }}
      </div>
    </div>
    <div class="card">
      <h3>Real-time Movement Data</h3>
      <div class="oscleash-movement-grid">
        <div class="oscleash-movement-panel">
          <div class="oscleash-movement-label">VERTICAL (Forward/Back)</div>
          <div class="oscleash-movement-value vertical">{{ movement.vertical.toFixed(2) }}</div>
          <div class="oscleash-movement-range">Range: -1.0 to 1.0</div>
        </div>
        <div class="oscleash-movement-panel">
          <div class="oscleash-movement-label">HORIZONTAL (Left/Right)</div>
          <div class="oscleash-movement-value horizontal">{{ movement.horizontal.toFixed(2) }}</div>
          <div class="oscleash-movement-range">Range: -1.0 to 1.0</div>
        </div>
      </div>
      <div class="oscleash-run-grid">
        <div class="oscleash-movement-panel">
          <div class="oscleash-movement-label">RUN STATE</div>
          <div class="oscleash-run-state" :style="{ color: runStateColor }">{{ runStateLabel }}</div>
        </div>
        <div class="oscleash-movement-panel">
          <div class="oscleash-movement-range">Only if enabled</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Physbone Input Monitor</h3>
      <div class="oscleash-physbone-monitor">
        <div v-if="!status.enabled && !physbone.grabbed && physbone.stretch === 0 && physbone.zPos === 0 && physbone.zNeg === 0 && physbone.xPos === 0 && physbone.xNeg === 0 && physbone.yPos === 0 && physbone.yNeg === 0" class="oscleash-empty-state">
          No physbone data available
        </div>
        <template v-else>
          <div>stretch: {{ toPercent(physbone.stretch) }}</div>
          <div>grabbed: {{ physbone.grabbed ? 'true' : 'false' }}</div>
          <div>zPos: {{ toPercent(physbone.zPos) }}</div>
          <div>zNeg: {{ toPercent(physbone.zNeg) }}</div>
          <div>xPos: {{ toPercent(physbone.xPos) }}</div>
          <div>xNeg: {{ toPercent(physbone.xNeg) }}</div>
          <div>yPos: {{ toPercent(physbone.yPos) }}</div>
          <div>yNeg: {{ toPercent(physbone.yNeg) }}</div>
        </template>
      </div>
    </div>
    <div class="card">
      <h3>Configuration</h3>
      <div class="oscleash-config-actions">
        <button class="btn btn-success" :disabled="saving" @click="handleSave">{{ saving ? 'Saving...' : 'Save Changes' }}</button>
        <button class="btn btn-warning" @click="handleReset">Reset to Defaults</button>
      </div>
      <div class="tabs oscleash-tabs">
        <button class="tab" :class="{ active: activeTab === 'movement' }" @click="onTabChange('movement')">Movement Settings</button>
        <button class="tab" :class="{ active: activeTab === 'timing' }" @click="onTabChange('timing')">Timing & Performance</button>
        <button class="tab" :class="{ active: activeTab === 'advanced' }" @click="onTabChange('advanced')">Advanced</button>
      </div>
      <div v-if="activeTab === 'movement'" class="oscleash-config-section">
        <div class="oscleash-config-grid-two">
          <div class="form-group">
            <label for="config-run-deadzone">Run Deadzone (%)</label>
            <input id="config-run-deadzone" v-model.number="configDraft.runDeadzone" type="range" min="50" max="100" step="5" />
            <span>{{ configDraft.runDeadzone ?? 0 }}%</span>
            <small>Stretch required to start running</small>
          </div>
          <div class="form-group">
            <label for="config-walk-deadzone">Walk Deadzone (%)</label>
            <input id="config-walk-deadzone" v-model.number="configDraft.walkDeadzone" type="range" min="5" max="50" step="5" />
            <span>{{ configDraft.walkDeadzone ?? 0 }}%</span>
            <small>Minimum stretch to start walking</small>
          </div>
          <div class="form-group">
            <label for="config-strength-multiplier">Strength Multiplier</label>
            <input id="config-strength-multiplier" v-model.number="configDraft.strengthMultiplier" type="range" min="0.5" max="3" step="0.1" />
            <span>{{ Number(configDraft.strengthMultiplier ?? 0).toFixed(1) }}</span>
            <small>Movement force multiplier</small>
          </div>
          <div class="form-group">
            <label for="config-updown-compensation">Up/Down Compensation</label>
            <input
              id="config-updown-compensation"
              :value="configDraft.upCompensation ?? 0"
              type="range"
              min="0"
              max="2"
              step="0.1"
              @input="setSharedCompensation(Number(($event.target as HTMLInputElement).value))"
            />
            <span>{{ Number(configDraft.upCompensation ?? 0).toFixed(1) }}</span>
            <small>Reduces movement when leash is pulled up/down</small>
          </div>
        </div>
        <div class="form-group">
          <label for="config-updown-deadzone">Up/Down Deadzone (%)</label>
          <input
            id="config-updown-deadzone"
            :value="Math.round(Number(configDraft.upDeadzone ?? 0) * 100)"
            type="range"
            min="10"
            max="90"
            step="5"
            @input="setSharedDeadzone(Number(($event.target as HTMLInputElement).value))"
          />
          <span>{{ Math.round(Number(configDraft.upDeadzone ?? 0) * 100) }}%</span>
          <small>Stops movement if leash pulled too high/low</small>
        </div>
      </div>
      <div v-else-if="activeTab === 'timing'" class="oscleash-config-section">
        <div class="oscleash-config-grid-two">
          <div class="form-group">
            <label for="config-active-delay">Active Delay (ms)</label>
            <input id="config-active-delay" v-model.number="configDraft.activeDelay" type="range" min="10" max="100" step="5" />
            <span>{{ formatRateValue(Number(configDraft.activeDelay ?? 0)) }}</span>
            <small>Update frequency when leash is grabbed</small>
          </div>
          <div class="form-group">
            <label for="config-inactive-delay">Inactive Delay (ms)</label>
            <input id="config-inactive-delay" v-model.number="configDraft.inactiveDelay" type="range" min="100" max="2000" step="50" />
            <span>{{ formatRateValue(Number(configDraft.inactiveDelay ?? 0)) }}</span>
            <small>Update frequency when leash is released</small>
          </div>
        </div>
        <div class="form-group">
          <label class="oscleash-inline-toggle">
            <input v-model="configDraft.logging" type="checkbox" />
            <span>Enable Debug Logging</span>
          </label>
          <small>Show detailed movement calculations in console</small>
        </div>
      </div>
      <div v-else class="oscleash-config-section">
        <div class="oscleash-warning-box">
          <strong>OSC Parameters:</strong>
          <p>
            These parameters are determined by the VRChat prefab and should not be changed unless you're using a custom prefab.
          </p>
        </div>
        <div class="form-group">
          <label for="config-physbone-params">Physbone Parameters (comma-separated)</label>
          <input id="config-physbone-params" :value="configDraft.physboneParameter ?? 'Leash'" readonly type="text" class="oscleash-readonly-input" />
          <small>Base names for physbone parameters</small>
        </div>
        <div class="oscleash-config-grid-two">
          <div class="form-group">
            <label for="config-z-positive">Z+ Parameter (Forward)</label>
            <input id="config-z-positive" value="Leash_Z+" readonly type="text" class="oscleash-readonly-input" />
          </div>
          <div class="form-group">
            <label for="config-z-negative">Z- Parameter (Backward)</label>
            <input id="config-z-negative" value="Leash_Z-" readonly type="text" class="oscleash-readonly-input" />
          </div>
          <div class="form-group">
            <label for="config-x-positive">X+ Parameter (Right)</label>
            <input id="config-x-positive" value="Leash_X+" readonly type="text" class="oscleash-readonly-input" />
          </div>
          <div class="form-group">
            <label for="config-x-negative">X- Parameter (Left)</label>
            <input id="config-x-negative" value="Leash_X-" readonly type="text" class="oscleash-readonly-input" />
          </div>
          <div class="form-group">
            <label for="config-y-positive">Y+ Parameter (Up)</label>
            <input id="config-y-positive" value="Leash_Y+" readonly type="text" class="oscleash-readonly-input" />
          </div>
          <div class="form-group">
            <label for="config-y-negative">Y- Parameter (Down)</label>
            <input id="config-y-negative" value="Leash_Y-" readonly type="text" class="oscleash-readonly-input" />
          </div>
        </div>
      </div>
      <div class="oscleash-preview-block">
        <strong>Current Settings Preview:</strong>
        <div class="oscleash-preview-box">{{ configPreview }}</div>
      </div>
    </div>
    <div class="card">
      <h3>OSC Parameters</h3>
      <div class="oscleash-parameters">
        <strong>Sends to VRChat:</strong><br />
        <code class="vertical">/input/Vertical</code> - Forward/Backward movement<br />
        <code class="horizontal">/input/Horizontal</code> - Left/Right movement<br />
        <code class="run">/input/Run</code> - Running state (0 or 1)<br />
        <code class="turn">/input/LookHorizontal</code> - Turning (if enabled)<br /><br />
        <strong>Listens for from VRChat:</strong><br />
        <code class="listen">/avatar/parameters/Leash_Stretch</code> - Physbone stretch value<br />
        <code class="listen">/avatar/parameters/Leash_IsGrabbed</code> - Grab detection<br />
        <code class="listen">/avatar/parameters/Leash_Z+</code> - Forward direction<br />
        <code class="listen">/avatar/parameters/Leash_Z-</code> - Backward direction<br />
        <code class="listen">/avatar/parameters/Leash_X+</code> - Right direction<br />
        <code class="listen">/avatar/parameters/Leash_X-</code> - Left direction<br />
        <code class="listen">/avatar/parameters/Leash_Y+</code> - Up direction<br />
        <code class="listen">/avatar/parameters/Leash_Y-</code> - Down direction
      </div>
    </div>
  </div>
</template>

<style scoped>
.oscleash-control-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
}
.autostart-toggle-container {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.autostart-toggle-label {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.8;
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
.oscleash-note-box {
  margin-top: 10px;
  padding: 10px;
  background-color: #e8f4fd;
  border-radius: 4px;
  border-left: 4px solid #3498db;
}
.oscleash-note-box small {
  color: #2c3e50;
}
.oscleash-leash-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.oscleash-empty-state {
  text-align: center;
  padding: 20px;
  color: #666;
}
.oscleash-leash-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 12px 15px;
  background: #f8f9fa;
  border: 1px solid #ecf0f1;
  border-radius: 8px;
}
.oscleash-subtext {
  margin-top: 4px;
  color: #7f8c8d;
  font-size: 12px;
}
.oscleash-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.oscleash-badge.grabbed {
  background: #f8d7da;
  color: #c0392b;
}
.oscleash-badge.released {
  background: #d5f4e6;
  color: #27ae60;
}
.oscleash-movement-grid,
.oscleash-run-grid,
.oscleash-config-grid-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.oscleash-movement-grid {
  margin-bottom: 15px;
}
.oscleash-movement-panel {
  text-align: center;
}
.oscleash-movement-label {
  font-size: 12px;
  color: #666;
  margin-bottom: 5px;
}
.oscleash-movement-value {
  font-size: 24px;
  font-weight: bold;
}
.oscleash-movement-value.vertical {
  color: #3498db;
}
.oscleash-movement-value.horizontal {
  color: #e74c3c;
}
.oscleash-movement-range {
  font-size: 10px;
  color: #999;
}
.oscleash-run-state {
  font-size: 20px;
  font-weight: bold;
}
.oscleash-physbone-monitor {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.4;
}
.oscleash-config-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 15px;
  flex-wrap: wrap;
}
.oscleash-tabs {
  margin-bottom: 10px;
}
.oscleash-config-section .form-group span {
  display: inline-block;
  margin-top: 6px;
  font-weight: 600;
}
.oscleash-config-section .form-group small {
  display: block;
  margin-top: 4px;
  color: #666;
}
.oscleash-inline-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}
.oscleash-warning-box {
  padding: 8px;
  background-color: #fff3cd;
  border-radius: 4px;
  border-left: 4px solid #ffc107;
  margin-bottom: 12px;
}
.oscleash-warning-box strong,
.oscleash-warning-box p {
  color: #856404;
}
.oscleash-warning-box p {
  margin: 3px 0 0;
  font-size: 0.85em;
}
.oscleash-readonly-input {
  background: #f8f9fa;
}
.oscleash-preview-block {
  margin-top: 15px;
}
.oscleash-preview-box {
  margin-top: 8px;
  padding: 8px;
  background-color: #f8f9fa;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  white-space: pre-line;
}
.oscleash-parameters {
  font-family: monospace;
  font-size: 12px;
  line-height: 1.4;
}
.oscleash-parameters code.vertical {
  color: #2ecc71;
}
.oscleash-parameters code.horizontal {
  color: #e74c3c;
}
.oscleash-parameters code.run {
  color: #f39c12;
}
.oscleash-parameters code.turn {
  color: #9b59b6;
}
.oscleash-parameters code.listen {
  color: #3498db;
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

:global(body.dark-theme) .oscleash-readonly-input,
:global(body.dark-theme) .oscleash-preview-box {
  background: #2c3e50;
}

:global(body.dark-theme) .oscleash-readonly-input,
:global(body.dark-theme) .oscleash-preview-box {
  color: #ecf0f1;
}
:global(body.dark-theme) .oscleash-note-box small {
  color: #ecf0f1;
}
:global(body.dark-theme) .oscleash-empty-state,
:global(body.dark-theme) .oscleash-subtext {
  color: #95a5a6;
}
:global(body.dark-theme) .oscleash-leash-item,
:global(body.dark-theme) .oscleash-preview-box,
:global(body.dark-theme) .oscleash-readonly-input {
  border-color: #34495e;
}
@media (max-width: 700px) {
  .oscleash-movement-grid,
  .oscleash-run-grid,
  .oscleash-config-grid-two {
    grid-template-columns: 1fr;
  }
}
</style>
