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
      <button class="whisper-advanced-toggle" :class="{ expanded: advancedOpen }" type="button" @click="toggleAdvanced">
        <span class="arrow">&#9656;</span>
        <span>Advanced</span>
      </button>
      <div v-if="advancedOpen" class="whisper-advanced-section">
        <div class="form-group whisper-slider-row">
          <label>Input gain: {{ gainDraft }}% <span class="whisper-hint">(applied live to the mic signal)</span></label>
          <input type="range" min="0" max="300" step="5" v-model.number="gainDraft" @change="commitAudioSettings" />
        </div>
        <div class="form-group whisper-slider-row">
          <label>Min utterance: {{ minUtteranceDraft }} ms <span class="whisper-hint">(utterances shorter than this are dropped as noise blips; default 350 ms)</span></label>
          <input type="range" min="0" max="2000" step="50" v-model.number="minUtteranceDraft" @change="commitAudioSettings" />
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Speech Model</h3>
      <p class="whisper-field-text">{{ modelStateText }}</p>
      <p class="whisper-model-path">{{ status.modelPath ?? 'No model selected' }}</p>
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
        <label>Custom model file <span class="whisper-hint">(absolute path to a single .bin ggml model file)</span></label>
        <div class="whisper-model-dir-row">
          <input type="text" v-model="modelPathDraft" placeholder="C:\path\to\ggml-tiny.en.bin" />
          <button class="btn btn-secondary btn-small" @click="applyModelDir">Apply</button>
          <button v-if="status.modelPath" class="btn btn-secondary btn-small" @click="clearModelPath">Clear</button>
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

      <div v-if="!hasCommands" class="whisper-empty">
        No commands yet. Click "Add Command" to create one.
      </div>

      <div
        v-for="command in commands"
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
          <button
            class="whisper-collapse-toggle"
            type="button"
            :class="{ expanded: !isCollapsed(command.id) }"
            :title="isCollapsed(command.id) ? 'Expand command' : 'Collapse command'"
            @click="toggleCollapse(command.id)"
          >
            <span class="arrow">&#9656;</span>
          </button>
          <div class="whisper-command-head-fields">
            <input
              type="text"
              v-model="command.name"
              class="whisper-command-name"
              placeholder="Command name"
              @input="fireInput(command.id)"
            />
            <div class="whisper-command-meta">
              <span v-if="firedRecently(command)" class="whisper-fired-badge">Fired ({{ firedRecently(command) }})</span>
              <span v-if="isDirty(command.id)" class="whisper-dirty-badge">{{ isSaving(command.id) ? 'Saving...' : 'Unsaved' }}</span>
            </div>
          </div>
          <label class="whisper-inline-check">
            <input type="checkbox" v-model="command.enabled" @change="fireInput(command.id)" /> Enabled
          </label>
          <select v-model="command.matchType" class="whisper-match-select" @change="fireInput(command.id)">
            <option value="contains">Contains</option>
            <option value="exact">Exact</option>
          </select>
          <div class="whisper-command-actions">
            <button v-if="isDirty(command.id)" class="btn btn-primary btn-small" :disabled="isSaving(command.id)" @click="saveBlock(command.id)">{{ isSaving(command.id) ? 'Saving...' : 'Save' }}</button>
            <button class="btn btn-secondary btn-small" @click="removeCommand(command)" title="Delete this command">Delete</button>
          </div>
        </div>

        <div class="whisper-command-body" v-show="!isCollapsed(command.id)">
          <div class="whisper-command-fields">
            <div class="form-group">
              <label>Trigger phrase</label>
              <input type="text" v-model="command.phrase" placeholder="e.g. lights on" @input="fireInput(command.id)" />
            </div>
            <div class="form-group">
              <label>Reverse phrase <span class="whisper-hint">(optional - sends reverse values)</span></label>
              <input type="text" v-model="command.reversePhrase" placeholder="e.g. lights off" @input="fireInput(command.id)" />
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
                    <input type="text" v-model="param.address" placeholder="/avatar/parameters/..." @input="fireInput(command.id)" />
                  </td>
                  <td>
                    <select :value="param.type" @change="onParamTypeChange(command.id, paramIndex, ($event.target as HTMLSelectElement).value as WhisperCommandParam['type'])">
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
                      @change="onBoolValueChange(command.id, paramIndex, ($event.target as HTMLSelectElement).value === 'true')"
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                    <input v-else type="text" v-model="param.value" placeholder="1" @input="fireInput(command.id)" />
                  </td>
                  <td>
                    <select
                      v-if="param.type === 'bool'"
                      :value="reverseBoolDisplay(param)"
                      @change="setReverseBool(command.id, paramIndex, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">Auto (inverted)</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                    <input v-else type="text" v-model="param.reverseValue" placeholder="(optional)" @input="fireInput(command.id)" />
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="whisper-add-param-row">
              <button class="btn btn-secondary btn-small" @click="addParam(command)">+ Add Parameter</button>
            </div>
          </div>
        </div>
      </div>

      <div class="whisper-commands-foot">
        <button class="btn btn-primary" @click="addCommand">+ Add Command</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Logic lives in the sibling WhisperPage.ts factory — keep this block thin.
