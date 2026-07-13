import type { ReactNode } from 'react'
import Reveal from './Reveal'

export default function FeatureCard({
  icon,
  title,
  children,
  delay = 0,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  delay?: number
}) {
  return (
    <Reveal delay={delay}>
      <div className="card card-hover h-full p-6">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-violet-200">
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icon}
          </svg>
        </span>
        <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{children}</p>
      </div>
    </Reveal>
  )
}
