<script setup lang="ts">
import { ref, watch } from 'vue'
import { useServerConnection, type PanelInfo } from '../composables/useServerConnection'

const {
  connectionStatus, isConnected, isAuthenticated,
  currentUser, currentAvatar, parameters, panelConnectionsData,
  wsForwardingEnabled, loading, savedUsername, savedPassword,
  savePasswordChecked, authenticate, disconnect, unloadAvatar,
  toggleSavePassword, savePassword, toggleWsForwarding
} = useServerConnection()

const username = ref(savedUsername.value)
const password = ref(savedPassword.value)

watch(savedUsername, v => { if (!username.value) username.value = v })
watch(savedPassword, v => { if (!password.value) password.value = v })

async function handleAuth() {
  await authenticate(username.value.trim().toLowerCase(), password.value)
}
function handleKeypress(e: KeyboardEvent) {
  if (e.key === 'Enter') handleAuth()
}
async function handleSavePasswordToggle() {
  await toggleSavePassword(!savePasswordChecked.value, password.value)
}
async function handlePasswordInput() {
  await savePassword(password.value)
}
function safetyStatuses(panel: PanelInfo): boolean[] {
  return [panel.safetyEnabled, panel.safety2Enabled, panel.safety3Enabled, panel.safety4Enabled, panel.safety5Enabled]
}
function linksBreakdown(panel: PanelInfo): string {
  const parts: string[] = []
  if (panel.friendLinkCount > 0) parts.push(`F:${panel.friendLinkCount}`)
  if (panel.publicLinkCount > 0) parts.push(`P:${panel.publicLinkCount}`)
  return parts.length > 0 ? ` (${parts.join(' ')})` : ''
}
</script>

