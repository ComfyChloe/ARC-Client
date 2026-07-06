import { ref, computed } from 'vue'
import { useElectronAPI } from './useElectronAPI'
import { onVoskLevel, listInputDevices } from '../services/voskCapture'

export interface VoskCommandParam {
  address: string
  type: 'f' | 'i' | 'bool' | 's'
  value: string | number | boolean
  // null = "Auto" (matcher applies sensible default per type, e.g. bool → invert)
  reverseValue?: string | number | boolean | null
}

export interface VoskCommand {
  id: string
  name: string
  phrase: string
  reversePhrase?: string
  matchType: 'exact' | 'contains'
  enabled: boolean
  category?: string
  parameters: VoskCommandParam[]
}

export interface VoskStatus {
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
  minConfidence: number
  lastError: string | null
}

export interface VoskTranscriptEntry {
  text: string
  confidence: number
  at: number
  matchedCommandName?: string
  matchedDirection?: 'forward' | 'reverse'
  droppedByConfidence?: boolean
}

export interface VoskDownloadProgress {
  state: 'downloading' | 'extracting' | 'done' | 'error'
  percent: number
  downloadedBytes: number
  totalBytes: number
  error?: string
}

export interface VoskInputDevice {
  deviceId: string
  label: string
}

const MAX_TRANSCRIPT_ENTRIES = 50
const COLLAPSE_STORAGE_KEY = 'vosk.collapsedIds'
const COLLAPSE_INITIALIZED_KEY = 'vosk.collapseInitialized'

const defaultStatus: VoskStatus = {
  enabled: false,
  engineState: 'stopped',
  modelState: 'missing',
  modelDir: null,
  usingDefaultModel: true,
  modelListUrl: 'https://alphacephei.com/vosk/models',
  sampleRate: null,
  inputDeviceId: null,
  minInputLevel: 0,
  inputGain: 1,
  minConfidence: 0,
  lastError: null
}

// Module-level singleton state so IPC listeners register exactly once and
// transcript/status survive page navigation
const status = ref<VoskStatus>({ ...defaultStatus })
const commands = ref<VoskCommand[]>([])
const categories = ref<string[]>([])
const autostart = ref(false)
const partial = ref('')
const transcript = ref<VoskTranscriptEntry[]>([])
const inputLevel = ref(0)
const downloadProgress = ref<VoskDownloadProgress | null>(null)
const devices = ref<VoskInputDevice[]>([])
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
function ensureCollapsedOnFirstLoad(list: VoskCommand[]): void {
  // On a brand-new install (or first run after this feature ships), collapse every block by default.
  // After the user touches the collapse state, never override their choices.
  if (safeReadStorage(COLLAPSE_INITIALIZED_KEY)) return
  collapsedIds.value = new Set(list.map(c => c.id))
  saveCollapsedIds()
  safeWriteStorage(COLLAPSE_INITIALIZED_KEY, '1')
}

function registerListeners() {
  if (listenersRegistered) return
  listenersRegistered = true
  const api = useElectronAPI()
  api.onVoskUpdate((data: any) => {
    if (data.type === 'status') {
      const { type: _type, ...rest } = data
      status.value = { ...defaultStatus, ...rest }
    } else if (data.type === 'result') {
      if (data.isFinal) {
        partial.value = ''
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
      } else {
        partial.value = data.text
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
        // Clear transient progress UI shortly after a successful download completes
        setTimeout(() => {
          if (downloadProgress.value?.state === 'done') downloadProgress.value = null
        }, 1500)
      }
    }
  })
  onVoskLevel((level: number) => {
    inputLevel.value = level
  })
}

async function refreshStatus() {
  const api = useElectronAPI()
  const s = await api.voskGetStatus()
  if (s) {
    status.value = { ...defaultStatus, ...s }
  }
}

async function refreshConfig() {
  const api = useElectronAPI()
  const config = await api.voskGetConfig()
  if (config) {
    commands.value = config.commands || []
    categories.value = config.categories || []
    // After a refresh, the on-disk state matches the local state - nothing dirty
    dirtyCommandIds.value = new Set()
    // Always seed the collapse set on first run with whatever commands exist right now
    ensureCollapsedOnFirstLoad(commands.value)
  }
}

async function refreshAutostart() {
  const api = useElectronAPI()
  const result = await api.voskGetAutostart()
  autostart.value = !!(result && result.enabled)
}

async function refreshDevices() {
  try {
    devices.value = await listInputDevices()
  } catch {
    devices.value = []
  }
}

