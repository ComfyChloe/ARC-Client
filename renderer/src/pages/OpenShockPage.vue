<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useOpenShock, type OpenShockShocker } from '../composables/useOpenShock'
import { useElectronAPI } from '../composables/useElectronAPI'

const { status, allShockers, loading, error, activeTab, refreshShockers, connect, disconnect, clearSavedToken, sendControl, quickCommand, createShareLink, login, logout } = useOpenShock()

// -- Connection --
const apiToken = ref('')
const showTokenInput = computed(() => !status.value.hasApiToken && !status.value.connected)
async function handleConnect() {
  if (!apiToken.value.trim()) return
  await connect(apiToken.value.trim())
  apiToken.value = ''
}

// -- Login for public share links --
const loginEmail = ref('')
const loginPassword = ref('')
const loginFeedback = ref('')
const loginLoading = ref(false)
const showLoginForm = ref(false)
async function handleLogin() {
  if (!loginEmail.value.trim() || !loginPassword.value.trim()) return
  loginLoading.value = true
  loginFeedback.value = ''
  const result = await login(loginEmail.value.trim(), loginPassword.value.trim())
  loginLoading.value = false
  if (result.success) {
    loginFeedback.value = ''
    loginEmail.value = ''
    loginPassword.value = ''
    showLoginForm.value = false
  } else {
    loginFeedback.value = result.error || 'Login failed'
  }
}
async function handleLogout() {
  await logout()
  loginFeedback.value = ''
}

// -- Control tab --
const selectedShocker = ref<OpenShockShocker | null>(null)
const intensity = ref(30)
const duration = ref(500)
const controlFeedback = ref('')
function selectShocker(shocker: OpenShockShocker) { selectedShocker.value = shocker }
async function handleControl(type: 'Shock' | 'Vibrate' | 'Sound' | 'Stop') {
  if (!selectedShocker.value) return; controlFeedback.value = ''
  await sendControl([{ id: selectedShocker.value.id, type, intensity: type === 'Stop' ? undefined : intensity.value, duration: type === 'Stop' ? undefined : duration.value }])
  controlFeedback.value = type === 'Stop' ? 'Stop sent' : type + ' sent (' + intensity.value + '%, ' + duration.value + 'ms)'
  setTimeout(() => { controlFeedback.value = '' }, 2000)
}

// -- Link Sharing tab --
const sharingShockerId = ref('')
const sharePermissions = ref({ shock: false, vibrate: true, sound: true, live: false })
const shareLimits = ref({ intensity: 50, duration: 5000 })
const generatedLink = ref('')
const generatedShareCode = ref('')
const shareError = ref('')
async function handleGenerateLink() {
  if (!sharingShockerId.value) return; shareError.value = ''; generatedLink.value = ''; generatedShareCode.value = ''
  const result = await createShareLink(sharingShockerId.value, { ...sharePermissions.value }, { ...shareLimits.value })
  if (!result) { shareError.value = error.value || 'Failed to create share'; return }
  if (result.url) { generatedLink.value = result.url }
  if (result.shareCode) { generatedShareCode.value = result.shareCode }
  if (result.sessionExpired) { showLoginForm.value = true; shareError.value = result.error || 'Session expired' }
  if (result.error && !result.sessionExpired && !result.url && !result.shareCode) { shareError.value = result.error }
}
async function copyGeneratedLink() { if (generatedLink.value) await navigator.clipboard.writeText(generatedLink.value).catch(() => {}) }
async function copyShareCode() { if (generatedShareCode.value) await navigator.clipboard.writeText(generatedShareCode.value).catch(() => {}) }

