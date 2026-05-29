<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOscGoesBrrr, ALL_SOURCES } from '../composables/useOscGoesBrrr'

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

const statusLabel = computed(() => {
  if (status.value.connecting) return 'Connecting'
  if (status.value.connected) return 'Connected'
  if (status.value.lastError) return 'Error'
  return 'Stopped'
})

const statusClass = computed(() => {
  if (status.value.lastError) return 'status-disconnected'
  if (status.value.connecting) return 'status-pending'
  if (status.value.connected) return 'status-connected'
  return 'status-disconnected'
})

// Watch each intiface field as an individual primitive so Vue uses Object.is comparisons.
// This prevents the 1s polling loop (which replaces status.value entirely) from
// resetting user input when the backend value hasn't actually changed.
watch(() => status.value.intifaceAddress, (val) => { intifaceAddress.value = val }, { immediate: true })
watch(() => status.value.intifacePort, (val) => { intifacePort.value = val }, { immediate: true })
watch(() => status.value.intifaceWss, (val) => { intifaceWss.value = val }, { immediate: true })
watch(status, (currentStatus) => {
  if (!selectedDeviceId.value && currentStatus.devices.length > 0) {
    void selectDevice(currentStatus.devices[0].id)
  }
}, { immediate: true, deep: true })

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

