import { MARK_PATH } from './mark-geometry'

// The TH-Labs mark (mark only — the wordmark never appears in the UI).
// One even-odd path in currentColor: the cuts read as the page showing through,
// so the mark inverts correctly between themes without a second fill.
export default function LogoMark({
  className = 'h-6 w-6',
  title,
}: {
  className?: string
  title?: string
}) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path fillRule="evenodd" d={MARK_PATH} />
    </svg>
  )
}

// Section divider: three of the mark's slashes at its own 30° rake, in the
// current text colour. Replaces the old gradient rule in section kickers.
export function MarkDivider({ className = 'h-3 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 12" className={className} fill="currentColor" aria-hidden>
      <path d="M6.93,0 L10.13,0 L3.2,12 L0,12 Z" />
      <path d="M18.43,0 L21.03,0 L14.1,12 L11.5,12 Z" />
      <path d="M29.93,0 L31.93,0 L25,12 L23,12 Z" />
    </svg>
  )
}
