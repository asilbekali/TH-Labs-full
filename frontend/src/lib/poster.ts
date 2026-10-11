// Capture one frame of a dub as a small JPEG, to use as its thumbnail.
//
// WorkThumb used to paint a live `<video #t=1 preload=metadata>` per card. That
// is slow (every card fetches and decodes video), and Safari does not paint a
// frame for preload=metadata at all, so cards stayed a coloured gradient. A
// captured poster is an `<img>` that paints immediately, and it is saved on the
// work record, so it is captured once per dub and every device reuses it.
//
// Runs at most two captures at a time so a long library does not open dozens
// of video downloads at once.
const MAX_WIDTH = 480
const QUALITY = 0.72
const TIMEOUT_MS = 20_000
const CONCURRENCY = 2

let active = 0
const queue: Array<() => void> = []
const inflight = new Map<string, Promise<string | null>>()

function next() {
  if (active >= CONCURRENCY) return
  const run = queue.shift()
  if (!run) return
  active++
  run()
}

function grab(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    let done = false
    const finish = (result: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), TIMEOUT_MS)

    // Without CORS approval the canvas is tainted and toDataURL throws; the
    // dubbing API serves media same-origin, so this only matters off that path.
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onerror = () => finish(null)
    video.onloadedmetadata = () => {
      // One second in, not 0: first frames are often black or a fade-in.
      const d = Number.isFinite(video.duration) ? video.duration : 0
      video.currentTime = d > 2 ? 1 : d / 2
    }
    video.onseeked = () => {
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) return finish(null)
        const scale = Math.min(1, MAX_WIDTH / w)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return finish(null)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', QUALITY))
      } catch {
        finish(null)
      }
    }
    video.src = src
  })
}

/** A JPEG data URL of a frame from `src`, or null when it cannot be had. */
export function capturePoster(src: string): Promise<string | null> {
  const existing = inflight.get(src)
  if (existing) return existing
  const p = new Promise<string | null>((resolve) => {
    queue.push(() => {
      void grab(src)
        .then(resolve)
        .finally(() => {
          active--
          inflight.delete(src)
          next()
        })
    })
    next()
  })
  inflight.set(src, p)
  return p
}
