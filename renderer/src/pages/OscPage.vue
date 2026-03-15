<script setup lang="ts">
import { ref } from 'vue'
import { useOscStatus, type BlockedParam } from '../composables/useOscStatus'

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

async function handleAddUnsub() {
  const path = newUnsubPath.value.trim()
  if (!path) return
  await addUnsubscription(path)
  newUnsubPath.value = ''
}
function canUnsuppress(param: BlockedParam): boolean {
  return param.source === 'suppressed'
}
</script>

<template>
  <div class="page">
    <h2>OSC</h2>

    <!-- OSC Server Status & Toggle -->
    <div class="section">
      <div class="status-row">
        <span class="status-indicator" :class="{
          'status-connected': oscStatus === 'connected',
          'status-disconnected': oscStatus === 'disabled' || oscStatus === 'error' || oscStatus === 'off'
        }"></span>
        <span v-if="oscStatus === 'connected'">OSC Enabled :{{ oscPort }}</span>
        <span v-else-if="oscStatus === 'stopping'">OSC Stopping...</span>
        <span v-else>OSC Disabled</span>
        <button class="btn" :class="oscEnabled ? 'btn-danger' : 'btn-primary'" :disabled="oscToggling" @click="toggleOsc">
          {{ oscEnabled ? 'Disable OSC' : 'Enable OSC' }}
        </button>
      </div>
    </div>

    <!-- OSC Port Configuration -->
    <div class="section">
      <h3>OSC Configuration</h3>
      <div class="config-grid">
        <label>
          <span>Legacy Incoming Port</span>
          <input v-model.number="localPort" type="number" class="input" min="1" max="65535" />
        </label>
        <label>
          <span>Target Port</span>
          <input v-model.number="targetPort" type="number" class="input" min="1" max="65535" />
        </label>
        <label>
          <span>Target Address</span>
          <input v-model="targetAddress" type="text" class="input" />
        </label>
        <label>
          <span>OSC-Query Bind Address</span>
          <input v-model="oscQueryBindAddress" type="text" class="input" />
        </label>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" @click="updateOscPorts">Save OSC Config</button>
      </div>
    </div>

    <!-- OSC Query -->
    <div class="section">
      <h3>OSC-Query</h3>
      <div class="status-row">
        <span class="status-indicator" :class="queryRunning ? 'status-connected' : 'status-disconnected'"></span>
        <span>{{ queryRunning ? 'Running' : 'Stopped' }}</span>
        <button class="btn btn-secondary" @click="oscQueryForceReconnect">Force Reconnect</button>
        <button class="btn btn-warning" @click="oscQueryResetAll">Reset All</button>
      </div>
    </div>

    <!-- Additional Connections -->
    <div class="section">
      <h3>Additional Connections ({{ additionalConnections.length }}/{{ MAX_ADDITIONAL_CONNECTIONS }})</h3>
      <div class="btn-row">
        <button class="btn btn-primary" :disabled="additionalConnections.length >= MAX_ADDITIONAL_CONNECTIONS" @click="addConnection('incoming')">+ Incoming</button>
        <button class="btn btn-primary" :disabled="additionalConnections.length >= MAX_ADDITIONAL_CONNECTIONS" @click="addConnection('outgoing')">+ Outgoing</button>
      </div>
      <div v-for="conn in additionalConnections" :key="conn.id" class="connection-item">
        <div class="conn-header">
          <span class="conn-type" :class="conn.type">{{ conn.type === 'incoming' ? 'IN' : 'OUT' }}</span>
          <input :value="conn.name" class="input input-sm" placeholder="Name" @input="(e: Event) => updateConnection(conn.id, 'name', (e.target as HTMLInputElement).value)" />
          <input :value="conn.port ?? ''" class="input input-sm input-port" type="number" placeholder="Port" @input="(e: Event) => updateConnection(conn.id, 'port', (e.target as HTMLInputElement).value)" />
          <input :value="conn.address" class="input input-sm" placeholder="Address" @input="(e: Event) => updateConnection(conn.id, 'address', (e.target as HTMLInputElement).value)" />
          <label class="toggle-label">
            <input type="checkbox" :checked="conn.enabled" @change="toggleConnection(conn.id, !conn.enabled)" /> On
          </label>
          <label class="toggle-label">
            <input type="checkbox" :checked="conn.enableWebSocketForwarding" @change="toggleConnectionForwarding(conn.id, !conn.enableWebSocketForwarding)" /> WS
          </label>
          <button class="btn btn-danger btn-sm" @click="removeConnection(conn.id)">✕</button>
        </div>
      </div>
    </div>

    <!-- OSC Query Unsubscriptions -->
    <div class="section">
      <h3>OSC-Query Unsubscriptions</h3>
      <div class="form-row">
        <input v-model="newUnsubPath" type="text" class="input" placeholder="/path/to/unsubscribe" @keypress.enter="handleAddUnsub" />
        <button class="btn btn-primary" @click="handleAddUnsub">Add</button>
      </div>
      <div v-for="path in unsubscriptions" :key="path" class="unsub-item">
        <span class="mono">{{ path }}</span>
        <button class="btn btn-danger btn-sm" @click="removeUnsubscription(path)">✕</button>
      </div>
    </div>

    <!-- Blocked Parameters -->
    <div class="section">
      <h3>
        Blocked Parameters ({{ blockedParams.length }})
        <button class="btn btn-secondary btn-sm" @click="blockedExpanded = !blockedExpanded">
          {{ blockedExpanded ? '▼ Collapse' : '▶ Expand' }}
        </button>
      </h3>
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

