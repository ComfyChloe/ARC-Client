// =====================================================================
// whisper-worker.js — Node worker_thread entry point for Whisper speech
// recognition. Loaded by WhisperAddon in the main process via
//   new Worker(path.join(__dirname, 'whisper-worker.js'))
//
// Why a worker_thread (not in-process, not child_process.fork):
//   * Crash isolation: an unhandled exception or N-API segfault in the
//     whisper.cpp native code kills the worker V8 isolate but the main
//     Electron process keeps running.
//   * The @kutalia/whisper-node-addon shim loads the .node binary as a
//     module-level singleton via util.promisify. All transcribe() calls
//     share the same native state. That state belongs to one V8 isolate;
//     worker_threads gives us that isolate cleanly.
//   * Audio chunks from the renderer AudioWorklet flow main -> worker
//     via transferable ArrayBuffer (zero-copy).
//
// Protocol (mirrors the Vosk-era worker pattern):
//   main -> worker: {type:'init', modelPath, language, commands}
//                  {type:'waveform', chunk, sampleRate, level}  (transferable)
//                  {type:'preflight'}
//                  {type:'shutdown'}
//   worker -> main: {type:'ready'}
//                  {type:'status', state, message}
//                  {type:'level', value}
//                  {type:'result', text, confidence}
//                  {type:'command-fired', commandId, commandName, direction}
//                  {type:'error', message}
// =====================================================================

'use strict';

const { parentPort } = require('node:worker_threads');
const path = require('node:path');

if (!parentPort) {
  // Loaded outside a worker — refuse to run. The supervisor must spawn
  // us via `new Worker(path)`, not via plain require().
  throw new Error('whisper-worker.js must be loaded as a Worker');
}

// ── Whisper binding ─────────────────────────────────────────────────
//
// The shim lives at <addon>/dist/js/index.js and resolves the native
// .node binary via `__dirname`-relative path. We require it lazily so
// any load failure surfaces as a `status:error` event instead of
// crashing the worker at import time.
let transcribe = null;
let modelPath = null;
let language = 'en';
let commands = [];

function loadBinding() {
  if (transcribe !== null) return transcribe;
  // From `out/main/containers/whisper/whisper-worker.js` we need to
  // reach `node_modules/@kutalia/whisper-node-addon/dist/js/index.js`.
  // The shim's own internal `__dirname`-relative resolution handles the
  // rest, but only if it's loaded from a location that mirrors its
  // package layout. We resolve the addon's package.json from
  // node_modules directly (works in dev + packaged builds).
  try {
    // Resolve the addon's main entry. require.resolve walks node_modules
    // and is the most robust way across dev (cwd=arc-client) and packaged
    // (cwd=resources/app.asar.unpacked).
    const addonEntry = require.resolve('@kutalia/whisper-node-addon');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    transcribe = require(addonEntry).transcribe;
    return transcribe;
  } catch (err) {
    postError('Failed to load @kutalia/whisper-node-addon', err);
    throw err;
  }
}

// ── Gate logic (moved from C# bridge back into pure Node) ──────────
//
// The activation-level gate: level crosses minInputLevel -> open the
// gate; below threshold for >GATE_HOLD_MS -> flush. The min-utterance
// check drops noise blips; the max-utterance cap forces a flush on
// long monologues so the user gets incremental transcriptions.
const GATE_HOLD_MS = 500;
const DEFAULT_MIN_UTTERANCE_MS = 350;
const DEFAULT_MAX_UTTERANCE_MS = 30000;
const WHISPER_SAMPLE_RATE = 16000;

let minInputLevel = 0;
let minUtteranceMs = DEFAULT_MIN_UTTERANCE_MS;
let maxUtteranceMs = DEFAULT_MAX_UTTERANCE_MS;
let gateOpenUntilMs = 0;
let utteranceBuffer = []; // Int16Array chunks concatenated
let utteranceSampleCount = 0;
let utteranceStartedAtMs = 0;
let lastEmittedLevel = 0;

// ── IPC helpers ────────────────────────────────────────────────────

function post(message) {
  parentPort.postMessage(message);
}

function postError(message, err) {
  const detail = err && err.message ? `: ${err.message}` : '';
  post({ type: 'error', message: `${message}${detail}` });
}

