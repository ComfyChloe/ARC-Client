// =====================================================================
// whisperCapture.ts
//
// Renderer-side microphone capture for the Whisper speech-recognition
// addon. Lives at module scope so capture survives route navigation —
// the main process drives it via `whisper-capture-control` push events
// and receives Int16 PCM chunks back over IPC.
//
// Pipeline:
//   navigator.mediaDevices.getUserMedia (mic device, no processing)
//     -> AudioContext (native sample rate, typically 48 kHz)
//     -> AudioWorkletNode (whisper-capture-processor)
//        -> port.postMessage({chunk, level}) every 4096 samples
//        -> api.whisperSendAudio(chunk, sampleRate, level)   [-> main process]
//        -> onWhisperLevel(level) listeners                 [-> UI meter]
// =====================================================================

import whisperWorkletSource from '../assets/whisper/worklet.js?raw'

type LevelListener = (level: number) => void
type Unsubscribe = () => boolean

interface CaptureControlPayload {
  action: 'start' | 'stop' | 'update' | 'device-list'
  deviceId?: string | null
  gain?: number
  devices?: ReadonlyArray<{ id: string; name: string }>
}

interface ElectronAPI {
  onWhisperCaptureControl(cb: (control: CaptureControlPayload) => void): () => void
  whisperSendAudio(chunk: ArrayBuffer, sampleRate: number, level: number): void
  // Dedicated level channel. Level events used to flow through
  // onWhisperCaptureControl with action='update' and gain=<level>,
  // which we mistakenly applied as a SETGAIN to the AudioWorklet —
  // causing a feedback loop on loud mics. Split this out so the
  // UI level meter and the mic gain are independent.
  onWhisperLevel(cb: (level: number) => void): () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

let audioContext: AudioContext | null = null
let mediaStream: MediaStream | null = null
let sourceNode: MediaStreamAudioSourceNode | null = null
let workletNode: AudioWorkletNode | null = null
let starting = false
let currentGain = 1
// The deviceId the current MediaStream is bound to. Used to detect a
// device-change mid-capture so we reopen the stream instead of
// silently keeping the OLD mic. null means "system default".
let currentDeviceId: string | null = null
const levelListeners = new Set<LevelListener>()
let registered = false
let workletBlobUrl: string | null = null

async function ensureWorkletUrl(): Promise<string> {
  if (workletBlobUrl) return workletBlobUrl
  if (!whisperWorkletSource) {
    throw new Error('Whisper worklet source is empty (build-time ?raw import failed)')
  }
  const blob = new Blob([whisperWorkletSource], { type: 'application/javascript' })
  workletBlobUrl = URL.createObjectURL(blob)
  return workletBlobUrl
}

function api(): ElectronAPI {
  return window.electronAPI
}

export function onWhisperLevel(listener: LevelListener): Unsubscribe {
  levelListeners.add(listener)
  return () => levelListeners.delete(listener)
}

export function isCapturing(): boolean {
  return !!workletNode
}

export async function listInputDevices(): Promise<Array<{ deviceId: string; label: string }>> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label || `Microphone (${device.deviceId.slice(0, 8)})` }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[whisper-capture] enumerateDevices failed:', message)
    return []
  }
}

export async function startCapture(deviceId: string | null, gain: number): Promise<void> {
  if (starting) return
  // If we are already capturing on the requested device, nothing to
  // do — saves a needless MediaStream tear-down + re-acquisition.
  // If the deviceId changed (e.g. user picked a different mic in the
  // dropdown), we MUST reopen the stream — the existing MediaStream is
  // still bound to the OLD device.
  if (workletNode && currentDeviceId === deviceId) return
  starting = true
  try {
    stopCapture()

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })

    audioContext = new AudioContext()
    currentGain = gain
    currentDeviceId = deviceId
    const workletUrl = await ensureWorkletUrl()
    await audioContext.audioWorklet.addModule(workletUrl)

    sourceNode = audioContext.createMediaStreamSource(mediaStream)
    workletNode = new AudioWorkletNode(audioContext, 'whisper-capture-processor')
    workletNode.port.onmessage = (event: MessageEvent<{ chunk: ArrayBuffer; level: number }>): void => {
      // Forward the chunk to the main process over IPC. The ArrayBuffer
      // is already transferred (zero-copy on the renderer->main hop).
      api().whisperSendAudio(event.data.chunk, audioContext!.sampleRate, event.data.level)
      // Notify UI listeners (level meter) so they can animate without
      // going through IPC.
      for (const fn of levelListeners) {
        try {
          fn(event.data.level)
        } catch {
          /* swallow listener errors */
        }
      }
    }
    workletNode.port.postMessage({ gain: currentGain })
    sourceNode.connect(workletNode)
  } catch (err) {
    stopCapture()
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[whisper-capture] startCapture failed:', message)
    throw err
  } finally {
    starting = false
  }
}

export function stopCapture(): void {
  try {
    workletNode?.disconnect()
  } catch {
    /* swallow */
  }
  try {
    sourceNode?.disconnect()
  } catch {
    /* swallow */
  }
  try {
    mediaStream?.getTracks().forEach((track) => track.stop())
  } catch {
    /* swallow */
  }
  try {
    void audioContext?.close()
  } catch {
    /* swallow */
  }
  workletNode = null
  sourceNode = null
  mediaStream = null
  audioContext = null
  // Clear the deviceId binding so the next startCapture() with a
  // different deviceId correctly takes the "different device" path.
  currentDeviceId = null
}

export function setGain(gain: number): void {
  currentGain = gain
  workletNode?.port.postMessage({ gain })
}

/**
 * Wires the capture-control IPC event from the main process to the
 * local startCapture/stopCapture/setGain flow. Called once from
 * renderer/src/main.ts at boot.
 */
export function registerWhisperCapture(): void {
  if (registered) return
  registered = true
  try {
    api().onWhisperCaptureControl((control) => {
      if (control.action === 'start') {
        void startCapture(control.deviceId ?? null, control.gain ?? 1)
      } else if (control.action === 'stop') {
        stopCapture()
      }
      // The `update` action used to carry the live RMS level value
      // in `gain`. We no longer treat that as a SETGAIN — see the
      // note on the onWhisperLevel listener below. The capture-
      // control IPC now only carries start/stop actions.
    })
    // Dedicated level channel — fires every AudioWorklet chunk
    // (every ~85ms at 48 kHz). Forwards to registered levelListeners
    // (e.g. the UI meter in WhisperPage). This used to be routed
    // through onWhisperCaptureControl({action:'update', gain:<level>})
    // which the listener above mistakenly applied as SETGAIN to
    // the AudioWorklet — see the package commit history for why
    // that was a feedback loop with loud mics.
    api().onWhisperLevel((level) => {
      for (const fn of levelListeners) {
        try {
          fn(level)
        } catch {
          /* swallow listener errors */
        }
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[whisper-capture] failed to register capture-control listener:', message)
  }
}

export default {
  onWhisperLevel,
  isCapturing,
  listInputDevices,
  startCapture,
  stopCapture,
  setGain,
  registerWhisperCapture
}