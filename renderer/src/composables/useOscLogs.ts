import { ref, onMounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export interface LogEntry {
  timestamp: number
  address: string
  value: any
  connectionId?: string | null
}

const BUFFER_SIZE = 100
const FLUSH_INTERVAL = 1000
const MAX_ENTRIES = 2000
const FLOAT_THROTTLE_INTERVAL = 750

// Module-level state — persists across navigation, never torn down
const receivedLogs = ref<LogEntry[]>([])
const forwardedLogs = ref<LogEntry[]>([])
const arcReceivedLogs = ref<LogEntry[]>([])
const isVisible = ref(false)
let buffer: { type: string; address: string; value: any; connectionId?: string | null; timestamp: number }[] = []
let lastFlush = 0
let flushTimer: ReturnType<typeof setInterval> | null = null
const lastFloatLogTimes = new Map<string, number>()
const lastFloatValues = new Map<string, any>()
const pendingFloatTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
let oscLogsInitialized = false
let oscLogsInitPromise: Promise<void> | null = null

export function useOscLogs() {
  const api = useElectronAPI()

  function isFloat(value: any): boolean {
    if (typeof value === 'number') return !Number.isInteger(value)
    if (typeof value === 'string') {
      const n = parseFloat(value)
      return !isNaN(n) && value.includes('.') && !Number.isInteger(n)
    }
    return false
  }
  function appendLog(list: LogEntry[], entry: LogEntry) {
    if (list.length >= MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES + 1)
    list.push(entry)
  }
  function handleFloatLog(type: string, address: string, value: any, connectionId?: string | null) {
    const key = `${type}-${address}`
    const now = Date.now()
    const lastTime = lastFloatLogTimes.get(key) ?? 0
    lastFloatValues.set(key, { type, address, value, connectionId, timestamp: now })
    const existing = pendingFloatTimeouts.get(key)
    if (existing) clearTimeout(existing)
    if (now - lastTime >= FLOAT_THROTTLE_INTERVAL) {
      logFloatImmediate(type, address, value, connectionId)
      lastFloatLogTimes.set(key, now)
      return
    }
    const tid = setTimeout(() => {
      const final = lastFloatValues.get(key)
      if (final) {
        logFloatImmediate(final.type, final.address, final.value, final.connectionId)
        lastFloatLogTimes.set(key, Date.now())
      }
      pendingFloatTimeouts.delete(key)
    }, FLOAT_THROTTLE_INTERVAL)
    pendingFloatTimeouts.set(key, tid)
  }
  function logFloatImmediate(type: string, address: string, value: any, connectionId?: string | null) {
    const entry: LogEntry = { timestamp: Date.now(), address, value, connectionId }
    if (type === 'received') appendLog(receivedLogs.value, entry)
    else if (type === 'forwarded') appendLog(forwardedLogs.value, entry)
    else if (type === 'arc-received') appendLog(arcReceivedLogs.value, entry)
  }
  function handleOscReceived(data: any) {
    if (isFloat(data.value)) {
      handleFloatLog('received', data.address, data.value, data.connectionId)
      return
    }
    buffer.push({ type: 'received', address: data.address, value: data.value, connectionId: data.connectionId, timestamp: Date.now() })
    if (buffer.length >= BUFFER_SIZE || Date.now() - lastFlush >= FLUSH_INTERVAL) flushBuffer()
  }
  function handleOscForwarded(data: any) {
    if (isFloat(data.value)) {
      handleFloatLog('forwarded', data.address, data.value, data.connectionId)
      return
    }
    buffer.push({ type: 'forwarded', address: data.address, value: data.value, connectionId: data.connectionId, timestamp: Date.now() })
    if (buffer.length >= BUFFER_SIZE || Date.now() - lastFlush >= FLUSH_INTERVAL) flushBuffer()
  }
  function handleArcReceived(data: any) {
    if (isFloat(data.value)) {
      handleFloatLog('arc-received', data.address, data.value, null)
      return
    }
    appendLog(arcReceivedLogs.value, { timestamp: Date.now(), address: data.address, value: data.value })
  }
  function flushBuffer() {
    if (buffer.length === 0) return
    const received = buffer.filter(m => m.type === 'received')
    const forwarded = buffer.filter(m => m.type === 'forwarded')
    for (const m of received) appendLog(receivedLogs.value, { timestamp: m.timestamp, address: m.address, value: m.value, connectionId: m.connectionId })
    for (const m of forwarded) appendLog(forwardedLogs.value, { timestamp: m.timestamp, address: m.address, value: m.value, connectionId: m.connectionId })
    buffer = []
    lastFlush = Date.now()
  }
  function clearReceived() { receivedLogs.value = [] }
  function clearForwarded() { forwardedLogs.value = [] }
  function clearArcReceived() { arcReceivedLogs.value = [] }
  function clearAll() { clearReceived(); clearForwarded(); clearArcReceived() }

  async function initialize() {
    if (oscLogsInitialized) return
    if (oscLogsInitPromise) return oscLogsInitPromise
    oscLogsInitPromise = Promise.resolve().then(() => {
      api.onOscReceived(handleOscReceived)
      api.onOscForwarded(handleOscForwarded)
      api.onOscReceivedBatch((batch: any[]) => { for (const d of batch) handleOscReceived(d) })
      api.onOscForwardedBatch((batch: any[]) => { for (const d of batch) handleOscForwarded(d) })
      api.onWebSocketOscData(handleArcReceived)
      flushTimer = setInterval(() => { if (buffer.length > 0) flushBuffer() }, FLUSH_INTERVAL)
      oscLogsInitialized = true
    })
    return oscLogsInitPromise
  }

  onMounted(() => { void initialize() })

  return {
    receivedLogs,
    forwardedLogs,
    arcReceivedLogs,
    isVisible,
    clearReceived,
    clearForwarded,
    clearArcReceived,
    clearAll
  }
}
