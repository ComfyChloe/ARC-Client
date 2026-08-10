<template>
  <div class="page-view">
    <div class="header">
      <h1>Whisper Voice Recognition</h1>
      <p>Offline speech recognition via whisper.cpp - utterance-level transcription and voice commands that set OSC parameters</p>
    </div>

    <div class="card">
      <h3>Status</h3>
      <div class="connection-status">
        <span class="status-indicator" :class="statusClass"></span>
        <span>{{ statusText }}</span>
      </div>
      <div class="whisper-action-row">
        <button
          class="btn btn-primary"
          :disabled="busy || isStartingOrPreparing || (!status.enabled && status.modelState !== 'ready')"
          @click="handleToggle"
        >
          {{ toggleButtonLabel }}
        </button>
        <div class="autostart-toggle-container">
          <span class="autostart-label">Auto-start:</span>
          <div class="autostart-toggle-slider" role="button" tabindex="0" @click="handleToggleAutostart" @keyup.enter="handleToggleAutostart" @keyup.space.prevent="handleToggleAutostart">
            <div class="autostart-toggle-option disabled" :class="{ active: !autostart }">Disabled</div>
            <div class="autostart-toggle-option enabled" :class="{ active: autostart }">Enabled</div>
          </div>
        </div>
      </div>
      <p v-if="!status.enabled && status.modelState !== 'ready'" class="whisper-hint-block">
        A speech model is required before starting - download one below.
      </p>
      <div v-if="preflightResult && preflightResult.bundledLibsOk === false" class="whisper-preflight-warning">
        <strong>Native library missing</strong>
        <p>{{ preflightResult.lastError || 'whisper.node could not be located.' }}</p>
        <p v-if="preflightResult.dllPath" class="whisper-preflight-path">Expected at: <code>{{ preflightResult.dllPath }}</code></p>
        <p class="whisper-preflight-hint">Reinstall the application to restore the speech recognition libraries. If the issue persists, open the application log for the underlying DLL error.</p>
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
      <div class="whisper-meter-wrap">
        <label>Input level</label>
        <div class="whisper-meter">
          <div class="whisper-meter-fill" :class="{ 'gate-open': gateOpen && status.enabled }" :style="{ width: `${inputLevel}%` }"></div>
          <div v-if="minLevelDraft > 0" class="whisper-meter-threshold" :style="{ left: `${minLevelDraft}%` }"></div>
        </div>
        <div class="whisper-meter-caption">
          <span>{{ inputLevel }}%</span>
          <span v-if="status.enabled && minLevelDraft > 0">{{ gateOpen ? 'Gate open - recording' : 'Below threshold - muted' }}</span>
        </div>
      </div>
      <div class="form-group whisper-slider-row">
        <label>Min input level: {{ minLevelDraft }}% <span class="whisper-hint">(Whisper only records above this level; 0 disables the gate)</span></label>
        <input type="range" min="0" max="100" step="1" v-model.number="minLevelDraft" @change="commitAudioSettings" />
      </div>
      <div class="form-group whisper-slider-row">
        <label>Input gain: {{ gainDraft }}%</label>
        <input type="range" min="0" max="300" step="5" v-model.number="gainDraft" @change="commitAudioSettings" />
      </div>
      <div class="form-group whisper-slider-row">
        <label>Min utterance: {{ minUtteranceDraft }} ms <span class="whisper-hint">(utterances shorter than this are dropped as noise blips; default 350 ms)</span></label>
        <input type="range" min="0" max="2000" step="50" v-model.number="minUtteranceDraft" @change="commitAudioSettings" />
      </div>
    </div>

    <div class="card">
      <h3>Speech Model</h3>
      <p class="whisper-field-text">{{ modelStateText }}</p>
      <p class="whisper-model-path">{{ status.modelDir }}<span v-if="status.usingDefaultModel"> (default)</span></p>
      <div v-if="downloading || downloadProgress?.state === 'error'" class="whisper-progress-block">
        <div class="whisper-progress">
          <div class="whisper-progress-fill" :style="{ width: `${downloadProgress?.percent ?? 0}%` }"></div>
        </div>
        <p class="whisper-progress-label" :class="{ 'whisper-progress-error': downloadProgress?.state === 'error' }">{{ downloadLabel }}</p>
      </div>
      <div class="whisper-action-row">
        <button class="btn btn-primary" :disabled="downloading" @click="downloadModel">Download Tiny English Model (~75 MB)</button>
        <button class="btn btn-secondary" @click="openModelList">Browse All Models</button>
      </div>
      <div class="form-group whisper-top-gap">
        <label>Custom model file <span class="whisper-hint">(a single .bin ggml model file from the model list)</span></label>
        <div class="whisper-model-dir-row">
          <input type="text" v-model="modelDirDraft" placeholder="C:\path\to\ggml-tiny.en.bin" />
          <button class="btn btn-secondary btn-small" @click="applyModelDir">Apply</button>
          <button v-if="!status.usingDefaultModel" class="btn btn-secondary btn-small" @click="useDefaultModelDir">Use Default</button>
        </div>
        <p v-if="modelDirError" class="whisper-error-text">{{ modelDirError }}</p>
      </div>
    </div>

    <div class="card">
      <h3>Live Transcript</h3>
      <div class="whisper-partial" :class="{ active: status.enabled }">
        {{ status.enabled ? 'Listening - utterance will appear when you stop speaking' : 'Engine stopped' }}
      </div>
      <div v-if="transcript.length" class="whisper-transcript">
        <div v-for="entry in transcript" :key="entry.at" class="whisper-transcript-entry" :class="{ dropped: entry.droppedByConfidence }">
          <span class="whisper-transcript-time">{{ timeLabel(entry.at) }}</span>
          <span class="whisper-transcript-text">{{ entry.text }}</span>
          <span class="whisper-transcript-cmd" :class="entry.matchedDirection">
            {{ entry.matchedDirection === 'reverse' ? 'reverse ' : '' }}{{ entry.matchedCommandName }}
          </span>
        </div>
      </div>
      <p v-else class="whisper-empty">Recognized speech will appear here.</p>
      <button v-if="transcript.length" class="btn btn-secondary btn-small whisper-top-gap-small" @click="clearTranscript">Clear</button>
    </div>

    <div class="card">
      <div class="whisper-commands-head">
        <div class="whisper-commands-head-row">
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
        <p class="whisper-hint">Say the trigger phrase to fire all of a command's OSC parameters at once. Add a reverse phrase to send each parameter's reverse value.</p>
      </div>

      <div v-if="anyDirty" class="whisper-dirty-bar">
        <span>{{ dirtyCount }} command(s) have unsaved changes</span>
        <div class="whisper-dirty-actions">
          <button class="btn btn-primary btn-small" @click="saveAllDirtyBlocks">Save All</button>
          <button class="btn btn-secondary btn-small" @click="showDiscardConfirm = true">Discard</button>
        </div>
      </div>

      <div v-if="showDiscardConfirm" class="whisper-confirm-bar">
        <span>Discard all unsaved changes? Reload from disk?</span>
        <div class="whisper-dirty-actions">
          <button class="btn btn-danger btn-small" @click="discardDirty">Yes, discard</button>
          <button class="btn btn-secondary btn-small" @click="showDiscardConfirm = false">Cancel</button>
        </div>
      </div>

      <div class="whisper-categories">
        <div class="whisper-categories-row">
          <div class="form-group whisper-categories-filter">
            <label>Filter</label>
            <select :value="categoryFilter" @change="onFilterChange" :disabled="editDisabled">
              <option v-for="opt in categoryFilterOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
          <div class="form-group whisper-categories-add">
            <label>New category</label>
            <div class="whisper-new-category-row">
              <input type="text" v-model="newCategoryName" placeholder="Category name" :disabled="editDisabled" @keyup.enter="submitNewCategory" />
              <button class="btn btn-secondary btn-small" :disabled="!newCategoryName.trim() || editDisabled" @click="submitNewCategory">Add</button>
            </div>
          </div>
        </div>

        <div v-if="categories.length" class="whisper-category-chips">
          <span v-for="cat in categories" :key="cat" class="whisper-category-chip">
            {{ cat }}
            <button v-if="!editDisabled" class="whisper-category-remove" :title="`Remove category ${cat}`" @click="onRemoveCategory(cat)">x</button>
          </span>
        </div>
      </div>

      <div v-if="!hasCommands" class="whisper-empty">
        No commands yet. Click "Add Command" to create one.
      </div>

      <div
        v-for="(command, index) in filteredCommands"
        :key="command.id"
        class="whisper-command"
        :class="{
          fired: !!firedRecently(command),
          disabled: !command.enabled,
          collapsed: isCollapsed(command.id),
          dirty: isDirty(command.id)
        }"
      >
        <div class="whisper-command-head">
          <div class="whisper-command-head-fields">
            <input
              type="text"
              v-model="command.name"
              class="whisper-command-name"
              placeholder="Command name"
              :disabled="editDisabled"
              @input="fireInput(command.id)"
            />
            <div class="whisper-command-meta">
              <span v-if="command.category" class="whisper-command-category">{{ command.category }}</span>
              <span v-if="firedRecently(command)" class="whisper-fired-badge">Fired ({{ firedRecently(command) }})</span>
              <span v-if="isDirty(command.id)" class="whisper-dirty-badge">{{ isSaving(command.id) ? 'Saving...' : 'Unsaved' }}</span>
            </div>
          </div>
          <label class="whisper-inline-check">
            <input type="checkbox" v-model="command.enabled" :disabled="editDisabled" @change="fireInput(command.id)" /> Enabled
          </label>
          <select v-model="command.matchType" class="whisper-match-select" :disabled="editDisabled" @change="fireInput(command.id)">
            <option value="contains">Contains</option>
            <option value="exact">Exact</option>
          </select>
          <select
            class="whisper-category-select"
            :value="command.category || ''"
            :disabled="editDisabled"
            @change="onCategorySelect(command.id, $event)"
            title="Category"
          >
            <option value="">Uncategorized</option>
            <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
          </select>
          <div class="whisper-command-actions">
            <button v-if="isDirty(command.id)" class="btn btn-primary btn-small" :disabled="isSaving(command.id)" @click="saveBlock(command.id)">{{ isSaving(command.id) ? 'Saving...' : 'Save' }}</button>
            <button class="btn btn-secondary btn-small" :disabled="editDisabled" @click="removeCommand(command)" title="Delete this command">Delete</button>
          </div>
        </div>

        <div class="whisper-command-body" v-show="!isCollapsed(command.id)">
          <div class="whisper-command-fields">
            <div class="form-group">
              <label>Trigger phrase</label>
              <input type="text" v-model="command.phrase" placeholder="e.g. lights on" :disabled="editDisabled" @input="fireInput(command.id)" />
            </div>
            <div class="form-group">
              <label>Reverse phrase <span class="whisper-hint">(optional - sends reverse values)</span></label>
              <input type="text" v-model="command.reversePhrase" placeholder="e.g. lights off" :disabled="editDisabled" @input="fireInput(command.id)" />
            </div>
          </div>
          <div class="whisper-field">
            <table class="whisper-param-table">
              <thead>
                <tr>
                  <th>OSC Address</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Reverse value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(param, paramIndex) in command.parameters" :key="paramIndex">
                  <td>
                    <input type="text" v-model="param.address" placeholder="/avatar/parameters/..." :disabled="editDisabled" @input="fireInput(command.id)" />
                  </td>
                  <td>
                    <select :value="param.type" :disabled="editDisabled" @change="onParamTypeChange(command.id, paramIndex, ($event.target as HTMLSelectElement).value as WhisperCommandParam['type'])">
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
                </tr>
              </tbody>
            </table>
            <div class="whisper-add-param-row">
              <button class="btn btn-secondary btn-small" :disabled="editDisabled" @click="addParam(command)">+ Add Parameter</button>
            </div>
          </div>
        </div>
      </div>

      <div class="whisper-commands-foot">
        <button class="btn btn-primary" :disabled="editDisabled" @click="addCommand">+ Add Command</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useWhisper, type WhisperCommand, type WhisperCommandParam, type WhisperPreflightResult } from '../composables/useWhisper'
