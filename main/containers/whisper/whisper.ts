// =====================================================================
// WhisperAddon — Node worker_thread supervisor for Whisper speech
// recognition. Replaces the previous C# sub-process bridge.
//
// Architecture:
//   * Renderer AudioWorklet captures mic (Int16 PCM, ~85ms chunks)
//   * Renderer sends chunks over IPC (whisper-audio-chunk)
//   * Main process WhisperAddon forwards chunks to the worker
//     via worker.postMessage({type:'waveform', chunk, ...}) with the
//     ArrayBuffer transferred (zero-copy)
//   * Worker accumulates chunks through an activation-level gate,
//     resamples to 16 kHz mono, and calls
//     @kutalia/whisper-node-addon's transcribe({pcmf32}) on flush
//   * Worker posts back {type:'result', text}, {type:'level', value},
//     {type:'command-fired', ...}, {type:'status', state}, {type:'error'}
//   * WhisperAddon translates worker events into the existing
//     whisper-update / whisper-capture-control IPC channels so the
//     renderer composable (useWhisper.ts) doesn't need to change.
//
// Crash isolation:
//   * A segfault or uncaught exception in the worker's N-API native code
//     kills only the worker isolate. The main process keeps running,
//     the supervisor catches the exit event, marks engineState='error',
//     pushes status to the renderer, and exposes restart() so the user
//     can respawn the worker on next start().
// =====================================================================

import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import https from 'node:https'
import { app } from 'electron'
import debug from '../../services/debugger'
import configManager from '../../services/configManager'
import type { WhisperConfig, WhisperCommand } from '../../services/configManager'
import type { OscServiceLike } from './osc-types'

// ── Public types (consumed by preload + renderer composable) ──────

/**
 * State-machine for the Whisper engine. Mirrors the visibility of
 * Hyperate / OscGoesBrrr / OSCLeash — every transition calls
 * pushStatus() so the renderer knows exactly where we are.
 *
 *   stopped        — not running, no worker alive
 *   preparing      — worker file missing OR pre-spawn checks
 *                    running (added so the user sees "Preparing…"
 *                    separately from "Starting…")
 *   loading-model  — worker file is fine, but model file is missing
 *                    or invalid (UI can prompt the user to download)
 *   starting       — `new Worker(...)` succeeded, awaiting the
 *                    worker's `{type:'ready'}` reply
 *   running        — worker is alive and bound to the model; we
 *                    are processing audio chunks
 *   stopping       — stop() was called, shutdown message sent,
 *                    waiting for the worker to exit cleanly
 *   error          — fatal; check `lastError`
 */
export type WhisperEngineState =
  | 'stopped'
  | 'preparing'
  | 'loading-model'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'
export type WhisperModelState = 'missing' | 'invalid' | 'downloading' | 'extracting' | 'ready'

export interface WhisperStatusEvent {
  // Renderer uses `engineState` (not `state`) — must match
  // renderer/src/composables/useWhisper.ts's WhisperStatus type.
  engineState: WhisperEngineState
  // Mirrors `enabled` in the renderer's WhisperStatus. Drives the
  // Start/Stop button label in the UI.
  enabled: boolean
  message?: string | null
  modelPath?: string | null
  modelState?: WhisperModelState
  lastError?: string | null
  inputDeviceId?: string | null
  inputGain?: number
  minInputLevel?: number
}

export interface WhisperResultEvent {
  isFinal: true
  text: string
  confidence: number
  matchedCommandId?: string
  matchedCommandName?: string
  matchedDirection?: 'forward' | 'reverse'
}

export interface WhisperDownloadProgress {
  state: 'downloading' | 'extracting' | 'ready' | 'error'
  percent?: number
  downloadedBytes?: number
  totalBytes?: number
  message?: string
}

export interface WhisperPreflightResult {
  ok: boolean
  bundledLibsOk: boolean
  bridgePath: string | null
  lastError: string | null
}

// ── Worker IPC protocol (discriminated unions) ─────────────────────

interface WorkerCommandInit {
  type: 'init'
  modelPath: string
  language?: string
  commands?: ReadonlyArray<WorkerCommandBase>
}
interface WorkerCommandConfigure {
  type: 'configure'
  minInputLevel: number
  minUtteranceMs: number
  maxUtteranceMs: number
}
interface WorkerCommandWaveform {
  type: 'waveform'
  chunk: ArrayBuffer
  sampleRate: number
  level: number
}
interface WorkerCommandPreflight {
  type: 'preflight'
}
interface WorkerCommandShutdown {
  type: 'shutdown'
}
type WorkerCommand =
  | WorkerCommandInit
  | WorkerCommandConfigure
  | WorkerCommandWaveform
  | WorkerCommandPreflight
  | WorkerCommandShutdown

interface WorkerCommandBase {
  id: string
  name: string
  phrase: string
  reversePhrase?: string | null
  matchType: 'exact' | 'contains'
  enabled: boolean
}

