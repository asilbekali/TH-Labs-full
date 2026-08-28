import { useEffect, useMemo, useRef, useState } from 'react'
import type { Segment } from '../lib/types'

function ts(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SegmentTable({
  segments,
  onRevoice,
  revoicing = false,
}: {
  segments: Segment[]
  /** Supplied once a dub has finished: enables editing the translation. */
  onRevoice?: (edits: { id: number; target_text: string }[]) => void
  revoicing?: boolean
}) {
  // Drafts live here, keyed by segment id, and hold only what the user changed.
  // Keying by id rather than by index matters: a re-dub returns a new job whose
  // segments are renumbered contiguously, and an index-keyed draft would then
  // be applied to whichever line happened to land in that position.
  const [drafts, setDrafts] = useState<Record<number, string>>({})

  // A new transcript is a different set of lines, so previous drafts no longer
  // refer to anything. Compare ids rather than the array identity, which
  // changes on every SSE frame.
  const ids = segments.map((s) => s.id).join(',')
  const lastIds = useRef(ids)
  useEffect(() => {
    if (lastIds.current !== ids) {
      lastIds.current = ids
      setDrafts({})
    }
  }, [ids])

  const edits = useMemo(
    () =>
      segments
        .filter((s) => drafts[s.id] !== undefined && drafts[s.id].trim() !== (s.target_text ?? ''))
        .map((s) => ({ id: s.id, target_text: drafts[s.id].trim() })),
    [segments, drafts],
  )
  const editable = Boolean(onRevoice)
  const blocked = edits.some((e) => !e.target_text)

  if (!segments.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-3.5">
        <h3 className="text-sm font-semibold text-primary">
          Transcript &amp; translation
        </h3>
        <div className="flex items-center gap-3">
          {editable && edits.length > 0 && (
            <span className="text-xs text-muted">
              {edits.length} line{edits.length > 1 ? 's' : ''} edited
            </span>
          )}
          {editable && (
            <button
              type="button"
              disabled={!edits.length || blocked || revoicing}
              onClick={() => onRevoice?.(edits)}
              className="btn-primary focusable px-3.5 py-1.5 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40"
              title={
                blocked
                  ? 'A line cannot be left empty'
                  : edits.length
                    ? 'Re-voice the dub with your corrections'
                    : 'Edit a translation to enable this'
              }
            >
              {revoicing ? 'Re-dubbing…' : 'Re-dub with edits'}
            </button>
          )}
          <span className="text-xs text-muted">{segments.length} segments</span>
        </div>
      </div>
      {editable && (
        <p className="border-b border-subtle px-5 py-2 text-xs text-muted">
          Edit the translation on the right to correct it, then re-dub. Your
          text is voiced as written — nothing is re-translated. The current dub
          stays playable while the new one renders, and corrections are free.
        </p>
      )}
      <div className="max-h-[26rem] divide-y divide-[rgb(var(--c-border-subtle))] overflow-y-auto">
        {segments.map((s) => {
          const draft = drafts[s.id]
          const value = draft !== undefined ? draft : (s.target_text ?? '')
          const changed = draft !== undefined && draft.trim() !== (s.target_text ?? '')
          return (
            <div
              key={s.id}
              className="grid grid-cols-[auto_1fr] gap-3 px-5 py-3.5 sm:grid-cols-[3.5rem_1fr_1fr]"
            >
              <div className="font-mono text-xs text-muted">{ts(s.start)}</div>
              <div className="text-sm text-secondary">{s.source_text}</div>
              <div className="text-sm text-primary sm:border-l sm:border-subtle sm:pl-3">
                {editable ? (
                  <textarea
                    value={value}
                    rows={1}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [s.id]: e.target.value }))
                    }
                    onInput={(e) => {
                      // Grow with the text: a corrected line is often longer
                      // than the one it replaces, and a scrollbar inside a
                      // one-line box hides what you just typed.
                      const el = e.currentTarget
                      el.style.height = 'auto'
                      el.style.height = `${el.scrollHeight}px`
                    }}
                    spellCheck={false}
                    aria-label={`Translation for the line at ${ts(s.start)}`}
                    className={`focusable w-full resize-none rounded-md border bg-transparent px-2 py-1 text-sm text-primary outline-none ${
                      changed
                        ? 'border-brand/60 bg-brand/5'
                        : 'border-transparent hover:border-subtle'
                    }`}
                  />
                ) : (
                  s.target_text || <span className="text-muted">—</span>
                )}
                {s.speaker_similarity != null && (
                  <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand">
                    {s.speaker_similarity}% voice
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
