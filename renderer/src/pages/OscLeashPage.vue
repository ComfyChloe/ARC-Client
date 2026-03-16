<script setup lang="ts">
import { ref, computed } from 'vue'
import { useOscLeash } from '../composables/useOscLeash'
const {
  status, movement, physbone, config, autostart,
  toggle, toggleAutostart, saveConfig, resetConfig
} = useOscLeash()
const activeTab = ref<'movement' | 'config'>('movement')
const saving = ref(false)
const configDraft = ref<Record<string, any>>({})
const statusLabel = computed(() => {
  if (status.value.enabled) return 'Running'
  return 'Stopped'
})
function initDraft() {
  if (config.value) {
    configDraft.value = { ...config.value }
  }
}
function onTabChange(tab: 'movement' | 'config') {
  activeTab.value = tab
  if (tab === 'config') initDraft()
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
function meterWidth(val: number): string {
  return Math.min(Math.abs(val) * 100, 100) + '%'
}
function meterColor(val: number): string {
  if (Math.abs(val) > 0.8) return '#e74c3c'
  if (Math.abs(val) > 0.4) return '#f0c040'
  return '#4caf50'
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
        <span>{{ statusLabel }}</span>
      </div>
      <p class="oscleash-note">Discovered leashes: {{ status.leashCount }}</p>
      <div class="oscleash-action-row">
        <button class="btn" :class="status.enabled ? 'btn-danger' : 'btn-primary'" @click="toggle">
          {{ status.enabled ? 'Disable OSC Leash' : 'Enable OSC Leash' }}
        </button>
        <label class="oscleash-checkbox">
          <input type="checkbox" :checked="autostart" @change="toggleAutostart" />
          <span>Auto-start with client</span>
        </label>
      </div>
    </div>
    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'movement' }" @click="onTabChange('movement')">Movement</button>
      <button class="tab" :class="{ active: activeTab === 'config' }" @click="onTabChange('config')">Configuration</button>
    </div>
    <div v-if="activeTab === 'movement'">
      <div class="card" v-if="status.discoveredLeashes?.length">
        <h3>Leash Status</h3>
        <div class="oscleash-leash-list">
          <div v-for="leash in status.discoveredLeashes" :key="leash.name || leash.id" class="oscleash-leash-item">
            <div>
              <strong>{{ leash.name || leash.id }}</strong>
              <div class="oscleash-subtext">Stretch: {{ Math.round((leash.stretch ?? 0) * 100) }}%</div>
            </div>
            <span class="oscleash-badge" :class="leash.grabbed ? 'grabbed' : 'released'">{{ leash.grabbed ? 'Grabbed' : 'Released' }}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Real-time Movement Data</h3>
        <div class="oscleash-meter-grid">
          <div class="oscleash-meter-row">
            <span>Vertical</span>
            <div class="oscleash-meter-bar"><div class="oscleash-meter-fill" :style="{ width: meterWidth(movement.vertical), background: meterColor(movement.vertical) }"></div></div>
            <strong>{{ movement.vertical.toFixed(2) }}</strong>
          </div>
          <div class="oscleash-meter-row">
            <span>Horizontal</span>
            <div class="oscleash-meter-bar"><div class="oscleash-meter-fill" :style="{ width: meterWidth(movement.horizontal), background: meterColor(movement.horizontal) }"></div></div>
            <strong>{{ movement.horizontal.toFixed(2) }}</strong>
          </div>
          <div class="oscleash-meter-row">
            <span>Run</span>
            <div class="oscleash-meter-bar"><div class="oscleash-meter-fill" :style="{ width: movement.run ? '100%' : '0%', background: movement.run ? '#e74c3c' : '#95a5a6' }"></div></div>
            <strong>{{ movement.run ? 'Yes' : 'No' }}</strong>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Physbone Input Monitor</h3>
        <div class="oscleash-physbone-grid">
          <div class="oscleash-physbone-item">
            <span>Stretch</span>
            <strong>{{ (physbone.stretch * 100).toFixed(0) }}%</strong>
          </div>
          <div class="oscleash-physbone-item">
            <span>Grabbed</span>
            <strong>{{ physbone.grabbed ? 'Yes' : 'No' }}</strong>
          </div>
          <div class="oscleash-physbone-item" v-for="axis in ['zPos', 'zNeg', 'xPos', 'xNeg', 'yPos', 'yNeg']" :key="axis">
            <span>{{ axis }}</span>
            <strong>{{ ((physbone as any)[axis] * 100).toFixed(0) }}%</strong>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="card">
      <h3>Configuration</h3>
      <div class="oscleash-config-grid" v-if="config">
        <div class="form-group">
          <label>Run Deadzone (%)</label>
          <input type="number" min="0" max="100" v-model.number="configDraft.runDeadzone" />
        </div>
        <div class="form-group">
          <label>Walk Deadzone (%)</label>
          <input type="number" min="0" max="100" v-model.number="configDraft.walkDeadzone" />
        </div>
        <div class="form-group">
          <label>Strength Multiplier</label>
          <input type="number" min="0" max="5" step="0.1" v-model.number="configDraft.strengthMultiplier" />
        </div>
        <div class="form-group">
          <label>Up Compensation</label>
          <input type="number" min="0" max="1" step="0.01" v-model.number="configDraft.upCompensation" />
        </div>
        <div class="form-group">
          <label>Up Deadzone</label>
          <input type="number" min="0" max="1" step="0.01" v-model.number="configDraft.upDeadzone" />
        </div>
        <div class="form-group">
          <label>Down Compensation</label>
          <input type="number" min="0" max="1" step="0.01" v-model.number="configDraft.downCompensation" />
        </div>
        <div class="form-group">
          <label>Down Deadzone</label>
          <input type="number" min="0" max="1" step="0.01" v-model.number="configDraft.downDeadzone" />
        </div>
        <div class="form-group">
          <label>Active Delay (ms)</label>
          <input type="number" min="0" max="2000" v-model.number="configDraft.activeDelay" />
        </div>
        <div class="form-group">
          <label>Inactive Delay (ms)</label>
          <input type="number" min="0" max="2000" v-model.number="configDraft.inactiveDelay" />
        </div>
      </div>
      <label class="oscleash-checkbox oscleash-logging-toggle">
        <input type="checkbox" v-model="configDraft.logging" />
        <span>Enable debug logging</span>
      </label>
      <div class="oscleash-action-row">
        <button class="btn btn-primary" :disabled="saving" @click="handleSave">{{ saving ? 'Saving...' : 'Save Changes' }}</button>
        <button class="btn btn-warning" @click="handleReset">Reset Defaults</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.oscleash-note {
  margin: 0 0 15px;
  color: #7f8c8d;
}
.oscleash-action-row {
  display: flex;
  gap: 15px;
  align-items: center;
  flex-wrap: wrap;
}
.oscleash-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.oscleash-leash-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.oscleash-meter-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.oscleash-meter-row {
  display: grid;
  grid-template-columns: 100px 1fr 70px;
  gap: 12px;
  align-items: center;
}
.oscleash-meter-bar {
  height: 12px;
  background: #ecf0f1;
  border-radius: 999px;
  overflow: hidden;
}
.oscleash-meter-fill {
  height: 100%;
}
.oscleash-physbone-grid,
.oscleash-config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
}
.oscleash-physbone-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 15px;
  background: #f8f9fa;
  border: 1px solid #ecf0f1;
  border-radius: 8px;
}
.oscleash-logging-toggle {
  margin: 10px 0 20px;
}
:global(body.dark-theme) .oscleash-note,
:global(body.dark-theme) .oscleash-subtext {
  color: #95a5a6;
}
:global(body.dark-theme) .oscleash-leash-item,
:global(body.dark-theme) .oscleash-physbone-item {
  background: #2c3e50;
  border-color: #34495e;
}
:global(body.dark-theme) .oscleash-meter-bar {
  background: #34495e;
}
</style>