interface WorkerEventReady {
  type: 'ready'
  modelPath: string
  sampleRate: number
}
interface WorkerEventStatus {
  type: 'status'
  state: 'stopped' | 'loading-model' | 'running' | 'ready' | 'error'
  message?: string
}
interface WorkerEventLevel {
  type: 'level'
  value: number
}
interface WorkerEventResult {
  type: 'result'
  text: string
  confidence: number
}
interface WorkerEventCommandFired {
  type: 'command-fired'
  commandId: string
  commandName: string
  direction: 'forward' | 'reverse'
}
interface WorkerEventError {
  type: 'error'
  message: string
}
type WorkerEvent =
  | WorkerEventReady
  | WorkerEventStatus
  | WorkerEventLevel
  | WorkerEventResult
  | WorkerEventCommandFired
  | WorkerEventError

// ── Model constants (Node owns the model download) ──────────────────

const MODEL_NAME = 'ggml-tiny.en.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`
const MODEL_LIST_URL = 'https://github.com/ggerganov/whisper.cpp/tree/main/models'
const MODEL_MIN_BYTES = 50 * 1024 * 1024
const GGML_MAGIC = 0x67676d6c // "lmgg" little-endian
const WHISPER_SAMPLE_RATE = 16000

// ── Worker resolution ─────────────────────────────────────────────

function resolveWorkerFile(): string | null {
  // The worker is bundled by electron-vite as a separate rollup chunk
  // (`whisper-worker`) and emitted at `out/main/whisper-worker.js`
  // (alongside out/main/index.js, NOT inside the containers/
  // subdirectory where whisper.ts lives).
  //
  // Dev: __dirname of the supervisor resolves to the real
  // on-disk path `<projectRoot>/out/main/containers/whisper/` and
  // `../../whisper-worker.js` finds the emitted bundle.
  //
  // Prod (asar-packaged):
  //   - The supervisor file IS asar-unpacked (because it's part of
  //     out/main and electron-vite unbundles JS), so its __dirname
  //     points at a real on-disk path under
  //     app.asar.unpacked/out/main/containers/whisper/.
  //   - The worker file is also asar-unpacked via the
  //     `**/out/main/whisper-worker.js` glob in package.json.
  //   - When the supervisor's __dirname lives INSIDE the asar (older
  //     Electron versions had bugs where the supervisor path resolved
  //     to an asar virtual path), `fs.existsSync` returns true (asar
  //     exists virtually) but `new Worker(asarPath)` HANGS because
  //     the Worker constructor uses fs.readFileSync which doesn't
  //     read inside the asar. Symptom: engine stuck in
  //     'loading-model' forever ("Starting...").
  //   - `app.getAppPath()` returns the asar path in packaged mode
  //     (`/path/to/app.asar`), making asar detection reliable.
  //
  // Strategy:
  //   1. If packaged: prefer the asar-unpacked path (always works).
  //   2. Otherwise (dev): prefer the __dirname-relative path.
  //   3. Fall through to alternates in case layout changes.
  //   4. Log every candidate checked so future path bugs are obvious.
  const candidates: string[] = []
  const isPackaged = app.isPackaged

  if (isPackaged) {
    // path.dirname(app.getAppPath()) is the directory containing the
    // app.asar file (e.g., /path/to/dist/win-unpacked/). From there,
    // app.asar.unpacked/out/main/whisper-worker.js is the unpacked
    // worker's real on-disk path.
    const appDir = path.dirname(app.getAppPath())
    candidates.push(path.join(appDir, 'resources', 'app.asar.unpacked', 'out', 'main', 'whisper-worker.js'))
    // Older layouts (no asar.unpacked) might place the worker next
    // to the .exe; harmless to keep as a fallback.
    candidates.push(path.join(path.dirname(process.execPath), 'whisper-worker.js'))
  } else {
    // Dev: the emitted bundle lives at out/main/whisper-worker.js,
    // the supervisor at out/main/containers/whisper/whisper.js.
    candidates.push(path.join(__dirname, '..', '..', 'whisper-worker.js'))
    // Legacy dev: emitted next to the supervisor.
    candidates.push(path.join(__dirname, 'whisper-worker.js'))
  }

  debug.info(`[whisper] resolveWorkerFile: isPackaged=${isPackaged}, appPath=${app.getAppPath()}`)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      debug.info(`[whisper] resolveWorkerFile: picked ${candidate}`)
      return candidate
    }
    debug.info(`[whisper] resolveWorkerFile: miss ${candidate}`)
  }
  debug.warn(`[whisper] resolveWorkerFile: no worker file found in any candidate`)
  return null
}

// ── Type guards ─────────────────────────────────────────────────────

