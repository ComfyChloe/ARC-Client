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
  <div class="page">
    <h2>OSC Leash</h2>
    <p class="page-desc">Control locomotion input from VRChat physbone leashes.</p>
    <!-- Status Card -->
    <div class="status-card">
      <div class="status-row">
        <span class="status-label">Status</span>
        <span class="status-value" :class="status.enabled ? 'status-ok' : 'status-off'">{{ statusLabel }}</span>
      </div>
      <div class="status-row">
        <span class="status-label">Leashes</span>
        <span class="status-value">{{ status.leashCount }} discovered</span>
      </div>
    </div>
    <!-- Actions -->
    <div class="actions-row">
      <button class="btn" :class="{ 'btn-danger': status.enabled }" @click="toggle">
        {{ status.enabled ? 'Stop' : 'Start' }}
      </button>
      <label class="toggle-label">
        <input type="checkbox" :checked="autostart" @change="toggleAutostart" />
        Autostart
      </label>
    </div>
    <!-- Tabs -->
    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'movement' }" @click="onTabChange('movement')">Movement</button>
      <button class="tab" :class="{ active: activeTab === 'config' }" @click="onTabChange('config')">Configuration</button>
    </div>
    <!-- Movement Tab -->
    <div v-if="activeTab === 'movement'" class="tab-content">
      <!-- Leash List -->
      <div class="section" v-if="status.discoveredLeashes?.length">
        <h3>Active Leashes</h3>
        <div class="leash-list">
          <div v-for="leash in status.discoveredLeashes" :key="leash.name || leash.id" class="leash-item">
            <span class="leash-name">{{ leash.name || leash.id }}</span>
            <span class="leash-stretch">{{ Math.round((leash.stretch ?? 0) * 100) }}%</span>
            <span class="leash-grip" :class="leash.grabbed ? 'grabbed' : 'released'">{{ leash.grabbed ? 'Grabbed' : 'Released' }}</span>
          </div>
        </div>
      </div>
      <!-- Movement Meters -->
      <div class="section">
        <h3>Movement Output</h3>
        <div class="meter-group">
          <div class="meter-row">
            <span class="meter-label">Vertical</span>
            <div class="meter-bar"><div class="meter-fill" :style="{ width: meterWidth(movement.vertical), background: meterColor(movement.vertical) }"></div></div>
            <span class="meter-val">{{ movement.vertical.toFixed(2) }}</span>
          </div>
          <div class="meter-row">
            <span class="meter-label">Horizontal</span>
            <div class="meter-bar"><div class="meter-fill" :style="{ width: meterWidth(movement.horizontal), background: meterColor(movement.horizontal) }"></div></div>
            <span class="meter-val">{{ movement.horizontal.toFixed(2) }}</span>
          </div>
          <div class="meter-row">
            <span class="meter-label">Run</span>
            <div class="meter-bar"><div class="meter-fill" :style="{ width: movement.run ? '100%' : '0%', background: movement.run ? '#e94560' : '#555' }"></div></div>
            <span class="meter-val">{{ movement.run ? 'Yes' : 'No' }}</span>
          </div>
        </div>
      </div>
      <!-- Physbone Inputs -->
      <div class="section">
        <h3>Physbone Inputs</h3>
        <div class="physbone-grid">
          <div class="physbone-item">
            <span class="physbone-name">Stretch</span>
            <span class="physbone-val">{{ (physbone.stretch * 100).toFixed(0) }}%</span>
          </div>
          <div class="physbone-item">
            <span class="physbone-name">Grabbed</span>
            <span class="physbone-val" :class="physbone.grabbed ? 'val-active' : ''">{{ physbone.grabbed ? 'Yes' : 'No' }}</span>
          </div>
          <div class="physbone-item" v-for="axis in ['zPos', 'zNeg', 'xPos', 'xNeg', 'yPos', 'yNeg']" :key="axis">
            <span class="physbone-name">{{ axis }}</span>
            <span class="physbone-val">{{ ((physbone as any)[axis] * 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    </div>
    <!-- Config Tab -->
    <div v-if="activeTab === 'config'" class="tab-content">
      <div class="config-grid" v-if="config">
        <div class="config-field">
          <label>Run Deadzone (%)</label>
          <input type="number" min="0" max="100" v-model.number="configDraft.runDeadzone" />
        </div>
        <div class="config-field">
          <label>Walk Deadzone (%)</label>
          <input type="number" min="0" max="100" v-model.number="configDraft.walkDeadzone" />
        </div>
        <div class="config-field">
          <label>Strength Multiplier</label>
          <input type="number" min="0" max="5" step="0.1" v-model.number="configDraft.strengthMultiplier" />
        </div>
        <div class="config-field">
          <label>Up Compensation</label>
          <input type="number" min="0" max="1" step="0.01" v-model.number="configDraft.upCompensation" />
        </div>
        <div class="config-field">
          <label>Up Deadzone</label>
          <input type="number" min="0" max="1" step="0.01" v-model.number="configDraft.upDeadzone" />
        </div>
        <div class="config-field">
          <label>Down Compensation</label>
          <input type="number" min="0" max="1" step="0.01" v-model.number="configDraft.downCompensation" />
        </div>
        <div class="config-field">
          <label>Down Deadzone</label>
          <input type="number" min="0" max="1" step="0.01" v-model.number="configDraft.downDeadzone" />
        </div>
        <div class="config-field">
          <label>Active Delay (ms)</label>
          <input type="number" min="0" max="2000" v-model.number="configDraft.activeDelay" />
        </div>
        <div class="config-field">
          <label>Inactive Delay (ms)</label>
          <input type="number" min="0" max="2000" v-model.number="configDraft.inactiveDelay" />
        </div>
        <div class="config-field checkbox-field">
          <label><input type="checkbox" v-model="configDraft.logging" /> Enable Logging</label>
        </div>
      </div>
      <div class="config-actions">
        <button class="btn" :disabled="saving" @click="handleSave">{{ saving ? 'Saving...' : 'Save' }}</button>
        <button class="btn btn-secondary" @click="handleReset">Reset Defaults</button>
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
.status-off {
  color: #999;
}
.actions-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}
.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #ccc;
  cursor: pointer;
  font-size: 0.9rem;
}
.tabs {
  display: flex;
  gap: 0;
  margin-bottom: 1rem;
  border-bottom: 2px solid #333;
}
.tab {
  background: none;
  border: none;
  color: #999;
  padding: 0.6rem 1.2rem;
  cursor: pointer;
  font-size: 0.9rem;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}
.tab:hover {
  color: #ccc;
}
.tab.active {
  color: #e94560;
  border-bottom-color: #e94560;
}
.tab-content {
  min-height: 200px;
}
.section {
  margin-bottom: 1.5rem;
}
.section h3 {
  margin: 0 0 0.6rem;
  font-size: 1rem;
  color: #ccc;
}
.leash-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.leash-item {
  background: #1e1e2e;
  border-radius: 6px;
  padding: 0.5rem 0.8rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}
.leash-name {
  flex: 1;
  color: #fff;
}
.leash-stretch {
  color: #f0c040;
  font-weight: 600;
}
.leash-grip {
  font-size: 0.8rem;
  padding: 2px 8px;
  border-radius: 4px;
}
.leash-grip.grabbed {
  background: #e74c3c33;
  color: #e74c3c;
}
.leash-grip.released {
  background: #4caf5033;
  color: #4caf50;
}
.meter-group {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.meter-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.meter-label {
  width: 80px;
  color: #999;
  font-size: 0.85rem;
}
.meter-bar {
  flex: 1;
  height: 12px;
  background: #2a2a3e;
  border-radius: 6px;
  overflow: hidden;
}
.meter-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.15s ease;
}
.meter-val {
  width: 50px;
  text-align: right;
  color: #ccc;
  font-size: 0.85rem;
  font-family: monospace;
}
.physbone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.5rem;
}
.physbone-item {
  background: #1e1e2e;
  border-radius: 6px;
  padding: 0.5rem 0.8rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.physbone-name {
  color: #999;
  font-size: 0.85rem;
}
.physbone-val {
  color: #fff;
  font-weight: 600;
  font-family: monospace;
}
.val-active {
  color: #e94560;
}
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}
.config-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.config-field label {
  color: #999;
  font-size: 0.85rem;
}
.config-field input[type="number"] {
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 0.45rem 0.7rem;
  color: #fff;
  font-size: 0.9rem;
}
.config-field input[type="number"]:focus {
  outline: none;
  border-color: #5865f2;
}
.checkbox-field {
  flex-direction: row;
  align-items: center;
}
.checkbox-field label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  color: #ccc;
}
.config-actions {
  display: flex;
  gap: 0.5rem;
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
.btn-danger {
  background: #e74c3c;
}
.btn-secondary {
  background: #555;
}
</style>
