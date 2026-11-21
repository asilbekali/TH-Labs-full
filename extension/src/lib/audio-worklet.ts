// AudioWorklet: tab audio (Float32, stereo, device rate) → 16 kHz mono Int16
// in 100 ms blocks, the format Gemini Live Translate takes.
//
// Runs on the audio thread and is loaded by URL with audioWorklet.addModule(),
// so it must import nothing: the build keeps it as one self-contained file.
// Each finished block is posted to the main thread as a transferred
// ArrayBuffer (3,200 bytes), so nothing is copied twice.

// The worklet global scope is not in TypeScript's DOM lib.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

const TARGET_RATE = 16_000
const BLOCK = 1_600 // 100 ms at 16 kHz

class Pcm16kEncoder extends AudioWorkletProcessor {
  private readonly ratio = sampleRate / TARGET_RATE
  // Input samples needed for one output block, e.g. 4,800 at 48 kHz.
  private readonly need = Math.ceil(BLOCK * this.ratio)
  private readonly buffer = new Float32Array(this.need)
  private filled = 0

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0]
    if (!channels || channels.length === 0) return true
    const frames = channels[0].length
    for (let i = 0; i < frames; i++) {
      // Mix down to mono: tab audio is usually stereo.
      let sum = 0
      for (let c = 0; c < channels.length; c++) sum += channels[c][i]
      this.buffer[this.filled++] = sum / channels.length
      if (this.filled === this.need) {
        this.flush()
        this.filled = 0
      }
    }
    return true
  }

  /** Average each ratio-wide window into one 16 kHz sample. */
  private flush(): void {
    const out = new Int16Array(BLOCK)
    for (let i = 0; i < BLOCK; i++) {
      const from = Math.floor(i * this.ratio)
      const to = Math.min(this.need, Math.max(from + 1, Math.floor((i + 1) * this.ratio)))
      let sum = 0
      for (let j = from; j < to; j++) sum += this.buffer[j]
      const s = Math.max(-1, Math.min(1, sum / (to - from)))
      out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff)
    }
    this.port.postMessage(out.buffer, [out.buffer])
  }
}

registerProcessor('pcm16k-encoder', Pcm16kEncoder)
