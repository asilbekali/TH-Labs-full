import { useMemo } from 'react'
import { motion } from 'framer-motion'

/**
 * Paste a public video link instead of uploading a file.
 *
 * The server does the fetching (backend/app/pipeline/fetch.py), which is also
 * where the real rules live: only http/https, only public addresses, 2 GB and
 * 2 hours maximum, and a clear refusal for a private or members-only video.
 *
 * The checks here are deliberately the shallow ones — is this even a URL, is it
 * http(s), is it obviously a page we know carries no video. Duplicating the
 * server's rules in the browser would mean two sets of limits to keep in step,
 * and the one that matters is the server's. What this does earn is turning the
 * most common typo into an inline hint instead of a round-trip and a 400.
 */

// Hosts we can name specifically, purely so the hint can be concrete. Not an
// allowlist: anything yt-dlp supports works, and the list being incomplete is
// expected.
const KNOWN = [
  { match: /(^|\.)(youtube\.com|youtu\.be)$/i, label: 'YouTube' },
  { match: /(^|\.)vimeo\.com$/i, label: 'Vimeo' },
  { match: /(^|\.)tiktok\.com$/i, label: 'TikTok' },
  { match: /(^|\.)instagram\.com$/i, label: 'Instagram' },
  { match: /(^|\.)facebook\.com$/i, label: 'Facebook' },
  { match: /(^|\.)twitter\.com$|(^|\.)x\.com$/i, label: 'X' },
  { match: /(^|\.)dailymotion\.com$/i, label: 'Dailymotion' },
  { match: /(^|\.)soundcloud\.com$/i, label: 'SoundCloud' },
] as const

export interface LinkState {
  /** Null while the box is empty or the text is not yet a usable URL. */
  url: string | null
  /** An inline hint, or null. Present with a null url means "not valid yet". */
  hint: string | null
  /** 'YouTube', 'Vimeo', … or 'Direct file' / null. */
  source: string | null
}

/**
 * Classify what was typed. Exported so the Studio can gate the Start button on
 * the same verdict the field is showing, rather than re-deriving it.
 */
export function readLink(raw: string): LinkState {
  const text = raw.trim()
  if (!text) return { url: null, hint: null, source: null }

  // A bare "youtube.com/watch?v=…" is what people paste when they copy from the
  // address bar of a browser that hides the scheme. Assume https rather than
  // refusing it — the server re-vets whatever we send.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { url: null, hint: 'That does not look like a link yet.', source: null }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      url: null,
      hint: 'Only http and https links can be fetched.',
      source: null,
    }
  }
  if (!parsed.hostname.includes('.')) {
    return { url: null, hint: 'That link is missing a domain.', source: null }
  }

  const known = KNOWN.find((k) => k.match.test(parsed.hostname))
  if (known) {
    // A YouTube *channel* or *results* URL is the single most common wrong
    // paste, and it fails server-side several seconds later with a vaguer
    // message than we can give right here.
    if (/(^|\.)(youtube\.com)$/i.test(parsed.hostname)) {
      if (/^\/(results|feed|channel|@|c\/|user\/)/.test(parsed.pathname)) {
        return {
          url: null,
          hint: 'That is a channel or a search page — open the video itself and copy that link.',
          source: known.label,
        }
      }
    }
    return { url: parsed.toString(), hint: null, source: known.label }
  }

  const isDirect = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|m4a|wav|aac|ogg|flac)$/i.test(
    parsed.pathname,
  )
  return {
    url: parsed.toString(),
    hint: null,
    source: isDirect ? 'Direct file' : 'Link',
  }
}

export default function LinkInput({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const state = useMemo(() => readLink(value), [value])
  const ok = !!state.url

  return (
    <div>
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors ${
            ok ? 'text-success' : 'text-muted'
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10 13a5 5 0 0 0 7.1 0l2.9-2.9a5 5 0 0 0-7.1-7.1L11 4.9" />
          <path d="M14 11a5 5 0 0 0-7.1 0L4 13.9a5 5 0 0 0 7.1 7.1L13 19.1" />
        </svg>
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://youtube.com/watch?v=…"
          aria-invalid={!!state.hint}
          aria-describedby="link-hint"
          className={`focusable w-full rounded-control border bg-sunken py-2.5 pl-9 pr-3 text-sm text-primary outline-none transition-colors placeholder:text-muted disabled:opacity-60 ${
            state.hint
              ? 'border-danger/50'
              : ok
                ? 'border-success/50'
                : 'border-subtle hover:border-brand/40'
          }`}
        />
      </div>

      <div id="link-hint" className="mt-2 min-h-[1.25rem] text-xs">
        {state.hint ? (
          <span className="text-danger">{state.hint}</span>
        ) : ok ? (
          <motion.span
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-success"
          >
            {state.source} link ready — we'll fetch it when you start.
          </motion.span>
        ) : (
          <span className="text-muted">
            YouTube, Vimeo, TikTok, or a direct file URL. Public videos only —
            anything needing a sign-in has to be uploaded.
          </span>
        )}
      </div>
    </div>
  )
}
