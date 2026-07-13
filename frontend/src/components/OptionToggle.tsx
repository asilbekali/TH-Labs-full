import type { ReactNode } from 'react'

export default function OptionToggle({
  checked,
  onChange,
  title,
  description,
  icon,
  accent = 'violet',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  description: string
  icon?: ReactNode
  accent?: 'violet' | 'cyan'
}) {
  const on = accent === 'cyan' ? 'bg-cyan-400' : 'bg-violet-500'
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
        checked
          ? 'border-violet-400/40 bg-violet-500/[0.06]'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
    >
      {icon && (
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-violet-200">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
        </span>
      )}
      <span className="flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-white">{title}</span>
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              checked ? on : 'bg-white/15'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                checked ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </span>
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-white/50">
          {description}
        </span>
      </span>
    </button>
  )
}
