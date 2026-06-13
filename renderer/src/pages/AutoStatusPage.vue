<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useAutoStatus, STATUS_TYPES, DAY_LABELS, INSTANCE_TYPES } from '../composables/useAutoStatus'
import type { Preset, ScheduleEntry, LocationRule } from '../composables/useAutoStatus'

const {
  presets,
  schedule,
  locationRules,
  settings,
  status,
  createPreset,
  updatePreset,
  deletePreset,
  testPreset,
  addSchedule,
  updateSchedule,
  deleteSchedule,
  createLocationRule,
  updateLocationRule,
  deleteLocationRule,
  updateSettings
} = useAutoStatus()

const activePreset = computed(() => {
  if (!status.value.lastAppliedPresetId) return null
  return presets.value.find((preset) => preset.id === status.value.lastAppliedPresetId) ?? null
})

const currentStatusType = computed(() => {
  return STATUS_TYPES.find((type) => type.value === status.value.currentStatus) ?? null
})

const bannerTitle = computed(() => {
  return activePreset.value?.name ?? currentStatusType.value?.label ?? 'No Active Preset'
})

const bannerSubtitle = computed(() => {
  if (status.value.currentStatusDescription) return status.value.currentStatusDescription
  if (currentStatusType.value) return currentStatusType.value.label
  return 'Waiting for trigger...'
})

const newSchedule = ref({
  name: '',
  startTime: '09:00',
  endTime: '17:00',
  presetId: 0,
  fallbackStatusType: ''
})

const newDays = ref<Set<number>>(new Set())
const confirmDeleteId = ref<number | null>(null)
const editingScheduleId = ref<string | null>(null)
const editingScheduleName = ref('')
const confirmDeleteLocationRuleId = ref<string | null>(null)
const openAccessTypeDropdown = ref<string | null>(null)
const isDarkTheme = ref(false)
let themeObserver: MutationObserver | null = null

function syncThemeState() {
  if (typeof document === 'undefined') return
  isDarkTheme.value = document.body.classList.contains('dark-theme')
}

function onPresetFieldChange(preset: Preset, field: keyof Preset, value: string | null) {
  const updated = {
    ...preset,
    [field]: field === 'statusType' && value === '' ? null : value
  }
  void updatePreset(updated)
}

function toggleDay(day: number) {
  const updated = new Set(newDays.value)
  if (updated.has(day)) {
    updated.delete(day)
  } else {
    updated.add(day)
  }
  newDays.value = updated
}

async function handleAddSchedule() {
  if (newDays.value.size === 0) return
  if (!newSchedule.value.startTime || !newSchedule.value.endTime) return

  const presetId = newSchedule.value.presetId || (presets.value[0]?.id ?? 0)
  if (!presetId) return

  await addSchedule({
    daysOfWeek: Array.from(newDays.value).sort(),
    startTime: newSchedule.value.startTime,
    endTime: newSchedule.value.endTime,
    presetId,
    name: newSchedule.value.name,
    fallbackStatusType: newSchedule.value.fallbackStatusType || null
  })

  newSchedule.value = {
    name: '',
    startTime: '09:00',
    endTime: '17:00',
    presetId: 0,
    fallbackStatusType: ''
  }
  newDays.value = new Set()
}

function beginDeletePreset(id: number) {
  confirmDeleteId.value = id
}

async function executeDelete() {
  if (confirmDeleteId.value === null) return
  await deletePreset(confirmDeleteId.value)
  confirmDeleteId.value = null
}

function cancelDelete() {
  confirmDeleteId.value = null
}

function schedulePreset(entry: ScheduleEntry) {
  return presets.value.find((preset) => preset.id === entry.presetId)
}

function scheduleStatusType(entry: ScheduleEntry) {
  const preset = schedulePreset(entry)
  return preset ? STATUS_TYPES.find((type) => type.value === preset.statusType) ?? null : null
}

function isOvernight(entry: ScheduleEntry) {
  return entry.endTime <= entry.startTime
}

function startEditScheduleName(entryId: string, name: string) {
  editingScheduleId.value = entryId
  editingScheduleName.value = name || ''
}

async function saveScheduleName(entryId: string) {
  await updateSchedule(entryId, { name: editingScheduleName.value.trim() })
  editingScheduleId.value = null
  editingScheduleName.value = ''
}

function locationRulePreset(rule: LocationRule) {
  return presets.value.find((preset) => preset.id === rule.presetId)
}

function locationRuleStatusType(rule: LocationRule) {
  const preset = locationRulePreset(rule)
  return preset ? STATUS_TYPES.find((type) => type.value === preset.statusType) ?? null : null
}