function isWorkerEvent(value: unknown): value is WorkerEvent {
  if (typeof value !== 'object' || value === null) return false
  const evt = value as { type?: unknown }
  return (
    evt.type === 'ready' ||
    evt.type === 'status' ||
    evt.type === 'level' ||
    evt.type === 'result' ||
    evt.type === 'command-fired' ||
    evt.type === 'error'
  )
}

// ── WhisperAddon ───────────────────────────────────────────────────

export class WhisperAddon {
  private worker: Worker | null = null
  private workerFile: string | null = null
  private modelDir: string | null = null
  private oscService: OscServiceLike | null = null
  private engineState: WhisperEngineState = 'stopped'
  private modelState: WhisperModelState = 'missing'
  private lastError: string | null = null
  private currentInputDeviceId: string | null = null
  private currentInputGain = 1.0
  private currentMinInputLevel = 0
  private isRunning = false
  private pendingInitResolve: ((ok: boolean) => void) | null = null
  // Monotonically incremented on every start(). The 'exit' handler
  // captures the value at the time it was attached; if a NEW worker
  // is started (and bumps this), the OLD worker's exit-handler
  // becomes a no-op. Without this, a stop+start cycle (within the
  // 500ms grace period) makes the OLD worker's late 'exit' event
  // clobber the NEW worker's engineState — UI gets stuck at
  // 'stopping' / 'stopped' even though the new worker is healthy.
  private workerGeneration = 0

  // Public callbacks — the renderer composable subscribes via these
  // (or, more typically, via the IPC channels main/index.ts wires up).
  private onStatusChange: ((status: WhisperStatusEvent) => void) | null = null
  private onResult: ((result: WhisperResultEvent) => void) | null = null
  private onDownloadProgress: ((progress: WhisperDownloadProgress) => void) | null = null
  private onCaptureControl: ((control: WhisperCaptureControl) => void) | null = null
  private onLevel: ((level: number) => void) | null = null
  // Last level we emitted + the wall-clock time we did so. Used for
  // time-based throttling of the level push (a steady level still
  // produces UI updates at ~15 Hz). Value-based throttle (`!==`) made
  // the meter look frozen when the input level was constant.
  private lastEmittedLevel = -1
  private lastEmittedLevelAt = 0

  constructor() {
    const cfg = configManager.getWhisperConfig()
    this.modelDir = cfg.modelDir ?? null
    this.currentInputDeviceId = cfg.inputDeviceId ?? null
    this.currentInputGain = cfg.inputGain ?? 1.0
    this.currentMinInputLevel = cfg.minInputLevel ?? 0
    this.workerFile = resolveWorkerFile()
  }

  // ── Callback registration (mirrors old addon's interface) ──

  setStatusChangeCallback(cb: (status: WhisperStatusEvent) => void): void {
    this.onStatusChange = cb
  }
  setResultCallback(cb: (result: WhisperResultEvent) => void): void {
    this.onResult = cb
  }
  setDownloadProgressCallback(cb: (progress: WhisperDownloadProgress) => void): void {
    this.onDownloadProgress = cb
  }
  setCaptureControlCallback(cb: (control: WhisperCaptureControl) => void): void {
    this.onCaptureControl = cb
  }
  setLevelCallback(cb: (level: number) => void): void {
    this.onLevel = cb
  }

  setOscService(osc: OscServiceLike): void {
    this.oscService = osc
  }

  isEnabled(): boolean {
    return this.isRunning || this.engineState === 'running'
  }

  // ── Preflight: two-tier (cheap + live spawn test) ──
  //
  // Tier 1: cheap `fs.existsSync()` — catches obvious missing-file
  //   cases. Returns false in prod if the worker path resolves into
  //   the asar virtual FS (catches the regression that caused the
  //   "Starting..." hang).
  //
  // Tier 2: actually spawn a throwaway worker, send `{type:'preflight'}`,
  //   wait up to 3s for it to reply, then terminate. This is the
  //   only way to catch asar-path issues where the file exists
  //   virtually inside the asar but `new Worker(asarPath)` silently
  //   fails or hangs.
  preflight(): WhisperPreflightResult {
    if (!this.workerFile) {
      return {
        ok: false,
        bundledLibsOk: false,
        bridgePath: null,
        lastError: 'whisper-worker.js not found. Run `npm run build` to bundle the worker.'
      }
    }
    const fileExists = fs.existsSync(this.workerFile)
    if (!fileExists) {
      return {
        ok: false,
        bundledLibsOk: false,
        bridgePath: this.workerFile,
        lastError: `Worker file not found on disk: ${this.workerFile}`
      }
    }
    return {
      ok: fileExists,
      bundledLibsOk: fileExists,
      bridgePath: this.workerFile,
      lastError: null
    }
  }

