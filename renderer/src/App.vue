<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useOscStatus } from './composables/useOscStatus'
import { useServerConnection, type PanelInfo } from './composables/useServerConnection'
import { useSettings } from './composables/useSettings'
import { useOscLogs } from './composables/useOscLogs'
import { useVRChatAPI } from './composables/useVRChatAPI'

const route = useRoute()
const extrasOpen = ref(false)
const vrchatOpen = ref(false)

const {
  snowEnabled,
  runtimeDisplay,
  toggleTheme,
  toggleSnow
} = useSettings()

const {
  oscEnabled,
  oscToggling,
  oscPort,
  oscStatus,
  toggleOsc
} = useOscStatus()

const {
  connectionStatus,
  isConnected,
  isAuthenticated,
  currentAvatar,
  panelConnectionsData,
  loading,
  savedUsername,
  savedPassword,
  savePasswordChecked,
  authenticate,
  disconnect,
  unloadAvatar,
  toggleSavePassword,
  savePassword,
  wsForwardingEnabled,
  toggleWsForwarding
} = useServerConnection()

useOscLogs()
useVRChatAPI()

const username = ref('')
const password = ref('')
const vrchatPaths = ['/vrchat-api', '/auto-inviter', '/autostatus', '/calendar']

watch(savedUsername, (value) => {
  if (!username.value) {
    username.value = value
  }
}, { immediate: true })

watch(savedPassword, (value) => {
  if (!password.value) {
    password.value = value
  }
}, { immediate: true })

watch(() => route.path, (path) => {
  if (path !== '/logs' && path !== '/settings' && path !== '/' && path !== '/osc') {
    // extrasOpen.value = true
  }
  if (vrchatPaths.includes(path)) {
    vrchatOpen.value = true
  }
}, { immediate: true })

const serverStatusClass = computed(() => {
  if (connectionStatus.value === 'connected') return 'status-connected'
  if (connectionStatus.value === 'connecting') return 'status-connecting'
  return 'status-disconnected'
})

const oscStatusClass = computed(() => {
  if (oscStatus.value === 'connected') return 'status-connected'
  if (oscStatus.value === 'stopping' || oscToggling.value) return 'status-stopping'
  return 'status-disconnected'
})

const wsStatusClass = computed(() => wsForwardingEnabled.value ? 'status-connected' : 'status-disconnected')

const serverStatusText = computed(() => {
  if (connectionStatus.value === 'connected') return 'Connected'
  if (connectionStatus.value === 'connecting') return 'Connecting'
  if (connectionStatus.value === 'error') return 'Connection Error'
  return 'Disconnected'
})

const oscStatusText = computed(() => {
  if (oscStatus.value === 'connected') return `OSC Status: Enabled :${oscPort.value}`
  if (oscStatus.value === 'stopping') return 'OSC Status: Stopping'
  if (oscStatus.value === 'error') return 'OSC Status: Error'
  return 'OSC Status: Off'
})

const isOscActive = computed(() => oscStatus.value === 'connected' || oscToggling.value)
const oscButtonLabel = computed(() => {
  if (oscToggling.value) {
    return oscEnabled.value ? 'Disabling OSC...' : 'Enabling OSC...'
  }
  return isOscActive.value ? 'Disable OSC' : 'Enable OSC'
})
const wsButtonLabel = computed(() => `${wsForwardingEnabled.value ? 'Disable' : 'Enable'} ARC Server Transmit`)

const wsForwardingText = computed(() => `ARC Server Transmit: ${wsForwardingEnabled.value ? 'Enabled' : 'Off'}`)

const routeViewId = computed(() => {
  const ids: Record<string, string> = {
    '/osc': 'osc-view',
    '/logs': 'logs-view',
    '/settings': 'settings-view',
    '/hyperate': 'Hyperate-view',
    '/oscleash': 'osc-leash-view',
    '/oscgoesbrrr': 'oscgoesbrrr-view',
    '/autostatus': 'auto-status-view',
    '/vrchat-api': 'vrchatapi-view',
    '/feedback': 'arcfeedback-view',
    '/chatbox': 'chatbox-view',
    '/calendar': 'calendar-view',
    '/openshock': 'openshock-view',
    '/arclink': 'arclink-view',
    '/lovense': 'lovense-view',
    '/vosk': 'vosk-view',
    '/vrc-timeline': 'vrc-timeline-view',
    '/auto-inviter': 'auto-inviter-view'
  }
  return ids[route.path] ?? 'main-view'
})

const authButtonLabel = computed(() => {
  if (loading.value) return 'Connecting...'
  if (isAuthenticated.value && isConnected.value) return 'Disconnect'
  return 'Connect & Login'
})

function isActive(path: string) {
  return route.path === path
}

