// Pieces of a live session that work on the device alone: a microphone meter
// and a preview of the camera or a shared screen. Neither sends anything.
import { useEffect, useRef } from 'react'

const BARS = 7

export function MicMeter({ stream, muted }: { stream: MediaStream | null; muted: boolean }) {
  const barsRef = useRef<HTMLDivElement>(null)

  // Written straight to the DOM every frame, so the level never re-renders React.
  useEffect(() => {
    const bars = Array.from(barsRef.current?.children ?? []) as HTMLElement[]
    const draw = (level: number) =>
      bars.forEach((bar, i) => {
        const shape = 1 - Math.abs(i - (BARS - 1) / 2) / BARS
        bar.style.height = `${Math.max(12, Math.min(100, level * shape * 260))}%`
      })
    if (!stream || muted) {
      draw(0)
      return
    }

    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    ctx.createMediaStreamSource(stream).connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let frame = 0
    const tick = () => {
      analyser.getByteFrequencyData(data)
      draw(data.reduce((sum, v) => sum + v, 0) / data.length / 255)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(frame)
      void ctx.close()
    }
  }, [stream, muted])

  return (
    <div ref={barsRef} aria-hidden className="flex h-6 items-center gap-[3px]">
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className="h-[12%] w-[3px] rounded-full bg-brand transition-[height] duration-75" />
      ))}
    </div>
  )
}

export function StreamPreview({ stream, label }: { stream: MediaStream; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])

  return (
    <div className="relative overflow-hidden rounded-[12px] bg-black">
      <video ref={videoRef} autoPlay muted playsInline aria-label={label} className="aspect-video max-h-56 w-full object-contain" />
      <span className="absolute left-2 top-2 rounded-[6px] bg-black/70 px-2 py-0.5 text-[12px] text-white">
        {label}
      </span>
    </div>
  )
}
