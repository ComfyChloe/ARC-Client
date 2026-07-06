// AudioWorklet processor for the Vosk addon: applies input gain, converts
// float32 mono audio to Int16 PCM chunks and reports each chunk's RMS level.
class VoskCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.gain = 1
    this.chunkSize = 4096
    this.buffer = new Int16Array(this.chunkSize)
    this.index = 0
    this.sumSquares = 0
    this.port.onmessage = (event) => {
      if (event.data && typeof event.data.gain === 'number') {
        this.gain = event.data.gain
      }
    }
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      let sample = channel[i] * this.gain
      if (sample > 1) sample = 1
      else if (sample < -1) sample = -1
      this.sumSquares += sample * sample
      this.buffer[this.index++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      if (this.index >= this.chunkSize) {
        const rms = Math.sqrt(this.sumSquares / this.chunkSize)
        const level = Math.min(100, Math.round(rms * 100))
        const chunk = this.buffer.slice(0)
        this.port.postMessage({ chunk: chunk.buffer, level }, [chunk.buffer])
        this.index = 0
        this.sumSquares = 0
      }
    }
    return true
  }
}
registerProcessor('vosk-capture-processor', VoskCaptureProcessor)