// Coerce raw editor values into the strongly-typed config schema.
// For reverseValue: returning undefined tells the caller "don't emit this key" (Auto / unset).
function coerceValue(raw: string | number | boolean | null | undefined, type: VoskCommandParam['type']): string | number | boolean | undefined {
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

// Build the clean payload that gets sent to the backend, dropping parameters with empty OSC addresses
function buildPayload() {
  return {
    commands: JSON.parse(JSON.stringify(commands.value.map(normalizeCommand))),
    categories: [...categories.value]
  }
}

async function persistAll(): Promise<void> {
  const api = useElectronAPI()
  const payload = buildPayload()
  await api.voskUpdateConfig(payload)
  lastSavedAt.value = Date.now()
}

// Normalise a command for persistence (strips empties, trims, coerces numeric types)
export function normalizeCommand(command: VoskCommand): VoskCommand {
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
        // Only emit reverseValue when explicitly set — null means "Auto / unset"
        reverseValue: param.type === 'bool'
          ? (param.reverseValue === undefined || param.reverseValue === null || param.reverseValue === '' ? null : coerceValue(param.reverseValue, param.type))
          : coerceValue(param.reverseValue, param.type)
      }))
  }
}

export function useVosk() {
  const api = useElectronAPI()
  registerListeners()
  collapsedIds.value = loadCollapsedIds()

  const gateOpen = computed(() =>
    status.value.minInputLevel <= 0 || inputLevel.value >= status.value.minInputLevel
  )

  async function refresh() {
    // Clear any stale UI state from a prior session so the user doesn't see a stuck "Saving…" or progress bar
    downloadProgress.value = null
    lastFired.value = null
    await Promise.all([refreshStatus(), refreshConfig(), refreshAutostart(), refreshDevices()])
  }

  async function toggle(): Promise<{ success: boolean; error?: string }> {
    if (status.value.enabled) {
      const result = await api.voskStop()
      await refreshStatus()
      return result ?? { success: false }
    }
    const result = await api.voskStart()
    if (!result?.success) {
      await refreshStatus()
    }
    return result ?? { success: false }
  }

  async function setAutostart(enabled: boolean) {
    const result = await api.voskSetAutostart(enabled)
    if (result?.success) {
      autostart.value = enabled
    }
    return result
  }

  async function downloadModel() {
    downloadProgress.value = { state: 'downloading', percent: 0, downloadedBytes: 0, totalBytes: 0 }
    const result = await api.voskDownloadModel()
    if (!result?.success) {
      downloadProgress.value = { state: 'error', percent: 0, downloadedBytes: 0, totalBytes: 0, error: result?.error }
    }
    await refreshStatus()
    return result
  }

  async function setInputDevice(deviceId: string | null) {
    const result = await api.voskSetInputDevice(deviceId)
    await refreshStatus()
    return result
  }

  async function updateSettings(partialConfig: { minInputLevel?: number; inputGain?: number; modelDir?: string | null; minConfidence?: number }) {
    const result = await api.voskUpdateConfig(partialConfig)
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

  // --- Dirty tracking ---
  // Per-block dirty state: the user has edited the block but not yet clicked Save.
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

  // --- Save ---
  // Persist a single command's edits. The whole array is always rewritten so the
  // backend stays the single source of truth for order and category references.
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

  // Persist every dirty block at once.
  async function saveAllDirty(): Promise<void> {
    const ids = Array.from(dirtyCommandIds.value)
    for (const id of ids) {
      await saveCommand(id)
    }
  }

  // Discard every pending edit, reloading from disk.
  async function discardAllDirty(): Promise<void> {
    await refreshConfig()
  }

  // --- Categories (user-typed free-form names, persisted with commands) ---
  // Adding/removing a category is a structural change so it auto-persists.
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
    // The category-removal touches every affected command's dirty state
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

  // Per-input "this block changed" marker. The user still has to click Save.
  function fireInput(commandId: string): void { markDirty(commandId) }
  function fireChange(commandId: string): void { markDirty(commandId) }

  // --- Structural mutations (Add / Duplicate / Remove / Add parameter / Remove parameter) ---
  // These always persist immediately because they change the shape of the data.
  async function commitCommands(next: VoskCommand[]) {
    commands.value = next
    try {
      await persistAll()
      // All commands that survived the mutation are now consistent with disk
      dirtyCommandIds.value = new Set()
    } catch (err) {
      // Reload from disk so the UI re-syncs with the persisted state
      await refreshConfig()
      throw err
    }
  }

  function clearTranscript() {
    transcript.value = []
    partial.value = ''
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
    fireChange,
    isDirty,
    isSaving,
    normalizeCommand,
    clearTranscript
  }
}
