import { ref, computed } from 'vue'
import { useElectronAPI } from './useElectronAPI'
import { onWhisperLevel, listInputDevices } from '../services/whisperCapture'

export interface WhisperCommandParam {
  address: string
  type: 'f' | 'i' | 'bool' | 's'
  value: string | number | boolean
  reverseValue?: string | number | boolean | null
}

export interface WhisperCommand {
  id: string
  name: string
  phrase: string
  reversePhrase?: string
  matchType: 'exact' | 'contains'
  enabled: boolean
  category?: string
  parameters: WhisperCommandParam[]
}

export interface WhisperPreflightResult {
  ok: boolean
  bundledLibsOk: boolean
  dllPath: string | null
  lastError: string | null
}

export interface WhisperStatus {
  enabled: boolean
  engineState: 'stopped' | 'loading-model' | 'running' | 'error'
  modelState: 'missing' | 'invalid' | 'downloading' | 'extracting' | 'ready'
  modelDir: string | null
  usingDefaultModel: boolean
  modelListUrl: string
  sampleRate: number | null
  inputDeviceId: string | null
  minInputLevel: number
  inputGain: number
  minUtteranceMs: number
  bundledLibsOk?: boolean
  nativeLibraryLoaded?: boolean
  lastError: string | null
}

export interface WhisperTranscriptEntry {
  text: string
  confidence: number
  at: number
  matchedCommandName?: string
  matchedDirection?: 'forward' | 'reverse'
  droppedByConfidence?: boolean
}

export interface WhisperDownloadProgress {
  state: 'downloading' | 'extracting' | 'done' | 'error'
  percent: number
  downloadedBytes: number
  totalBytes: number
  error?: string
}

export interface WhisperInputDevice {
  deviceId: string
  label: string
}

const MAX_TRANSCRIPT_ENTRIES = 50
const COLLAPSE_STORAGE_KEY = 'whisper.collapsedIds'
const COLLAPSE_INITIALIZED_KEY = 'whisper.collapseInitialized'

const defaultStatus: WhisperStatus = {
  enabled: false,
  engineState: 'stopped',
  modelState: 'missing',
  modelDir: null,
  usingDefaultModel: true,
  modelListUrl: 'https://github.com/ggerganov/whisper.cpp/tree/main/models',
  sampleRate: null,
  inputDeviceId: null,
  minInputLevel: 0,
  inputGain: 1,
  minUtteranceMs: 350,
  bundledLibsOk: true,
  nativeLibraryLoaded: true,
  lastError: null
}

// Module-level singleton state so IPC listeners register exactly once and
// transcript/status survive page navigation
const status = ref<WhisperStatus>({ ...defaultStatus })
const commands = ref<WhisperCommand[]>([])
const categories = ref<string[]>([])
const autostart = ref(false)
// Whisper has no per-chunk partial results — emit a single placeholder string
// the UI can show while the engine is "listening for an utterance"
const utteranceHint = ref('')
const transcript = ref<WhisperTranscriptEntry[]>([])
const inputLevel = ref(0)
const downloadProgress = ref<WhisperDownloadProgress | null>(null)
const devices = ref<WhisperInputDevice[]>([])
const lastFired = ref<{ name: string; direction: 'forward' | 'reverse'; at: number } | null>(null)
const collapsedIds = ref<Set<string>>(new Set())
const lastSavedAt = ref<number>(0)
const dirtyCommandIds = ref<Set<string>>(new Set())
const savingCommandIds = ref<Set<string>>(new Set())
let listenersRegistered = false

function safeReadStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeWriteStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}
function loadCollapsedIds(): Set<string> {
  const raw = safeReadStorage(COLLAPSE_STORAGE_KEY)
  if (!raw) return new Set()
  try {
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr)) return new Set(arr.filter((v): v is string => typeof v === 'string'))
  } catch { /* ignore */ }
  return new Set()
}
function saveCollapsedIds(): void {
  safeWriteStorage(COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(collapsedIds.value)))
}
function ensureCollapsedOnFirstLoad(list: WhisperCommand[]): void {
  if (safeReadStorage(COLLAPSE_INITIALIZED_KEY)) return
  collapsedIds.value = new Set(list.map(c => c.id))
  saveCollapsedIds()
  safeWriteStorage(COLLAPSE_INITIALIZED_KEY, '1')
}

