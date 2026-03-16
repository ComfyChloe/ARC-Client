<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useOscLogs } from '../composables/useOscLogs'
import { useDebugLog } from '../composables/useDebugLog'

const { receivedLogs, forwardedLogs, arcReceivedLogs, clearReceived, clearForwarded, clearArcReceived, clearAll } = useOscLogs()
const { entries: debugEntries, clear: clearDebug } = useDebugLog()

type LogTab = 'received' | 'forwarded' | 'arc' | 'debug'
const activeTab = ref<LogTab>('received')
const autoScroll = ref(true)

const receivedRef = ref<HTMLElement | null>(null)
const forwardedRef = ref<HTMLElement | null>(null)
const arcRef = ref<HTMLElement | null>(null)
const debugRef = ref<HTMLElement | null>(null)

function getActiveContainer() {
  switch (activeTab.value) {
    case 'received': return receivedRef.value
    case 'forwarded': return forwardedRef.value
    case 'arc': return arcRef.value
    case 'debug': return debugRef.value
  }
}
function scrollToBottom() {
  if (!autoScroll.value) return
  nextTick(() => {
    const el = getActiveContainer()
    if (el) el.scrollTop = el.scrollHeight
  })
}
function handleScroll(e: Event) {
  const el = e.target as HTMLElement
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
  autoScroll.value = atBottom
}

watch([receivedLogs, forwardedLogs, arcReceivedLogs, debugEntries], scrollToBottom, { deep: false })

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
function formatValue(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
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
      <div ref="debugRef" class="log-container" @scroll="handleScroll">
        <div v-for="(entry, i) in debugEntries" :key="i" class="log-line" :class="'level-' + entry.level">
          <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
          <span class="log-level">[{{ entry.level }}]</span>
          <span class="log-msg">{{ entry.message }}</span>
        </div>
        <div v-if="debugEntries.length === 0" class="log-empty">Welcome to ARC-OSC Client</div>
      </div>
      <button class="btn btn-primary" type="button" @click="clearDebug">Clear Client Logs</button>
    </div>

    <div class="card">
      <h3>OSC Received</h3>
      <div ref="receivedRef" class="log-container" @scroll="handleScroll">
        <div v-for="(entry, i) in receivedLogs" :key="i" class="log-line">
          <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
          <span class="log-addr">{{ entry.address }}</span>
          <span class="log-val">{{ formatValue(entry.value) }}</span>
          <span v-if="entry.connectionId" class="log-conn">{{ entry.connectionId }}</span>
        </div>
        <div v-if="receivedLogs.length === 0" class="log-empty">No OSC data received yet</div>
      </div>
      <button class="btn btn-primary" type="button" @click="clearReceived">Clear OSC Received</button>
    </div>

    <div class="card">
      <h3>OSC Received (from ARC Server)</h3>
      <div ref="arcRef" class="log-container" @scroll="handleScroll">
        <div v-for="(entry, i) in arcReceivedLogs" :key="i" class="log-line">
          <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
          <span class="log-addr">{{ entry.address }}</span>
          <span class="log-val">{{ formatValue(entry.value) }}</span>
        </div>
        <div v-if="arcReceivedLogs.length === 0" class="log-empty">No OSC data received from ARC Server yet</div>
      </div>
      <button class="btn btn-primary" type="button" @click="clearArcReceived">Clear OSC from ARC</button>
    </div>

    <div class="card">
      <h3>OSC Forwarded (to ARC Server)</h3>
      <div ref="forwardedRef" class="log-container" @scroll="handleScroll">
      <div v-for="(entry, i) in forwardedLogs" :key="i" class="log-line">
        <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="log-addr">{{ entry.address }}</span>
        <span class="log-val">{{ formatValue(entry.value) }}</span>
        <span v-if="entry.connectionId" class="log-conn">{{ entry.connectionId }}</span>
      </div>
        <div v-if="forwardedLogs.length === 0" class="log-empty">No OSC data forwarded yet</div>
      </div>
      <button class="btn btn-primary" type="button" @click="clearForwarded">Clear OSC Forwarded</button>
    </div>
  </div>
</template>