function postStatus(state, message) {
  post({ type: 'status', state, message: message || undefined });
}

// ── Audio handling ──────────────────────────────────────────────────

function onWaveform(chunk, sampleRate, level) {
  // Forward the level for the UI meter regardless of gate state. The
  // meter needs to animate even when no speech is detected. Send every
  // chunk — the addon throttles by time, not by value (a steady level
  // should keep producing updates so the meter reflects reality).
  if (typeof level === 'number') {
    post({ type: 'level', value: level });
  }

  // The chunk is an ArrayBuffer holding Int16 PCM at the AudioContext's
  // native rate (typically 44.1 or 48 kHz). Resample to 16 kHz before
  // anything else — whisper.cpp's model is trained on 16 kHz mono and
  // accepts no other rate.
  const srcSamples = new Int16Array(chunk);
  const pcm16k = resampleTo16k(srcSamples, sampleRate);

  const now = Date.now();
  let gateOpen = false;
  if (minInputLevel > 0) {
    if (level >= minInputLevel) {
      gateOpenUntilMs = now + GATE_HOLD_MS;
      gateOpen = true;
    } else {
      gateOpen = now < gateOpenUntilMs;
    }
  } else {
    gateOpen = true;
  }

  if (gateOpen) {
    if (utteranceBuffer.length === 0) {
      utteranceStartedAtMs = now;
    }
    // Copy the resampled chunk into the utterance buffer.
    utteranceBuffer.push(new Int16Array(pcm16k));
    utteranceSampleCount += pcm16k.length;

    // Max-utterance flush (user spoke for too long without pause).
    if (
      utteranceStartedAtMs > 0 &&
      now - utteranceStartedAtMs >= maxUtteranceMs &&
      utteranceSampleCount > 0
    ) {
      flush();
    }
  } else if (utteranceSampleCount > 0) {
    flush();
  }
}

function resampleTo16k(input, inputRate) {
  if (inputRate === WHISPER_SAMPLE_RATE) return input;
  const ratio = WHISPER_SAMPLE_RATE / inputRate;
  const outputLength = Math.max(1, Math.floor(input.length * ratio));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    const sample = input[i0] * (1 - frac) + input[i1] * frac;
    const rounded = Math.round(sample);
    output[i] = rounded < -32768 ? -32768 : rounded > 32767 ? 32767 : rounded;
  }
  return output;
}

function flush() {
  const totalSamples = utteranceSampleCount;
  const startedAt = utteranceStartedAtMs;
  // Snapshot and reset before the (slow) inference starts so the next
  // utterance isn't blocked behind this one.
  const snapshot = new Int16Array(totalSamples);
  let offset = 0;
  for (const part of utteranceBuffer) {
    snapshot.set(part, offset);
    offset += part.length;
  }
  utteranceBuffer = [];
  utteranceSampleCount = 0;
  utteranceStartedAtMs = 0;

  const durationMs = (snapshot.length * 1000) / WHISPER_SAMPLE_RATE;
  if (durationMs < minUtteranceMs) {
    return;
  }

  // Fire-and-forget — the next utterance can start while inference runs.
  runInference(snapshot).catch((err) => postError('Inference crashed', err));
}

async function runInference(int16Pcm) {
  if (!modelPath) {
    postError('No model loaded', new Error('Call init before sending audio'));
    return;
  }
  if (!transcribe) {
    try {
      loadBinding();
    } catch {
      return; // postError already fired
    }
  }

  // Convert Int16 [-32768, 32767] -> Float32 [-1.0, 1.0] for whisper.cpp.
  const pcmf32 = new Float32Array(int16Pcm.length);
  for (let i = 0; i < int16Pcm.length; i++) {
    pcmf32[i] = int16Pcm[i] < 0 ? int16Pcm[i] / 0x8000 : int16Pcm[i] / 0x7fff;
  }

  try {
    const result = await transcribe({
      pcmf32,
      model: modelPath,
      language,
      no_prints: true,
      translate: false
    });
    const transcription = result && result.transcription;
    if (!transcription) return;

    // The shim returns string[][] (one entry per segment) or string[].
    // Normalize to a single string per utterance.
    let text = '';
    if (Array.isArray(transcription)) {
      text = transcription
        .map((segment) => (Array.isArray(segment) ? segment.join(' ') : String(segment)))
        .join(' ')
        .trim();
    } else {
      text = String(transcription).trim();
    }
    if (!text) return;

    post({ type: 'result', text, confidence: 1.0 });
    matchCommand(text);
  } catch (err) {
    postError('transcribe() failed', err);
  }
}