function registerListeners() {
  if (listenersRegistered) return
  listenersRegistered = true
  const api = useElectronAPI()
  api.onWhisperUpdate((data: any) => {
    if (data.type === 'status') {
      const { type: _type, ...rest } = data
      status.value = { ...defaultStatus, ...rest }
    } else if (data.type === 'result') {
      if (data.isFinal) {
        transcript.value = [
          {
            text: data.text,
            confidence: data.confidence ?? 0,
            at: Date.now(),
            matchedCommandName: data.matchedCommandName,
            matchedDirection: data.matchedDirection,
            droppedByConfidence: data.droppedByConfidence
          },
          ...transcript.value
        ].slice(0, MAX_TRANSCRIPT_ENTRIES)
        if (data.matchedCommandName) {
          lastFired.value = { name: data.matchedCommandName, direction: data.matchedDirection, at: Date.now() }
        }
      }
    } else if (data.type === 'download-progress') {
      downloadProgress.value = {
        state: data.state,
        percent: data.percent ?? 0,
        downloadedBytes: data.downloadedBytes ?? 0,
        totalBytes: data.totalBytes ?? 0,
        error: data.error
      }
      if (data.state === 'done') {
        void refreshStatus()
        setTimeout(() => {
          if (downloadProgress.value?.state === 'done') downloadProgress.value = null
        }, 1500)
      }
    }
  })
  onWhisperLevel((level: number) => {
    inputLevel.value = level
  })
}

async function refreshStatus() {
  const api = useElectronAPI()
  const s = await api.whisperGetStatus()
  if (s) {
    status.value = { ...defaultStatus, ...s }
  }
}

async function refreshConfig() {
  const api = useElectronAPI()
  const config = await api.whisperGetConfig()
  if (config) {
    commands.value = config.commands || []
    categories.value = config.categories || []
    dirtyCommandIds.value = new Set()
    ensureCollapsedOnFirstLoad(commands.value)
  }
}

async function refreshAutostart() {
  const api = useElectronAPI()
  const result = await api.whisperGetAutostart()
  autostart.value = !!(result && result.enabled)
}

async function refreshDevices() {
  try {
    devices.value = await listInputDevices()
  } catch {
    devices.value = []
  }
}

function coerceValue(raw: string | number | boolean | null | undefined, type: WhisperCommandParam['type']): string | number | boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (type === 'f') {
    const parsed = parseFloat(String(raw))
    return Number.isNaN(parsed) ? undefined : parsed
  }
  if (type === 'i') {
    const parsed = parseInt(String(raw), 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  if (type === 'bool') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    return undefined
  }
  return String(raw)
}

function buildPayload() {
  return {
    commands: JSON.parse(JSON.stringify(commands.value.map(normalizeCommand))),
    categories: [...categories.value]
  }
}

async function persistAll(): Promise<void> {
  const api = useElectronAPI()
  const payload = buildPayload()
  await api.whisperUpdateConfig(payload)
  lastSavedAt.value = Date.now()
}

export function normalizeCommand(command: WhisperCommand): WhisperCommand {
  return {
    id: command.id,
    name: command.name.trim(),
    phrase: command.phrase.trim(),
    reversePhrase: command.reversePhrase?.trim() || undefined,
    matchType: command.matchType,
    enabled: !!command.enabled,
    category: command.category?.trim() || undefined,
    parameters: command.parameters
      .filter(param => param.address.trim())
      .map(param => ({
        address: param.address.trim(),
        type: param.type,
        value: coerceValue(param.value, param.type) ?? (param.type === 'bool' ? false : param.type === 's' ? '' : 0),
        reverseValue: param.type === 'bool'
          ? (param.reverseValue === undefined || param.reverseValue === null || param.reverseValue === '' ? null : coerceValue(param.reverseValue, param.type))
          : coerceValue(param.reverseValue, param.type)
      }))
  }
}