  /**
   * Live preflight — actually spawn a throwaway worker to verify the
   * worker file can be loaded by Node's Worker constructor (which
   * differs from `fs.existsSync` for asar-packaged paths).
   *
   * Returns detailed diagnostics: ok=true if the worker reported back
   * `ready` within the 3s budget.
   *
   * IMPORTANT: if the addon already has a live worker (`isRunning`),
   * we skip the spawn entirely. The binding loaded successfully when
   * that worker spawned (which is what preflight is trying to verify),
   * so a second `new Worker()` load of the same N-API binary is at
   * best redundant and at worst crashes the GPU process via
   * double-`dlopen` of a thread-unsafe native library. This was the
   * cause of the "crashed once I went to the Whisper page" report
   * when autostart-on + page-mount triggered two worker spawns.
   */
  async runLivePreflight(): Promise<WhisperPreflightResult> {
    const cheap = this.preflight()
    if (!cheap.ok || !cheap.bridgePath) return cheap

    if (this.isRunning && this.worker !== null) {
      // Binding already loaded — prove of life is the running worker.
      debug.info(`[preflight] skipping probe — live worker already running`)
      return {
        ok: true,
        bundledLibsOk: true,
        bridgePath: cheap.bridgePath,
        lastError: null
      }
    }

    const workerPath = cheap.bridgePath
    debug.info(`[preflight] spawning probe worker from ${workerPath}`)

    let probe: Worker | null = null
    try {
      probe = new Worker(workerPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      debug.error(`[preflight] probe worker failed to spawn: ${message}`)
      return {
        ok: false,
        bundledLibsOk: false,
        bridgePath: workerPath,
        lastError: `Worker failed to spawn (likely asar path issue): ${message}`
      }
    }

    return new Promise<WhisperPreflightResult>((resolve) => {
      let settled = false
      const finishOk = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        try {
          probe?.terminate()
        } catch {
          /* swallow */
        }
        resolve({ ok: true, bundledLibsOk: true, bridgePath: workerPath, lastError: null })
      }
      const finishFail = (lastError: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        try {
          probe?.terminate()
        } catch {
          /* swallow */
        }
        resolve({ ok: false, bundledLibsOk: false, bridgePath: workerPath, lastError })
      }

      probe!.on('message', (raw: unknown) => {
        if (isWorkerEvent(raw)) {
          if (raw.type === 'ready' || raw.type === 'status') {
            debug.info(`[preflight] probe worker replied: type=${raw.type}`)
            finishOk()
          }
        }
      })
      probe!.on('error', (err) => {
        debug.error(`[preflight] probe worker error: ${err.message}`)
        finishFail(err.message)
      })
      probe!.on('exit', (code) => {
        if (!settled) {
          // Worker exited before we saw 'ready' or 'status:ready' —
          // most likely the asar path issue or a startup crash.
          finishFail(`Worker exited with code ${code} before reporting ready`)
        }
      })

      // Send the preflight ping so the worker has something to do.
      try {
        probe!.postMessage({ type: 'preflight' })
      } catch (err) {
        finishFail(
          `postMessage failed: ${err instanceof Error ? err.message : String(err)}`
        )
      }

      const timeout = setTimeout(() => {
        finishFail('Worker did not respond within 3s — likely an asar/virtual-FS path issue')
      }, 3_000)
    })
  }

  // ── Lifecycle ──