import { useElectronAPI } from '../composables/useElectronAPI'

const api = useElectronAPI()
const {
  status,
  commands,
  categories,
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
} = useWhisper()

const busy = ref(false)
const preflightResult = ref<WhisperPreflightResult | null>(null)
const layoutEditMode = ref(true)
const showDiscardConfirm = ref(false)
const minLevelDraft = ref(0)
const gainDraft = ref(100)
const minUtteranceDraft = ref(350)
const modelDirDraft = ref('')
const modelDirError = ref('')
const newCategoryName = ref('')
const categoryFilter = ref<string>('__all__')

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

const filteredCommands = computed<WhisperCommand[]>(() => {
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

function firedRecently(command: WhisperCommand): 'forward' | 'reverse' | null {
  const fired = lastFired.value
  if (!fired || fired.name !== command.name) return null
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

async function removeCommand(command: WhisperCommand) {
  if (editDisabled.value) return
  try {
    await saveCommands(commands.value.filter(c => c.id !== command.id))
  } catch (err) {
    console.error('Failed to remove command', err)
  }
}

async function addParam(command: WhisperCommand) {
  if (editDisabled.value) return
  command.parameters.push(newParam())
  try {
    await saveCommand(command.id)
  } catch (err) {
    console.error('Failed to add parameter', err)
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

function onParamTypeChange(commandId: string, paramIndex: number, newType: WhisperCommandParam['type']) {
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

function reverseBoolDisplay(param: WhisperCommandParam): string {
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
  const file = modelDirDraft.value.trim()
  const result = await updateSettings({ modelDir: file || null })
  if (!result?.success) {
    modelDirError.value = result?.error || 'File is not a valid Whisper ggml model'
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

onMounted(async () => {
  try {
    preflightResult.value = await preflight()
  } catch {
    preflightResult.value = { ok: false, bundledLibsOk: false, dllPath: null, lastError: 'Preflight IPC failed' }
  }
  await refresh()
  void refreshStatus()
})
</script>

<style scoped>
.whisper-action-row {
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
.whisper-hint-block {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}
.whisper-preflight-warning {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 6px;
  background: rgba(243, 156, 18, 0.14);
  border: 1px solid rgba(243, 156, 18, 0.45);
  color: inherit;
}
.whisper-preflight-warning strong {
  color: #f39c12;
  font-size: 13px;
  display: block;
  margin-bottom: 4px;
}
.whisper-preflight-warning p {
  margin: 4px 0;
  font-size: 12px;
  color: inherit;
}
.whisper-preflight-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  opacity: 0.85;
  word-break: break-all;
}
.whisper-preflight-path code {
  background: rgba(127, 127, 127, 0.15);
  padding: 1px 4px;
  border-radius: 3px;
}
.whisper-preflight-hint {
  font-size: 11px;
  opacity: 0.8;
  font-style: italic;
}
.whisper-meter-wrap {
  margin: 12px 0;
}
.whisper-meter-wrap > label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}
.whisper-meter {
  position: relative;
  height: 18px;
  border-radius: 9px;
  background: rgba(127, 127, 127, 0.2);
  overflow: hidden;
}
.whisper-meter-fill {
  height: 100%;
  background: #7f8c8d;
  border-radius: 9px;
  transition: width 80ms linear;
}
.whisper-meter-fill.gate-open {
  background: #2ecc71;
}
.whisper-meter-threshold {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #e67e22;
}
.whisper-meter-caption {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}
.whisper-slider-row input[type='range'] {
  width: 100%;
}
.whisper-hint {
  font-weight: 400;
  font-size: 11px;
  opacity: 0.7;
}
.whisper-field-text {
  font-size: 13px;
  margin: 0;
}
.whisper-model-path {
  font-size: 12px;
  color: #999;
  word-break: break-all;
  margin: 4px 0 0;
}
.whisper-progress-block {
  margin: 10px 0;
}
.whisper-progress {
  height: 10px;
  border-radius: 5px;
  background: rgba(127, 127, 127, 0.2);
  overflow: hidden;
}
.whisper-progress-fill {
  height: 100%;
  background: #2ecc71;
  transition: width 100ms linear;
}
.whisper-progress-label {
  font-size: 12px;
  margin: 4px 0 0;
  color: #999;
}
.whisper-progress-error {
  color: #e74c3c;
}
.whisper-top-gap {
  margin-top: 12px;
}
.whisper-top-gap-small {
  margin-top: 12px;
}
.whisper-model-dir-row {
  display: flex;
  gap: 8px;
}
.whisper-model-dir-row input {
  flex: 1;
}
.whisper-error-text {
  font-size: 12px;
  color: #e74c3c;
  margin: 4px 0 0;
}
.whisper-partial {
  font-size: 14px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.1);
  margin-bottom: 12px;
  font-style: italic;
  color: #999;
}
.whisper-partial.active {
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.1);
  font-style: normal;
}
.whisper-transcript {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 6px;
}
.whisper-transcript-entry {
  display: flex;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.1);
  font-size: 13px;
}
.whisper-transcript-entry:last-child {
  border-bottom: none;
}
.whisper-transcript-entry.dropped {
  opacity: 0.55;
  text-decoration: line-through;
}
.whisper-transcript-time {
  color: #999;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  min-width: 70px;
}
.whisper-transcript-text {
  flex: 1;
}
.whisper-transcript-cmd {
  color: #2ecc71;
  font-size: 11px;
  font-weight: 600;
}
.whisper-transcript-cmd.reverse {
  color: #e67e22;
}
.whisper-empty {
  font-size: 13px;
  color: #999;
  text-align: center;
  padding: 16px;
}
.whisper-commands-head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.whisper-commands-head h3 {
  margin: 0;
}
.whisper-commands-head p {
  margin: 0 0 12px;
}
.whisper-dirty-bar,
.whisper-confirm-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}
.whisper-dirty-bar {
  background: rgba(241, 196, 15, 0.12);
  border: 1px solid rgba(241, 196, 15, 0.4);
}
.whisper-confirm-bar {
  background: rgba(231, 76, 60, 0.12);
  border: 1px solid rgba(231, 76, 60, 0.4);
}
.whisper-dirty-actions {
  display: flex;
  gap: 8px;
}
.whisper-categories-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 8px;
}
.whisper-categories-filter,
.whisper-categories-add {
  margin: 0;
}
.whisper-new-category-row {
  display: flex;
  gap: 8px;
}
.whisper-new-category-row input {
  flex: 1;
}
.whisper-category-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.whisper-category-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: rgba(127, 127, 127, 0.15);
  font-size: 12px;
}
.whisper-category-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  padding: 0;
  font-size: 14px;
  line-height: 1;
}
.whisper-command {
  border: 1px solid rgba(127, 127, 127, 0.2);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: rgba(127, 127, 127, 0.04);
  transition: border-color 100ms linear;
}
.whisper-command.fired {
  border-color: #2ecc71;
  background: rgba(46, 204, 113, 0.08);
}
.whisper-command.disabled {
  opacity: 0.55;
}
.whisper-command.collapsed .whisper-command-body {
  display: none;
}
.whisper-command.dirty {
  border-color: #f1c40f;
}
.whisper-command-head {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 6px;
}
.whisper-command-head-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.whisper-command-name {
  font-weight: 600;
  font-size: 14px;
}
.whisper-command-meta {
  display: flex;
  gap: 6px;
  font-size: 11px;
}
.whisper-command-category {
  color: #3498db;
}
.whisper-fired-badge {
  color: #2ecc71;
  font-weight: 600;
}
.whisper-dirty-badge {
  color: #f1c40f;
  font-weight: 600;
}
.whisper-inline-check {
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.whisper-match-select,
.whisper-category-select {
  font-size: 12px;
  padding: 2px 6px;
}
.whisper-command-actions {
  display: flex;
  gap: 6px;
}
.whisper-command-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 10px;
}
.whisper-field {
  margin-top: 8px;
}
.whisper-param-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.whisper-param-table th,
.whisper-param-table td {
  border: 1px solid rgba(127, 127, 127, 0.2);
  padding: 4px 6px;
  text-align: left;
}
.whisper-param-table th {
  background: rgba(127, 127, 127, 0.08);
  font-weight: 600;
}
.whisper-param-table input,
.whisper-param-table select {
  width: 100%;
  font-size: 12px;
  padding: 2px 4px;
}
.whisper-add-param-row {
  margin-top: 6px;
}
.whisper-commands-foot {
  margin-top: 12px;
}
</style>