function onLocationRuleFieldChange(rule: LocationRule, field: keyof LocationRule, value: string | number | boolean | null) {
  void updateLocationRule(rule.id, { [field]: value })
}

function toggleAccessType(rule: LocationRule, typeValue: string) {
  const current = rule.matchAccessTypes || []
  const updated = current.includes(typeValue) ? current.filter(t => t !== typeValue) : [...current, typeValue]
  void updateLocationRule(rule.id, { matchAccessTypes: updated })
}

function toggleAccessTypeDropdown(ruleId: string) {
  openAccessTypeDropdown.value = openAccessTypeDropdown.value === ruleId ? null : ruleId
}

function closeAccessTypeDropdown() {
  openAccessTypeDropdown.value = null
}

function onDocumentClick() {
  openAccessTypeDropdown.value = null
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  syncThemeState()
  themeObserver = new MutationObserver(syncThemeState)
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  themeObserver?.disconnect()
})

function beginDeleteLocationRule(id: string) {
  confirmDeleteLocationRuleId.value = id
}

async function executeDeleteLocationRule() {
  if (confirmDeleteLocationRuleId.value === null) return
  await deleteLocationRule(confirmDeleteLocationRuleId.value)
  confirmDeleteLocationRuleId.value = null
}

function cancelDeleteLocationRule() {
  confirmDeleteLocationRuleId.value = null
}

