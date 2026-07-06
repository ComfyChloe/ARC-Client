<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useVosk, type VoskCommand, type VoskCommandParam, type VoskPreflightResult } from '../composables/useVosk'
import { useElectronAPI } from '../composables/useElectronAPI'

const api = useElectronAPI()
const {
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
  saveAllDirty,
  discardAllDirty,
  toggleCollapse,
  addCategory,
  removeCategory,
  setCommandCategory,
  fireInput,
  isDirty,
  isSaving,
  clearTranscript
} = useVosk()

const busy = ref(false)
const preflightResult = ref<VoskPreflightResult | null>(null)
const layoutEditMode = ref(true)
const showDiscardConfirm = ref(false)
const minLevelDraft = ref(0)
const gainDraft = ref(100)
const minConfidenceDraft = ref(0)
const modelDirDraft = ref('')
const modelDirError = ref('')
const newCategoryName = ref('')
const categoryFilter = ref<string>('__all__')
const draggedIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const dragOverEdge = ref<'top' | 'bottom' | null>(null)

watch(status, (s) => {
  minLevelDraft.value = s.minInputLevel
  gainDraft.value = Math.round(s.inputGain * 100)
  minConfidenceDraft.value = s.minConfidence
}, { immediate: true })

const anyDirty = computed(() => commands.value.some(c => isDirty(c.id)))
const dirtyCount = computed(() => commands.value.filter(c => isDirty(c.id)).length)

const statusClass = computed(() => {
  const s = status.value
  if (s.engineState === 'error') return 'status-error'
  if (s.engineState === 'running') return 'status-connected'
  if (s.engineState === 'loading-model') return 'status-connecting'
  return 'status-disconnected'
})

const statusText = computed(() => {
  const s = status.value
  if (s.engineState === 'error') return `Error: ${s.lastError || 'Unknown error'}`
  if (s.engineState === 'loading-model') return 'Loading model...'
  if (s.engineState === 'running') return `Listening${s.sampleRate ? ` (${s.sampleRate} Hz)` : ''}`
  return 'Stopped'
})

const toggleButtonLabel = computed(() => {
  if (status.value.engineState === 'loading-model') return 'Starting...'
  return status.value.enabled ? 'Stop VOSK' : 'Start VOSK'
})

