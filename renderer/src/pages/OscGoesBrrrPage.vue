<script setup lang="ts">
import { useOscGoesBrrr, ALL_SOURCES } from '../composables/useOscGoesBrrr'
import { ref } from 'vue'

const {
  status,
  autostart,
  selectedDeviceId,
  deviceBinding,
  toggle,
  toggleAutostart,
  selectDevice,
  saveDeviceBinding,
  updateIntifaceSettings,
  refreshStatus
} = useOscGoesBrrr()

const intifaceAddress = ref('')
const intifacePort = ref(12345)
const intifaceWss = ref(false)

function populateIntifaceForm() {
  intifaceAddress.value = status.value.intifaceAddress
  intifacePort.value = status.value.intifacePort
  intifaceWss.value = status.value.intifaceWss
}
async function saveIntiface() {
  await updateIntifaceSettings(intifaceAddress.value, intifacePort.value, intifaceWss.value)
}
function toggleSource(src: string) {
  const idx = deviceBinding.value.sources.indexOf(src)
  if (idx >= 0) deviceBinding.value.sources.splice(idx, 1)
  else deviceBinding.value.sources.push(src)
}
</script>

<template>
  <div class="page">
    <h2>OscGoesBrrr</h2>

    <!-- Status -->
    <div class="card">
      <h3>Status</h3>
      <p v-if="status.connecting">Connecting...</p>
      <p v-else-if="status.connected" class="text-success">
        Connected to {{ status.serverName }} v{{ status.serverVersion }}
      </p>
      <p v-else-if="status.lastError" class="text-danger">Error: {{ status.lastError }}</p>
      <p v-else>Stopped</p>
      <div class="button-row">
        <button @click="toggle">{{ status.enabled ? 'Stop' : 'Start' }}</button>
        <label>
          <input type="checkbox" :checked="autostart" @change="toggleAutostart" />
          Autostart
        </label>
      </div>
    </div>

    <!-- Max Level -->
    <div v-if="status.connected" class="card">
      <h3>Max Level</h3>
      <div class="level-bar-container">
        <div class="level-bar" :style="{ width: (status.maxLevel * 100) + '%' }"></div>
      </div>
      <span>{{ Math.round(status.maxLevel * 100) }}%</span>
    </div>

    <!-- Devices -->
    <div v-if="status.connected && status.devices.length" class="card">
      <h3>Devices ({{ status.deviceCount }})</h3>
      <div v-for="device in status.devices" :key="device.id" class="device-card" @click="selectDevice(device.id)">
        <div class="device-header">
          <strong>{{ device.name }}</strong>
          <span v-if="device.batteryLevel != null" class="badge">🔋 {{ Math.round(device.batteryLevel * 100) }}%</span>
          <span class="badge">ID: {{ device.id }}</span>
        </div>
        <div v-if="device.features.length" class="device-features">
          <div v-for="(feat, i) in device.features" :key="i" class="feature-row">
            <span class="feature-type">{{ feat.type }}</span>
            <div class="level-bar-container small">
              <div class="level-bar" :style="{ width: (feat.lastLevel * 100) + '%' }"></div>
            </div>
            <span class="feature-level">{{ Math.round(feat.lastLevel * 100) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Game Devices -->
    <div v-if="status.connected && status.gameDevices.length" class="card">
      <h3>Avatar Contacts</h3>
      <ul>
        <li v-for="(gd, i) in status.gameDevices" :key="i">{{ gd }}</li>
      </ul>
    </div>

    <!-- Device Config -->
    <div v-if="selectedDeviceId" class="card">
      <h3>Device Config — {{ selectedDeviceId }}</h3>
      <div class="form-group">
        <label>Type</label>
        <select v-model="deviceBinding.type">
          <option value="all">All</option>
          <option value="vibrate">Vibrate</option>
          <option value="rotate">Rotate</option>
          <option value="linear">Linear</option>
          <option value="oscillate">Oscillate</option>
        </select>
      </div>
      <div class="form-group">
        <label>Sources</label>
        <div class="checkbox-group">
          <label v-for="src in ALL_SOURCES" :key="src">
            <input type="checkbox" :checked="deviceBinding.sources.includes(src)" @change="toggleSource(src)" />
            {{ src }}
          </label>
        </div>
      </div>
      <div class="form-group">
        <label>Multiplier: {{ deviceBinding.multiplier.toFixed(1) }}</label>
        <input type="range" min="0" max="5" step="0.1" v-model.number="deviceBinding.multiplier" />
      </div>
      <div class="form-group">
        <label>Idle Level: {{ deviceBinding.idle.toFixed(2) }}</label>
        <input type="range" min="0" max="1" step="0.01" v-model.number="deviceBinding.idle" />
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" v-model="deviceBinding.linear" />
          Linear
        </label>
      </div>
      <button @click="saveDeviceBinding">Save Device Config</button>
    </div>

    <!-- Intiface Settings -->
    <div v-if="status.connected" class="card">
      <h3>Intiface Settings</h3>
      <button class="btn-sm" @click="populateIntifaceForm">Edit</button>
      <div class="form-group">
        <label>Address</label>
        <input type="text" v-model="intifaceAddress" placeholder="127.0.0.1" />
      </div>
      <div class="form-group">
        <label>Port</label>
        <input type="number" v-model.number="intifacePort" />
      </div>
      <div class="form-group">
        <label><input type="checkbox" v-model="intifaceWss" /> Use WSS</label>
      </div>
      <button @click="saveIntiface">Save Intiface Settings</button>
    </div>
  </div>
</template>