function formatAccessType(types: string[] | null): string {
  if (!types || types.length === 0) return 'Any'
  return types.map(t => {
    const found = INSTANCE_TYPES.find(it => it.value === t)
    return found ? found.label : t
  }).join(', ')
}
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>Auto-Status</h1>
      <p>Manage VRChat status presets and scheduling</p>
      <p><b>Note: Please note this feature is experimental in client, It might break.</b></p>
    </div>

    <div class="autostatus-banner">
      <div class="autostatus-banner-left">
        <div class="autostatus-banner-icon">{{ currentStatusType?.icon ?? '\u26AA' }}</div>
        <div>
          <div class="autostatus-banner-title">{{ bannerTitle }}</div>
          <div class="autostatus-banner-subtitle">{{ bannerSubtitle }}</div>
        </div>
      </div>
      <div class="autostatus-banner-right">
        <span v-if="status.externallySet" class="autostatus-badge autostatus-badge-warn">External Status</span>
        <span v-if="status.avatarGuardActive" class="autostatus-badge autostatus-badge-warn">Avatar Guard</span>
        <span class="autostatus-badge" :class="status.vrchatApiAvailable ? 'autostatus-badge-ok' : 'autostatus-badge-err'">{{ status.vrchatApiAvailable ? 'API Ready' : 'API Offline' }}</span>
        <span class="autostatus-badge autostatus-badge-info">OSC: {{ status.lastOscValue ?? 0 }}</span>
      </div>
    </div>

    <div class="autostatus-section">
      <div class="autostatus-section-header">
        <h3>Status Presets</h3>
        <span class="autostatus-section-hint">Configure up to 8 presets triggered by OSC parameter (int 1-8)</span>
      </div>

      <div v-if="presets.length === 0" class="autostatus-presets-empty">
        <div class="autostatus-presets-empty-icon">&#9881;</div>
        <p>No status presets configured yet.</p>
        <p><small>Add a preset to get started with automatic status changes.</small></p>
        <button class="btn btn-primary" @click="createPreset">+ Add Preset</button>
      </div>

      <div v-else class="autostatus-presets-grid">
        <div
          v-for="preset in presets"
          :key="preset.id"
          class="autostatus-preset-card"
          :class="{ 'autostatus-preset-active': status.lastAppliedPresetId === preset.id }"
          :style="{ '--preset-accent': (STATUS_TYPES.find((type) => type.value === preset.statusType)?.color ?? '#888888') }"
        >
          <div class="autostatus-preset-header">
            <div class="autostatus-preset-meta">
              <span class="autostatus-preset-number">{{ preset.id }}</span>
              <span class="autostatus-preset-name-display">{{ preset.name }}</span>
            </div>
            <div class="autostatus-preset-actions">
              <button class="autostatus-icon-btn" title="Test" @click="testPreset(preset.id)">&#9654;</button>
              <button class="autostatus-icon-btn autostatus-icon-btn-danger" title="Delete" @click="beginDeletePreset(preset.id)">&#10005;</button>
            </div>
          </div>

          <div class="autostatus-preset-body">
            <div class="autostatus-field">
              <label>Name</label>
              <input type="text" :value="preset.name" maxlength="24" @change="onPresetFieldChange(preset, 'name', ($event.target as HTMLInputElement).value)" />
            </div>

            <div class="autostatus-field">
              <label>Status Type</label>
              <select :value="preset.statusType ?? ''" @change="onPresetFieldChange(preset, 'statusType', ($event.target as HTMLSelectElement).value)">
                <option v-for="type in STATUS_TYPES" :key="String(type.value)" :value="type.value ?? ''">{{ type.icon }} {{ type.label }}</option>
              </select>
            </div>

            <div class="autostatus-field">
              <label>
                Message
                <small class="autostatus-char-count">{{ (preset.statusMessage || '').length }}/32</small>
              </label>
              <input type="text" :value="preset.statusMessage" maxlength="32" placeholder="Optional status message" @change="onPresetFieldChange(preset, 'statusMessage', ($event.target as HTMLInputElement).value)" />
            </div>
          </div>
        </div>

        <div v-if="presets.length < 8" class="autostatus-preset-add-card" @click="createPreset">
          <span>+ Add Preset</span>
        </div>
      </div>
    </div>

    <div v-if="confirmDeleteId !== null" class="modal-overlay" @click.self="cancelDelete">
      <div class="modal-content">
        <div class="modal-header"><h3>Delete Preset</h3></div>
        <div class="modal-body">
          <p>Delete preset "{{ presets.find((preset) => preset.id === confirmDeleteId)?.name }}"? Schedule entries using it will also be removed.</p>
        </div>
        <div class="modal-footer autostatus-modal-actions">
          <button class="btn btn-secondary" @click="cancelDelete">Cancel</button>
          <button class="btn btn-danger" @click="executeDelete">Delete</button>
        </div>
      </div>
    </div>

    <div class="autostatus-section">
      <div class="autostatus-section-header">
        <h3>Location Rules</h3>
        <span class="autostatus-section-hint">Automatically set status based on VRChat world, group, and instance type</span>
      </div>

      <div v-if="status.locationRunning" class="autostatus-location-status">
        <span class="autostatus-badge autostatus-badge-ok">
          {{ status.locationSource === 'log-watcher' ? 'Log Watcher' : 'VRCX' }}
        </span>
        <span v-if="status.currentWorldName" class="autostatus-badge autostatus-badge-info">{{ status.currentWorldName }}</span>
        <span v-if="status.currentAccessType" class="autostatus-badge autostatus-badge-info">{{ formatAccessType([status.currentAccessType]) }}</span>
        <span v-if="status.currentGroupName" class="autostatus-badge autostatus-badge-info">{{ status.currentGroupName }}</span>
      </div>

      <div v-if="locationRules.length === 0" class="autostatus-presets-empty">
        <div class="autostatus-presets-empty-icon">&#127759;</div>
        <p>No location rules configured yet.</p>
        <p><small>Add a rule to automatically change status when you enter a specific world or instance type.</small></p>
        <button class="btn btn-primary" @click="createLocationRule">+ Add Location Rule</button>
      </div>

      <div v-else class="autostatus-presets-grid">
        <div
          v-for="rule in locationRules"
          :key="rule.id"
          class="autostatus-preset-card"
          :class="{ 'autostatus-schedule-disabled': !rule.enabled }"
          :style="{ '--preset-accent': (locationRuleStatusType(rule)?.color ?? '#95a5a6') }"
        >
          <div class="autostatus-preset-header">
            <div class="autostatus-preset-meta">
              <span class="autostatus-preset-number" :style="{ background: locationRuleStatusType(rule)?.color ?? '#95a5a6' }">L</span>
              <span class="autostatus-preset-name-display">{{ rule.name || 'Untitled Rule' }}</span>
            </div>
            <div class="autostatus-preset-actions">
              <div class="autostatus-toggle" :class="{ 'autostatus-toggle-on': rule.enabled }" @click="onLocationRuleFieldChange(rule, 'enabled', !rule.enabled)">
                <div class="autostatus-toggle-knob"></div>
              </div>
              <button class="autostatus-icon-btn autostatus-icon-btn-danger" title="Delete" @click="beginDeleteLocationRule(rule.id)">&#10005;</button>
            </div>
          </div>

          <div class="autostatus-preset-body">
            <div class="autostatus-field">
              <label>Name</label>
              <input type="text" :value="rule.name" maxlength="32" placeholder="Rule name" @change="onLocationRuleFieldChange(rule, 'name', ($event.target as HTMLInputElement).value)" />
            </div>

            <div class="autostatus-field">
              <label>World Name</label>
              <div class="autostatus-match-row">
                <input type="text" :value="rule.matchWorld" maxlength="64" placeholder="Any world" @change="onLocationRuleFieldChange(rule, 'matchWorld', ($event.target as HTMLInputElement).value)" />
                <select :value="rule.matchWorldMode" @change="onLocationRuleFieldChange(rule, 'matchWorldMode', ($event.target as HTMLSelectElement).value)">
                  <option value="contains">Contains</option>
                  <option value="exact">Exact</option>
                </select>
              </div>
            </div>

            <div class="autostatus-field">
              <label>Group Name</label>
              <div class="autostatus-match-row">
                <input type="text" :value="rule.matchGroup" maxlength="64" placeholder="Any group" @change="onLocationRuleFieldChange(rule, 'matchGroup', ($event.target as HTMLInputElement).value)" />
                <select :value="rule.matchGroupMode" @change="onLocationRuleFieldChange(rule, 'matchGroupMode', ($event.target as HTMLSelectElement).value)">
                  <option value="contains">Contains</option>
                  <option value="exact">Exact</option>
                </select>
              </div>
            </div>

            <div class="autostatus-field">
              <label>Instance Type</label>
              <div class="autostatus-dropdown-wrap">
                <div class="autostatus-dropdown-trigger" :style="{ background: isDarkTheme ? '#1e1e1e' : '#fafafa', borderColor: isDarkTheme ? '#454545' : '#e0e0e0', color: isDarkTheme ? '#ecf0f1' : '#2c3e50' }" @click.stop="toggleAccessTypeDropdown(rule.id)">
                  <span class="autostatus-dropdown-value">{{ formatAccessType(rule.matchAccessTypes) }}</span>
                  <span class="autostatus-dropdown-arrow">&#9662;</span>
                </div>
                <div v-if="openAccessTypeDropdown === rule.id" class="autostatus-dropdown-menu" :style="{ background: isDarkTheme ? '#2b2b2b' : '#fff', borderColor: isDarkTheme ? '#454545' : '#e0e0e0', boxShadow: isDarkTheme ? '0 4px 16px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.12)' }">
                  <label v-for="type in INSTANCE_TYPES" :key="type.value" class="autostatus-dropdown-item" :style="{ color: isDarkTheme ? '#ecf0f1' : '#2c3e50', background: 'transparent' }" @mouseenter="$event.target.style.background = isDarkTheme ? '#3a3a4a' : '#f0f7ff'" @mouseleave="$event.target.style.background = 'transparent'" @click.stop>
                    <input type="checkbox" :checked="(rule.matchAccessTypes || []).includes(type.value)" @change="toggleAccessType(rule, type.value)" />
                    {{ type.label }}
                  </label>
                </div>
              </div>
            </div>

            <div class="autostatus-field">
              <label>Preset</label>
              <select :value="rule.presetId" @change="onLocationRuleFieldChange(rule, 'presetId', parseInt(($event.target as HTMLSelectElement).value, 10))">
                <template v-if="presets.length > 0">
                  <option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }} ({{ preset.id }})</option>
                </template>
                <option v-else disabled>No presets configured</option>
              </select>
            </div>

            <div class="autostatus-field">
              <label>Fallback on Leave</label>
              <select :value="rule.fallbackStatusType ?? ''" @change="onLocationRuleFieldChange(rule, 'fallbackStatusType', ($event.target as HTMLSelectElement).value || null)">
                <option value="">None</option>
                <option v-for="type in STATUS_TYPES.filter((item) => item.value !== null)" :key="String(type.value)" :value="type.value!">{{ type.icon }} {{ type.label }}</option>
              </select>
            </div>
          </div>
        </div>

        <div v-if="locationRules.length < 8" class="autostatus-preset-add-card" @click="createLocationRule">
          <span>+ Add Location Rule</span>
        </div>
      </div>
    </div>

    <div v-if="confirmDeleteLocationRuleId !== null" class="modal-overlay" @click.self="cancelDeleteLocationRule">
      <div class="modal-content">
        <div class="modal-header"><h3>Delete Location Rule</h3></div>
        <div class="modal-body">
          <p>Delete location rule "{{ locationRules.find((r) => r.id === confirmDeleteLocationRuleId)?.name }}"?</p>
        </div>
        <div class="modal-footer autostatus-modal-actions">
          <button class="btn btn-secondary" @click="cancelDeleteLocationRule">Cancel</button>
          <button class="btn btn-danger" @click="executeDeleteLocationRule">Delete</button>
        </div>
      </div>
    </div>

    <div class="autostatus-section">
      <div class="autostatus-section-header">
        <h3>Schedule Timetable</h3>
        <span class="autostatus-section-hint">Automatically set status based on day and time</span>
      </div>

      <div class="autostatus-schedule-list">
        <div v-if="schedule.length === 0" class="autostatus-schedule-empty">No schedule entries yet. Add one below to automate status changes by time of day.</div>
        <div v-for="entry in schedule" :key="entry.id" class="autostatus-schedule-row" :class="{ 'autostatus-schedule-disabled': !entry.enabled }">
          <div class="autostatus-schedule-color" :style="{ background: scheduleStatusType(entry)?.color ?? '#95a5a6' }"></div>

          <div class="autostatus-schedule-details">
            <div v-if="editingScheduleId === entry.id" class="autostatus-schedule-edit-row">
              <input v-model="editingScheduleName" @blur="saveScheduleName(entry.id)" @keyup.enter="saveScheduleName(entry.id)" @keyup.escape="editingScheduleId = null" />
            </div>
            <div v-else class="autostatus-schedule-name" @click="startEditScheduleName(entry.id, entry.name)">{{ entry.name || 'Untitled' }}</div>
            <div class="autostatus-schedule-time">
              {{ entry.startTime }} — {{ entry.endTime }}
              <small v-if="isOvernight(entry)">(overnight)</small>
            </div>
            <div class="autostatus-schedule-days">{{ entry.daysOfWeek.map((day) => DAY_LABELS[day]).join(', ') }}</div>
            <div class="autostatus-schedule-fallback">
              <label>Status at end:</label>
              <select class="autostatus-fallback-select" :value="entry.fallbackStatusType ?? ''" @change="updateSchedule(entry.id, { fallbackStatusType: ($event.target as HTMLSelectElement).value || null })">
                <option value="">None</option>
                <option v-for="type in STATUS_TYPES.filter((item) => item.value !== null)" :key="String(type.value)" :value="type.value!">{{ type.icon }} {{ type.label }}</option>
              </select>
            </div>
          </div>

          <div class="autostatus-schedule-preset">{{ scheduleStatusType(entry)?.icon ?? '\u26AA' }} {{ schedulePreset(entry)?.name ?? 'Unknown' }}</div>

          <div class="autostatus-schedule-actions">
            <div class="autostatus-toggle" :class="{ 'autostatus-toggle-on': entry.enabled }" @click="updateSchedule(entry.id, { enabled: !entry.enabled })">
              <div class="autostatus-toggle-knob"></div>
            </div>
            <button class="autostatus-icon-btn autostatus-icon-btn-danger" title="Remove" @click="deleteSchedule(entry.id)">&#10005;</button>
          </div>
        </div>
      </div>

      <div class="autostatus-schedule-add card">
        <div class="autostatus-schedule-add-row">
          <div class="autostatus-field">
            <label>Name</label>
            <input v-model="newSchedule.name" type="text" placeholder="Schedule name (optional)" maxlength="32" />
          </div>

          <div class="autostatus-field autostatus-field-days">
            <label>Days</label>
            <div class="autostatus-day-picker">
              <button v-for="(label, index) in DAY_LABELS" :key="index" type="button" class="autostatus-day-btn" :class="{ 'autostatus-day-active': newDays.has(index) }" @click="toggleDay(index)">{{ label }}</button>
            </div>
          </div>

          <div class="autostatus-field">
            <label>Start</label>
            <input v-model="newSchedule.startTime" type="time" />
          </div>

          <div class="autostatus-field">
            <label>End</label>
            <input v-model="newSchedule.endTime" type="time" />
          </div>

          <div class="autostatus-field">
            <label>Preset</label>
            <select v-model.number="newSchedule.presetId">
              <template v-if="presets.length > 0">
                <option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }} ({{ STATUS_TYPES.find((type) => type.value === preset.statusType)?.icon ?? '' }} {{ preset.id }})</option>
              </template>
              <option v-else disabled>No presets configured</option>
            </select>
          </div>

          <div class="autostatus-field">
            <label>Status at end of schedule</label>
            <select v-model="newSchedule.fallbackStatusType">
              <option value="">None</option>
              <option v-for="type in STATUS_TYPES.filter((item) => item.value !== null)" :key="String(type.value)" :value="type.value!">{{ type.icon }} {{ type.label }}</option>
            </select>
          </div>

          <div class="autostatus-field autostatus-field-action">
            <button class="btn btn-primary btn-small" :disabled="newDays.size === 0 || presets.length === 0" @click="handleAddSchedule">Add</button>
          </div>
        </div>
      </div>
    </div>

    <div class="autostatus-section">
      <div class="autostatus-section-header">
        <h3>Settings</h3>
      </div>

      <div class="card">
        <div class="autostatus-settings-grid">
          <div class="autostatus-field">
            <label>Cooldown (seconds)</label>
            <input type="number" min="5" max="120" :value="settings.cooldownSeconds" @change="updateSettings({ cooldownSeconds: parseInt(($event.target as HTMLInputElement).value, 10) })" />
            <small>Minimum time between status changes</small>
          </div>

          <div class="autostatus-field">
            <label>Time Format</label>
            <select :value="settings.timeFormat" @change="updateSettings({ timeFormat: ($event.target as HTMLSelectElement).value })">
              <option value="24h">24-hour</option>
              <option value="12h">12-hour</option>
            </select>
          </div>

          <div class="autostatus-field">
            <label class="autostatus-override-label">
              <input type="checkbox" :checked="settings.alwaysAllowOverride" @change="updateSettings({ alwaysAllowOverride: ($event.target as HTMLInputElement).checked })" />
              Always allow status override
            </label>
            <small>When enabled, ARC will change your status even if it was set externally (via VRChat website or in-game). When disabled, ARC pauses automatic status changes until the next manual or OSC trigger.</small>
          </div>

          <div class="autostatus-field">
            <label class="autostatus-override-label">
              <input type="checkbox" :checked="settings.returnToInitial" @change="updateSettings({ returnToInitial: ($event.target as HTMLInputElement).checked })" />
              Return to initial status
            </label>
            <small>When enabled, ARC reverts your VRChat status to what it was before ARC made any changes, whenever a schedule ends or you leave a matched location.</small>
          </div>

          <div class="autostatus-field">
            <label>Priority</label>
            <select :value="settings.prioritySource" @change="updateSettings({ prioritySource: ($event.target as HTMLSelectElement).value })">
              <option value="schedule">Schedule over Location</option>
              <option value="location">Location over Schedule</option>
            </select>
            <small>When both a schedule and a location rule match at the same time, the higher priority source determines your status.</small>
          </div>
        </div>

        <div class="autostatus-info-box">
          <strong>OSC Parameters:</strong><br />
          <div class="autostatus-osc-params">
            <div class="autostatus-osc-param">
              <code>/avatar/parameters/ARCOSC/vrc-status/statuspreset</code> <small>(Int, 0-8)</small><br />
              <small>Value 0 = no action. Values 1-8 trigger the corresponding preset.</small>
            </div>
            <div class="autostatus-osc-param">
              <code>/avatar/parameters/ARCOSC/vrc-status</code> <small>(Int, 0-4)</small><br />
              <small>0 = off, 1 = 🔵 Join Me, 2 = 🟢 Online, 3 = 🟠 Ask Me, 4 = 🔴 Do Not Disturb</small>
            </div>
          </div>
          <small>Status changes are blocked for 30 seconds after avatar changes.</small>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.autostatus-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
  color: #fff;
  border-radius: 12px;
  padding: 18px 24px;
  margin-bottom: 24px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  transition: background 0.3s ease;
}

