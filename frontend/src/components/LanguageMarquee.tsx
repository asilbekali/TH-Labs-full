import { useEffect, useState } from 'react'
import { getLanguages } from '../lib/api'
import type { Language } from '../lib/types'

const FALLBACK: Pick<Language, 'flag' | 'name'>[] = [
  { flag: '🇬🇧', name: 'English' }, { flag: '🇺🇿', name: 'Uzbek' },
  { flag: '🇷🇺', name: 'Russian' }, { flag: '🇪🇸', name: 'Spanish' },
  { flag: '🇫🇷', name: 'French' }, { flag: '🇩🇪', name: 'German' },
  { flag: '🇨🇳', name: 'Chinese' }, { flag: '🇯🇵', name: 'Japanese' },
  { flag: '🇰🇷', name: 'Korean' }, { flag: '🇸🇦', name: 'Arabic' },
  { flag: '🇮🇳', name: 'Hindi' }, { flag: '🇹🇷', name: 'Turkish' },
  { flag: '🇧🇷', name: 'Portuguese' }, { flag: '🇮🇹', name: 'Italian' },
]

export default function LanguageMarquee() {
  const [langs, setLangs] = useState(FALLBACK)

  useEffect(() => {
    getLanguages()
      .then((ls) => ls.length && setLangs(ls))
      .catch(() => {})
  }, [])

  const row = [...langs, ...langs]

  return (
    <div className="relative overflow-hidden py-2">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink to-transparent" />
      <div className="flex w-max animate-marquee gap-3">
        {row.map((l, i) => (
          <span
            key={i}
            className="chip flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm text-white/70"
          >
            <span className="text-base">{l.flag}</span>
            {l.name}
          </span>
        ))}
      </div>
    </div>
  )
}