async function handleAuth() {
  if (isAuthenticated.value && isConnected.value) {
    await disconnect()
    return
  }
  await authenticate(username.value.trim().toLowerCase(), password.value)
}

function handleKeypress(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    void handleAuth()
  }
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
  <div class="app-container">
    <div class="sidebar">
      <div class="sidebar-section">
        <div class="sidebar-status-header">
          <h3>Connection Status</h3>
          <div class="sidebar-actions">
            <button class="snow-toggle" :class="{ disabled: !snowEnabled }" type="button" title="Toggle Snow Overlay" @click="toggleSnow()">❄️</button>
            <button class="theme-toggle" type="button" title="Toggle Theme" @click="toggleTheme()">
              <span class="theme-toggle-sun">☀</span>
              <span class="theme-toggle-moon">🌙</span>
            </button>
          </div>
        </div>
        <div class="runtime-timer runtime-center">
          <span>Runtime:</span>
          <span class="runtime-value">{{ runtimeDisplay }}</span>
        </div>
        <div class="connection-status">
          <span class="status-indicator" :class="serverStatusClass"></span>
          <span>{{ serverStatusText }}</span>
        </div>
        <div class="connection-status">
          <span class="status-indicator" :class="oscStatusClass"></span>
          <span>{{ oscStatusText }}</span>
        </div>
        <div class="connection-status">
          <span class="status-indicator" :class="wsStatusClass"></span>
          <span>{{ wsForwardingText }}</span>
        </div>
        <button class="btn sidebar-button" :class="isOscActive ? 'btn-danger' : 'btn-primary'" type="button" :disabled="oscToggling" @click="toggleOsc">
          {{ oscButtonLabel }}
        </button>
        <button class="btn sidebar-button" :class="wsForwardingEnabled ? 'btn-danger' : 'btn-primary'" type="button" @click="toggleWsForwarding">
          {{ wsButtonLabel }}
        </button>
      </div>

      <div class="sidebar-section navigation-section">
        <h3>Navigation</h3>
        <router-link to="/" class="btn btn-primary nav-link" :class="{ active: isActive('/') }">Main View</router-link>
        <router-link to="/osc" class="btn btn-primary nav-link" :class="{ active: isActive('/osc') }">OSC</router-link>
        <div class="tree-item">
          <button class="tree-toggle extras-toggle" :class="{ expanded: extrasOpen }" type="button" @click="extrasOpen = !extrasOpen">
            <span class="arrow">&#9656;</span>
            <span>Extras</span>
          </button>
          <div class="tree-content" :class="{ expanded: extrasOpen }">
            <div class="tree-items">
              <router-link to="/feedback" class="tree-child" :class="{ active: isActive('/feedback') }">ARC Feedback</router-link>
              <router-link to="/arclink" class="tree-child" :class="{ active: isActive('/arclink') }">ARC Link</router-link>
              <router-link to="/chatbox" class="tree-child" :class="{ active: isActive('/chatbox') }">Chatbox</router-link>
              <router-link to="/hyperate" class="tree-child" :class="{ active: isActive('/hyperate') }">Hyperate</router-link>
              <router-link to="/lovense" class="tree-child" :class="{ active: isActive('/lovense') }">Lovense</router-link>
              <router-link to="/openshock" class="tree-child" :class="{ active: isActive('/openshock') }">OpenShock</router-link>
              <router-link to="/oscleash" class="tree-child" :class="{ active: isActive('/oscleash') }">OSC Leash</router-link>
              <router-link to="/oscgoesbrrr" class="tree-child" :class="{ active: isActive('/oscgoesbrrr') }">OscGoesBrrr</router-link>
              <router-link to="/vosk" class="tree-child" :class="{ active: isActive('/vosk') }">VOSK</router-link>
              <router-link to="/vrc-timeline" class="tree-child" :class="{ active: isActive('/vrc-timeline') }">VRC Timeline</router-link>
              <div class="tree-item nested-tree-item">
                <button class="tree-toggle nested-toggle" :class="{ expanded: vrchatOpen }" type="button" @click="vrchatOpen = !vrchatOpen">
                  <span class="arrow">&#9656;</span>
                  <span>VRChat API</span>
                </button>
                <div class="tree-content" :class="{ expanded: vrchatOpen }">
                  <div class="tree-items">
                    <router-link to="/vrchat-api" class="tree-child" :class="{ active: isActive('/vrchat-api') }">Account Info</router-link>
                    <router-link to="/auto-inviter" class="tree-child" :class="{ active: isActive('/auto-inviter') }">Auto-Inviter</router-link>
                    <router-link to="/autostatus" class="tree-child" :class="{ active: isActive('/autostatus') }">Auto-Status</router-link>
                    <router-link to="/calendar" class="tree-child" :class="{ active: isActive('/calendar') }">Calendar Viewing</router-link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <router-link to="/logs" class="btn btn-primary nav-link" :class="{ active: isActive('/logs') }">Logs</router-link>
        <router-link to="/settings" class="btn btn-primary nav-link" :class="{ active: isActive('/settings') }">Settings</router-link>
      </div>

      <div v-if="isAuthenticated && isConnected" class="sidebar-section">
        <h3>Avatar - (Server Side)</h3>
        <div class="avatar-info">
          <div id="avatar-name" class="avatar-name-sidebar">{{ currentAvatar?.displayName ?? 'No avatar detected' }}</div>
          <div id="avatar-id" class="avatar-id-sidebar">{{ currentAvatar ? currentAvatar.id : 'ID: Not available' }}</div>
        </div>
        <button v-if="currentAvatar" class="btn btn-warning sidebar-button" type="button" @click="unloadAvatar">Unload Avatar</button>
      </div>

      <div class="sidebar-section" id="auth-section">
        <h3>Authentication</h3>
        <div class="form-group">
          <div class="sidebar-label">Username</div>
          <input v-model="username" type="text" @keypress="handleKeypress" />
        </div>
        <div class="form-group">
          <div class="sidebar-password-row">
            <span>Password</span>
            <label class="sidebar-checkbox-label">
              <input type="checkbox" :checked="savePasswordChecked" @change="handleSavePasswordToggle" />
              <span>Save?</span>
            </label>
          </div>
          <input v-model="password" type="password" @keypress="handleKeypress" @input="handlePasswordInput" />
        </div>
        <button class="btn" :class="isAuthenticated && isConnected ? 'btn-danger' : 'btn-success'" type="button" :disabled="loading" @click="handleAuth">
          {{ authButtonLabel }}
        </button>
      </div>
    </div>

    <div v-if="route.path === '/'" id="main-view" class="main-content view-transition">
      <div class="header">
        <h1>ARC-OSC Client</h1>
        <p>Real-time OSC communication with VRChat</p>
      </div>
      <div class="tabs">
        <button class="tab active" type="button">My Panels</button>
      </div>
      <div id="panels" class="tab-content active">
        <div class="card">
          <h3>Panel Dashboard</h3>
          <div class="panels-grid">
            <p v-if="!isAuthenticated || !isConnected" class="panels-loading">
              Connect and authenticate to view your panels
            </p>
            <p v-else-if="Object.keys(panelConnectionsData).length === 0" class="panels-loading">
              No panels found. Create panels in the ARC dashboard.
            </p>
            <div v-for="(panel, panelId) in panelConnectionsData" v-else :key="panelId" class="panel-card">
              <div class="panel-card-header">
                <h4 class="panel-name">{{ panel.panelName }}</h4>
                <div class="panel-card-badges">
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
                  <span v-for="(enabled, i) in safetyStatuses(panel)" :key="i" class="safety-bubble" :class="enabled ? 'enabled' : 'disabled'">
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
    </div>
    <router-view v-else v-slot="{ Component }">
      <component :is="Component" :id="routeViewId" class="main-content view-transition" />
    </router-view>
  </div>

  <div class="snow-overlay" :class="{ hidden: !snowEnabled }">
    <div v-for="index in 50" :key="index" class="snow"></div>
  </div>
