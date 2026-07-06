import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { app } from 'electron'
import debug from '../../services/debugger'
import configManager from '../../services/configManager'
import type { VoskConfig, VoskCommand, VoskCommandParam } from '../../services/configManager'

// Ported from VRCOSC's Vosk-era VoskSpeechEngine (removed upstream in "Replace Vosk with Whisper"):
// recognizer at capture sample rate, setWords(true), partial {partial} / final {text, result:[{conf}]},
// average word confidence, validity filter (drop "huh"), reset after every final result.

const MODEL_NAME = 'vosk-model-small-en-us-0.15'
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`
const MODEL_LIST_URL = 'https://alphacephei.com/vosk/models'
const GATE_HOLD_MS = 500
const MAX_QUEUED_CHUNKS = 50
const VOSK_BIN_DIR = `bin-${process.platform}-${process.arch}`
const VOSK_BIN_FILENAMES = ['libvosk.dll', 'libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'libwinpthread-1.dll']

// Resolve the directory that contains libvosk.dll + its dependencies. In dev that's
// `node_modules/vosk-koffi/bin-<platform>-<arch>`. In the packaged build the same
// files live at `process.resourcesPath/bundledLibs` (copied there via electron-builder
// extraResources — they MUST live next to the app .exe so the Windows DLL loader
// resolves the dependency chain without relying on the runtime-modified Path).
function resolveVoskBinDir(): string | null {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'bundledLibs')
    if (fs.existsSync(path.join(bundled, 'libvosk.dll'))) {
      return bundled
    }
  }
  // dev / unpacked layout: module-relative path through require.resolve
  try {
    const entry = require.resolve('vosk-koffi')
    const dir = path.resolve(path.dirname(entry), '..', VOSK_BIN_DIR)
    if (fs.existsSync(path.join(dir, 'libvosk.dll'))) return dir
  } catch {
    /* fall through */
  }
  return null
}

function ensurePathIncludes(dir: string): void {
  // The koffi loader mutates process.env.Path itself, but we extend it here too as
  // belt-and-braces for the dependency DLLs on Windows. Set both casings because the
  // Win32 loader is case-sensitive about which env var it reads in some configurations.
  const sep = path.delimiter
  if (!process.env.Path || !process.env.Path.split(sep).includes(dir)) {
    process.env.Path = dir + sep + (process.env.Path ?? '')
  }
  if (!process.env.PATH || !process.env.PATH.split(sep).includes(dir)) {
    process.env.PATH = dir + sep + (process.env.PATH ?? '')
  }
}

// `vosk-koffi` declares opaque koffi types on libvosk.dll at module-require time.
// Re-requiring on every engine start would trigger "Duplicate type name 'VoskModel'".
// Hoist the require to module-load time so it happens exactly once per process.
const voskModule: VoskModule | null = (() => {
  const binDir = resolveVoskBinDir()
  if (!binDir) {
    debug.logError(`Vosk: no bundled libvosk.dll found (looked in process.resourcesPath/bundledLibs and the dev node_modules layout)`)
    return null
  }
  if (process.platform === 'win32') ensurePathIncludes(binDir)
  try {
    const mod = require('vosk-koffi') as VoskModule
    try { mod.setLogLevel(-1) } catch { /* not fatal */ }
    debug.info(`Vosk: vosk-koffi loaded from ${binDir}`)
    return mod
  } catch (err) {
    debug.logError(`Vosk: failed to load vosk-koffi: ${(err as Error).message}`)
    return null
  }
})()

export function preflightVosk(): { ok: boolean; bundledLibsOk: boolean; dllPath: string | null; lastError: string | null } {
  const binDir = resolveVoskBinDir()
  if (!binDir) {
    return {
      ok: false,
      bundledLibsOk: false,
      dllPath: null,
      lastError: 'No bundled libvosk.dll was found. Reinstall the application to restore the speech recognition libraries.'
    }
  }
  if (!voskModule) {
    return {
      ok: false,
      bundledLibsOk: true,
      dllPath: path.join(binDir, 'libvosk.dll'),
      lastError: 'vosk-koffi could not be loaded. Check the application logs for the underlying DLL error.'
    }
  }
  return { ok: true, bundledLibsOk: true, dllPath: path.join(binDir, 'libvosk.dll'), lastError: null }
}

interface OscService {
  isListening: boolean
  sendMessage(address: string, value: unknown, type: string): boolean
}

type VoskModule = typeof import('vosk-koffi')

interface VoskWordResult {
  conf?: number
  word?: string
}

interface VoskFinalJson {
  text?: string
  result?: VoskWordResult[]
}

interface VoskPartialJson {
  partial?: string
}

export type VoskModelState = 'missing' | 'invalid' | 'downloading' | 'extracting' | 'ready'
export type VoskEngineState = 'stopped' | 'loading-model' | 'running' | 'error'

export interface VoskResultEvent {
  isFinal: boolean
  text: string
  confidence: number
  matchedCommandId?: string
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

export interface VoskCaptureControl {
  action: 'start' | 'stop' | 'update'
  deviceId?: string | null
  gain?: number
}

class VoskAddon {
  enabled: boolean
  engineState: VoskEngineState
  lastError: string | null
  config: VoskConfig
  oscService: OscService | null
  onStatusChange: ((status: ReturnType<VoskAddon['getStatus']>) => void) | null
  onResult: ((result: VoskResultEvent) => void) | null
  onCaptureControl: ((control: VoskCaptureControl) => void) | null
  onDownloadProgress: ((progress: VoskDownloadProgress) => void) | null

  private model: InstanceType<VoskModule['Model']> | null
  private recognizer: { free(): void; setWords(w: boolean): unknown; acceptWaveform(b: Buffer): boolean; result(): unknown; partialResult(): unknown; finalResult(): unknown; reset(): unknown } | null
  private recognizerSampleRate: number | null
  private processingChain: Promise<void>
  private queuedChunks: number
  private gateOpenUntil: number
  private hasPendingSpeech: boolean
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
    this.model = null
    this.recognizer = null
    this.recognizerSampleRate = null
    this.processingChain = Promise.resolve()
    this.queuedChunks = 0
    this.gateOpenUntil = 0
    this.hasPendingSpeech = false
    this.downloading = false
    debug.info('Vosk addon initialized')
  }

  setStatusChangeCallback(callback: ((status: ReturnType<VoskAddon['getStatus']>) => void) | null): void {
    this.onStatusChange = callback
  }
  setResultCallback(callback: ((result: VoskResultEvent) => void) | null): void {
    this.onResult = callback
  }
  setCaptureControlCallback(callback: ((control: VoskCaptureControl) => void) | null): void {
    this.onCaptureControl = callback
  }
  setDownloadProgressCallback(callback: ((progress: VoskDownloadProgress) => void) | null): void {
    this.onDownloadProgress = callback
  }
  notifyStatusChange(): void {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(this.getStatus())
    }
  }

  loadConfig(): VoskConfig {
    try {
      const voskConfig = configManager.getVoskConfig()
      if (voskConfig) {
        debug.info('Vosk config loaded from config manager')
        return {
          modelDir: voskConfig.modelDir ?? null,
          inputDeviceId: voskConfig.inputDeviceId ?? null,
          minInputLevel: typeof voskConfig.minInputLevel === 'number' ? voskConfig.minInputLevel : 0,
          inputGain: typeof voskConfig.inputGain === 'number' ? voskConfig.inputGain : 1,
          minConfidence: typeof voskConfig.minConfidence === 'number' ? voskConfig.minConfidence : 0,
          categories: Array.isArray(voskConfig.categories) ? voskConfig.categories : [],
          commands: Array.isArray(voskConfig.commands) ? voskConfig.commands : []
        }
      }
    } catch (error) {
      debug.logError(`Failed to load Vosk config: ${(error as Error).message}`)
    }
    return {
      modelDir: null,
      inputDeviceId: null,
      minInputLevel: 0,
      inputGain: 1,
      minConfidence: 0,
      categories: [],
      commands: []
    }
  }
  saveConfig(): void {
    try {
      configManager.updateVoskConfig(this.config)
      debug.info('Vosk config saved via config manager')
    } catch (error) {
      debug.logError(`Failed to save Vosk config: ${(error as Error).message}`)
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  // --- Model management ---

  defaultModelDir(): string {
    return path.join(app.getPath('userData'), 'vosk-models', MODEL_NAME)
  }
  effectiveModelDir(): string {
    return this.config.modelDir || this.defaultModelDir()
  }
  // VRCOSC's validity check: the model directory must contain an "am" subdirectory
  isModelDirValid(dir: string): boolean {
    try {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false
      const subdirs = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
      return subdirs.some(name => name === 'am' || name.endsWith('am'))
    } catch {
      return false
    }
  }
  getModelState(): VoskModelState {
    if (this.downloading) return 'downloading'
    const dir = this.effectiveModelDir()
    if (!fs.existsSync(dir)) return 'missing'
    return this.isModelDirValid(dir) ? 'ready' : 'invalid'
  }

  async downloadModel(): Promise<{ success: boolean; error?: string }> {
    if (this.downloading) {
      return { success: false, error: 'Download already in progress' }
    }
    this.downloading = true
    this.notifyStatusChange()
    const modelsRoot = path.join(app.getPath('userData'), 'vosk-models')
    const zipPath = path.join(modelsRoot, `${MODEL_NAME}.zip`)
    try {
      fs.mkdirSync(modelsRoot, { recursive: true })
      debug.info(`Vosk: downloading model from ${MODEL_URL}`)
      await this.downloadFile(MODEL_URL, zipPath)
      this.onDownloadProgress?.({ state: 'extracting', percent: 100, downloadedBytes: 0, totalBytes: 0 })
      debug.info('Vosk: extracting model archive')
      const { default: extractZip } = await import('extract-zip')
      await extractZip(zipPath, { dir: modelsRoot })
      fs.rmSync(zipPath, { force: true })
      const modelDir = path.join(modelsRoot, MODEL_NAME)
      if (!this.isModelDirValid(modelDir)) {
        throw new Error('Extracted model directory is invalid (missing "am" subdirectory)')
      }
      this.config.modelDir = modelDir
      this.saveConfig()
      this.downloading = false
      this.onDownloadProgress?.({ state: 'done', percent: 100, downloadedBytes: 0, totalBytes: 0 })
      this.notifyStatusChange()
      debug.info(`Vosk: model ready at ${modelDir}`)
      return { success: true }
    } catch (error) {
      const message = (error as Error).message
      this.downloading = false
      fs.rmSync(zipPath, { force: true })
      this.lastError = `Model download failed: ${message}`
      this.onDownloadProgress?.({ state: 'error', percent: 0, downloadedBytes: 0, totalBytes: 0, error: message })
      this.notifyStatusChange()
      debug.logError(`Vosk model download failed: ${message}`)
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

  setModelDir(dir: string | null): { success: boolean; error?: string } {
    if (dir && !this.isModelDirValid(dir)) {
      return { success: false, error: 'Directory is not a valid Vosk model (missing "am" subdirectory)' }
    }
    this.config.modelDir = dir
    this.saveConfig()
    this.notifyStatusChange()
    return { success: true }
  }

  // --- Engine lifecycle ---

  start(oscService: OscService | null = null): boolean {
    if (this.enabled) {
      debug.warn('Vosk addon already running')
      return true
    }
    if (!voskModule) {
      // vosk-koffi failed to load at process start — surface a precise lastError
      const pf = preflightVosk()
      this.lastError = pf.lastError ?? 'Native Vosk library is not available'
      this.engineState = 'error'
      this.notifyStatusChange()
      debug.logError(`Cannot start Vosk: native library unavailable (${pf.lastError ?? 'no detail'})`)
      return false
    }
    const modelDir = this.effectiveModelDir()
    if (!this.isModelDirValid(modelDir)) {
      this.lastError = 'No valid model found. Download the default model or set a model directory.'
      this.engineState = 'error'
      this.notifyStatusChange()
      debug.logError(`Cannot start Vosk: invalid model directory ${modelDir}`)
      return false
    }
    this.enabled = true
    this.oscService = oscService
    this.lastError = null
    this.engineState = 'loading-model'
    this.gateOpenUntil = 0
    this.hasPendingSpeech = false
    this.notifyStatusChange()
    // Model load is a blocking FFI call that can take seconds — defer it so the
    // status update reaches the renderer first (VRCOSC ran this on a background task)
    setImmediate(() => {
      try {
        if (!this.enabled) return
        this.model = new voskModule.Model(modelDir)
        this.engineState = 'running'
        this.notifyStatusChange()
        this.onCaptureControl?.({ action: 'start', deviceId: this.config.inputDeviceId, gain: this.config.inputGain })
        debug.info(`Vosk addon started with model ${modelDir}`)
      } catch (error) {
        const message = (error as Error).message
        const binDir = resolveVoskBinDir()
        this.lastError = `Failed to load model: ${message}` + (binDir ? ` (libvosk.dll expected at ${path.join(binDir, 'libvosk.dll')})` : '')
        this.engineState = 'error'
        this.enabled = false
        this.model = null
        this.notifyStatusChange()
        debug.logError(`Vosk model load failed: ${message} (binDir=${binDir ?? 'unknown'}, resourcesPath=${process.resourcesPath})`)
      }
    })
    return true
  }

  stop(): void {
    if (!this.enabled && this.engineState === 'stopped') {
      debug.info('Vosk addon already stopped')
      return
    }
    debug.info('Vosk addon stopping...')
    this.enabled = false
    this.onCaptureControl?.({ action: 'stop' })
    // Wait for any queued audio to drain before freeing native handles
    this.processingChain = this.processingChain.then(() => {
      this.freeRecognizer()
      if (this.model) {
        try { this.model.free() } catch { /* already freed */ }
        this.model = null
      }
    })
    this.engineState = 'stopped'
    this.lastError = null
    this.hasPendingSpeech = false
    this.notifyStatusChange()
    debug.info('Vosk addon stopped successfully')
  }

  private freeRecognizer(): void {
    if (this.recognizer) {
      try { this.recognizer.free() } catch { /* already freed */ }
      this.recognizer = null
      this.recognizerSampleRate = null
    }
  }

  // --- Audio path ---

  acceptAudio(chunk: Buffer, sampleRate: number, level: number): void {
    if (!this.enabled || this.engineState !== 'running' || !this.model) return

    // Noise gate: only feed the recognizer while input is above the configured
    // level, holding open briefly after it drops so word tails aren't clipped
    const minLevel = this.config.minInputLevel || 0
    if (minLevel > 0) {
      const now = Date.now()
      if (level >= minLevel) {
        this.gateOpenUntil = now + GATE_HOLD_MS
      }
      if (now >= this.gateOpenUntil) {
        if (this.hasPendingSpeech) {
          this.enqueue(() => this.flushPendingSpeech())
        }
        return
      }
    }

    if (this.queuedChunks >= MAX_QUEUED_CHUNKS) {
      debug.warn('Vosk: audio queue full, dropping chunk')
      return
    }
    this.enqueue(() => this.processChunk(chunk, sampleRate))
  }

  private enqueue(work: () => void): void {
    this.queuedChunks++
    this.processingChain = this.processingChain
      .then(() => {
        if (this.enabled) work()
      })
      .catch((error) => {
        debug.logError(`Vosk audio processing error: ${(error as Error).message}`)
      })
      .finally(() => {
        this.queuedChunks--
      })
  }

  private ensureRecognizer(sampleRate: number): boolean {
    if (!voskModule || !this.model) return false
    if (this.recognizer && this.recognizerSampleRate === sampleRate) return true
    this.freeRecognizer()
    const recognizer = new voskModule.Recognizer({ model: this.model, sampleRate })
    recognizer.setWords(true)
    this.recognizer = recognizer as unknown as NonNullable<VoskAddon['recognizer']>
    this.recognizerSampleRate = sampleRate
    debug.info(`Vosk recognizer created at ${sampleRate} Hz`)
    return true
  }

  private processChunk(chunk: Buffer, sampleRate: number): void {
    if (!this.ensureRecognizer(sampleRate) || !this.recognizer) return
    const isFinalResult = this.recognizer.acceptWaveform(chunk)
    if (isFinalResult) {
      this.handleFinalRecognition(this.recognizer.result() as VoskFinalJson | null)
    } else {
      this.handlePartialRecognition()
    }
  }

  private handlePartialRecognition(): void {
    if (!this.recognizer) return
    const partial = (this.recognizer.partialResult() as VoskPartialJson | null)?.partial
    if (!partial) return
    this.hasPendingSpeech = true
    this.onResult?.({ isFinal: false, text: partial, confidence: 0 })
  }

  private flushPendingSpeech(): void {
    if (!this.recognizer || !this.hasPendingSpeech) return
    this.handleFinalRecognition(this.recognizer.finalResult() as VoskFinalJson | null)
  }

  private handleFinalRecognition(result: VoskFinalJson | null): void {
    this.hasPendingSpeech = false
    if (result) {
      const text = (result.text || '').trim()
      const words = result.result || []
      const averageConfidence = words.length > 0
        ? words.reduce((sum, word) => sum + (word.conf ?? 0), 0) / words.length
        : 0
      // VRCOSC's validity filter: something was recognised and it isn't Vosk's "huh" noise artifact
      const isValid = (averageConfidence !== 0 || text.length > 0) && text !== 'huh'
      if (isValid) {
        const minConfidence = this.config.minConfidence || 0
        if (minConfidence > 0 && averageConfidence < minConfidence) {
          // Below the configured audit threshold: log and drop the result
          debug.info(`Vosk dropped '${text}' (conf ${averageConfidence.toFixed(3)} < minConfidence ${minConfidence.toFixed(3)})`)
          this.onResult?.({
            isFinal: true,
            text,
            confidence: averageConfidence,
            droppedByConfidence: true
          })
        } else {
          debug.info(`Vosk recognised '${text}'`)
          const match = this.matchCommand(text)
          this.onResult?.({
            isFinal: true,
            text,
            confidence: averageConfidence,
            matchedCommandId: match?.command.id,
            matchedCommandName: match?.command.name,
            matchedDirection: match?.direction
          })
        }
      }
    }
    this.recognizer?.reset()
  }

  // --- Voice commands ---

  private matchCommand(text: string): { command: VoskCommand; direction: 'forward' | 'reverse' } | null {
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

  private executeCommand(command: VoskCommand, direction: 'forward' | 'reverse'): void {
    if (!this.oscService || !this.oscService.isListening) {
      debug.warn(`Vosk command '${command.name}' matched but OSC service is not available`)
      return
    }
    // One voice command fires all of its parameters as a batch
    for (const param of command.parameters) {
      const value = direction === 'forward' ? param.value : this.reverseValueFor(param)
      if (value === undefined) continue
      this.oscService.sendMessage(param.address, value, param.type)
    }
    debug.info(`Vosk command '${command.name}' fired (${direction}, ${command.parameters.length} parameter(s))`)
  }

  private reverseValueFor(param: VoskCommandParam): string | number | boolean | undefined {
    if (param.reverseValue !== undefined && param.reverseValue !== null && param.reverseValue !== '') {
      return param.reverseValue
    }
    // Booleans invert by default; other types need an explicit reverse value
    if (param.type === 'bool') return !param.value
    return undefined
  }

  // --- Settings ---

  setInputDevice(deviceId: string | null): boolean {
    this.config.inputDeviceId = deviceId
    this.saveConfig()
    if (this.enabled && this.engineState === 'running') {
      // VRCOSC hot-swaps the capture device without restarting the engine
      this.onCaptureControl?.({ action: 'start', deviceId, gain: this.config.inputGain })
    }
    this.notifyStatusChange()
    return true
  }

  updateConfig(partial: Partial<VoskConfig>): boolean {
    if (partial.minInputLevel !== undefined) {
      this.config.minInputLevel = Math.max(0, Math.min(100, Number(partial.minInputLevel) || 0))
    }
    if (partial.inputGain !== undefined) {
      this.config.inputGain = Math.max(0, Math.min(3, Number(partial.inputGain) || 0))
      if (this.enabled && this.engineState === 'running') {
        this.onCaptureControl?.({ action: 'update', gain: this.config.inputGain })
      }
    }
    if (partial.minConfidence !== undefined) {
      this.config.minConfidence = Math.max(0, Math.min(1, Number(partial.minConfidence) || 0))
    }
    if (partial.categories !== undefined) {
      if (!Array.isArray(partial.categories)) return false
      // Normalise: trim, drop empties, dedupe, preserve order
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

  getConfig(): VoskConfig {
    return {
      ...this.config,
      categories: [...(this.config.categories || [])],
      commands: [...(this.config.commands || [])]
    }
  }

  getStatus() {
    const pf = preflightVosk()
    return {
      enabled: this.enabled,
      engineState: this.engineState,
      modelState: this.getModelState(),
      modelDir: this.effectiveModelDir(),
      usingDefaultModel: !this.config.modelDir || this.config.modelDir === this.defaultModelDir(),
      modelListUrl: MODEL_LIST_URL,
      sampleRate: this.recognizerSampleRate,
      inputDeviceId: this.config.inputDeviceId,
      minInputLevel: this.config.minInputLevel,
      inputGain: this.config.inputGain,
      minConfidence: this.config.minConfidence ?? 0,
      // Native-library availability — surfaced on every status push so the UI can
      // render a "missing library" banner without needing a separate IPC round-trip.
      bundledLibsOk: pf.bundledLibsOk,
      nativeLibraryLoaded: pf.ok,
      lastError: this.lastError
    }
  }

  // Public preflight — runs synchronously and tells the renderer whether the native
  // library can be loaded right now. Used by the Status card to render a yellow
  // warning banner BEFORE the user clicks Start.
  preflight(): { ok: boolean; bundledLibsOk: boolean; dllPath: string | null; lastError: string | null } {
    return preflightVosk()
  }
}

export default VoskAddon
