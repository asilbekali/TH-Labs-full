import { useRef } from 'react'

/**
 * How the dub should sound: whose voice, and in what accent.
 *
 * This replaces the old single "Voice cloning" on/off toggle, which could only
 * say "clone" or "don't" and had no way to express the middle option people
 * actually want most — the speaker's own timbre, but pronounced like a native
 * rather than carrying their accent across.
 *
 * `voice_clone` is still sent to the pipeline and is derived from the mode
 * (anything but `native` clones), so the backend contract is unchanged; the
 * mode is sent alongside it as `voice_mode`.
 *
 * Restored from the deployed Studio bundle — this component was live on
 * th-labs.uz but had never been committed to the repository, so the copy,
 * markup and class names here are recovered from that build rather than
 * rewritten, to keep it pixel-identical to what was shipped.
 */
export type VoiceMode = 'both' | 'speaker' | 'native'

export const VOICE_MODES: { id: VoiceMode; title: string; blurb: string }[] = [
  {
    id: 'both',
    title: 'Their voice, spoken natively',
    blurb:
      'Sounds like the original speaker, pronounced like a native. Best for most dubs.',
  },
  {
    id: 'speaker',
    title: 'Their voice exactly',
    blurb:
      'The closest match to the original speaker — and carries their accent into the new language.',
  },
  {
    id: 'native',
    title: 'A native speaker',
    blurb:
      'A natural voice in the target language. Keeps none of the original speaker.',
  },
]

/** Short label for the collapsed step header. */
export function voiceModeLabel(mode: VoiceMode): string {
  switch (mode) {
    case 'speaker':
      return 'Their voice exactly'
    case 'native':
      return 'Native speaker'
    default:
      return 'Their voice, natively'
  }
}

export default function VoicePicker({
  mode,
  onMode,
  reference,
  onReference,
  isModeLocked,
  lockTier = 'Pro',
  referenceLockedReason = null,
  referenceLockTier = 'Pro',
}: {
  mode: VoiceMode
  onMode: (mode: VoiceMode) => void
  reference: File | null
  onReference: (file: File | null) => void
  /** A voice mode the user's plan does not include — shown, locked. */
  isModeLocked?: (mode: VoiceMode) => boolean
  /** Plan that unlocks the locked modes, for the badge. */
  lockTier?: string
  /** Why a reference clip cannot be used on this plan, or null when it can. */
  referenceLockedReason?: string | null
  referenceLockTier?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  // A reference clip only means something when the dub is cloning a voice at
  // all — under "A native speaker" there is nothing for it to match, so the
  // whole block is hidden rather than shown and quietly ignored.
  const showReference = mode !== 'native'

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {VOICE_MODES.map((m) => {
          const active = mode === m.id
          const locked = isModeLocked?.(m.id) ?? false
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onMode(m.id)}
              disabled={locked}
              aria-pressed={active}
              className={`focusable rounded-lg border px-4 py-3 text-left transition-colors ${
                locked
                  ? 'cursor-not-allowed border-subtle opacity-50'
                  : active
                    ? 'border-brand bg-brand/10'
                    : 'border-subtle hover:border-[rgb(var(--c-border))]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-brand' : 'bg-muted'}`}
                />
                <span className="text-sm font-medium text-primary">{m.title}</span>
                {locked && <PlanLockBadge tier={lockTier} />}
              </div>
              <p className="mt-1 pl-4 text-xs leading-relaxed text-muted">{m.blurb}</p>
            </button>
          )
        })}
      </div>

      {showReference && (
        <div className="rounded-lg border border-subtle px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                Use a different voice
                {referenceLockedReason && <PlanLockBadge tier={referenceLockTier} />}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {referenceLockedReason
                  ? referenceLockedReason
                  : reference
                    ? reference.name
                    : 'Optional — a clip of any voice to dub in, instead of the speaker in the video.'}
              </p>
            </div>
            <div className={`flex items-center gap-2 ${referenceLockedReason ? 'hidden' : ''}`}>
              {reference && (
                <button
                  type="button"
                  onClick={() => {
                    onReference(null)
                    // Clear the input too, or picking the SAME file again fires
                    // no change event and the clip silently never comes back.
                    if (inputRef.current) inputRef.current.value = ''
                  }}
                  className="btn-ghost focusable px-3 py-1.5 font-mono text-xs"
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="btn-ghost focusable px-3 py-1.5 font-mono text-xs"
              >
                {reference ? 'Replace' : 'Choose file'}
              </button>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => onReference(e.target.files?.[0] ?? null)}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            A few seconds of clear speech is enough; long clips are trimmed. The
            voice is matched, not the words — whatever it says is ignored.
          </p>
        </div>
      )}
    </div>
  )
}

/** The small "Pro" chip on an option the current plan does not include. */
export function PlanLockBadge({ tier = 'Pro' }: { tier?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-subtle bg-sunken px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      {tier}
    </span>
  )
}
