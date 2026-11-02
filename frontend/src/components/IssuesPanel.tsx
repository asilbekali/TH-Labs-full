// "What went wrong, and how to fix it" — shown under a finished dub.
//
// The issues come from the server (backend/app/pipeline/issues.py), which has
// the evidence: which lines are silent on the voice track, which came out of
// translation empty, which are too long for their slot. This only presents
// them and offers the fix that fits the user's plan — on Studio Max a line
// problem opens the speech editor on exactly those lines; below Max it points
// at the transcript editor under the video, which re-dubs the whole thing.
import { Link } from 'react-router-dom'
import type { Issue, Segment } from '../lib/types'

const TONE: Record<Issue['severity'], { ring: string; dot: string; label: string }> = {
  error: { ring: 'border-danger/30 bg-danger/[0.06]', dot: 'bg-danger', label: 'Needs fixing' },
  warning: { ring: 'border-warn/30 bg-warn/[0.06]', dot: 'bg-warn', label: 'Check this' },
  info: { ring: 'border-subtle bg-sunken', dot: 'bg-info', label: 'Good to know' },
}

function ts(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function IssuesPanel({
  issues,
  segments,
  canEditLines,
  editorHref,
  onRetry,
  onFocusLine,
  compact = false,
}: {
  issues: Issue[]
  segments: Segment[]
  /** Studio Max: line problems can be re-dubbed one line at a time. */
  canEditLines: boolean
  /** Where "Fix in the speech editor" goes; `?lines=` is appended. */
  editorHref?: string
  onRetry?: () => void
  /** In the editor itself: jump to a line instead of linking to it. */
  onFocusLine?: (id: number) => void
  compact?: boolean
}) {
  if (!issues.length) {
    return (
      <div className="card flex items-center gap-3 px-5 py-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success/15 text-success">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12 5 5 9-10" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-medium text-primary">No problems found</p>
          <p className="text-xs text-muted">Every line was voiced and fits its time slot.</p>
        </div>
      </div>
    )
  }

  const byId = new Map(segments.map((s) => [s.id, s]))
  const serious = issues.filter((i) => i.severity !== 'info').length

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-5 py-3.5">
        <h3 className="text-sm font-semibold text-primary">
          {serious ? `${serious} thing${serious > 1 ? 's' : ''} to fix` : 'Notes on this dub'}
        </h3>
        <span className="text-xs text-muted">Found automatically after dubbing</span>
      </div>
      <ul className="flex flex-col gap-2.5 p-3 sm:p-4">
        {issues.map((issue) => {
          const tone = TONE[issue.severity]
          const lines = issue.segment_ids.map((id) => byId.get(id)).filter(Boolean) as Segment[]
          return (
            <li key={issue.code} className={`rounded-[var(--radius-control)] border p-3.5 ${tone.ring}`}>
              <div className="flex items-start gap-2.5">
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-muted">{tone.label}</p>
                  <p className="mt-0.5 text-sm font-medium text-primary">{issue.title}</p>
                  {!compact && issue.detail && (
                    <p className="mt-1 text-[13px] leading-relaxed text-secondary">{issue.detail}</p>
                  )}
                  <p className="mt-2 text-[13px] leading-relaxed text-primary">
                    <span className="font-medium">How to fix: </span>
                    <span className="text-secondary">{issue.fix}</span>
                  </p>

                  {lines.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {lines.slice(0, 12).map((s) =>
                        onFocusLine ? (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => onFocusLine(s.id)}
                            className="chip focusable px-2 py-0.5 font-mono text-[11px] text-primary hover:border-brand"
                            title={s.target_text || s.source_text}
                          >
                            #{s.id + 1} · {ts(s.start)}
                          </button>
                        ) : (
                          <span
                            key={s.id}
                            className="chip px-2 py-0.5 font-mono text-[11px] text-secondary"
                            title={s.target_text || s.source_text}
                          >
                            #{s.id + 1} · {ts(s.start)}
                          </span>
                        ),
                      )}
                      {lines.length > 12 && (
                        <span className="px-1 text-[11px] text-muted">+{lines.length - 12} more</span>
                      )}
                    </div>
                  )}

                  <IssueAction
                    issue={issue}
                    canEditLines={canEditLines}
                    editorHref={editorHref}
                    onRetry={onRetry}
                    inEditor={!!onFocusLine}
                  />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function IssueAction({
  issue,
  canEditLines,
  editorHref,
  onRetry,
  inEditor,
}: {
  issue: Issue
  canEditLines: boolean
  editorHref?: string
  onRetry?: () => void
  inEditor: boolean
}) {
  const btn = 'btn-ghost focusable mt-3 inline-flex h-8 items-center px-3.5 text-[12px]'
  if (issue.action === 'edit_line') {
    if (inEditor) return null
    if (canEditLines && editorHref) {
      const q = issue.segment_ids.length ? `?lines=${issue.segment_ids.join(',')}` : ''
      return (
        <Link to={`${editorHref}${q}`} className="btn-primary focusable mt-3 inline-flex h-8 items-center px-3.5 text-[12px]">
          Fix {issue.segment_ids.length === 1 ? 'this line' : 'these lines'} in the speech editor →
        </Link>
      )
    }
    return (
      <p className="mt-3 text-[12px] text-muted">
        Edit the line in the transcript below and re-dub, or{' '}
        <Link to="/plans" className="font-medium text-primary underline-offset-4 hover:underline">
          upgrade to Max
        </Link>{' '}
        to re-dub only the broken line.
      </p>
    )
  }
  if (issue.action === 'retry' && onRetry) {
    return (
      <button type="button" onClick={onRetry} className={btn}>
        Dub it again
      </button>
    )
  }
  if (issue.action === 'buy_tokens' || issue.action === 'upgrade') {
    return (
      <Link to="/plans" className={btn}>
        {issue.action === 'buy_tokens' ? 'Top up tokens' : 'See plans'}
      </Link>
    )
  }
  return null
}
