<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAutoStatus, STATUS_TYPES, DAY_LABELS } from '../composables/useAutoStatus'
import type { Preset } from '../composables/useAutoStatus'
const {
  presets, schedule, settings, status,
  createPreset, updatePreset, deletePreset, testPreset,
  addSchedule, updateSchedule, deleteSchedule, updateSettings
} = useAutoStatus()
// Banner computed
const activePreset = computed(() => {
  if (!status.value.lastAppliedPresetId) return null
  return presets.value.find(p => p.id === status.value.lastAppliedPresetId) ?? null
})
const activeStatusType = computed(() =>
  activePreset.value ? STATUS_TYPES.find(t => t.value === activePreset.value!.statusType) ?? null : null
)
// Preset editing
function onPresetFieldChange(preset: Preset, field: keyof Preset, value: any) {
  const updated = { ...preset, [field]: field === 'statusType' && value === '' ? null : value }
  updatePreset(updated)
}
// Schedule add form
const newSchedule = ref({ name: '', startTime: '09:00', endTime: '17:00', presetId: 0, fallbackStatusType: '' })
const newDays = ref<Set<number>>(new Set())
function toggleDay(d: number) {
  const s = new Set(newDays.value)
  if (s.has(d)) s.delete(d); else s.add(d)
  newDays.value = s
}
async function handleAddSchedule() {
  if (newDays.value.size === 0) return
  if (!newSchedule.value.startTime || !newSchedule.value.endTime) return
  const pid = newSchedule.value.presetId || (presets.value[0]?.id ?? 0)
  if (!pid) return
  await addSchedule({
    daysOfWeek: Array.from(newDays.value).sort(),
    startTime: newSchedule.value.startTime,
    endTime: newSchedule.value.endTime,
    presetId: pid,
    name: newSchedule.value.name,
    fallbackStatusType: newSchedule.value.fallbackStatusType || null
  })
  newSchedule.value = { name: '', startTime: '09:00', endTime: '17:00', presetId: 0, fallbackStatusType: '' }
  newDays.value = new Set()
}
// Confirm delete
const confirmDeleteId = ref<number | null>(null)
async function confirmDelete(id: number) {
  confirmDeleteId.value = id
}
async function executeDelete() {
  if (confirmDeleteId.value !== null) {
    await deletePreset(confirmDeleteId.value)
    confirmDeleteId.value = null
  }
}
function cancelDelete() {
  confirmDeleteId.value = null
}
// Schedule helpers
function schedulePreset(entry: any) {
  return presets.value.find(p => p.id === entry.presetId)
}
function scheduleStatusType(entry: any) {
  const p = schedulePreset(entry)
  return p ? STATUS_TYPES.find(t => t.value === p.statusType) : null
}
function isOvernight(entry: any) {
  return entry.endTime <= entry.startTime
}
// Inline rename for schedules
const editingScheduleId = ref<string | null>(null)
const editingScheduleName = ref('')
function startEditScheduleName(entryId: string, name: string) {
  editingScheduleId.value = entryId
  editingScheduleName.value = name || ''
}
async function saveScheduleName(entryId: string) {
  await updateSchedule(entryId, { name: editingScheduleName.value.trim() })
  editingScheduleId.value = null
}
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>Auto-Status</h1>
      <p>Manage VRChat status presets, OSC triggers, and schedule-based automation.</p>
    </div>
    <div class="card autostatus-banner-card">
      <div class="autostatus-banner-row">
        <div>
          <div class="autostatus-title-row">
            <span class="autostatus-icon">{{ activeStatusType?.icon ?? '\u26AA' }}</span>
            <strong>{{ activePreset?.name ?? 'No Active Preset' }}</strong>
          </div>
          <div class="autostatus-subtitle">
            <template v-if="activePreset">
              {{ activeStatusType?.label ?? activePreset.statusType }}
              <template v-if="activePreset.statusMessage"> - "{{ activePreset.statusMessage }}"</template>
            </template>
            <template v-else>Waiting for trigger...</template>
          </div>
        </div>
        <div class="autostatus-badge-row">
          <span v-if="status.externallySet" class="autostatus-badge warn">External Status</span>
          <span v-if="status.avatarGuardActive" class="autostatus-badge warn">Avatar Guard</span>
          <span class="autostatus-badge" :class="status.vrchatApiAvailable ? 'ok' : 'error'">{{ status.vrchatApiAvailable ? 'API Ready' : 'API Offline' }}</span>
          <span class="autostatus-badge info">OSC: {{ status.lastOscValue ?? 0 }}</span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="autostatus-section-header">
        <h3>Status Presets</h3>
        <span>Configure up to 8 presets triggered by the OSC preset parameter.</span>
      </div>
      <div v-if="presets.length === 0" class="autostatus-empty-state">
        <p>No status presets configured yet.</p>
        <button class="btn btn-primary" @click="createPreset">Add Preset</button>
      </div>
      <div v-else class="autostatus-presets-grid">
        <div v-for="p in presets" :key="p.id" class="autostatus-preset-card" :class="{ active: status.lastAppliedPresetId === p.id }" :style="{ '--accent': (STATUS_TYPES.find(t => t.value === p.statusType)?.color ?? '#888') }">
          <div class="autostatus-preset-header">
            <span class="autostatus-preset-number">{{ p.id }}</span>
            <span class="autostatus-preset-name">{{ p.name }}</span>
            <div class="autostatus-preset-actions">
              <button class="btn btn-secondary" @click="testPreset(p.id)">Test</button>
              <button class="btn btn-danger" @click="confirmDelete(p.id)">Delete</button>
            </div>
          </div>
          <div class="autostatus-preset-body">
            <div class="form-group">
              <label>Name</label>
              <input type="text" :value="p.name" maxlength="24" @change="onPresetFieldChange(p, 'name', ($event.target as HTMLInputElement).value)" />
            </div>
            <div class="form-group">
              <label>Status Type</label>
              <select :value="p.statusType ?? ''" @change="onPresetFieldChange(p, 'statusType', ($event.target as HTMLSelectElement).value)">
                <option v-for="t in STATUS_TYPES" :key="String(t.value)" :value="t.value ?? ''">{{ t.icon }} {{ t.label }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>Message</label>
              <input type="text" :value="p.statusMessage" maxlength="32" placeholder="Optional status message" @change="onPresetFieldChange(p, 'statusMessage', ($event.target as HTMLInputElement).value)" />
              <small>{{ (p.statusMessage || '').length }}/32</small>
            </div>
          </div>
        </div>
        <button v-if="presets.length < 8" class="autostatus-add-card" @click="createPreset">+ Add Preset</button>
      </div>
    </div>
    <div v-if="confirmDeleteId !== null" class="modal-overlay" @click.self="cancelDelete">
      <div class="modal-content">
        <h3>Delete Preset</h3>
        <p>Delete preset "{{ presets.find(p => p.id === confirmDeleteId)?.name }}"? Schedule entries using it will also be removed.</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="cancelDelete">Cancel</button>
          <button class="btn btn-danger" @click="executeDelete">Delete</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="autostatus-section-header">
        <h3>Schedule Timetable</h3>
        <span>Automatically set status based on day and time.</span>
      </div>
      <div v-if="schedule.length === 0" class="autostatus-empty-state">No schedule entries yet.</div>
      <div v-else class="autostatus-schedule-list">
        <div v-for="entry in schedule" :key="entry.id" class="autostatus-schedule-row" :class="{ disabled: !entry.enabled }">
          <div class="autostatus-schedule-color" :style="{ background: scheduleStatusType(entry)?.color ?? '#95a5a6' }"></div>
          <div class="autostatus-schedule-main">
            <div v-if="editingScheduleId === entry.id" class="autostatus-schedule-edit-row">
              <input v-model="editingScheduleName" @blur="saveScheduleName(entry.id)" @keyup.enter="saveScheduleName(entry.id)" @keyup.escape="editingScheduleId = null" />
            </div>
            <div v-else class="autostatus-schedule-name" @click="startEditScheduleName(entry.id, entry.name)">{{ entry.name || 'Untitled' }}</div>
            <div class="autostatus-schedule-subtext">{{ entry.startTime }} - {{ entry.endTime }}<span v-if="isOvernight(entry)"> (overnight)</span></div>
            <div class="autostatus-schedule-subtext">{{ entry.daysOfWeek.map((d: number) => DAY_LABELS[d]).join(', ') }}</div>
            <div class="autostatus-schedule-fallback">
              <label>Status at end</label>
              <select :value="entry.fallbackStatusType ?? ''" @change="updateSchedule(entry.id, { fallbackStatusType: ($event.target as HTMLSelectElement).value || null })">
                <option value="">None</option>
                <option v-for="t in STATUS_TYPES.filter(t => t.value !== null)" :key="String(t.value)" :value="t.value!">{{ t.icon }} {{ t.label }}</option>
              </select>
            </div>
          </div>
          <div class="autostatus-schedule-preset">{{ scheduleStatusType(entry)?.icon ?? '\u26AA' }} {{ schedulePreset(entry)?.name ?? 'Unknown' }}</div>
          <div class="autostatus-schedule-actions">
            <button class="autostatus-toggle" :class="{ on: entry.enabled }" @click="updateSchedule(entry.id, { enabled: !entry.enabled })">
              <span></span>
            </button>
            <button class="btn btn-danger" @click="deleteSchedule(entry.id)">Remove</button>
          </div>
        </div>
      </div>
      <div v-if="presets.length > 0" class="autostatus-add-schedule-grid">
        <div class="form-group">
          <label>Name</label>
          <input type="text" v-model="newSchedule.name" placeholder="Schedule name (optional)" maxlength="32" />
        </div>
        <div class="form-group autostatus-day-group">
          <label>Days</label>
          <div class="autostatus-day-picker">
            <button v-for="(d, i) in DAY_LABELS" :key="i" type="button" class="autostatus-day-btn" :class="{ active: newDays.has(i) }" @click="toggleDay(i)">{{ d }}</button>
          </div>
        </div>
        <div class="form-group">
          <label>Start</label>
          <input type="time" v-model="newSchedule.startTime" />
        </div>
        <div class="form-group">
          <label>End</label>
          <input type="time" v-model="newSchedule.endTime" />
        </div>
        <div class="form-group">
          <label>Preset</label>
          <select v-model.number="newSchedule.presetId">
            <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }} ({{ STATUS_TYPES.find(t => t.value === p.statusType)?.icon ?? '' }} {{ p.id }})</option>
          </select>
        </div>
        <div class="form-group">
          <label>Status at end</label>
          <select v-model="newSchedule.fallbackStatusType">
            <option value="">None</option>
            <option v-for="t in STATUS_TYPES.filter(t => t.value !== null)" :key="String(t.value)" :value="t.value!">{{ t.icon }} {{ t.label }}</option>
          </select>
        </div>
        <div class="autostatus-add-button-row">
          <button class="btn btn-primary" :disabled="newDays.size === 0" @click="handleAddSchedule">Add Schedule</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Settings</h3>
      <div class="autostatus-settings-grid">
        <div class="form-group">
          <label>Cooldown (seconds)</label>
          <input type="number" min="5" max="120" :value="settings.cooldownSeconds" @change="updateSettings({ cooldownSeconds: parseInt(($event.target as HTMLInputElement).value) })" />
          <small>Minimum time between status changes.</small>
        </div>
        <div class="form-group">
          <label>Time Format</label>
          <select :value="settings.timeFormat" @change="updateSettings({ timeFormat: ($event.target as HTMLSelectElement).value })">
            <option value="24h">24-hour</option>
            <option value="12h">12-hour</option>
          </select>
        </div>
        <label class="autostatus-override-toggle">
          <input type="checkbox" :checked="settings.alwaysAllowOverride" @change="updateSettings({ alwaysAllowOverride: ($event.target as HTMLInputElement).checked })" />
          <span>Always allow status override</span>
        </label>
      </div>
    </div>
    <div class="card">
      <h3>OSC Parameters</h3>
      <div class="autostatus-osc-list">
        <div class="autostatus-osc-item">
          <code>/avatar/parameters/ARCOSC/vrc-status/statuspreset</code>
          <p>Int 0-8. Value 0 does nothing, values 1-8 trigger the corresponding preset.</p>
        </div>
        <div class="autostatus-osc-item">
          <code>/avatar/parameters/ARCOSC/vrc-status</code>
          <p>Int 0-4. 0 = off, 1 = Join Me, 2 = Online, 3 = Ask Me, 4 = Do Not Disturb.</p>
        </div>
      </div>
      <small>Status changes are blocked for 30 seconds after avatar changes.</small>
    </div>
  </div>