import type { WhisperCommandParam } from '../composables/useWhisper'
import { createWhisperPageState } from './WhisperPage'
const {
  status,
  commands,
  autostart,
  transcript,
  inputLevel,
  gateOpen,
  downloadProgress,
  devices,
  lastSavedAt,
  refreshStatus,
  downloadModel,
  toggleCollapse,
  isDirty,
  isSaving,
  clearTranscript,
  fireInput,
  saveBlock,
  busy,
  preflightResult,
  showDiscardConfirm,
  minLevelDraft,
  gainDraft,
  minUtteranceDraft,
  modelDirDraft,
  modelDirError,
  modelPathDraft,
  advancedOpen,
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
  isCollapsed,
  toggleAdvanced,
  firedRecently,
  timeLabel,
  reverseBoolDisplay,
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
} = createWhisperPageState()
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
/* Bare inputs/selects in the command head + param table sit outside
   .form-group, so they miss the global form styling and render as
   default browser controls (white boxes) that clash with the page —
   most visibly in dark theme. Mirror the .form-group look here. */
.whisper-command-head input[type='text'],
.whisper-command-head select {
  padding: 8px 10px;
  border: 2px solid #ecf0f1;
  border-radius: 5px;
  font-size: 13px;
  background: #fff;
  color: #2c3e50;
  transition: background 0.3s ease, color 0.3s ease, border-color 0.3s ease;
}
.whisper-command-head input[type='text']:focus,
.whisper-command-head select:focus {
  outline: none;
  border-color: #3498db;
}
.whisper-command-head .whisper-command-name {
  width: 100%;
}
.whisper-command-head .whisper-match-select {
  width: auto;
  min-width: 110px;
}
/* Collapse/expand chevron on each command card — mirrors the sidebar
   Modules tree-toggle (App.vue) so the interaction feels consistent. */
.whisper-collapse-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
  transition: opacity 100ms linear, transform 100ms linear;
}
.whisper-collapse-toggle:hover {
  opacity: 1;
}
.whisper-collapse-toggle .arrow {
  display: inline-block;
  font-size: 13px;
  line-height: 1;
  transform: rotate(90deg);
  transition: transform 100ms linear;
}
.whisper-collapse-toggle:not(.expanded) .arrow {
  transform: rotate(0deg);
}
/* Advanced settings section under the Audio Input card — same chevron
   language as the command collapse toggles. */
