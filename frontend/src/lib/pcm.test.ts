// Run with: node --test src/lib/pcm.test.ts (Node >= 22.6 strips the types).
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { base64ToFloat32, downsampleTo16k, int16ToBase64 } from './pcm.ts'

test('48 kHz becomes 16 kHz: 480 samples to 160', () => {
  assert.equal(downsampleTo16k(new Float32Array(480), 48_000).length, 160)
})

test('16 kHz input keeps its length', () => {
  assert.equal(downsampleTo16k(new Float32Array(160), 16_000).length, 160)
})

test('a constant 0.5 maps to about half of full scale', () => {
  const out = downsampleTo16k(new Float32Array(480).fill(0.5), 48_000)
  for (const s of out) assert.ok(Math.abs(s - 16384) <= 1, `got ${s}`)
})

test('values beyond full scale clamp instead of wrapping', () => {
  const out = downsampleTo16k(Float32Array.from([2, 2, 2, -2, -2, -2]), 48_000)
  assert.deepEqual([...out], [32767, -32768])
})

test('44.1 kHz input is decimated to the right length', () => {
  assert.equal(downsampleTo16k(new Float32Array(4410), 44_100).length, 1600)
})

test('base64 round trip recovers the samples', () => {
  const pcm = Int16Array.from([0, 1, -1, 12345, -32768, 32767])
  const back = base64ToFloat32(int16ToBase64(pcm))
  assert.equal(back.length, pcm.length)
  pcm.forEach((s, i) => assert.ok(Math.abs(back[i] - s / 32768) < 1e-4))
})

test('base64 survives buffers larger than one encoding slice', () => {
  const pcm = new Int16Array(100_000).map((_, i) => (i % 2000) - 1000)
  const back = base64ToFloat32(int16ToBase64(pcm))
  assert.equal(back.length, pcm.length)
  assert.ok(Math.abs(back[99_999] - pcm[99_999] / 32768) < 1e-4)
})
