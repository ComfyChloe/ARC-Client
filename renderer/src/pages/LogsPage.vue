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
  <div class="page logs-page">
    <div class="logs-header">
      <h2>Logs</h2>
      <div class="tab-bar">
        <button class="tab" :class="{ active: activeTab === 'received' }" @click="activeTab = 'received'">
          Received ({{ receivedLogs.length }})
        </button>
        <button class="tab" :class="{ active: activeTab === 'forwarded' }" @click="activeTab = 'forwarded'">
          Forwarded ({{ forwardedLogs.length }})
        </button>
        <button class="tab" :class="{ active: activeTab === 'arc' }" @click="activeTab = 'arc'">
          ARC Received ({{ arcReceivedLogs.length }})
        </button>
        <button class="tab" :class="{ active: activeTab === 'debug' }" @click="activeTab = 'debug'">
          Debug ({{ debugEntries.length }})
        </button>
      </div>
      <div class="logs-actions">
        <button class="btn btn-secondary btn-sm" @click="clearAll(); clearDebug()">Clear All</button>
        <button v-if="activeTab === 'received'" class="btn btn-secondary btn-sm" @click="clearReceived">Clear</button>
        <button v-if="activeTab === 'forwarded'" class="btn btn-secondary btn-sm" @click="clearForwarded">Clear</button>
        <button v-if="activeTab === 'arc'" class="btn btn-secondary btn-sm" @click="clearArcReceived">Clear</button>
        <button v-if="activeTab === 'debug'" class="btn btn-secondary btn-sm" @click="clearDebug">Clear</button>
      </div>
    </div>

    <!-- Received -->
    <div v-show="activeTab === 'received'" ref="receivedRef" class="log-container log-received" @scroll="handleScroll">
      <div v-for="(entry, i) in receivedLogs" :key="i" class="log-line">
        <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="log-addr">{{ entry.address }}</span>
        <span class="log-val">{{ formatValue(entry.value) }}</span>
        <span v-if="entry.connectionId" class="log-conn">{{ entry.connectionId }}</span>
      </div>
      <div v-if="receivedLogs.length === 0" class="log-empty">No received logs yet</div>
    </div>

    <!-- Forwarded -->
    <div v-show="activeTab === 'forwarded'" ref="forwardedRef" class="log-container log-forwarded" @scroll="handleScroll">
      <div v-for="(entry, i) in forwardedLogs" :key="i" class="log-line">
        <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="log-addr">{{ entry.address }}</span>
        <span class="log-val">{{ formatValue(entry.value) }}</span>
        <span v-if="entry.connectionId" class="log-conn">{{ entry.connectionId }}</span>
      </div>
      <div v-if="forwardedLogs.length === 0" class="log-empty">No forwarded logs yet</div>
    </div>

    <!-- ARC Received -->
    <div v-show="activeTab === 'arc'" ref="arcRef" class="log-container log-arc" @scroll="handleScroll">
      <div v-for="(entry, i) in arcReceivedLogs" :key="i" class="log-line">
        <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="log-addr">{{ entry.address }}</span>
        <span class="log-val">{{ formatValue(entry.value) }}</span>
      </div>
      <div v-if="arcReceivedLogs.length === 0" class="log-empty">No ARC received logs yet</div>
    </div>

    <!-- Debug -->
    <div v-show="activeTab === 'debug'" ref="debugRef" class="log-container log-debug" @scroll="handleScroll">
      <div v-for="(entry, i) in debugEntries" :key="i" class="log-line" :class="'level-' + entry.level">
        <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="log-level">[{{ entry.level }}]</span>
        <span class="log-msg">{{ entry.message }}</span>
      </div>
      <div v-if="debugEntries.length === 0" class="log-empty">No debug logs yet</div>
    </div>
  </div>
</template>

<style scoped>
.logs-page { display: flex; flex-direction: column; height: calc(100vh - 48px); }
.logs-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.logs-header h2 { margin: 0; }
.tab-bar { display: flex; gap: 2px; }
.tab {
  padding: 6px 14px; border: none; cursor: pointer; border-radius: 4px 4px 0 0;
  background: #2a2a3e; color: #a0a0b8; font-size: 0.85rem;
}
.tab.active { background: #0f3460; color: #e94560; }
.logs-actions { display: flex; gap: 4px; margin-left: auto; }
.btn-sm { padding: 4px 10px; font-size: 0.8rem; }
.log-container {
  flex: 1; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 12px;
  padding: 12px; border-radius: 6px; background: #1a1a2e; min-height: 0;
}
.log-received { color: #2ecc71; }
.log-forwarded { color: #3498db; }
.log-arc { color: #e67e22; }
.log-debug { color: #bdc3c7; }
.log-line { display: flex; gap: 8px; padding: 1px 0; white-space: nowrap; }
.log-time { color: #777; min-width: 90px; }
.log-addr { color: inherit; min-width: 200px; }
.log-val { color: #aaa; }
.log-conn { color: #666; font-size: 11px; }
.log-level { min-width: 50px; }
.log-msg { color: #ddd; white-space: pre-wrap; }
.level-error { color: #e74c3c; }
.level-warn { color: #f39c12; }
.level-success { color: #2ecc71; }
.log-empty { color: #555; font-style: italic; padding: 20px 0; text-align: center; }
</style>