async function handleSelectDevice(event: Event) {
  const deviceId = (event.target as HTMLSelectElement).value
  if (!deviceId) return
  await selectDevice(deviceId)
}
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>OscGoesBrrr</h1>
      <p>Control Bluetooth haptic devices from VRChat OSC using Intiface/Buttplug</p>
    </div>

    <div class="card">
      <h3>Connection Status</h3>
      <div class="connection-status">
        <span class="status-indicator" :class="statusClass"></span>
        <span>{{ statusLabel }}</span>
      </div>
      <div v-if="status.serverName || status.serverVersion" id="ogb-server-info">
        {{ status.serverName }}<span v-if="status.serverVersion"> v{{ status.serverVersion }}</span>
      </div>
      <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
        <button class="btn btn-primary" type="button" @click="toggle">{{ status.enabled ? 'Stop' : 'Start' }}</button>
        <div class="autostart-toggle-container">
          <span style="font-size: 13px; font-weight: 600; opacity: 0.8;">Auto-start:</span>
          <div class="autostart-toggle-slider" role="button" tabindex="0" @click="toggleAutostart" @keyup.enter="toggleAutostart" @keyup.space.prevent="toggleAutostart">
            <div class="autostart-toggle-option disabled" :class="{ active: !autostart }">Disabled</div>
            <div class="autostart-toggle-option enabled" :class="{ active: autostart }">Enabled</div>
          </div>
        </div>
      </div>
      <div style="margin-top: 15px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span style="font-size: 13px; font-weight: 600;">Max Haptic Level</span>
          <span id="ogb-level-text" style="font-size: 13px; font-weight: 600;">{{ Math.round(status.maxLevel * 100) }}%</span>
        </div>
        <div class="ogb-level-bar-container">
          <div id="ogb-level-bar" :style="{ width: `${status.maxLevel * 100}%` }"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Intiface Settings</h3>
      <div class="form-group">
        <label for="ogb-intiface-address">Intiface Address</label>
        <div style="display: flex; gap: 10px; margin-top: 5px; align-items: center;">
          <input id="ogb-intiface-address" v-model="intifaceAddress" type="text" placeholder="127.0.0.1" style="flex: 1;" />
          <span>:</span>
          <input id="ogb-intiface-port" v-model.number="intifacePort" type="number" placeholder="12345" style="width: 80px;" />
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 14px; white-space: nowrap;">
            <input v-model="intifaceWss" type="checkbox" style="margin: 0;" />
            <span>WSS</span>
          </label>
          <button class="btn btn-secondary" type="button" style="padding: 6px 12px;" @click="saveIntiface">Save</button>
        </div>
        <div style="font-size: 12px; color: #666; margin-top: 5px;">
          Make sure Intiface Central is running and the server is started
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Connected Haptic Devices</h3>
      <div v-if="status.devices.length === 0" class="ogb-no-devices">
        <p>No haptic devices connected</p>
        <p class="hint">Make sure Intiface Central is running and devices are connected</p>
      </div>
      <div v-else>
        <div v-for="device in status.devices" :key="device.id" class="ogb-device-card" @click="selectDevice(device.id)">
          <div class="ogb-device-header">
            <div class="ogb-device-name">{{ device.name }}</div>
            <div class="ogb-device-battery" v-if="device.batteryLevel != null">
              <svg class="ogb-battery-icon" viewBox="0 0 28 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="0" y="1" width="24" height="12" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
                <rect x="24.5" y="4" width="3" height="6" rx="1" fill="currentColor"/>
                <rect x="1.5" y="2.5" :width="Math.max(0, (device.batteryLevel / 100) * 21)" height="9" rx="1.5"
                      :fill="device.batteryLevel >= 60 ? '#2ecc71' : device.batteryLevel >= 20 ? '#f39c12' : '#e74c3c'"/>
              </svg>
              <span :style="{ color: device.batteryLevel >= 60 ? '#2ecc71' : device.batteryLevel >= 20 ? '#f39c12' : '#e74c3c', fontWeight: 600 }">
                {{ Math.round(device.batteryLevel) }}%
              </span>
            </div>
          </div>
          <div class="ogb-features-list">
            <div v-for="(feature, index) in device.features" :key="index" class="ogb-feature">
              <span class="ogb-feature-type">{{ feature.type }}</span>
              <div class="ogb-feature-level">
                <div class="feature-level-bar-container">
                  <div class="feature-level-bar" :style="{ width: `${feature.lastLevel * 100}%` }"></div>
                </div>
              </div>
              <span class="ogb-feature-value">{{ Math.round(feature.lastLevel * 100) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" id="ogb-device-config-section">
      <h3>Device Configuration</h3>
      <div class="form-group">
        <label for="ogb-config-device-select">Select Device</label>
        <select id="ogb-config-device-select" :value="selectedDeviceId ?? ''" @change="handleSelectDevice">
          <option value="">-- No devices connected --</option>
          <option v-for="device in status.devices" :key="device.id" :value="device.id">{{ device.name }} ({{ device.id }})</option>
        </select>
        <div style="font-size: 12px; color: #666; margin-top: 5px;">
          Settings are saved per device and apply even when the device is disconnected
        </div>
      </div>

      <template v-if="selectedDeviceId">
        <div class="form-group">
          <label for="ogb-config-type">Source Type Filter</label>
          <select id="ogb-config-type" v-model="deviceBinding.type">
          <option value="all">All</option>
            <option value="pen">Penetrators Only</option>
            <option value="orf">Orifices Only</option>
          </select>
        </div>

        <div class="form-group">
          <label>Enabled Contact Sources</label>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 5px; font-size: 16px;">
            <label v-for="source in ALL_SOURCES" :key="source" class="ogb-source-item">
              <input type="checkbox" :checked="deviceBinding.sources.includes(source)" @change="toggleSource(source)" />
              <span>{{ source }}</span>
            </label>
          </div>
        </div>

        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label for="ogb-config-multiplier">Intensity Multiplier (Scale)</label>
            <span id="ogb-config-multiplier-value" style="font-weight: 600; color: #3498db;">{{ deviceBinding.multiplier.toFixed(1) }}x</span>
          </div>
          <input id="ogb-config-multiplier" v-model.number="deviceBinding.multiplier" type="range" min="0.1" max="2.0" step="0.1" style="width: 100%;" />
          <div style="display: flex; justify-content: space-between; font-size: 13px; color: #aaa; margin-top: 2px;">
            <span>Min: 0.1x</span>
            <span>Max: 2.0x</span>
          </div>
          <div style="font-size: 13px; color: #b0b0b0; margin-top: 5px; line-height: 1.4;">
            Increase if toy needs more work to vibrate, decrease if it's always on/off with nothing in between
          </div>
        </div>

        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label for="ogb-config-idle">Idle Vibration Level</label>
            <span id="ogb-config-idle-value" style="font-weight: 600; color: #3498db;">{{ Math.round(deviceBinding.idle * 100) }}%</span>
          </div>
          <input id="ogb-config-idle" v-model.number="deviceBinding.idle" type="range" min="0" max="1" step="0.05" style="width: 100%;" />
          <div style="display: flex; justify-content: space-between; font-size: 13px; color: #aaa; margin-top: 2px;">
            <span>Min: 0%</span>
            <span>Max: 100%</span>
          </div>
          <div style="font-size: 13px; color: #b0b0b0; margin-top: 5px; line-height: 1.4;">
            Minimum vibration level when not being touched/penetrated (idle baseline)
          </div>
        </div>

        <div class="form-group">
          <label>Vibration Mode</label>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 5px; font-size: 16px;">
            <label class="ogb-source-item">
              <input v-model="deviceBinding.linear" type="checkbox" />
              <span>Depth-Based Vibration</span>
            </label>
          </div>
          <div style="font-size: 13px; color: #b0b0b0; margin-top: 8px; line-height: 1.4;">
            When checked: vibrates based on penetration depth. When unchecked: vibrates based on motion/speed
          </div>
        </div>

        <div style="margin-top: 10px;">
          <button class="btn btn-primary" type="button" style="width: 100%;" @click="saveDeviceBinding">Save Configuration</button>
        </div>
      </template>
    </div>

    <div class="card">
      <h3>Avatar Contact Sources</h3>
      <div v-if="status.gameDevices.length === 0" class="ogb-no-devices">
        <p>No avatar contacts detected</p>
        <p class="hint">Contacts will appear when your avatar has VRCFury Haptics or similar setup</p>
      </div>
      <div v-else>
        <div v-for="(gameDevice, index) in status.gameDevices" :key="index" class="ogb-game-device">
          <span class="ogb-game-device-name">{{ gameDevice }}</span>
          <div class="ogb-game-device-info">Detected</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>About OscGoesBrrr</h3>
      <p style="font-size: 14px; color: #888; line-height: 1.6;">
        OscGoesBrrr bridges VRChat avatar haptic parameters to Bluetooth toys via the Intiface Central application.
      </p>
      <p style="font-size: 13px; color: #666; margin-top: 10px;">
        Supported avatar systems: OGB (OscGoesBrrr), TPS (Poiyomi/DPS), VRCFury Haptics
      </p>
    </div>
  </div>
</template>