</template>

<style scoped>
.autostatus-banner-row,
.autostatus-title-row,
.autostatus-badge-row,
.autostatus-section-header,
.autostatus-preset-header,
.autostatus-preset-actions,
.autostatus-schedule-actions,
.autostatus-add-button-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.autostatus-banner-row,
.autostatus-preset-header,
.autostatus-schedule-row {
  justify-content: space-between;
}
.autostatus-title-row {
  margin-bottom: 6px;
}
.autostatus-icon {
  font-size: 24px;
}
.autostatus-subtitle,
.autostatus-section-header span,
.autostatus-schedule-subtext,
.autostatus-empty-state,
.autostatus-osc-item p {
  color: #7f8c8d;
}
.autostatus-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.autostatus-badge.ok {
  background: #d5f4e6;
  color: #27ae60;
}
.autostatus-badge.warn {
  background: #fef3cd;
  color: #f39c12;
}
.autostatus-badge.error {
  background: #f8d7da;
  color: #c0392b;
}
.autostatus-badge.info {
  background: #e8f4fd;
  color: #3498db;
}
.autostatus-presets-grid,
.autostatus-settings-grid,
.autostatus-add-schedule-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 15px;
}
.autostatus-preset-card {
  border: 1px solid #dee2e6;
  border-left: 4px solid var(--accent, #95a5a6);
  border-radius: 8px;
  padding: 15px;
  background: #f8f9fa;
}
.autostatus-preset-card.active {
  box-shadow: 0 0 0 2px var(--accent, #95a5a6);
}
.autostatus-preset-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: white;
  border: 1px solid #dee2e6;
  font-weight: 700;
}
.autostatus-preset-name {
  flex: 1;
  font-weight: 600;
}
.autostatus-preset-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.autostatus-add-card {
  border: 2px dashed #bdc3c7;
  border-radius: 8px;
  background: transparent;
  padding: 20px;
  font-weight: 600;
  cursor: pointer;
}
.autostatus-empty-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}
.autostatus-schedule-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}
.autostatus-schedule-row {
  display: grid;
  grid-template-columns: 6px 1fr auto auto;
  gap: 15px;
  align-items: center;
  padding: 15px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  background: #f8f9fa;
}
.autostatus-schedule-row.disabled {
  opacity: 0.6;
}
.autostatus-schedule-color {
  align-self: stretch;
  border-radius: 999px;
}
.autostatus-schedule-name {
  font-weight: 600;
  cursor: pointer;
}
.autostatus-schedule-fallback {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.autostatus-schedule-fallback label {
  font-size: 12px;
  color: #7f8c8d;
}
.autostatus-schedule-fallback select,
.autostatus-schedule-edit-row input {
  padding: 6px 8px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
}
.autostatus-toggle {
  position: relative;
  width: 44px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: #95a5a6;
  cursor: pointer;
}
.autostatus-toggle span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s ease;
}
.autostatus-toggle.on {
  background: #27ae60;
}
.autostatus-toggle.on span {
  transform: translateX(20px);
}
.autostatus-day-group {
  grid-column: 1 / -1;
}
.autostatus-day-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.autostatus-day-btn {
  padding: 8px 10px;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  background: #f8f9fa;
  cursor: pointer;
}
.autostatus-day-btn.active {
  background: #3498db;
  border-color: #3498db;
  color: white;
}
.autostatus-add-button-row {
  justify-content: flex-start;
}
.autostatus-override-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.autostatus-osc-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 10px;
}
.autostatus-osc-item code {
  display: inline-block;
  margin-bottom: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #f8f9fa;
}
:global(body.dark-theme) .autostatus-subtitle,
:global(body.dark-theme) .autostatus-section-header span,
:global(body.dark-theme) .autostatus-schedule-subtext,
:global(body.dark-theme) .autostatus-empty-state,
:global(body.dark-theme) .autostatus-osc-item p,
:global(body.dark-theme) .autostatus-schedule-fallback label {
  color: #95a5a6;
}
:global(body.dark-theme) .autostatus-preset-card,
:global(body.dark-theme) .autostatus-schedule-row,
:global(body.dark-theme) .autostatus-day-btn,
:global(body.dark-theme) .autostatus-osc-item code {
  background: #2c3e50;
  border-color: #34495e;
  color: #ecf0f1;
}
:global(body.dark-theme) .autostatus-preset-number,
:global(body.dark-theme) .autostatus-schedule-fallback select,
:global(body.dark-theme) .autostatus-schedule-edit-row input {
  background: #34495e;
  border-color: #34495e;
  color: #ecf0f1;
}
:global(body.dark-theme) .autostatus-add-card {
  border-color: #34495e;
  color: #ecf0f1;
}
</style>