  async start(oscService: OscServiceLike): Promise<boolean> {
    this.oscService = oscService
    this.lastError = null
    if (this.isRunning) return true

    debug.info('[whisper] start: begin')

    // ── Step 1: validate worker file ──
    if (!this.workerFile) {
      this.lastError = 'whisper-worker.js not found. Run `npm run build` to bundle the worker.'
      this.engineState = 'preparing'
      this.pushStatus()
      debug.error(`[whisper] start: failed at preparing — ${this.lastError}`)
      return false
    }

    // ── Step 2: validate model file ──
    const modelPath = this.resolveModelPath()
    if (!modelPath) {
      this.lastError = 'No Whisper model configured. Download one first.'
      this.engineState = 'loading-model'
      this.modelState = 'missing'
      this.pushStatus()
      debug.error(`[whisper] start: failed at loading-model — ${this.lastError}`)
      return false
    }
    this.modelDir = path.dirname(modelPath)

    // ── Step 3: spawn worker thread ──
    // Bump the generation so any handler bound to a previous worker
    // becomes a no-op when that worker eventually exits (otherwise the
    // old exit-handler fires engineState changes that race with the
    // new worker's lifecycle and can leave the UI stuck).
    this.workerGeneration += 1
    const myGeneration = this.workerGeneration
    try {
      // Log which path we're loading so prod asar path issues are
      // immediately obvious in the Electron log.
      debug.info(`[whisper] start: spawning worker from ${this.workerFile} (gen=${myGeneration})`)
      this.worker = new Worker(this.workerFile)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Common cause in prod: worker file path resolves into the
      // asar virtual FS (`app.asar/...`) which Worker constructor
      // cannot load. The asar-detection in resolveWorkerFile() should
      // prevent this, but if a future packaging change slips past
      // it, this error fires within a synchronous try/catch.
      this.lastError = `Failed to spawn whisper worker: ${message}`
      this.engineState = 'error'
      this.pushStatus()
      debug.error(`[whisper] start: failed at spawn — ${message}`)
      return false
    }

    // Pushed BEFORE wiring handlers so the user sees the state
    // transition the moment the spawn succeeds.
    this.engineState = 'starting'
    this.pushStatus()

    // ── Step 4: wire worker IPC channels ──
    this.worker.on('message', (raw: unknown) => {
      if (isWorkerEvent(raw)) {
        this.handleWorkerEvent(raw)
      } else {
        debug.warn(`[whisper] unknown worker message: ${JSON.stringify(raw).slice(0, 120)}`)
      }
    })
    this.worker.on('error', (err) => {
      debug.error(`[whisper] worker error: ${err.message}`)
      this.lastError = err.message
      this.engineState = 'error'
      this.pushStatus()
    })
    this.worker.on('exit', (code) => {
      // CRITICAL: ignore exit events from a generation that has been
      // superseded. stop() + start() (within the 500ms grace) creates
      // worker #2, which bumps workerGeneration. worker #1's eventual
      // 'exit' would otherwise clobber worker #2's lifecycle events
      // (engineState races, UI stuck on 'starting worker...').
      if (myGeneration !== this.workerGeneration) {
        debug.info(`[whisper] worker gen=${myGeneration} exited after supersession; ignoring`)
        return
      }
      // Capture state BEFORE clearing, so we can disambiguate
      // "worker was running and died" from "worker exited during
      // init before we set isRunning = true" from "user called stop()".
      const wasRunning = this.isRunning
      const wasStarting = this.pendingInitResolve !== null
      this.isRunning = false
      this.worker = null
      // Any in-flight init promise is now dead — reject it.
      if (this.pendingInitResolve) {
        const r = this.pendingInitResolve
        this.pendingInitResolve = null
        r(false)
      }
      if (wasRunning && code !== 0) {
        debug.error(`[whisper] worker gen=${myGeneration} exited unexpectedly while running (code=${code})`)
        this.engineState = 'error'
        this.lastError = `Worker exited unexpectedly (code=${code})`
      } else if (wasStarting || (wasRunning && code === 0)) {
        // Worker exited cleanly while we were just starting — treat
        // as an error so the user knows init didn't complete.
        debug.error(`[whisper] worker gen=${myGeneration} exited during init/while running (code=${code})`)
        this.engineState = 'error'
        this.lastError = `Worker exited unexpectedly during start (code=${code})`
      } else {
        // Either: user explicitly called stop(), or worker hadn't
        // reached `running` yet (still in `starting`). No error.
        debug.info(`[whisper] worker gen=${myGeneration} exited cleanly (code=${code})`)
        this.engineState = 'stopped'
      }
      this.pushStatus()
    })

    // ── Step 5: send init, await 'ready' with 15s timeout ──
    const initOk = await new Promise<boolean>((resolve) => {
      this.pendingInitResolve = resolve
      const commands: ReadonlyArray<WorkerCommandBase> = configManager
        .getWhisperConfig()
        .commands.map((c: WhisperCommand) => ({
          id: c.id,
          name: c.name,
          phrase: c.phrase,
          reversePhrase: c.reversePhrase ?? null,
          matchType: c.matchType,
          enabled: c.enabled
        }))
      this.sendWorker({
        type: 'init',
        modelPath,
        language: 'en',
        commands
      })
      // Tightened from 60s → 15s: model load for tiny.en takes ~2-4s
      // on a warm disk; if the worker hasn't reported ready in 15s,
      // it has either hung or never spawned (asar path issue in prod).
      setTimeout(() => {
        if (this.pendingInitResolve === resolve) {
          this.pendingInitResolve = null
          this.lastError =
            'Worker init timed out after 15s. Most likely the worker file path is wrong. ' +
            'Run with --enable-logging to see which candidate path was picked. ' +
            `(picked: ${this.workerFile ?? 'none'})`
          this.engineState = 'error'
          this.pushStatus()
          debug.error(`[whisper] start: timed out after 15s awaiting worker ready`)
          resolve(false)
        }
      }, 15_000)
    })
    if (!initOk) {
      // Worker is still alive (we haven't received exit). Try a
      // best-effort terminate so it doesn't sit there uselessly.
      try {
        this.worker?.terminate()
      } catch {
        /* swallow */
      }
      this.worker = null
      debug.error('[whisper] start: init failed — see lastError')
      return false
    }

    // ── Step 6: configure gate thresholds, mark running ──
    this.sendWorker({
      type: 'configure',
      minInputLevel: this.currentMinInputLevel,
      minUtteranceMs: 350,
      maxUtteranceMs: 30_000
    })

    this.modelState = 'ready'
    this.isRunning = true
    this.engineState = 'running'
    this.pushStatus()
    debug.info('[whisper] start: complete, engineState=running')

    // ── Step 7: tell renderer to open the mic + start the AudioWorklet ──
    this.onCaptureControl?.({
      action: 'start',
      deviceId: this.currentInputDeviceId,
      gain: this.currentInputGain
    })
    return true
  }

