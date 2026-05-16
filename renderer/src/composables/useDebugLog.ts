import { ref } from 'vue'

export interface DebugEntry {
  timestamp: number
  level: string
  message: string
}

const entries = ref<DebugEntry[]>([])
const MAX_ENTRIES = 500
let initialized = false

function ensureInitialized() {
  if (initialized) return
  initialized = true
  entries.value = [
    { timestamp: Date.now(), level: 'info', message: 'Welcome to ARC-OSC Client' },
    { timestamp: Date.now(), level: 'info', message: 'Configure your settings and connect to get started' }
  ]
}

function push(level: string, message: string) {
  ensureInitialized()
  entries.value = [...entries.value, { timestamp: Date.now(), level, message }].slice(-MAX_ENTRIES)
}

function clear() {
  entries.value = []
}

/** Standalone debug log function matching original debugLog(message, type) */
export function debugLog(message: string, type: string = 'info') {
  push(type, message)
}

export function useDebugLog() {
  ensureInitialized()
  return { entries, push, clear }
}