.autostatus-banner-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.autostatus-banner-icon {
  font-size: 32px;
  line-height: 1;
}

.autostatus-banner-title {
  font-size: 18px;
  font-weight: 700;
}

.autostatus-banner-subtitle {
  font-size: 13px;
  opacity: 0.8;
  margin-top: 2px;
}

.autostatus-banner-right {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.autostatus-badge {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.autostatus-badge-ok {
  background: rgba(46, 204, 113, 0.2);
  color: #2ecc71;
}

.autostatus-badge-err {
  background: rgba(231, 76, 60, 0.2);
  color: #e74c3c;
}

.autostatus-badge-warn {
  background: rgba(243, 156, 18, 0.2);
  color: #f39c12;
}

.autostatus-badge-info {
  background: rgba(52, 152, 219, 0.2);
  color: #3498db;
}

.autostatus-section {
  margin-bottom: 24px;
}

.autostatus-section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}

.autostatus-section-header h3 {
  font-size: 16px;
  font-weight: 700;
  color: #2c3e50;
  margin: 0;
  transition: color 0.3s ease;
}

.autostatus-section-hint {
  font-size: 12px;
  color: #95a5a6;
}

.autostatus-presets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.autostatus-preset-card {
  display: block;
  background: #fff;
  border-radius: 10px;
  border: 2px solid #ecf0f1;
  overflow: hidden;
  transition: all 0.25s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.autostatus-preset-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.autostatus-preset-active {
  border-color: var(--preset-accent, #3498db) !important;
  box-shadow: 0 0 0 1px var(--preset-accent, #3498db), 0 4px 16px rgba(0, 0, 0, 0.1) !important;
}

.autostatus-presets-empty {
  text-align: center;
  padding: 40px 20px;
  color: #7f8c8d;
  border: 2px dashed #bdc3c7;
  border-radius: 12px;
  margin: 8px 0;
}

.autostatus-presets-empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.autostatus-preset-add-card {
  border: 2px dashed #bdc3c7;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  cursor: pointer;
  color: #7f8c8d;
  font-weight: 600;
  font-size: 15px;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}

.autostatus-preset-add-card:hover {
  border-color: #3498db;
  color: #3498db;
  background: rgba(52, 152, 219, 0.05);
}

.autostatus-preset-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  transition: border-color 0.3s ease;
}

.autostatus-preset-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.autostatus-preset-number {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--preset-accent, #95a5a6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.autostatus-preset-name-display {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 14px;
  color: #2c3e50;
  transition: color 0.3s ease;
}

.autostatus-preset-actions,
.autostatus-schedule-actions,
.autostatus-modal-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.autostatus-preset-body {
  padding: 14px 16px;
}

.autostatus-field {
  margin-bottom: 12px;
}

.autostatus-field label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #7f8c8d;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: color 0.3s ease;
}

.autostatus-field input,
.autostatus-field select {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
  background: #fafafa;
  color: #2c3e50;
  transition: all 0.2s ease;
}

.autostatus-field input:focus,
.autostatus-field select:focus {
  outline: none;
  border-color: #3498db;
  box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.15);
}

.autostatus-field small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #95a5a6;
}