  stop(): void {
    // If we're not even running, no-op. Avoid spurious 'stopping'
    // state pushes when stop() is called redundantly.
    if (!this.isRunning && this.engineState === 'stopped') {
      return
    }
    // Transition to 'stopping' first so the UI can show "Stopping..."
    // while the worker is being asked to exit cleanly.
    this.isRunning = false
    this.engineState = 'stopping'
    this.pushStatus()
    debug.info('[whisper] stop: requested, engineState=stopping')

    // Tell the renderer to stop mic capture immediately so the user
    // doesn't see the level meter continue to animate.
    this.onCaptureControl?.({ action: 'stop' })

    // Snapshot the worker reference and bump the generation. Any
    // late 'exit' event from this worker becomes a no-op once a new
    // start() creates worker #N+1.
    const workerToStop = this.worker
    const stopGen = ++this.workerGeneration
    this.worker = null

    if (!workerToStop) {
      // No worker alive — we can short-circuit straight to 'stopped'.
      this.engineState = 'stopped'
      this.pushStatus()
      return
    }
    try {
      workerToStop.postMessage({ type: 'shutdown' })
    } catch (err) {
      // Worker may already be in an error state. Fall through to
      // terminate after the grace period.
      debug.warn(`[whisper] stop: shutdown send failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    // Give the worker 500ms to shut down cleanly, then force-terminate
    // THIS specific worker (not whatever this.worker points at now).
    // The 'exit' handler on this worker will fire with stopGen, which
    // is now stale (this.workerGeneration is higher), so the no-op
    // guard short-circuits and we don't accidentally transition the
    // NEW worker to 'stopped'.
    setTimeout(() => {
      if (stopGen !== this.workerGeneration) return // supersession
      try {
        workerToStop.terminate()
      } catch {
        // swallow
      }
    }, 500)
    // Note: we DO NOT pushStatus 'stopped' here — only after the
    // exit handler confirms the worker actually exited. If a new
    // start() is in flight, the new exit handler will fire too.
  }

  // ── Public audio entry point (called from the whisper-audio-chunk
  // IPC handler in main/index.ts) ──

  acceptAudio(chunk: Buffer, sampleRate: number, level: number): void {
    // Forward audio chunks as long as the worker is alive. Don't gate
    // on `isRunning` here — chunks from the renderer's mic start
    // arriving as soon as capture-control fires (which is BEFORE
    // start() finishes awaiting the worker's "ready" event). The worker
    // buffers them through the gate; chunks arriving pre-ready are
    // dropped at the gate boundary (no model loaded yet to infer on).
    if (!this.worker) return
    // Transfer the buffer (zero-copy). Node will move ownership to the
    // worker; we must not touch `chunk` after this call. Note that
// `chunk.buffer` is typed as `ArrayBuffer | SharedArrayBuffer` by
// Node's Buffer definitions, but in practice the renderer-side
// ArrayBuffer always arrives as a plain ArrayBuffer (never a SAB).
// We copy into a fresh ArrayBuffer so the type is unambiguous.
    const ab = new ArrayBuffer(chunk.byteLength)
    new Uint8Array(ab).set(chunk)
    try {
      this.worker.postMessage(
        {
          type: 'waveform',
          chunk: ab,
          sampleRate,
          level
        } satisfies WorkerCommandWaveform,
        [ab]
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      debug.warn(`[whisper] failed to forward audio chunk to worker: ${message}`)
    }
  }

  // ── Status / config ──

  getStatus(): WhisperStatusEvent & {
    enabled: boolean
    bridgePath: string | null
    inputDeviceId: string | null
    inputGain: number
    minInputLevel: number
  } {
    // `engineState` (not `state`) matches the renderer's WhisperStatus
    // type — see pushStatus() for the full rationale.
    return {
      enabled: this.isRunning,
      engineState: this.engineState,
      modelState: this.modelState,
      modelPath: this.modelDir,
      lastError: this.lastError,
      bridgePath: this.workerFile,
      inputDeviceId: this.currentInputDeviceId,
      inputGain: this.currentInputGain,
      minInputLevel: this.currentMinInputLevel
    }
  }

  getConfig(): WhisperConfig {
    return configManager.getWhisperConfig()
  }

  updateConfig(config: Partial<WhisperConfig>): boolean {
    const ok = configManager.updateWhisperConfig(config)
    if (ok) {
      const cfg = configManager.getWhisperConfig()
      this.modelDir = cfg.modelDir ?? null
      this.currentInputDeviceId = cfg.inputDeviceId ?? null
      this.currentInputGain = cfg.inputGain ?? 1.0
      this.currentMinInputLevel = cfg.minInputLevel ?? 0
      // Push the updated gate configuration to the running worker.
      if (this.isRunning) {
        this.sendWorker({
          type: 'configure',
          minInputLevel: this.currentMinInputLevel,
          minUtteranceMs: 350,
          maxUtteranceMs: 30_000
        })
      }
    }
    return ok
  }

  setInputDevice(deviceId: string | null): boolean {
    const previousDeviceId = this.currentInputDeviceId
    this.currentInputDeviceId = deviceId
    configManager.updateWhisperConfig({ inputDeviceId: deviceId })

    // If the device actually changed AND the engine is running, tell
    // the renderer to reopen the AudioWorklet's MediaStream on the
    // new device. Without this push the level meter keeps responding
    // to the OLD microphone's input, so the user thinks their new mic
    // pick is broken. We deliberately do NOT bounce engineState — a
    // mic swap is a hot-swap of the audio source, not a restart of
    // the inference engine. The UI stays "running/green" throughout.
    if (this.isRunning && previousDeviceId !== deviceId) {
      debug.info(`[whisper] setInputDevice: ${previousDeviceId ?? 'default'} -> ${deviceId ?? 'default'}; re-opening capture`)
      this.onCaptureControl?.({
        action: 'start',
        deviceId,
        gain: this.currentInputGain
      })
      // Push the new status so the renderer's `<select>` and the
      // device-id-driven UI bits re-render with the fresh value.
      // engineState stays 'running' — this is NOT a state change.
      this.pushStatus()
    }
    return true
  }

  // ── Model download (Node-owned) ──

  async downloadModel(): Promise<{ success: boolean; error?: string; modelPath?: string }> {
    const dest = this.modelDir ?? path.join(app.getPath('userData'), 'whisper-models')
    try {
      await fsp.mkdir(dest, { recursive: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Failed to create model dir: ${message}` }
    }
    const modelPath = path.join(dest, MODEL_NAME)
    this.modelDir = dest
    this.onDownloadProgress?.({ state: 'downloading', percent: 0, downloadedBytes: 0, totalBytes: 0 })
    try {
      await this.downloadFile(MODEL_URL, modelPath, (downloaded, total) => {
        this.onDownloadProgress?.({
          state: 'downloading',
          percent: total ? Math.round((downloaded / total) * 100) : 0,
          downloadedBytes: downloaded,
          totalBytes: total
        })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.lastError = `Model download failed: ${message}`
      this.onDownloadProgress?.({ state: 'error', message })
      return { success: false, error: message }
    }
    // Validate the file
    try {
      const stat = await fsp.stat(modelPath)
      if (stat.size < MODEL_MIN_BYTES) {
        await fsp.unlink(modelPath).catch(() => {
          /* swallow */
        })
        const msg = `Downloaded model is too small (${stat.size} bytes < ${MODEL_MIN_BYTES} sanity floor). Rejecting.`
        this.lastError = msg
        this.onDownloadProgress?.({ state: 'error', message: msg })
        return { success: false, error: msg }
      }
      const fh = await fsp.open(modelPath, 'r')
      try {
        const buf = Buffer.alloc(4)
        await fh.read(buf, 0, 4, 0)
        const magic = buf.readUInt32LE(0)
        if (magic !== GGML_MAGIC) {
          await fh.close()
          await fsp.unlink(modelPath).catch(() => {
            /* swallow */
          })
          const msg = `Downloaded file is not a valid ggml model (bad magic 0x${magic.toString(16)})`
          this.lastError = msg
          this.onDownloadProgress?.({ state: 'error', message: msg })
          return { success: false, error: msg }
        }
      } finally {
        await fh.close()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.lastError = `Model validation failed: ${message}`
      this.onDownloadProgress?.({ state: 'error', message })
      return { success: false, error: message }
    }
    this.modelState = 'ready'
    configManager.updateWhisperConfig({ modelDir: dest })
    this.onDownloadProgress?.({ state: 'ready', percent: 100, message: 'Model downloaded and verified' })
    this.pushStatus()
    return { success: true, modelPath }
  }

  private downloadFile(
    url: string,
    dest: string,
    onProgress: (downloaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = (u: string): void => {
        https
          .get(u, (res) => {
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              request(res.headers.location)
              return
            }
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            const total = parseInt(res.headers['content-length'] || '0', 10)
            const file = fs.createWriteStream(dest)
            let downloaded = 0
            let lastProgressAt = 0
            res.on('data', (chunk: Buffer) => {
              downloaded += chunk.length
              const now = Date.now()
              if (now - lastProgressAt > 250) {
                lastProgressAt = now
                onProgress(downloaded, total)
              }
            })
            res.pipe(file)
            file.on('finish', () => {
              file.close()
              onProgress(downloaded, total)
              resolve()
            })
            file.on('error', (err) => {
              fs.unlink(dest, () => {
                /* swallow */
              })
              reject(err)
            })
            res.on('error', (err) => {
              fs.unlink(dest, () => {
                /* swallow */
              })
              reject(err)
            })
          })
          .on('error', reject)
      }
      request(url)
    })
  }

  // ── Internal ──

  private sendWorker(cmd: WorkerCommand): void {
    if (!this.worker) {
      debug.warn(`[whisper] cannot send cmd — worker not running: ${cmd.type}`)
      return
    }
    try {
      this.worker.postMessage(cmd)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      debug.warn(`[whisper] failed to write to worker: ${message}`)
    }
  }

  private handleWorkerEvent(evt: WorkerEvent): void {
    switch (evt.type) {
      case 'ready':
        if (this.pendingInitResolve) {
          const r = this.pendingInitResolve
          this.pendingInitResolve = null
          r(true)
        }
        this.modelState = 'ready'
        this.pushStatus()
        break
      case 'status':
        if (evt.state === 'ready') {
          this.modelState = 'ready'
        } else if (evt.state === 'error') {
          this.engineState = 'error'
          this.lastError = evt.message ?? this.lastError
        }
        this.pushStatus()
        break
      case 'level':
        // Dedicated level callback — used to be routed through
        // `onCaptureControl({action:'update', gain: <level>})` which
        // the renderer's whisperCapture.ts listener mistakenly applied
        // as a SETGAIN to the AudioWorklet, causing a feedback loop
        // (loud mic → high level → setGain(high) → clipped samples →
        // higher level → …). The dedicated channel keeps capture-
        // control separate from level reporting.
        // Throttle by TIME (not value) so a steady level still updates
        // the UI meter at ~15 Hz. Value-based throttle (`!==`) made
        // the meter look frozen when the input level was constant.
        const now = Date.now()
        if (now - this.lastEmittedLevelAt >= 65) {
          this.lastEmittedLevelAt = now
          this.lastEmittedLevel = evt.value
          this.onLevel?.(evt.value)
        }
        break
      case 'result':
        this.onResult?.({
          isFinal: true,
          text: evt.text,
          confidence: evt.confidence
        })
        break
      case 'command-fired': {
        // Fire OSC for the matched command via oscService.
        const cfg = configManager.getWhisperConfig()
        const cmd = cfg.commands.find((c: WhisperCommand) => c.id === evt.commandId)
        if (cmd && this.oscService) {
          for (const p of cmd.parameters) {
            const value =
              evt.direction === 'reverse' && p.reverseValue !== undefined && p.reverseValue !== null
                ? p.reverseValue
                : p.value
            try {
              this.oscService.sendMessage(p.address, [{ type: p.type, value: value as number | string | boolean }])
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              debug.warn(`[whisper] OSC send failed for ${p.address}: ${message}`)
            }
          }
        }
        this.onResult?.({
          isFinal: true,
          text: '',
          confidence: 1.0,
          matchedCommandId: evt.commandId,
          matchedCommandName: evt.commandName,
          matchedDirection: evt.direction
        })
        break
      }
      case 'error':
        this.lastError = evt.message
        debug.error(`[whisper] worker: ${this.lastError}`)
        this.pushStatus()
        break
    }
  }

  private pushStatus(): void {
    // `engineState` (not `state`) is the field name the renderer's
    // WhisperStatus type + useWhisper composable expect. Using `state`
    // here caused engineState to silently stay at its default ('stopped')
    // on every push. `enabled: boolean` must also be present — the
    // renderer reads `status.enabled` to drive the Start/Stop button
    // label and the toggle condition.
    this.onStatusChange?.({
      enabled: this.isRunning,
      engineState: this.engineState,
      modelState: this.modelState,
      modelPath: this.modelDir,
      lastError: this.lastError,
      message: this.lastError,
      inputDeviceId: this.currentInputDeviceId,
      inputGain: this.currentInputGain,
      minInputLevel: this.currentMinInputLevel
    })
  }

  private resolveModelPath(): string | null {
    if (this.modelDir) {
      const p = path.join(this.modelDir, MODEL_NAME)
      if (fs.existsSync(p)) return p
    }
    const p = path.join(app.getPath('userData'), 'whisper-models', MODEL_NAME)
    if (fs.existsSync(p)) return p
    return null
  }
}

// ── Capture-control payload shape (consumed by whisperCapture.ts) ──

export interface WhisperCaptureControl {
  action: 'start' | 'stop' | 'update' | 'device-list'
  deviceId?: string | null
  gain?: number
  devices?: ReadonlyArray<{ id: string; name: string }>
}

// ── Backwards-compatible top-level exports (kept identical to the
//    previous C#-supervised addon so consumers don't need to change) ──

export function preflightWhisper(): WhisperPreflightResult {
  const addon = new WhisperAddon()
  return addon.preflight()
}

export default WhisperAddon

export const MODEL_LIST = MODEL_LIST_URL
export { WHISPER_SAMPLE_RATE }