<template>
  <div class="page">
    <h2>Dashboard</h2>

    <!-- Auth Section -->
    <div class="section auth-section">
      <div v-if="!isAuthenticated || !isConnected" class="auth-form">
        <div class="form-row">
          <input v-model="username" type="text" placeholder="Username" class="input" @keypress="handleKeypress" />
          <input v-model="password" type="password" placeholder="Password" class="input" @keypress="handleKeypress" @input="handlePasswordInput" />
          <button class="btn btn-success" :disabled="loading" @click="handleAuth">
            {{ loading ? 'Connecting...' : 'Connect & Login' }}
          </button>
        </div>
        <label class="checkbox-label">
          <input type="checkbox" :checked="savePasswordChecked" @change="handleSavePasswordToggle" />
          Save Password
        </label>
      </div>
      <div v-else class="connected-status">
        <span>Connected as <strong>{{ currentUser?.username }}</strong></span>
        <button class="btn btn-danger" @click="disconnect">Disconnect</button>
      </div>
    </div>

    <!-- Connection Status -->
    <div class="section status-row">
      <div class="connection-status">
        <span class="status-indicator" :class="{
          'status-connected': connectionStatus === 'connected',
          'status-disconnected': connectionStatus === 'disconnected' || connectionStatus === 'error'
        }"></span>
        <span>{{ connectionStatus }}</span>
      </div>
      <div class="ws-forwarding">
        <button class="btn" :class="wsForwardingEnabled ? 'btn-danger' : 'btn-primary'" @click="toggleWsForwarding">
          {{ wsForwardingEnabled ? 'Disable' : 'Enable' }} ARC Server Transmit
        </button>
      </div>
    </div>

    <!-- Avatar Section -->
    <div v-if="isAuthenticated && isConnected" class="section">
      <h3>Avatar</h3>
      <div v-if="currentAvatar" class="avatar-info">
        <div class="avatar-name">{{ currentAvatar.displayName }}</div>
        <div class="avatar-id">{{ currentAvatar.id }}</div>
        <button class="btn btn-warning" @click="unloadAvatar">Unload Avatar</button>
      </div>
      <div v-else class="avatar-info">
        <span class="muted">No avatar loaded</span>
      </div>
    </div>

    <!-- Parameters -->
    <div v-if="isAuthenticated && isConnected && Object.keys(parameters).length > 0" class="section">
      <h3>Parameters ({{ Object.keys(parameters).length }})</h3>
      <div class="parameter-list">
        <div v-for="(value, key) in parameters" :key="key" class="parameter-row">
          <span class="param-name">{{ key }}</span>
          <span class="param-value">{{ value }}</span>
        </div>
      </div>
    </div>

    <!-- Panel Dashboard -->
    <div v-if="isAuthenticated && isConnected" class="section">
      <h3>Panels</h3>
      <div v-if="Object.keys(panelConnectionsData).length === 0" class="muted">
        No panels found. Create panels in the ARC dashboard.
      </div>
      <div v-else class="panels-grid">
        <div v-for="(panel, panelId) in panelConnectionsData" :key="panelId" class="panel-card">
          <div class="panel-card-header">
            <h4 class="panel-name">{{ panel.panelName }}</h4>
            <div style="display: flex; gap: 6px;">
              <span class="panel-lock-badge" :class="panel.panelEnabled ? 'unlocked' : 'locked'">
                {{ panel.panelEnabled ? 'Unlocked' : 'Locked' }}
              </span>
              <span class="panel-status-badge" :class="panel.isActive ? 'active' : 'inactive'">
                {{ panel.isActive ? 'Active' : 'Inactive' }}
              </span>
            </div>
          </div>
          <div class="panel-stats">
            <div class="panel-stat">
              <span class="panel-stat-value">{{ panel.connectionCount }}</span>
              <span class="panel-stat-label">Connections</span>
            </div>
          </div>
          <div class="safety-bubbles-row">
            <span class="safety-label">Safety</span>
            <div class="safety-bubbles">
              <span v-for="(enabled, i) in safetyStatuses(panel)" :key="i"
                class="safety-bubble" :class="enabled ? 'enabled' : 'disabled'">
                {{ i + 1 }}
              </span>
            </div>
          </div>
          <div class="access-indicators-row">
            <span class="access-indicator" :class="panel.isPublic ? 'public' : 'private'">
              {{ panel.isPublic ? 'Public' : 'Private' }}
            </span>
            <span class="access-indicator" :class="panel.hasPassword ? 'active' : 'inactive'">Pass</span>
            <span class="access-indicator" :class="panel.allowFriends ? 'friends' : 'inactive'">Friends</span>
            <span v-if="panel.activeLinkCount > 0" class="access-indicator links">
              L:{{ panel.activeLinkCount }}{{ linksBreakdown(panel) }}
            </span>
            <span v-else class="access-indicator inactive">Links</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-form { margin-bottom: 16px; }
.form-row { display: flex; gap: 8px; margin-bottom: 8px; }
.form-row .input { flex: 1; }
.input {
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid #555;
  background: #2a2a3e;
  color: #fff;
  font-size: 0.9rem;
}
.checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #a0a0b8; cursor: pointer; }
.connected-status { display: flex; align-items: center; gap: 12px; }
.status-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.section { margin-bottom: 20px; }
.section h3 { margin: 0 0 8px; font-size: 1rem; color: #e0e0f0; }
.avatar-info { background: #2a2a3e; padding: 12px; border-radius: 6px; }
.avatar-name { font-size: 1.1rem; font-weight: 600; }
.avatar-id { font-size: 0.8rem; color: #888; margin-bottom: 8px; font-family: monospace; }
.muted { color: #888; font-size: 0.9rem; }
.parameter-list { max-height: 300px; overflow-y: auto; background: #2a2a3e; border-radius: 6px; padding: 8px; }
.parameter-row { display: flex; justify-content: space-between; padding: 4px 8px; border-bottom: 1px solid #333; font-size: 0.85rem; }
.param-name { font-family: monospace; color: #88c0d0; }
.param-value { font-family: monospace; color: #a3be8c; }
</style>