.whisper-advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 4px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: inherit;
  opacity: 0.7;
  transition: opacity 100ms linear;
}
.whisper-advanced-toggle:hover {
  opacity: 1;
}
.whisper-advanced-toggle .arrow {
  display: inline-block;
  font-size: 12px;
  line-height: 1;
  transform: rotate(90deg);
  transition: transform 100ms linear;
}
.whisper-advanced-toggle:not(.expanded) .arrow {
  transform: rotate(0deg);
}
.whisper-advanced-section {
  border-left: 2px solid rgba(127, 127, 127, 0.25);
  padding-left: 12px;
  margin: 6px 0 4px 4px;
}
.whisper-command-meta {
  display: flex;
  gap: 6px;
  font-size: 11px;
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
.whisper-match-select {
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
  padding: 6px 8px;
  border: 2px solid #ecf0f1;
  border-radius: 4px;
  background: #fff;
  color: #2c3e50;
  transition: background 0.3s ease, color 0.3s ease, border-color 0.3s ease;
}
.whisper-param-table input:focus,
.whisper-param-table select:focus {
  outline: none;
  border-color: #3498db;
}
.whisper-add-param-row {
  margin-top: 6px;
}
.whisper-commands-foot {
  margin-top: 12px;
}

/* Dark-theme overrides — keep page styles co-located with their
   light-mode counterparts. Uses the same palette as `.card` +
   AutoStatus preset cards (bg #2b2b2b / border #454545 / text #ecf0f1). */
/* NOTE: the whole selector must live INSIDE :global(...) — writing
   `:global(body.dark-theme) .foo` makes the scoped-CSS compiler emit
   `body.dark-theme { ... }` with the descendant part dropped, so the
   overrides style <body> instead of the target elements and dark
   theme silently never applies. Verified against the compiled CSS in
   out/renderer/assets/WhisperPage-*.css. */
:global(body.dark-theme .whisper-commands-head h3) {
  color: #ecf0f1;
}
:global(body.dark-theme .whisper-commands-head p),
:global(body.dark-theme .whisper-hint),
:global(body.dark-theme .whisper-hint-block) {
  color: #95a5a6;
}
:global(body.dark-theme .whisper-field-text) {
  color: #ecf0f1;
}
:global(body.dark-theme .whisper-model-path) {
  color: #95a5a6;
}
:global(body.dark-theme .whisper-progress-label) {
  color: #95a5a6;
}
:global(body.dark-theme .whisper-error-text),
:global(body.dark-theme .whisper-progress-error) {
  color: #ff6b5b;
}
:global(body.dark-theme .whisper-empty) {
  color: #95a5a6;
}
:global(body.dark-theme .whisper-partial) {
  background: rgba(255, 255, 255, 0.05);
  color: #95a5a6;
}
:global(body.dark-theme .whisper-partial.active) {
  background: rgba(46, 204, 113, 0.12);
  color: #2ecc71;
}
:global(body.dark-theme .whisper-transcript) {
  background: rgba(255, 255, 255, 0.02);
  border-color: #454545;
}
:global(body.dark-theme .whisper-transcript-entry) {
  border-color: rgba(255, 255, 255, 0.06);
}
:global(body.dark-theme .whisper-transcript-time) {
  color: #95a5a6;
}
:global(body.dark-theme .whisper-transcript-text) {
  color: #ecf0f1;
}
:global(body.dark-theme .whisper-meter) {
  background: rgba(255, 255, 255, 0.08);
}
:global(body.dark-theme .whisper-meter-wrap > label) {
  color: #ecf0f1;
}
:global(body.dark-theme .whisper-meter-caption) {
  color: #95a5a6;
}
:global(body.dark-theme .whisper-meter-threshold) {
  background: rgba(255, 255, 255, 0.35);
}
:global(body.dark-theme .whisper-progress) {
  background: rgba(255, 255, 255, 0.08);
}
:global(body.dark-theme .whisper-command) {
  background: #2b2b2b;
  border-color: #454545;
}
:global(body.dark-theme .whisper-command.fired) {
  background: rgba(46, 204, 113, 0.12);
  border-color: #2ecc71;
}
:global(body.dark-theme .whisper-command.dirty) {
  border-color: #f1c40f;
}
:global(body.dark-theme .whisper-command-name) {
  color: #ecf0f1;
}
:global(body.dark-theme .whisper-collapse-toggle) {
  color: #ecf0f1;
}
:global(body.dark-theme .whisper-fired-badge) {
  color: #58d68d;
}
:global(body.dark-theme .whisper-dirty-badge) {
  color: #f4d03f;
}
:global(body.dark-theme .whisper-inline-check) {
  color: #ecf0f1;
}
:global(body.dark-theme .whisper-command-head input[type='text']),
:global(body.dark-theme .whisper-command-head select),
:global(body.dark-theme .whisper-param-table input),
:global(body.dark-theme .whisper-param-table select) {
  background: #2c3e50;
  color: #ecf0f1;
  border-color: #34495e;
}
:global(body.dark-theme .whisper-command-head input[type='text']:focus),
:global(body.dark-theme .whisper-command-head select:focus),
:global(body.dark-theme .whisper-param-table input:focus),
:global(body.dark-theme .whisper-param-table select:focus) {
  border-color: #3498db;
  background: #34495e;
}
:global(body.dark-theme .whisper-param-table th),
:global(body.dark-theme .whisper-param-table td) {
  border-color: #454545;
}
:global(body.dark-theme .whisper-param-table th) {
  background: rgba(255, 255, 255, 0.04);
  color: #ecf0f1;
}
:global(body.dark-theme .whisper-dirty-bar) {
  background: rgba(241, 196, 15, 0.1);
  color: #f4d03f;
}
:global(body.dark-theme .whisper-confirm-bar) {
  background: rgba(231, 76, 60, 0.1);
  color: #f1948a;
}
</style>