<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElectronAPI } from '../composables/useElectronAPI'
import { useOscStatus, type BlockedParam } from '../composables/useOscStatus'

const api = useElectronAPI()

const {
  queryRunning,
  localPort, targetPort, targetAddress, oscQueryBindAddress,
  additionalConnections, unsubscriptions, blockedParams,
  updateOscPorts,
  addConnection, removeConnection, toggleConnection,
  toggleConnectionForwarding, updateConnection,
  addUnsubscription, removeUnsubscription, requestUnsuppress,
  MAX_ADDITIONAL_CONNECTIONS
} = useOscStatus()

const newUnsubPath = ref('')
const blockedExpanded = ref(false)
const oscAddress = ref('')
const oscValue = ref('')
const oscType = ref<'float' | 'int' | 'bool'>('float')
const sendMessage = ref<string | null>(null)

const incomingConnections = computed(() => additionalConnections.value.filter((conn) => conn.type === 'incoming'))
const outgoingConnections = computed(() => additionalConnections.value.filter((conn) => conn.type === 'outgoing'))
const queryStatusText = computed(() => queryRunning.value ? 'OSC-Query service is active and listening to all incoming OSC data' : 'OSC-Query service is currently stopped')
const blockedEmpty = computed(() => blockedParams.value.length === 0)
const blockedCountLabel = computed(() => `${blockedParams.value.length} blocked path(s)`)

async function handleAddUnsub() {
  const path = newUnsubPath.value.trim()
  if (!path) return
  await addUnsubscription(path)
  newUnsubPath.value = ''
}
function canUnsuppress(param: BlockedParam): boolean {
  return param.source === 'suppressed'
}

function connectionCardTitle(name: string, fallbackPrefix: string, index: number) {
  return name || `${fallbackPrefix} Connection ${index}`
}

function blockedBadges(param: BlockedParam) {
  const badges: string[] = []
  if (param.source === 'hardcoded') {
    badges.push('User')
  } else if (param.source === 'blocklist') {
    badges.push('Blocked')
  } else {
    badges.push('Suppressed')
  }
  if (param.isPanelParam) {
    badges.push('Panel')
  }
  if (param.isInAvatarJson) {
    badges.push('Avatar JSON')
  }
  return badges
}

async function handleSendOsc() {
  const address = oscAddress.value.trim()
  const rawValue = oscValue.value.trim()
  if (!address || !rawValue) return
  let value: string | number | boolean = rawValue
  let type = 'f'
  if (oscType.value === 'int') {
    value = Number.parseInt(rawValue, 10)
    type = 'i'
  } else if (oscType.value === 'bool') {
    value = rawValue === 'true' || rawValue === '1'
    type = 'bool'
  } else {
    value = Number.parseFloat(rawValue)
    type = 'f'
  }
  const result = await api.sendOscLocal({ address, value, type })
  sendMessage.value = result?.success ? 'OSC message sent successfully.' : result?.error ?? 'Failed to send OSC message.'
}
</script>

