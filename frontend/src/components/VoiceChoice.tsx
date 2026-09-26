import { useRef } from 'react'

export type VoiceMode = 'speaker' | 'native' | 'both'

/** The three options, described by outcome rather than by engine.
 *
 * Nobody choosing a voice cares which model produces it, and the honest
 * difference between them is not "cloning on/off" — it is whether the dub keeps
 * the speaker's identity, their accent, or both. Naming them after the engines
 * would hide the one thing the user has to weigh. */
const MODES: { id: VoiceMode; title: string; blurb: string }[] = [
  {
    id: 'both',
    title: 'Their voice, spoken natively',
    blurb: 'Sounds like the original speaker, pronounced like a native. Best for most dubs.',
  },
  {
    id: 'speaker',
    title: 'Their voice exactly',
    blurb: 'The closest match to the original speaker — and carries their accent into the new language.',
  },
  {
    id: 'native',
    title: 'A native speaker',
    blurb: 'A natural voice in the target language. Keeps none of the original speaker.',
  },
]

/** Renders inside the Studio's "Voice & mix" StepCard, which supplies the
 *  card, the heading and the vertical rhythm — so this draws only the choices. */
export default function VoiceChoice({
  mode,
  onMode,
  reference,
  onReference,
}: {
  mode: VoiceMode
  onMode: (m: VoiceMode) => void
  /** An uploaded voice to dub in, instead of the speaker from the video. */
  reference: File | null
  onReference: (f: File | null) => void
}) {
  const pick = useRef<HTMLInputElement>(null)
  // A supplied voice is only used by the modes that clone one; offering the
  // upload next to "a native speaker" would imply it does something there.
  const usesVoice = mode !== 'native'

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {MODES.map((m) => {
          const on = mode === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onMode(m.id)}
              aria-pressed={on}
              className={`focusable rounded-lg border px-4 py-3 text-left transition-colors ${
                on
                  ? 'border-brand bg-brand/10'
                  : 'border-subtle hover:border-[rgb(var(--c-border))]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${on ? 'bg-brand' : 'bg-muted'}`}
                />
                <span className="text-sm font-medium text-primary">{m.title}</span>
              </div>
              <p className="mt-1 pl-4 text-xs leading-relaxed text-muted">{m.blurb}</p>
            </button>
          )
        })}
      </div>

      {usesVoice && (
        <div className="rounded-lg border border-subtle px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-primary">Use a different voice</p>
              <p className="mt-0.5 text-xs text-muted">
                {reference
                  ? reference.name
                  : 'Optional — a clip of any voice to dub in, instead of the speaker in the video.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {reference && (
                <button
                  type="button"
                  onClick={() => {
                    onReference(null)
                    if (pick.current) pick.current.value = ''
                  }}
                  className="btn-ghost focusable px-3 py-1.5 font-mono text-xs"
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                onClick={() => pick.current?.click()}
                className="btn-ghost focusable px-3 py-1.5 font-mono text-xs"
              >
                {reference ? 'Replace' : 'Choose file'}
              </button>
            </div>
          </div>
          <input
            ref={pick}
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