.autostatus-char-count {
  float: right;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: #95a5a6;
}

.autostatus-match-row {
  display: flex;
  gap: 6px;
}

.autostatus-match-row input {
  flex: 1;
  min-width: 0;
}

.autostatus-match-row select {
  width: auto;
  min-width: 90px;
  flex-shrink: 0;
}

.autostatus-checkbox-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.autostatus-dropdown-wrap {
  position: relative;
}

.autostatus-dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
  background: #fafafa;
  color: #2c3e50;
  cursor: pointer;
  transition: all 0.2s ease;
}

.autostatus-dropdown-trigger:hover {
  border-color: #3498db;
}

.autostatus-dropdown-trigger:focus {
  outline: none;
  border-color: #3498db;
  box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.15);
}

.autostatus-dropdown-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.autostatus-dropdown-arrow {
  flex-shrink: 0;
  margin-left: 8px;
  font-size: 10px;
  color: #95a5a6;
  transition: transform 0.2s ease;
}

.autostatus-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 10;
  background: #fff;
  border: 1.5px solid #e0e0e0;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  max-height: 220px;
  overflow-y: auto;
}

.autostatus-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 13px;
  color: #2c3e50;
  cursor: pointer;
  transition: background 0.15s ease;
}

.autostatus-dropdown-item:hover {
  background: #f0f7ff;
}

