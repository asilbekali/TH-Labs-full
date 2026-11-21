// One dubbing session in the offscreen document.
//
//   tab stream ─┬─▶ originalGain (user's volume) ─────────────▶ speakers
//               └─▶ pcm16k-encoder worklet ─▶ 100 ms base64 ─▶ active socket
//   any socket ─▶ 24 kHz chunks scheduled back to back ─▶ dubGain ─▶ speakers
//
// Capturing a tab mutes it for the user, which is why the original is routed
// to the speakers again at a low volume.
//
// Gemini sessions are capped (5 min by default) and each token opens one
// socket. So a session is a chain of sockets: shortly before the cap, the next
// grant is minted and its socket opened; when it is ready, audio switches to
// it and the old one drains for a few seconds. A dropped socket is replaced
// the same way, with exponential backoff. 429 means today's time is used up.
import {
  DRAIN_MS,
  MAX_RECONNECTS,
  OUTPUT_RATE,
  PLAYBACK_LEAD_SECONDS,
  RECONNECT_BASE_MS,
  ROLLOVER_LEAD_SECONDS,
} from '../config'
import { log } from '../lib/log'
import { ask, RequestError, type EndKind, type SessionGrant } from '../lib/messages'
import { base64ToFloat32, bytesToBase64 } from '../lib/pcm'
import { LiveSocket } from './live-socket'

export interface SessionEvents {
  onStatus(status: 'live' | 'reconnecting'): void
  /** Called once. kind and message are null for a stop the user asked for. */
  onEnded(kind: EndKind | null, message: string | null): void
}

const OUT_OF_TIME = "You've used today's live dubbing time. It resets at midnight UTC."

export class DubSession {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private originalGain: GainNode | null = null
  private encoder: AudioWorkletNode | null = null
  private nextStart = 0

  private active: LiveSocket | null = null
  private pending: LiveSocket | null = null
  private attempts = 0
  private outOfTime = false
  private rolloverTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  private readonly streamId: string
  private readonly language: string
  private readonly events: SessionEvents
  private volume: number

  constructor(streamId: string, language: string, volume: number, events: SessionEvents) {
    this.streamId = streamId
    this.language = language
    this.volume = volume
    this.events = events
  }

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: this.streamId } },
        video: false,
      } as unknown as MediaStreamConstraints)
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      this.ctx = ctx
      await ctx.audioWorklet.addModule(chrome.runtime.getURL('audio-worklet.js'))
      if (this.stopped) return

      const source = ctx.createMediaStreamSource(this.stream)
      this.originalGain = ctx.createGain()
      this.originalGain.gain.value = this.volume
      source.connect(this.originalGain).connect(ctx.destination)

      this.encoder = new AudioWorkletNode(ctx, 'pcm16k-encoder')
      this.encoder.port.onmessage = (e: MessageEvent<ArrayBuffer>) => this.active?.send(bytesToBase64(e.data))
      // A silent path to the destination keeps the worklet being pulled.
      const silent = ctx.createGain()
      silent.gain.value = 0
      source.connect(this.encoder).connect(silent).connect(ctx.destination)

      for (const track of this.stream.getAudioTracks()) {
        track.onended = () => this.end('capture', 'The tab stopped sharing its audio.')
      }
    } catch (err) {
      log('capture failed', err)
      this.end('capture', "Couldn't capture this tab's audio. Reload the tab and try again.")
      return
    }
    await this.connect()
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.ctx && this.originalGain) this.originalGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05)
  }

  /** The user turned dubbing off. */
  stop(): void {
    this.end(null, null)
  }

  // ── socket chain ──────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.stopped || this.pending || this.outOfTime) return
    let grant: SessionGrant
    try {
      grant = await ask<SessionGrant>({ type: 'offscreen/grant', language: this.language })
    } catch (err) {
      if (this.stopped) return
      const status = err instanceof RequestError ? err.status : undefined
      const message = err instanceof Error ? err.message : 'Live dubbing is unavailable right now.'
      if (status === 429) {
        // Let the current socket run to its end; it closes on its own.
        this.outOfTime = true
        if (!this.active) this.end('out-of-time', OUT_OF_TIME)
        return
      }
      if (status === 401) return this.end('auth', 'Your session ended. Please log in again.')
      if (status === 400) return this.end('unavailable', "That language isn't available for live dubbing.")
      if (status === 502 || status === 503) return this.end('unavailable', 'Live dubbing is unavailable right now. Try again shortly.')
      return this.retry(message)
    }
    if (this.stopped) return
    log('session granted', grant.maxSeconds, 's')
    this.pending = new LiveSocket(grant, {
      onReady: (sock) => this.promote(sock),
      onAudio: (b64) => this.play(b64),
      onGoAway: (sock) => {
        if (sock === this.active) void this.connect()
      },
      onClosed: (sock, reason) => this.onClosed(sock, reason),
    })
  }

  private promote(sock: LiveSocket): void {
    if (sock !== this.pending || this.stopped) return sock.close()
    this.pending = null
    const old = this.active
    this.active = sock
    this.attempts = 0
    this.events.onStatus('live')
    if (old) setTimeout(() => old.close(), DRAIN_MS)
    if (this.rolloverTimer) clearTimeout(this.rolloverTimer)
    const after = Math.max(5, sock.grant.maxSeconds - ROLLOVER_LEAD_SECONDS)
    this.rolloverTimer = setTimeout(() => void this.connect(), after * 1000)
  }

  private onClosed(sock: LiveSocket, reason: string): void {
    if (this.stopped) return
    log('socket closed:', reason)
    if (sock === this.pending) {
      this.pending = null
      return this.retry(reason)
    }
    if (sock !== this.active) return // a replaced socket finishing its drain
    this.active = null
    if (this.pending) return this.events.onStatus('reconnecting')
    if (this.outOfTime) return this.end('out-of-time', OUT_OF_TIME)
    this.retry(reason)
  }

  private retry(reason: string): void {
    this.attempts++
    if (this.attempts > MAX_RECONNECTS) {
      log('giving up after', MAX_RECONNECTS, 'tries:', reason)
      return this.end('network', 'Lost the connection to live dubbing. Turn it on again to retry.')
    }
    if (!this.active) this.events.onStatus('reconnecting')
    const delay = RECONNECT_BASE_MS * 2 ** (this.attempts - 1)
    this.retryTimer = setTimeout(() => void this.connect(), delay)
  }

  // ── playback ──────────────────────────────────────────────────────────────

  /** Schedule each chunk right after the previous one; restart the queue after a gap. */
  private play(b64: string): void {
    const ctx = this.ctx
    if (!ctx || this.stopped) return
    const samples = base64ToFloat32(b64)
    if (!samples.length) return
    const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE)
    buffer.getChannelData(0).set(samples)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    const at = Math.max(ctx.currentTime + PLAYBACK_LEAD_SECONDS, this.nextStart)
    src.start(at)
    this.nextStart = at + buffer.duration
  }

  // ── teardown ──────────────────────────────────────────────────────────────

  private end(kind: EndKind | null, message: string | null): void {
    if (this.stopped) return
    this.stopped = true
    if (this.rolloverTimer) clearTimeout(this.rolloverTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.active?.close()
    this.pending?.close()
    this.encoder?.port.close()
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    void this.ctx?.close().catch(() => {})
    this.events.onEnded(kind, message)
  }
}