const modelStateText = computed(() => {
  switch (status.value.modelState) {
    case 'ready': return 'Model ready'
    case 'missing': return 'No model installed'
    case 'invalid': return 'Model directory invalid (missing "am" subdirectory)'
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

const filteredCommands = computed<VoskCommand[]>(() => {
  const filter = categoryFilter.value
  if (filter === '__all__') return commands.value
  if (filter === '__uncategorized__') return commands.value.filter(c => !c.category)
  return commands.value.filter(c => c.category === filter)
})

const categoryFilterOptions = computed(() => [
  { value: '__all__', label: 'All' },
  { value: '__uncategorized__', label: 'Uncategorized' },
  ...categories.value.map(c => ({ value: c, label: c }))
])

const hasCommands = computed(() => commands.value.length > 0)
const editDisabled = computed(() => !layoutEditMode.value)

function isCollapsed(commandId: string): boolean {
  return collapsedIds.value.has(commandId)
}

function firedRecently(command: VoskCommand): 'forward' | 'reverse' | null {
  const fired = lastFired.value
  if (!fired || fired.name !== command.name) return null
  if (Date.now() - fired.at > 5000) return null
  return fired.direction
}

function confidenceLabel(confidence: number, dropped?: boolean): string {
  if (dropped) return 'below threshold'
  return confidence > 0 ? `${Math.round(confidence * 100)}%` : '-'
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString()
}

function newParam(): VoskCommandParam {
  return { address: '/avatar/parameters/', type: 'f', value: '1', reverseValue: null }
}

function newCommand(): VoskCommand {
  return {
    id: crypto.randomUUID(),
    name: `Command ${commands.value.length + 1}`,
    phrase: '',
    reversePhrase: '',
    matchType: 'contains',
    enabled: true,
    category: categoryFilter.value !== '__all__' && categoryFilter.value !== '__uncategorized__'
      ? categoryFilter.value
      : undefined,
    parameters: [newParam()]
  }
}

async function addCommand() {
  if (editDisabled.value) return
  try {
    await saveCommands([...commands.value, newCommand()])
  } catch (err) {
    console.error('Failed to add command', err)
  }
}

async function duplicateCommand(command: VoskCommand) {
  if (editDisabled.value) return
  const copy: VoskCommand = JSON.parse(JSON.stringify(command))
  copy.id = crypto.randomUUID()
  copy.name = `${command.name} (copy)`
  const index = commands.value.findIndex(c => c.id === command.id)
  const next = [...commands.value]
  next.splice(index + 1, 0, copy)
  try {
    await saveCommands(next)
  } catch (err) {
    console.error('Failed to duplicate command', err)
  }
}

async function removeCommand(command: VoskCommand) {
  if (editDisabled.value) return
  try {
    await saveCommands(commands.value.filter(c => c.id !== command.id))
  } catch (err) {
    console.error('Failed to remove command', err)
  }
}

async function addParam(command: VoskCommand) {
  if (editDisabled.value) return
  command.parameters.push(newParam())
  // Adding a parameter is structural; persist immediately
  try {
    await saveCommand(command.id)
  } catch (err) {
    console.error('Failed to add parameter', err)
  }
}

async function removeParam(command: VoskCommand, index: number) {
  if (editDisabled.value) return
  command.parameters.splice(index, 1)
  try {
    await saveCommand(command.id)
  } catch (err) {
    console.error('Failed to remove parameter', err)
  }
}

async function saveBlock(commandId: string) {
  try {
    await saveCommand(commandId)
  } catch (err) {
    console.error('Failed to save command', err)
  }
}

function setReverseBool(commandId: string, paramIndex: number, raw: string) {
  if (editDisabled.value) return
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
  if (editDisabled.value) return
  const command = commands.value.find(c => c.id === commandId)
  if (!command) return
  const param = command.parameters[paramIndex]
  if (!param) return
  param.value = value
  fireInput(commandId)
}

function onParamTypeChange(commandId: string, paramIndex: number, newType: VoskCommandParam['type']) {
  if (editDisabled.value) return
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

function onDragStart(event: DragEvent, index: number) {
  if (editDisabled.value) {
    event.preventDefault()
    return
  }
  if (!event.dataTransfer) return
  draggedIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
  const target = event.currentTarget as HTMLElement
  target.classList.add('dragging')
}

function onDragEnd(event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  target.classList.remove('dragging')
  draggedIndex.value = null
  dragOverIndex.value = null
  dragOverEdge.value = null
}

function onDragOver(event: DragEvent, index: number) {
  if (editDisabled.value || draggedIndex.value === null) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const isTopHalf = event.clientY < rect.top + rect.height / 2
  dragOverIndex.value = index
  dragOverEdge.value = isTopHalf ? 'top' : 'bottom'
}

function onDragLeave(event: DragEvent) {
  const related = event.relatedTarget as Node | null
  const current = event.currentTarget as Node
  if (related && current.contains(related)) return
}

async function onDrop(event: DragEvent, index: number) {
  event.preventDefault()
  const from = draggedIndex.value
  const targetEdge = dragOverEdge.value
  draggedIndex.value = null
  dragOverIndex.value = null
  dragOverEdge.value = null
  if (from === null || from === index) return
  await moveCommand(from, index, targetEdge ?? 'top')
}

async function moveCommand(from: number, to: number, edge: 'top' | 'bottom') {
  if (editDisabled.value || from === to) return
  const next = [...commands.value]
  const [moved] = next.splice(from, 1)
  if (!moved) return
  let insertAt = to
  if (from < to) insertAt = to - 1
  if (edge === 'bottom') insertAt += 1
  next.splice(insertAt, 0, moved)
  try {
    await saveCommands(next)
  } catch (err) {
    console.error('Failed to reorder commands', err)
  }
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
    minConfidence: minConfidenceDraft.value
  })
}

async function applyModelDir() {
  modelDirError.value = ''
  const dir = modelDirDraft.value.trim()
  const result = await updateSettings({ modelDir: dir || null })
  if (!result?.success) {
    modelDirError.value = result?.error || 'Directory is not a valid Vosk model'
  } else {
    modelDirDraft.value = ''
  }
}

async function useDefaultModelDir() {
  modelDirError.value = ''
  modelDirDraft.value = ''
  await updateSettings({ modelDir: null })
}

function openModelList() {
  void api.openExternal(status.value.modelListUrl)
}

async function submitNewCategory() {
  const name = newCategoryName.value.trim()
  if (!name) return
  if (await addCategory(name)) {
    newCategoryName.value = ''
  }
}

function onCategorySelect(commandId: string, event: Event) {
  if (editDisabled.value) return
  const value = (event.target as HTMLSelectElement).value
  setCommandCategory(commandId, value === '' ? undefined : value)
}

function onFilterChange(event: Event) {
  categoryFilter.value = (event.target as HTMLSelectElement).value
}

function onRemoveCategory(name: string) {
  if (editDisabled.value) return
  if (commands.value.some(c => c.category === name)) {
    if (!confirm(`Remove category "${name}"? Commands in this category will become Uncategorized.`)) return
  }
  void removeCategory(name)
}

function reverseBoolDisplay(param: VoskCommandParam): string {
  if (param.type !== 'bool') return ''
  if (param.reverseValue === undefined || param.reverseValue === null) return ''
  return param.reverseValue ? 'true' : 'false'
}

async function discardDirty() {
  showDiscardConfirm.value = false
  await discardAllDirty()
}

async function saveAllDirtyBlocks() {
  await saveAllDirty()
}

onMounted(async () => {
  // Native-library preflight - surfaces a clear warning BEFORE the user clicks Start
  // so they don't hit "Failed to load model" if libvosk.dll is missing.
  try {
    preflightResult.value = await preflight()
  } catch {
    preflightResult.value = { ok: false, bundledLibsOk: false, dllPath: null, lastError: 'Preflight IPC failed' }
  }
  await refresh()
  void refreshStatus()
})
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>VOSK Voice Recognition</h1>
      <p>Offline speech recognition - live transcript and voice commands that set OSC parameters</p>
    </div>

    <div class="card">
      <h3>Status</h3>
      <div class="connection-status">
        <span class="status-indicator" :class="statusClass"></span>
        <span>{{ statusText }}</span>
      </div>
      <div class="vosk-action-row">
        <button class="btn btn-primary" :disabled="busy || status.engineState === 'loading-model' || (!status.enabled && status.modelState !== 'ready')" @click="handleToggle">{{ toggleButtonLabel }}</button>
        <div class="autostart-toggle-container">
          <span class="autostart-label">Auto-start:</span>
          <div class="autostart-toggle-slider" role="button" tabindex="0" @click="handleToggleAutostart" @keyup.enter="handleToggleAutostart" @keyup.space.prevent="handleToggleAutostart">
            <div class="autostart-toggle-option disabled" :class="{ active: !autostart }">Disabled</div>
            <div class="autostart-toggle-option enabled" :class="{ active: autostart }">Enabled</div>
          </div>
        </div>
      </div>
      <p v-if="!status.enabled && status.modelState !== 'ready'" class="vosk-hint-block">
        A speech model is required before starting - download one below.
      </p>
      <div v-if="preflightResult && preflightResult.bundledLibsOk === false" class="vosk-preflight-warning">
        <strong>Native library missing</strong>
        <p>{{ preflightResult.lastError || 'libvosk.dll could not be located.' }}</p>
        <p v-if="preflightResult.dllPath" class="vosk-preflight-path">Expected at: <code>{{ preflightResult.dllPath }}</code></p>
        <p class="vosk-preflight-hint">Reinstall the application to restore the speech recognition libraries. If the issue persists, open the application log for the underlying DLL error.</p>
      </div>
    </div>

    <div class="card">
      <h3>Audio Input</h3>
      <div class="form-group">
        <label>Microphone</label>
        <select :value="status.inputDeviceId || ''" @change="handleDeviceChange">
          <option value="">System default</option>
          <option v-for="device in devices" :key="device.deviceId" :value="device.deviceId">{{ device.label }}</option>
        </select>
      </div>
      <div class="vosk-meter-wrap">
        <label>Input level</label>
        <div class="vosk-meter">
          <div class="vosk-meter-fill" :class="{ 'gate-open': gateOpen && status.enabled }" :style="{ width: `${inputLevel}%` }"></div>
          <div v-if="minLevelDraft > 0" class="vosk-meter-threshold" :style="{ left: `${minLevelDraft}%` }"></div>
        </div>
        <div class="vosk-meter-caption">
          <span>{{ inputLevel }}%</span>
          <span v-if="status.enabled && minLevelDraft > 0">{{ gateOpen ? 'Gate open - listening' : 'Below threshold - muted' }}</span>
        </div>
      </div>
      <div class="form-group vosk-slider-row">
        <label>Min input level: {{ minLevelDraft }}% <span class="vosk-hint">(VOSK only listens above this level; 0 disables the gate)</span></label>
        <input type="range" min="0" max="100" step="1" v-model.number="minLevelDraft" @change="commitAudioSettings" />
      </div>
      <div class="form-group vosk-slider-row">
        <label>Input gain: {{ gainDraft }}%</label>
        <input type="range" min="0" max="300" step="5" v-model.number="gainDraft" @change="commitAudioSettings" />
      </div>
      <div class="form-group vosk-slider-row">
        <label>Min confidence: {{ Math.round(minConfidenceDraft * 100) }}% <span class="vosk-hint">(audit filter; recognitions below this score are dropped; 0 disables)</span></label>
        <input type="range" min="0" max="100" step="1" :value="Math.round(minConfidenceDraft * 100)" @input="(e) => minConfidenceDraft = Number((e.target as HTMLInputElement).value) / 100" @change="commitAudioSettings" />
      </div>
    </div>

    <div class="card">
      <h3>Speech Model</h3>
      <p class="vosk-field-text">{{ modelStateText }}</p>
      <p class="vosk-model-path">{{ status.modelDir }}<span v-if="status.usingDefaultModel"> (default)</span></p>
      <div v-if="downloading || downloadProgress?.state === 'error'" class="vosk-progress-block">
        <div class="vosk-progress">
          <div class="vosk-progress-fill" :style="{ width: `${downloadProgress?.percent ?? 0}%` }"></div>
        </div>
        <p class="vosk-progress-label" :class="{ 'vosk-progress-error': downloadProgress?.state === 'error' }">{{ downloadLabel }}</p>
      </div>
      <div class="vosk-action-row">
        <button class="btn btn-primary" :disabled="downloading" @click="downloadModel">Download Small English Model (~40 MB)</button>
        <button class="btn btn-secondary" @click="openModelList">Browse All Models</button>
      </div>
      <div class="form-group vosk-top-gap">
        <label>Custom model directory <span class="vosk-hint">(unzipped model folder from the model list)</span></label>
        <div class="vosk-model-dir-row">
          <input type="text" v-model="modelDirDraft" placeholder="C:\path\to\vosk-model-..." />
          <button class="btn btn-secondary btn-small" @click="applyModelDir">Apply</button>
          <button v-if="!status.usingDefaultModel" class="btn btn-secondary btn-small" @click="useDefaultModelDir">Use Default</button>
        </div>
        <p v-if="modelDirError" class="vosk-error-text">{{ modelDirError }}</p>
      </div>
    </div>

    <div class="card">
      <h3>Live Transcript</h3>
      <div class="vosk-partial" :class="{ active: partial }">{{ partial || (status.enabled ? 'Listening...' : 'Engine stopped') }}</div>
      <div v-if="transcript.length" class="vosk-transcript">
        <div v-for="entry in transcript" :key="entry.at" class="vosk-transcript-entry" :class="{ dropped: entry.droppedByConfidence }">
          <span class="vosk-transcript-time">{{ timeLabel(entry.at) }}</span>
          <span class="vosk-transcript-text">{{ entry.text }}</span>
          <span class="vosk-transcript-conf">{{ confidenceLabel(entry.confidence, entry.droppedByConfidence) }}</span>
          <span v-if="entry.matchedCommandName" class="vosk-transcript-cmd" :class="entry.matchedDirection">
            {{ entry.matchedDirection === 'reverse' ? 'reverse ' : '' }}{{ entry.matchedCommandName }}
          </span>
          <span v-else-if="entry.droppedByConfidence" class="vosk-transcript-cmd dropped">dropped</span>
        </div>
      </div>
      <p v-else class="vosk-empty">Recognized speech will appear here.</p>
      <button v-if="transcript.length" class="btn btn-secondary btn-small vosk-top-gap-small" @click="clearTranscript">Clear</button>
    </div>

    <div class="card">
      <div class="vosk-commands-head">
        <div class="vosk-commands-head-row">
          <h3>Voice Commands</h3>
          <button
            class="btn"
            :class="layoutEditMode ? 'btn-warning' : 'btn-secondary'"
            @click="layoutEditMode = !layoutEditMode"
            :title="layoutEditMode ? 'Disable editing - lock all command fields' : 'Enable editing - unlock command fields'"
          >
            {{ layoutEditMode ? 'Editing: ON' : 'Editing: OFF' }}
          </button>
        </div>
        <p class="vosk-hint">Say the trigger phrase to fire all of a command's OSC parameters at once. Add a reverse phrase to send each parameter's reverse value.</p>
      </div>

      <div v-if="anyDirty" class="vosk-dirty-bar">
        <span>{{ dirtyCount }} command(s) have unsaved changes</span>
        <div class="vosk-dirty-actions">
          <button class="btn btn-primary btn-small" @click="saveAllDirtyBlocks">Save All</button>
          <button class="btn btn-secondary btn-small" @click="showDiscardConfirm = true">Discard</button>
        </div>
      </div>

      <div v-if="showDiscardConfirm" class="vosk-confirm-bar">
        <span>Discard all unsaved changes? Reload from disk?</span>
        <div class="vosk-dirty-actions">
          <button class="btn btn-danger btn-small" @click="discardDirty">Yes, discard</button>
          <button class="btn btn-secondary btn-small" @click="showDiscardConfirm = false">Cancel</button>
        </div>
      </div>

      <div class="vosk-categories">
        <div class="vosk-categories-row">
          <div class="form-group vosk-categories-filter">
            <label>Filter</label>
            <select :value="categoryFilter" @change="onFilterChange" :disabled="editDisabled">
              <option v-for="opt in categoryFilterOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
          <div class="form-group vosk-categories-add">
            <label>New category</label>
            <div class="vosk-new-category-row">
              <input type="text" v-model="newCategoryName" placeholder="Category name" :disabled="editDisabled" @keyup.enter="submitNewCategory" />
              <button class="btn btn-secondary btn-small" :disabled="!newCategoryName.trim() || editDisabled" @click="submitNewCategory">Add</button>
            </div>
          </div>
        </div>
        <div v-if="categories.length" class="vosk-category-chips">
          <span v-for="cat in categories" :key="cat" class="vosk-category-chip">
            {{ cat }}
            <button v-if="!editDisabled" class="vosk-category-remove" :title="`Remove category ${cat}`" @click="onRemoveCategory(cat)">x</button>
          </span>
        </div>
      </div>

      <div v-if="!hasCommands" class="vosk-empty">
        No commands yet. Click "Add Command" to create one.
      </div>

      <div
        v-for="(command, index) in filteredCommands"
        :key="command.id"
        class="vosk-command"
        :class="{
          fired: !!firedRecently(command),
          disabled: !command.enabled,
          collapsed: isCollapsed(command.id),
          dirty: isDirty(command.id),
          'drag-over-top': dragOverIndex === index && dragOverEdge === 'top',
          'drag-over-bottom': dragOverIndex === index && dragOverEdge === 'bottom'
        }"
        :draggable="!editDisabled"
        @dragstart="onDragStart($event, index)"
        @dragend="onDragEnd($event)"
        @dragover="onDragOver($event, index)"
        @dragleave="onDragLeave($event)"
        @drop="onDrop($event, index)"
      >
        <div class="vosk-command-head">
          <div
            v-if="!editDisabled"
            class="vosk-command-drag-handle"
            title="Drag to reorder"
            aria-label="Drag handle"
          >
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
              <rect x="3" y="4" width="14" height="2" rx="1" fill="currentColor" />
              <rect x="3" y="9" width="14" height="2" rx="1" fill="currentColor" />
              <rect x="3" y="14" width="14" height="2" rx="1" fill="currentColor" />
            </svg>
          </div>
          <div v-else class="vosk-command-drag-handle locked" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
              <rect x="6" y="9" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path d="M7 9 V7 a3 3 0 0 1 6 0 V9" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </div>
          <button
            class="vosk-collapse-btn"
            :aria-expanded="!isCollapsed(command.id)"
            :title="isCollapsed(command.id) ? 'Expand' : 'Collapse'"
            @click="toggleCollapse(command.id)"
          >
            <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
              <path v-if="isCollapsed(command.id)" d="M5 8 L10 13 L15 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <path v-else d="M5 12 L10 7 L15 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="vosk-command-head-fields">
            <input
              type="text"
              v-model="command.name"
              class="vosk-command-name"
              placeholder="Command name"
              :disabled="editDisabled"
              @input="fireInput(command.id)"
            />
            <div class="vosk-command-meta">
              <span v-if="command.category" class="vosk-command-category">{{ command.category }}</span>
              <span v-if="firedRecently(command)" class="vosk-fired-badge">Fired ({{ firedRecently(command) }})</span>
              <span v-if="isDirty(command.id)" class="vosk-dirty-badge">{{ isSaving(command.id) ? 'Saving...' : 'Unsaved' }}</span>
            </div>
          </div>
          <label class="vosk-inline-check">
            <input type="checkbox" v-model="command.enabled" :disabled="editDisabled" @change="fireInput(command.id)" /> Enabled
          </label>
          <select v-model="command.matchType" class="vosk-match-select" :disabled="editDisabled" @change="fireInput(command.id)">
            <option value="contains">Contains</option>
            <option value="exact">Exact</option>
          </select>
          <select
            class="vosk-category-select"
            :value="command.category || ''"
            :disabled="editDisabled"
            @change="onCategorySelect(command.id, $event)"
            title="Category"
          >
            <option value="">Uncategorized</option>
            <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
          </select>
          <div class="vosk-command-actions">
            <button v-if="isDirty(command.id)" class="btn btn-primary btn-small" :disabled="isSaving(command.id)" @click="saveBlock(command.id)">{{ isSaving(command.id) ? 'Saving...' : 'Save' }}</button>
            <button class="btn btn-secondary btn-small" :disabled="editDisabled" @click="duplicateCommand(command)" title="Duplicate this command">Duplicate</button>
            <button class="btn btn-danger btn-small" :disabled="editDisabled" @click="removeCommand(command)" title="Delete this command">Delete</button>
          </div>
        </div>

        <div class="vosk-command-body" v-show="!isCollapsed(command.id)">
          <div class="vosk-command-fields">
            <div class="form-group">
              <label>Trigger phrase</label>
              <input type="text" v-model="command.phrase" placeholder="e.g. lights on" :disabled="editDisabled" @input="fireInput(command.id)" />
            </div>
            <div class="form-group">
              <label>Reverse phrase <span class="vosk-hint">(optional - sends reverse values)</span></label>
              <input type="text" v-model="command.reversePhrase" placeholder="e.g. lights off" :disabled="editDisabled" @input="fireInput(command.id)" />
            </div>
          </div>
          <div class="vosk-field">
            <table class="vosk-param-table">
              <thead>
                <tr>
                  <th>OSC Address</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Reverse value</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(param, paramIndex) in command.parameters" :key="paramIndex">
                  <td>
                    <input type="text" v-model="param.address" placeholder="/avatar/parameters/..." :disabled="editDisabled" @input="fireInput(command.id)" />
                  </td>
                  <td>
                    <select :value="param.type" :disabled="editDisabled" @change="onParamTypeChange(command.id, paramIndex, ($event.target as HTMLSelectElement).value as VoskCommandParam['type'])">
                      <option value="f">Float</option>
                      <option value="i">Int</option>
                      <option value="bool">Bool</option>
                      <option value="s">String</option>
                    </select>
                  </td>
                  <td>
                    <select
                      v-if="param.type === 'bool'"
                      :value="param.value ? 'true' : 'false'"
                      :disabled="editDisabled"
                      @change="onBoolValueChange(command.id, paramIndex, ($event.target as HTMLSelectElement).value === 'true')"
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                    <input v-else type="text" v-model="param.value" placeholder="1" :disabled="editDisabled" @input="fireInput(command.id)" />
                  </td>
                  <td>
                    <select
                      v-if="param.type === 'bool'"
                      :value="reverseBoolDisplay(param)"
                      :disabled="editDisabled"
                      @change="setReverseBool(command.id, paramIndex, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">Auto (inverted)</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                    <input v-else type="text" v-model="param.reverseValue" placeholder="(optional)" :disabled="editDisabled" @input="fireInput(command.id)" />
                  </td>
                  <td>
                    <button
                      class="btn btn-danger btn-small"
                      :disabled="editDisabled || command.parameters.length <= 1"
                      @click="removeParam(command, paramIndex)"
                      title="Remove parameter"
                    >x</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="vosk-add-param-row">
              <button class="btn btn-secondary btn-small" :disabled="editDisabled" @click="addParam(command)">+ Add Parameter</button>
            </div>
          </div>
        </div>
      </div>

      <div class="vosk-commands-foot">
        <button class="btn btn-primary" :disabled="editDisabled" @click="addCommand">+ Add Command</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vosk-action-row {
  margin-top: 10px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.autostart-label {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.8;
}
.vosk-hint-block {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}
.vosk-preflight-warning {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 6px;
  background: rgba(243, 156, 18, 0.14);
  border: 1px solid rgba(243, 156, 18, 0.45);
  color: inherit;
}
.vosk-preflight-warning strong {
  color: #f39c12;
  font-size: 13px;
  display: block;
  margin-bottom: 4px;
}
.vosk-preflight-warning p {
  margin: 4px 0;
  font-size: 12px;
  color: inherit;
}
.vosk-preflight-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  opacity: 0.85;
  word-break: break-all;
}
.vosk-preflight-path code {
  background: rgba(127, 127, 127, 0.15);
  padding: 1px 4px;
  border-radius: 3px;
}
.vosk-preflight-hint {
  font-size: 11px;
  opacity: 0.8;
  font-style: italic;
}
.vosk-meter-wrap {
  margin: 12px 0;
}
.vosk-meter-wrap > label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}
.vosk-meter {
  position: relative;
  height: 18px;
  border-radius: 9px;
  background: rgba(127, 127, 127, 0.2);
  overflow: hidden;
}
.vosk-meter-fill {
  height: 100%;
  background: #7f8c8d;
  border-radius: 9px;
  transition: width 80ms linear;
}
.vosk-meter-fill.gate-open {
  background: #2ecc71;
}
.vosk-meter-threshold {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #e67e22;
}
.vosk-meter-caption {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}
.vosk-slider-row input[type='range'] {
  width: 100%;
}
.vosk-hint {
  font-weight: 400;
  font-size: 11px;
  opacity: 0.7;
}
.vosk-field-text {
  font-size: 13px;
  margin: 0;
}
.vosk-model-path {
  font-size: 12px;
  color: #999;
  word-break: break-all;
  margin: 4px 0 0;
}
.vosk-progress-block {
  margin: 10px 0;
}
.vosk-progress {
  height: 10px;
  border-radius: 5px;
  background: rgba(127, 127, 127, 0.2);
  overflow: hidden;
}
.vosk-progress-fill {
  height: 100%;
  background: #3498db;
  transition: width 200ms linear;
}
.vosk-progress-label {
  font-size: 12px;
  margin-top: 4px;
}
.vosk-progress-error {
  color: #e74c3c;
}
.vosk-top-gap {
  margin-top: 15px;
}
.vosk-top-gap-small {
  margin-top: 8px;
}
.vosk-model-dir-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.vosk-model-dir-row input {
  flex: 1;
  min-width: 240px;
}
.vosk-error-text {
  font-size: 12px;
  color: #e74c3c;
  margin-top: 4px;
}
.vosk-partial {
  font-style: italic;
  color: #999;
  min-height: 24px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.08);
}
.vosk-partial.active {
  color: inherit;
}
.vosk-transcript {
  margin-top: 8px;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vosk-transcript-entry {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.06);
}
.vosk-transcript-entry.dropped {
  opacity: 0.55;
}
.vosk-transcript-time {
  font-size: 11px;
  color: #999;
  white-space: nowrap;
}
.vosk-transcript-text {
  flex: 1;
}
.vosk-transcript-conf {
  font-size: 11px;
  color: #999;
}
.vosk-transcript-cmd {
  font-size: 11px;
  color: #2ecc71;
  white-space: nowrap;
}
.vosk-transcript-cmd.reverse {
  color: #e67e22;
}
.vosk-transcript-cmd.dropped {
  color: #999;
}
.vosk-empty {
  font-size: 13px;
  color: #999;
  text-align: center;
  padding: 10px;
}
.vosk-commands-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
.vosk-commands-head-row h3 {
  margin: 0;
}
.vosk-dirty-bar,
.vosk-confirm-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin: 8px 0 4px;
}
.vosk-dirty-bar {
  background: rgba(243, 156, 18, 0.16);
  border: 1px solid rgba(243, 156, 18, 0.35);
  color: inherit;
}
.vosk-confirm-bar {
  background: rgba(231, 76, 60, 0.16);
  border: 1px solid rgba(231, 76, 60, 0.4);
  color: inherit;
}
.vosk-dirty-actions {
  display: flex;
  gap: 6px;
}
.vosk-categories {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
  border: 1px solid rgba(127, 127, 127, 0.18);
}
.vosk-categories-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 10px;
}
@media (max-width: 700px) {
  .vosk-categories-row {
    grid-template-columns: 1fr;
  }
}
.vosk-categories-filter,
.vosk-categories-add {
  margin-bottom: 0;
}
.vosk-categories-filter label,
.vosk-categories-add label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
  opacity: 0.85;
}
.vosk-category-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 22px;
}
.vosk-category-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(52, 152, 219, 0.18);
  color: inherit;
  font-size: 12px;
  border: 1px solid rgba(52, 152, 219, 0.35);
}
.vosk-category-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.6;
}
.vosk-category-remove:hover {
  opacity: 1;
}
.vosk-new-category-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.vosk-new-category-row input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  font-size: 13px;
}
.vosk-command {
  position: relative;
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 8px;
  padding: 0;
  margin-top: 12px;
  transition: border-color 300ms, box-shadow 300ms, opacity 200ms;
  background: transparent;
}
.vosk-command.dragging {
  opacity: 0.4;
}
.vosk-command.drag-over-top {
  box-shadow: 0 -3px 0 0 #3498db inset;
}
.vosk-command.drag-over-bottom {
  box-shadow: 0 3px 0 0 #3498db inset;
}
.vosk-command.fired {
  border-color: #2ecc71;
  box-shadow: 0 0 6px rgba(46, 204, 113, 0.4);
}
.vosk-command.disabled {
  opacity: 0.6;
}
.vosk-command.dirty {
  border-color: #f39c12;
  box-shadow: 0 0 0 1px rgba(243, 156, 18, 0.35);
}
.vosk-command-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  align-self: stretch;
  cursor: grab;
  color: inherit;
  opacity: 0.55;
  flex-shrink: 0;
  user-select: none;
  background: rgba(127, 127, 127, 0.06);
  border-top-left-radius: 8px;
  border-bottom-left-radius: 8px;
  transition: opacity 150ms, background 150ms;
}
.vosk-command-drag-handle.locked {
  cursor: not-allowed;
  opacity: 0.3;
}
.vosk-command-drag-handle:hover {
  opacity: 1;
  background: rgba(127, 127, 127, 0.14);
}
.vosk-command-drag-handle:active {
  cursor: grabbing;
}
.vosk-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin: 6px 4px 0 4px;
  background: rgba(127, 127, 127, 0.1);
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
  flex-shrink: 0;
}
.vosk-collapse-btn:hover {
  background: rgba(127, 127, 127, 0.18);
}
.vosk-command-head {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  flex-wrap: wrap;
  padding: 8px 10px 6px 0;
}
.vosk-command-head-fields {
  flex: 1;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.vosk-command-name {
  font-weight: 600;
  font-size: 14px;
  color: inherit;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 6px;
  transition: border-color 150ms, background 150ms;
}
.vosk-command-name:hover {
  border-color: rgba(127, 127, 127, 0.3);
}
.vosk-command-name:focus {
  outline: none;
  border-color: #3498db;
  background: rgba(52, 152, 219, 0.06);
}
.vosk-command-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  min-height: 16px;
  flex-wrap: wrap;
}
.vosk-command-category {
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.15);
  color: inherit;
}
.vosk-fired-badge {
  font-weight: 600;
  color: #2ecc71;
}
.vosk-dirty-badge {
  font-weight: 600;
  color: #f39c12;
}
.vosk-inline-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  white-space: nowrap;
  margin-top: 6px;
}
.vosk-match-select,
.vosk-category-select {
  width: auto;
  min-width: 100px;
  padding: 6px 8px;
  font-size: 13px;
  color: inherit;
  background: transparent;
  border: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 4px;
  margin-top: 4px;
}
.vosk-command-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
  margin-top: 4px;
  flex-wrap: wrap;
}
.vosk-command-body {
  padding: 8px 12px 12px 36px;
}
.vosk-command-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 4px;
}
@media (max-width: 700px) {
  .vosk-command-fields {
    grid-template-columns: 1fr;
  }
}
.vosk-field {
  margin-top: 4px;
}
.vosk-param-table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 0;
  font-size: 13px;
  color: inherit;
}
.vosk-param-table th {
  text-align: left;
  font-size: 11px;
  opacity: 0.7;
  padding: 4px 6px;
  font-weight: 600;
  color: inherit;
}
.vosk-param-table td {
  padding: 4px 6px;
  vertical-align: middle;
  color: inherit;
}
.vosk-param-table input,
.vosk-param-table select {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  color: inherit;
  background: transparent;
  border: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 4px;
}
.vosk-param-table input:focus,
.vosk-param-table select:focus {
  outline: none;
  border-color: #3498db;
  background: rgba(52, 152, 219, 0.06);
}
.vosk-add-param-row {
  width: 40%;
  min-width: 220px;
  margin-top: 8px;
}
.vosk-commands-foot {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  align-items: center;
}
.vosk-commands-foot > button {
  min-width: 160px;
}
.vosk-command.collapsed .vosk-command-body {
  display: none;
}
.vosk-command.collapsed .vosk-command-head {
  padding-bottom: 8px;
}
</style>