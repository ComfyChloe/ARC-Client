<script setup lang="ts">
import { computed } from 'vue'
import { useXSOverlay } from '../composables/useXSOverlay'
const {
  status,
  autostart,
  dbLogs,
  toggle,
  toggleAutostart,
  updateConfig
} = useXSOverlay()
const statusClass = computed(() => {
  const s = status.value
  if (!s.enabled) return 'status-disconnected'
  if (s.connected && s.xsOverlayRunning) return 'status-connected'
  if (!s.xsOverlayRunning) return 'status-error'
  return 'status-connecting'
})
const statusText = computed(() => {
  const s = status.value
  if (!s.enabled) return 'Disabled'
  if (s.connected && s.xsOverlayRunning) return 'Connected to XS Overlay'
  if (!s.xsOverlayRunning) return 'XS Overlay not detected'
  return 'Connecting...'
})
const toggleButtonLabel = computed(() => {
  const s = status.value
  if (s.enabled) return 'Stop Notifications'
  return 'Start Notifications'
})
const toggleButtonDisabled = computed(() => false)
const currentOpacity = computed(() => status.value.config?.notificationOpacity ?? 1)
const currentVolume = computed(() => status.value.config?.notificationVolume ?? 0.7)
const currentTimeout = computed(() => status.value.config?.notificationTimeout ?? 5)
function toggleNotificationType(key: 'panelConnections' | 'avatarChanges') {
  const current = status.value.config?.notifications?.[key] ?? true
  updateConfig({ notifications: { ...status.value.config?.notifications, [key]: !current } })
}
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}
function notificationTypeIcon(type: string): string {
  switch (type) {
    case 'panel-connection': return '\uD83D\uDD17'
    case 'panel-disconnection': return '\uD83D\uDD13'
    case 'avatar-change': return '\uD83D\uDC64'
    case 'error': return '\u26A0\uFE0F'
    default: return '\u2139\uFE0F'
  }
}
function notificationTypeClass(type: string): string {
  switch (type) {
    case 'panel-connection': return 'notif-connect'
    case 'panel-disconnection': return 'notif-disconnect'
    case 'avatar-change': return 'notif-avatar'
    case 'error': return 'notif-error'
    default: return 'notif-info'
  }
}
</script>
<template>
  <div class="page-view">
    <div class="header">
      <h1>XS Overlay Notifications</h1>
      <p>VR overlay notifications for panel connections and avatar changes</p>
      <p><b>Note: Please note this feature is experimental in client, It might break.</b></p>
    </div>
    <div class="card">
      <h3>Connection Status</h3>
      <div class="connection-status">
        <span class="status-indicator" :class="statusClass"></span>
        <span>{{ statusText }}</span>
      </div>
      <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
        <button class="btn btn-primary" :disabled="toggleButtonDisabled" @click="toggle">{{ toggleButtonLabel }}</button>
        <div class="autostart-toggle-container">
          <span style="font-size: 13px; font-weight: 600; opacity: 0.8;">Auto-start:</span>
          <div class="autostart-toggle-slider" role="button" tabindex="0" @click="toggleAutostart" @keyup.enter="toggleAutostart" @keyup.space.prevent="toggleAutostart">
            <div class="autostart-toggle-option disabled" :class="{ active: !autostart }">Disabled</div>
            <div class="autostart-toggle-option enabled" :class="{ active: autostart }">Enabled</div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Notification Log</h3>
      <div v-if="dbLogs.length === 0" style="text-align: center; padding: 30px; color: #666; opacity: 0.6;">
        <p>No notifications yet</p>
        <p style="font-size: 12px; margin-top: 5px;">Notifications will appear here when panels connect or avatars change</p>
      </div>
      <div v-else class="notification-log">
        <div
          v-for="entry in dbLogs"
          :key="entry.id"
          class="notification-entry"
          :class="notificationTypeClass(entry.type)"
        >
          <span class="notif-icon">{{ notificationTypeIcon(entry.type) }}</span>
          <div class="notif-content">
            <div class="notif-title">{{ entry.title }}</div>
            <div class="notif-text">{{ entry.content }}</div>
          </div>
          <span class="notif-time">{{ formatTime(entry.timestamp) }}</span>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Configuration</h3>
      <h4 class="config-section-title">Notification Types</h4>
      <div class="config-grid">
        <label class="checkbox-row">
          <input
            type="checkbox"
            class="config-checkbox"
            :checked="status.config?.notifications?.panelConnections ?? true"
            @change="toggleNotificationType('panelConnections')"
          />
          <span class="checkbox-label">Panel Connections &amp; Disconnections</span>
        </label>
        <label class="checkbox-row">
          <input
            type="checkbox"
            class="config-checkbox"
            :checked="status.config?.notifications?.avatarChanges ?? true"
            @change="toggleNotificationType('avatarChanges')"
          />
          <span class="checkbox-label">Avatar Changes</span>
        </label>
      </div>
      <h4 class="config-section-title">Appearance</h4>
      <div class="config-grid">
        <div class="config-row">
          <label class="config-label">Opacity</label>
          <input
            type="range"
            class="config-slider"
            :value="currentOpacity"
            min="0.1"
            max="1"
            step="0.05"
            @input="(e: Event) => updateConfig({ notificationOpacity: Number((e.target as HTMLInputElement).value) })"
          />
          <span class="config-value">{{ Math.round(currentOpacity * 100) }}%</span>
        </div>
      </div>
      <h4 class="config-section-title">Sound</h4>
      <div class="config-grid">
        <div class="config-row">
          <label class="config-label">Volume</label>
          <input
            type="range"
            class="config-slider"
            :value="currentVolume"
            min="0"
            max="1"
            step="0.05"
            @input="(e: Event) => updateConfig({ notificationVolume: Number((e.target as HTMLInputElement).value) })"
          />
          <span class="config-value">{{ Math.round(currentVolume * 100) }}%</span>
        </div>
        <div class="config-row">
          <label class="config-label">Duration (seconds)</label>
          <input
            type="range"
            class="config-slider"
            :value="currentTimeout"
            min="1"
            max="15"
            step="0.5"
            @input="(e: Event) => updateConfig({ notificationTimeout: Number((e.target as HTMLInputElement).value) })"
          />
          <span class="config-value">{{ currentTimeout }}s</span>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.config-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.config-section-title {
  margin-top: 20px;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
  opacity: 0.7;
}
.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.config-label {
  font-size: 13px;
  font-weight: 600;
  min-width: 180px;
  opacity: 0.85;
}
.config-input {
  width: 100px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  font-size: 13px;
}
.config-select {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  font-size: 13px;
  background: white;
  min-width: 120px;
}
.config-slider {
  flex: 1;
  max-width: 300px;
}
.config-value {
  font-size: 13px;
  font-weight: 600;
  min-width: 40px;
  text-align: right;
}
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 0;
}
.config-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #3498db;
}
.checkbox-label {
  font-size: 13px;
  font-weight: 500;
  opacity: 0.85;
  cursor: pointer;
}
.notification-log {
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.notification-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.notification-entry.notif-connect {
  border-left: 3px solid #2ecc71;
}
.notification-entry.notif-disconnect {
  border-left: 3px solid #e67e22;
}
.notification-entry.notif-avatar {
  border-left: 3px solid #3498db;
}
.notification-entry.notif-error {
  border-left: 3px solid #e74c3c;
}
.notification-entry.notif-info {
  border-left: 3px solid #95a5a6;
}
.notif-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.notif-content {
  flex: 1;
  min-width: 0;
}
.notif-title {
  font-weight: 600;
  font-size: 13px;
}
.notif-text {
  font-size: 12px;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.notif-time {
  font-size: 11px;
  opacity: 0.5;
  flex-shrink: 0;
}
</style>
