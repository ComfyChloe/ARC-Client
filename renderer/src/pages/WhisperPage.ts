// ====
// WhisperPage state factory — sibling script module for WhisperPage.vue.
// Owns all page-local reactive state, computed labels, and handlers so the
// .vue file stays a thin template. Shared cross-page state lives in
// composables/useWhisper.ts; this file only orchestrates it for the page.
// Call createWhisperPageState() once from <script setup>.
// ====
import { computed, onMounted, ref, watch } from 'vue'
import { useWhisper, type WhisperCommand, type WhisperCommandParam, type WhisperPreflightResult } from '../composables/useWhisper'
import { useElectronAPI } from '../composables/useElectronAPI'

export function createWhisperPageState() {
  const api = useElectronAPI()
  const {
    status,
    commands,
    autostart,
    transcript,
    inputLevel,
    gateOpen,
    downloadProgress,
    devices,
    lastFired,
    collapsedIds,
    lastSavedAt,
    refresh,
    refreshStatus,
    preflight,
    toggle,
    setAutostart,
    downloadModel,
    setInputDevice,
    updateSettings,
    saveCommands,
    saveCommand,
    fireInput,
    saveAllDirty,
    discardAllDirty,
    toggleCollapse,
    isDirty,
    isSaving,
    clearTranscript
  } = useWhisper()
  const busy = ref(false)
  const preflightResult = ref<WhisperPreflightResult | null>(null)
  const showDiscardConfirm = ref(false)
  const minLevelDraft = ref(0)
  const gainDraft = ref(100)
  const minUtteranceDraft = ref(350)
  const modelDirDraft = ref('')
  const modelDirError = ref('')
  const modelPathDraft = ref('')
  watch(status, (s) => {
    minLevelDraft.value = s.minInputLevel
    gainDraft.value = Math.round(s.inputGain * 100)
    minUtteranceDraft.value = s.minUtteranceMs
  }, { immediate: true })
  const anyDirty = computed(() => commands.value.some(c => isDirty(c.id)))
  const dirtyCount = computed(() => commands.value.filter(c => isDirty(c.id)).length)
  const statusClass = computed(() => {
    const s = status.value
    if (s.engineState === 'error') return 'status-error'
    if (s.engineState === 'running') return 'status-connected'
    // preparing / loading-model / starting all show the "busy" indicator
    if (s.engineState === 'preparing' || s.engineState === 'loading-model' || s.engineState === 'starting') {
      return 'status-connecting'
    }
    return 'status-disconnected'
  })
  const isStartingOrPreparing = computed(() => {
    const e = status.value.engineState
    return e === 'preparing' || e === 'loading-model' || e === 'starting'
  })
  const statusText = computed(() => {
    const s = status.value
    if (s.engineState === 'error') return `Error: ${s.lastError || 'Unknown error'}`
    if (s.engineState === 'preparing') return 'Preparing engine...'
    if (s.engineState === 'loading-model') return 'Loading model...'
    if (s.engineState === 'starting') return 'Starting worker...'
    if (s.engineState === 'stopping') return 'Stopping...'
    if (s.engineState === 'running') return `Listening${s.sampleRate ? ` (${s.sampleRate} Hz)` : ''}`
    return 'Stopped'
  })
  const toggleButtonLabel = computed(() => {
    const e = status.value.engineState
    if (e === 'preparing' || e === 'loading-model' || e === 'starting') return 'Starting...'
    if (e === 'stopping') return 'Stopping...'
    return status.value.enabled ? 'Stop Whisper' : 'Start Whisper'
  })
  const modelStateText = computed(() => {
    switch (status.value.modelState) {
      case 'ready': return 'Model ready'
      case 'missing': return 'No model installed'
      case 'invalid': return 'Model file invalid (missing ggml magic or below 50 MB)'
      case 'downloading': return 'Downloading model...'
      case 'extracting': return 'Extracting model...'
      default: return status.value.modelState
    }
  })
  const downloading = computed(() =>
    downloadProgress.value?.state === 'downloading' || downloadProgress.value?.state === 'extracting'
  )
  const downloadLabel = computed(() => {
    const progress = downloadProgress.value
    if (!progress) return ''
    if (progress.state === 'extracting') return 'Extracting...'
    if (progress.state === 'downloading') {
      const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
      return progress.totalBytes > 0
        ? `Downloading ${mb(progress.downloadedBytes)} / ${mb(progress.totalBytes)} MB`
        : 'Downloading...'
    }
    if (progress.state === 'error') return `Download failed: ${progress.error || 'unknown error'}`
    return ''
  })
  const hasCommands = computed(() => commands.value.length > 0)
  function isCollapsed(commandId: string): boolean {
    return collapsedIds.value.has(commandId)
  }
  function firedRecently(command: WhisperCommand): 'forward' | 'reverse' | null {
    const fired = lastFired.value
    if (!fired) return null
    // Prefer ID match — duplicate command names must not cross-flash.
    // Fall back to name for payloads that lack an ID.
    if (fired.id) {
      if (fired.id !== command.id) return null
    } else if (fired.name !== command.name) {
      return null
    }
    if (Date.now() - fired.at > 5000) return null
    return fired.direction
  }
  function timeLabel(at: number): string {
    return new Date(at).toLocaleTimeString()
  }
  function newParam(): WhisperCommandParam {
    return { address: '/avatar/parameters/', type: 'f', value: '1', reverseValue: null }
  }
  function newCommand(): WhisperCommand {
    return {
      id: crypto.randomUUID(),
      name: `Command ${commands.value.length + 1}`,
      phrase: '',
      reversePhrase: '',
      matchType: 'contains',
      enabled: true,
      parameters: [newParam()]
    }
  }
  async function addCommand() {
    try {
      await saveCommands([...commands.value, newCommand()])
    } catch (err) {
      console.error('Failed to add command', err)
    }
  }
  async function removeCommand(command: WhisperCommand) {
    try {
      await saveCommands(commands.value.filter(c => c.id !== command.id))
    } catch (err) {
      console.error('Failed to remove command', err)
    }
  }
  async function addParam(command: WhisperCommand) {
    command.parameters.push(newParam())
    try {
      await saveCommand(command.id)
    } catch (err) {
      console.error('Failed to add parameter', err)
    }
  }
  function setReverseBool(commandId: string, paramIndex: number, raw: string) {
    const command = commands.value.find(c => c.id === commandId)
    if (!command) return
    const param = command.parameters[paramIndex]
    if (!param) return
    if (raw === '') param.reverseValue = null
    else if (raw === 'true') param.reverseValue = true
    else if (raw === 'false') param.reverseValue = false
    else param.reverseValue = undefined
    fireInput(commandId)
  }
  function onBoolValueChange(commandId: string, paramIndex: number, value: boolean) {
    const command = commands.value.find(c => c.id === commandId)
    if (!command) return
    const param = command.parameters[paramIndex]
    if (!param) return
    param.value = value
    fireInput(commandId)
  }
  function onParamTypeChange(commandId: string, paramIndex: number, newType: WhisperCommandParam['type']) {
    const command = commands.value.find(c => c.id === commandId)
    if (!command) return
    const param = command.parameters[paramIndex]
    if (!param) return
    param.type = newType
    if (newType === 'bool') {
      if (typeof param.value !== 'boolean') param.value = false
      if (param.reverseValue !== null && param.reverseValue !== undefined && typeof param.reverseValue !== 'boolean') {
        param.reverseValue = null
      }
    } else if (typeof param.value === 'boolean') {
      param.value = newType === 's' ? '' : 0
    }
    fireInput(commandId)
  }
  function reverseBoolDisplay(param: WhisperCommandParam): string {
    if (param.type !== 'bool') return ''
    if (param.reverseValue === undefined || param.reverseValue === null) return ''
    return param.reverseValue ? 'true' : 'false'
  }
  async function discardDirty() {
    showDiscardConfirm.value = false
    await discardAllDirty()
  }
  async function saveBlock(commandId: string) {
    await saveCommand(commandId)
  }
  async function saveAllDirtyBlocks() {
    await saveAllDirty()
  }
  async function handleToggle() {
    if (busy.value) return
    busy.value = true
    try {
      await toggle()
    } finally {
      busy.value = false
    }
  }
  async function handleToggleAutostart() {
    await setAutostart(!autostart.value)
  }
  async function handleDeviceChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value
    await setInputDevice(value || null)
  }
  async function commitAudioSettings() {
    await updateSettings({
      minInputLevel: minLevelDraft.value,
      inputGain: gainDraft.value / 100,
      minUtteranceMs: minUtteranceDraft.value
    })
  }
  async function applyModelDir() {
    modelDirError.value = ''
    const file = modelPathDraft.value.trim()
    if (!file) {
      modelDirError.value = 'Enter a path to a .bin model file.'
      return
    }
    const result = await updateSettings({ modelPath: file })
    if (!result?.success) {
      modelDirError.value = result?.error || 'File is not a valid Whisper ggml model'
    } else {
      modelPathDraft.value = ''
    }
  }
  async function clearModelPath() {
    modelDirError.value = ''
    modelPathDraft.value = ''
    await updateSettings({ modelPath: null })
  }
  function openModelList() {
    void api.openExternal(status.value.modelListUrl)
  }
  onMounted(async () => {
    try {
      preflightResult.value = await preflight()
    } catch {
      preflightResult.value = { ok: false, bundledLibsOk: false, dllPath: null, lastError: 'Preflight IPC failed' }
    }
    await refresh()
    void refreshStatus()
  })
  return {
    // composable state
    status,
    commands,
    autostart,
    transcript,
    inputLevel,
    gateOpen,
    downloadProgress,
    devices,
    lastSavedAt,
    refresh,
    refreshStatus,
    downloadModel,
    saveAllDirty,
    saveBlock,
    toggleCollapse,
    isDirty,
    isSaving,
    clearTranscript,
    // page-local state
    busy,
    preflightResult,
    showDiscardConfirm,
    minLevelDraft,
    gainDraft,
    minUtteranceDraft,
    modelDirDraft,
    modelDirError,
    modelPathDraft,
    // computed
    anyDirty,
    dirtyCount,
    statusClass,
    isStartingOrPreparing,
    statusText,
    toggleButtonLabel,
    modelStateText,
    downloading,
    downloadLabel,
    hasCommands,
    // helpers
    isCollapsed,
    firedRecently,
    timeLabel,
    reverseBoolDisplay,
    fireInput,
    // handlers
    addCommand,
    removeCommand,
    addParam,
    setReverseBool,
    onBoolValueChange,
    onParamTypeChange,
    discardDirty,
    saveAllDirtyBlocks,
    handleToggle,
    handleToggleAutostart,
    handleDeviceChange,
    commitAudioSettings,
    applyModelDir,
    clearModelPath,
    openModelList
  }
}
