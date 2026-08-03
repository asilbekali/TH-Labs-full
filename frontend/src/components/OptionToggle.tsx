import type { ReactNode } from 'react'

// The `accent` prop is gone: it used to pick between violet and cyan, and the
// current design has one accent. Call sites that passed accent="cyan" simply
// drop it.
export default function OptionToggle({
  checked,
  onChange,
  title,
  description,
  icon,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  description: string
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`focus-ring flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        checked
          ? 'border-accent/40 bg-accent-dim'
          : 'border-line bg-white/[0.02] hover:border-line-strong'
      }`}
    >
      {icon && (
        <span
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 transition-colors ${
            checked ? 'text-accent' : 'text-text-3'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
        </span>
      )}
      <span className="flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="font-mono text-sm font-medium text-white">{title}</span>
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              checked ? 'bg-accent' : 'bg-white/15'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                checked ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </span>
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-text-2">
          {description}
        </span>
      </span>
    </button>
  )
}
