import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import { app } from 'electron'
import debug from '../../services/debugger'
import configManager from '../../services/configManager'
import type { WhisperConfig, WhisperCommand, WhisperCommandParam } from '../../services/configManager'
import { transcribe, resolveWhisperBinDir } from './whisperLoader'

// Whisper is utterance-based (not streaming like Vosk), so the audio pipeline
// accumulates PCM samples during gate-open and runs inference on gate close.
// All voice-command matching is engine-agnostic and lives in this class — same
// shape as VoskAddon so the UI feel is identical between engines.

const MODEL_NAME = 'ggml-tiny.en.bin'
// Whisper.cpp's official ggml model mirrors. Pinned to a release tag so the
// download URL is stable. See https://github.com/ggerganov/whisper.cpp/releases
const MODEL_URL = `https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.3/${MODEL_NAME}`
const MODEL_LIST_URL = 'https://github.com/ggerganov/whisper.cpp/tree/main/models'
const MODEL_MIN_BYTES = 50 * 1024 * 1024 // 50 MB sanity floor (tiny.en ~75 MB)
const GGML_MAGIC = 0x67676d6c // "lmgg" little-endian — first 4 bytes of every ggml file

// Noise gate holds open for GATE_HOLD_MS after input drops below threshold so
// word tails aren't clipped. Mirrors VoskAddon's behaviour.
const GATE_HOLD_MS = 500
const MAX_QUEUED_CHUNKS = 50
// Whisper needs at least ~0.5 s of audio to bother transcribing. Anything
// shorter is treated as a noise blip and dropped.
const MIN_UTTERANCE_MS = 350

// Resolves the directory that contains whisper.node + whisper.dll + ggml*.dll.
// Lookup order (Windows packaged build):
//   1. <exe dir>/bundledLibs/whisper  — bundled beside the .exe by extraResources
//   2. <projectRoot>/build/bundledLibs/whisper  — dev fallback
// (Non-Windows: the package's own prebuilt binaries in node_modules are loaded
//  by the npm package's shim — no workaround needed.)
export function preflightWhisper(): { ok: boolean; bundledLibsOk: boolean; dllPath: string | null; lastError: string | null } {
  const binDir = resolveWhisperBinDir()
  if (!binDir) {
    return {
      ok: false,
      bundledLibsOk: false,
      dllPath: null,
      lastError: 'No bundled whisper.node was found. Reinstall the application to restore the speech recognition libraries.'
    }
  }
  const nodePath = path.join(binDir, 'whisper.node')
  if (!fs.existsSync(nodePath)) {
    return {
      ok: false,
      bundledLibsOk: true,
      dllPath: nodePath,
      lastError: 'whisper.node was not found in the bundled libs directory.'
    }
  }
  return { ok: true, bundledLibsOk: true, dllPath: nodePath, lastError: null }
}

interface OscService {
  isListening: boolean
  sendMessage(address: string, value: unknown, type: string): boolean
}

export type WhisperModelState = 'missing' | 'invalid' | 'downloading' | 'extracting' | 'ready'
export type WhisperEngineState = 'stopped' | 'loading-model' | 'running' | 'error'

export interface WhisperResultEvent {
  isFinal: boolean
  text: string
  confidence: number
  matchedCommandId?: string
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

export interface WhisperCaptureControl {
  action: 'start' | 'stop' | 'update'
  deviceId?: string | null
  gain?: number
}

class WhisperAddon {
  enabled: boolean
  engineState: WhisperEngineState
  lastError: string | null
  config: WhisperConfig
  oscService: OscService | null
  onStatusChange: ((status: ReturnType<WhisperAddon['getStatus']>) => void) | null
  onResult: ((result: WhisperResultEvent) => void) | null
  onCaptureControl: ((control: WhisperCaptureControl) => void) | null
  onDownloadProgress: ((progress: WhisperDownloadProgress) => void) | null

  // Utterance accumulator. While gate is open, every accepted chunk is appended.
  // On gate close, the buffer is sent to whisper::transcribe and cleared.
  private utteranceBuffer: Int16Array[] = []
  private utteranceSampleRate: number | null = null
  private utteranceLengthSamples: number

  private processingChain: Promise<void>
  private queuedChunks: number
  private gateOpenUntil: number
  private hasPendingUtterance: boolean
  private downloading: boolean

