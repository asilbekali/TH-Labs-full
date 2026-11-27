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
// A grant is short (a minute), so with `renew` a session is a chain of sockets:
// when a grant runs out the next one is minted and its socket opened, and the
// microphone moves over once it is ready. Google keeps the old socket open a
// few seconds past its grant, which covers the hand-over.
//
// The wire format was verified against the real API before this was written
// (api/scripts/gemini-live-smoke.mjs; findings in the realtime plan).
import { base64ToFloat32, downsampleTo16k, int16ToBase64 } from './pcm.ts'
import type { RealtimeSessionGrant } from './realtime-api.ts'

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
// Socket open but no setupComplete by then: give up rather than hang.
const CONNECT_TIMEOUT_MS = 15_000
// How long a replaced socket stays open to deliver what it still owes.
const DRAIN_MS = 4_000
const DECODER = new TextDecoder()

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
  /** The next socket in the chain, until it is ready to take over. */
  private nextWs: WebSocket | null = null
  private oldWs: WebSocket | null = null
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private renewing = false
  private inCtx: AudioContext | null = null
  private outCtx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private frames: Float32Array[] = []
  private framed = 0
  private nextStart = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private ended = false
  private grant: RealtimeSessionGrant
  private readonly stream: MediaStream
  private readonly handlers: LiveHandlers
  private readonly connectTimeoutMs: number
  private readonly renew?: () => Promise<RealtimeSessionGrant>

  constructor(
    grant: RealtimeSessionGrant,
    stream: MediaStream,
    handlers: LiveHandlers,
    options: {
      connectTimeoutMs?: number
      /** Mints the grant to carry on with. Without it the session ends at `maxSeconds`. */
      renew?: () => Promise<RealtimeSessionGrant>
    } = {},
  ) {
    this.grant = grant
    this.stream = stream
    this.handlers = handlers
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
    this.renew = options.renew
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

    this.ws = this.openSocket(this.grant)
  }

  private openSocket(grant: RealtimeSessionGrant): WebSocket | null {
    let ws: WebSocket
    try {
      ws = new WebSocket(grant.wsUrl)
    } catch (err) {
      this.stop(`Could not reach the translation service (${err instanceof Error ? err.message : String(err)})`)
      return null
    }
    // ArrayBuffer, decoded synchronously: with Blobs each message needs an
    // async .text(), and those can settle out of order — audio chunks and
    // transcript pieces would then play and print out of order.
    ws.binaryType = 'arraybuffer'
    this.connectTimer = setTimeout(
      () => this.stop('Could not connect to the translation service. Try again.'),
      this.connectTimeoutMs,
    )
    ws.onopen = () => {
      // The token already locks the target language and transcriptions;
      // the setup only has to name the model.
      ws.send(JSON.stringify({ setup: { model: `models/${grant.model}` } }))
    }
    ws.onmessage = (event) => {
      try {
        this.onMessage(ws, event.data)
      } catch (err) {
        // Anything thrown here (starting the microphone, playing audio) would
        // otherwise be lost and leave the session stuck connecting.
        this.stop(err instanceof Error ? err.message : String(err))
      }
    }
    ws.onclose = (event) => {
      // A replaced socket, or one whose replacement is on its way.
      if (ws !== this.ws && ws !== this.nextWs) return
      if (ws === this.ws && this.renewing) return
      this.stop(
        event.code === 1000 ? null : event.reason || `Connection closed (code ${event.code})`,
      )
    }
    return ws
  }

  /** The grant has run out: carry on with a new one, or end. */
  private async rollOver(): Promise<void> {
    if (!this.renew) return this.stop('Session time is up')
    this.renewing = true
    let grant: RealtimeSessionGrant
    try {
      grant = await this.renew()
    } catch (err) {
      this.stop(err instanceof Error ? err.message : 'Session time is up')
      return
    }
    if (this.ended) return
    this.grant = grant
    this.nextWs = this.openSocket(grant)
  }

  private promote(next: WebSocket): void {
    this.oldWs = this.ws
    this.drainTimer = setTimeout(() => this.oldWs?.close(1000, 'replaced'), DRAIN_MS)
    this.ws = next
    this.nextWs = null
    this.renewing = false
    this.startTimer()
  }

  private startTimer(): void {
    this.timer = setTimeout(() => void this.rollOver(), this.grant.maxSeconds * 1000)
  }

  /** Ends the session: mic, audio, socket. Safe to call more than once. */
  stop(reason: string | null = null): void {
    if (this.ended) return
    this.ended = true
    if (this.timer) clearTimeout(this.timer)
    if (this.connectTimer) clearTimeout(this.connectTimer)
    if (this.drainTimer) clearTimeout(this.drainTimer)
    for (const track of this.stream.getTracks()) track.stop()
    this.node?.port.close()
    this.node?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    for (const ws of [this.ws, this.nextWs, this.oldWs]) {
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'stopped')
    }
    void this.inCtx?.close().catch(() => {})
    void this.outCtx?.close().catch(() => {})
    this.handlers.onState('ended')
    this.handlers.onEnd(reason)
  }

  private onMessage(ws: WebSocket, data: unknown): void {
    if (this.ended) return
    // Google sends its JSON as binary frames in browsers.
    const text = typeof data === 'string' ? data : DECODER.decode(data as ArrayBuffer)
    let msg: ServerMessage
    try {
      msg = JSON.parse(text) as ServerMessage
    } catch {
      return
    }
    if (msg.setupComplete) {
      if (this.connectTimer) clearTimeout(this.connectTimer)
      this.connectTimer = null
      if (ws === this.nextWs) this.promote(ws)
      else this.beginCapture()
    }
    // Sent ahead of a close. With `renew` the next socket is due anyway, and
    // starting it early would pay for the same seconds twice.
    if (msg.goAway && !this.renew) this.stop('The translation service ended the session')
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
    this.startTimer()
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
