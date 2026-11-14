// One live translation session, in the browser, straight to Google.
//
// The account API decides whether a session may start and hands out a socket
// URL carrying a one-use token locked to the target language
// (lib/realtime-api.ts). From there this class talks to Gemini Live Translate
// directly — no audio passes through our servers:
//
//   mic → AudioWorklet (Float32, device rate) → 100 ms chunks → 16 kHz Int16
//       → base64 → { realtimeInput: { audio } } → Google
//   Google → serverContent.modelTurn audio (24 kHz Int16) → scheduled
//       back to back on a 24 kHz AudioContext; transcriptions → handlers
//
// The wire format was verified against the real API before this was written
// (api/scripts/gemini-live-smoke.mjs; findings in the realtime plan).
import { base64ToFloat32, downsampleTo16k, int16ToBase64 } from './pcm'
import type { RealtimeSessionGrant } from './realtime-api'

export type LiveState = 'connecting' | 'live' | 'ended'

export interface LiveHandlers {
  onState(state: LiveState): void
  /** Text of what the speaker said, as it is recognised (appended pieces). */
  onInput(text: string): void
  /** Text of the translation, as it is spoken (appended pieces). */
  onOutput(text: string): void
  /** Microphone level, 0..1, for a meter. */
  onLevel?(rms: number): void
  /** Called exactly once. `reason` is null for a normal stop. */
  onEnd(reason: string | null): void
}

const INPUT_MIME = 'audio/pcm;rate=16000'
const OUTPUT_RATE = 24_000
const CHUNK_SECONDS = 0.1
// Small lead so the first chunk is not scheduled in the past.
const PLAYBACK_LEAD = 0.05

// Posts each 128-sample render quantum of the first input channel.
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

interface ServerMessage {
  setupComplete?: object
  goAway?: object
  serverContent?: {
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] }
  }
}

export class LiveTranslateSession {
  private ws: WebSocket | null = null
  private inCtx: AudioContext | null = null
  private outCtx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private frames: Float32Array[] = []
  private framed = 0
  private nextStart = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private ended = false
  private readonly grant: RealtimeSessionGrant
  private readonly stream: MediaStream
  private readonly handlers: LiveHandlers

  constructor(grant: RealtimeSessionGrant, stream: MediaStream, handlers: LiveHandlers) {
    this.grant = grant
    this.stream = stream
    this.handlers = handlers
  }

  async start(): Promise<void> {
    this.handlers.onState('connecting')
    try {
      this.outCtx = new AudioContext({ sampleRate: OUTPUT_RATE })
      this.inCtx = new AudioContext()
      // Started from a click, but after awaits: some browsers create the
      // contexts suspended once the gesture has lapsed.
      await Promise.all([this.outCtx.resume(), this.inCtx.resume()])
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      try {
        await this.inCtx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      this.stop(`Audio could not start (${err instanceof Error ? err.message : String(err)})`)
      return
    }
    if (this.ended) return

    const ws = new WebSocket(this.grant.wsUrl)
    this.ws = ws
    ws.onopen = () => {
      // The token already locks the target language and transcriptions;
      // the setup only has to name the model.
      ws.send(JSON.stringify({ setup: { model: `models/${this.grant.model}` } }))
    }
    ws.onmessage = (event) => {
      void this.onMessage(event.data)
    }
    ws.onclose = (event) => {
      this.stop(
        event.code === 1000 ? null : event.reason || `Connection closed (code ${event.code})`,
      )
    }
  }

  /** Ends the session: mic, audio, socket. Safe to call more than once. */
  stop(reason: string | null = null): void {
    if (this.ended) return
    this.ended = true
    if (this.timer) clearTimeout(this.timer)
    for (const track of this.stream.getTracks()) track.stop()
    this.node?.port.close()
    this.node?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000, 'stopped')
    void this.inCtx?.close().catch(() => {})
    void this.outCtx?.close().catch(() => {})
    this.handlers.onState('ended')
    this.handlers.onEnd(reason)
  }

  private async onMessage(data: unknown): Promise<void> {
    if (this.ended) return
    // Google sends JSON as binary frames in browsers; Blob or string.
    const text = typeof data === 'string' ? data : await (data as Blob).text()
    let msg: ServerMessage
    try {
      msg = JSON.parse(text) as ServerMessage
    } catch {
      return
    }
    if (msg.setupComplete) this.beginCapture()
    if (msg.goAway) this.stop('Google ended the session')
    const content = msg.serverContent
    if (!content) return
    if (content.inputTranscription?.text) this.handlers.onInput(content.inputTranscription.text)
    if (content.outputTranscription?.text) this.handlers.onOutput(content.outputTranscription.text)
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.play(part.inlineData.data)
    }
  }

  private beginCapture(): void {
    const ctx = this.inCtx
    if (!ctx || this.node || this.ended) return
    this.source = ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(ctx, 'pcm-capture')
    // A silent path to the destination keeps the worklet being pulled.
    this.sink = ctx.createGain()
    this.sink.gain.value = 0
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => this.onFrame(event.data)
    this.source.connect(this.node)
    this.node.connect(this.sink)
    this.sink.connect(ctx.destination)
    this.handlers.onState('live')
    this.timer = setTimeout(() => this.stop('Session time is up'), this.grant.maxSeconds * 1000)
  }

  private onFrame(frame: Float32Array): void {
    const ctx = this.inCtx
    if (!ctx || this.ended) return
    if (this.handlers.onLevel) {
      let sum = 0
      for (const s of frame) sum += s * s
      this.handlers.onLevel(Math.sqrt(sum / frame.length))
    }
    this.frames.push(frame)
    this.framed += frame.length
    if (this.framed < ctx.sampleRate * CHUNK_SECONDS) return
    const chunk = new Float32Array(this.framed)
    let at = 0
    for (const f of this.frames) {
      chunk.set(f, at)
      at += f.length
    }
    this.frames = []
    this.framed = 0
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const pcm = downsampleTo16k(chunk, ctx.sampleRate)
    this.ws.send(
      JSON.stringify({ realtimeInput: { audio: { data: int16ToBase64(pcm), mimeType: INPUT_MIME } } }),
    )
  }

  private play(b64: string): void {
    const ctx = this.outCtx
    if (!ctx) return
    const samples = base64ToFloat32(b64)
    if (!samples.length) return
    const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE)
    buffer.getChannelData(0).set(samples)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    const at = Math.max(ctx.currentTime + PLAYBACK_LEAD, this.nextStart)
    src.start(at)
    this.nextStart = at + buffer.duration
  }
}