<template>
  <div class="page-view osc-page-legacy">
    <div class="header">
      <h1>OSC Settings</h1>
      <p>Configure and test OSC communication</p>
    </div>

    <div class="card">
      <h3>Send OSC Message</h3>
      <div class="osc-sender">
        <div class="form-group">
          <label for="osc-address">Address</label>
          <input id="osc-address" v-model="oscAddress" type="text" placeholder="/avatar/parameters/example" />
        </div>
        <div class="form-group">
          <label for="osc-value">Value</label>
          <input id="osc-value" v-model="oscValue" type="text" placeholder="1.0" @keypress.enter="handleSendOsc" />
        </div>
        <div class="form-group">
          <label for="osc-type">Type</label>
          <select id="osc-type" v-model="oscType">
            <option value="float">Float</option>
            <option value="int">Int</option>
            <option value="bool">Bool</option>
          </select>
        </div>
        <button class="btn btn-primary" type="button" @click="handleSendOsc">Send</button>
      </div>
      <small v-if="sendMessage">{{ sendMessage }}</small>
    </div>

    <div class="card">
      <h3>OSC Configuration</h3>
      <div class="osc-settings-group">
        <h4 class="osc-settings-heading">Legacy OSC (for non-OSC-Query apps)</h4>
        <div class="form-group">
          <label for="local-port-settings">Legacy Incoming OSC Port</label>
          <input id="local-port-settings" v-model.number="localPort" type="number" min="1" max="65535" />
        </div>
      </div>
      <div class="osc-settings-group">
        <h4 class="osc-settings-heading">Outgoing OSC Target</h4>
        <div class="form-group">
          <label for="target-address-settings">Target IP Address</label>
          <input id="target-address-settings" v-model="targetAddress" type="text" />
        </div>
        <div class="form-group">
          <label for="target-port-settings">Target Port</label>
          <input id="target-port-settings" v-model.number="targetPort" type="number" min="1" max="65535" />
        </div>
      </div>
      <div class="osc-settings-group">
        <h4 class="osc-settings-heading">OSC-Query Binding</h4>
        <div class="form-group">
          <label for="oscquery-bind-address-settings">Bind Address <small class="osc-settings-hint">(0.0.0.0 = all interfaces)</small></label>
          <input id="oscquery-bind-address-settings" v-model="oscQueryBindAddress" type="text" />
        </div>
      </div>
      <button class="btn btn-primary" type="button" @click="updateOscPorts">Update OSC Configuration</button>
    </div>

    <div class="card">
      <h3>Additional OSC Connections</h3>
      <p class="osc-settings-copy">
        Configure additional OSC endpoints for advanced routing. Create separate incoming connections to receive OSC data from multiple sources,
        and outgoing connections to send data to multiple applications.
      </p>
      <div class="osc-connection-controls osc-connection-controls-legacy">
        <div class="osc-controls-row">
          <div class="osc-actions-group">
            <button class="btn btn-success osc-action-button" type="button" :disabled="additionalConnections.length >= MAX_ADDITIONAL_CONNECTIONS" @click="addConnection('incoming')">+ Add Incoming</button>
            <button class="btn btn-success osc-action-button" type="button" :disabled="additionalConnections.length >= MAX_ADDITIONAL_CONNECTIONS" @click="addConnection('outgoing')">+ Add Outgoing</button>
          </div>
          <div class="osc-count-group">
            <span class="connection-count-text">{{ additionalConnections.length }}/{{ MAX_ADDITIONAL_CONNECTIONS }} additional connections</span>
          </div>
        </div>
      </div>

      <div v-if="additionalConnections.length === 0">
        <p class="osc-empty-state">No additional connections configured</p>
      </div>
      <div v-else class="osc-connection-columns">
        <div class="osc-connection-column">
          <h5 class="osc-column-heading osc-column-heading-incoming">📥 Incoming <span class="osc-column-count">({{ incomingConnections.length }})</span></h5>
          <p v-if="incomingConnections.length === 0" class="osc-column-empty">No incoming connections</p>
          <div v-for="(conn, index) in incomingConnections" :key="conn.id" class="osc-connection-item osc-legacy-item">
            <div class="osc-connection-header">
              <h6>{{ connectionCardTitle(conn.name, 'Incoming', index + 1) }}</h6>
              <button class="btn btn-danger btn-small" type="button" @click="removeConnection(conn.id)">Remove</button>
            </div>
            <div class="osc-connection-grid">
              <div class="form-group">
                <label>Name</label>
                <input :value="conn.name" type="text" @input="(e: Event) => updateConnection(conn.id, 'name', (e.target as HTMLInputElement).value)" />
              </div>
              <div class="form-group">
                <label>Port</label>
                <input :value="conn.port ?? ''" type="number" min="1" max="65535" @input="(e: Event) => updateConnection(conn.id, 'port', (e.target as HTMLInputElement).value)" />
              </div>
              <div class="form-group">
                <label>Address</label>
                <input :value="conn.address" type="text" @input="(e: Event) => updateConnection(conn.id, 'address', (e.target as HTMLInputElement).value)" />
              </div>
            </div>
            <div class="osc-connection-toggles">
              <label class="toggle-inline">
                <input type="checkbox" :checked="conn.enabled" @change="toggleConnection(conn.id, !conn.enabled)" />
                <span>Enabled</span>
              </label>
            </div>
          </div>
        </div>

        <div class="osc-connection-column">
          <h5 class="osc-column-heading osc-column-heading-outgoing">📤 Outgoing <span class="osc-column-count">({{ outgoingConnections.length }})</span></h5>
          <p v-if="outgoingConnections.length === 0" class="osc-column-empty">No outgoing connections</p>
          <div v-for="(conn, index) in outgoingConnections" :key="conn.id" class="osc-connection-item osc-legacy-item">
            <div class="osc-connection-header">
              <h6>{{ connectionCardTitle(conn.name, 'Outgoing', index + 1) }}</h6>
              <button class="btn btn-danger btn-small" type="button" @click="removeConnection(conn.id)">Remove</button>
            </div>
            <div class="osc-connection-grid">
              <div class="form-group">
                <label>Name</label>
                <input :value="conn.name" type="text" @input="(e: Event) => updateConnection(conn.id, 'name', (e.target as HTMLInputElement).value)" />
              </div>
              <div class="form-group">
                <label>Port</label>
                <input :value="conn.port ?? ''" type="number" min="1" max="65535" @input="(e: Event) => updateConnection(conn.id, 'port', (e.target as HTMLInputElement).value)" />
              </div>
              <div class="form-group">
                <label>Address</label>
                <input :value="conn.address" type="text" @input="(e: Event) => updateConnection(conn.id, 'address', (e.target as HTMLInputElement).value)" />
              </div>
            </div>
            <div class="osc-connection-toggles">
              <label class="toggle-inline">
                <input type="checkbox" :checked="conn.enabled" @change="toggleConnection(conn.id, !conn.enabled)" />
                <span>Enabled</span>
              </label>
              <label class="toggle-inline">
                <input type="checkbox" :checked="conn.enableWebSocketForwarding" @change="toggleConnectionForwarding(conn.id, !conn.enableWebSocketForwarding)" />
                <span>WebSocket Forwarding</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>OSC-Query Service</h3>
      <p class="osc-settings-copy">
        Automatic service discovery for VRChat using OSC-Query protocol. <strong>By default, all OSC data is received (/*)</strong>.
      </p>
      <p class="oscquery-status-text" :class="queryRunning ? 'is-active' : 'is-inactive'">
        {{ queryRunning ? '✓' : '●' }} {{ queryStatusText }}
      </p>

      <div class="oscquery-box oscquery-legacy-box">
        <h4 class="oscquery-legacy-title">Path Unsubscription (Ignore Specific Paths)</h4>
        <p class="oscquery-legacy-copy">
          Add OSC paths to ignore if they're causing performance issues or you don't need them.
          Examples: <code>/avatar/parameters/MyParam</code> or use wildcards like <code>/avatar/parameters/FT/*</code>
        </p>
        <div class="oscquery-form-row oscquery-form-row-legacy">
          <input v-model="newUnsubPath" type="text" placeholder="/avatar/parameters/example or /path/*" @keypress.enter="handleAddUnsub" />
          <button class="btn btn-warning oscquery-add-button" type="button" @click="handleAddUnsub">Add to Ignore List</button>
        </div>
        <div v-if="unsubscriptions.length === 0" class="oscquery-list-shell">
          <p class="oscquery-empty-state">No paths are being ignored. All OSC data is being received.</p>
        </div>
        <div v-else class="oscquery-list-shell">
          <div v-for="path in unsubscriptions" :key="path" class="oscquery-unsub-item legacy-unsub-item">
            <span class="mono">{{ path }}</span>
            <button class="btn btn-success btn-small" type="button" @click="removeUnsubscription(path)">Remove (Listen Again)</button>
          </div>
        </div>

        <div class="oscquery-suggestions-box">
          <h4 class="oscquery-suggestions-title">Suggested Unsubscriptions (High-Frequency Parameters)</h4>
          <p class="oscquery-suggestions-copy">These parameters are being sent very frequently and may impact performance. Click "Ignore" to stop receiving them.</p>
          <p class="oscquery-suggestions-empty">No high-frequency parameters detected yet. Enable OSC and wait for data...</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Blocked Parameters</h3>
      <p class="blocked-params-description">These paths are blocked and will not be forwarded to VRChat. Hardcoded blocks are always active. Server blocks are managed automatically.</p>
      <div class="blocked-params-toolbar">
        <span class="blocked-count-label"><strong>{{ blockedCountLabel }}</strong></span>
        <button class="btn btn-secondary blocked-toggle-button" type="button" @click="blockedExpanded = !blockedExpanded">
          {{ blockedExpanded ? '▼ Collapse' : '▶ Expand' }}
        </button>
      </div>
      <div id="blocked-parameters-list">
        <p v-if="blockedEmpty" class="blocked-empty-state">No blocked parameters. All data is being forwarded normally.</p>
        <div
          v-show="blockedExpanded"
          v-for="param in blockedParams"
          v-else
          :key="param.path + param.source"
          class="legacy-blocked-item"
          :class="{ clickable: canUnsuppress(param) }"
          @click="canUnsuppress(param) && requestUnsuppress(param.path)"
        >
          <span class="legacy-blocked-path mono">{{ param.path }}</span>
          <span class="legacy-blocked-badges">
            <span v-for="badge in blockedBadges(param)" :key="badge" class="legacy-blocked-badge" :class="`legacy-blocked-badge-${badge.toLowerCase().replace(/ /g, '-')}`">{{ badge }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.osc-connection-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.osc-connection-column {
  min-height: 100px;
}

.osc-column-heading {
  margin: 0 0 15px 0;
  font-size: 1.1em;
  display: flex;
  align-items: center;
  padding-bottom: 8px;
}

.osc-column-heading-incoming {
  color: #27ae60;
  border-bottom: 2px solid #27ae60;
}

.osc-column-heading-outgoing {
  color: #e74c3c;
  border-bottom: 2px solid #e74c3c;
}

.osc-column-count {
  font-size: 0.8em;
  margin-left: 10px;
  color: #666;
}

.osc-column-empty {
  text-align: center;
  color: #999;
  font-style: italic;
  padding: 20px;
  border: 2px dashed #ddd;
  border-radius: 5px;
  margin-top: 10px;
}

.osc-legacy-item {
  margin-bottom: 15px;
}

.osc-settings-group {
  margin-bottom: 10px;
}

.osc-settings-group:last-of-type {
  margin-bottom: 16px;
}

.osc-settings-heading {
  margin: 5px 0;
  font-size: 1em;
}

.osc-connection-controls-legacy {
  margin-bottom: 20px;
}

.osc-controls-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.osc-actions-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.osc-action-button {
  margin-right: 0;
}

.osc-count-group {
  display: flex;
  align-items: center;
  gap: 15px;
}

.osc-empty-state {
  text-align: center;
  color: #999;
  font-style: italic;
  padding: 40px;
}

.oscquery-status-text {
  margin-bottom: 15px;
  font-size: 0.85em;
  font-weight: 500;
}

.blocked-toggle-button {
  padding: 2px 8px;
  font-size: 11px;
}

.osc-page-legacy .legacy-unsub-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 5px;
  background: #fff !important;
  border-left: 3px solid #dc3545 !important;
  border-radius: 4px;
}

.osc-page-legacy .oscquery-legacy-box {
  margin-top: 20px;
  padding: 15px;
  background-color: #f8f9fa !important;
  border-radius: 5px;
  border-left: 4px solid #3498db !important;
}

.osc-page-legacy .oscquery-legacy-title {
  margin-top: 0;
  color: #2c3e50;
}

.osc-page-legacy .oscquery-legacy-copy {
  color: #666;
  font-size: 0.85em;
  margin-bottom: 10px;
}

.oscquery-form-row-legacy {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}

.oscquery-add-button {
  white-space: nowrap;
}

.oscquery-list-shell {
  margin-top: 15px;
}

.osc-page-legacy .oscquery-empty-state {
  color: #666;
  font-size: 0.9em;
  font-style: italic;
  text-align: center;
  padding: 10px;
}

.osc-page-legacy .oscquery-suggestions-box {
  margin-top: 20px;
  padding: 15px;
  border-left: 4px solid #ffc107 !important;
  background: rgba(255, 193, 7, 0.08) !important;
  border-radius: 4px;
}

.osc-page-legacy .oscquery-suggestions-title {
  margin: 0 0 8px 0;
  color: #b8860b;
}

.osc-page-legacy .oscquery-suggestions-copy {
  color: #666;
  font-size: 0.85em;
  margin-bottom: 8px;
}

.osc-page-legacy .oscquery-suggestions-empty {
  color: #666;
  font-size: 0.9em;
  font-style: italic;
}

.blocked-params-toolbar {
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.osc-page-legacy .blocked-count-label {
  color: #666;
  font-size: 0.85em;
}

.osc-page-legacy .blocked-params-description {
  margin-bottom: 15px;
  color: #666;
  font-size: 0.9em;
}

.osc-page-legacy .blocked-empty-state {
  color: #666;
  font-size: 0.9em;
  font-style: italic;
  text-align: center;
  padding: 10px;
}

.osc-page-legacy .legacy-blocked-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background-color: #fff8e1 !important;
  border-radius: 4px;
  margin-bottom: 4px;
  border-left: 3px solid #ffc107 !important;
}

.legacy-blocked-item.clickable {
  cursor: pointer;
}

.osc-page-legacy .legacy-blocked-path {
  font-size: 0.85em;
  color: #856404;
}

.legacy-blocked-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.legacy-blocked-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  font-weight: 600;
}

.legacy-blocked-badge-user {
  background: #d1ecf1;
  color: #0c5460;
}

.legacy-blocked-badge-blocked {
  background: #ffc107;
  color: #856404;
}

.legacy-blocked-badge-suppressed {
  background: #f8d7da;
  color: #721c24;
}

.legacy-blocked-badge-panel {
  background: #cce5ff;
  color: #004085;
}

.legacy-blocked-badge-avatar-json {
  background: #d4edda;
  color: #155724;
}

@media (max-width: 900px) {
  .osc-connection-columns {
    grid-template-columns: 1fr;
  }

  .legacy-unsub-item,
  .legacy-blocked-item {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