.autostatus-dropdown-item input {
  width: auto;
  margin: 0;
  accent-color: #3498db;
}

:global(body.dark-theme) .autostatus-dropdown-trigger {
  background: #1e1e1e;
  border-color: #454545;
  color: #ecf0f1;
}

:global(body.dark-theme) .autostatus-dropdown-menu {
  background: #2b2b2b;
  border-color: #454545;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

:global(body.dark-theme) .autostatus-dropdown-item {
  color: #ecf0f1;
}

:global(body.dark-theme) .autostatus-dropdown-item:hover {
  background: #3a3a4a;
}

.autostatus-schedule-empty {
  text-align: center;
  padding: 24px;
  color: #95a5a6;
  border: 1px dashed #ddd;
  transition: all 0.3s ease;
}

.autostatus-schedule-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.autostatus-schedule-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  background: #fff;
  transition: all 0.25s ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.autostatus-schedule-disabled {
  opacity: 0.5;
}

.autostatus-schedule-color {
  width: 6px;
  height: 40px;
  border-radius: 3px;
  flex-shrink: 0;
}

.autostatus-schedule-details {
  flex: 1;
  min-width: 0;
}

.autostatus-schedule-name {
  font-weight: 600;
  cursor: pointer;
}

.autostatus-schedule-time {
  font-size: 15px;
  font-weight: 700;
  color: #2c3e50;
  transition: color 0.3s ease;
}

.autostatus-schedule-time small {
  font-weight: 400;
  color: #f39c12;
  margin-left: 4px;
}

.autostatus-schedule-days {
  font-size: 12px;
  color: #95a5a6;
  margin-top: 2px;
}

.autostatus-schedule-preset {
  font-size: 13px;
  font-weight: 600;
  color: #2c3e50;
  white-space: nowrap;
  transition: color 0.3s ease;
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

.autostatus-schedule-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.autostatus-schedule-add {
  padding: 16px !important;
}

.autostatus-schedule-add-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.autostatus-day-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.autostatus-day-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  padding: 8px 10px;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  background: #f8f9fa;
  cursor: pointer;
  text-align: center;
  line-height: 1;
  transition: all 0.2s ease;
}

.autostatus-day-active {
  background: #3498db;
  border-color: #3498db;
  color: white;
}

.autostatus-toggle {
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: #ccc;
  position: relative;
  cursor: pointer;
  transition: background 0.25s ease;
  flex-shrink: 0;
}

.autostatus-toggle-on {
  background: #2ecc71;
}

.autostatus-toggle-knob {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.25s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.autostatus-toggle-on .autostatus-toggle-knob {
  transform: translateX(20px);
}

.autostatus-icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: rgba(0, 0, 0, 0.05);
  color: #7f8c8d;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.autostatus-icon-btn:hover {
  background: rgba(52, 152, 219, 0.15);
  color: #3498db;
}

.autostatus-icon-btn-danger:hover {
  background: rgba(231, 76, 60, 0.15);
  color: #e74c3c;
}

.autostatus-settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 15px;
}