function matchCommand(text) {
  for (const cmd of commands) {
    if (!cmd || !cmd.enabled) continue;
    if (cmd.phrase && textMatches(text, cmd.phrase, cmd.matchType)) {
      post({
        type: 'command-fired',
        commandId: cmd.id,
        commandName: cmd.name,
        direction: 'forward'
      });
      return;
    }
    if (cmd.reversePhrase && textMatches(text, cmd.reversePhrase, cmd.matchType)) {
      post({
        type: 'command-fired',
        commandId: cmd.id,
        commandName: cmd.name,
        direction: 'reverse'
      });
      return;
    }
  }
}

function textMatches(text, phrase, matchType) {
  if (!phrase) return false;
  if (matchType === 'contains') {
    return text.toLowerCase().indexOf(phrase.toLowerCase()) >= 0;
  }
  return text.toLowerCase().trim() === phrase.toLowerCase();
}

// ── Message dispatch ────────────────────────────────────────────────

parentPort.on('message', (msg) => {
  try {
    switch (msg.type) {
      case 'init': {
        if (typeof msg.modelPath !== 'string' || !msg.modelPath) {
          postError('init: modelPath required');
          return;
        }
        modelPath = msg.modelPath;
        language = typeof msg.language === 'string' ? msg.language : 'en';
        commands = Array.isArray(msg.commands) ? msg.commands : [];
        postStatus('ready', `model=${path.basename(modelPath)}`);
        post({ type: 'ready', modelPath, sampleRate: WHISPER_SAMPLE_RATE });
        return;
      }
      case 'configure': {
        if (typeof msg.minInputLevel === 'number') minInputLevel = msg.minInputLevel;
        if (typeof msg.minUtteranceMs === 'number' && msg.minUtteranceMs > 0) {
          minUtteranceMs = msg.minUtteranceMs;
        }
        if (typeof msg.maxUtteranceMs === 'number' && msg.maxUtteranceMs > 0) {
          maxUtteranceMs = msg.maxUtteranceMs;
        }
        return;
      }
      case 'waveform': {
        if (!msg.chunk || !msg.sampleRate) {
          postError('waveform: chunk + sampleRate required');
          return;
        }
        // chunk is transferred (ArrayBuffer ownership moves to us).
        // Copy into a fresh buffer first so the worker's reference
        // doesn't accidentally see the message channel reusing the
        // memory.
        const ab = msg.chunk instanceof ArrayBuffer
          ? msg.chunk
          : msg.chunk.buffer.slice(msg.chunk.byteOffset, msg.chunk.byteOffset + msg.chunk.byteLength);
        onWaveform(ab, msg.sampleRate, msg.level || 0);
        return;
      }
      case 'preflight': {
        try {
          loadBinding();
          post({ type: 'ready', modelPath, sampleRate: WHISPER_SAMPLE_RATE });
        } catch (err) {
          post({ type: 'error', message: `preflight failed: ${err.message}` });
        }
        return;
      }
      case 'shutdown': {
        // Let the parent close the port. Just exit the worker cleanly.
        process.exit(0);
        return;
      }
      default: {
        postError(`unknown command type: ${msg.type}`);
      }
    }
  } catch (err) {
    postError('message handler crashed', err);
  }
});

// ── Crash protection ───────────────────────────────────────────────
//
// Without these handlers, any unhandled exception inside a parentPort
// callback would tear down the worker and force the supervisor to
// respawn from scratch — losing the loaded model in the process.
// We catch everything, post an error event back to main, and keep
// running.
process.on('uncaughtException', (err) => {
  try {
    postError('uncaughtException in worker', err);
  } catch {
    // Even posting failed — there's nothing more to do.
  }
});

process.on('unhandledRejection', (reason) => {
  try {
    postError('unhandledRejection in worker', reason instanceof Error ? reason : new Error(String(reason)));
  } catch {
    // Same as above.
  }
});