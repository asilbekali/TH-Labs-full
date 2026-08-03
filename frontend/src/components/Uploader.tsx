import { useRef, useState } from 'react'
import { motion } from 'framer-motion'

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
      className={`focusable cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
        drag
          ? 'border-brand bg-brand/10'
          : file
            ? 'border-success/50 bg-success/[0.05]'
            : 'border-strong bg-sunken hover:border-brand/50'
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
          <span className="icon-tile h-10 w-10 bg-success/15 text-success">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <div className="text-left">
            <div className="max-w-[220px] truncate text-sm font-medium text-primary">{file.name}</div>
            <div className="text-xs text-muted">{(file.size / 1_048_576).toFixed(1)} MB · click to replace</div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFile(null)
            }}
            className="ml-2 rounded-lg border border-subtle px-2 py-1 text-xs text-muted hover:text-primary"
          >
            Remove
          </button>
        </div>
      ) : (
        <div>
          <motion.span
            animate={{ scale: drag ? 1.1 : 1, y: drag ? -2 : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 24 }}
            className={`icon-tile mx-auto h-11 w-11 ${drag ? 'bg-brand/15 text-brand' : 'bg-surface text-brand'}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0 4 4m-4-4L8 8M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
          </motion.span>
          <div className="mt-2 text-sm font-medium text-primary">Drop a video or audio file</div>
          <div className="text-xs text-muted">or click to browse · MP4, MOV, WAV, MP3</div>
        </div>
      )}
    </div>
  )
}
