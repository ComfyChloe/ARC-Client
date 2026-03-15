import { ref } from 'vue'

export interface DebugEntry {
  timestamp: number
  level: string
  message: string
}

const entries = ref<DebugEntry[]>([])
const MAX_ENTRIES = 500

export function useDebugLog() {
  function push(level: string, message: string) {
    entries.value = [...entries.value, { timestamp: Date.now(), level, message }].slice(-MAX_ENTRIES)
  }

  function clear() {
    entries.value = []
  }

  return { entries, push, clear }
}
