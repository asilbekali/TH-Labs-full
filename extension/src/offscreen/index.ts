// The offscreen document: hosts the audio session, because a service worker
// has no getUserMedia, AudioContext or audio output.
import { ask, type OffscreenCommand } from '../lib/messages'
import { DubSession } from './session'

const PING_MS = 20_000

let session: DubSession | null = null
let ping: ReturnType<typeof setInterval> | null = null

function stopPing(): void {
  if (ping) clearInterval(ping)
  ping = null
}

chrome.runtime.onMessage.addListener((msg: OffscreenCommand) => {
  if (msg?.target !== 'offscreen') return false
  switch (msg.type) {
    case 'start': {
      session?.stop()
      const current = new DubSession(msg.streamId, msg.language, msg.volume, {
        onStatus: (status) => {
          if (session === current) void ask({ type: 'offscreen/state', status }).catch(() => {})
        },
        onEnded: (kind, message) => {
          if (session !== current) return
          session = null
          stopPing()
          // A stop the user asked for is already handled by the background.
          if (kind || message) void ask({ type: 'offscreen/ended', kind, message }).catch(() => {})
        },
      })
      session = current
      // Messages keep the service worker awake while audio is flowing.
      stopPing()
      ping = setInterval(() => void ask({ type: 'offscreen/ping' }).catch(() => {}), PING_MS)
      void current.start()
      break
    }
    case 'stop':
      session?.stop()
      break
    case 'volume':
      session?.setVolume(msg.volume)
      break
  }
  return false
})