// -- Logs tab --
const api = useElectronAPI()
const controlLogs = ref<any[]>([])
const logLimit = ref(50)
const logLoading = ref(false)
async function fetchLogs() {
  logLoading.value = true
  try {
    controlLogs.value = await api.openShockGetControlLogs(logLimit.value) || []
  } catch (e: unknown) { console.error('Failed to fetch logs:', e) }
  logLoading.value = false
}
function formatTime(ts: number) {
  const d = new Date(ts)
  const now = Date.now()
  const diff = Math.floor((now - ts) / 1000)
  let rel = ''
  if (diff < 60) rel = diff + 's ago'
  else if (diff < 3600) rel = Math.floor(diff / 60) + 'm ago'
  else if (diff < 86400) rel = Math.floor(diff / 3600) + 'h ago'
  else rel = Math.floor(diff / 86400) + 'd ago'
  return rel + ' (' + d.toLocaleTimeString() + ')'
}
async function loadMoreLogs() { logLimit.value += 50; await fetchLogs() }
watch(activeTab, (tab) => { if (tab === 'logs') void fetchLogs() })
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>OpenShock Integration</h1>
      <p>Control shockers, manage sharing, and link to your VRChat bio</p>
      <p><b>Note: Please note this feature is experimental in client, It might break.</b></p>
      <p><b>This feature is 70% untested, Please report any issues!</b></p>
    </div>

    <!-- Status banner -->
    <div class="os-banner" :class="status.connected ? 'os-banner-connected' : 'os-banner-disconnected'">
      <div class="os-banner-left">
        <div class="os-banner-icon">{{ status.connected ? '&#9889;' : '&#9888;' }}</div>
        <div>
          <div class="os-banner-title">{{ status.connected ? 'OpenShock Connected' : 'Not Connected' }}</div>
          <div class="os-banner-subtitle" v-if="status.connected">{{ status.deviceCount }} hub(s) &middot; {{ allShockers.length }} shocker(s) &middot; {{ status.baseUrl }}</div>
          <div class="os-banner-subtitle" v-else-if="status.hasApiToken">Token loaded, reconnecting...</div>
          <div class="os-banner-subtitle" v-else>Enter your API token to get started</div>
        </div>
      </div>
      <div class="os-banner-right" v-if="status.connected">
        <span class="os-badge os-badge-ok">Online</span>
        <span v-if="status.loggedIn" class="os-badge os-badge-login">&#128274; Logged in</span>
        <button class="btn btn-secondary btn-small" @click="refreshShockers">Refresh</button>
        <button class="btn btn-danger btn-small" @click="disconnect">Disconnect</button>
      </div>
    </div>

    <div v-if="error" class="os-error-banner">{{ error }}</div>

    <!-- Connection card (when not connected) -->
    <div v-if="showTokenInput" class="card">
      <h3>Authentication</h3>
      <div class="form-group">
        <label>OpenShock API Token</label>
        <div style="display: flex; gap: 10px;">
          <input v-model="apiToken" type="password" placeholder="Paste your OpenShock API token" style="flex: 1;" @keyup.enter="handleConnect" />
          <button class="btn btn-primary" :disabled="loading || !apiToken.trim()" @click="handleConnect">
            {{ loading ? 'Connecting...' : 'Connect' }}
          </button>
        </div>
        <div class="os-hint">Token is saved encrypted on this device. You can also add it to <code>secrets.json</code>.</div>
      </div>
    </div>

    <!-- OpenShock Account Login (for public share links) -->
    <div v-if="status.connected" class="card">
      <details :open="showLoginForm">
        <summary style="cursor: pointer; font-weight: 600; font-size: 14px; color: #2c3e50; padding: 4px 0;">
          &#128274; OpenShock Account Login
          <span v-if="status.loggedIn" class="os-badge os-badge-ok" style="margin-left: 8px;">Logged in as {{ status.loggedInUsername }}</span>
          <span v-else class="os-badge os-badge-muted" style="margin-left: 8px;">Not logged in</span>
        </summary>
        <div style="margin-top: 12px;">
          <div v-if="status.loggedIn" style="display: flex; justify-content: space-between; align-items: center;">
            <div class="os-hint">Login enables public share links. Not required for shocker control.</div>
            <button class="btn btn-secondary btn-small" @click="handleLogout">Log out</button>
          </div>
          <div v-else>
            <div class="os-hint" style="margin-bottom: 10px;">Login enables public share links that anyone can open in a browser. Not required for shocker control.</div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <input v-model="loginEmail" type="text" placeholder="Email or username" style="flex: 1; min-width: 180px;" @keyup.enter="handleLogin" />
              <input v-model="loginPassword" type="password" placeholder="Password" style="flex: 1; min-width: 180px;" @keyup.enter="handleLogin" />
              <button class="btn btn-primary" :disabled="loginLoading || !loginEmail.trim() || !loginPassword.trim()" @click="handleLogin">
                {{ loginLoading ? 'Logging in...' : 'Log in' }}
              </button>
            </div>
            <div v-if="loginFeedback" class="os-error-banner" style="margin-top: 10px;">{{ loginFeedback }}</div>
          </div>
        </div>
      </details>
    </div>

    <!-- Tabs -->
    <div v-if="status.connected" class="card">
      <div class="os-tabs">
        <button class="os-tab" :class="{ active: activeTab === 'control' }" @click="activeTab = 'control'">Control</button>
        <button class="os-tab" :class="{ active: activeTab === 'linksharing' }" @click="activeTab = 'linksharing'">&#128279; Link Sharing</button>
        <button class="os-tab" :class="{ active: activeTab === 'logs' }" @click="activeTab = 'logs'">Logs</button>
      </div>

      <!-- Control Tab -->
      <div v-if="activeTab === 'control'" class="os-tab-content">
        <div class="os-section">
          <div class="os-section-header"><h3>Shocker Selection</h3><span class="os-section-hint">Select a shocker to control</span></div>
          <div v-if="allShockers.length === 0" class="os-empty">
            <div class="os-empty-icon">&#128268;</div>
            <p>No shockers found</p>
            <p><small>Make sure your hubs are online and paired.</small></p>
          </div>
          <div v-else class="os-shocker-grid">
            <div v-for="item in allShockers" :key="item.shocker.id" class="os-shocker-card" :class="{ 'os-shocker-selected': selectedShocker?.id === item.shocker.id }" @click="selectShocker(item.shocker)">
              <div class="os-shocker-card-header"><span class="os-shocker-name">{{ item.shocker.name }}</span><span v-if="item.shocker.isPaused" class="os-badge os-badge-err">PAUSED</span></div>
              <div class="os-shocker-card-meta">{{ item.device.name }} &middot; {{ item.shocker.model }}</div>
            </div>
          </div>
        </div>
        <div v-if="selectedShocker" class="os-section">
          <div class="os-section-header"><h3>Control: {{ selectedShocker.name }}</h3></div>
          <div class="os-control-row">
            <div class="form-group" style="flex: 1;"><label>Intensity: <strong>{{ intensity }}%</strong></label><input v-model.number="intensity" type="range" min="1" max="100" class="os-range" /></div>
            <div class="form-group" style="flex: 1;"><label>Duration: <strong>{{ duration }}ms</strong></label><input v-model.number="duration" type="range" min="100" max="30000" step="100" class="os-range" /></div>
          </div>
          <div class="os-control-buttons">
            <button class="btn btn-primary" @click="handleControl('Vibrate')">Vibrate</button>
            <button class="btn btn-primary" @click="handleControl('Sound')">Sound</button>
            <button class="btn btn-warning" @click="handleControl('Shock')">Shock</button>
            <button class="btn btn-danger" @click="handleControl('Stop')">Stop</button>
            <button class="btn btn-secondary" @click="quickCommand(selectedShocker.id, 'Shock', 5, 200)">Test Pulse</button>
          </div>
          <div v-if="controlFeedback" class="os-feedback">{{ controlFeedback }}</div>
        </div>
      </div>

      <!-- Link Sharing Tab -->
      <div v-if="activeTab === 'linksharing'" class="os-tab-content">
        <div class="os-section">
          <div class="os-section-header"><h3>Generate Share Link</h3><span class="os-section-hint"><template v-if="status.loggedIn">Public share links enabled</template><template v-else>Log in for public links &middot; share codes used as fallback</template></span></div>
          <div class="form-group"><label>Select Shocker</label>
            <select v-model="sharingShockerId"><option value="">-- select --</option><template v-for="item in allShockers" :key="item.shocker.id"><option :value="item.shocker.id">{{ item.shocker.name }} ({{ item.device.name }})</option></template></select>
          </div>
          <div v-if="sharingShockerId" style="margin-top: 16px;">
            <h4>Permissions</h4>
            <div class="os-share-perms">
              <label class="os-perm-toggle"><input v-model="sharePermissions.shock" type="checkbox" /> Shock</label>
              <label class="os-perm-toggle"><input v-model="sharePermissions.vibrate" type="checkbox" /> Vibrate</label>
              <label class="os-perm-toggle"><input v-model="sharePermissions.sound" type="checkbox" /> Sound</label>
              <label class="os-perm-toggle"><input v-model="sharePermissions.live" type="checkbox" /> Live</label>
            </div>
            <h4>Limits</h4>
            <div class="os-control-row">
              <div class="form-group" style="flex: 1;"><label>Max Intensity: <strong>{{ shareLimits.intensity }}%</strong></label><input v-model.number="shareLimits.intensity" type="range" min="1" max="100" class="os-range" /></div>
              <div class="form-group" style="flex: 1;"><label>Max Duration: <strong>{{ shareLimits.duration }}ms</strong></label><input v-model.number="shareLimits.duration" type="range" min="100" max="30000" step="100" class="os-range" /></div>
            </div>
            <button class="btn btn-primary" @click="handleGenerateLink">Generate Share Link</button>
            <div v-if="generatedLink" class="os-share-result">
              <input :value="generatedLink" readonly class="os-share-input" @click="($event.target as HTMLInputElement).select()" />
              <button class="btn btn-secondary btn-small" @click="copyGeneratedLink">Copy</button>
            </div>
            <div v-if="generatedShareCode" class="os-share-result">
              <div class="os-hint" style="width: 100%; margin-bottom: 4px;">Share code (claim via OpenShock WebUI):</div>
              <input :value="generatedShareCode" readonly class="os-share-input" @click="($event.target as HTMLInputElement).select()" />
              <button class="btn btn-secondary btn-small" @click="copyShareCode">Copy</button>
            </div>
            <div v-if="shareError" class="os-error-banner">{{ shareError }}</div>
          </div>
        </div>
      </div>

      <!-- Logs Tab -->
      <div v-if="activeTab === 'logs'" class="os-tab-content">
        <div class="os-section">
          <div class="os-section-header"><h3>Control Log</h3><span class="os-section-hint">History of all shocker control commands</span></div>
        </div>
        <div v-if="logLoading" class="os-empty"><p>Loading logs...</p></div>
        <div v-else-if="controlLogs.length === 0" class="os-empty">
          <div class="os-empty-icon">&#128196;</div>
          <p>No logs yet</p>
          <p><small>Logs appear after your first control command.</small></p>
        </div>
        <div v-else class="os-log-list">
          <div v-for="entry in controlLogs" :key="entry.id" class="os-log-entry">
            <span class="os-log-icon os-log-icon-shock">&#9889;</span>
            <div class="os-log-body">
              <div class="os-log-top">
                <span class="os-badge" :class="entry.success ? 'os-badge-ok' : 'os-badge-err'">{{ entry.success ? 'OK' : 'FAIL' }}</span>
                <span class="os-badge os-badge-info">{{ entry.control_type }}</span>
              </div>
              <div class="os-log-msg">{{ entry.shocker_name }} — {{ entry.control_type }} {{ entry.intensity != null ? entry.intensity + '%' : '' }} {{ entry.duration != null ? entry.duration + 'ms' : '' }}</div>
              <div v-if="entry.error_message" class="os-log-error">{{ entry.error_message }}</div>
              <div class="os-log-time">{{ formatTime(entry.recorded_at) }}</div>
            </div>
          </div>
          <button v-if="controlLogs.length >= logLimit" class="btn btn-secondary" style="margin-top: 12px; width: 100%;" @click="loadMoreLogs" :disabled="logLoading">Load More</button>
        </div>
      </div>
    </div>

    <!-- Saved token indicator -->
    <div v-if="status.connected || (status.hasApiToken && !showTokenInput)" class="card os-token-footer">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div class="os-hint">Token saved and encrypted on this device</div>
        <button class="btn btn-secondary btn-small" @click="clearSavedToken">Clear Saved Token</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.os-banner { display: flex; justify-content: space-between; align-items: center; border-radius: 12px; padding: 18px 24px; margin-bottom: 24px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15); transition: background 0.3s ease; }
