// Microphone capture for the Vosk addon. Lives at module level (not component
// state) so capture survives route navigation; the main process drives it via
// 'vosk-capture-control' messages and receives Int16 PCM chunks back over IPC.

import voskWorkletSource from '../assets/vosk/worklet.js?raw'

type LevelListener = (level: number) => void

let audioContext: AudioContext | null = null
let mediaStream: MediaStream | null = null
let sourceNode: MediaStreamAudioSourceNode | null = null
let workletNode: AudioWorkletNode | null = null
let starting = false
let currentGain = 1
const levelListeners = new Set<LevelListener>()
let registered = false
// Cached blob URL for the AudioWorklet source. The worklet is bundled into the
// renderer JS at build time via Vite's `?raw` import — no runtime fetch, no
// dependency on Assets/ publicDir copying. Wrapped in a Blob URL because the
// AudioWorklet addModule call only accepts URLs/importable module specifiers.
let workletBlobUrl: string | null = null

async function ensureWorkletUrl(): Promise<string> {
  if (workletBlobUrl) return workletBlobUrl
  if (!voskWorkletSource) {
    throw new Error('Vosk worklet source is empty (build-time ?raw import failed)')
  }
  const blob = new Blob([voskWorkletSource], { type: 'application/javascript' })
  workletBlobUrl = URL.createObjectURL(blob)
  return workletBlobUrl
}

function api() {
  return window.electronAPI
}

export function onVoskLevel(listener: LevelListener): () => void {
  levelListeners.add(listener)
  return () => levelListeners.delete(listener)
}

export function isCapturing(): boolean {
  return !!workletNode
}

export async function listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
  // Electron auto-grants media permissions via session.setPermissionRequestHandler in
  // main/index.ts, so device labels populate on first enumerateDevices call. We
  // don't need to probe getUserMedia just to trigger a permission prompt.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter(device => device.kind === 'audioinput')
      .map(device => ({ deviceId: device.deviceId, label: device.label || `Microphone (${device.deviceId.slice(0, 8)})` }))
  } catch (error) {
    console.error('Vosk device enumeration failed:', error)
    return []
  }
}

export async function startCapture(deviceId?: string | null, gain = 1): Promise<void> {
  if (starting) return
  starting = true
  try {
    stopCapture()
    currentGain = gain
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
    audioContext = new AudioContext()
    const workletUrl = await ensureWorkletUrl()
    await audioContext.audioWorklet.addModule(workletUrl)
    sourceNode = audioContext.createMediaStreamSource(mediaStream)
    workletNode = new AudioWorkletNode(audioContext, 'vosk-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit'
    })
    workletNode.port.postMessage({ gain: currentGain })
    const sampleRate = audioContext.sampleRate
    workletNode.port.onmessage = (event: MessageEvent<{ chunk: ArrayBuffer; level: number }>) => {
      const { chunk, level } = event.data
      api().voskSendAudio(chunk, sampleRate, level)
      levelListeners.forEach(listener => listener(level))
    }
    sourceNode.connect(workletNode)
  } catch (error) {
    stopCapture()
    throw error
  } finally {
    starting = false
  }
}

export function stopCapture(): void {
  if (workletNode) {
    workletNode.port.onmessage = null
    try { workletNode.disconnect() } catch { /* already disconnected */ }
    workletNode = null
  }
  if (sourceNode) {
    try { sourceNode.disconnect() } catch { /* already disconnected */ }
    sourceNode = null
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop())
    mediaStream = null
  }
  if (audioContext) {
    void audioContext.close().catch(() => undefined)
    audioContext = null
  }
  levelListeners.forEach(listener => listener(0))
}

export function setGain(gain: number): void {
  currentGain = gain
  workletNode?.port.postMessage({ gain })
}

/** Hook up the main-process control channel. Called once at app startup. */
export function registerVoskCapture(): void {
  if (registered) return
  registered = true
  api().onVoskCaptureControl(async (control: { action: string; deviceId?: string | null; gain?: number }) => {
    try {
      if (control.action === 'start') {
        await startCapture(control.deviceId ?? undefined, control.gain ?? 1)
      } else if (control.action === 'stop') {
        stopCapture()
      } else if (control.action === 'update' && typeof control.gain === 'number') {
        setGain(control.gain)
      }
    } catch (error) {
      console.error('Vosk capture control failed:', error)
    }
  })
}
