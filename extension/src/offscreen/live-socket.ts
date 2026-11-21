// One Gemini Live Translate WebSocket, opened with one session grant.
// The protocol is in BACKEND_CONTRACT.md section 3; the Studio's
// frontend/src/lib/live-translate.ts speaks the same one.
import { CONNECT_TIMEOUT_MS, INPUT_MIME } from '../config'
import type { SessionGrant } from '../lib/messages'

export interface LiveSocketHandlers {
  /** setupComplete arrived: audio may flow. */
  onReady(sock: LiveSocket): void
  /** Base64 24 kHz s16le dubbed audio. */
  onAudio(b64: string): void
  /** Google warned it will close this socket soon. */
  onGoAway(sock: LiveSocket): void
  /** Closed by the other side or failed to open. Not called after close(). */
  onClosed(sock: LiveSocket, reason: string): void
}

interface ServerMessage {
  setupComplete?: object
  goAway?: object
  serverContent?: { modelTurn?: { parts?: { inlineData?: { data?: string } }[] } }
}

const DECODER = new TextDecoder()

export class LiveSocket {
  readonly grant: SessionGrant
  ready = false
  private readonly ws: WebSocket
  private readonly handlers: LiveSocketHandlers
  private connectTimer: ReturnType<typeof setTimeout> | null
  private done = false

  constructor(grant: SessionGrant, handlers: LiveSocketHandlers) {
    this.grant = grant
    this.handlers = handlers
    this.ws = new WebSocket(grant.wsUrl)
    // Google sends JSON as binary frames; ArrayBuffers decode synchronously,
    // so audio chunks are handled in the order they arrived.
    this.ws.binaryType = 'arraybuffer'
    this.connectTimer = setTimeout(() => this.fail('Timed out connecting'), CONNECT_TIMEOUT_MS)
    this.ws.onopen = () => {
      // The token already locks the language and model config.
      this.ws.send(JSON.stringify({ setup: { model: `models/${grant.model}` } }))
    }
    this.ws.onmessage = (e) => this.onMessage(e.data)
    this.ws.onclose = (e) => this.fail(e.reason || `Connection closed (code ${e.code})`)
  }

  send(pcm: string): void {
    if (this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: pcm, mimeType: INPUT_MIME } } }))
    }
  }

  /** Close on purpose: no onClosed callback follows. */
  close(): void {
    if (this.done) return
    this.done = true
    this.clearTimer()
    if (this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000, 'stopped')
  }

  private onMessage(data: unknown): void {
    if (this.done) return
    let msg: ServerMessage
    try {
      msg = JSON.parse(typeof data === 'string' ? data : DECODER.decode(data as ArrayBuffer)) as ServerMessage
    } catch {
      return
    }
    if (msg.setupComplete && !this.ready) {
      this.ready = true
      this.clearTimer()
      this.handlers.onReady(this)
    }
    if (msg.goAway) this.handlers.onGoAway(this)
    for (const part of msg.serverContent?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.handlers.onAudio(part.inlineData.data)
    }
  }

  private fail(reason: string): void {
    if (this.done) return
    this.done = true
    this.clearTimer()
    if (this.ws.readyState <= WebSocket.OPEN) this.ws.close()
    this.handlers.onClosed(this, reason)
  }

  private clearTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = null
  }
}
