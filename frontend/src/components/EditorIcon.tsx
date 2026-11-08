// The line icons of the two editors (speech editor, AI Voiceover), so their
// rails and toolbars read as one tool instead of a row of emoji.
const PATHS = {
  media: 'M3 5h18v14H3zM3 9h18M8 5v4M16 5v4M10 12.5v4l3.5-2z',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  subtitles: 'M3 5h18v14H3zM7 15h4M14 15h3M7 11h2M12 11h5',
  dubs: 'M4 9h16v11H4zM4 9l1-4 15-1 1 4M9 4.6 10 9M15 4.2 16 9',
  undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 5 5v1',
  redo: 'm15 7 5 5-5 5M20 12H9a5 5 0 0 0-5 5v1',
  split: 'M6 3v0M8.1 8.1 20 20M8.1 15.9 20 4M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  eyeOff: 'M4 4l16 16M10 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.3 4M6.5 6.8A18 18 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.5-1.1',
  sound: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11',
  soundOff: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  back: 'M15 5l-7 7 7 7',
} as const

export type IconName = keyof typeof PATHS | 'play' | 'pause'

export default function EditorIcon({ name, className = 'h-[18px] w-[18px]' }: { name: IconName; className?: string }) {
  if (name === 'play' || name === 'pause') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        {name === 'play' ? <path d="M7 4.5v15l12.5-7.5z" /> : <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" />}
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  )
}
