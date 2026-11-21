// Base64 <-> PCM for the Gemini Live wire format. The same helpers as the
// Studio's frontend/src/lib/pcm.ts; the downsampling half lives in the
// AudioWorklet (audio-worklet.ts) so it runs off the main thread.

// String.fromCharCode(...bytes) overflows the call stack on large arrays.
const SLICE = 0x8000

/** Little-endian Int16 bytes as base64. */
export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
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