export function useWhisper() {
  const api = useElectronAPI()
  registerListeners()
  collapsedIds.value = loadCollapsedIds()

  const gateOpen = computed(() =>
    status.value.minInputLevel <= 0 || inputLevel.value >= status.value.minInputLevel
  )
  // Hint text the page shows in place of Vosk's live partial. Whisper doesn't
  // emit partials; the UI gets "Listening — utterance will appear when you stop speaking".
  const partial = computed({
    get: () => utteranceHint.value,
    set: (v: string) => { utteranceHint.value = v }
  })

  async function refresh() {
    downloadProgress.value = null
    lastFired.value = null
    await Promise.all([refreshStatus(), refreshConfig(), refreshAutostart(), refreshDevices()])
  }

  async function preflight(): Promise<WhisperPreflightResult> {
    const api = useElectronAPI()
    try {
      const result = await api.whisperPreflight()
      if (!result) {
        return { ok: false, bundledLibsOk: false, dllPath: null, lastError: 'Preflight IPC returned no result' }
      }
      return result as WhisperPreflightResult
    } catch (err) {
      return { ok: false, bundledLibsOk: false, dllPath: null, lastError: (err as Error).message }
    }
  }

  async function toggle(): Promise<{ success: boolean; error?: string }> {
    if (status.value.enabled) {
      const result = await api.whisperStop()
      await refreshStatus()
      return result ?? { success: false }
    }
    const result = await api.whisperStart()
    if (!result?.success) {
      await refreshStatus()
    }
    return result ?? { success: false }
  }

  async function setAutostart(enabled: boolean) {
    const result = await api.whisperSetAutostart(enabled)
    if (result?.success) {
      autostart.value = enabled
    }
    return result
  }

  async function downloadModel() {
    downloadProgress.value = { state: 'downloading', percent: 0, downloadedBytes: 0, totalBytes: 0 }
    const result = await api.whisperDownloadModel()
    if (!result?.success) {
      downloadProgress.value = { state: 'error', percent: 0, downloadedBytes: 0, totalBytes: 0, error: result?.error }
    }
    await refreshStatus()
    return result
  }

  async function setInputDevice(deviceId: string | null) {
    const result = await api.whisperSetInputDevice(deviceId)
    await refreshStatus()
    return result
  }

  async function updateSettings(partialConfig: { minInputLevel?: number; inputGain?: number; modelDir?: string | null; minUtteranceMs?: number }) {
    const result = await api.whisperUpdateConfig(partialConfig)
    await refreshStatus()
    return result
  }

  function toggleCollapse(commandId: string) {
    const next = new Set(collapsedIds.value)
    if (next.has(commandId)) next.delete(commandId)
    else next.add(commandId)
    collapsedIds.value = next
    saveCollapsedIds()
  }

  function markDirty(commandId: string): void {
    if (!dirtyCommandIds.value.has(commandId)) {
      dirtyCommandIds.value = new Set([...dirtyCommandIds.value, commandId])
    }
  }

  function markClean(commandId: string): void {
    if (dirtyCommandIds.value.has(commandId)) {
      const next = new Set(dirtyCommandIds.value)
      next.delete(commandId)
      dirtyCommandIds.value = next
    }
  }

  function isDirty(commandId: string): boolean {
    return dirtyCommandIds.value.has(commandId)
  }

  function isSaving(commandId: string): boolean {
    return savingCommandIds.value.has(commandId)
  }

  async function saveCommand(commandId: string): Promise<{ success: boolean; error?: string }> {
    const api = useElectronAPI()
    const target = commands.value.find(c => c.id === commandId)
    if (!target) return { success: false, error: 'Command not found' }
    savingCommandIds.value = new Set([...savingCommandIds.value, commandId])
    try {
      await persistAll()
      markClean(commandId)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    } finally {
      const next = new Set(savingCommandIds.value)
      next.delete(commandId)
      savingCommandIds.value = next
    }
  }

  async function saveAllDirty(): Promise<void> {
    const ids = Array.from(dirtyCommandIds.value)
    for (const id of ids) {
      await saveCommand(id)
    }
  }

  async function discardAllDirty(): Promise<void> {
    await refreshConfig()
  }

  async function addCategory(name: string): Promise<boolean> {
    const trimmed = name.trim()
    if (!trimmed) return false
    if (categories.value.includes(trimmed)) return false
    categories.value = [...categories.value, trimmed]
    try {
      await persistAll()
      return true
    } catch {
      categories.value = categories.value.filter(c => c !== trimmed)
      return false
    }
  }

  async function removeCategory(name: string): Promise<void> {
    const prevCategories = [...categories.value]
    const prevCommands = commands.value.map(c => ({ ...c }))
    categories.value = categories.value.filter(c => c !== name)
    commands.value = commands.value.map(c => c.category === name ? { ...c, category: undefined } : c)
    for (const c of commands.value) {
      if (c.category === undefined && prevCommands.find(p => p.id === c.id)?.category === name) {
        markDirty(c.id)
      }
    }
    try {
      await persistAll()
      for (const c of commands.value) markClean(c.id)
    } catch {
      categories.value = prevCategories
      commands.value = prevCommands
    }
  }

  function setCommandCategory(commandId: string, category: string | undefined): void {
    commands.value = commands.value.map(c => c.id === commandId ? { ...c, category } : c)
    markDirty(commandId)
  }

  function fireInput(commandId: string): void { markDirty(commandId) }

  async function commitCommands(next: WhisperCommand[]) {
    commands.value = next
    try {
      await persistAll()
      dirtyCommandIds.value = new Set()
    } catch (err) {
      await refreshConfig()
      throw err
    }
  }

  function clearTranscript() {
    transcript.value = []
  }

  return {
    status,
    commands,
    categories,
    autostart,
    partial,
    transcript,
    inputLevel,
    gateOpen,
    downloadProgress,
    devices,
    lastFired,
    collapsedIds,
    dirtyCommandIds,
    savingCommandIds,
    lastSavedAt,
    refresh,
    refreshStatus,
    refreshConfig,
    refreshDevices,
    preflight,
    toggle,
    setAutostart,
    downloadModel,
    setInputDevice,
    updateSettings,
    saveCommands: commitCommands,
    saveCommand,
    saveAllDirty,
    discardAllDirty,
    toggleCollapse,
    addCategory,
    removeCategory,
    setCommandCategory,
    fireInput,
    isDirty,
    isSaving,
    normalizeCommand,
    clearTranscript
  }
}