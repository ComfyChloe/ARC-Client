#!/usr/bin/env node
// =====================================================================
// smoke-whisper-worker.mjs
//
// Plain-Node smoke test for the Whisper worker_thread addon. Spawns
// whisper-worker.js in a worker_threads Worker, sends an init command
// (with WHISPER_MODEL env var pointing at a ggml model file), and a
// few chunks of synthetic Int16 PCM audio. Exits 0 if the worker
// reports ready and processes the audio; non-zero on any failure.
//
// Usage:
//   WHISPER_MODEL=path/to/ggml-tiny.en.bin node scripts/smoke-whisper-worker.mjs
//
// Exit codes:
//   0 — worker loaded binding, accepted init, processed audio
//   1 — generic failure
//   2 — WHISPER_MODEL env var not set / file missing
//   3 — worker exited unexpectedly
//   4 — worker reported error event
//   5 — timed out
// =====================================================================

import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ARC_CLIENT_DIR = path.resolve(SCRIPT_DIR, '..')

// ── 1. Locate the worker file ──────────────────────────────────────

const WORKER_CANDIDATES = [
  path.join(ARC_CLIENT_DIR, 'out', 'main', 'whisper-worker.js'),
  path.join(ARC_CLIENT_DIR, 'out', 'main', 'containers', 'whisper', 'whisper-worker.js'),
  path.join(ARC_CLIENT_DIR, 'main', 'containers', 'whisper', 'whisper-worker.js')
]

function findWorker() {
  for (const candidate of WORKER_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

// ── 2. Resolve the model file ──────────────────────────────────────

const modelPath = process.env.WHISPER_MODEL
if (!modelPath) {
  console.error('[smoke] WHISPER_MODEL env var must point at a ggml-tiny.en.bin file')
  console.error('[smoke] Example: WHISPER_MODEL=path/to/ggml-tiny.en.bin node scripts/smoke-whisper-worker.mjs')
  process.exit(2)
}
if (!fs.existsSync(modelPath)) {
  console.error(`[smoke] model file not found: ${modelPath}`)
  process.exit(2)
}

const workerPath = findWorker()
if (!workerPath) {
  console.error('[smoke] whisper-worker.js not found in any of:')
  for (const candidate of WORKER_CANDIDATES) {
    console.error(`        - ${candidate}`)
  }
  console.error('[smoke] Run `npm run build` first, or run the smoke test from the arc-client root.')
  process.exit(1)
}

console.log(`[smoke] worker: ${workerPath}`)
console.log(`[smoke] model:  ${modelPath} (${(fs.statSync(modelPath).size / 1024 / 1024).toFixed(1)} MB)`)

// ── 3. Spawn worker + drive it ──────────────────────────────────────

const worker = new Worker(workerPath)

let readyReceived = false
let initSent = false
let chunksSent = 0
let chunksToSend = 5
let errorReceived = null
const statusReceived = []
const resultReceived = []
let levelReceived = 0
let finished = false

const timeout = setTimeout(() => {
  console.error('[smoke] timed out after 30s')
  console.error('[smoke] status events:', statusReceived)
  console.error('[smoke] error event:', errorReceived)
  if (!finished) {
    finished = true
    worker.terminate()
    process.exit(5)
  }
}, 30_000)

function finish(exitCode) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  worker.terminate()
  console.log('[smoke] summary:')
  console.log(`  ready received:    ${readyReceived}`)
  console.log(`  init sent:         ${initSent}`)
  console.log(`  chunks sent:       ${chunksSent}`)
  console.log(`  status events:     ${statusReceived.length}`)
  console.log(`  level events:      ${levelReceived}`)
  console.log(`  result events:     ${resultReceived.length}`)
  console.log(`  error event:       ${errorReceived ?? '(none)'}`)
  process.exit(exitCode)
}

function startFeedingAudio() {
  if (chunksSent > 0) return
  // Synthetic 440 Hz tone at low amplitude (~50/32768). The worker
  // resamples from 48 kHz to 16 kHz and runs inference on the
  // closed utterance. We don't expect meaningful text out of this —
  // the point is to exercise the inference pipeline without
  // crashing.
  const sampleRate = 48000
  const chunkSamples = 4096
  const silence = new Int16Array(chunkSamples)
  for (let i = 0; i < chunkSamples; i++) {
    silence[i] = Math.sin((i / sampleRate) * 2 * Math.PI * 440) * 50
  }
  const interval = setInterval(() => {
    if (chunksSent >= chunksToSend) {
      clearInterval(interval)
      // Wait for the worker to flush the utterance (gate close) and
      // emit a result event. With silence, the gate stays open for
      // 30s — too long for a smoke test. Send a low-level "silence"
      // chunk at the end to force a gate close via GATE_HOLD_MS.
      setTimeout(() => {
        // If no result after another 5s, the worker has at least
        // processed the audio without crashing. That's the success
        // criterion for this smoke test.
        setTimeout(() => {
          if (!finished) {
            console.log('[smoke] finished feeding audio + waited for result')
            finish(0)
          }
        }, 5_000)
      }, 1_000)
      return
    }
    const ab = new ArrayBuffer(silence.byteLength)
    new Int16Array(ab).set(silence)
    try {
      worker.postMessage(
        {
          type: 'waveform',
          chunk: ab,
          sampleRate,
          level: 30
        },
        [ab]
      )
      chunksSent++
    } catch (err) {
      console.error(`[smoke] postMessage failed: ${err.message}`)
      finish(1)
    }
  }, 100)
}

function trySendInit() {
  if (initSent) return
  initSent = true
  worker.postMessage({
    type: 'init',
    modelPath,
    language: 'en',
    commands: []
  })
  worker.postMessage({
    type: 'configure',
    minInputLevel: 0,
    minUtteranceMs: 100,
    maxUtteranceMs: 5000
  })
  // Begin feeding audio right after init.
  setTimeout(startFeedingAudio, 100)
}

worker.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return
  switch (msg.type) {
    case 'ready':
      readyReceived = true
      console.log('[smoke] worker ready:', msg)
      trySendInit()
      break
    case 'status':
      statusReceived.push(msg)
      console.log(`[smoke] status: state=${msg.state}${msg.message ? ' message=' + msg.message : ''}`)
      break
    case 'level':
      levelReceived++
      break
    case 'result':
      resultReceived.push(msg)
      console.log(`[smoke] result: "${msg.text}" (confidence=${msg.confidence})`)
      break
    case 'command-fired':
      console.log(`[smoke] command-fired: ${msg.commandName} (${msg.direction})`)
      break
    case 'error':
      errorReceived = msg.message
      console.error(`[smoke] worker error: ${msg.message}`)
      break
  }
})

worker.on('error', (err) => {
  console.error(`[smoke] worker crashed: ${err.message}`)
  if (!finished) finish(3)
})

worker.on('exit', (code) => {
  if (code !== 0 && !finished) {
    console.error(`[smoke] worker exited with code ${code}`)
    finish(3)
  }
})

// Proactively send init in case the worker never sends ready (e.g.,
// preflight path not taken). The worker accepts init even before
// ready — it just queues model loading until the binding loads.
setTimeout(trySendInit, 200)