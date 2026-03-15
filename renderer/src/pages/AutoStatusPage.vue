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
  <div class="page">
    <h2>Auto Status</h2>
    <p class="page-desc">Automatic VRChat status management via OSC parameters and schedules.</p>
    <!-- Status Banner -->
    <div class="banner">
      <div class="banner-left">
        <span class="banner-icon">{{ activeStatusType?.icon ?? '\u26AA' }}</span>
        <div class="banner-info">
          <div class="banner-title">{{ activePreset?.name ?? 'No Active Preset' }}</div>
          <div class="banner-subtitle">
            <template v-if="activePreset">
              {{ activeStatusType?.label ?? activePreset.statusType }}
              <template v-if="activePreset.statusMessage"> &mdash; "{{ activePreset.statusMessage }}"</template>
            </template>
            <template v-else>Waiting for trigger...</template>
          </div>
        </div>
      </div>
      <div class="banner-badges">
        <span v-if="status.externallySet" class="badge badge-warn">External Status</span>
        <span v-if="status.avatarGuardActive" class="badge badge-warn">Avatar Guard</span>
        <span class="badge" :class="status.vrchatApiAvailable ? 'badge-ok' : 'badge-err'">{{ status.vrchatApiAvailable ? 'API Ready' : 'API Offline' }}</span>
        <span class="badge badge-info">OSC: {{ status.lastOscValue ?? 0 }}</span>
      </div>
    </div>
    <!-- Presets Section -->
    <div class="section">
      <div class="section-header">
        <h3>Status Presets</h3>
        <span class="section-hint">Configure up to 8 presets triggered by OSC parameter (int 1-8)</span>
      </div>
      <div v-if="presets.length === 0" class="empty-state">
        <p>No status presets configured yet.</p>
        <p class="empty-hint">Add a preset to get started with automatic status changes.</p>
        <button class="btn" @click="createPreset">+ Add Preset</button>
      </div>
      <div class="presets-grid" v-else>
        <div v-for="p in presets" :key="p.id" class="preset-card" :class="{ active: status.lastAppliedPresetId === p.id }" :style="{ '--accent': (STATUS_TYPES.find(t => t.value === p.statusType)?.color ?? '#888') }">
          <div class="preset-header">
            <span class="preset-num">{{ p.id }}</span>
            <span class="preset-name">{{ p.name }}</span>
            <div class="preset-actions">
              <button class="icon-btn" @click="testPreset(p.id)" title="Test">&#9654;</button>
              <button class="icon-btn icon-btn-danger" @click="confirmDelete(p.id)" title="Delete">&times;</button>
            </div>
          </div>
          <div class="preset-body">
            <div class="field">
              <label>Name</label>
              <input type="text" :value="p.name" maxlength="24" @change="onPresetFieldChange(p, 'name', ($event.target as HTMLInputElement).value)" />
            </div>
            <div class="field">
              <label>Status Type</label>
              <select :value="p.statusType ?? ''" @change="onPresetFieldChange(p, 'statusType', ($event.target as HTMLSelectElement).value)">
                <option v-for="t in STATUS_TYPES" :key="String(t.value)" :value="t.value ?? ''">{{ t.icon }} {{ t.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>Message <small class="char-count">{{ (p.statusMessage || '').length }}/32</small></label>
              <input type="text" :value="p.statusMessage" maxlength="32" placeholder="Optional status message" @change="onPresetFieldChange(p, 'statusMessage', ($event.target as HTMLInputElement).value)" />
            </div>
          </div>
        </div>
        <div v-if="presets.length < 8" class="preset-add-card" @click="createPreset">
          <span>+ Add Preset</span>
        </div>
      </div>
    </div>
    <!-- Delete Confirm Modal -->
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
    <!-- Schedule Section -->
    <div class="section">
      <div class="section-header">
        <h3>Schedule Timetable</h3>
        <span class="section-hint">Automatically set status based on day and time</span>
      </div>
      <div v-if="schedule.length === 0" class="empty-hint">No schedule entries yet. Add one below to automate status changes by time of day.</div>
      <div class="schedule-list">
        <div v-for="entry in schedule" :key="entry.id" class="schedule-row" :class="{ disabled: !entry.enabled }">
          <div class="schedule-color" :style="{ background: scheduleStatusType(entry)?.color ?? '#95a5a6' }"></div>
          <div class="schedule-details">
            <div class="schedule-name" v-if="editingScheduleId === entry.id">
              <input class="inline-edit" v-model="editingScheduleName" @blur="saveScheduleName(entry.id)" @keyup.enter="saveScheduleName(entry.id)" @keyup.escape="editingScheduleId = null" />
            </div>
            <div class="schedule-name clickable" v-else @click="startEditScheduleName(entry.id, entry.name)">{{ entry.name || 'Untitled' }}</div>
            <div class="schedule-time">{{ entry.startTime }} &mdash; {{ entry.endTime }}<small v-if="isOvernight(entry)"> (overnight)</small></div>
            <div class="schedule-days">{{ entry.daysOfWeek.map((d: number) => DAY_LABELS[d]).join(', ') }}</div>
            <div class="schedule-fallback">
              <label>Status at end:</label>
              <select :value="entry.fallbackStatusType ?? ''" @change="updateSchedule(entry.id, { fallbackStatusType: ($event.target as HTMLSelectElement).value || null })">
                <option value="">None</option>
                <option v-for="t in STATUS_TYPES.filter(t => t.value !== null)" :key="String(t.value)" :value="t.value!">{{ t.icon }} {{ t.label }}</option>
              </select>
            </div>
          </div>
          <div class="schedule-preset">{{ scheduleStatusType(entry)?.icon ?? '\u26AA' }} {{ schedulePreset(entry)?.name ?? 'Unknown' }}</div>
          <div class="schedule-actions">
            <button class="toggle-switch" :class="{ on: entry.enabled }" @click="updateSchedule(entry.id, { enabled: !entry.enabled })">
              <span class="toggle-knob"></span>
            </button>
            <button class="icon-btn icon-btn-danger" @click="deleteSchedule(entry.id)">&times;</button>
          </div>
        </div>
      </div>
      <!-- Add Schedule Form -->
      <div class="schedule-add card" v-if="presets.length > 0">
        <div class="schedule-add-grid">
          <div class="field">
            <label>Name</label>
            <input type="text" v-model="newSchedule.name" placeholder="Schedule name (optional)" maxlength="32" />
          </div>
          <div class="field">
            <label>Days</label>
            <div class="day-picker">
              <button v-for="(d, i) in DAY_LABELS" :key="i" class="day-btn" :class="{ 'day-active': newDays.has(i) }" @click="toggleDay(i)">{{ d }}</button>
            </div>
          </div>
          <div class="field">
            <label>Start</label>
            <input type="time" v-model="newSchedule.startTime" />
          </div>
          <div class="field">
            <label>End</label>
            <input type="time" v-model="newSchedule.endTime" />
          </div>
          <div class="field">
            <label>Preset</label>
            <select v-model.number="newSchedule.presetId">
              <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }} ({{ STATUS_TYPES.find(t => t.value === p.statusType)?.icon ?? '' }} {{ p.id }})</option>
            </select>
          </div>
          <div class="field">
            <label>Status at end</label>
            <select v-model="newSchedule.fallbackStatusType">
              <option value="">None</option>
              <option v-for="t in STATUS_TYPES.filter(t => t.value !== null)" :key="String(t.value)" :value="t.value!">{{ t.icon }} {{ t.label }}</option>
            </select>
          </div>
          <div class="field field-action">
            <button class="btn btn-small" :disabled="newDays.size === 0" @click="handleAddSchedule">Add</button>
          </div>
        </div>
      </div>
    </div>
    <!-- Settings Section -->
    <div class="section">
      <div class="section-header">
        <h3>Settings</h3>
      </div>
      <div class="settings-grid card">
        <div class="field">
          <label>Cooldown (seconds)</label>
          <input type="number" min="5" max="120" :value="settings.cooldownSeconds" @change="updateSettings({ cooldownSeconds: parseInt(($event.target as HTMLInputElement).value) })" />
          <small>Minimum time between status changes</small>
        </div>
        <div class="field">
          <label>Time Format</label>
          <select :value="settings.timeFormat" @change="updateSettings({ timeFormat: ($event.target as HTMLSelectElement).value })">
            <option value="24h">24-hour</option>
            <option value="12h">12-hour</option>
          </select>
        </div>
        <div class="field checkbox-field">
          <label>
            <input type="checkbox" :checked="settings.alwaysAllowOverride" @change="updateSettings({ alwaysAllowOverride: ($event.target as HTMLInputElement).checked })" />
            Always allow status override
          </label>
          <small>When enabled, ARC will change your status even if it was set externally.</small>
        </div>
      </div>
      <div class="osc-info card">
        <strong>OSC Parameters:</strong>
        <div class="osc-params">
          <div class="osc-param">
            <code>/avatar/parameters/ARCOSC/vrc-status/statuspreset</code> <small>(Int, 0-8)</small><br />
            <small>Value 0 = no action. Values 1-8 trigger the corresponding preset.</small>
          </div>
          <div class="osc-param">
            <code>/avatar/parameters/ARCOSC/vrc-status</code> <small>(Int, 0-4)</small><br />
            <small>0 = off, 1 = Join Me, 2 = Online, 3 = Ask Me, 4 = Do Not Disturb</small>
          </div>
        </div>
        <small>Status changes are blocked for 30 seconds after avatar changes.</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-desc {
  color: #999;
  margin-bottom: 1rem;
}
/* Banner */
.banner {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.banner-left {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.banner-icon {
  font-size: 1.8rem;
}
.banner-title {
  font-weight: 600;
  color: #fff;
  font-size: 1.05rem;
}
.banner-subtitle {
  color: #999;
  font-size: 0.85rem;
}
.banner-badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.badge {
  font-size: 0.7rem;
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 600;
}
.badge-ok {
  background: #2ecc7133;
  color: #2ecc71;
}
.badge-err {
  background: #e74c3c33;
  color: #e74c3c;
}
.badge-warn {
  background: #f39c1233;
  color: #f39c12;
}
.badge-info {
  background: #3498db33;
  color: #3498db;
}
/* Sections */
.section {
  margin-bottom: 1.5rem;
}
.section-header {
  display: flex;
  align-items: baseline;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}
.section-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #ccc;
}
.section-hint {
  color: #666;
  font-size: 0.8rem;
}
.empty-state {
  text-align: center;
  padding: 2rem;
  color: #666;
}
.empty-hint {
  color: #555;
  font-size: 0.85rem;
}
/* Presets grid */
.presets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.8rem;
}
.preset-card {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 0.8rem 1rem;
  border-left: 3px solid var(--accent, #888);
}
.preset-card.active {
  box-shadow: 0 0 0 1px var(--accent, #888);
}
.preset-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.preset-num {
  background: #2a2a3e;
  color: #ccc;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  flex-shrink: 0;
}
.preset-name {
  flex: 1;
  font-weight: 600;
  color: #fff;
}
.preset-actions {
  display: flex;
  gap: 0.3rem;
}
.preset-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.preset-add-card {
  background: #1e1e2e;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  cursor: pointer;
  color: #666;
  border: 2px dashed #333;
}
.preset-add-card:hover {
  border-color: #5865f2;
  color: #5865f2;
}
/* Form fields */
.field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.field label {
  color: #999;
  font-size: 0.8rem;
}
.field input[type="text"],
.field input[type="number"],
.field input[type="time"],
.field select {
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  color: #fff;
  font-size: 0.85rem;
}
.field input:focus,
.field select:focus {
  outline: none;
  border-color: #5865f2;
}
.field small {
  color: #666;
  font-size: 0.75rem;
}
.char-count {
  color: #666;
  float: right;
}
.checkbox-field label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  color: #ccc;
}
/* Schedule */
.schedule-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.schedule-row {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.schedule-row.disabled {
  opacity: 0.5;
}
.schedule-color {
  width: 4px;
  height: 40px;
  border-radius: 2px;
  flex-shrink: 0;
}
.schedule-details {
  flex: 1;
  min-width: 0;
}
.schedule-name {
  font-weight: 600;
  color: #fff;
  font-size: 0.9rem;
}
.schedule-name.clickable {
  cursor: pointer;
}
.schedule-name.clickable:hover {
  text-decoration: underline;
}
.inline-edit {
  background: #2a2a3e;
  border: 1px solid #5865f2;
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  color: #fff;
  font-size: 0.85rem;
  width: 150px;
}
.schedule-time {
  color: #999;
  font-size: 0.8rem;
}
.schedule-days {
  color: #666;
  font-size: 0.8rem;
}
.schedule-fallback {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.2rem;
}
.schedule-fallback label {
  color: #666;
  font-size: 0.75rem;
  white-space: nowrap;
}
.schedule-fallback select {
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  color: #fff;
  font-size: 0.75rem;
}
.schedule-preset {
  color: #ccc;
  font-size: 0.85rem;
  white-space: nowrap;
}
.schedule-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
/* Toggle switch */
.toggle-switch {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: #555;
  border: none;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  padding: 0;
}
.toggle-switch.on {
  background: #4caf50;
}
.toggle-knob {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: left 0.2s;
}
.toggle-switch.on .toggle-knob {
  left: 18px;
}
/* Schedule add form */
.schedule-add {
  margin-top: 0.5rem;
}
.schedule-add-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  align-items: flex-end;
}
.day-picker {
  display: flex;
  gap: 0.2rem;
}
.day-btn {
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 4px;
  color: #999;
  padding: 0.25rem 0.45rem;
  cursor: pointer;
  font-size: 0.75rem;
}
.day-btn.day-active {
  background: #5865f2;
  border-color: #5865f2;
  color: #fff;
}
.field-action {
  justify-content: flex-end;
}
/* Settings */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}
.osc-info {
  margin-top: 1rem;
}
.osc-params {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.osc-param code {
  background: #2a2a3e;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #e94560;
}
/* Card */
.card {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 1rem;
}
/* Icon buttons */
.icon-btn {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
}
.icon-btn:hover {
  background: #2a2a3e;
  color: #fff;
}
.icon-btn-danger:hover {
  color: #e74c3c;
}
/* Buttons */
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
  padding: 0.3rem 0.8rem;
  font-size: 0.85rem;
}
.btn-danger {
  background: #e74c3c;
}
.btn-secondary {
  background: #555;
}
/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 400px;
  width: 90%;
}
.modal-content h3 {
  margin: 0 0 0.8rem;
  color: #fff;
}
.modal-content p {
  color: #999;
  margin-bottom: 1rem;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
