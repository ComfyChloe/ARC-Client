<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'
import { useOscLogs } from '../composables/useOscLogs'
import { useDebugLog } from '../composables/useDebugLog'

const { receivedLogs, forwardedLogs, arcReceivedLogs, clearReceived, clearForwarded, clearArcReceived, clearAll } = useOscLogs()
const { entries: debugEntries, clear: clearDebug, push: pushDebug } = useDebugLog()

const debugRef = ref<HTMLElement | null>(null)
const receivedRef = ref<HTMLElement | null>(null)
const arcRef = ref<HTMLElement | null>(null)
const forwardedRef = ref<HTMLElement | null>(null)

function scrollIfNearBottom(el: HTMLElement | null) {
  if (!el) return
  // Read live scroll position synchronously (pre-new-content DOM state) — matches original pattern
  if (el.scrollHeight - el.scrollTop - el.clientHeight > 30) return
  nextTick(() => { if (el) el.scrollTop = el.scrollHeight })
}

// Watch .length so the getter fires on every push() mutation
watch(() => debugEntries.value.length, () => scrollIfNearBottom(debugRef.value))
watch(() => receivedLogs.value.length, () => scrollIfNearBottom(receivedRef.value))
watch(() => arcReceivedLogs.value.length, () => scrollIfNearBottom(arcRef.value))
watch(() => forwardedLogs.value.length, () => scrollIfNearBottom(forwardedRef.value))

// Scroll all containers to bottom on mount so pre-existing content is shown from the end
onMounted(() => nextTick(() => {
  for (const r of [debugRef, receivedRef, arcRef, forwardedRef]) {
    if (r.value) r.value.scrollTop = r.value.scrollHeight
  }
}))

function formatClientTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}
function formatValue(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
function debugColor(level: string): string {
  if (level === 'error') return '#ff0000'
  if (level === 'warning' || level === 'warn') return '#ffff00'
  return '#00ff00'
}
function clearClientLogs() {
  clearDebug()
  pushDebug('info', 'Client logs cleared')
}
</script>

<template>
  <div class="page-view logs-page-view">
    <div class="header">
      <h1>Logs</h1>
      <p>View application logs and activity</p>
    </div>

    <div class="card">
      <h3>Client Logs</h3>
      <div ref="debugRef" class="log-container">
        <div v-if="debugEntries.length === 0" style="color: #00ff00">
          Welcome to ARC-OSC Client<br>
          Configure your settings and connect to get started
        </div>
        <div v-for="(entry, i) in debugEntries" :key="i" :style="{ color: debugColor(entry.level) }">
          [{{ formatClientTime(entry.timestamp) }}] {{ entry.message }}
        </div>
      </div>
      <button class="btn btn-primary" type="button" @click="clearClientLogs">Clear Client Logs</button>
    </div>

    <div class="card">
      <h3>OSC Received</h3>
      <div ref="receivedRef" class="log-container">
        <div v-if="receivedLogs.length === 0">No OSC data received yet</div>
        <div v-for="(entry, i) in receivedLogs" :key="i" style="color: #00ff00">
          [{{ formatClientTime(entry.timestamp) }}] {{ entry.address }} = {{ formatValue(entry.value) }}
        </div>
      </div>
      <button class="btn btn-primary" type="button" @click="clearReceived">Clear OSC Received</button>
    </div>

    <div class="card">
      <h3>OSC Received (from ARC Server)</h3>
      <div ref="arcRef" class="log-container">
        <div v-if="arcReceivedLogs.length === 0">No OSC data received from ARC Server yet</div>
        <div v-for="(entry, i) in arcReceivedLogs" :key="i" style="color: #ff8c00">
          [{{ formatClientTime(entry.timestamp) }}] {{ entry.address }} = {{ formatValue(entry.value) }}
        </div>
      </div>
      <button class="btn btn-primary" type="button" @click="clearArcReceived">Clear OSC from ARC</button>
    </div>

    <div class="card">
      <h3>OSC Forwarded (to ARC Server)</h3>
      <div ref="forwardedRef" class="log-container">
        <div v-if="forwardedLogs.length === 0">No OSC data forwarded yet</div>
        <div v-for="(entry, i) in forwardedLogs" :key="i" style="color: #00aaff">
          [{{ formatClientTime(entry.timestamp) }}] {{ entry.address }} = {{ formatValue(entry.value) }}
        </div>
      </div>
      <button class="btn btn-primary" type="button" @click="clearForwarded">Clear OSC Forwarded</button>
    </div>
  </div>
</template>