.os-banner-connected { background: linear-gradient(135deg, #2c3e50 0%, #27ae60 100%); color: #fff; }
.os-banner-disconnected { background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: #fff; }
.os-banner-left { display: flex; align-items: center; gap: 16px; }
.os-banner-icon { font-size: 32px; line-height: 1; }
.os-banner-title { font-size: 18px; font-weight: 700; }
.os-banner-subtitle { font-size: 13px; opacity: 0.8; margin-top: 2px; }
.os-banner-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.os-badge { padding: 4px 10px; border-radius: 20px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.os-badge-ok { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
.os-badge-err { background: rgba(231, 76, 60, 0.2); color: #e74c3c; }
.os-badge-login { background: rgba(52, 152, 219, 0.2); color: #3498db; }
.os-badge-muted { background: rgba(149, 165, 166, 0.2); color: #95a5a6; }
.os-error-banner { background: rgba(231, 76, 60, 0.1); border-left: 3px solid #e74c3c; color: #c0392b; padding: 10px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
.os-section { margin-bottom: 24px; }
.os-section-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
.os-section-header h3 { font-size: 16px; font-weight: 700; color: #2c3e50; margin: 0; }
.os-section-hint { font-size: 12px; color: #95a5a6; }
.os-tabs { display: flex; gap: 0; border-bottom: 2px solid #ecf0f1; margin-bottom: 20px; }
.os-tab { padding: 10px 20px; border: none; background: none; cursor: pointer; font-size: 14px; font-weight: 500; color: #95a5a6; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.15s; }
.os-tab:hover { color: #2c3e50; }
.os-tab.active { color: #3498db; border-bottom-color: #3498db; }
.os-tab-content { padding-top: 4px; }
.os-shocker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.os-shocker-card { background: #fff; border-radius: 10px; border: 2px solid #ecf0f1; padding: 14px; cursor: pointer; transition: all 0.25s ease; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06); }
.os-shocker-card:hover { border-color: #bdc3c7; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1); transform: translateY(-1px); }
.os-shocker-selected { border-color: #3498db; background: #f0f8ff; box-shadow: 0 4px 16px rgba(52, 152, 219, 0.2); }
.os-shocker-card-header { display: flex; justify-content: space-between; align-items: center; }
.os-shocker-name { font-weight: 700; font-size: 14px; color: #2c3e50; }
.os-shocker-card-meta { font-size: 12px; color: #95a5a6; margin-top: 4px; }
.os-control-row { display: flex; gap: 16px; margin-top: 10px; }
.os-range { width: 100%; }
.os-control-buttons { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.os-feedback { margin-top: 12px; padding: 8px 14px; background: rgba(46, 204, 113, 0.1); border-left: 3px solid #2ecc71; border-radius: 6px; font-size: 13px; color: #27ae60; }
.os-share-perms { display: flex; gap: 16px; margin: 8px 0; }
.os-perm-toggle { display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 13px; }
.os-share-result { display: flex; gap: 10px; margin-top: 12px; align-items: center; }
.os-share-input { flex: 1; }
.os-empty { text-align: center; padding: 30px; color: #95a5a6; }
.os-empty-icon { font-size: 40px; margin-bottom: 8px; }
.os-hint { font-size: 12px; color: #95a5a6; margin-top: 6px; }
.os-hint code { background: #ecf0f1; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
.os-token-footer { padding: 12px 16px; font-size: 12px; }
.os-log-list { display: flex; flex-direction: column; gap: 6px; }
.os-log-entry { display: flex; gap: 10px; padding: 10px 12px; background: #f8f9fa; border-radius: 8px; border: 1px solid #ecf0f1; }
.os-log-icon { font-size: 18px; line-height: 1; flex-shrink: 0; width: 24px; text-align: center; }
.os-log-icon-shock { color: #e67e22; }
.os-log-icon-notify { color: #9b59b6; }
.os-log-body { flex: 1; min-width: 0; }
.os-log-top { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }
.os-log-msg { font-size: 13px; color: #333; line-height: 1.4; }
.os-log-error { font-size: 12px; color: #e74c3c; margin-top: 4px; }
.os-log-time { font-size: 11px; color: #95a5a6; margin-top: 4px; }
:global(body.dark-theme .os-banner-connected) { background: linear-gradient(135deg, #1a252f 0%, #1e7e34 100%); }
:global(body.dark-theme .os-banner-disconnected) { background: linear-gradient(135deg, #1a252f 0%, #2c3e50 100%); }
:global(body.dark-theme .os-tabs) { border-bottom-color: #444; }
:global(body.dark-theme .os-tab) { color: #7f8c8d; }
:global(body.dark-theme .os-tab:hover) { color: #ecf0f1; }
:global(body.dark-theme .os-tab.active) { color: #5dade2; border-bottom-color: #5dade2; }
:global(body.dark-theme .os-shocker-card) { background: #2a2a2a; border-color: #444; }
:global(body.dark-theme .os-shocker-card:hover) { border-color: #666; }
:global(body.dark-theme .os-shocker-selected) { border-color: #5dade2; background: #1a2a3a; }
:global(body.dark-theme .os-shocker-name) { color: #ecf0f1; }
:global(body.dark-theme .os-section-header h3) { color: #ecf0f1; }
:global(body.dark-theme .os-error-banner) { background: rgba(231, 76, 60, 0.15); color: #e74c3c; }
:global(body.dark-theme .os-hint code) { background: #444; color: #ecf0f1; }
:global(body.dark-theme .os-log-entry) { background: #2a2a2a; border-color: #444; }
:global(body.dark-theme .os-log-msg) { color: #ddd; }
</style>

