// Run with: node --test src/lib/live-translate.test.ts
// LiveTranslateSession against stand-ins for the browser's WebSocket and Web
// Audio, so its failure paths can be driven deliberately.
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { LiveTranslateSession } from './live-translate.ts'
import type { RealtimeSessionGrant } from './realtime-api.ts'

class FakeSocket {
  static OPEN = 1
  static last: FakeSocket | null = null
  readyState = 0
  binaryType = 'blob'
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.last = this
  }
  send(data: string) {
    this.sent.push(data)
  }
  close(code = 1000, reason = '') {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(msg: object) {
    this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(msg)).buffer })
  }
}

let failSource = false
class FakeAudioContext {
  sampleRate = 48_000
  currentTime = 0
  destination = {}
  audioWorklet = { addModule: async () => {} }
  resume = async () => {}
  close = async () => {}
  createMediaStreamSource() {
    if (failSource) throw new Error('no audio input')
    return { connect() {}, disconnect() {} }
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} }
  }
  createBuffer(_ch: number, length: number) {
    const data = new Float32Array(length)
    return { duration: length / 24_000, getChannelData: () => data }
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {} }
  }
}
class FakeWorkletNode {
  port = { onmessage: null, close() {} }
  connect() {}
  disconnect() {}
}

const g = globalThis as Record<string, unknown>
g.WebSocket = FakeSocket
g.AudioContext = FakeAudioContext
g.AudioWorkletNode = FakeWorkletNode

const grant: RealtimeSessionGrant = {
  token: 't',
  model: 'm',
  wsUrl: 'wss://example/ws',
  targetLanguage: 'uz',
  expiresAt: '',
  maxSeconds: 300,
  remainingSecondsToday: 0,
}

function session(opts?: { connectTimeoutMs?: number }) {
  const stopped: string[] = []
  const stream = { getTracks: () => [{ stop: () => stopped.push('track') }] } as unknown as MediaStream
  const events = { ended: [] as (string | null)[], output: [] as string[], states: [] as string[] }
  const s = new LiveTranslateSession(
    grant,
    stream,
    {
      onState: (st) => events.states.push(st),
      onInput: () => {},
      onOutput: (t) => events.output.push(t),
      onEnd: (r) => events.ended.push(r),
    },
    opts,
  )
  return { s, events, stopped }
}

beforeEach(() => {
  failSource = false
  FakeSocket.last = null
})

test('messages are decoded in the order they arrive', async () => {
  const { s, events } = session()
  await s.start()
  const ws = FakeSocket.last!
  assert.equal(ws.binaryType, 'arraybuffer')
  ws.open()
  ws.receive({ serverContent: { outputTranscription: { text: 'Xush ' } } })
  ws.receive({ serverContent: { outputTranscription: { text: 'kelibsiz' } } })
  assert.deepEqual(events.output, ['Xush ', 'kelibsiz'])
  s.stop()
})

test('a session that never finishes connecting ends with a reason', async () => {
  const { s, events, stopped } = session({ connectTimeoutMs: 20 })
  await s.start()
  FakeSocket.last!.open() // socket opens, but setupComplete never comes
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(events.ended.length, 1)
  assert.match(events.ended[0] ?? '', /could not connect/i)
  assert.deepEqual(stopped, ['track'])
})

test('a failure while starting the microphone ends the session instead of hanging', async () => {
  failSource = true
  const { s, events } = session()
  await s.start()
  const ws = FakeSocket.last!
  ws.open()
  ws.receive({ setupComplete: {} })
  assert.equal(events.ended.length, 1)
  assert.match(events.ended[0] ?? '', /no audio input/)
})

test('onEnd fires once however many ways the session stops', async () => {
  const { s, events } = session()
  await s.start()
  s.stop()
  s.stop()
  FakeSocket.last!.close(1011, 'auth token has expired')
  assert.deepEqual(events.ended, [null])
})
