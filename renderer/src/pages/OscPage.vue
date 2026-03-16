<script setup lang="ts">
import { ref } from 'vue'
import { useElectronAPI } from '../composables/useElectronAPI'
import { useOscStatus, type BlockedParam } from '../composables/useOscStatus'

const api = useElectronAPI()

const {
  oscEnabled, oscToggling, oscPort, oscStatus, queryRunning,
  localPort, targetPort, targetAddress, oscQueryBindAddress,
  additionalConnections, unsubscriptions, blockedParams,
  toggleOsc, updateOscPorts, oscQueryForceReconnect, oscQueryResetAll,
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

async function handleAddUnsub() {
  const path = newUnsubPath.value.trim()
  if (!path) return
  await addUnsubscription(path)
  newUnsubPath.value = ''
}
function canUnsuppress(param: BlockedParam): boolean {
  return param.source === 'suppressed'
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
  <div class="page-view">
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
      <div class="form-group">
        <h4 class="subheading">Legacy OSC (for non-OSC-Query apps)</h4>
        <label for="local-port-settings">Legacy Incoming OSC Port</label>
        <input id="local-port-settings" v-model.number="localPort" type="number" min="1" max="65535" />
      </div>
      <div class="form-group">
        <h4 class="subheading">Outgoing OSC Target</h4>
        <label for="target-address-settings">Target IP Address</label>
        <input id="target-address-settings" v-model="targetAddress" type="text" />
      </div>
      <div class="form-group">
        <label for="target-port-settings">Target Port</label>
        <input id="target-port-settings" v-model.number="targetPort" type="number" min="1" max="65535" />
      </div>
      <div class="form-group">
        <h4 class="subheading">OSC-Query Binding</h4>
        <label for="oscquery-bind-address-settings">Bind Address</label>
        <input id="oscquery-bind-address-settings" v-model="oscQueryBindAddress" type="text" />
      </div>
      <button class="btn btn-primary" type="button" @click="updateOscPorts">Update OSC Configuration</button>
    </div>

    <div class="card">
      <h3>OSC Status</h3>
      <div class="connection-status">
        <span class="status-indicator" :class="oscStatus === 'connected' ? 'status-connected' : oscStatus === 'stopping' ? 'status-pending' : 'status-disconnected'"></span>
        <span v-if="oscStatus === 'connected'">OSC Enabled :{{ oscPort }}</span>
        <span v-else-if="oscStatus === 'stopping'">OSC Stopping...</span>
        <span v-else>OSC Disabled</span>
      </div>
      <button class="btn" :class="oscEnabled ? 'btn-danger' : 'btn-primary'" :disabled="oscToggling" type="button" @click="toggleOsc">
        {{ oscEnabled ? 'Disable OSC' : 'Enable OSC' }}
      </button>
    </div>

    <div class="card">
      <h3>Additional OSC Connections</h3>
      <p class="description-text">
        Configure additional OSC endpoints for advanced routing. Create separate incoming connections to receive OSC data from multiple sources,
        and outgoing connections to send data to multiple applications.
      </p>
      <div class="osc-connection-controls">
        <div class="osc-connection-actions">
          <button class="btn btn-success" type="button" :disabled="additionalConnections.length >= MAX_ADDITIONAL_CONNECTIONS" @click="addConnection('incoming')">+ Add Incoming</button>
          <button class="btn btn-success" type="button" :disabled="additionalConnections.length >= MAX_ADDITIONAL_CONNECTIONS" @click="addConnection('outgoing')">+ Add Outgoing</button>
        </div>
        <span class="connection-count-text">{{ additionalConnections.length }}/{{ MAX_ADDITIONAL_CONNECTIONS }} additional connections</span>
      </div>
      <div v-for="conn in additionalConnections" :key="conn.id" class="osc-connection-item">
        <div class="osc-connection-header">
          <h6>{{ conn.name || (conn.type === 'incoming' ? 'Incoming Connection' : 'Outgoing Connection') }}</h6>
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

    <div class="card">
      <h3>OSC-Query Service</h3>
      <p class="description-text">
        Automatic service discovery for VRChat using OSC-Query protocol. By default, all OSC data is received.
      </p>
      <div class="status-row">
        <span class="status-indicator" :class="queryRunning ? 'status-connected' : 'status-disconnected'"></span>
        <span>{{ queryRunning ? 'Running' : 'Stopped' }}</span>
        <button class="btn btn-secondary" type="button" @click="oscQueryForceReconnect">Force Reconnect</button>
        <button class="btn btn-warning" type="button" @click="oscQueryResetAll">Reset All</button>
      </div>
      <div class="oscquery-box">
        <h4>Path Unsubscription (Ignore Specific Paths)</h4>
        <p class="description-text">Add OSC paths to ignore if they are causing noise or unnecessary updates.</p>
        <div class="oscquery-form-row">
          <input v-model="newUnsubPath" type="text" placeholder="/avatar/parameters/example or /path/*" @keypress.enter="handleAddUnsub" />
          <button class="btn btn-warning" type="button" @click="handleAddUnsub">Add to Ignore List</button>
        </div>
        <div v-for="path in unsubscriptions" :key="path" class="oscquery-unsub-item">
          <span class="mono">{{ path }}</span>
          <button class="btn btn-danger btn-small" type="button" @click="removeUnsubscription(path)">Remove</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Blocked Parameters</h3>
      <p class="description-text">These paths are blocked and will not be forwarded to VRChat.</p>
      <button class="btn btn-secondary btn-small" type="button" @click="blockedExpanded = !blockedExpanded">
          {{ blockedExpanded ? '▼ Collapse' : '▶ Expand' }}
      </button>
      <div v-if="blockedExpanded" class="blocked-list">
        <div v-for="param in blockedParams" :key="param.path + param.source"
          class="blocked-item"
          :class="{ clickable: canUnsuppress(param) }"
          @click="canUnsuppress(param) && requestUnsuppress(param.path)">
          <span class="mono">{{ param.path }}</span>
          <span class="badges">
            <span v-if="param.source === 'hardcoded'" class="badge badge-user">User</span>
            <span v-else-if="param.source === 'blocklist'" class="badge badge-blocked">Blocked</span>
            <span v-else class="badge badge-suppressed">Suppressed</span>
            <span v-if="param.isPanelParam" class="badge badge-panel">Panel</span>
            <span v-if="param.isInAvatarJson" class="badge badge-avatar">Avatar JSON</span>
          </span>
          <span v-if="canUnsuppress(param)" class="unsuppress-hint">Click to unsuppress</span>
        </div>
      </div>
    </div>
  </div>
</template>
