// Audio format plumbing for the live translation session (lib/live-translate.ts).
//
// Gemini Live Translate takes 16 kHz mono 16-bit PCM and returns 24 kHz mono
// 16-bit PCM, both base64 in JSON. The browser captures Float32 at whatever
// rate the device runs (usually 48 kHz). Pure functions, so they are tested
// directly: node --test src/lib/pcm.test.ts

const TARGET_RATE = 16_000
// String.fromCharCode(...bytes) overflows the call stack on large arrays.
const SLICE = 0x8000

/** Float32 samples at `inputRate` to 16 kHz Int16, averaging each window. */
export function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const ratio = inputRate / TARGET_RATE
  const length = Math.floor(input.length / ratio)
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const from = Math.floor(i * ratio)
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = from; j < to; j++) sum += input[j]
    const s = Math.max(-1, Math.min(1, sum / (to - from)))
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff)
  }
  return out
}

/** Int16 samples as base64 of their little-endian bytes. */
export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE))
  }
  return btoa(binary)
}

/** Base64 little-endian Int16 PCM to Float32 samples in [-1, 1). */
export function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  const out = new Float32Array(bytes.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000
  return out
}