<style scoped>
.section { margin-bottom: 20px; }
.section h3 { margin: 0 0 8px; font-size: 1rem; color: #e0e0f0; display: flex; align-items: center; gap: 8px; }
.status-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.config-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: #a0a0b8; }
.input {
  padding: 8px 12px; border-radius: 4px; border: 1px solid #555;
  background: #2a2a3e; color: #fff; font-size: 0.9rem;
}
.input-sm { padding: 4px 8px; font-size: 0.85rem; }
.input-port { width: 80px; }
.btn-row { display: flex; gap: 8px; margin-bottom: 8px; }
.btn-sm { padding: 2px 8px; font-size: 0.8rem; }
.form-row { display: flex; gap: 8px; margin-bottom: 8px; }
.form-row .input { flex: 1; }
.connection-item { background: #2a2a3e; border-radius: 6px; padding: 8px 12px; margin-bottom: 6px; }
.conn-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.conn-type { font-weight: 700; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
.conn-type.incoming { background: #27ae60; color: #fff; }
.conn-type.outgoing { background: #3498db; color: #fff; }
.toggle-label { display: flex; align-items: center; gap: 4px; font-size: 0.8rem; color: #a0a0b8; white-space: nowrap; }
.unsub-item { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: #2a2a3e; border-radius: 4px; margin-bottom: 4px; }
.mono { font-family: monospace; font-size: 0.85rem; }
.blocked-list { max-height: 400px; overflow-y: auto; }
.blocked-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 12px; background: #2a2a3e; border-radius: 4px;
  margin-bottom: 4px; border-left: 3px solid #dc3545;
}
.blocked-item.clickable { cursor: pointer; }
.blocked-item.clickable:hover { background: #3a3a4e; }
.badges { display: flex; gap: 4px; }
.badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
.badge-user { background: #2980b9; color: #fff; }
.badge-blocked { background: #e74c3c; color: #fff; }
.badge-suppressed { background: #e67e22; color: #fff; }
.badge-panel { background: #8e44ad; color: #fff; }
.badge-avatar { background: #16a085; color: #fff; }
.unsuppress-hint { font-size: 10px; color: #a0a080; margin-left: 8px; }
</style>