  constructor() {
    this.enabled = false
    this.engineState = 'stopped'
    this.lastError = null
    this.config = this.loadConfig()
    this.oscService = null
    this.onStatusChange = null
    this.onResult = null
    this.onCaptureControl = null
    this.onDownloadProgress = null
    this.utteranceBuffer = []
    this.utteranceSampleRate = null
    this.utteranceLengthSamples = 0
    this.processingChain = Promise.resolve()
    this.queuedChunks = 0
    this.gateOpenUntil = 0
    this.hasPendingUtterance = false
    this.downloading = false
    debug.info('Whisper addon initialized')
  }

  setStatusChangeCallback(callback: ((status: ReturnType<WhisperAddon['getStatus']>) => void) | null): void {
    this.onStatusChange = callback
  }
  setResultCallback(callback: ((result: WhisperResultEvent) => void) | null): void {
    this.onResult = callback
  }
  setCaptureControlCallback(callback: ((control: WhisperCaptureControl) => void) | null): void {
    this.onCaptureControl = callback
  }
  setDownloadProgressCallback(callback: ((progress: WhisperDownloadProgress) => void) | null): void {
    this.onDownloadProgress = callback
  }
  notifyStatusChange(): void {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(this.getStatus())
    }
  }

  loadConfig(): WhisperConfig {
    try {
      const whisperConfig = configManager.getWhisperConfig()
      if (whisperConfig) {
        debug.info('Whisper config loaded from config manager')
        return {
          modelDir: whisperConfig.modelDir ?? null,
          inputDeviceId: whisperConfig.inputDeviceId ?? null,
          minInputLevel: typeof whisperConfig.minInputLevel === 'number' ? whisperConfig.minInputLevel : 0,
          inputGain: typeof whisperConfig.inputGain === 'number' ? whisperConfig.inputGain : 1,
          minUtteranceMs: typeof whisperConfig.minUtteranceMs === 'number' ? whisperConfig.minUtteranceMs : MIN_UTTERANCE_MS,
          categories: Array.isArray(whisperConfig.categories) ? whisperConfig.categories : [],
          commands: Array.isArray(whisperConfig.commands) ? whisperConfig.commands : []
        }
      }
    } catch (error) {
      debug.logError(`Failed to load Whisper config: ${(error as Error).message}`)
    }
    return {
      modelDir: null,
      inputDeviceId: null,
      minInputLevel: 0,
      inputGain: 1,
      minUtteranceMs: MIN_UTTERANCE_MS,
      categories: [],
      commands: []
    }
  }
  saveConfig(): void {
    try {
      configManager.updateWhisperConfig(this.config)
      debug.info('Whisper config saved via config manager')
    } catch (error) {
      debug.logError(`Failed to save Whisper config: ${(error as Error).message}`)
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  // --- Model management ---

  defaultModelDir(): string {
    return path.join(app.getPath('userData'), 'whisper-models', MODEL_NAME)
  }
  effectiveModelDir(): string {
    return this.config.modelDir || this.defaultModelDir()
  }
  // A ggml model is a single file. Validate by checking size + magic header.
  isModelDirValid(filePath: string): boolean {
    try {
      if (!filePath || !fs.existsSync(filePath)) return false
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size < MODEL_MIN_BYTES) return false
      const fd = fs.openSync(filePath, 'r')
      try {
        const buf = Buffer.alloc(4)
        fs.readSync(fd, buf, 0, 4, 0)
        return buf.readUInt32LE(0) === GGML_MAGIC
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return false
    }
  }
  getModelState(): WhisperModelState {
    if (this.downloading) return 'downloading'
    const file = this.effectiveModelDir()
    if (!fs.existsSync(file)) return 'missing'
    return this.isModelDirValid(file) ? 'ready' : 'invalid'
  }

  async downloadModel(): Promise<{ success: boolean; error?: string }> {
    if (this.downloading) {
      return { success: false, error: 'Download already in progress' }
    }
    this.downloading = true
    this.notifyStatusChange()
    const modelFile = this.defaultModelDir()
    try {
      fs.mkdirSync(path.dirname(modelFile), { recursive: true })
      debug.info(`Whisper: downloading model from ${MODEL_URL}`)
      await this.downloadFile(MODEL_URL, modelFile)
      if (!this.isModelDirValid(modelFile)) {
        throw new Error('Downloaded model file failed validation (size or ggml magic mismatch)')
      }
      this.config.modelDir = modelFile
      this.saveConfig()
      this.downloading = false
      this.onDownloadProgress?.({ state: 'done', percent: 100, downloadedBytes: 0, totalBytes: 0 })
      this.notifyStatusChange()
      debug.info(`Whisper: model ready at ${modelFile}`)
      return { success: true }
    } catch (error) {
      const message = (error as Error).message
      this.downloading = false
      try { fs.rmSync(modelFile, { force: true }) } catch { /* ignore */ }
      this.lastError = `Model download failed: ${message}`
      this.onDownloadProgress?.({ state: 'error', percent: 0, downloadedBytes: 0, totalBytes: 0, error: message })
      this.notifyStatusChange()
      debug.logError(`Whisper model download failed: ${message}`)
      return { success: false, error: message }
    }
  }

  private downloadFile(url: string, destination: string, redirectsLeft = 5): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'))
            return
          }
          this.downloadFile(new URL(response.headers.location, url).toString(), destination, redirectsLeft - 1).then(resolve, reject)
          return
        }
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedBytes = 0
        let lastProgressAt = 0
        const fileStream = fs.createWriteStream(destination)
        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length
          const now = Date.now()
          if (now - lastProgressAt > 250) {
            lastProgressAt = now
            this.onDownloadProgress?.({
              state: 'downloading',
              percent: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
              downloadedBytes,
              totalBytes
            })
          }
        })
        response.pipe(fileStream)
        fileStream.on('finish', () => fileStream.close(() => resolve()))
        fileStream.on('error', (err) => {
          fs.rmSync(destination, { force: true })
          reject(err)
        })
        response.on('error', reject)
      })
      request.on('error', reject)
    })
  }

  getModelListUrl(): string {
    return MODEL_LIST_URL
  }

  setModelDir(file: string | null): { success: boolean; error?: string } {
    if (file && !this.isModelDirValid(file)) {
      return { success: false, error: 'File is not a valid Whisper ggml model (size or ggml magic mismatch)' }
    }
    this.config.modelDir = file
    this.saveConfig()
    this.notifyStatusChange()
    return { success: true }
  }

  // --- Engine lifecycle ---

  start(oscService: OscService | null = null): boolean {
    if (this.enabled) {
      debug.warn('Whisper addon already running')
      return true
    }
    if (!preflightWhisper().ok) {
      const pf = preflightWhisper()
      this.lastError = pf.lastError ?? 'Native Whisper library is not available'
      this.engineState = 'error'
      this.notifyStatusChange()
      debug.logError(`Cannot start Whisper: native library unavailable (${pf.lastError ?? 'no detail'})`)
      return false
    }
    const modelFile = this.effectiveModelDir()
    if (!this.isModelDirValid(modelFile)) {
      this.lastError = 'No valid model found. Download the default model or set a model file.'
      this.engineState = 'error'
      this.notifyStatusChange()
      debug.logError(`Cannot start Whisper: invalid model file ${modelFile}`)
      return false
    }
    this.enabled = true
    this.oscService = oscService
    this.lastError = null
    this.engineState = 'loading-model'
    this.gateOpenUntil = 0
    this.hasPendingUtterance = false
    this.utteranceBuffer = []
    this.utteranceLengthSamples = 0
    this.notifyStatusChange()
    // Whisper doesn't need a per-start model load (the addon lazy-loads on first
    // transcribe); but we still flip to running so the renderer can flip the toggle.
    // A short setImmediate delay lets the loading-model status reach the renderer first.
    setImmediate(() => {
      if (!this.enabled) return
      this.engineState = 'running'
      this.notifyStatusChange()
      this.onCaptureControl?.({ action: 'start', deviceId: this.config.inputDeviceId, gain: this.config.inputGain })
      debug.info(`Whisper addon started with model ${modelFile}`)
    })
    return true
  }

  stop(): void {
    if (!this.enabled && this.engineState === 'stopped') {
      debug.info('Whisper addon already stopped')
      return
    }
    debug.info('Whisper addon stopping...')
    this.enabled = false
    this.onCaptureControl?.({ action: 'stop' })
    // Wait for any in-flight inference to finish, then drop the accumulated buffer.
    this.processingChain = this.processingChain.then(() => {
      this.utteranceBuffer = []
      this.utteranceLengthSamples = 0
      this.utteranceSampleRate = null
    })
    this.engineState = 'stopped'
    this.lastError = null
    this.hasPendingUtterance = false
    this.notifyStatusChange()
    debug.info('Whisper addon stopped successfully')
  }

  // --- Audio path ---

  acceptAudio(chunk: Buffer, sampleRate: number, level: number): void {
    if (!this.enabled || this.engineState !== 'running') return

    const minLevel = this.config.minInputLevel || 0
    const now = Date.now()
    let gateOpen: boolean
    if (minLevel > 0) {
      if (level >= minLevel) {
        this.gateOpenUntil = now + GATE_HOLD_MS
        gateOpen = true
      } else {
        gateOpen = now < this.gateOpenUntil
      }
      if (!gateOpen) {
        // Gate just closed — flush whatever we have.
        if (this.hasPendingUtterance) {
          this.enqueue(() => this.flushUtterance())
        }
        return
      }
    } else {
      gateOpen = true
    }

    if (this.queuedChunks >= MAX_QUEUED_CHUNKS) {
      debug.warn('Whisper: audio queue full, dropping chunk')
      return
    }
    this.enqueue(() => this.appendToUtterance(chunk, sampleRate))
  }

  private enqueue(work: () => void): void {
    this.queuedChunks++
    this.processingChain = this.processingChain
      .then(() => {
        if (this.enabled) work()
      })
      .catch((error) => {
        debug.logError(`Whisper audio processing error: ${(error as Error).message}`)
      })
      .finally(() => {
        this.queuedChunks--
      })
  }

  private appendToUtterance(chunk: Buffer, sampleRate: number): void {
    // Capture rate may differ from how we record; track the first chunk's rate
    // and reuse it for inference (sample rate consistency is required).
    if (this.utteranceSampleRate === null) {
      this.utteranceSampleRate = sampleRate
    } else if (this.utteranceSampleRate !== sampleRate) {
      // Mid-utterance device swap: drop the old buffer (re-init on the next chunk)
      debug.warn('Whisper: sample-rate changed mid-utterance, resetting buffer')
      this.utteranceBuffer = []
      this.utteranceLengthSamples = 0
      this.utteranceSampleRate = sampleRate
    }
    // chunk is Int16Array buffer (from the worklet) — store a copy to keep the
    // buffer stable across the async inference call.
    const copy = new Int16Array(chunk.length / 2)
    copy.set(new Int16Array(chunk.buffer, chunk.byteOffset, copy.length))
    this.utteranceBuffer.push(copy)
    this.utteranceLengthSamples += copy.length
    this.hasPendingUtterance = true
  }

  private async flushUtterance(): Promise<void> {
    if (!this.utteranceSampleRate || this.utteranceBuffer.length === 0) return
    const sampleRate = this.utteranceSampleRate
    const totalSamples = this.utteranceLengthSamples
    // Snapshot + reset the accumulator before the (slow) inference starts so
    // the next utterance isn't blocked behind this one.
    const flat = new Int16Array(totalSamples)
    let offset = 0
    for (const part of this.utteranceBuffer) {
      flat.set(part, offset)
      offset += part.length
    }
    this.utteranceBuffer = []
    this.utteranceLengthSamples = 0
    this.utteranceSampleRate = null
    this.hasPendingUtterance = false

    const durationMs = (totalSamples / sampleRate) * 1000
    if (durationMs < this.config.minUtteranceMs) {
      debug.info(`Whisper dropped utterance (${durationMs.toFixed(0)} ms < min ${this.config.minUtteranceMs} ms)`)
      return
    }
    // Convert Int16 to Float32 in [-1, 1] — whisper.cpp wants pcmf32 mono.
    const pcmf32 = new Float32Array(totalSamples)
    for (let i = 0; i < totalSamples; i++) {
      pcmf32[i] = flat[i] < 0 ? flat[i] / 0x8000 : flat[i] / 0x7fff
    }

    const modelFile = this.effectiveModelDir()
    try {
      const result = await transcribe({
        model: modelFile,
        pcmf32,
        language: 'en'
      })
      const text = (result.fullText || '').trim()
      if (!text) {
        debug.info('Whisper: no speech detected in utterance')
        return
      }
      // Whisper doesn't emit per-token confidence, so we don't apply a per-confidence
      // filter here. The minimum-utterance-length filter in flushUtterance() already
      // drops noise blips. Future: add a length-based "too short = probably noise" filter.
      debug.info(`Whisper recognised '${text}'`)
      const match = this.matchCommand(text)
      this.onResult?.({
        isFinal: true,
        text,
        confidence: 1,
        matchedCommandId: match?.command.id,
        matchedCommandName: match?.command.name,
        matchedDirection: match?.direction
      })
    } catch (error) {
      const message = (error as Error).message
      this.lastError = `Inference failed: ${message}`
      this.notifyStatusChange()
      debug.logError(`Whisper inference failed: ${message}`)
    }
  }

  // --- Voice commands (engine-agnostic; identical to VoskAddon) ---

  private matchCommand(text: string): { command: WhisperCommand; direction: 'forward' | 'reverse' } | null {
    const spoken = text.toLowerCase().trim()
    for (const command of this.config.commands || []) {
      if (!command.enabled || !command.parameters?.length) continue
      if (this.phraseMatches(spoken, command.phrase, command.matchType)) {
        this.executeCommand(command, 'forward')
        return { command, direction: 'forward' }
      }
      if (command.reversePhrase && this.phraseMatches(spoken, command.reversePhrase, command.matchType)) {
        this.executeCommand(command, 'reverse')
        return { command, direction: 'reverse' }
      }
    }
    return null
  }

  private phraseMatches(spoken: string, phrase: string, matchType: 'exact' | 'contains'): boolean {
    const target = (phrase || '').toLowerCase().trim()
    if (!target) return false
    return matchType === 'exact' ? spoken === target : spoken.includes(target)
  }

  private executeCommand(command: WhisperCommand, direction: 'forward' | 'reverse'): void {
    if (!this.oscService || !this.oscService.isListening) {
      debug.warn(`Whisper command '${command.name}' matched but OSC service is not available`)
      return
    }
    for (const param of command.parameters) {
      const value = direction === 'forward' ? param.value : this.reverseValueFor(param)
      if (value === undefined) continue
      this.oscService.sendMessage(param.address, value, param.type)
    }
    debug.info(`Whisper command '${command.name}' fired (${direction}, ${command.parameters.length} parameter(s))`)
  }

  private reverseValueFor(param: WhisperCommandParam): string | number | boolean | undefined {
    if (param.reverseValue !== undefined && param.reverseValue !== null && param.reverseValue !== '') {
      return param.reverseValue
    }
    if (param.type === 'bool') return !param.value
    return undefined
  }

  // --- Settings ---

  setInputDevice(deviceId: string | null): boolean {
    this.config.inputDeviceId = deviceId
    this.saveConfig()
    if (this.enabled && this.engineState === 'running') {
      this.onCaptureControl?.({ action: 'start', deviceId, gain: this.config.inputGain })
    }
    this.notifyStatusChange()
    return true
  }

  updateConfig(partial: Partial<WhisperConfig>): boolean {
    if (partial.minInputLevel !== undefined) {
      this.config.minInputLevel = Math.max(0, Math.min(100, Number(partial.minInputLevel) || 0))
    }
    if (partial.inputGain !== undefined) {
      this.config.inputGain = Math.max(0, Math.min(3, Number(partial.inputGain) || 0))
      if (this.enabled && this.engineState === 'running') {
        this.onCaptureControl?.({ action: 'update', gain: this.config.inputGain })
      }
    }
    if (partial.minUtteranceMs !== undefined) {
      this.config.minUtteranceMs = Math.max(0, Math.min(5000, Number(partial.minUtteranceMs) || 0))
    }
    if (partial.categories !== undefined) {
      if (!Array.isArray(partial.categories)) return false
      const seen = new Set<string>()
      const cleaned: string[] = []
      for (const raw of partial.categories) {
        const name = String(raw || '').trim()
        if (!name || seen.has(name)) continue
        seen.add(name)
        cleaned.push(name)
      }
      this.config.categories = cleaned
    }
    if (partial.inputDeviceId !== undefined) {
      return this.setInputDevice(partial.inputDeviceId)
    }
    if (partial.commands !== undefined) {
      this.config.commands = partial.commands
    }
    if (partial.modelDir !== undefined) {
      const result = this.setModelDir(partial.modelDir)
      if (!result.success) return false
    }
    this.saveConfig()
    this.notifyStatusChange()
    return true
  }

  getConfig(): WhisperConfig {
    return {
      ...this.config,
      categories: [...(this.config.categories || [])],
      commands: [...(this.config.commands || [])]
    }
  }

  getStatus() {
    const pf = preflightWhisper()
    return {
      enabled: this.enabled,
      engineState: this.engineState,
      modelState: this.getModelState(),
      modelDir: this.effectiveModelDir(),
      usingDefaultModel: !this.config.modelDir || this.config.modelDir === this.defaultModelDir(),
      modelListUrl: MODEL_LIST_URL,
      sampleRate: this.utteranceSampleRate,
      inputDeviceId: this.config.inputDeviceId,
      minInputLevel: this.config.minInputLevel,
      inputGain: this.config.inputGain,
      minUtteranceMs: this.config.minUtteranceMs,
      bundledLibsOk: pf.bundledLibsOk,
      nativeLibraryLoaded: pf.ok,
      lastError: this.lastError
    }
  }

  // Public preflight — runs synchronously and tells the renderer whether the
  // native library can be loaded right now. Mirrors VoskAddon's preflight.
  preflight(): { ok: boolean; bundledLibsOk: boolean; dllPath: string | null; lastError: string | null } {
    return preflightWhisper()
  }
}

export default WhisperAddon