.autostatus-override-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.autostatus-override-label input {
  width: auto;
  margin: 0;
}

.autostatus-info-box {
  margin-top: 16px;
  padding: 14px 16px;
  background: #f8f9fa;
  border-radius: 10px;
  border: 1px solid #ecf0f1;
}

.autostatus-osc-params {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0;
}

.autostatus-osc-param {
  padding: 6px 0;
}

.autostatus-osc-param code {
  display: inline-block;
  margin-bottom: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #f8f9fa;
}

.autostatus-location-status {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

@media (max-width: 900px) {
  .autostatus-banner,
  .autostatus-section-header {
    flex-direction: column;
    align-items: stretch;
  }

  .autostatus-preset-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .autostatus-preset-actions {
    align-self: flex-end;
  }

  .autostatus-schedule-row {
    flex-wrap: wrap;
  }
}

:global(body.dark-theme) .autostatus-banner {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

:global(body.dark-theme) .autostatus-section-header h3,
:global(body.dark-theme) .autostatus-preset-name-display {
  color: #ecf0f1;
}

:global(body.dark-theme) .autostatus-section-hint,
:global(body.dark-theme) .autostatus-field label,
:global(body.dark-theme) .autostatus-field small,
:global(body.dark-theme) .autostatus-schedule-days,
:global(body.dark-theme) .autostatus-schedule-fallback label,
:global(body.dark-theme) .autostatus-presets-empty {
  color: #95a5a6;
}

:global(body.dark-theme) .autostatus-schedule-time {
  color: #ecf0f1;
}

:global(body.dark-theme) .autostatus-schedule-preset {
  color: #ecf0f1;
}

:global(body.dark-theme) .autostatus-schedule-empty {
  background: #1e1e1e;
  border-color: #454545;
  color: #7f8c8d;
}

:global(body.dark-theme) .autostatus-preset-card,
:global(body.dark-theme) .autostatus-info-box,
:global(body.dark-theme) .autostatus-day-btn,
:global(body.dark-theme) .autostatus-osc-param code {
  background: #2b2b2b;
  border-color: #454545;
  color: #ecf0f1;
}

:global(body.dark-theme) .autostatus-schedule-row {
  background: #2b2b2b;
  border-color: #454545;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

:global(body.dark-theme) .autostatus-preset-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

:global(body.dark-theme) .autostatus-preset-header {
  border-bottom-color: #454545;
}

:global(body.dark-theme) .autostatus-field input,
:global(body.dark-theme) .autostatus-field select,
:global(body.dark-theme) .autostatus-schedule-fallback select,
:global(body.dark-theme) .autostatus-schedule-edit-row input {
  background: #1e1e1e;
  border-color: #454545;
  color: #ecf0f1;
}

:global(body.dark-theme) .autostatus-presets-empty,
:global(body.dark-theme) .autostatus-preset-add-card {
  border-color: #555;
  color: #999;
}

:global(body.dark-theme) .autostatus-preset-add-card:hover {
  border-color: #3498db;
  color: #3498db;
  background: rgba(52, 152, 219, 0.1);
}

:global(body.dark-theme) .autostatus-icon-btn {
  background: rgba(255, 255, 255, 0.08);
  color: #bdc3c7;
}

:global(body.dark-theme) .autostatus-location-status {
  background: #1e1e1e;
  border: 1px solid #454545;
  border-radius: 8px;
  padding: 10px 14px;
}
</style>