import { useRef, useState } from 'react'

export default function Uploader({
  file,
  onFile,
  disabled,
}: {
  file: File | null
  onFile: (f: File | null) => void
  disabled?: boolean
}) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const pick = (f: File | null) => {
    if (!f) return onFile(null)
    if (!f.type.startsWith('video/') && !f.type.startsWith('audio/')) return
    onFile(f)
  }

  return (
    <div>
      <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.14em] text-text-3">
        Source media
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          if (!disabled) pick(e.dataTransfer.files?.[0] ?? null)
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border border-dashed p-6 text-center transition-colors ${
          drag
            ? 'border-accent/70 bg-accent-dim'
            : file
              ? 'border-ok/40 bg-ok/[0.04]'
              : 'border-line-strong bg-white/[0.02] hover:border-white/30'
        } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-ok/15 text-ok">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 6 9 17l-5-5" /></svg>
            </span>
            <div className="text-left">
              <div className="max-w-[220px] truncate font-mono text-sm font-medium text-white">{file.name}</div>
              <div className="text-xs text-text-2">{(file.size / 1_048_576).toFixed(1)} MB · click to replace</div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onFile(null)
              }}
              className="btn-ghost focus-ring ml-2 px-2.5 py-1 text-xs"
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-lg bg-white/5 text-accent">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0 4 4m-4-4L8 8M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
            </span>
            <div className="mt-3 font-mono text-sm font-medium text-white">Drop a video or audio file</div>
            <div className="mt-1 text-xs text-text-3">or click to browse · MP4, MOV, WAV, MP3</div>
          </div>
        )}
      </div>
    </div>
  )
}