</template>

<style scoped>
.nav-link {
  display: block;
  width: 100%;
  margin-bottom: 10px;
  font-family: inherit;
  text-align: center;
  text-decoration: none;
}

.sidebar-status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.sidebar-actions {
  display: flex;
  align-items: center;
}

.runtime-center {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-bottom: 15px;
}

.runtime-value {
  min-width: 64px;
}

.sidebar-button {
  width: 100%;
  margin-top: 10px;
}

.extras-toggle {
  justify-content: center;
}

:deep(.tree-content.expanded) {
  max-height: 1200px;
}

.nested-tree-item {
  margin-top: 5px;
  margin-bottom: 0;
}

.nested-toggle {
  justify-content: flex-start;
}

.avatar-name-sidebar {
  font-weight: bold;
  margin-bottom: 5px;
}

.avatar-id-sidebar {
  font-size: 0.85em;
  color: #bdc3c7;
  word-break: break-all;
}

.sidebar-label {
  margin-bottom: 5px;
  font-weight: bold;
  color: #ecf0f1;
}

.sidebar-password-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 5px;
  font-weight: bold;
  color: #ecf0f1;
}

.sidebar-checkbox-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: normal;
  font-size: 0.9em;
  cursor: pointer;
}

.sidebar-checkbox-label input {
  width: auto;
  margin: 0;
  padding: 0;
}

</style>
