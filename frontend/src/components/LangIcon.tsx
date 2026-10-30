import { useState } from 'react'

// Every square flag in country-flag-icons, as a URL. `no-inline` keeps each one
// a separate file: the JS carries ~260 short paths, and a page downloads only
// the handful of flags it actually shows.
const FLAGS = import.meta.glob<string>('/node_modules/country-flag-icons/1x1/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
})

/**
 * The flag emoji the API sends (🇺🇿) back to its ISO country code ("UZ").
 * A flag emoji is two regional-indicator letters, so this needs no table and
 * works for any language the backend adds later.
 */
function countryOf(emoji: string | undefined): string | null {
  if (!emoji) return null
  const letters = [...emoji]
    .map((ch) => ch.codePointAt(0)! - 0x1f1e6)
    .filter((n) => n >= 0 && n < 26)
  return letters.length === 2 ? String.fromCharCode(65 + letters[0], 65 + letters[1]) : null
}

function flagUrl(emoji: string | undefined): string | null {
  const cc = countryOf(emoji)
  return cc ? (FLAGS[`/node_modules/country-flag-icons/1x1/${cc}.svg`] ?? null) : null
}

/**
 * A language, drawn: a round flag with a hairline ring, or — for "auto" — the
 * detect mark, an orange tile with a globe and a spark. Replaces emoji, which
 * render differently on every OS and as two bare letters on Windows.
 *
 * Falls back to the language code in a round chip when there is no flag.
 */
export default function LangIcon({
  code,
  flag,
  size = 20,
  className = '',
}: {
  /** The language code; "auto" draws the auto-detect mark. */
  code: string
  /** The flag emoji from the language list. */
  flag?: string
  size?: number
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const box = { width: size, height: size }

  if (code === 'auto') {
    return (
      <span
        aria-hidden
        style={{ ...box, background: 'var(--grad-brand)' }}
        className={`relative inline-grid shrink-0 place-items-center rounded-full text-white shadow-[0_0_0_1px_rgb(255_255_255/0.18),0_4px_12px_-4px_rgb(255_122_26/0.6)] ${className}`}
      >
        <svg
          viewBox="0 0 24 24"
          style={{ width: size * 0.68, height: size * 0.68 }}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* globe, a little left of centre to leave room for the spark */}
          <circle cx="10.5" cy="13" r="7.5" />
          <path d="M3 13h15M10.5 5.5c-2.2 2.1-3.2 4.6-3.2 7.5s1 5.4 3.2 7.5c2.2-2.1 3.2-4.6 3.2-7.5s-1-5.4-3.2-7.5" />
          {/* the spark: "worked out for you" */}
          <path
            d="M19 1.8l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"
            fill="currentColor"
            strokeWidth="0.8"
          />
        </svg>
      </span>
    )
  }

  const url = broken ? null : flagUrl(flag)
  if (!url) {
    return (
      <span
        aria-hidden
        style={{ ...box, fontSize: Math.max(8, size * 0.36) }}
        className={`inline-grid shrink-0 place-items-center rounded-full bg-[var(--well)] font-semibold uppercase text-secondary ring-1 ring-[var(--card-edge)] ${className}`}
      >
        {code.slice(0, 2)}
      </span>
    )
  }

  return (
    <img
      src={url}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setBroken(true)}
      style={box}
      className={`inline-block shrink-0 rounded-full object-cover shadow-[0_0_0_1px_rgb(255_255_255/0.14),0_1px_3px_rgb(0_0_0/0.35)] ${className}`}
    />
  )
}
